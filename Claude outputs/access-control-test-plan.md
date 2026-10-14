# Access Control and Permissions: Test Plan and Matrix

Open Data Portal (WELL Labs) — backend API test plan for roles, dataset availability, verification, and the associated modules.

Prepared: September 13, 2026. Scope: `src/api` FastAPI backend. This plan was written against the actual implementation, not the specification alone, so each expected result cites the code path that enforces it. Where the code and the pasted specification disagree, the difference is recorded in the Findings section rather than silently resolved.

---

## 1. How to use this document

Each test case has a stable identifier (for example VIEW-12), a precondition, an action expressed as the real API endpoint, and an expected result grounded in the enforcing function. A tester (manual or automated) sets up the fixtures in section 3, then works through the matrices in sections 5 to 12. The Findings in section 13 are the cases most likely to fail against the current build, so they deserve attention first.

The matrices give the full cross product the request asked for: every role, against every availability level, in both the approved and unapproved states, for each capability.

Legend for expected outcomes: **Allow** means the action succeeds (HTTP 200 or 201). **Deny** means it is refused (HTTP 401, 403, 404, or 409 as noted). A parenthetical such as (403) states the precise status the code returns.

---

## 2. System model as implemented

### 2.1 Roles

The role lives in `users.role` (integer), except the super user, which is the boolean `users.is_superuser`.

| Role | Column | Value | Notes |
|---|---|---|---|
| Super User | `is_superuser` | true | Cross organisation view and delete. Bypasses organisation scoping. |
| Admin | `role` | 1 | Approves members, approves datasets, manages roles. |
| Reviewer | `role` | 2 | Approves and rejects datasets only. |
| Member | `role` | 0 | Uploads, and manages datasets they created or own. |
| Anonymous | not signed in | n/a | Public datasets only. |

`check_if_high_role_by_id` returns true for `role > 0`, so it covers both Admin and Reviewer. `check_if_admin_by_id` requires `role == 1` and an organisation match. The verified check requires both flags, `user.verified and user.is_verified`.

### 2.2 Availability

Availability is stored per dataset in `datasets.availability`, enforced at the dataset level rather than the file level (`core/availability.py`).

| Availability | Value | Intended audience (per specification) |
|---|---|---|
| Public | 0 | Anyone, including anonymous users. |
| Private | 1 | Any signed-in user. **See Finding F1: the code does not implement this.** |
| Organization | 2 | Users of the dataset's organisation. |
| Admins | 3 | Owners, and admins (role 1) of the dataset's organisation. |
| Owners | 4 | Owners of the dataset only. |

`clamp_availability_for_org` forces any restricted level (1 to 4) down to Public (0) when the organisation is not private. `parse_availability` coerces anything out of range, `None`, or non-numeric input to Public (0), and coerces boolean `True` to Organization (2).

### 2.3 The three-check model

For a request to view or manage a dataset, the specification requires three checks: the user is verified, the user has the required role, and the dataset availability permits it. The implementation applies these in `GET /dataset_info` in this order:

First, `viewer_can_see` (the availability plus role gate). Second, for any restricted dataset (availability not 0), the requester must be verified unless they are a super user. Third, for an unapproved dataset, only the creator, a dataset owner, or a high-role user (role 1 or 2) belonging to the dataset's organisation may view it.

Note that `GET /download_url` applies only the first check. This asymmetry is Finding F2.

### 2.4 Endpoint map

| Capability | Endpoint | Enforcing function |
|---|---|---|
| View dataset metadata | `GET /dataset_info` | `viewer_can_see` + verified gate + unapproved gate |
| Download file | `GET /download_url` | `viewer_can_see` only |
| List datasets | `GET /datasets`, `GET /user_datasets` | `approved_dataset_visibility_clause` (approved only) |
| Search | search router | `search_visibility_sql` |
| Create dataset | `POST /create_dataset` | authenticated, profile complete; `clamp_availability_for_org` |
| Edit dataset | `PUT /edit_dataset` | `can_edit_or_add_file` (creator or owner) |
| Edit file metadata | `PUT /edit_file` | `can_edit_or_add_file` |
| Add file | `POST /add_file` | job creator, or `can_edit_or_add_file` |
| Delete file | `DELETE /delete_file` | `check_dataset_permission` + last-file guard |
| Delete dataset | `DELETE /delete_dataset` | `check_dataset_permission` |
| Add or remove owner | `POST` / `DELETE /dataset_owners` | `_can_manage_owners` |
| Approve or reject dataset | `PUT /approve_dataset`, `DELETE /reject_dataset` | verified + high role + organisation match |
| Approve or reject member | `PUT /approve_user`, `DELETE /reject_user` | verified + admin (role 1) |
| Change member role | `PUT /change_user_role` | verified + admin |
| Delete member | `DELETE /delete_user` | verified + admin |

