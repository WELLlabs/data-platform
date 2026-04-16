# Access control: approvals workflow

This document describes the **pending approvals**, **dataset approval**, **dataset creator transfer** (`/transfer_dataset`), and **organization member management** (role change / delete for verified users) features: API endpoints, service-layer queries, `/dataset_info` rules, Celery emails for user notifications, and the related frontend pages (`/approvals`, `/dataset-info`, `/organisation`). Routers live under `tags=["Users"]` for user management routes (see `src/api/main.py`) and dataset routes for `dataset_info` and `transfer_dataset`.

---

## Roles (summary)

- **0** — Regular user: cannot list pending approvals or approve users; may still **view** their own **unapproved** dataset via `/dataset_info` when they are the **creator** (see below).
- **1** — Organization admin: `GET /pending_approvals` returns **both** `datasets` and `users`; may **`PUT /approve_user/{user_id}`** or **`PUT /approve_user/{user_id}/{role}`** to approve a **pending** user (`users.verified == False`) and set **`users.role`** to **0** / **1** / **2** and **`users.verified = True`**; may **`DELETE /reject_user/{user_id}`** to reject and remove **only** a pending user in the same organization; may **`PUT /change_user_role/{user_id}/{role}`** to change the role of an **already verified** user in the same organization (does not gate on pending signup); may **`DELETE /delete_user/{user_id}`** to remove a user in the same organization (verified or not), subject to last-admin rules; may `PUT /approve_dataset/{dataset_id}` (subject to verification and service checks).
- **2** — Elevated role: `GET /pending_approvals` returns **`datasets` only** (no `users` key); may approve datasets (same endpoint as role 1), not users via `approve_user`.

**Dataset creator transfer** (`POST /transfer_dataset`) is restricted to **organization admins** (`role == 1`) in the **same organization** as the dataset; see [`DatasetService.transfer_dataset_creator`](src/api/services/dataset.py) and the section below.

Exact numeric roles are enforced in `UserController` in [`src/api/routers/user.py`](src/api/routers/user.py). **High role** (used inside `UserService.approve_dataset` and `privileges.approval`) is determined by `check_if_high_role_by_id` / `check_if_high_role_by_key` in [`src/api/services/user.py`](src/api/services/user.py).

---

## `GET /pending_approvals`

**Auth:** Session cookie (`get_current_active_user`).

**Implementation:** `UserController.get_pending_approvals` → [`src/api/routers/user.py`](src/api/routers/user.py).

### Preconditions

1. **`check_if_user_verified_by_id(user.id)`** must be **True**. If **False** → **403** with detail `email address verification and/or organization approval pending.`
2. **`user.role`** must be **1** or **2**. **Role 0** → **403** `Unauthorized to access pending approvals`. Any other role → **403** `Invalid role for pending approvals access`.

### Response shape

- **`role == 1`:** JSON object with **`datasets`** and **`users`** (both from the organization’s pending lists).
- **`role == 2`:** JSON object with **`datasets`** only (no **`users`** key).

```json
{
  "datasets": [ /* see get_pending_dataset_approvals */ ],
  "users": [ /* only when role == 1; see get_pending_user_approvals */ ]
}
```

### `get_pending_dataset_approvals(organization)` (`UserService`)

**File:** [`src/api/services/user.py`](src/api/services/user.py).

- **Query:** `datasets` joined to `users` on `Dataset.creator == User.id`, where `Dataset.organization == organization` and `Dataset.approved.is_(False)`.
- **Each element:**

| Field | Source |
|--------|--------|
| `dataset_id` | `datasets.dataset_id` |
| `creator` | `datasets.creator` |
| `creator_name` | `users.full_name` for creator |
| `dataset_title` | `datasets.dataset_title` |

- **Empty result:** `[]`.

### `get_pending_user_approvals(organization)` (`UserService`)

**File:** [`src/api/services/user.py`](src/api/services/user.py).

