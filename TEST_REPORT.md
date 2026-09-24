# TEST_REPORT.md — WELL Labs Open Data Portal

QA and security audit of the `open-data-portal` repository (branch `gurleen's-branch`, latest commit `50df524` "0.0.8 - Add file preview").

Prepared: September 22, 2026. Testing was performed without modifying production code, in line with the audit brief.

---

## 1. Executive summary

The Open Data Portal is a full-stack application: a FastAPI (Python 3.13) backend with PostgreSQL, Redis, Celery workers, Typesense search, AWS S3 storage, and DuckDB visualization, paired with a React (Create React App) frontend served through nginx. The backend exposes 43 routes across authentication, datasets, uploads, organizations, search, tags, stats, users, and visualization.

The application is in good shape from a security standpoint. The authorization model is the strongest part of the codebase: a single dataset-visibility model is implemented consistently in three places and is enforced on every dataset, file, download, and visualization path that was reviewed. Admin actions verify both role and organization membership, with last-admin protection. SQL access is parameterized, and the DuckDB visualization layer defends against injection with an identifier allow-list, credential escaping, and a whitelist of aggregation functions.

The main weakness is test coverage. The **backend has zero automated tests** despite carrying more than 13,000 lines of security-critical logic. The **frontend has 6 test files (30 tests, all passing) covering roughly 17 per cent of statements**. No confirmed production-breaking bug was found during this audit. The findings below are dominated by coverage gaps, dead code, and configuration hygiene rather than exploitable defects.

Because the local audit environment has no PostgreSQL, Redis, Typesense, or Docker available, database-dependent endpoints could not be exercised live. Every finding is therefore labelled as either **dynamically confirmed** (observed at runtime through a live test client or the Jest suite) or **static** (identified by code review and pending runtime confirmation).

Severity summary: 0 Critical, 0 High, 1 Medium, 3 Low, 5 Informational.

---

## 2. Test environment

| Item | Value |
|------|-------|
| Repository | `open-data-portal`, branch `gurleen's-branch`, commit `50df524` |
| Backend | FastAPI 0.141.1, Python 3.13 target (project pins `>=3.13`) |
| Frontend | React 18 / Create React App (`react-scripts test`, Jest) |
| Runtime available in audit | Node 22.23, npm, system Python 3.10, `uv` |
| Runtime NOT available | Docker, PostgreSQL, Redis, Typesense, project `.venv` (built on macOS, unusable in the Linux test VM) |
| Backend test env built for audit | Fresh `uv` virtualenv (Python 3.13.15) with `brevo-python==1.2.0` pinned to match `uv.lock` |

Two environment notes worth recording. First, the committed `src/api/.venv` was created on macOS and its `python` symlink does not resolve in the Linux VM, so a throwaway virtualenv was built for import and route testing. Second, `brevo-python` resolves to 5.x by default (which renames the import module from `brevo_python` to `brevo`); the project lockfile correctly pins 1.2.0, so this was only an audit-setup detail, not a project defect.

---

## 3. Commands executed

Frontend, run from `src/web`:

```bash
CI=true npx react-scripts test --watchAll=false --runInBand
CI=true npx react-scripts test --watchAll=false --coverage --coverageReporters=text-summary
```

Backend, run from `src/api` (audit virtualenv at `/tmp/odpvenv`):

```bash
python3 -m compileall -q routers services models schemas utils middleware core db tasks main.py \
  celery_worker.py celery_cpu_worker.py flower_entry.py     # syntax check, exit 0

# App import + full route enumeration + live no-DB endpoint tests via Starlette TestClient
# (dummy env vars supplied so config loads; real .env values were not printed)
/tmp/odpvenv/bin/python  <harness that imports main.app, lists app.openapi() paths,
                          and issues requests to /health, /branding, /auth/login-options,
                          /auth/signin, /auth/signup with base_url=http://localhost>
```

Repository hygiene checks:

```bash
git ls-files | grep -iE '\.env$|privkey|fullchain|\.pem$'   # tracked-secret scan
openssl x509 -in src/web/nginx/fullchain.pem -noout -subject -issuer -dates
```

---

## 4. Tests passed

**Frontend Jest suite: 6 suites, 30 tests, all passing.**

```
PASS src/pages/__tests__/dashboard.test.js
PASS src/pages/__tests__/datasets.test.js
PASS src/pages/__tests__/signup.test.js
PASS src/pages/__tests__/signin.test.js
PASS src/pages/__tests__/orgsearch.test.js
PASS src/App.test.js
Tests: 30 passed, 30 total   Time: ~5 s
```

**Backend syntax / import: passed.** All modules byte-compile cleanly, and `main.app` imports without error once dependencies are present. All 43 routes materialize correctly.

