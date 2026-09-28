import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const ALLOWED_WHEN_INCOMPLETE = new Set([
    "/complete-profile",
    "/signin",
    "/signup",
    "/signupsuccess",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
]);

function ProfileCompleteGate({ children }) {
    const { user, isAuthenticated, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return children;
    }

    if (
        isAuthenticated &&
        user &&
        user.profile_complete === false &&
        !ALLOWED_WHEN_INCOMPLETE.has(location.pathname)
    ) {
        return <Navigate to="/complete-profile" replace />;
    }

    return children;
}

export default ProfileCompleteGate;
