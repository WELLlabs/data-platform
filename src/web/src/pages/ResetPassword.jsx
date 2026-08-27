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
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="auth-card">
              <h1 className="display">Reset password</h1>
              <p className="auth-sub">Validating reset link…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenValid || error === "Invalid Link") {
    return (
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="auth-card">
              <h1 className="display">Invalid link</h1>
              <p className="auth-sub">
                This password reset link is invalid or has expired.
              </p>
              <Link
                to="/forgot-password"
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 22 }}
              >
                Request New Reset Link
              </Link>
              <div className="auth-foot">
                <Link to="/signin">Back to Sign In</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="auth-card">
              <h1 className="display">Password reset successfully</h1>
              <p className="auth-sub">
                Your password has been reset. You can now sign in with your new
                password.
              </p>
              <Link
                to="/signin"
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 22 }}
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="auth-wrap">
          <div className="auth-card">
            <h1 className="display">Reset password</h1>
            <p className="auth-sub">Enter your new password below.</p>

            {error && (
              <div
                className="auth-note"
                role="alert"
                style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
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
              </div>

              <div className="field">
                <label htmlFor="confirmPassword">Confirm New Password</label>
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
                {loading ? "Resetting Password…" : "Reset Password"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
