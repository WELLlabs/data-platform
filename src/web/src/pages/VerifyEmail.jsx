import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { verify_endpoint } from "../api/endpoints";

const VerifyEmail = () => {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { verifyUser, isAuthenticated } = useAuth();

  // Extract token from URL on mount
  useEffect(() => {
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      verifyEmail(tokenFromUrl);
    } else {
      setError("Invalid verification link. No token provided.");
      setLoading(false);
    }
  }, [searchParams]);

  const verifyEmail = async (tokenToVerify) => {
    try {
      const response = await fetch(verify_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: tokenToVerify }),
        credentials: "include",
      });

      if (response.ok) {
        setSuccess(true);
        // Refresh user data if already authenticated (user verified while signed in)
        if (isAuthenticated) {
          try {
            await verifyUser();
          } catch (refreshError) {
            console.error("Error refreshing user data after verification:", refreshError);
            // Don't fail verification if refresh fails
          }
        }
      } else {
        let errorMessage = "Verification failed. The link may be invalid or expired.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json();
            errorMessage = errorData?.detail || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = text || errorMessage;
          }
        } catch (parseError) {
          console.error("Error parsing error response:", parseError);
          // Use default error message
        }
        setError(errorMessage);
      }
    } catch (err) {
      console.error("Email verification error:", err);
      setError(
        "Network error. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="auth-card">
              <h1 className="display">Verifying email</h1>
              <p className="auth-sub">Verifying your email address…</p>
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
              <h1 className="display">Email verified successfully</h1>
              <p className="auth-sub">
                Your email address has been verified. You can now sign in to
                your account.
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
            <h1 className="display">Verification failed</h1>
            {error && (
              <div
                className="auth-note"
                role="alert"
                style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}
              >
                {error}
              </div>
            )}
            <p className="auth-sub">
              The verification link is invalid or has expired. Please request a
              new verification email.
            </p>
            <Link
              to="/signin"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 22 }}
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
