import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgot_password_endpoint } from "../api/endpoints";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);

    if (!email || !email.trim()) {
      setError("Email is required");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(forgot_password_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim() }),
        credentials: "include",
      });

      // Always show success message for security (regardless of whether email exists)
      if (response.ok || response.status === 202) {
        setSuccess(true);
      } else {
        const errorData = await response.json();
        setError(
          errorData?.detail || "An error occurred. Please try again later."
        );
      }
    } catch (err) {
      console.error("Forgot password error:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="wrap">
        <div className="auth-wrap">
          <div className="auth-card">
            <h1 className="display">Forgot password</h1>
            <p className="auth-sub">
              Enter your email address and we'll send you a link to reset your
              password.
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
                If an account with that email exists, we've sent a password
                reset link.
              </div>
            )}

            {!success && (
              <form onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@ifmr.ac.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 4 }}
                  disabled={loading}
                >
                  {loading ? "Sending…" : "Send Reset Link"}
                </button>
              </form>
            )}

            <div className="auth-foot">
              <Link to="/signin">Back to Sign In</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
