import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  approve_user_endpoint,
  pending_approvals_endpoint,
  reject_user_endpoint,
  approve_dataset_endpoint,
  reject_dataset_endpoint,
} from "../api/endpoints";
import Ic from "../components/wd/Icons";

const ROLE_OPTIONS = [
  { value: 0, label: "Member" },
  { value: 1, label: "Admin" },
  { value: 2, label: "Reviewer" },
];

function initials(name) {
  if (!name) return "U";
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "U";
}

function Approvals() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [hasUsersSection, setHasUsersSection] = useState(false);
  const [hasDatasetsSection, setHasDatasetsSection] = useState(false);
  const [processingUserId, setProcessingUserId] = useState(null);
  const [processingDatasetId, setProcessingDatasetId] = useState(null);
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

  const handleApproveDataset = async (datasetId) => {
    if (!datasetId) return;
    try {
      setProcessingDatasetId(datasetId);
      setError("");
      const response = await fetch(approve_dataset_endpoint(datasetId), {
        method: "PUT",
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = "Failed to approve dataset.";
        try {
          const errorData = await response.json();
          errorMessage = errorData?.detail || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      await fetchPendingApprovals();
    } catch (err) {
      setError(err.message || "Unable to approve dataset.");
    } finally {
      setProcessingDatasetId(null);
    }
  };

  const handleRejectDataset = async (datasetId) => {
    if (!datasetId) return;
    if (!window.confirm("Reject and remove this unpublished dataset?")) return;
    try {
      setProcessingDatasetId(datasetId);
      setError("");
      const response = await fetch(reject_dataset_endpoint(datasetId), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = "Failed to reject dataset.";
        try {
          const errorData = await response.json();
          errorMessage = errorData?.detail || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      await fetchPendingApprovals();
    } catch (err) {
      setError(err.message || "Unable to reject dataset.");
    } finally {
      setProcessingDatasetId(null);
    }
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

  const totalPending = users.length + datasets.length;

  return (
    <div className="page">
      <div className="wrap" style={{ padding: "48px 0 88px" }}>
        <span className="eyebrow">Review queue</span>
        <div className="appr-head" style={{ marginTop: 8 }}>
          <div>
            <h2 className="section-title">Approvals</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              Review membership requests and unpublished datasets for your organization.
            </p>
          </div>
          <span className="badge pending dot" style={{ fontSize: 12.5 }}>
            {totalPending} pending
          </span>
        </div>

        {error && (
          <div className="attn-card warn" role="alert" style={{ margin: "20px 0" }}>
            <div className="aic"><Ic name="warn" size={18} sw={2} /></div>
            <div><b>{error}</b></div>
          </div>
        )}

        <div className="appr-grid" style={{ marginTop: 24 }}>
        {hasUsersSection && (
          <section className="dash-panel appr-panel" style={{ marginBottom: 0 }}>
            <div className="panel-head">
              <div className="sec-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                Membership requests
                <span className={"count-pill" + (users.length === 0 ? " zero" : "")}>{users.length}</span>
              </div>
            </div>
            <div>
              {users.map((pendingUser) => (
                <div className="arow" key={pendingUser.user_id}>
                  <span className="aav">{initials(pendingUser.full_name || pendingUser.email)}</span>
                  <div className="amain">
                    <b>{pendingUser.full_name || "Unnamed user"}</b>
                    <span className="asub">
                      <span>{pendingUser.email || "No email"}</span>
                      {pendingUser.designation && <span className="mono">{pendingUser.designation}</span>}
                    </span>
                  </div>
                  <div className="aact">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleOpenUserModal(pendingUser)}
                      disabled={processingUserId === pendingUser.user_id}
                      aria-label={`Review ${pendingUser.full_name || pendingUser.email || "user"}`}
                    >
                      {processingUserId === pendingUser.user_id ? "Working…" : "Review"}
                    </button>
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="empty" style={{ padding: "40px 0" }}>
                  <div className="eic"><Ic name="check" size={20} /></div>
                  <p style={{ marginBottom: 0 }}>No membership requests to review.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {hasDatasetsSection && (
          <section className="dash-panel appr-panel">
            <div className="panel-head">
              <div className="sec-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                Dataset approvals
                <span className={"count-pill" + (datasets.length === 0 ? " zero" : "")}>{datasets.length}</span>
              </div>
            </div>
            <div>
              {datasets.map((dataset) => (
                <div className="arow" key={dataset.dataset_id}>
                  <span className="aic-file"><Ic name="file" size={18} /></span>
                  <div className="amain">
                    <b>{dataset.dataset_title || "Untitled dataset"}</b>
                    <span className="asub">
                      <span>by {dataset.creator_name || "Unknown"}</span>
                    </span>
                  </div>
                  <div className="aact">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleViewDataset(dataset.dataset_id)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleRejectDataset(dataset.dataset_id)}
                      disabled={processingDatasetId === dataset.dataset_id}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleApproveDataset(dataset.dataset_id)}
                      disabled={processingDatasetId === dataset.dataset_id}
                    >
                      {processingDatasetId === dataset.dataset_id ? "Working…" : "Approve"}
                    </button>
                  </div>
                </div>
              ))}
              {datasets.length === 0 && (
                <div className="empty" style={{ padding: "40px 0" }}>
                  <div className="eic"><Ic name="check" size={20} /></div>
                  <p style={{ marginBottom: 0 }}>No datasets waiting for approval.</p>
                </div>
              )}
            </div>
          </section>
        )}
        </div>

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
                <h3 id="userApprovalModalTitle">Review membership request</h3>
                <p>Confirm this member and assign their role.</p>
              </div>
              <div className="modal-body">
                <div className="rrow">
                  <span className="k">Name</span>
                  <span className="v">{pendingModalUser.full_name || "N/A"}</span>
                </div>
                <div className="rrow">
                  <span className="k">Email</span>
                  <span className="v">{pendingModalUser.email || "N/A"}</span>
                </div>
                <div className="rrow">
                  <span className="k">Designation</span>
                  <span className="v">{pendingModalUser.designation || "N/A"}</span>
                </div>
                <div className="field" style={{ marginTop: 18, marginBottom: 0 }}>
                  <label id="role-select-label" htmlFor="user-approval-role">
                    Assign role
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
                    : "Approve member"}
                </button>
              </div>
            </div>
          </div>
        )}

        {!hasUsersSection && !hasDatasetsSection && !error && (
          <div className="empty">
            <div className="eic"><Ic name="check" size={22} /></div>
            <h3>All clear</h3>
            <p>There are no pending approvals right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Approvals;
