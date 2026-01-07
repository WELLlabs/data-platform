import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { user_datasets_endpoint } from "../api/endpoints";

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();
  const paramsSetRef = useRef(false);
  const lastFetchedUserIdRef = useRef(null);
  const limit = 10;

  // First useEffect: Handle authentication and URL params (runs once on mount)
  useEffect(() => {
    const checkAuthAndApplyParams = async () => {
      try {
        // Verify user authentication with API
        const userData = await verifyUser();
        
        if (!userData) {
          navigate('/signin');
          return;
        }

        // Auto-apply query parameters if not present (only once)
        if (!paramsSetRef.current) {
          const currentUserId = searchParams.get('userId');
          if (!currentUserId || currentUserId !== userData.id) {
            setSearchParams({ userId: userData.id });
          }
          paramsSetRef.current = true;
        }

      } catch (error) {
        console.error('Error checking authentication:', error);
        navigate('/signin');
      } finally {
        setLoading(false);
      }
    };

    checkAuthAndApplyParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, verifyUser]);

  // Second useEffect: Fetch datasets when user.id is available, page changes, or apikey changes
  useEffect(() => {
    const fetchUserDatasets = async (userId) => {
      try {
        setDatasetsLoading(true);
        const offset = (currentPage - 1) * limit;
        
        // Build query parameters
        const params = new URLSearchParams({
          user_id: userId,
          limit: limit.toString(),
          offset: offset.toString(),
        });

        // If user is signed in, add apikey
        if (isAuthenticated && user?.apikey) {
          params.append("apikey", user.apikey);
        }

        const response = await fetch(
          `${user_datasets_endpoint}?${params.toString()}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch datasets: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Check if we have more data
        if (data.length === 0) {
          setHasMore(false);
          // If we're on page 1, set empty datasets
          // If we're on page > 1, keep previous datasets (don't update)
          if (currentPage === 1) {
            setDatasets([]);
          }
          // If currentPage > 1, don't update datasets to keep previous page data
        } else {
          setHasMore(data.length === limit);
          setDatasets(data || []);
        }
      } catch (error) {
        console.error('Error fetching user datasets:', error);
        setDatasets([]);
        setHasMore(false);
      } finally {
        setDatasetsLoading(false);
      }
    };

    // Fetch if user.id exists
    if (user?.id) {
      // Reset pagination when user changes
      if (lastFetchedUserIdRef.current !== user.id) {
        setCurrentPage(1);
        setHasMore(true);
        lastFetchedUserIdRef.current = user.id;
      }
      fetchUserDatasets(user.id);
    }
  }, [user?.id, currentPage, isAuthenticated, user?.apikey]);

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

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const handleCardClick = (datasetId) => {
    navigate(`/dataset-info?dataset_id=${datasetId}`);
  };

  const handlePrevious = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      setHasMore(true); // Reset hasMore when navigating
    }
  };

  const handleNext = () => {
    if (hasMore) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="container py-5">
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="text-start m-0">Welcome {user.full_name}</h2>
        </div>
        <div className="col-auto">
          <button
            className="btn"
            style={{ backgroundColor: '#0d983b', color: '#fff' }}
            onClick={() => navigate('/create-dataset')}
          >
            Upload
          </button>
        </div>
      </div>

      {datasetsLoading ? (
        <div className="text-center py-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading datasets...</span>
          </div>
        </div>
      ) : datasets.length === 0 && currentPage === 1 ? (
        <div className="alert alert-info" role="alert">
          No datasets found. Create your first dataset by clicking the upload button.
        </div>
      ) : (
        <>
          {/* Dataset cards */}
          <div className="row">
            {datasets.map((dataset) => (
              <div key={dataset.dataset_id} className="col-md-6 col-lg-4 mb-4">
                <div
                  className="card h-100"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleCardClick(dataset.dataset_id)}
                >
                  <div className="card-body">
                    <h5 className="card-title">{dataset.dataset_title || "Untitled"}</h5>
                    <p className="card-text">
                      <small className="text-muted">
                        {dataset.dataset_description || "No description"}
                      </small>
                    </p>
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Created:</strong> {formatDate(dataset.created_at)}
                      </small>
                    </div>
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Private:</strong>{" "}
                        {dataset.private ? (
                          <span className="badge bg-warning">Private</span>
                        ) : (
                          <span className="badge bg-success">Public</span>
                        )}
                      </small>
                    </div>
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Downloads:</strong> {dataset.downloads ?? 0}
                      </small>
                    </div>
                    {dataset.tags && Array.isArray(dataset.tags) && dataset.tags.length > 0 && (
                      <div className="mb-2">
                        <small className="text-muted">
                          <strong>Tags:</strong> {dataset.tags.join(", ")}
                        </small>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="d-flex justify-content-center align-items-center mt-4">
            <button
              className="btn btn-outline-secondary me-3"
              onClick={handlePrevious}
              disabled={currentPage === 1 || datasetsLoading}
            >
              Previous
            </button>
            <span className="mx-3">{currentPage}</span>
            <button
              className="btn btn-outline-secondary ms-3"
              onClick={handleNext}
              disabled={!hasMore || datasetsLoading}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