`can_edit_or_add_file` grants the dataset creator or a dataset owner. `check_dataset_permission` grants the creator, an owner, an organisation admin (role 1, same organisation), or a super user. Reviewers are excluded from both of these helpers by design, which matters for Findings F3 and F4.

---

## 3. Test fixtures

Create one organisation that is private (call it Org A, `private = true`) and one that is not private (Org B, `private = false`). Create a second private organisation (Org C) for cross-organisation tests. Seed the following users, each with a complete profile (full name and organisation set) unless stated otherwise.

| Fixture | Role | Organisation | Verified | Notes |
|---|---|---|---|---|
| ANON | none | n/a | n/a | Not signed in. |
| CREATOR | Member (0) | Org A | yes | Creates the datasets under test. |
| OWNER | Member (0) | Org A | yes | Added as a dataset owner, not the creator. |
| M_SAME | Member (0) | Org A | yes | Same organisation, not owner, not creator. |
| M_UNVERIF | Member (0) | Org A | no | Same organisation, unverified. |
| M_INCOMPLETE | Member (0) | Org A | yes | Profile incomplete (no organisation or name). |
| R_SAME | Reviewer (2) | Org A | yes | Same organisation reviewer. |
| A_SAME | Admin (1) | Org A | yes | Same organisation admin. |
| M_OTHER | Member (0) | Org C | yes | Different organisation. |
| R_OTHER | Reviewer (2) | Org C | yes | Different organisation reviewer. |
| A_OTHER | Admin (1) | Org C | yes | Different organisation admin. |
| SU | Super User | any | yes | `is_superuser = true`. |

For each availability level 0 to 4, create a dataset owned by CREATOR in Org A, in both an approved and an unapproved copy. Owners are added through `POST /dataset_owners`; note that a target owner must belong to the dataset's organisation unless the actor is a super user, so OWNER must be in Org A.

Restricted availability (1 to 4) can only be set for datasets in a private organisation, so all restricted datasets under test live in Org A (private). Attempts to set restricted availability in Org B are covered in section 6.

---

## 4. Authentication and session preconditions

| ID | Precondition | Action | Expected |
|---|---|---|---|
| AUTH-1 | ANON | `POST /create_dataset` | Deny (401). `get_current_active_user` requires a session. |
| AUTH-2 | Valid session, expired token | `POST /add_file` | Deny (401). |
| AUTH-3 | M_INCOMPLETE | `POST /create_dataset` | Deny (403), "Complete your profile before continuing". |
| AUTH-4 | Inactive user (`is_active = false`) | any authenticated endpoint | Deny (403 on upload path, treated as None on optional-auth paths). |
| AUTH-5 | Valid `X-API-Key` header, no cookie | `GET /download_url` | Allow if availability permits. Script auth resolves the user from the key. |
| AUTH-6 | API key supplied as a query parameter, not header | any | Deny. `optional_api_key` reads the header only. |

---

## 5. View and download matrix (the availability cross product)

This is the core cross product. The expected column is the result of `viewer_can_see` for `GET /download_url`. For `GET /dataset_info` the same result applies for approved datasets, with the two extra gates noted below the table.

Approved dataset, `GET /download_url` (and `GET /dataset_info`, approved):

