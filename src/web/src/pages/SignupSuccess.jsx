import React from "react";
import { useLocation, Link } from "react-router-dom";

function SignupSuccess() {
  const { state } = useLocation();
  const email = state?.email || "";
  const fullName = state?.fullName || "";
  const hasData = !!(email && fullName);

  return (
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-6">
            <div className="card auth-card p-4 p-md-5 text-center">
              {hasData ? (
                <>
                  <h2 className="mb-3 auth-title">Hello {fullName},</h2>
                  <p className="lead text-center">
                    Successfully created an account for your email address <span className="fw-bold">{email}</span>.
                  </p>
                  <p className="lead text-center mt-3">
                    <Link to="/signin">Sign In</Link>.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="mb-3 auth-title">Navigation to this page is invalid.</h2>
                  <p className="lead text-center">
                    Please <Link to="/signup">Sign Up</Link> or <Link to="/signin">Sign In</Link>.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SignupSuccess;
