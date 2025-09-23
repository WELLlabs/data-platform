import React, { useState } from "react";
import { Link } from "react-router-dom";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    // Placeholder submit; integrate API later
  };

  return (
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-5">
            <div className="card auth-card p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Sign In</h2>
              <p className="text-muted text-center mb-4">Welcome back! Please sign in to continue.</p>
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label htmlFor="email" className="form-label">Email</label>
                  <input
                    id="email"
                    type="email"
                    className="form-control"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label htmlFor="password" className="form-label">Password</label>
                  <input
                    id="password"
                    type="password"
                    className="form-control"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary w-100 auth-submit-btn">Sign In</button>
              </form>

              <div className="text-center mt-4">
                <div className="text-muted mb-2">Don't have an account yet</div>
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


