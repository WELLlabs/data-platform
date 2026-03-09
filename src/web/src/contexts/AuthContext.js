import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { me_endpoint, signout_endpoint } from '../api/endpoints';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const verifyUser = useCallback(async () => {
    try {
      const response = await fetch(me_endpoint, {
        method: 'GET',
        credentials: 'include' // Important for cookies
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setIsAuthenticated(true);
        return userData;
      } else if (response.status === 401) {
        // Session expired or invalid - clear any stale data
        console.log('Session expired or invalid, clearing authentication state');
        setUser(null);
        setIsAuthenticated(false);
        return null;
      } else {
        // Other server errors
        console.error('Server error during authentication verification:', response.status);
        setUser(null);
        setIsAuthenticated(false);
        return null;
      }
    } catch (error) {
      console.error('Network error during authentication verification:', error);
      setUser(null);
      setIsAuthenticated(false);
      return null;
    }
  }, []);

  useEffect(() => {
    // Check for existing authentication on app load
    const checkAuth = async () => {
      setLoading(true);
      await verifyUser();
      setLoading(false);
    };

    checkAuth();
  }, [verifyUser]);

  const signIn = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const signOut = async () => {
    try {
      // Call the signout endpoint to clear server-side session
      await fetch(signout_endpoint, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Sign-out request failed (network error):', error);
      }
      throw new Error(
        'Unable to reach the server. You have been signed out on this device; try again when the connection is restored.'
      );
    } finally {
      // Always clear local state regardless of API call success
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const value = {
    user,
    isAuthenticated,
    loading,
    signIn,
    signOut,
    verifyUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
