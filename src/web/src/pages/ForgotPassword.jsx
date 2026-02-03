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
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-5">
            <div className="card auth-card p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Forgot Password</h2>
              <p className="text-muted text-center mb-4">
                Enter your email address and we'll send you a link to reset your
                password.
              </p>

              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}

              {success && (
                <div className="alert alert-success" role="alert">
                  If an account with that email exists, we've sent a password
                  reset link.
                </div>
              )}

              {!success && (
                <form onSubmit={handleSubmit} noValidate>
                  <div className="mb-3">
                    <label htmlFor="email" className="form-label">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      className="form-control"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary w-100 auth-submit-btn"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        ></span>
                        Sending...
                      </>
                    ) : (
                      "Send Reset Link"
                    )}
                  </button>
                </form>
              )}

              <div className="text-center mt-4">
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
};

export default ForgotPassword;
