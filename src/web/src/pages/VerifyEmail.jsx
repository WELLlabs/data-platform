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
      <div className="bg-wave">
        <section className="container py-5">
          <div className="row justify-content-center">
            <div className="col-12 col-sm-10 col-md-8 col-lg-5">
              <div className="card auth-card p-4 p-md-5 text-center">
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Verifying email...</span>
                </div>
                <p className="mt-3 text-muted">Verifying your email address...</p>
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
                <h2 className="mb-3 auth-title">Email Verified Successfully</h2>
                <p className="text-muted mb-4">
                  Your email address has been verified. You can now sign in to
                  your account.
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
            <div className="card auth-card p-4 p-md-5 text-center">
              <h2 className="mb-3 auth-title">Verification Failed</h2>
              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}
              <p className="text-muted mb-4">
                The verification link is invalid or has expired. Please request a
                new verification email.
              </p>
              <Link to="/signin" className="btn btn-primary w-100">
                Go to Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default VerifyEmail;
