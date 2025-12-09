import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { user_datasets_endpoint } from "../api/endpoints";

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();
  const paramsSetRef = useRef(false);
  const lastFetchedUserIdRef = useRef(null);

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

  // Second useEffect: Fetch datasets when user.id is available
  useEffect(() => {
    const fetchUserDatasets = async (userId) => {
      try {
        setDatasetsLoading(true);
        const response = await fetch(
          `${user_datasets_endpoint}?user_id=${encodeURIComponent(userId)}&limit=10&offset=0`,
          { credentials: "include" }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch datasets: ${response.statusText}`);
        }

        const data = await response.json();
        setDatasets(data || []);
      } catch (error) {
        console.error('Error fetching user datasets:', error);
        setDatasets([]);
      } finally {
        setDatasetsLoading(false);
      }
    };

    // Only fetch if user.id exists and we haven't fetched yet for this user
    if (user?.id && lastFetchedUserIdRef.current !== user.id) {
      fetchUserDatasets(user.id);
      lastFetchedUserIdRef.current = user.id;
    }
  }, [user?.id]);

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
      ) : datasets.length === 0 ? (
        <div className="alert alert-info" role="alert">
          No datasets found. Create your first dataset by clicking the upload button.
        </div>
      ) : (
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
      )}
    </div>
  );
}

export default Dashboard;
