// Centralized API endpoint definitions

export const signup_endpoint = "/api/auth/signup";
export const signin_endpoint = "/api/auth/signin";
export const me_endpoint = "/api/auth/me";
export const signout_endpoint = "/api/auth/signout";

// Organization endpoints
export const organizations_endpoint = "/api/organizations";
export const organization_validate_endpoint = "/api/organizations/validate";
export const organization_by_id_endpoint = (id) => `/api/organizations/${id}`;

// Upload/Data endpoints
export const upload_url_endpoint = "/api/upload_url";
export const create_dataset_endpoint = "/api/create_dataset";
export const dataset_info_endpoint = "/api/dataset_info";
export const user_datasets_endpoint = "/api/user_datasets";
export const datasets_endpoint = "/api/datasets";
export const download_url_endpoint = "/api/download_url";
export const add_files_url_endpoint = "/api/add_file";
export const delete_dataset_endpoint = "/api/delete_dataset";
export const delete_file_endpoint = "/api/delete_file";
export const profile_endpoint = "/api/profile";