- **Query:** `users` where `organization == organization` and `verified.is_(False)`.
- **Each element:**

| Field | Source |
|--------|--------|
| `user_id` | `users.id` |
| `full_name` | `users.full_name` |
| `designation` | `users.designation` |
| `email` | `users.email` |

- **Empty result:** `[]`.

---

## `PUT /approve_user/{user_id}` and `PUT /approve_user/{user_id}/{role}`

**Auth:** Session cookie.

**Implementation:** `UserController.approve_user` → [`src/api/routers/user.py`](src/api/routers/user.py). Email: Celery task `email.send_user_approval_response` in [`src/api/tasks/email.py`](src/api/tasks/email.py), template id from **`USER_APPROVAL_RESPONSE_TEMPLATE_ID`** in [`src/api/core/config.py`](src/api/core/config.py).

### Rules

1. **`user_id`** path parameter must be a valid UUID; otherwise **400**.
2. **`check_if_user_verified_by_id(signed_in_user.id)`** must be **True**; else **403** `Verified account required`.
3. **`signed_in_user.role` must equal `1`**. Otherwise **403** `Unauthorized to approve users`.
4. The path segment **`{role}`** is passed to the service as **`assigned_role`**. **`assigned_role`** must be **`0`**, **`1`**, or **`2`**; otherwise **400** with detail **`assigned_role must be 0, 1, or 2`** (enforced in [`UserService.approve_user`](src/api/services/user.py)).
5. **Service** [`UserService.approve_user`](src/api/services/user.py): loads target user by id; **404** if missing; **403** if `target_user.organization != approver.organization`; sets **`users.verified = True`**, **`users.role = assigned_role`** (default **`0`** when using `PUT /approve_user/{user_id}` without **`{role}`**), commits.

### After success (router)

Queues **`send_user_approval_response`** with **`action`** = **`accepted`**, **`name`** = approver **`full_name`**, **`message`** describing Member / Admin / Reviewer permissions based on **`assigned_role`**, sent to the approved user’s **email**.

### Success response

```json
{
  "detail": "User approved successfully",
  "user_id": "<uuid>"
}
```

---

## `DELETE /reject_user/{user_id}`

**Auth:** Session cookie.

**Implementation:** `UserController.reject_user` → [`src/api/routers/user.py`](src/api/routers/user.py). Same Celery task and template id as approve (different **`action`** / **`message`**).

### Rules

1. **`user_id`** must be a valid UUID; otherwise **400**.
2. **`check_if_user_verified_by_id(signed_in_user.id)`** must be **True**; else **403** `Verified account required`.
3. **`signed_in_user.role` must equal `1`**; else **403** `Unauthorized to reject users`.
4. **Service** [`UserService.reject_user`](src/api/services/user.py): requires organization admin via **`check_if_organization_admin_by_id`** (**403** if not role **`1`**); **403** if approver targets their own **`users.id`**; loads target user; **404** if missing; **403** if organizations differ; **400** if **`users.verified`** is not **`False`** (user not pending); deletes **`user_contributions`** rows for that **`user_id`**, then deletes the **`users`** row, commits.

**Note:** **`datasets.creator`** → **`users.id`** uses **`ON DELETE CASCADE`**. Rejecting or deleting a user removes their **`users`** row and **also deletes any datasets** where that user is **`creator`**, including creators with **`role`** **`0`**. Before rejecting or deleting, verify whether the user owns datasets (or export / transfer **`Dataset`** ownership to another user); otherwise those datasets and dependent rows will be removed with the user.

### After successful commit (router)

Queues **`send_user_approval_response`** with **`action`** = **`rejected`**, fixed rejection **`message`**, approver **`full_name`**, to the removed user’s **email** captured before delete.

### Success response

```json
{
  "detail": "User rejected successfully"
}
```

---

## `PUT /change_user_role/{user_id}/{role}`

**Auth:** Session cookie.

