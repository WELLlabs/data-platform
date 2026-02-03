import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  reset_password_endpoint,
  reset_password_validate_endpoint,
} from "../api/endpoints";

const ResetPassword = () => {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Extract token from URL on mount
  useEffect(() => {
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      validateToken(tokenFromUrl);
    } else {
      setError("Invalid Link");
      setValidating(false);
    }
  }, [searchParams]);

  const validateToken = async (tokenToValidate) => {
    try {
      const response = await fetch(reset_password_validate_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: tokenToValidate }),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        if (data.valid) {
          setTokenValid(true);
        } else {
          setError("Invalid Link");
        }
      } else {
        setError("Invalid Link");
      }
    } catch (err) {
      console.error("Token validation error:", err);
      setError("Invalid Link");
    } finally {
      setValidating(false);
    }
  };

  // Validation checks
  const passwordsMatch = useMemo(
    () => newPassword.length > 0 && newPassword === confirmPassword,
    [newPassword, confirmPassword]
  );

  const canSubmit = useMemo(() => {
    return (
      tokenValid &&
      newPassword.length >= 8 &&
      passwordsMatch &&
      !loading
    );
  }, [tokenValid, newPassword, passwordsMatch, loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!canSubmit) return;

    setLoading(true);

    try {
      const response = await fetch(reset_password_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: token,
          password: newPassword,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage =
          errorData?.detail || "Password reset failed. Please try again.";
        setError(errorMessage);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("Reset password error:", err);
      setError(
        err?.message || "Network error. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="bg-wave">
        <section className="container py-5">
          <div className="row justify-content-center">
            <div className="col-12 col-sm-10 col-md-8 col-lg-5">
              <div className="card auth-card p-4 p-md-5 text-center">
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Validating link...</span>
                </div>
                <p className="mt-3 text-muted">Validating reset link...</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!tokenValid || error === "Invalid Link") {
    return (
      <div className="bg-wave">
        <section className="container py-5">
          <div className="row justify-content-center">
            <div className="col-12 col-sm-10 col-md-8 col-lg-5">
              <div className="card auth-card p-4 p-md-5 text-center">
                <h2 className="mb-3 auth-title">Invalid Link</h2>
                <p className="text-muted mb-4">
                  This password reset link is invalid or has expired.
                </p>
                <Link to="/forgot-password" className="btn btn-primary w-100">
                  Request New Reset Link
                </Link>
                <div className="mt-3">
                  <Link to="/signin" className="btn btn-outline-primary w-100">
                    Back to Sign In
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-wave">
        <section className="container py-5">
          <div className="row justify-content-center">
            <div className="col-12 col-sm-10 col-md-8 col-lg-5">
              <div className="card auth-card p-4 p-md-5 text-center">
                <h2 className="mb-3 auth-title">Password Reset Successfully</h2>
                <p className="text-muted mb-4">
                  Your password has been reset. You can now sign in with your new
                  password.
                </p>
                <Link to="/signin" className="btn btn-primary w-100">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-5">
            <div className="card auth-card p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Reset Password</h2>
              <p className="text-muted text-center mb-4">
                Enter your new password below.
              </p>

              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
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
                      newPassword && newPassword.length < 8 ? "is-invalid" : ""
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
                </div>

                <div className="mb-3">
                  <label htmlFor="confirmPassword" className="form-label">
                    Confirm New Password{" "}
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
                      Resetting Password...
                    </>
                  ) : (
                    "Reset Password"
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

export default ResetPassword;
