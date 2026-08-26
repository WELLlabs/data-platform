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
  }, []);

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
  }, [currentPage, isAuthenticated, user?.id]);

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
    <main className="wd-discovery">
      <section className="wd-discovery-head">
        <div className="wd-content">
          <span className="wd-eyebrow">Discover</span>
          <h1>Explore datasets</h1>
          <p>Browse the public research library and datasets available to your organization.</p>
          <div className="wd-discovery-actions">
            <button className="wd-search-button" onClick={() => navigate("/search")}>Search the repository <span aria-hidden="true">⌕</span></button>
            {isAuthenticated && <button className="wd-primary-button" onClick={() => navigate("/create-dataset")}>Publish a dataset <span aria-hidden="true">+</span></button>}
          </div>
        </div>
      </section>
      <section className="wd-content wd-discovery-results">
        <div className="wd-results-heading"><h2>Available datasets</h2><span>{loading ? "Loading" : "Page " + currentPage}</span></div>

      {/* Loading state */}
      {loading ? (
        <div className="wd-state wd-loading">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading datasets...</span>
          </div>
        </div>
      ) : datasets.length === 0 && currentPage === 1 ? (
        <div className="wd-state" role="status">
          No datasets found.
        </div>
      ) : (
        <>
          {/* Dataset cards */}
          <div className="wd-results-list">
            {datasets.map((dataset) => (
              <button key={dataset.dataset_id} className="wd-result-row" onClick={() => handleCardClick(dataset.dataset_id)}>
                <span className="wd-eyebrow">{dataset.private ? "Private" : "Public"}</span>
                <span className="wd-result-main"><strong>{dataset.dataset_title || "Untitled"}</strong><span>{dataset.dataset_description || "No description provided."}</span></span>
                <span className="wd-result-meta">{dataset.organization || "—"}<br />{formatDate(dataset.created_at)}</span>
                <span className="wd-result-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>

          {/* Pagination */}
          <div className="wd-pagination">
            <button
              className="wd-page-button"
              onClick={handlePrevious}
              disabled={currentPage === 1 || loading}
            >
              Previous
            </button>
            <span>{currentPage}</span>
            <button
              className="wd-page-button"
              onClick={handleNext}
              disabled={!hasMore || loading}
            >
              Next
            </button>
          </div>
        </>
      )}
      </section>
    </main>
  );
}

export default Datasets;

