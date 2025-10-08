import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function Profile() {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();

  useEffect(() => {
    const checkAuthAndApplyParams = async () => {
      try {
        // Verify user authentication with API
        const userData = await verifyUser();
        
        if (!userData) {
          navigate('/signin');
          return;
        }

        // Auto-apply query parameters if not present
        const currentUserId = searchParams.get('userId');
        if (!currentUserId || currentUserId !== userData.id) {
          setSearchParams({ userId: userData.id });
        }

      } catch (error) {
        console.error('Error checking authentication:', error);
        navigate('/signin');
      } finally {
        setLoading(false);
      }
    };

    checkAuthAndApplyParams();
  }, [navigate, searchParams, setSearchParams, verifyUser]);

  if (loading) {
    return (
      <div className="container py-5">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to signin
  }

  return (
    <div className="container py-5">
      <div className="row">
        <div className="col-12">
          <h2>Profile</h2>
          <p>Profile page coming soon...</p>
        </div>
      </div>
    </div>
  );
}

export default Profile;
