import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { signin_endpoint, me_endpoint } from "../api/endpoints";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const formRef = useRef(null);

  // Create hidden iframe on mount
  useEffect(() => {
    const iframe = document.createElement('iframe');
    iframe.name = 'hidden-form-submit';
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    return () => {
      // Cleanup iframe on unmount
      if (iframeRef.current && iframeRef.current.parentNode) {
        iframeRef.current.parentNode.removeChild(iframeRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!formRef.current || !iframeRef.current) {
      setError('Form initialization error. Please refresh the page.');
      setLoading(false);
      return;
    }

    try {
      // Set form action and target to submit to hidden iframe
      // This allows Chrome to detect the form submission for password saving
      formRef.current.action = signin_endpoint;
      formRef.current.method = 'post';
      formRef.current.target = 'hidden-form-submit';
      
      // Set up iframe load handler to detect when form submission completes
      const checkLoginStatus = async () => {
        try {
          // Wait a bit for the form submission to complete
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check if login was successful by calling /api/auth/me
          const verifyResponse = await fetch(me_endpoint, {
            credentials: 'include'
          });
          
          if (verifyResponse.ok) {
            const userData = await verifyResponse.json();
            
            // Store user data in context and localStorage
            signIn(userData);
            
            // Additional delay to allow Chrome to detect successful form submission
            // and prompt to save password before navigation
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Navigate to dashboard with user ID
            navigate(`/dashboard?userId=${userData.id}`);
          } else {
            // Login failed - the /api/auth/me check failed, so login was unsuccessful
            setError('Sign in failed. Please check your credentials.');
            setLoading(false);
          }
        } catch (err) {
          console.error('Error checking login status:', err);
          setError('Network error. Please try again.');
          setLoading(false);
        }
      };

      // Set up iframe load handler
      iframeRef.current.onload = checkLoginStatus;
      
      // Submit the form - this will trigger Chrome's password detection
      formRef.current.submit();
      
      // Also set up a timeout fallback in case iframe onload doesn't fire
      setTimeout(checkLoginStatus, 1000);
      
    } catch (error) {
      console.error('Sign in error:', error);
      setError('Network error. Please try again.');
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


