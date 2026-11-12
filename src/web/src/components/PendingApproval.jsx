import React from "react";
import { useAuth } from "../contexts/AuthContext";
import Ic from "./wd/Icons";

export const PENDING_APPROVAL_MESSAGE =
  "Pending approval by admin of the organisation";

/**
 * True when a signed-in user has not yet been approved as a member of their
 * organisation (verified !== true). Superusers are never blocked.
 * Frontend hint only: the API enforces the same rule.
 */
export function isPendingOrgApproval(user) {
  return !!user && user.is_superuser !== true && user.verified !== true;
}

/** Blank interface shown to members awaiting organisation approval. */
export function PendingApprovalNotice() {
  return (
    <div className="empty pending-approval" style={{ padding: "96px 0" }}>
      <div className="eic">
        <Ic name="lock" size={22} />
      </div>
      <h3 className="display">{PENDING_APPROVAL_MESSAGE}</h3>
    </div>
  );
}

/**
 * Route wrapper: renders a blank interface for signed-in members awaiting
 * organisation approval. Signed-out visitors pass through so the page can
 * handle its own sign-in redirect.
 */
function RequireOrgApproval({ children }) {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) return children;
  if (isAuthenticated && isPendingOrgApproval(user)) {
    return (
      <div className="page">
        <div className="wrap">
          <PendingApprovalNotice />
        </div>
      </div>
    );
  }
  return children;
}

export default RequireOrgApproval;