**Implementation:** `UserController.change_user_role` → [`src/api/routers/user.py`](src/api/routers/user.py). Email: Celery task `email.send_user_approval_response` in [`src/api/tasks/email.py`](src/api/tasks/email.py) (`action` = **`updated`**).

### Rules

1. **`user_id`** path parameter must be a valid UUID; otherwise **400** `Invalid user_id UUID format`.
2. **`check_if_user_verified_by_id(signed_in_user.id)`** must be **True**; else **403** `Verified account required` (same as **`approve_user`** / **`reject_user`**).
3. **`signed_in_user.role` must equal `1`**. Otherwise **403** `Unauthorized to change user role`.
4. Path **`{role}`** must be an integer in **`0`**, **`1`**, or **`2`**; otherwise **400** `Role must be 0 (Member), 1 (Admin), or 2 (Reviewer)` (validated in the router before the service; the service also enforces **`assigned_role must be 0, 1, or 2`**).
5. **Service** [`UserService.change_user_role`](src/api/services/user.py): loads target user; **404** if missing; **403** if `target_user.organization != actor.organization`; if the actor changes **their own** role and the count of **`users.role == 1`** in that organization is **not greater than 1** (i.e. sole admin), **400** with detail **`Organization should have atleast one Admin`**; sets **`users.role`**, commits.

### After success (router)

Queues **`send_user_approval_response`** with **`action`** = **`updated`**, **`name`** = actor **`full_name`**, **`message`** = **`Your role has been updated to {Member|Admin|Reviewer}.`**, to the target user’s **email**.

### Success response

```json
{
  "detail": "User role updated successfully",
  "user_id": "<uuid>"
}
```

---

## `DELETE /delete_user/{user_id}`

**Auth:** Session cookie.

**Implementation:** `UserController.delete_user` → [`src/api/routers/user.py`](src/api/routers/user.py). Email: same Celery task (`action` = **`deleted`**).

### Rules

1. **`user_id`** must be a valid UUID; otherwise **400** `Invalid user_id UUID format`.
2. **`check_if_user_verified_by_id(signed_in_user.id)`** must be **True**; else **403** `Verified account required` (same as **`approve_user`** / **`reject_user`**).
3. **`signed_in_user.role` must equal `1`**; else **403** `Unauthorized to delete users`.
4. **`signed_in_user.is_active`** must be **True**; else **403** `Unauthorized to perform action: account disabled` (defense in depth; session dependency also requires an active account).
5. **Service** [`UserService.delete_user_by_admin`](src/api/services/user.py): loads target user; **404** if missing; **403** if organizations differ; if the actor deletes **their own** account and the org has **at most one** admin (`role == 1`), **400** **`Organization should have atleast one Admin`**; deletes **`user_contributions`** for that **`user_id`**, then deletes the **`users`** row, commits.

**Note:** Same **`datasets.creator`** cascade warning as **`DELETE /reject_user/{user_id}`** above: removing a user deletes datasets they created.

### After successful commit (router)

Queues **`send_user_approval_response`** with **`action`** = **`deleted`**, approver **`full_name`**, fixed message **`Your profile is removed from the data portal, please contact the admin of the organization.`**, to the removed user’s **email** captured before delete.

### Success response

```json
{
  "detail": "User deleted successfully",
  "user_id": "<uuid>"
}
```

---

## `PUT /approve_dataset/{dataset_id}`

**Auth:** Session cookie. **Redis:** `Depends(get_redis)` for cache invalidation after success.

**Implementation:** `UserController.approve_dataset` → [`src/api/routers/user.py`](src/api/routers/user.py).

### Rules (router)

1. **`dataset_id`** must be a valid UUID; otherwise **400**.
2. **`check_if_user_verified_by_id`** → **403** `Verified account required` if false.
3. **`signed_in_user.role` must be `1` or `2`**; else **403** `Unauthorized to approve datasets`.

### Rules (service) — [`UserService.approve_dataset`](src/api/services/user.py)