| Viewer | Public (0) | Private (1) | Organization (2) | Admins (3) | Owners (4) |
|---|---|---|---|---|---|
| ANON | Allow | Deny | Deny | Deny | Deny |
| CREATOR | Allow | Allow | Allow | Allow | Allow |
| OWNER (same org) | Allow | **Deny (F1)** | Allow | Allow | Allow |
| M_SAME | Allow | **Deny (F1)** | Allow | Deny | Deny |
| M_OTHER | Allow | Deny | Deny | Deny | Deny |
| R_SAME | Allow | **Deny (F1)** | Allow | Deny | Deny |
| A_SAME | Allow | **Deny (F1)** | Allow | Allow | Deny |
| A_OTHER | Allow | Deny | Deny | Deny | Deny |
| SU | Allow | Allow | Allow | Allow | Allow |

Derivation notes. For Admins (3), a viewer is allowed if they are a dataset owner, or if they are in the dataset's organisation with role 1. A_SAME is therefore allowed at level 3; R_SAME and M_SAME are not. OWNER is allowed at levels 3 and 4 because ownership is checked first. Every non-creator, non-super-user viewer is denied at Private (1); this is the point of Finding F1, because the specification says Private should be visible to any signed-in user.

Additional gates for `GET /dataset_info` only:

| ID | Precondition | Expected | Reason |
|---|---|---|---|
| VIEW-V1 | M_UNVERIF, approved Organization (2) dataset, same org | Deny (403), restricted-dataset message | Restricted view requires a verified account. |
| VIEW-V2 | M_UNVERIF, approved Public (0) dataset | Allow | Public datasets skip the verified gate. |
| VIEW-V3 | SU, any restricted dataset, super user unverified | Allow | Super user bypasses the verified gate. |

Unapproved dataset, `GET /dataset_info` (the unapproved gate applies after the two gates above):

| Viewer | Expected for any availability |
|---|---|
| CREATOR | Allow |
| OWNER | Allow |
| A_SAME | Allow (high role, same org) |
| R_SAME | Allow (high role, same org) |
| M_SAME | Deny (403) |
| M_OTHER, A_OTHER, R_OTHER | Deny (403) |
| ANON | Deny (403) |
| SU | Allow |

Download of a file in an unapproved dataset, `GET /download_url`: the approval state is not checked, so the result follows the approved-dataset download table above. This divergence from `dataset_info` is Finding F2. Test DL-U1: M_SAME requests `download_url` for a file in an unapproved Organization (2) dataset in Org A, expected Allow by the current code, even though M_SAME cannot see that dataset in `dataset_info`.

---

## 6. Create dataset and availability clamping

| ID | Precondition | Action | Expected |
|---|---|---|---|
| CREATE-1 | CREATOR (Org A, private) | create with availability 3 | Allow, stored as 3. |
| CREATE-2 | Member of Org B (not private) | create with availability 2 | Allow, but stored as 0 (clamped to Public). |
| CREATE-3 | CREATOR | create with availability 9 (out of range) | Allow, stored as 0. |
| CREATE-4 | CREATOR | create with availability `true` (boolean) | Stored as 2 (Organization). |
| CREATE-5 | CREATOR | create with availability omitted | Stored as 0 (default). |
| CREATE-6 | New dataset created | inspect owners | Creator is seeded as an owner (`seed_creator_as_owner`). |
| CREATE-7 | New dataset created | inspect approval | `approved = false` by default; not visible in listings until approved. |

---

## 7. Edit dataset and edit file metadata

Both endpoints use `can_edit_or_add_file`, which grants the creator or an owner only, for approved and unapproved datasets alike.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| EDIT-1 | CREATOR | `PUT /edit_dataset` | Allow. |
| EDIT-2 | OWNER | `PUT /edit_dataset` | Allow. |
| EDIT-3 | A_SAME (admin, not owner) | `PUT /edit_dataset` | Deny (403). Admin is not an owner. |
| EDIT-4 | R_SAME (reviewer, not owner) | `PUT /edit_dataset` on an unapproved dataset | Deny (403). **See Finding F3**: specification grants reviewers edit on unapproved datasets. |
| EDIT-5 | M_SAME | `PUT /edit_dataset` | Deny (403). |
| EDIT-6 | SU (not owner, not creator) | `PUT /edit_dataset` | Deny (403). `can_edit_or_add_file` does not grant super users. **See Finding F5.** |
| EDIT-7 | CREATOR | `PUT /edit_dataset` on an **approved** dataset | Allow. **See Finding F6**: specification restricts editing to unapproved datasets; the code does not. |
| EDIT-8 | CREATOR | `PUT /edit_file` | Allow. |
| EDIT-9 | OWNER | `PUT /edit_file` | Allow. |
| EDIT-10 | R_SAME | `PUT /edit_file` on an unapproved dataset | Deny (403). Same as EDIT-4. |
| EDIT-11 | CREATOR | `PUT /edit_dataset` changing availability to a restricted level in Org B | Availability clamps to 0 through the same `parse_availability` path; confirm behaviour. |

