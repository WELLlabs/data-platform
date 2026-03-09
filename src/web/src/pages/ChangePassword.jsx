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
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-5">
            <div className="card auth-card p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Change Password</h2>
              <p className="text-muted text-center mb-4">
                Enter your current password and choose a new one.
              </p>

              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}

              {success && (
                <div className="alert alert-success" role="alert">
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
                <div className="mb-3">
                  <label htmlFor="currentPassword" className="form-label">
                    Current Password{" "}
                    <span style={{ color: "red" }}>(required)</span>
                  </label>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    className="form-control"
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

                <div className="mb-3">
                  <label htmlFor="newPassword" className="form-label">
                    New Password{" "}
                    <span style={{ color: "red" }}>(required)</span>
                  </label>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    className={`form-control ${
                      newPassword && newPassword.length < 8
                        ? "is-invalid"
                        : ""
                    } ${
                      newPassword &&
                      currentPassword &&
                      newPassword === currentPassword
                        ? "is-invalid"
                        : ""
                    }`}
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
                    <div className="invalid-feedback">
                      Password must be at least 8 characters
                    </div>
                  )}
                  {newPassword &&
                    currentPassword &&
                    newPassword === currentPassword && (
                      <div className="invalid-feedback">
                        New password must be different from current password
                      </div>
                    )}
                </div>

                <div className="mb-3">
                  <label htmlFor="confirmPassword" className="form-label">
                    Confirm Password{" "}
                    <span style={{ color: "red" }}>(required)</span>
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    className={`form-control ${
                      confirmPassword && !passwordsMatch ? "is-invalid" : ""
                    }`}
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
                    <div className="invalid-feedback">
                      Passwords do not match
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-100 auth-submit-btn"
                  disabled={!canSubmit}
                >
                  {loading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Changing Password...
                    </>
                  ) : (
                    "Change Password"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ChangePassword;