1. **`check_if_high_role_by_id(approver.id)`** must be **True**; else **403** `Unauthorized to approve datasets`.
2. Dataset must exist; else **404** `Dataset not found`.
3. **`check_user_belongs_to_dataset_organization_by_id(approver.id, dataset_id)`** must be **True**; else **403** `Unauthorized to approve datasets outside your organization`.
4. Sets **`datasets.approved = True`**, **`datasets.approved_by = approver.id`**, commits.

### After success (router)

Calls **`_invalidate_dataset_cache(dataset_id, redis, ...)`** from [`src/api/routers/dataset.py`](src/api/routers/dataset.py) so **`dataset:{dataset_id}`** is removed from the **session/auth Redis** used for dataset info cache when present.

### Success response

```json
{
  "detail": "Dataset approved successfully",
  "dataset_id": "<uuid>"
}
```

---

## `POST /transfer_dataset`

**Auth:** Session cookie only (`Depends(get_current_active_user)` from [`src/api/routers/upload.py`](src/api/routers/upload.py)). **Query parameters:** `dataset_id` (UUID), `user_id` (UUID of the user who will become the new **`datasets.creator`**).

**Implementation:** Route [`transfer_dataset`](src/api/routers/dataset.py) → `DatasetController.transfer_dataset` → [`DatasetService.transfer_dataset_creator`](src/api/services/dataset.py). **Redis:** after a successful transfer, **`_invalidate_dataset_cache(dataset_id, ...)`** removes **`dataset:{dataset_id}`** from the dataset info cache.

**Email:** Celery task **`email.send_dataset_transfer`** in [`src/api/tasks/email.py`](src/api/tasks/email.py). Template id from **`DATASET_TRANSFER_TEMPLATE_ID`** in [`src/api/core/config.py`](src/api/core/config.py). Brevo params: **`title`** (dataset title), **`new_creator`** (new creator **`full_name`**), **`admin_name`** (transferring admin **`full_name`**). One task per distinct recipient email: **previous creator** and **new creator**, deduplicated by email address (case-insensitive) so a single address receives at most one message.

### Rules (service)

1. Dataset must exist; else **404** `Dataset not found`.
2. **`admin_user.role` must equal `1`**; else **403** `Unauthorized to transfer dataset`.
3. **`admin_user.organization` must equal `dataset.organization`**; else **403** `Unauthorized to transfer dataset`.
4. Target user must exist; else **404** `User not found`.
5. **`target_user.organization` must equal `dataset.organization`**; else **403** `Unauthorized to transfer dataset`.
6. Emails are queued (when addresses are present); **`datasets.creator`** is set to **`user_id`**, then **commit**.

### Success response

```json
{
  "dataset_id": "<uuid>",
  "creator": "<uuid>",
  "detail": "Dataset transferred successfully"
}
```

### Errors

- **401** — Missing or invalid session (from `get_current_active_user`).
- **403** / **404** — As above.
- **500** — Unexpected failure with detail `Error transferring dataset`.

---

## `GET /dataset_info` — approval-related behavior

**Files:** Route handler [`src/api/routers/dataset.py`](src/api/routers/dataset.py) (`dataset_info`), payload builder `DatasetController.get_dataset_info`, helper **`_compute_privileges`**.

### Response additions

1. **`dataset.approver_name`**  
   If `dataset.approved_by` is set, the API loads **`users.full_name`** for that user id and returns it as **`approver_name`** (or `null` if the user row is missing).

2. **`privileges.approval`** (boolean)  
   Computed in **`_compute_privileges`** only when the dataset is **not** approved (`approved == False`):

   - **Session:** `belongs_to_org = check_user_belongs_to_organization_by_id(user_id, dataset_organization)` and `has_high_role = check_if_high_role_by_id(user_id)` → **`approval = belongs_to_org and has_high_role`**.
   - **API key:** same pattern with **`check_user_belongs_to_organization_by_key`** and **`check_if_high_role_by_key`**.

   If the dataset is already approved, **`approval`** stays **false** (no pending approval action).

   So **`privileges.approval`** means: *signed-in user can approve this dataset* (same organization **and** high role), not high role alone.

