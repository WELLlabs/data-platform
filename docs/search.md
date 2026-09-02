# Search Functionality — Architecture, Structure, Logic and Flow

This document describes the end-to-end search functionality of the data portal: database design, synchronization, API, caching, and frontend behavior.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Database Layer](#2-database-layer)
3. [Unique Constraint: `(dataset_id, file_id)`](#3-unique-constraint-dataset_id-file_id)
4. [Synchronization (Triggers)](#4-synchronization-triggers)
5. [Configuration and Environment](#5-configuration-and-environment)
6. [API Layer](#6-api-layer)
7. [Search Service Logic and Flow](#7-search-service-logic-and-flow)
8. [Caching (Redis)](#8-caching-redis)
9. [Frontend](#9-frontend)
10. [End-to-End Flow Summary](#10-end-to-end-flow-summary)

---

## 1. Overview

Search allows users to find datasets and files by keywords. It uses:

- **Full-Text Search (FTS)** in PostgreSQL for linguistic relevance (stemming, stop words).
- **Trigrams (`pg_trgm`)** for typo tolerance and partial matches.
- A **decoupled search table** `global_search_index` that aggregates data from `datasets` and `files`, kept in sync by **PostgreSQL triggers**.
- **Redis** as a result cache for the first 100 results per query when no filters are applied, to avoid repeated heavy FTS/trigram work.
- **Visibility rules** aligned with the datasets API: without API key only public results; with valid API key, public plus the user’s organization.

Relevant code locations:

| Layer        | Path |
|-------------|------|
| Config      | `src/api/core/config.py` |
| Model       | `src/api/models/global_search_index.py` |
| Migration   | `src/api/migrations/versions/a1b2c3d4e5f6_global_search_index.py` |
| Router      | `src/api/routers/search.py` |
| Service     | `src/api/services/search.py` |
| Schemas     | `src/api/schemas/search.py` |
| Security    | `src/api/utils/security.py` |
| Frontend    | `src/web/src/pages/Search.jsx`, `src/web/src/api/endpoints.js`, `src/web/src/App.js` |

---

## 2. Database Layer

### 2.1 Table: `global_search_index`

The table is defined in the migration and mirrored by the SQLAlchemy model. It holds one row per searchable entity: either a **dataset** (no file) or a **file** (under a dataset).

| Column           | Type                    | Nullable | Description |
|------------------|-------------------------|----------|-------------|
| `id`             | SERIAL / Integer        | No       | Primary key |
| `dataset_id`     | UUID                    | No       | Dataset reference |
| `file_id`        | UUID                    | Yes      | NULL for dataset-level rows; set for file-level rows |
| `title`          | TEXT                    | Yes      | Dataset title or file title |
| `context`        | TEXT                    | Yes      | Concatenated searchable text (see [Context construction](#context-construction)) |
| `fts_vector`     | TSVECTOR                | Yes      | Full-text search vector (English) |
| `organization_id`| VARCHAR(100)            | No       | From dataset (direct or parent) |
| `availability`   | INTEGER                 | No       | From dataset (0–4) |
| `temporal_from`  | TIMESTAMP WITH TIME ZONE | Yes      | NULL for datasets; from file when present |
| `temporal_to`    | TIMESTAMP WITH TIME ZONE | Yes      | NULL for datasets; from file when present |

**Indexes:**

- B-tree: `dataset_id`, `file_id`, `organization_id`, `(private, organization_id)`.
- GIN on `fts_vector` for FTS.
- GIN on `context` with `gin_trgm_ops` for trigram search on context.

**Extensions:**

- `pg_trgm` for trigram similarity and `%` operator.

### 2.2 Context Construction

**Dataset row** (source: `datasets`; `file_id` is NULL):

- **Context** = `dataset_description` (if present) + comma-separated tag names from `tag_dataset` → `tags` for that `dataset_id`.
- **Title** = `dataset_title`.
- **Temporal** = `temporal_from`, `temporal_to` are NULL.

**File row** (source: `files`; `file_id` set):

- **Context** = `file_description` + `file_format` + `provenance` + `source` + `geography` (each appended only if present, space-separated).
- **Title** = `file_title`.
- **Temporal** = `temporal_from`, `temporal_to` from the file.
- **organization_id**, **private** = from the parent row in `datasets` via `dataset_id`.

---

## 3. Unique Constraint: `(dataset_id, file_id)`

The table has a **unique constraint** on the pair `(dataset_id, file_id)`:

- **Constraint name:** `uq_global_search_index_dataset_file`
- **Columns:** `dataset_id`, `file_id`

**Meaning:** The combination of `dataset_id` and `file_id` must be unique in the table. So:

- There can be only **one row per dataset** when `file_id` is NULL (dataset-level row).
- There can be only **one row per file** when `file_id` is set (and that file belongs to that `dataset_id`).

This prevents duplicate index entries when triggers run on INSERT/UPDATE and allows **upsert** behavior: triggers use `ON CONFLICT (dataset_id, file_id) DO UPDATE SET ...` so that repeated sync (e.g. after an update to a dataset or file) updates the existing row instead of inserting a second one.

**Note:** In PostgreSQL, NULL is distinct in unique constraints, so many rows can have `file_id = NULL` as long as `dataset_id` differs; and for each `(dataset_id, file_id)` with non-NULL `file_id`, only one row is allowed.

---

## 4. Synchronization (Triggers)

The index is kept up to date by triggers on `datasets` and `files`. No application code is required to maintain `global_search_index`.

### 4.1 Trigger on `datasets`

- **Trigger:** `trg_sync_global_search_index_datasets`
- **Events:** AFTER INSERT, UPDATE, DELETE
- **Function:** `sync_global_search_index_from_datasets()`

**Behavior:**

- **DELETE:** Delete all rows in `global_search_index` where `dataset_id = OLD.dataset_id` (removes both the dataset row and all file rows for that dataset).
- **INSERT/UPDATE:** Build `context` from `dataset_description` and tag names (via `tag_dataset` + `tags`). Insert one row with `file_id = NULL`, `temporal_from`/`temporal_to = NULL`, and `organization_id`/`private` from the dataset. Use `ON CONFLICT (dataset_id, file_id) DO UPDATE` to upsert.

### 4.2 Trigger on `files`

- **Trigger:** `trg_sync_global_search_index_files`
- **Events:** AFTER INSERT, UPDATE, DELETE
- **Function:** `sync_global_search_index_from_files()`

**Behavior:**

- **DELETE:** Delete the row in `global_search_index` where `file_id = OLD.file_id`.
- **INSERT/UPDATE:** Get `organization_id` and `private` from `datasets` for `NEW.dataset_id`. Build `context` from file description, format, provenance, source, geography. Insert one row with `file_id = NEW.file_id`, `temporal_from`/`temporal_to` from the file. Use `ON CONFLICT (dataset_id, file_id) DO UPDATE` to upsert.

### 4.3 Backfill (Migration)

The same migration backfills existing data:

- Inserts dataset-level rows (with tag-aggregated context) using `ON CONFLICT (dataset_id, file_id) DO NOTHING`.
- Inserts file-level rows (joining `files` to `datasets` for organization/private) using `ON CONFLICT (dataset_id, file_id) DO NOTHING`.

---

## 5. Configuration and Environment

| Variable                  | Purpose | Default |
|---------------------------|--------|--------|
| `SEARCH_CACHE_AGE_SECONDS`| Redis TTL (seconds) for search result cache | 120 |
| `REDIS_URL`               | Redis connection for cache | Required |
| `POSTGRES_URL`            | Database connection | Required |

- **Config:** `src/api/core/config.py` — `Settings.SEARCH_CACHE_AGE_SECONDS` (default 120).
- **Template:** `env.template` documents `SEARCH_CACHE_AGE_SECONDS` (e.g. 600).

### 5.1 Behavior when Redis is unavailable

When Redis is unreachable (e.g. connection refused, timeout, or `REDIS_URL` points to a down instance), the search API **does not return errors to callers**. It degrades to uncached database queries:

- **Cache layer:** `SearchService` in `src/api/services/search.py` uses Redis only for cache reads (`_get_cached`) and writes (`_set_cache`). Both methods catch exceptions: on Redis failure, `_get_cached` returns `None` (cache miss) and `_set_cache` skips writing. The service then runs the same search against PostgreSQL via `_run_search`.
- **No retry/backoff:** There is no retry or backoff logic for Redis operations; each request treats a Redis failure as a one-off cache miss/skip.
- **No circuit breaker:** The cache layer does not implement a circuit breaker; every search request will attempt Redis when cache is used (no filters).
- **HTTP and errors:** Clients still receive **200 OK** with the same response shape; results are simply computed from the database instead of cache. No specific HTTP status or error message is returned for Redis failures. Operators can identify Redis issues via logging: `"Redis cache read failed"` and `"Redis cache write failed"` are logged at warning level in `_get_cached` and `_set_cache`. For metrics or health checks, monitor Redis connectivity and these log lines; `REDIS_URL` and `SearchService` (and its dependency `get_redis` in `src/api/services/auth.py`) are the places to adjust configuration and inspect cache-related behavior.

---

## 6. API Layer

### 6.1 Route Registration

In `src/api/main.py`, the search router is mounted with no path prefix and tagged as "Search":

```python
app.include_router(search_router, prefix="", tags=["Search"])
```

The route is **GET `/search`** (full path under root_path: `/api/search`).

### 6.2 Endpoint: GET `/search`

- **Router:** `src/api/routers/search.py`
- **Query parameters:**
  - `query` (required, str): Search keywords.
  - `organization_id` (optional, str): Filter by organization.
  - `start_date` (optional, datetime): Filter by temporal range start.
  - `end_date` (optional, datetime): Filter by temporal range end.
  - `limit` (default 10, 1–100): Page size.
  - `offset` (default 0, ≥ 0): Pagination offset.
  - `apikey` (optional, str): For visibility (see below).

**Flow in the router:**

1. Sanitize `query` with `sanitize_input(query)` from `src/api/utils/security.py` (bleach-based, strips tags and trims).
2. If sanitized string is empty or whitespace-only, return `SearchResponse(result=[], total=0)`.
3. Otherwise call `search_service.search(...)` with all parameters and return the result.

### 6.3 Schemas (`src/api/schemas/search.py`)

- **SearchResultItem:** `dataset_id`, `file_id` (string; empty string when dataset-level), `title`, `context`, `score`.
- **SearchResponse:** `result: List[SearchResultItem]`, `total: int`.

---

## 7. Search Service Logic and Flow

The core logic lives in `src/api/services/search.py` (`SearchService`).

### 7.1 Input and Visibility Rules

- **Query:** Must be non-empty after strip; already sanitized by the router.
- **Visibility (who can see which rows):**
  - Visibility uses `availability` plus creator/owner/org/admin rules (`core/availability.py`).
  - **With apikey:** Resolve user’s organization from `users` by `apikey`. If no filters: show rows where `organization_id = user_org` OR `private = false`. If filters are present, combine visibility with filter logic below.

### 7.2 Filter Rules (Summary)

1. **No apikey**
   - Base: `private = false`.
   - If `organization_id` provided: AND `organization_id = :organization_id`.
   - If `start_date` provided: AND (`temporal_to` IS NULL OR `temporal_to >= :start_date`).
   - If `end_date` provided: AND (`temporal_from` IS NULL OR `temporal_from <= :end_date`).

2. **Apikey provided**
   - Resolve `user_org` from `users` by `apikey`; if not found → 404 Invalid API key.
   - If no `organization_id`, `start_date`, or `end_date`: visibility = `(organization_id = :user_org OR private = false)`.
   - If `organization_id` is provided: use `check_user_belongs_to_organization_by_key(apikey, organization_id)`:
     - If True: filter by `organization_id = :organization_id`.
     - If False: filter by `organization_id = :organization_id AND private = false`.
   - If `start_date` or `end_date` (with or without `organization_id`): apply same temporal conditions as above; when `organization_id` is also provided, combine with the same membership check for org filter.

### 7.3 Match and Ranking

- **Match:** Rows must satisfy:
  - `fts_vector @@ websearch_to_tsquery('english', :query)` **OR** `title % :query` (trigram similarity).
- **Score:**  
  `(ts_rank(fts_vector, websearch_to_tsquery('english', :query)) * 0.7) + (similarity(title, :query) * 0.3)`  
  (with COALESCE for nulls).
- **Order:** DESC by this score; then `LIMIT`/`OFFSET` for pagination.
- **Total:** A separate `COUNT(*)` with the same WHERE clause is used for `total`.

### 7.4 Dependency Injection

`get_search_service` injects:

- `AsyncSession` (DB)
- Redis client (`get_redis`)
- `UserService` (for `check_user_belongs_to_organization_by_key`)

---

## 8. Caching (Redis)

### 8.1 When Results Are Cached

Cache is used **only when**:

- No `organization_id` filter (or empty),
- No `start_date` or `end_date`,
- No `apikey`.

So: **unfiltered, unauthenticated** queries only.

### 8.2 Cache Keys

- **ZSET of results:** `search:{sanitized_lowercase_query}`
- **Total count:** `search:{sanitized_lowercase_query}:total`

### 8.3 Cache Behavior

- **Cache hit:** If the ZSET key exists (and total is present), the service uses `ZREVRANGE` with `start = offset`, `end = offset + limit - 1` to get the requested page. Each member is a JSON-serialized `SearchResultItem`; score in the ZSET is the search score. Returns `SearchResponse(result=..., total=total)`.
- **Cache miss (and cacheable):** Run search against PostgreSQL with `limit=100`, `offset=0`. Store up to 100 `SearchResultItem`s in the ZSET with `ZADD` (score = item’s score), set the `:total` key, set TTL on both keys to `SEARCH_CACHE_AGE_SECONDS`. Return the slice `[offset : offset+limit]` from the 100 results and the total.
- **Offset ≥ 100:** For cacheable queries, no cache is used for that page; the service runs the search against the DB with the requested offset/limit.
- **Non-cacheable:** Every request runs against PostgreSQL; Redis is not used for that query.

### 8.4 TTL

- TTL for both the ZSET and the `:total` key is `settings.SEARCH_CACHE_AGE_SECONDS` (default 120; overridable via `SEARCH_CACHE_AGE_SECONDS` in `.env`).

---

## 9. Frontend

### 9.1 Route and Entry Points

- **Route:** `/search` — component `Search` from `src/web/src/pages/Search.jsx`.
- **App routing:** `src/web/src/App.js` — `<Route path="/search" element={<Search />} />`.
- **Datasets page:** A "Search" button next to "Upload" in `src/web/src/pages/Datasets.jsx` navigates to `/search`.

### 9.2 API Endpoint

- **Endpoint:** `search_endpoint` in `src/web/src/api/endpoints.js` → `/api/search`.

### 9.3 Search Page UI

- **Layout:** Centered; water-themed styling via `App.css` (e.g. `section-title`, `auth-card`, `btn-search`).
- **Search bar:** Text input for query + "Search" button; Enter key submits.
- **Advanced section:** Collapsible (reactstrap `Collapse`):
  - Label: "▶ Advanced" / "▼ Advanced" (chevron-right / chevron-down).
  - When expanded:
    - Checkbox "Search within organization" plus a text input (default: signed-in user’s `organization`; empty if not signed in).
    - Start Date and End Date (date inputs, default empty).
- **Results:** Each item is a card showing:
  - **Title** (first line).
  - **Context** trimmed to 3 lines (CSS `-webkit-line-clamp: 3`).
  - No `dataset_id`, `file_id`, or `score` shown.
- **Card click:** Navigate to `/dataset-info?dataset_id={dataset_id}` (same as `DatasetInfo.jsx` usage).
- **Pagination:** Previous/Next with page number; `limit=10`, `offset=(page-1)*10`.

### 9.4 Request Parameters Sent to API

- `query`: value from search input (trimmed).
- `organization_id`: sent only if "Search within organization" is checked and the org textbox has a value.
- `start_date`: if Start Date is set, sent as ISO timestamp (date + `T00:00:00` if needed).
- `end_date`: if End Date is set, sent as ISO timestamp (date + `T23:59:59` if needed).
- `limit`: 10.
- `offset`: `(currentPage - 1) * 10`.
- `apikey`: if user is signed in (`user.apikey`), otherwise not sent.

### 9.5 Response Handling

- Expects `{ result: [...], total: N }`.
- Renders `result` as cards; uses `total` for pagination (hasMore = `currentPage * LIMIT < total`).

---

## 10. End-to-End Flow Summary

1. **User** enters query (and optionally opens Advanced and sets organization/dates) and clicks Search or presses Enter.
2. **Frontend** builds GET `/api/search` with `query`, optional `organization_id`, `start_date`, `end_date`, `limit`, `offset`, and `apikey` if logged in.
3. **Router** sanitizes `query`; if empty, returns empty result; else calls **SearchService.search()**.
4. **SearchService**:
   - If request is cacheable and offset < 100: try Redis (ZSET + `:total`). On hit, return slice and total.
   - On cache miss (and cacheable): run PostgreSQL search for top 100, store in Redis with TTL, return slice and total.
   - If not cacheable or offset ≥ 100: run PostgreSQL search with requested limit/offset.
5. **PostgreSQL**:
   - Apply visibility (private/apikey/organization) and optional filters (organization_id, temporal).
   - Match: FTS OR trigram on title.
   - Rank by weighted score, order DESC, apply LIMIT/OFFSET; second query for COUNT.
6. **Response** is `SearchResponse(result=[...], total=N)`.
7. **Frontend** shows result cards and pagination; card click goes to dataset info with `dataset_id`.

**Data flow for index content:** Writes to `datasets` or `files` fire triggers that upsert/delete rows in `global_search_index`, so search always reflects current dataset and file metadata without application-level sync.

