import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { login_options_endpoint, signin_endpoint } from "../api/endpoints";
import { BrandLockup } from "../branding";

const BrandMark = () => <BrandLockup className="auth-brand" />;

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef(null);

  // Redirect authenticated users to dashboard (single navigation; no navigate in handleSubmit)
  useEffect(() => {
    if (!authLoading && user) {
      if (user.profile_complete === false) {
        navigate("/complete-profile", { replace: true });
      } else {
        navigate(`/dashboard?userId=${user.id}`, { replace: true });
      }
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    fetch(login_options_endpoint, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setGoogleEnabled(!!data.google_enabled);
      })
      .catch(() => {});
  }, []);

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
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          setError(
            "The API is not running. Start the backend (Docker compose on port 8000), then try again."
          );
        } else {
          setError("Sign in failed. Please check your credentials.");
        }
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
      <div className="page auth-screen">
        <BrandMark />
        <div className="auth-card">
          <div className="empty" style={{ padding: "20px 0" }}><p>Checking session…</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page auth-screen">
      <BrandMark />
      <div className="auth-card">
        <h1 className="display">Sign in</h1>
        <p className="auth-sub">Access your workspace on the Data Portal.</p>

        {error && (
          <div
            className="auth-note"
            role="alert"
            style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}
          >
            {error}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} method="post">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@ifmr.ac.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              disabled={loading}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="auth-or">or</div>
            <a
              className="gbtn"
              href="/api/auth/google"
            >
              Sign in with Google
            </a>
          </>
        )}

        <div className="auth-foot">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <div className="auth-foot" style={{ marginTop: 6 }}>
          New here? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}

export default SignIn;