3. **`privileges.transfer`** (boolean)  
   **`transfer = dataset.approved AND is_org_admin`**, where **`is_org_admin`** is:

   - **Session:** `check_if_admin_by_id(dataset_organization, user_id)` (**`role == 1`** and same organization).
   - **API key:** `check_if_admin_by_key(dataset_organization, apikey)` when there is no session user (same semantics).

   Session is evaluated **before** API key when both are present (consistent with creator / approval branches and with **`check_dataset_permission`** in [`DatasetService`](src/api/services/dataset.py)). **`transfer`** is only useful for **approved** datasets: admins use it to move **`datasets.creator`** to another member via **`POST /transfer_dataset`** (see above).

### Unapproved dataset access (before cache / full payload)

Evaluated **after** private-dataset checks, **before** returning cached or freshly built payload.

For **`approved == False`**, access is allowed if **either**:

- **Creator path:** the caller is the **dataset creator** (session: `check_if_dataset_creator_by_id`; API key: `check_if_dataset_creator_by_key`) — **including creators with `role == 0`**; or  
- **Org admin path:** caller belongs to the **dataset’s organization** **and** has **high role** (same helpers as for `privileges.approval`).

If neither holds and there is no valid session/API key path for the above → **403** JSON:

```json
{ "detail": "Dataset is still pending approval." }
```

**Approved datasets** follow the normal public/private rules without this gate.

---

## Frontend

### Endpoints ([`src/web/src/api/endpoints.js`](src/web/src/api/endpoints.js))

| Constant | Path |
|----------|------|
| `pending_approvals_endpoint` | `/api/pending_approvals` |
| `approve_user_endpoint(userId, role)` | `/api/approve_user/{userId}/{role}` |
| `reject_user_endpoint(userId)` | `/api/reject_user/{userId}` |
| `change_user_role_endpoint(userId, role)` | `/api/change_user_role/{userId}/{role}` (**PUT**) |
| `delete_user_endpoint(userId)` | `/api/delete_user/{userId}` (**DELETE**) |
| `approve_dataset_endpoint(datasetId)` | `/api/approve_dataset/{datasetId}` |
| `transfer_dataset_endpoint` | `/api/transfer_dataset` (**POST**; query `dataset_id`, `user_id`) |

### `/approvals` ([`src/web/src/pages/Approvals.jsx`](src/web/src/pages/Approvals.jsx))

- **Route:** `/approvals` (see [`App.js`](src/web/src/App.js)).
- On load: **`GET`** `pending_approvals_endpoint` with **`credentials: "include"`**.
- If the JSON has a **`users`** key: section **“User Approvals”**, borderless table: columns **User**, **Email**, **Designation**, **Action**. **View** opens a modal with the row’s **User**, **Email**, and **Designation**, a **Role** dropdown (**Member** = 0, **Admin** = 1, **Reviewer** = 2, default Member), and **Approve** / **Reject** buttons. **Approve** sends **`PUT`** `approve_user_endpoint(user_id, role)` with **`credentials: "include"`**. **Reject** sends **`DELETE`** `reject_user_endpoint(user_id)`. On success, the list is refetched.
- If the JSON has a **`datasets`** key: section **“Dataset Approvals”**, columns **Title**, **Creator**, **Action**; **View** navigates to **`/dataset-info?dataset_id=...`**.
- If neither key is present and no error: informational message that no pending approvals were found.

### `SiteNavbar` — “Approvals” link ([`src/web/src/components/SiteNavbar.jsx`](src/web/src/components/SiteNavbar.jsx))

- Rendered only when **`Number(user?.role) > 0`**.
- Links to **`/approvals`**.