---

## 8. Add file and delete file

Add file: when the upload job already carries the dataset, the job must belong to the requesting user; otherwise `can_edit_or_add_file` is checked against the existing dataset.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| ADDF-1 | CREATOR, own job | `POST /add_file` | Allow. |
| ADDF-2 | M_SAME, using another user's job id | `POST /add_file` | Deny (403), "Job does not belong to this user". |
| ADDF-3 | OWNER, adding to an existing dataset | `POST /add_file` | Allow (owner passes `can_edit_or_add_file`). |
| ADDF-4 | R_SAME, adding to an existing dataset not owned | `POST /add_file` | Deny (403). |

Delete file: uses `check_dataset_permission`, plus a guard that prevents deleting the only remaining file.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| DELF-1 | CREATOR, dataset has 2+ files | `DELETE /delete_file` | Allow. |
| DELF-2 | OWNER, dataset has 2+ files | `DELETE /delete_file` | Allow. |
| DELF-3 | A_SAME (admin same org) | `DELETE /delete_file` | Allow (admin passes `check_dataset_permission`). |
| DELF-4 | R_SAME (reviewer) | `DELETE /delete_file` | Deny (403). Reviewers are excluded. **See Finding F4.** |
| DELF-5 | Any permitted user, dataset has exactly 1 file | `DELETE /delete_file` | Deny (400), "only file of the dataset". |
| DELF-6 | M_OTHER | `DELETE /delete_file` | Deny (403). |
| DELF-7 | SU | `DELETE /delete_file` | Allow. |

---

## 9. Delete dataset

Uses `check_dataset_permission`: creator, owner, organisation admin (role 1), or super user.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| DELD-1 | CREATOR | `DELETE /delete_dataset` | Allow. |
| DELD-2 | OWNER | `DELETE /delete_dataset` | Allow. |
| DELD-3 | A_SAME | `DELETE /delete_dataset` | Allow. |
| DELD-4 | A_OTHER (admin, different org) | `DELETE /delete_dataset` | Deny (403). Admin check requires the organisation to match. |
| DELD-5 | R_SAME (reviewer) | `DELETE /delete_dataset` on an unapproved dataset | Deny (403). Reviewers delete unapproved datasets through reject, not this endpoint. **See Finding F4.** |
| DELD-6 | M_SAME | `DELETE /delete_dataset` | Deny (403). |
| DELD-7 | SU | `DELETE /delete_dataset`, any organisation | Allow. |
| DELD-8 | ANON, no api key | `DELETE /delete_dataset` | Deny (401). |
| DELD-9 | Deletion succeeds | verify | All files removed from object storage and database; creator contribution count decremented by 1, not below 0. |

---

## 10. Manage owners

Uses `_can_manage_owners`: super user, a dataset owner, or an organisation admin (role 1).

| ID | Precondition | Action | Expected |
|---|---|---|---|
| OWN-1 | OWNER | `POST /dataset_owners`, target M_SAME (Org A) | Allow. |
| OWN-2 | A_SAME | `POST /dataset_owners`, target M_SAME | Allow. |
| OWN-3 | R_SAME (reviewer, not owner) | `POST /dataset_owners` | Deny (403). |
| OWN-4 | M_SAME (not owner) | `POST /dataset_owners` | Deny (403). |
| OWN-5 | OWNER | add a target from a different organisation (M_OTHER) | Deny (403), "Owner must belong to the dataset organization". |
| OWN-6 | SU | add M_OTHER (different organisation) | Allow. Super user bypasses the organisation match. |
| OWN-7 | OWNER | add a user who is already an owner | Deny (409). |
| OWN-8 | OWNER | `DELETE /dataset_owners` removing another owner | Allow. |
| OWN-9 | Owner added | verify | A dataset-transfer notification is enqueued to the new owner's email. |

