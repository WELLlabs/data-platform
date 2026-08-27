import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  edit_profile_endpoint,
  list_organizations_endpoint,
  profile_endpoint,
  user_datasets_endpoint,
} from "../api/endpoints";
import Ic from "../components/wd/Icons";
import Contour from "../components/wd/Contour";
import { DatasetRow } from "../components/wd/DatasetItems";

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

  // Edit profile modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDesignation, setEditDesignation] = useState("");
  const [editOrganization, setEditOrganization] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editOrganizations, setEditOrganizations] = useState([]);
  const [editOrganizationsLoading, setEditOrganizationsLoading] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  const [profileRefreshTrigger, setProfileRefreshTrigger] = useState(0);

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
  }, [navigate, searchParams]);

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
  }, [searchParams, isAuthenticated, user?.apikey, profileRefreshTrigger]);

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
    if (role === 2) return "Reviewer";
    return "Member";
  };

  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
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

  const fetchEditOrganizations = async () => {
    setEditOrganizationsLoading(true);
    try {
      const resp = await fetch(list_organizations_endpoint, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Failed to load organizations");
      const data = await resp.json();
      const items = data?.items ?? [];
      setEditOrganizations(Array.isArray(items) ? items : []);
    } catch (err) {
      setEditOrganizations([]);
      setEditError(err?.message ?? "Failed to load organizations");
    } finally {
      setEditOrganizationsLoading(false);
    }
  };

  useEffect(() => {
    if (showEditModal) {
      fetchEditOrganizations();
    }
  }, [showEditModal]);

  const handleEditPhoneChange = (e) => {
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      setEditPhone(value.slice(0, 10));
    }
  };

  const editEmailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim());

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError("");
    if (
      !editFullName.trim() ||
      !editEmail.trim() ||
      !editOrganization.trim() ||
      !editEmailValid
    ) {
      setEditError("Please fill required fields with valid values.");
      return;
    }
    setEditSubmitting(true);
    try {
      const params = new URLSearchParams({
        full_name: editFullName.trim(),
        email: editEmail.trim(),
        designation: editDesignation.trim() || "",
        organization: editOrganization,
        phone: editPhone.trim() || "",
      });
      const response = await fetch(edit_profile_endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const detail = data?.detail ?? response.statusText;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      setShowEditModal(false);
      setProfileRefreshTrigger((k) => k + 1);
    } catch (err) {
      setEditError(err?.message ?? "Failed to update profile");
    } finally {
      setEditSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: "48px 0 88px" }}>
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: "48px 0 88px" }}>
          <div className="attn-card warn" role="alert">
            <div><b>{error}</b></div>
          </div>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: "48px 0 88px" }}>
          <div className="attn-card info" role="alert">
            <div><b>No profile data available.</b></div>
          </div>
        </div>
      </div>
    );
  }

  const roleLabel = getRoleDisplay(profileData.is_superuser, profileData.role);

  return (
    <div className="page">
      <div className="wrap" style={{ padding: "40px 0 88px" }}>
        {/* Hero header */}
        <section className="ws-hero" style={{ position: "relative", overflow: "hidden" }}>
          <Contour op={0.3} />
          <span className="eyebrow">Your profile</span>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              flexWrap: "wrap",
              gap: 16,
              marginTop: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
                {getInitials(profileData.full_name)}
              </div>
              <div>
                <h1 className="ws-hi display">{profileData.full_name || "N/A"}</h1>
                <p className="ws-sub">
                  {profileData.organization_name || "No organization"} · {roleLabel}
                </p>
              </div>
            </div>
            {profileData.privileges?.edit && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditFullName(profileData.full_name ?? "");
                  setEditEmail(profileData.email ?? "");
                  setEditDesignation(profileData.designation ?? "");
                  setEditOrganization(profileData.organization ?? "");
                  setEditPhone(profileData.phone ?? "");
                  setEditError("");
                  setShowEditModal(true);
                }}
                aria-label="Edit profile"
              >
                Edit profile
              </button>
            )}
          </div>
        </section>

        {/* User Information */}
        <div className="rail-card" style={{ marginTop: 22 }}>
          <div className="rrow">
            <span>Email</span>
            <span>
              {profileData.email || "N/A"}
              {profileData.is_verified !== undefined && (
                <span
                  style={{ marginLeft: 8, verticalAlign: "middle", color: profileData.is_verified ? "var(--green, #2e7d32)" : "var(--red, #c62828)" }}
                  title={profileData.is_verified ? "Verified" : "Not Verified"}
                >
                  {profileData.is_verified
                    ? <Ic name="verified" size={15} />
                    : <Ic name="close" size={15} />}
                </span>
              )}
            </span>
          </div>
          <div className="rrow">
            <span>Designation</span>
            <span>{profileData.designation || "N/A"}</span>
          </div>
          <div className="rrow">
            <span>Organization</span>
            <span>
              {profileData.organization_name ? (
                <>
                  <Link
                    className="link-arrow"
                    to={`/organisation?id=${profileData.organization}`}
                  >
                    {profileData.organization_name}
                  </Link>
                  {profileData.verified !== undefined && (
                    <span
                      style={{ marginLeft: 8, verticalAlign: "middle", color: profileData.verified ? "var(--green, #2e7d32)" : "var(--red, #c62828)" }}
                      title={profileData.verified ? "Approved" : "Not Approved"}
                    >
                      {profileData.verified
                        ? <Ic name="verified" size={15} />
                        : <Ic name="close" size={15} />}
                    </span>
                  )}
                </>
              ) : (
                "N/A"
              )}
            </span>
          </div>
          <div className="rrow">
            <span>Role</span>
            <span>{roleLabel}</span>
          </div>
          <div className="rrow">
            <span>Phone</span>
            <span>{profileData.phone || "N/A"}</span>
          </div>
          <div className="rrow">
            <span>Contributions</span>
            <span>{profileData.contributions ?? 0}</span>
          </div>
          <div className="rrow">
            <span>Joined on</span>
            <span>{formatDate(profileData.created_at)}</span>
          </div>
          <div className="rrow">
            <span>Modified at</span>
            <span>{formatDate(profileData.modified_at)}</span>
          </div>
        </div>

        {/* Conditional Buttons */}
        {profileData.privileges?.edit && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <button
              className="btn btn-ghost"
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
              Change password
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setShowApiKeyOverlay(true)}
            >
              API key
            </button>
          </div>
        )}

        {/* Edit Profile Modal - rendered via portal at body so it always appears on top (same pattern as DatasetInfo.jsx) */}
        {showEditModal &&
          createPortal(
            <div
              className="cmdk-overlay show"
              role="dialog"
              aria-modal="true"
              aria-labelledby="editProfileModalTitle"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowEditModal(false);
              }}
            >
              <div className="modal-card">
                <div className="modal-head">
                  <h3 id="editProfileModalTitle">Edit profile</h3>
                  <p>Update your account details.</p>
                </div>
                <div className="modal-body">
                  {editError && (
                    <div className="attn-card warn" role="alert" style={{ marginBottom: 14 }}>
                      <div><b>{editError}</b></div>
                    </div>
                  )}
                  <form onSubmit={handleEditSubmit} noValidate>
                    <div className="field">
                      <label htmlFor="editFullName">
                        Full name <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                      </label>
                      <input
                        id="editFullName"
                        type="text"
                        placeholder="Enter your full name"
                        value={editFullName}
                        onChange={(e) =>
                          setEditFullName(e.target.value.slice(0, 50))
                        }
                        maxLength={50}
                        required
                        aria-required="true"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="editEmail">
                        Email <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                      </label>
                      <input
                        id="editEmail"
                        type="email"
                        placeholder="Enter your email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        required
                        aria-required="true"
                      />
                      {editEmail && !editEmailValid && (
                        <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                          Please enter a valid email address
                        </span>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="editDesignation">Designation</label>
                      <input
                        id="editDesignation"
                        type="text"
                        placeholder="Enter your designation"
                        value={editDesignation}
                        onChange={(e) =>
                          setEditDesignation(e.target.value.slice(0, 25))
                        }
                        maxLength={25}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="editOrganization">
                        Organization <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                      </label>
                      <select
                        id="editOrganization"
                        style={{ width: "100%" }}
                        value={editOrganization}
                        onChange={(e) => setEditOrganization(e.target.value)}
                        required
                        disabled={editOrganizationsLoading}
                        aria-required="true"
                        aria-label="Organization"
                      >
                        <option value="">
                          {editOrganizationsLoading
                            ? "Loading..."
                            : "Select organization"}
                        </option>
                        {editOrganization &&
                          !editOrganizationsLoading &&
                          !editOrganizations.some(
                            (org) => String(org.id) === String(editOrganization)
                          ) && (
                            <option value={editOrganization}>
                              {profileData?.organization_name ||
                                "Current organization (not in list)"}
                            </option>
                          )}
                        {editOrganizations.map((org) => (
                          <option key={String(org.id)} value={String(org.id)}>
                            {org.name}
                          </option>
                        ))}
                      </select>
                      {editOrganization &&
                        !editOrganizationsLoading &&
                        !editOrganizations.some(
                          (org) => String(org.id) === String(editOrganization)
                        ) && (
                          <span
                            style={{ color: "var(--amber, #b26a00)", fontSize: 13 }}
                            role="alert"
                            aria-live="polite"
                          >
                            Current organization is not in the list. You can keep
                            it or choose another.
                          </span>
                        )}
                    </div>
                    <div className="field">
                      <label htmlFor="editPhone">Phone</label>
                      <input
                        id="editPhone"
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]{0,10}"
                        placeholder="10 digits phone number"
                        value={editPhone}
                        onChange={handleEditPhoneChange}
                        maxLength={10}
                        aria-label="Phone number"
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{ width: "100%" }}
                      disabled={
                        editSubmitting ||
                        !editFullName.trim() ||
                        !editEmail.trim() ||
                        !editOrganization.trim() ||
                        !editEmailValid
                      }
                    >
                      {editSubmitting ? "Updating…" : "Submit"}
                    </button>
                  </form>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* API Key Overlay */}
        {showApiKeyOverlay && profileData.apikey && (
          <div
            className="cmdk-overlay show"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowApiKeyOverlay(false);
            }}
          >
            <div className="modal-card">
              <div className="modal-head">
                <h3>API key</h3>
                <p>Use this key to authenticate API requests.</p>
              </div>
              <div className="modal-body">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono-token" style={{ flex: 1, wordBreak: "break-all" }}>
                    {profileData.apikey}
                  </span>
                  <button
                    className="btn btn-quiet"
                    onClick={() => {
                      // TODO: Implement reload/regenerate API key
                      console.log("Reload API key clicked");
                    }}
                    title="Reload API Key"
                    aria-label="Reload API Key"
                  >
                    <Ic name="arrow" size={16} />
                  </button>
                </div>
              </div>
              <div className="modal-foot">
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowApiKeyOverlay(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Datasets Section */}
        {profileData.privileges?.user_datasets && (
          <section style={{ marginTop: 40 }}>
            <div className="section-head">
              <h2 className="section-title">User datasets</h2>
            </div>

            {datasetsLoading ? (
              <div className="empty"><p>Loading datasets…</p></div>
            ) : datasets.length === 0 && currentPage === 1 ? (
              <div className="empty"><p>No datasets found.</p></div>
            ) : (
              <>
                <div className="rows">
                  {datasets.map((dataset) => (
                    <DatasetRow key={dataset.dataset_id} dataset={dataset} />
                  ))}
                </div>

                {/* Pagination */}
                <div className="pagination" style={{ marginTop: 22 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={handlePrevious}
                    disabled={currentPage === 1 || datasetsLoading}
                  >
                    <Ic name="chevLeft" size={16} />Previous
                  </button>
                  <span className="mono-token">{currentPage}</span>
                  <button
                    className="btn btn-ghost"
                    onClick={handleNext}
                    disabled={!hasMore || datasetsLoading}
                  >
                    Next<Ic name="arrow" size={16} />
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default Profile;
