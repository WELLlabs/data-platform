import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { profile_endpoint, user_datasets_endpoint } from "../api/endpoints";

function Profile() {
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [error, setError] = useState("");
  const [showApiKeyOverlay, setShowApiKeyOverlay] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();

  // User datasets state
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const limit = 10;
  const lastFetchedUserIdRef = useRef(null);

  // Handle authentication and query parameters
  useEffect(() => {
    const checkAuthAndApplyParams = async () => {
      try {
        const userData = await verifyUser();
        const idParam = searchParams.get("id");

        // If no id param and user not signed in, redirect to signin
        if (!idParam && !userData) {
          navigate("/signin");
          return;
        }

        // If no id param but user signed in, use user.id
        if (!idParam && userData) {
          setSearchParams({ id: userData.id });
          return;
        }

        // If id param exists, proceed to fetch profile
        setLoading(false);
      } catch (error) {
        console.error("Error checking authentication:", error);
        if (!searchParams.get("id")) {
          navigate("/signin");
        } else {
          setLoading(false);
        }
      }
    };

    checkAuthAndApplyParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, verifyUser]);

  // Fetch profile data
  useEffect(() => {
    const fetchProfile = async () => {
      const idParam = searchParams.get("id");
      if (!idParam) return;

      try {
        setLoading(true);
        setError("");

        // Build query parameters
        const params = new URLSearchParams({
          user_id: idParam,
        });

        // Add apikey if user is signed in
        if (isAuthenticated && user?.apikey) {
          params.append("apikey", user.apikey);
        }

        const response = await fetch(
          `${profile_endpoint}?${params.toString()}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("User not found");
          }
          throw new Error(`Failed to fetch profile: ${response.statusText}`);
        }

        const data = await response.json();
        setProfileData(data);
      } catch (err) {
        console.error("Error fetching profile:", err);
        setError(err.message || "Error loading profile");
      } finally {
        setLoading(false);
      }
    };

    if (searchParams.get("id")) {
      fetchProfile();
    }
  }, [searchParams, isAuthenticated, user?.apikey]);

  // Fetch user datasets if privileges.user_datasets is true
  // Wait for profileData to be fetched before checking privileges
  useEffect(() => {
    const fetchUserDatasets = async (userId) => {
      try {
        setDatasetsLoading(true);
        const offset = (currentPage - 1) * limit;

        // Build query parameters
        const params = new URLSearchParams({
          user_id: userId,
          limit: limit.toString(),
          offset: offset.toString(),
        });

        // Add apikey if user is signed in
        if (isAuthenticated && user?.apikey) {
          params.append("apikey", user.apikey);
        }

        const response = await fetch(
          `${user_datasets_endpoint}?${params.toString()}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch datasets: ${response.statusText}`);
        }

        const data = await response.json();

        // Check if we have more data
        if (data.length === 0) {
          setHasMore(false);
          if (currentPage === 1) {
            setDatasets([]);
          }
        } else {
          setHasMore(data.length === limit);
          setDatasets(data || []);
        }
      } catch (error) {
        console.error("Error fetching user datasets:", error);
        setDatasets([]);
        setHasMore(false);
      } finally {
        setDatasetsLoading(false);
      }
    };

    // Wait for profile fetch to complete before checking privileges
    if (loading) {
      return; // Profile is still loading, don't fetch datasets yet
    }

    // Ensure profileData exists before checking privileges
    if (!profileData) {
      return; // Profile data not available yet
    }

    const idParam = searchParams.get("id");
    
    // Check if user has privilege to view datasets
    // Backend determines this via privileges.user_datasets
    if (profileData.privileges?.user_datasets && idParam) {
      const currentUserId = idParam;
      
      // Reset pagination when user_id changes
      if (lastFetchedUserIdRef.current !== currentUserId) {
        lastFetchedUserIdRef.current = currentUserId;
        setCurrentPage(1);
        setHasMore(true);
        // Still fetch with page 1 - don't return early
        // The fetch will use currentPage which is now 1
      }
      
      // Always fetch when conditions are met
      fetchUserDatasets(currentUserId);
    }
  }, [
    loading, // Wait for profile loading to complete
    profileData, // Wait for profileData to be set
    profileData?.privileges?.user_datasets,
    profileData?.id,
    currentPage,
    isAuthenticated,
    user?.apikey,
    searchParams,
  ]);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const getRoleDisplay = (isSuperuser, role) => {
    if (isSuperuser) return "Super User";
    if (role === 0) return "Member";
    if (role === 1) return "Admin";
    if (role === 2) return "Editor";
    return "Member";
  };

  const handleCardClick = (datasetId) => {
    navigate(`/dataset-info?dataset_id=${datasetId}`);
  };

  const handlePrevious = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      setHasMore(true);
    }
  };

  const handleNext = () => {
    if (hasMore) {
      setCurrentPage(currentPage + 1);
    }
  };

  if (loading) {
    return (
      <div className="container py-5">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="container py-5">
        <div className="alert alert-warning" role="alert">
          No profile data available.
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5">
      {/* Header with title and Edit button */}
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="text-start m-0">User Profile</h2>
        </div>
        {profileData.privileges?.edit && (
          <div className="col-auto">
            <button
              className="btn"
              style={{ backgroundColor: "#1b75e0", color: "#fff" }}
              onClick={() => {
                // TODO: Implement edit functionality
                console.log("Edit profile clicked");
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* User Information */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="row">
            <div className="col-md-6 col-12 mb-3">
              <strong>Name:</strong> {profileData.full_name || "N/A"}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Email:</strong> {profileData.email || "N/A"}
              {profileData.is_verified !== undefined && (
                <span
                  className="ms-2"
                  title={profileData.is_verified ? "Verified" : "Not Verified"}
                >
                  {profileData.is_verified ? (
                    <i className="bi bi-check-circle-fill text-success"></i>
                  ) : (
                    <i className="bi bi-x-circle-fill text-danger"></i>
                  )}
                </span>
              )}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Designation:</strong> {profileData.designation || "N/A"}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Organization:</strong>{" "}
              {profileData.organization_name ? (
                <>
                  <Link
                    to={`/organisation?id=${profileData.organization}`}
                    style={{ color: "#1b75e0" }}
                  >
                    {profileData.organization_name}
                  </Link>
                  {profileData.verified !== undefined && (
                    <span
                      className="ms-2"
                      title={profileData.verified ? "Approved" : "Not Approved"}
                    >
                      {profileData.verified ? (
                        <i className="bi bi-check-circle-fill text-success"></i>
                      ) : (
                        <i className="bi bi-x-circle-fill text-danger"></i>
                      )}
                    </span>
                  )}
                </>
              ) : (
                "N/A"
              )}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Role:</strong>{" "}
              {getRoleDisplay(profileData.is_superuser, profileData.role)}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Phone:</strong> {profileData.phone || "N/A"}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Contributions:</strong> {profileData.contributions ?? 0}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Joined On:</strong> {formatDate(profileData.created_at)}
            </div>
            <div className="col-md-6 col-12 mb-3">
              <strong>Modified At:</strong> {formatDate(profileData.modified_at)}
            </div>
          </div>
        </div>
      </div>

      {/* Conditional Buttons */}
      {profileData.privileges?.edit && (
        <div className="mb-4">
          <div className="d-flex gap-2 flex-wrap">
            <button
              className="btn"
              style={{ backgroundColor: "#1b75e0", color: "#fff" }}
              // the intent is always to change the current user's own password
              // this button will be hidden if the user of profile page is not the current user or no user is signed in
              // this button will be visible based on the privileges.edit condition from the backend response
              onClick={() => {
                const userId = user?.id || profileData?.id;
                if (userId) {
                  navigate(`/change-password?user_id=${userId}`);
                }
              }}
            >
              Change Password
            </button>
            <button
              className="btn"
              style={{ backgroundColor: "#1b75e0", color: "#fff" }}
              onClick={() => setShowApiKeyOverlay(true)}
            >
              API KEY
            </button>
          </div>
        </div>
      )}

      {/* API Key Overlay */}
      {showApiKeyOverlay && profileData.apikey && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">API Key</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowApiKeyOverlay(false)}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                <div className="d-flex align-items-center">
                  <div className="me-2">
                    <strong>API KEY:</strong> {profileData.apikey}
                  </div>
                  <button
                    className="btn btn-link p-0 ms-auto"
                    onClick={() => {
                      // TODO: Implement reload/regenerate API key
                      console.log("Reload API key clicked");
                    }}
                    title="Reload API Key"
                  >
                    <i className="bi bi-arrow-clockwise"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Datasets Section */}
      {profileData.privileges?.user_datasets && (
        <div className="mt-4">
          <h3 className="mb-4">User Datasets</h3>

          {datasetsLoading ? (
            <div className="text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading datasets...</span>
              </div>
            </div>
          ) : datasets.length === 0 && currentPage === 1 ? (
            <div className="alert alert-info" role="alert">
              No datasets found.
            </div>
          ) : (
            <>
              {/* Dataset cards */}
              <div className="row">
                {datasets.map((dataset) => (
                  <div key={dataset.dataset_id} className="col-md-6 col-lg-4 mb-4">
                    <div
                      className="card h-100"
                      style={{ cursor: "pointer" }}
                      onClick={() => handleCardClick(dataset.dataset_id)}
                    >
                      <div className="card-body">
                        <h5 className="card-title">
                          {dataset.dataset_title || "Untitled"}
                        </h5>
                        <p className="card-text">
                          <small className="text-muted">
                            {dataset.dataset_description || "No description"}
                          </small>
                        </p>
                        <div className="mb-2">
                          <small className="text-muted">
                            <strong>Created:</strong> {formatDate(dataset.created_at)}
                          </small>
                        </div>
                        <div className="mb-2">
                          <small className="text-muted">
                            <strong>Private:</strong>{" "}
                            {dataset.private ? (
                              <span className="badge bg-warning">Private</span>
                            ) : (
                              <span className="badge bg-success">Public</span>
                            )}
                          </small>
                        </div>
                        <div className="mb-2">
                          <small className="text-muted">
                            <strong>Downloads:</strong> {dataset.downloads ?? 0}
                          </small>
                        </div>
                        {dataset.tags &&
                          Array.isArray(dataset.tags) &&
                          dataset.tags.length > 0 && (
                            <div className="mb-2">
                              <small className="text-muted">
                                <strong>Tags:</strong> {dataset.tags.join(", ")}
                              </small>
                            </div>
                          )}
                        {dataset.organization && (
                          <div className="mb-2">
                            <small className="text-muted">
                              <strong>Organization:</strong> {dataset.organization}
                            </small>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="d-flex justify-content-center align-items-center mt-4">
                <button
                  className="btn btn-outline-secondary me-3"
                  onClick={handlePrevious}
                  disabled={currentPage === 1 || datasetsLoading}
                >
                  Previous
                </button>
                <span className="mx-3">{currentPage}</span>
                <button
                  className="btn btn-outline-secondary ms-3"
                  onClick={handleNext}
                  disabled={!hasMore || datasetsLoading}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default Profile;