---

## 11. Approve and reject datasets

`PUT /approve_dataset` and `DELETE /reject_dataset`: verified account, plus high role (1 or 2) or super user, plus the dataset must belong to the actor's organisation (super user exempt). Reject additionally refuses an already-approved dataset (409) and deletes the unapproved dataset on success.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| APPR-1 | A_SAME | `PUT /approve_dataset` (Org A dataset) | Allow. |
| APPR-2 | R_SAME | `PUT /approve_dataset` (Org A dataset) | Allow. |
| APPR-3 | M_SAME | `PUT /approve_dataset` | Deny (403). Role 0. |
| APPR-4 | A_OTHER (admin, Org C) | `PUT /approve_dataset` (Org A dataset) | Deny (403), organisation mismatch. |
| APPR-5 | R_OTHER (reviewer, Org C) | `PUT /approve_dataset` (Org A dataset) | Deny (403), organisation mismatch. |
| APPR-6 | R_SAME but unverified | `PUT /approve_dataset` | Deny (403), "Verified account required". |
| APPR-7 | SU | `PUT /approve_dataset`, any organisation | Allow. |
| APPR-8 | R_SAME | `DELETE /reject_dataset` on an unapproved Org A dataset | Allow; dataset is deleted. This is the reviewer "delete unapproved" path. |
| APPR-9 | R_SAME | `DELETE /reject_dataset` on an already-approved dataset | Deny (409). |
| APPR-10 | R_OTHER | `DELETE /reject_dataset` (Org A dataset) | Deny (403), organisation mismatch. |
| APPR-11 | Approval succeeds | verify | `approved = true`, `approved_by` set, creator notified by email, search index updated. |

---

## 12. Member management

`PUT /approve_user`, `DELETE /reject_user`, `PUT /change_user_role`, and `DELETE /delete_user`: verified account and admin (role 1). Reviewers are not admins and are refused. Organisation scoping is enforced in the service layer; include cross-organisation cases.

| ID | Precondition | Action | Expected |
|---|---|---|---|
| USR-1 | A_SAME | `PUT /approve_user/{id}/1` (promote to admin) | Allow. |
| USR-2 | A_SAME | `PUT /approve_user/{id}` (default role 0) | Allow, role set to Member. |
| USR-3 | R_SAME (reviewer) | `PUT /approve_user` | Deny (403). Reviewer is not admin. |
| USR-4 | M_SAME | `PUT /approve_user` | Deny (403). |
| USR-5 | A_SAME but unverified | `PUT /approve_user` | Deny (403), "Verified account required". |
| USR-6 | A_OTHER (admin, Org C) | approve a pending user in Org A | Deny (403), organisation mismatch. |
| USR-7 | A_SAME | `DELETE /reject_user` (pending Org A user) | Allow. |
| USR-8 | A_SAME | `PUT /change_user_role/{id}/2` (make reviewer) | Allow. |
| USR-9 | A_SAME | `DELETE /delete_user/{id}` (Org A member) | Allow; user and contribution row removed. |
| USR-10 | A_SAME | `GET /pending_approvals` | Returns only Org A pending users. |
| USR-11 | SU | member management across organisations | Confirm behaviour; endpoints are written around organisation admins, so document what the super user can and cannot do here. |

---

## 13. Findings: specification versus implementation

These are the differences a tester should expect. They are stated as observations, with the enforcing code named, so the team can decide whether the code or the specification is the source of truth. None have been changed.

**F1 — Private (level 1) is far more restrictive than specified.** The specification says Private means "for any user signed into the instance". In `viewer_can_see_dataset`, once the dataset is not public and the viewer is not the creator or a super user, level 1 returns `False` immediately, before any organisation or owner check. So no ordinary member, reviewer, admin, or even a dataset owner can view or download a Private dataset. The listing query `approved_dataset_visibility_clause` and `search_visibility_sql` agree with this, omitting level 1 entirely except for the creator. The Role Capabilities table ("Browse, search, view and download private datasets: yes" for Member, Reviewer, and Admin) is also not met for level 1 under this reading. This is the single largest gap and should be tested first.

