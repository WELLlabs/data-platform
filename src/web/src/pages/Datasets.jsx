import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { datasets_endpoint } from "../api/endpoints";

function Datasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();
  const limit = 10;

  // Check authentication and set userid query parameter if signed in
  useEffect(() => {
    const checkAuthAndSetParams = async () => {
      try {
        const userData = await verifyUser();
        
        if (userData) {
          // User is signed in, set userid query parameter
          const currentUserId = searchParams.get("userid");
          if (!currentUserId || currentUserId !== userData.id) {
            setSearchParams({ userid: userData.id });
          }
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
      }
    };

    checkAuthAndSetParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyUser]);

  // Fetch datasets when page changes or authentication state changes
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        setLoading(true);
        const offset = (currentPage - 1) * limit;
        
        // Build query parameters
        const params = new URLSearchParams({
          limit: limit.toString(),
          offset: offset.toString(),
        });

        // If user is signed in, add apikey
        if (isAuthenticated && user?.apikey) {
          params.append("apikey", user.apikey);
        }

        const response = await fetch(
          `${datasets_endpoint}?${params.toString()}`,
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
        console.error("Error fetching datasets:", error);
        setDatasets([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    fetchDatasets();
  }, [currentPage, isAuthenticated, user?.apikey]);

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
      {/* Header with title and upload button */}
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="text-start m-0">Datasets</h2>
        </div>
        <div className="col-auto">
          <button
            className="btn"
            style={{ backgroundColor: "#0d983b", color: "#fff" }}
            onClick={() => navigate("/create-dataset")}
          >
            Upload
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading datasets...</span>
          </div>
        </div>
      ) : datasets.length === 0 && currentPage === 1 ? (
        <div className="alert alert-info" role="alert">
          No datasets found.
        </div>
      ) : (
        <>
          {/* Dataset cards */}
          <div className="row">
            {datasets.map((dataset) => (
              <div key={dataset.dataset_id} className="col-12 mb-4">
                <div
                  className="card h-100"
                  style={{ cursor: "pointer" }}
                  onClick={() => handleCardClick(dataset.dataset_id)}
                >
                  <div className="card-body">
                    <h5 className="card-title">
                      {dataset.dataset_title || "Untitled"}
                    </h5>
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
                    {dataset.organization && (
                      <div className="mb-2">
                        <small className="text-muted">
                          <strong>Organization:</strong> {dataset.organization}
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
              disabled={currentPage === 1 || loading}
            >
              Previous
            </button>
            <span className="mx-3">{currentPage}</span>
            <button
              className="btn btn-outline-secondary ms-3"
              onClick={handleNext}
              disabled={!hasMore || loading}
            >
              Next
            </button>
          </div>

          {/* End of datasets message */}
          {(!hasMore || (datasets.length === 0 && currentPage > 1)) && (
            <div className="text-center mt-3">
              <small className="text-muted">End of datasets</small>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Datasets;

