// Centralized API endpoint definitions

export const signup_endpoint = "/api/auth/signup";
export const signin_endpoint = "/api/auth/signin";
export const me_endpoint = "/api/auth/me";
export const signout_endpoint = "/api/auth/signout";
export const changepassword_endpoint = "/api/auth/changepassword";

// Password reset endpoints
export const forgot_password_endpoint = "/api/auth/forgot-password";
export const reset_password_endpoint = "/api/auth/reset-password";
export const reset_password_validate_endpoint = "/api/auth/reset-password/validate";

// Email verification endpoints
export const request_verify_token_endpoint = "/api/auth/request-verify-token";
export const verify_endpoint = "/api/auth/verify";
export const send_verify_email_endpoint = "/api/auth/send-verify-email";

// Organization endpoints
export const organizations_endpoint = "/api/organizations";
export const list_organizations_endpoint = "/api/organizations/list_organizations";
export const organization_validate_endpoint = "/api/organizations/validate";
export const organization_by_id_endpoint = (id) => `/api/organizations/${id}`;
export const organization_add_member_endpoint = (id) =>
  `/api/organizations/${id}/members`;

// Upload/Data endpoints
export const upload_url_endpoint = "/api/upload_url";
export const check_files_endpoint = "/api/check_files";
export const complete_multipart_endpoint = "/api/complete_multipart";
export const create_upload_job_endpoint = "/api/create_upload_job";
export const complete_upload_job_endpoint = "/api/complete_upload_job";
export const create_dataset_endpoint = "/api/create_dataset";
export const dataset_info_endpoint = "/api/dataset_info";
export const user_datasets_endpoint = "/api/user_datasets";
export const user_dataset_counts_endpoint = "/api/user_dataset_counts";
export const datasets_endpoint = "/api/datasets";
export const download_url_endpoint = "/api/download_url";
export const download_dataset_endpoint = "/api/download_dataset";
export const access_file_endpoint = "/api/access_file";
export const access_file_status_endpoint = "/api/access_file/status";
export const access_file_schema_endpoint = "/api/access_file/schema";
export const access_file_table_endpoint = "/api/access_file/table";
export const access_file_chart_endpoint = "/api/access_file/chart";
export const add_files_url_endpoint = "/api/add_file";
export const delete_dataset_endpoint = "/api/delete_dataset";
export const delete_file_endpoint = "/api/delete_file";
export const edit_dataset_endpoint = "/api/edit_dataset";
export const dataset_owners_endpoint = "/api/dataset_owners";
export const auth_apikey_endpoint = "/api/auth/apikey";
export const login_options_endpoint = "/api/auth/login-options";
export const complete_profile_endpoint = "/api/auth/complete-profile";
export const google_auth_endpoint = "/api/auth/google";
export const edit_file_endpoint = "/api/edit_file";
export const profile_endpoint = "/api/profile";
export const edit_profile_endpoint = "/api/edit_profile";
export const search_endpoint = "/api/search";
export const tags_suggest_endpoint = "/api/tags/suggest";
export const tags_list_endpoint = "/api/tags";
export const topics_endpoint = "/api/topics";
export const homepage_stats_endpoint = "/api/homepage_stats";
export const branding_endpoint = "/api/branding";
export const pending_approvals_endpoint = "/api/pending_approvals";
export const approve_user_endpoint = (userId, role) =>
  `/api/approve_user/${userId}/${role}`;
export const reject_user_endpoint = (userId) => `/api/reject_user/${userId}`;
export const change_user_role_endpoint = (userId, role) =>
  `/api/change_user_role/${userId}/${role}`;
export const delete_user_endpoint = (userId) => `/api/delete_user/${userId}`;
export const approve_dataset_endpoint = (datasetId) => `/api/approve_dataset/${datasetId}`;
export const reject_dataset_endpoint = (datasetId) => `/api/reject_dataset/${datasetId}`;