**F2 — Download does not apply the verified gate or the approval gate.** `GET /dataset_info` refuses a restricted dataset to an unverified user, and refuses an unapproved dataset to anyone who is not the creator, an owner, or a same-organisation high-role user. `GET /download_url` applies neither of these; it checks only `viewer_can_see`. A file in an unapproved but organisation-visible dataset is therefore downloadable by an ordinary organisation member who cannot see the dataset's own metadata page (test DL-U1). Whether this is exploitable depends on how a caller obtains the file identifier, since listings and search return approved datasets only.

**F3 — Reviewers cannot edit unapproved datasets.** The specification's "Edit dataset and file metadata of unapproved datasets" grants Reviewer "yes". The code path `can_edit_or_add_file` grants only the creator or an owner, so a reviewer who is not an owner is refused at EDIT-4 and EDIT-10.

**F4 — Reviewers cannot delete through the delete endpoints.** The specification's "Delete a dataset or file" grants Reviewer "yes (unapproved)". `check_dataset_permission` excludes reviewers. The reviewer's real route to remove an unapproved dataset is `DELETE /reject_dataset` (test APPR-8), which deletes the dataset. There is no reviewer path to delete an individual file. If the specification means file-level deletion for reviewers, that is not implemented.

**F5 — Super user cannot edit or add files unless they are an owner.** `can_edit_or_add_file` has no super-user branch, so `PUT /edit_dataset`, `PUT /edit_file`, and `POST /add_file` refuse a super user who is neither creator nor owner (test EDIT-6). The super user can still delete (via `check_dataset_permission`) and manage owners (via `_can_manage_owners`), both of which do include a super-user branch. The specification frames the super user around view and delete, so this may be intended; it is recorded because it is an asymmetry within the code itself.

**F6 — Editing is not restricted to unapproved datasets.** The specification lists editing under "unapproved datasets". The edit endpoints do not check the approval flag, so a creator or owner can edit an approved dataset's metadata and its files (test EDIT-7). If edits after approval should be blocked or should reset approval, that logic is absent.

**F7 — `manage_owners` privilege flag versus the enforced check.** In `_compute_privileges` (used to populate the `dataset_info` response), `manage_owners` is `can_edit or is_org_admin` plus super user. The actual enforcement in `_can_manage_owners` is owner, org admin, or super user. These agree in practice because `can_edit` means creator or owner and the creator is seeded as an owner. Worth a regression test if the creator-as-owner seeding ever changes.

---

## 14. Negative and boundary tests

| ID | Case | Expected |
|---|---|---|
| NEG-1 | `availability` set to a negative number or a string on create | Coerced to Public (0). |
| NEG-2 | Restricted availability requested in a non-private organisation | Clamped to Public (0), no error. |
| NEG-3 | `dataset_id` that does not exist, any managing endpoint | 404. |
| NEG-4 | Malformed UUID in a path parameter | 400. |
| NEG-5 | Adding an owner already present | 409. |
| NEG-6 | Rejecting an approved dataset | 409. |
| NEG-7 | Deleting the last file of a dataset | 400. |
| NEG-8 | Cross-organisation approve, reject, or member action by a non-super-user | 403, organisation mismatch. |
| NEG-9 | Text fields with HTML or script content | Sanitised by `sanitize_input` (bleach), tags stripped. |
| NEG-10 | Super user listing and search | Still filtered by approval and the visibility clause; the super user does not see everything in listings, only in direct view and delete, matching the specification note. |

---

## 15. Abbreviations

| Abbreviation | Expansion |
|---|---|
| API | Application Programming Interface |
| HTTP | Hypertext Transfer Protocol |
| MEL | Monitoring, Evaluation, and Learning |
| S3 | Simple Storage Service (object storage) |
| SQL | Structured Query Language |
| UUID | Universally Unique Identifier |

---

## 16. Coverage summary

The matrices cover five roles plus anonymous and super user, against five availability levels, in approved and unapproved states, across view, download, list, search, create, edit (dataset and file), add file, delete file, delete dataset, owner management, dataset approval and rejection, and member management. The verified-account condition and the super-user condition are tested as cross-cutting gates. Section 13 records seven points where the running code and the pasted specification diverge; those are the highest-value tests to run first.
