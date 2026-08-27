import React from "react";
import { useLocation, Link } from "react-router-dom";

function SignupSuccess() {
  const { state } = useLocation();
  const email = state?.email || "";
  const fullName = state?.fullName || "";
  const hasData = !!(email && fullName);

  return (
    <div className="page">
      <div className="wrap">
        <div className="auth-wrap">
          <div className="auth-card">
            {hasData ? (
              <>
                <h1 className="display">Hello {fullName},</h1>
                <p className="auth-sub">
                  Successfully created an account for your email address{" "}
                  <b>{email}</b>.
                </p>
                <Link
                  to="/signin"
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 22 }}
                >
                  Sign In
                </Link>
              </>
            ) : (
              <>
                <h1 className="display">Navigation to this page is invalid.</h1>
                <p className="auth-sub">
                  Please sign up to create an account, or sign in if you already
                  have one.
                </p>
                <Link
                  to="/signup"
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 22 }}
                >
                  Sign Up
                </Link>
                <div className="auth-foot">
                  Already have an account? <Link to="/signin">Sign in</Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignupSuccess;