### `/dataset-info` ([`src/web/src/pages/DatasetInfo.jsx`](src/web/src/pages/DatasetInfo.jsx))

- **Query:** `dataset_id` (required); optional `apikey` from auth context for API-key requests.
- **`privileges.transfer`:** When **true**, shows a **Transfer** button in the header row (**to the left of** **Approve** when both apply), same blue styling **`#0d6efd` / hover `#0b5ed7`**. Click opens a modal: **`GET`** `organization_by_id_endpoint(dataset.organization)` (with optional **`apikey`** query for parity with **`dataset_info`**), **`members`** dropdown by **`full_name`**, read-only **Name** / **Email** / **Designation** / **Role**, then **Submit** → **`POST`** `transfer_dataset_endpoint?dataset_id=…&user_id=…` with **`credentials: "include"`** → refetch dataset info on success.
- **`privileges.approval`:** When **true**, shows an **Approve** button in the header row next to **“Dataset Information”** (to the left of **Edit** when **Transfer** is not shown, otherwise after **Transfer**), styled with **`#0d6efd` / hover `#0b5ed7`**. Click → confirm → **`PUT`** `approve_dataset_endpoint(dataset.dataset_id)` → reload on success.
- **`dataset.approver_name` / `dataset.approved_by`:** When **`approved_by`** is set, shows **“Approved By”** with a **Link** to **`/profile?id={approved_by}`** and label **`approver_name`** (fallback to raw id).

### `/organisation` ([`src/web/src/pages/Organization.jsx`](src/web/src/pages/Organization.jsx))

- **Route:** `/organisation` (query `id` optional; defaults to the signed-in user’s organization when omitted).
- When the signed-in user is an **organization admin** (`role === 1` and `user.organization` matches the page **organization id**), an **Edit** button appears to the right of the **Members** heading.
- **Edit** opens a modal: **Select** dropdown (members from **`GET`** organization-by-id **`members`** array), read-only **Name**, **Email**, **Designation**, **Role** dropdown (0 / 1 / 2).
- If the selected member has **`verified === false`**: **Approve** (**`PUT`** `approve_user_endpoint(user_id, role)`) and **Reject** (**`DELETE`** `reject_user_endpoint(user_id)`) with **`credentials: "include"`**.
- If **`verified === true`**: **Change** (**`PUT`** `change_user_role_endpoint(user_id, role)`) and **Delete** (**`DELETE`** `delete_user_endpoint(user_id)`).
- On success, organization data is refetched; **Reject** / **Delete** close the modal.

---

## Related source files

| Area | Path |
|------|------|
| User routes (pending approvals, approve/reject user, change role, delete user, approve dataset) | [`src/api/routers/user.py`](src/api/routers/user.py) |
| Pending lists, approve user/dataset, reject user, change role, delete user | [`src/api/services/user.py`](src/api/services/user.py) |
| Celery email tasks (user approval response, **`email.send_dataset_transfer`**, etc.) | [`src/api/tasks/email.py`](src/api/tasks/email.py) |
| Email template id settings | [`src/api/core/config.py`](src/api/core/config.py) |
| Dataset info, privileges, cache invalidation, **`POST /transfer_dataset`** | [`src/api/routers/dataset.py`](src/api/routers/dataset.py) |
| Transfer creator, `check_dataset_permission` (session-first vs apikey) | [`src/api/services/dataset.py`](src/api/services/dataset.py) |
| Approvals page | [`src/web/src/pages/Approvals.jsx`](src/web/src/pages/Approvals.jsx) |
| Organization page / members modal | [`src/web/src/pages/Organization.jsx`](src/web/src/pages/Organization.jsx) |
| Dataset detail / approve & transfer UI | [`src/web/src/pages/DatasetInfo.jsx`](src/web/src/pages/DatasetInfo.jsx) |
| Nav link | [`src/web/src/components/SiteNavbar.jsx`](src/web/src/components/SiteNavbar.jsx) |
