import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { signin_endpoint } from "../api/endpoints";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Create form data for the API call
      const formData = new FormData();
      formData.append('email', email);
      formData.append('password', password);

      // Make API call to signin endpoint
      const response = await fetch(signin_endpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include' // Important for cookies
      });

      if (response.ok) {
        const userData = await response.json();
        
        // Store user data in context and localStorage
        signIn(userData);
        
        // Navigate to dashboard with user ID
        navigate(`/dashboard?userId=${userData.id}`);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || 'Sign in failed. Please check your credentials.');
      }
    } catch (error) {
      console.error('Sign in error:', error);
      setError('Network error. Please try again.');
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
              <h2 className="mb-3 text-center auth-title">Sign In</h2>
              <p className="text-muted text-center mb-4">Welcome back! Please sign in to continue.</p>
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="alert alert-danger" role="alert">
                    {error}
                  </div>
                )}
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
                    disabled={loading}
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
                    'Sign In'
                  )}
                </button>
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


