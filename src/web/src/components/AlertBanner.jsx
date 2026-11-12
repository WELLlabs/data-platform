import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  pending_approvals_endpoint,
  send_verify_email_endpoint,
} from "../api/endpoints";
import Ic from "./wd/Icons";
import { useToast } from "./wd/Toast";

/**
 * Dashboard alert banner. Checks run in order:
 * 1. Email not verified → "Pending verification of email address" + Resend email.
 * 2. Otherwise, admins (role 1) → pending member approvals.
 * 3. Otherwise, admins or reviewers (role 1 or 2) → pending dataset approvals.
 */
function AlertBanner({ user }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState({ users: 0, datasets: 0 });
  const [sending, setSending] = useState(false);

  const emailVerified = user?.is_verified === true;
  const role = Number(user?.role);
  const isAdmin = role === 1;
  const isApprover = role === 1 || role === 2;
  const canCheckApprovals =
    !!user && emailVerified && user.verified === true && isApprover;

  useEffect(() => {
    if (!canCheckApprovals) {
      setPending({ users: 0, datasets: 0 });
      return undefined;
    }
    let cancelled = false;
    fetch(pending_approvals_endpoint, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPending({
          users: Array.isArray(data.users) ? data.users.length : 0,
          datasets: Array.isArray(data.datasets) ? data.datasets.length : 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canCheckApprovals, user?.id, user?.role]);

  const resendEmail = async () => {
    if (!user?.email || sending) return;
    setSending(true);
    try {
      const response = await fetch(send_verify_email_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
        credentials: "include",
      });
      if (response.ok) {
        toast("Verification email sent. Please check your inbox.");
      } else {
        toast("Failed to send verification email. Please try again.");
      }
    } catch {
      toast("Network error. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  const alerts = [];
  if (!emailVerified) {
    alerts.push({
      key: "email",
      tone: "info",
      icon: "mail",
      message: "Pending verification of email address",
      action: (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={resendEmail}
          disabled={sending}
        >
          {sending ? "Sending…" : "Resend email"}
        </button>
      ),
    });
  } else {
    if (isAdmin && pending.users > 0) {
      alerts.push({
        key: "members",
        tone: "warn",
        icon: "org",
        message: "New members are awaiting approval to join the organisation.",
      });
    }
    if (isApprover && pending.datasets > 0) {
      alerts.push({
        key: "datasets",
        tone: "warn",
        icon: "warn",
        message: "New datasets are awaiting approval to be published.",
      });
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="alert-banner-stack">
      {alerts.map((a) => (
        <div key={a.key} className={`alert-banner ${a.tone}`} role="alert">
          <span className="alert-banner-ic">
            <Ic name={a.icon} size={17} sw={2} />
          </span>
          <span className="alert-banner-msg">{a.message}</span>
          {a.action ||
            (a.key !== "email" && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate("/approvals")}
              >
                Review
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

export default AlertBanner;
