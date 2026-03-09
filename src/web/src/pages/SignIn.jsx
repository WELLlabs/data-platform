import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { signin_endpoint } from "../api/endpoints";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef(null);

  // Redirect authenticated users to dashboard (single navigation; no navigate in handleSubmit)
  useEffect(() => {
    if (!authLoading && user) {
      navigate(`/dashboard?userId=${user.id}`, { replace: true });
    }
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!formRef.current) {
      setError("Form initialization error. Please refresh the page.");
      setLoading(false);
      return;
    }

    try {
      const formData = new FormData(formRef.current);

      const response = await fetch(signin_endpoint, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        setError("Sign in failed. Please check your credentials.");
        setLoading(false);
        return;
      }

      const userData = await response.json();
      signIn(userData);
      setLoading(false);

      // Offer to save password via Credential Management API when available (secure context)
      const PasswordCredentialCtor =
        typeof window !== "undefined" ? window.PasswordCredential : null;
      if (
        typeof navigator !== "undefined" &&
        navigator.credentials &&
        typeof navigator.credentials.store === "function" &&
        PasswordCredentialCtor
      ) {
        try {
          const credential = new PasswordCredentialCtor({
            id: email,
            password,
            name: email,
          });
          await navigator.credentials.store(credential);
        } catch (storeErr) {
          // User may have dismissed; do not break the sign-in flow
        }
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="bg-wave">
        <section className="container py-5">
          <div className="row justify-content-center">
            <div className="col-12 text-center">
              <div className="spinner-border" role="status" aria-label="Checking session">
                <span className="visually-hidden">Checking session...</span>
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
              <h2 className="mb-3 text-center auth-title">Sign In</h2>
              <p className="text-muted text-center mb-4">Welcome back! Please sign in to continue.</p>
              <form ref={formRef} onSubmit={handleSubmit} method="post">
                {error && (
                  <div className="alert alert-danger" role="alert">
                    {error}
                  </div>
                )}
                <div className="mb-3">
                  <label htmlFor="email" className="form-label">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    className="form-control"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                    disabled={loading}
                  />
                </div>
                <div className="mb-3">
                  <label htmlFor="password" className="form-label">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    className="form-control"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
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
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Signing In...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </form>

              <div className="text-center mt-3">
                <Link to="/forgot-password" className="text-muted text-decoration-none">
                  Forgot password?
                </Link>
              </div>

              <div className="text-center mt-4">
                <div className="text-muted mb-2">Don&apos;t have an account yet</div>
                <Link to="/signup" className="btn btn-outline-primary w-100">Sign Up</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SignIn;
