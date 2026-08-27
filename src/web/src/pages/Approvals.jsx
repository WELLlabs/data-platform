import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  approve_user_endpoint,
  pending_approvals_endpoint,
  reject_user_endpoint,
} from "../api/endpoints";
import Ic from "../components/wd/Icons";

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
      <div className="page">
        <div className="wrap" style={{ padding: "48px 0 88px" }}>
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap" style={{ padding: "48px 0 88px" }}>
        <span className="eyebrow">Review queue</span>
        <div className="section-head" style={{ marginTop: 8 }}>
          <h2 className="section-title">Approvals</h2>
        </div>

        {error && (
          <div className="attn-card warn" role="alert" style={{ marginBottom: 20 }}>
            <div><b>{error}</b></div>
          </div>
        )}

        {hasUsersSection && (
          <section style={{ marginBottom: 40 }}>
            <div className="sec-label" style={{ marginBottom: 14 }}>
              User approvals
            </div>
            <div className="rows">
              {users.map((pendingUser) => (
                <div className="drow" key={pendingUser.user_id}>
                  <div className="rt">
                    <span className="badge pending">Pending</span>
                    <h3>{pendingUser.full_name || "N/A"}</h3>
                  </div>
                  <div className="rm">
                    <span>{pendingUser.email || "N/A"}</span>
                    <span className="spec">
                      {pendingUser.designation || "N/A"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginLeft: "auto" }}
                      onClick={() => handleOpenUserModal(pendingUser)}
                      disabled={processingUserId === pendingUser.user_id}
                      aria-label={`Review ${pendingUser.full_name || pendingUser.email || "user"}`}
                    >
                      {processingUserId === pendingUser.user_id
                        ? "Working…"
                        : "Review"}
                    </button>
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="empty">
                  <p>No pending users found.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {pendingModalUser && (
          <div
            ref={userApprovalModalContainerRef}
            className="cmdk-overlay show"
            role="dialog"
            aria-modal="true"
            aria-labelledby="userApprovalModalTitle"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseUserModal();
            }}
          >
            <div className="modal-card">
              <div className="modal-head">
                <h3 id="userApprovalModalTitle">User approval</h3>
                <p>Review this member and assign a role.</p>
              </div>
              <div className="modal-body">
                <div className="rrow">
                  <span>User</span>
                  <span>{pendingModalUser.full_name || "N/A"}</span>
                </div>
                <div className="rrow">
                  <span>Email</span>
                  <span>{pendingModalUser.email || "N/A"}</span>
                </div>
                <div className="rrow">
                  <span>Designation</span>
                  <span>{pendingModalUser.designation || "N/A"}</span>
                </div>
                <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
                  <label id="role-select-label" htmlFor="user-approval-role">
                    Role
                  </label>
                  <select
                    id="user-approval-role"
                    value={modalRole}
                    onChange={(e) => setModalRole(Number(e.target.value))}
                    disabled={!!processingUserId}
                    aria-labelledby="role-select-label"
                    style={{ width: "100%" }}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-foot">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleRejectFromModal}
                  disabled={!!processingUserId}
                  aria-label="Reject and remove user"
                >
                  {processingUserId === pendingModalUser.user_id &&
                  processingAction === "reject"
                    ? "Rejecting…"
                    : "Reject"}
                </button>
                <button
                  ref={approveFromModalButtonRef}
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApproveFromModal}
                  disabled={!!processingUserId}
                  aria-label="Approve user with selected role"
                >
                  {processingUserId === pendingModalUser.user_id &&
                  processingAction === "approve"
                    ? "Approving…"
                    : "Approve"}
                </button>
              </div>
            </div>
          </div>
        )}

        {hasDatasetsSection && (
          <section>
            <div className="sec-label" style={{ marginBottom: 14 }}>
              Dataset approvals
            </div>
            <div className="rows">
              {datasets.map((dataset) => (
                <div className="drow" key={dataset.dataset_id}>
                  <div className="rt">
                    <span className="badge pending">Pending</span>
                    <h3>{dataset.dataset_title || "N/A"}</h3>
                  </div>
                  <div className="rm">
                    <span>{dataset.creator_name || "N/A"}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ marginLeft: "auto" }}
                      onClick={() => handleViewDataset(dataset.dataset_id)}
                      aria-label={`View ${dataset.dataset_title || "dataset"}`}
                    >
                      View<Ic name="arrow" size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="empty">
                  <p>No pending datasets found.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {!hasUsersSection && !hasDatasetsSection && !error && (
          <div className="empty">
            <p>No pending approvals found.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Approvals;
