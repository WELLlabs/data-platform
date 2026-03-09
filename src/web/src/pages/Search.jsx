import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Collapse } from "reactstrap";
import { useAuth } from "../contexts/AuthContext";
import {
  list_organizations_endpoint,
  search_endpoint,
} from "../api/endpoints";

const LIMIT = 10;

function Search() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [query, setQuery] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchWithinOrg, setSearchWithinOrg] = useState(false);
  const [orgTextbox, setOrgTextbox] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [organizations, setOrganizations] = useState([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [result, setResult] = useState([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch organization list for dropdown
  useEffect(() => {
    let cancelled = false;
    const fetchOrganizations = async () => {
      setOrganizationsLoading(true);
      try {
        const resp = await fetch(list_organizations_endpoint, {
          credentials: "include",
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        const items = data?.items ?? [];
        if (!cancelled) setOrganizations(Array.isArray(items) ? items : []);
      } catch {
        if (!cancelled) setOrganizations([]);
      } finally {
        if (!cancelled) setOrganizationsLoading(false);
      }
    };
    fetchOrganizations();
    return () => { cancelled = true; };
  }, []);

  // Default organization to signed-in user's organization (id)
  useEffect(() => {
    if (isAuthenticated && user?.organization) {
      setOrgTextbox((prev) => (prev === "" ? user.organization : prev));
    } else {
      setOrgTextbox("");
    }
  }, [isAuthenticated, user?.organization]);

  const runSearch = useCallback(
    async (page = 1) => {
      const trimmedQuery = query?.trim() ?? "";
      if (!trimmedQuery) {
        setResult([]);
        setTotal(0);
        setError("");
        setHasSearched(true);
        return;
      }

      setLoading(true);
      setError("");

      const offset = (page - 1) * LIMIT;
      const params = new URLSearchParams();
      params.set("query", trimmedQuery);
      params.set("limit", String(LIMIT));
      params.set("offset", String(offset));

      if (searchWithinOrg && orgTextbox?.trim()) {
        params.set("organization_id", orgTextbox.trim());
      }
      if (startDate?.trim()) {
        const startVal = startDate.trim().endsWith("T")
          ? startDate.trim()
          : startDate.trim() + "T00:00:00";
        params.set("start_date", startVal);
      }
      if (endDate?.trim()) {
        const endVal = endDate.trim().endsWith("T")
          ? endDate.trim()
          : endDate.trim() + "T23:59:59";
        params.set("end_date", endVal);
      }
      if (isAuthenticated && user?.apikey) {
        params.set("apikey", user.apikey);
      }

      try {
        const response = await fetch(
          `${search_endpoint}?${params.toString()}`,
          { credentials: "include" }
        );
        if (!response.ok) {
          throw new Error(`Search failed: ${response.statusText}`);
        }
        const data = await response.json();
        setResult(data.result ?? []);
        setTotal(data.total ?? 0);
        setCurrentPage(page);
        setHasSearched(true);
      } catch (err) {
        console.error("Search error:", err);
        setError(err.message || "Search failed. Please try again.");
        setResult([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [
      query,
      searchWithinOrg,
      orgTextbox,
      startDate,
      endDate,
      isAuthenticated,
      user?.apikey,
    ]
  );

  const handleSearchClick = () => {
    setCurrentPage(1);
    runSearch(1);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchClick();
    }
  };

  const handlePrevious = () => {
    if (currentPage > 1) {
      runSearch(currentPage - 1);
    }
  };

  const handleNext = () => {
    const hasMore = currentPage * LIMIT < total;
    if (hasMore) {
      runSearch(currentPage + 1);
    }
  };

  const handleCardClick = (item) => {
    if (item?.dataset_id) {
      navigate(`/dataset-info?dataset_id=${encodeURIComponent(item.dataset_id)}`);
    }
  };

  const handleAdvancedToggle = () => {
    setAdvancedOpen((prev) => !prev);
  };

  const hasMore = currentPage * LIMIT < total;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-12 col-lg-8">
          <h2 className="section-title text-center mb-4">Search</h2>

          {/* Search bar card */}
          <div className="card auth-card shadow-sm mb-3">
            <div className="card-body">
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter search terms"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label="Search query"
                />
                <button
                  type="button"
                  className="btn btn-search"
                  onClick={handleSearchClick}
                  disabled={loading}
                  aria-label="Search"
                >
                  Search
                </button>
              </div>
            </div>
          </div>

          {/* Advanced toggle */}
          <div className="mb-2">
            <button
              type="button"
              className="btn btn-link p-0 text-decoration-none d-flex align-items-center gap-1"
              onClick={handleAdvancedToggle}
              aria-expanded={advancedOpen}
              aria-controls="advanced-search-content"
              aria-label="Advanced search options"
              style={{ color: "var(--deep-blue)" }}
            >
              <i
                className={`bi ${advancedOpen ? "bi-chevron-down" : "bi-chevron-right"}`}
                aria-hidden="true"
              />
              <span>Advanced</span>
            </button>
          </div>

          <Collapse isOpen={advancedOpen}>
            <div
              id="advanced-search-content"
              className="card auth-card shadow-sm mb-4"
            >
              <div className="card-body">
                <div className="form-check mb-3">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="search-within-org"
                    checked={searchWithinOrg}
                    onChange={(e) => setSearchWithinOrg(e.target.checked)}
                    aria-label="Search within organization"
                  />
                  <label
                    className="form-check-label d-flex align-items-center flex-wrap gap-2"
                    htmlFor="search-within-org"
                  >
                    Search within organization
                    <select
                      className="form-select form-control form-control-sm d-inline-block"
                      style={{ maxWidth: "200px" }}
                      value={orgTextbox}
                      onChange={(e) => setOrgTextbox(e.target.value)}
                      disabled={organizationsLoading}
                      aria-label="Organization"
                    >
                      <option value="">
                        {organizationsLoading
                          ? "Loading..."
                          : "Select organization"}
                      </option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="row">
                  <div className="col-md-6 mb-2">
                    <label htmlFor="start-date" className="form-label">
                      Start Date
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      id="start-date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      aria-label="Start date"
                    />
                  </div>
                  <div className="col-md-6 mb-2">
                    <label htmlFor="end-date" className="form-label">
                      End Date
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      id="end-date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      aria-label="End date"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Collapse>

          {/* Error */}
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading search results...</span>
              </div>
            </div>
          )}

          {/* Results */}
          {!loading && hasSearched && (
            <>
              {result.length === 0 && currentPage === 1 ? (
                <div className="alert alert-info" role="alert">
                  {query?.trim() ? "No results found." : "Enter search terms and click Search."}
                </div>
              ) : (
                <>
                  <div className="row">
                    {result.map((item, index) => (
                      <div
                        key={
                          item.dataset_id && item.file_id
                            ? `${item.dataset_id}-${item.file_id}`
                            : item.dataset_id || `search-result-${index}`
                        }
                        className="col-12 mb-4"
                      >
                        <div
                          className="card h-100"
                          style={{ cursor: item.dataset_id ? "pointer" : "default" }}
                          onClick={() => handleCardClick(item)}
                          onKeyDown={(e) => {
                            if (
                              item.dataset_id &&
                              (e.key === "Enter" || e.key === " ")
                            ) {
                              e.preventDefault();
                              handleCardClick(item);
                            }
                          }}
                          role={item.dataset_id ? "button" : null}
                          tabIndex={item.dataset_id ? 0 : undefined}
                          aria-label={
                            item.dataset_id
                              ? `View dataset: ${item.title || "Result"}`
                              : undefined
                          }
                        >
                          <div className="card-body">
                            <h5 className="card-title mb-2">
                              {item.title || "Untitled"}
                            </h5>
                            <p
                              className="card-text text-muted mb-0"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {item.context || "No context"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {total > 0 && (
                    <div className="d-flex justify-content-center align-items-center mt-4">
                      <button
                        type="button"
                        className="btn btn-outline-secondary me-3"
                        onClick={handlePrevious}
                        disabled={currentPage === 1 || loading}
                      >
                        Previous
                      </button>
                      <span className="mx-3">{currentPage}</span>
                      <button
                        type="button"
                        className="btn btn-outline-secondary ms-3"
                        onClick={handleNext}
                        disabled={!hasMore || loading}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Search;
