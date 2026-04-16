import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  approve_user_endpoint,
  pending_approvals_endpoint,
  reject_user_endpoint,
} from "../api/endpoints";

const ROLE_OPTIONS = [
  { value: 0, label: "Member" },
  { value: 1, label: "Admin" },
  { value: 2, label: "Reviewer" },
];

function Approvals() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [hasUsersSection, setHasUsersSection] = useState(false);
  const [hasDatasetsSection, setHasDatasetsSection] = useState(false);
  const [processingUserId, setProcessingUserId] = useState(null);
  const [processingAction, setProcessingAction] = useState(null);
  const [pendingModalUser, setPendingModalUser] = useState(null);
  const [modalRole, setModalRole] = useState(0);
  const userApprovalModalContainerRef = useRef(null);
  const previousFocusElementRef = useRef(null);
  const approveFromModalButtonRef = useRef(null);

  const fetchPendingApprovals = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(pending_approvals_endpoint, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        let errorMessage = "Failed to load pending approvals.";

        try {
          const errorData = await response.json();
          errorMessage = errorData?.detail || errorData?.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      setHasUsersSection(Object.prototype.hasOwnProperty.call(data, "users"));
      setHasDatasetsSection(
        Object.prototype.hasOwnProperty.call(data, "datasets")
      );
      setUsers(Array.isArray(data?.users) ? data.users : []);
      setDatasets(Array.isArray(data?.datasets) ? data.datasets : []);
    } catch (err) {
      console.error("Error fetching pending approvals:", err);
      setHasUsersSection(false);
      setHasDatasetsSection(false);
      setUsers([]);
      setDatasets([]);
      setError(err.message || "Unable to load pending approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPendingApprovals();
  }, [fetchPendingApprovals]);

  const handleCloseUserModal = () => {
    if (processingUserId) return;
    setPendingModalUser(null);
    setModalRole(0);
    setProcessingAction(null);
  };

  const handleOpenUserModal = (pendingUser) => {
    setPendingModalUser(pendingUser);
    setModalRole(0);
  };

  const handleApproveFromModal = async () => {
    if (!pendingModalUser?.user_id) return;

    const userId = pendingModalUser.user_id;
    try {
      setProcessingUserId(userId);
      setProcessingAction("approve");
      setError("");

      const response = await fetch(
        approve_user_endpoint(userId, modalRole),
        {
          method: "PUT",
          credentials: "include",
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to approve user.";
        try {
          const errorData = await response.json();
          errorMessage = errorData?.detail || errorData?.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      setPendingModalUser(null);
      setModalRole(0);
      setProcessingAction(null);
      await fetchPendingApprovals();
    } catch (err) {
      console.error("Error approving user:", err);
      setError(err.message || "Unable to approve user.");
    } finally {
      setProcessingUserId(null);
      setProcessingAction(null);
    }
  };

  const handleRejectFromModal = async () => {
    if (!pendingModalUser?.user_id) return;

    const userId = pendingModalUser.user_id;
    try {
      setProcessingUserId(userId);
      setProcessingAction("reject");
      setError("");

      const response = await fetch(reject_user_endpoint(userId), {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        let errorMessage = "Failed to reject user.";
        try {
          const errorData = await response.json();
          errorMessage = errorData?.detail || errorData?.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      setPendingModalUser(null);
      setModalRole(0);
      setProcessingAction(null);
      await fetchPendingApprovals();
    } catch (err) {
      console.error("Error rejecting user:", err);
      setError(err.message || "Unable to reject user.");
    } finally {
      setProcessingUserId(null);
      setProcessingAction(null);
    }
  };

  const handleViewDataset = (datasetId) => {
    if (!datasetId) return;
    navigate(`/dataset-info?dataset_id=${encodeURIComponent(datasetId)}`);
  };

  useEffect(() => {
    if (!pendingModalUser) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !processingUserId) {
        setPendingModalUser(null);
        setModalRole(0);
        setProcessingAction(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingModalUser, processingUserId]);

  useEffect(() => {
    if (!pendingModalUser) return undefined;

    previousFocusElementRef.current = document.activeElement;

    const focusTimeoutId = window.setTimeout(() => {
      approveFromModalButtonRef.current?.focus();
    }, 0);

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusableElements = () => {
      const root = userApprovalModalContainerRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll(focusableSelector));
    };

    const handleDocumentTabKey = (event) => {
      if (event.key !== "Tab") return;
      const root = userApprovalModalContainerRef.current;
      if (!root || !root.contains(document.activeElement)) return;

      const focusables = getFocusableElements();
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDocumentTabKey, true);

    return () => {
      window.clearTimeout(focusTimeoutId);
      document.removeEventListener("keydown", handleDocumentTabKey, true);
      const toRestore = previousFocusElementRef.current;
      previousFocusElementRef.current = null;
      if (toRestore && typeof toRestore.focus === "function") {
        toRestore.focus();
      }
    };
  }, [pendingModalUser]);

  if (loading) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5">
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {hasUsersSection && (
        <section className="mb-5">
          <h2 className="mb-4">User Approvals</h2>
          <div className="table-responsive">
            <table className="table table-borderless align-middle">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Email</th>
                  <th scope="col">Designation</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((pendingUser) => (
                  <tr key={pendingUser.user_id}>
                    <td>{pendingUser.full_name || "N/A"}</td>
                    <td>{pendingUser.email || "N/A"}</td>
                    <td>{pendingUser.designation || "N/A"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn text-white"
                        style={{
                          backgroundColor: "#0d6efd",
                          borderColor: "#0d6efd",
                        }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.backgroundColor = "#0b5ed7";
                          event.currentTarget.style.borderColor = "#0b5ed7";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.backgroundColor = "#0d6efd";
                          event.currentTarget.style.borderColor = "#0d6efd";
                        }}
                        onClick={() => handleOpenUserModal(pendingUser)}
                        disabled={processingUserId === pendingUser.user_id}
                        aria-label={`View ${pendingUser.full_name || pendingUser.email || "user"}`}
                      >
                        {processingUserId === pendingUser.user_id
                          ? "Working..."
                          : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="4" className="text-muted">
                      No pending users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pendingModalUser && (
        <div
          ref={userApprovalModalContainerRef}
          className="modal show d-block"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="userApprovalModalTitle"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="userApprovalModalTitle">
                  User approval
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleCloseUserModal}
                  disabled={!!processingUserId}
                  aria-label="Close dialog"
                />
              </div>
              <div className="modal-body">
                <div className="d-flex justify-content-between align-items-baseline mb-3 gap-3">
                  <span className="fw-semibold text-nowrap">User:</span>
                  <span className="text-end">
                    {pendingModalUser.full_name || "N/A"}
                  </span>
                </div>
                <div className="d-flex justify-content-between align-items-baseline mb-3 gap-3">
                  <span className="fw-semibold text-nowrap">Email:</span>
                  <span className="text-end">
                    {pendingModalUser.email || "N/A"}
                  </span>
                </div>
                <div className="d-flex justify-content-between align-items-baseline mb-4 gap-3">
                  <span className="fw-semibold text-nowrap">Designation:</span>
                  <span className="text-end">
                    {pendingModalUser.designation || "N/A"}
                  </span>
                </div>
                <div className="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
                  <span className="fw-semibold text-nowrap" id="role-select-label">
                    Role:
                  </span>
                  <select
                    id="user-approval-role"
                    className="form-select"
                    style={{ maxWidth: "12rem" }}
                    value={modalRole}
                    onChange={(e) => setModalRole(Number(e.target.value))}
                    disabled={!!processingUserId}
                    aria-labelledby="role-select-label"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="d-flex flex-wrap gap-2 justify-content-center justify-content-md-start">
                  <button
                    ref={approveFromModalButtonRef}
                    type="button"
                    className="btn text-white"
                    style={{
                      backgroundColor: "#0d6efd",
                      borderColor: "#0d6efd",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "#0b5ed7";
                      event.currentTarget.style.borderColor = "#0b5ed7";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "#0d6efd";
                      event.currentTarget.style.borderColor = "#0d6efd";
                    }}
                    onClick={handleApproveFromModal}
                    disabled={!!processingUserId}
                    aria-label="Approve user with selected role"
                  >
                    {processingUserId === pendingModalUser.user_id &&
                    processingAction === "approve"
                      ? "Approving..."
                      : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="btn text-white"
                    style={{
                      backgroundColor: "#dc3545",
                      borderColor: "#dc3545",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = "#e35d6a";
                      event.currentTarget.style.borderColor = "#e35d6a";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "#dc3545";
                      event.currentTarget.style.borderColor = "#dc3545";
                    }}
                    onClick={handleRejectFromModal}
                    disabled={!!processingUserId}
                    aria-label="Reject and remove user"
                  >
                    {processingUserId === pendingModalUser.user_id &&
                    processingAction === "reject"
                      ? "Rejecting..."
                      : "Reject"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {hasDatasetsSection && (
        <section>
          <h2 className="mb-4">Dataset Approvals</h2>
          <div className="table-responsive">
            <table className="table table-borderless align-middle">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.dataset_id}>
                    <td>{dataset.dataset_title || "N/A"}</td>
                    <td>{dataset.creator_name || "N/A"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn text-white"
                        style={{
                          backgroundColor: "#0d6efd",
                          borderColor: "#0d6efd",
                        }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.backgroundColor = "#0b5ed7";
                          event.currentTarget.style.borderColor = "#0b5ed7";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.backgroundColor = "#0d6efd";
                          event.currentTarget.style.borderColor = "#0d6efd";
                        }}
                        onClick={() => handleViewDataset(dataset.dataset_id)}
                        aria-label={`View ${dataset.dataset_title || "dataset"}`}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {datasets.length === 0 && (
                  <tr>
                    <td colSpan="3" className="text-muted">
                      No pending datasets found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!hasUsersSection && !hasDatasetsSection && !error && (
        <div className="alert alert-info" role="alert">
          No pending approvals found.
        </div>
      )}
    </div>
  );
}

export default Approvals;
