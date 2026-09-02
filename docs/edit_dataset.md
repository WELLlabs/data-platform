# Edit Dataset and Edit File — Architecture, Structure, Logic and Flow

This document describes the edit functionality for datasets and files: API contracts, authorization, service logic, and frontend behavior.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Edit Dataset](#2-edit-dataset)
3. [Edit File](#3-edit-file)
4. [Authorization: Creator-Only Editing](#4-authorization-creator-only-editing)
5. [Frontend: DatasetInfo Page](#5-frontend-datasetinfo-page)
6. [End-to-End Flows](#6-end-to-end-flows)

---

## 1. Overview

- **Edit dataset:** Updates a single dataset row in the `datasets` table (title, description, availability, tags). Creator and dataset owners may edit.
- **Edit file:** Updates a single file row in the `files` table (title, description, provenance, source, cite_as, groundtruthed, permissions, duration, temporal range, geography). Creator and dataset owners may edit.

Both flows use the **session cookie** to identify the signed-in user and the **check_if_dataset_creator_by_id** validator to enforce creator-only access. Tags for datasets are managed via the `tags` and `tag_dataset` tables (create missing tags, replace associations).

| Layer        | Edit Dataset | Edit File |
|-------------|-------------|-----------|
| Router       | `src/api/routers/dataset.py` | `src/api/routers/upload.py` |
| Schema       | `src/api/schemas/dataset.py` (`EditDatasetRequest`) | `src/api/schemas/file.py` (`FileEditRequest`) |
| Service      | `src/api/services/dataset.py` (`update_dataset_metadata_and_tags`) | Inline in `UploadController.edit_file` (upload router) |
| User validator | `src/api/services/user.py` (`check_if_dataset_creator_by_id`) | Same |
| Frontend     | `src/web/src/pages/DatasetInfo.jsx` (dataset edit modal, submit) | Same (file edit modal, submit) |
| Endpoints    | `src/web/src/api/endpoints.js`: `edit_dataset_endpoint`, `edit_file_endpoint` | Same |

---

## 2. Edit Dataset

### 2.1 API Endpoint

- **Method and path:** `PUT /api/edit_dataset`  
- **Documented in:** `src/api/routers/dataset.py` (route handler and docstring).

### 2.2 Request

- **Authentication:** Required. The session cookie (e.g. `auth_cookie`) is used to resolve the current user via `get_current_active_user`. No API key in the request body.
- **Content-Type:** `application/json`.
- **Body:** JSON matching `EditDatasetRequest`:
  - `dataset_id` (UUID, required): Dataset to update.
  - `dataset_title` (string, required): New title (non-empty after strip).
  - `dataset_description` (string, optional): New description; empty/whitespace → null.
  - `availability` (integer 0–4, required): 0 public, 1 private, 2 organization, 3 admins, 4 owners.
  - `tags` (array of strings, required): New tag set; must contain at least one non-empty tag. Empty or missing → 422 "Tags are required".

Schema: `src/api/schemas/dataset.py` — `EditDatasetRequest`. Validators: title non-empty, description stripped/empty→None, tags required and non-empty (normalized to list of stripped strings).

### 2.3 Router Flow (`dataset.py`)

1. Parse body as `EditDatasetRequest` (Pydantic validates).
2. Resolve user: `user = Depends(get_current_active_user)` (session cookie → 401 if not authenticated).
3. Check dataset exists: `controller.dataset_service.dataset_exists(dataset_id)` → 404 if not.
4. Check creator: `user_service.check_if_dataset_creator_by_id(user.id, dataset_id)` → 403 with message `"Only creator of dataset can edit."` if False.
5. Call `controller.edit_dataset(dataset_id, dataset_title, dataset_description, availability, tags)`.
6. Before returning success response, clear Redis cache key `dataset:{dataset_id}` (if present) so subsequent `/api/dataset_info` fetch recomputes fresh data.
7. Return 200 with updated dataset JSON, or 500 on unexpected errors.

### 2.4 Controller and Service Logic

- **Controller** (`DatasetController.edit_dataset` in `dataset.py`): Delegates to `dataset_service.update_dataset_metadata_and_tags(...)` and builds the JSON response including `availability`. Returns 404 if service returns None (dataset not found).

- **Service** (`DatasetService.update_dataset_metadata_and_tags` in `src/api/services/dataset.py`):
  1. **Load dataset** by `dataset_id`; return None if not found.
  2. **Sanitize title** via `sanitize_input`; reject if empty → 400.
  3. **Organization availability logic:** Levels 1–4 are forced to `0` if the organization is not private.
  4. **Update dataset row:** Set `dataset_title`, `dataset_description`, `availability` on the `Dataset` instance; add to session.
  5. **Tags:**
     - Normalize `tags` with `_normalize_tags` (strip, replace internal spaces with `-`, lowercase, dedupe).
     - For each normalized tag: look up `Tag` by `tag_name` (case-insensitive); if missing, create a new `Tag`; collect `tag_id`s.
     - Delete all `TagDataset` rows for this `dataset_id`.
     - Insert new `TagDataset` rows for each `(dataset_id, tag_id)`.
  6. Commit, refresh dataset with `tags` relationship, return the updated `Dataset`.

### 2.5 Response

- **200 OK:** JSON object with updated dataset fields including `availability`.
- **400:** Invalid input (e.g. empty title).
- **401:** Not authenticated (no/invalid session).
- **403:** Not the creator — `"Only creator of dataset can edit."`
- **404:** Dataset not found.
- **500:** Internal error.

---

## 3. Edit File

### 3.1 API Endpoint

- **Method and path:** `PUT /api/edit_file`  
- **Documented in:** `src/api/routers/upload.py` (route handler and docstring).

### 3.2 Request

- **Authentication:** Required. Session cookie used via `get_current_active_user`.
- **Content-Type:** `application/json`.
- **Body:** JSON matching `FileEditRequest`:
  - `file_id` (UUID, required).
  - `file_title` (string, required).
  - `file_description`, `provenance`, `source`, `cite_as` (strings, optional).
  - `groundtruthed` (boolean, optional).
  - `permissions` (string, optional; must be one of allowed CC values or defaulted).
  - `duration` (integer, ≥ 0, default 0).
  - `temporal_from`, `temporal_to` (optional; ISO 8601 datetime or null).
  - `geography` (string, optional).

Schema: `src/api/schemas/file.py` — `FileEditRequest`. Validators: file_title non-empty; temporal fields parsed as ISO 8601; `temporal_to` must be after `temporal_from` when both set.

### 3.3 Router Flow (`upload.py`)

1. Parse body as `FileEditRequest` (Body dependency).
2. Resolve user: `user = Depends(get_current_active_user)`.
3. Call `controller.edit_file(..., user=user)` with all payload fields.
4. Return 200 with updated file JSON or appropriate HTTP error.

### 3.4 Controller Logic (`UploadController.edit_file` in `upload.py`)

1. **Load file** by `file_id`; 404 if not found.
2. **Get dataset_id** from `file_record.dataset_id`.
3. **Owner check:** `dataset_service.can_edit_or_add_file(user.id, dataset_id)` → 403 `"Only a dataset owner can edit."` if False.
4. **Sanitize and validate:**
   - `file_title`: sanitize; must be non-empty → 400 otherwise.
   - `file_description`, `cite_as`, `geography`: sanitize.
   - `provenance`: sanitize, max length 125 (truncate with log).
   - `source`: sanitize, max length 1000 (truncate with log).
   - `permissions`: `_validate_permissions(permissions, self.logger)` → one of `ALLOWED_PERMISSIONS` or `"CC0: Public Domain"`.
   - `duration`: `max(0, duration)`.
   - `temporal_from`, `temporal_to`: used as provided (schema parses ISO 8601; invalid/empty → null; order validated).
5. **Update** the file record with all edited fields; `session.add(file_record)`; commit; refresh.
6. **Cache invalidation:** Before returning success response, clear Redis cache key `dataset:{dataset_id}` (if present) to invalidate `/api/dataset_info` cache for the parent dataset.
7. Return 200 with JSON of updated file (file_id, file_title, file_description, provenance, source, cite_as, groundtruthed, permissions, duration, temporal_from, temporal_to, geography).

### 3.5 Permissions

- **Permissions (dropdown):** Must be one of:
  - CC0: Public Domain  
  - CC BY: Attribution  
  - CC BY-SA: Attribution-ShareAlike  
  - CC BY-NC: Attribution-NonCommercial  
  - CC BY-NC-SA: Attribution-NonCommercial-ShareAlike  
  - CC BY-ND: Attribution-NoDerivatives  
  - CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives  
  Invalid or empty → backend uses `"CC0: Public Domain"` (and schema can default similarly).

### 3.6 Response

- **200 OK:** JSON with updated file metadata (no file binary).
- **400:** Invalid input (e.g. empty file_title, temporal_to ≤ temporal_from).
- **401:** Not authenticated.
- **403:** Not a dataset owner — `"Only a dataset owner can edit."`
- **404:** File not found.
- **500:** Internal error.

---

## 4. Authorization: Creator and Owners

- **Source of identity:** Session cookie (e.g. `settings.COOKIE_NAME`). The `get_current_active_user` dependency (in both dataset and upload routers) reads the cookie, validates it (e.g. via Redis), loads the `User`, and ensures the user is active. No API key is required for edit; the cookie identifies the user.
- **Validator:** `DatasetService.can_edit_or_add_file` — true for the dataset creator or any row in `dataset_owners`.
- **Edit dataset / edit file:** 403 if the user is not creator or owner.

---

## 5. Frontend: DatasetInfo Page

- **Page:** `src/web/src/pages/DatasetInfo.jsx`.
- **Route:** `/dataset-info` (e.g. `/dataset-info?dataset_id=...`).
- **Endpoints:** `edit_dataset_endpoint` = `/api/edit_dataset`, `edit_file_endpoint` = `/api/edit_file` in `src/web/src/api/endpoints.js`.

### 5.1 Dataset Edit

- **Entry:** “Edit” button with pencil icon (`bi-pencil`) to the right of the “Dataset Information” heading and to the left of the “Delete” button. Styling: primary blue (#0d6efd by default, #0b5ed7 on hover per design; implemented via `btn btn-primary`).
- **Modal:** On click, a modal opens with form:
  - **Dataset Title (required):** Text input, prepopulated with `dataset_title`.
  - **Dataset Description:** Text area, prepopulated with `dataset_description`.
  - **Availability:** Dropdown Public / Private / Organization / Admins / Owners from `dataset.availability`.
  - **Tags (keywords separated by comma) (required):** Text input, prepopulated with `dataset.tags` joined by `", "`.
  - **Submit** and **Cancel** buttons; Submit sends PUT to `edit_dataset_endpoint`.

- **Tag processing on submit:** From the tags text box: split by `","`, strip each part, drop empty, replace internal spaces with `"-"` (no lowercase in frontend; backend normalizes). Sent as `tags` array. At least one tag required (client-side).
- **Request:** PUT, `Content-Type: application/json`, body: `{ dataset_id, dataset_title, dataset_description, availability, tags }`. Credentials included (cookies).
- **After success:** Modal closes and `fetchDatasetInfo()` runs to refresh dataset and files.

### 5.2 File Edit

- **Entry:** On each file card, a pencil button between the “Download” and “Delete” (trash) buttons; same primary styling (`btn btn-sm btn-primary`), icon `bi-pencil`.
- **Modal:** On click, a modal opens with form:
  - **File Title (required):** Prepopulated with `file_title`.
  - **File Description, Provenance, Source, Cite As:** Text inputs/areas, prepopulated.
  - **Groundtruthed:** Radio “No” / “Yes” from `groundtruthed` (false → No, true → Yes).
  - **Permissions:** Dropdown with the seven CC options above; preselected from `file.permissions` or `"CC0: Public Domain"`.
  - **Duration:** Number input, prepopulated with `duration`.
  - **Temporal Coverage From / To:** `datetime-local` inputs; prepopulated from `temporal_from` / `temporal_to` (formatted with `formatToDatetimeLocal`).
  - **Geographical Extent:** Text area, prepopulated with `geography`.
  - **Submit** and **Cancel**; Submit sends PUT to `edit_file_endpoint`.

- **Request:** PUT, JSON body with `file_id`, `file_title`, `file_description`, `provenance`, `source`, `cite_as`, `groundtruthed`, `permissions`, `duration`, `temporal_from` (ISO string or null), `temporal_to` (ISO string or null), `geography`. Client validates temporal From < To when both set.
- **After success:** Modal closes and `fetchDatasetInfo()` runs.

### 5.3 State and Accessibility

- Dataset edit state: `datasetEdit` reducer (showModal, title, description, isPrivate, tags, error, submitting); focus and Escape/focus trap in modal.
- File edit state: `fileEdit` reducer (showModal, file, and all form fields, error, submitting).
- Modals use appropriate labels and ARIA where applicable (e.g. `aria-label="Edit dataset"` / `"Edit file"`).

---

## 6. End-to-End Flows

### 6.1 Edit Dataset

1. User opens Dataset Info page for a dataset (creator).
2. User clicks “Edit” → dataset edit modal opens with current title, description, availability, tags.
3. User changes fields and clicks Submit.
4. Frontend builds `tags` array (split by comma, strip, replace spaces with `-`), validates title and at least one tag, sends PUT `/api/edit_dataset` with JSON body and cookies.
5. API resolves user from session; checks dataset exists; checks `check_if_dataset_creator_by_id` → 403 if not creator.
6. Service updates `datasets` row and replaces `tag_dataset`/`tags` as described; controller clears Redis key `dataset:{dataset_id}` if present before returning success response.
7. API returns 200 with updated dataset JSON; frontend closes modal and refreshes dataset info.

### 6.2 Edit File

1. User on Dataset Info page clicks pencil on a file card.
2. File edit modal opens with current file metadata (including permissions dropdown and value dropdown).
3. User changes fields and clicks Submit.
4. Frontend validates title and temporal range, sends PUT `/api/edit_file` with JSON body and cookies.
5. API resolves user; loads file by `file_id`, gets `dataset_id`; checks `check_if_dataset_creator_by_id(user.id, dataset_id)` → 403 if not creator.
6. Controller sanitizes/validates and updates the file row; clears Redis key `dataset:{dataset_id}` if present; returns 200 with updated file JSON.
7. Frontend closes modal and refreshes dataset info (so file list and file cards reflect changes).