**Backend live endpoint smoke tests (dynamically confirmed, no database needed):**

| Request | Result | Verdict |
|---------|--------|---------|
| `GET /health` | `200 {"status":"healthy","version":"1.0.0"}` | Correct |
| `GET /branding` | `200` with host/product/brand payload | Correct |
| `GET /auth/login-options` | `200` with google/domain flags | Correct |
| Security headers on any response | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; script-src 'none'; ...`, `Strict-Transport-Security`, `Referrer-Policy` all present | Correct |
| `GET /nope` | `404 {"detail":"Not Found"}` | Correct |
| `DELETE /health` | `405 {"detail":"Method Not Allowed"}` | Correct |
| `POST /auth/signup` with `{}` | `422` field-required list | Correct |
| `POST /auth/signup` with invalid email | `422` email validation error | Correct |
| `GET /health` with `Host: testserver` | `400 Invalid host header` | Correct (TrustedHost middleware working) |

---

## 5. Tests failed

No test failed. The existing frontend suite is green, and every backend endpoint reachable without a database behaved as specified.

The only unexpected runtime observation was a status-code nuance, recorded as Finding 3 below rather than a failure: form fields submitted as empty strings are rejected by FastAPI as `422` before the controller's own `400` validation branch can run.

---

## 6. Confirmed findings

Severity is assigned with an explicit rationale, not by intuition.

### Finding 1 — Committed TLS private key — LOW (static, verified)

**Files:** `src/web/nginx/privkey.pem`, `src/web/nginx/fullchain.pem` (both tracked in git).

A PEM private key (`-----BEGIN PRIVATE KEY-----`, 52 lines) is committed to the repository. Inspection of the accompanying public certificate shows it is a **self-signed development certificate**: `subject=CN=localhost`, `issuer=CN=localhost`, valid `Mar 31 2023` to `Mar 30 2024` (already expired).

**Why LOW and not HIGH:** the key is self-signed for `localhost`, is expired, and is not the production key for `data.welllabs.org` (the README shows production certificates are issued separately by certbot and copied to `/home/ubuntu/.ssl-certs/` on the server). It therefore grants no access to production. It is not INFORMATIONAL because committing any private key is poor practice, and the risk is structural: these two files are **explicitly tracked**, and `.gitignore` only excludes `.env`, so a future operator who overwrites `privkey.pem` with a real certificate would commit the production key without any safety net.

**Recommended fix:** `git rm --cached src/web/nginx/privkey.pem src/web/nginx/fullchain.pem`, add `*.pem` to `.gitignore`, mount certificates at runtime (as `docker-compose.prod.yml` and `copy-ssl-certs.sh` already arrange), and rotate the key if it was ever reused anywhere real.

### Finding 2 — Zero backend test coverage — MEDIUM (coverage gap)

**Scope:** the entire `src/api` tree (about 13,200 lines across routers, services, and models) has no test suite. `pyproject.toml` declares no test dependency, and there is no `pytest.ini`, `conftest.py`, or `tests/` directory.

**Why MEDIUM:** this is not itself a runtime bug, so it is not High. It is above Low and Informational because the untested code is security-critical, and it contains a specific latent risk. The dataset-visibility rules exist in **three parallel implementations** that must agree:

- `viewer_can_see_dataset(...)` — Python predicate, `core/availability.py`
- `approved_dataset_visibility_clause(...)` — SQLAlchemy filter, same file
- `search_visibility_sql(...)` — hand-written SQL string, same file

These three are currently consistent (levels: 0 Public, 1 Private, 2 Organization, 3 Admins, 4 Owners, with superuser and creator overrides). Without tests, any future edit to one implementation can silently diverge from the others, which is precisely how an authorization gap gets introduced. See section 11 for a recommended test plan.

### Finding 3 — Unreachable input-validation branches, inconsistent status codes — LOW (dynamically confirmed)

**Files:** `routers/auth.py`, `AuthController.sign_in` and `AuthController.change_password`.

The controllers validate that email and password are non-empty and raise `400`. In practice, when a client submits an empty-string form field, FastAPI's `Form(...)` treats it as missing and returns `422` before the controller runs. Confirmed live:

```
POST /auth/signin  data email="" password="x"   -> 422 (missing email)   # not the intended 400 "Invalid email format"
POST /auth/signin  data email="a@b.com" pw=""    -> 422 (missing password) # not the intended 400 "Password is required"
```

**Why LOW:** no security or availability impact; both bad inputs are correctly rejected. The concern is dead code and an inconsistent contract (the API documents `400` for these cases but returns `422`), which matters for any client relying on the documented status. Either remove the now-unreachable branches or align the documented status codes.

### Finding 4 — Request logging middleware is a no-op — LOW (static, verified)

**File:** `middleware/security.py`, `RequestLoggingMiddleware`.

The class docstring states it exists "to log requests for security monitoring," but `dispatch` simply calls `await call_next(request)` and returns the response with no logging. There is no request logging where the code claims there is.

**Why LOW rather than Informational:** the gap is between documented security behaviour and actual behaviour. An operator reading the code could reasonably believe security-relevant request logging is in place when it is not. Either implement the logging (method, path, status, client, latency) or remove the middleware and its claim.

---

## 7. Possible issues requiring human review

These need a running database, production configuration, or product-owner judgement to resolve. They are not confirmed defects.

1. **Organization-level visibility with null organizations.** In `viewer_can_see_dataset`, availability level 2 (Organization) returns `viewer.organization == dataset_organization`. If a restricted dataset and a viewer both have a null or empty `organization`, the comparison is true and access is granted. This is safe only if the data model guarantees that datasets with restricted availability always carry a non-null organization. Confirm with a constraint or a test.

2. **Reset-password token validation fallback.** `reset_password_validate` in `routers/auth.py` includes a fallback JWT-decode path with a comment that it deliberately does not check the password fingerprint during validation. This is described as intentional (the actual reset endpoint checks it), but it should be confirmed that the real `POST /reset-password` enforces the fingerprint so that an old token cannot reset a password after a newer token was issued.

3. **Startup hard-dependency on Typesense.** The FastAPI `startup` event calls `ensure_collection()` and `ensure_tags_collection()`. If `TYPESENSE_HOST` is set but Typesense is unreachable at boot, the app may fail to start rather than degrading to PostgreSQL full-text search. Worth a resilience test with Typesense down.

4. **Uploaded content is not validated server-side.** The presigned PUT sets `ContentType` from the filename extension only (`mimetypes.guess_type`), so a user can store arbitrary bytes under a benign extension. Impact is limited because objects are served from the S3 bucket origin, not the application origin, so stored HTML or JavaScript would not execute in the app's security context. As defence in depth, confirm downloads default to `Content-Disposition: attachment` and that inline serving is never used with `text/html` for user-supplied files.

---

## 8. Security findings (review outcome)

The security review covered authentication, authorization, IDOR, injection, file upload and download, secrets, CORS, and headers. Alongside Finding 1 (committed dev key) and item 4 above, the following controls were examined and found to be **implemented correctly**. They are recorded so the audited surface is explicit.

**Authorization and IDOR — sound.** A single availability model is enforced everywhere it matters. `dataset_info` checks `viewer_can_see`, verification status, and unapproved-dataset access. Every file read, visualization query, and download routes through `UploadController._accessible_file_for_read`, which re-checks `viewer_can_see` before returning any S3 key or presigned URL. Admin user actions (`approve_user`, `reject_user`, `change_user_role`, `delete_user_by_admin`) verify `role == 1` at the router and re-check `target_user.organization == actor.organization` in the service, returning `403` on mismatch, with last-admin protection preventing an organization from deleting or demoting its final admin.

**SQL injection — mitigated.** `services/search.py` builds its full-text query with bound parameters (`:query`, `:tag_name_i`, `:organization_id`, and so on); f-strings only assemble placeholder names, never user values. The DuckDB visualization layer (`services/visualization.py`) validates column names against a strict regex allow-list and doubles embedded quotes (`quote_ident`), whitelists aggregation functions (`sum/avg/min/max/count`), casts and clamps `limit`/`offset` to integers, escapes S3 credentials before `SET`, and derives the source path from the stored `file_key` rather than direct user input.

**Upload safety — sound.** The upload key is `f"{user.id}/{sanitized_filename}"` where `sanitized_filename` is basename-stripped (`split("/")[-1].split("\\")[-1]`), so path traversal cannot escape the user's own prefix. Job ownership is verified (`job.creator == user.id`) and the size limit is enforced against `S3_UPLOAD_MAX_SIZE`.

**Secrets handling — sound (aside from Finding 1).** `.env` is gitignored and no `.env` file is tracked. Passwords use passlib bcrypt; session tokens use `secrets.token_urlsafe(32)`; API keys use `secrets.choice` with a database uniqueness check; the Google OAuth `state` is stored in Redis with a 600-second TTL and validated on callback. Verification and forgot-password endpoints return a uniform success message to avoid email enumeration.

**Transport and headers — sound.** Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (relaxed to `SAMEORIGIN` only for `/docs` and `/redoc`), a restrictive CSP with `script-src 'none'` on API responses, HSTS, and `Referrer-Policy`. `TrustedHostMiddleware` restricts the `Host` header to `localhost`, `127.0.0.1`, and `*.welllabs.org` (confirmed live: a foreign host yields `400`).

### Informational security observations

- **INFORMATIONAL — CORS origin list is localhost-only.** `main.py` hardcodes `allow_origins` to the four `localhost`/`127.0.0.1` variants with `allow_credentials=True`. This is safe today because the frontend calls the API same-origin through the nginx `/api` proxy, but any future browser client served from `data.welllabs.org` would be blocked. Make the origin list configurable per environment.
- **INFORMATIONAL — broad `*.txt` gitignore.** `.gitignore` excludes `*.txt` globally, which can silently drop legitimate fixtures or data files (for example test CSVs saved as `.txt`, or documentation). Narrow this pattern.
- **INFORMATIONAL — configuration typo shims.** `core/config.py` carries fallbacks for prior `.env` typos (`HOTS_NAME` for `HOST_NAME`, `UPLOAD_JOBS_BACKED` for `UPLOAD_JOBS_BACKEND`). These mask misconfiguration rather than surfacing it; consider removing them once the deployed `.env` files are corrected.

---

## 9. Test coverage gaps

**Backend: 0 per cent.** No unit, integration, or API tests exist. The highest-value untested areas, in priority order, are: the visibility model in `core/availability.py` (three implementations that must agree); the admin authorization paths in `services/user.py`; `UploadController._accessible_file_for_read`; upload key construction and size validation; the DuckDB `quote_ident` and aggregation whitelist; and the search query builder.

**Frontend: about 17 per cent of statements** (`Statements 16.79%`, `Branches 12.02%`, `Functions 17.64%`, `Lines 17.67%`). Six of the 26 page components are touched by tests. Untested areas of note include the dataset creation and edit flows (`CreateDataset.jsx`, `DatasetInfo.jsx`, `EditDataset`), the S3 upload client (`api/s3Upload.js`), the API layer (`api/endpoints.js`), the approvals and role-management screens (`Approvals.jsx`), password flows (`ChangePassword.jsx`, `ResetPassword.jsx`, `ForgotPassword.jsx`), search, and the visualization components under `components/visualize`.

---

## 10. Files changed

No production code, test, or configuration file was modified during this audit. The only artefact added is this report, `TEST_REPORT.md`, at the repository root. Byte-compiled `__pycache__` directories may have been produced by the syntax check; these are already gitignored patterns for the project and can be removed with `find src/api -name __pycache__ -type d -prune -exec rm -rf {} +` if desired.

---

## 11. Recommended next steps

1. **Stand up a backend test harness.** Add `pytest`, `pytest-asyncio`, and `httpx` as dev dependencies. Start with pure-function tests for `core/availability.py` that assert all three visibility implementations agree across every availability level and viewer type (anonymous, creator, same-organization member, same-organization admin, owner, superuser, outsider). These need no database and would immediately protect the most sensitive logic.

2. **Add API-level tests with a database.** Use the existing `docker-compose.dev.yml` (PostgreSQL 17, Redis, Typesense) to run integration tests against `TestClient`, covering sign-in and sign-up, dataset creation and approval, the download and visualization authorization paths (including cross-organization IDOR attempts that must return `403`), and the admin user-management endpoints.

3. **Remove the committed key (Finding 1)** and add `*.pem` to `.gitignore`.

4. **Resolve the status-code contract (Finding 3)** by either aligning documented codes to `422` or removing the unreachable `400` branches.

5. **Decide on the request-logging middleware (Finding 4):** implement real logging or delete the misleading no-op.

6. **Raise frontend coverage** on the create-dataset, upload, and approvals flows, which carry the most business logic and currently have none.

---

## 12. Reproduction reference

Frontend suite and coverage:

```bash
cd src/web
CI=true npx react-scripts test --watchAll=false --runInBand
CI=true npx react-scripts test --watchAll=false --coverage --coverageReporters=text-summary
```

Backend import, route listing, and live no-DB endpoint checks require a Linux-native Python 3.13 environment (the committed `.venv` is macOS-only). Build one with `uv`, pinning `brevo-python==1.2.0` to match `uv.lock`, then import `main:app` and drive it with Starlette's `TestClient` using `base_url="http://localhost"` so the TrustedHost middleware accepts the request. Supply placeholder values for the required settings (`POSTGRES_URL`, `REDIS_URL`, `S3_BUCKET`, `DOMAIN`, `SECRET`, `LONG_TOKEN_AGE_SECONDS`, the `EMAIL_*` keys, and `UPLOAD_JOBS_BACKEND`); creating the async engine does not open a connection, so no live database is needed to import the app or to exercise the endpoints that do not query the database.
