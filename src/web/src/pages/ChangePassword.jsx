import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { changepassword_endpoint } from "../api/endpoints";

const ChangePassword = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();

  // Handle authentication and query parameters
  useEffect(() => {
    const checkAuthAndApplyParams = async () => {
      try {
        const userData = await verifyUser();
        const userIdParam = searchParams.get("user_id");

        // If no user_id param and user not signed in, redirect to signin
        if (!userIdParam && !userData) {
          navigate("/signin");
          return;
        }

        // If no user_id param but user signed in, use user.id
        if (!userIdParam && userData) {
          setSearchParams({ user_id: userData.id });
          return;
        }

        // If user is not authenticated and no user_id param, redirect to signin
        if (!isAuthenticated && !userIdParam) {
          navigate("/signin");
          return;
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
        const userIdParam = searchParams.get("user_id");
        if (!userIdParam) {
          navigate("/signin");
        }
      }
    };

    checkAuthAndApplyParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Validation checks
  const passwordsMatch = useMemo(
    () => newPassword.length > 0 && newPassword === confirmPassword,
    [newPassword, confirmPassword]
  );

  const newPasswordDifferent = useMemo(
    () => currentPassword.length > 0 && newPassword.length > 0 && currentPassword !== newPassword,
    [currentPassword, newPassword]
  );

  const canSubmit = useMemo(() => {
    return (
      currentPassword.length > 0 &&
      newPassword.length >= 8 &&
      passwordsMatch &&
      newPasswordDifferent &&
      !loading
    );
  }, [currentPassword, newPassword, passwordsMatch, newPasswordDifferent, loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!canSubmit) return;

    setLoading(true);

    try {
      // FormData: current_password and new_password. Session token is sent via
      // the auth cookie (credentials: "include"); backend reads it from the request
      // cookie to invalidate the session after password change.
      const formData = new FormData();
      formData.append("current_password", currentPassword);
      formData.append("new_password", newPassword);

      const response = await fetch(changepassword_endpoint, {
        method: "POST",
        body: formData,
        credentials: "include", // sends session cookie; backend uses it for auth and invalidation
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage =
          errorData?.detail || "Password change failed. Please try again.";
        setError(errorMessage);
        setLoading(false);
        return;
      }

      const data = await response.json();
      setSuccess(data.detail || "Password changed successfully");

      // Clear form fields
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Optionally redirect to profile after a delay
      setTimeout(() => {
        navigate("/profile");
      }, 2000);
    } catch (err) {
      console.error("Password change error:", err);
      setError(
        err?.message || "Network error. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="wrap">
        <div className="auth-wrap">
          <div className="auth-card">
            <h1 className="display">Change password</h1>
            <p className="auth-sub">
              Enter your current password and choose a new one.
            </p>

            {error && (
              <div
                className="auth-note"
                role="alert"
                style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}
              >
                {error}
              </div>
            )}

            {success && (
              <div className="auth-note" role="alert" style={{ marginTop: 16 }}>
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="currentPassword">Current Password</label>
                <input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  placeholder="Enter your current password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setError("");
                  }}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
              </div>

              <div className="field">
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError("");
                  }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={loading}
                />
                {newPassword && newPassword.length < 8 && (
                  <span style={{ fontSize: 12, color: "#9a6b12" }}>
                    Password must be at least 8 characters
                  </span>
                )}
                {newPassword &&
                  currentPassword &&
                  newPassword === currentPassword && (
                    <span style={{ fontSize: 12, color: "#9a6b12" }}>
                      New password must be different from current password
                    </span>
                  )}
              </div>

              <div className="field">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError("");
                  }}
                  autoComplete="new-password"
                  required
                  disabled={loading}
                />
                {!passwordsMatch && confirmPassword && (
                  <span style={{ fontSize: 12, color: "#9a6b12" }}>
                    Passwords do not match
                  </span>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 4 }}
                disabled={!canSubmit}
              >
                {loading ? "Changing Password…" : "Change Password"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;
