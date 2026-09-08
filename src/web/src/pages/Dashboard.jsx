import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { user_datasets_endpoint, send_verify_email_endpoint, organization_by_id_endpoint } from "../api/endpoints";
import Ic from "../components/wd/Icons";
import Contour from "../components/wd/Contour";
import { useToast } from "../components/wd/Toast";
import { DatasetRow, DatasetCard } from "../components/wd/DatasetItems";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [sendingVerification, setSendingVerification] = useState(false);
  const [wsTab, setWsTab] = useState("published");
  const [view, setView] = useState("list");
  const [orgName, setOrgName] = useState("");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, verifyUser } = useAuth();
  const toast = useToast();
  const paramsSetRef = useRef(false);
  const lastFetchedUserIdRef = useRef(null);
  const lastFocusTimeRef = useRef(0);
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
  }, [navigate]);

  // Second useEffect: Fetch datasets when user.id is available or page changes
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
    if (user?.organization) {
      fetch(organization_by_id_endpoint(user.organization), { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.name) setOrgName(data.name);
        })
        .catch(() => {});
    }
  }, [user?.id, user?.organization, currentPage]);

  // Third useEffect: Refresh user data when window regains focus
  // This ensures user verification status is updated after email verification
  useEffect(() => {
    // Refresh user data when window regains focus (user returns from verification page)
    // Throttle calls to prevent rapid repeated requests
    const handleFocus = () => {
      if (!isAuthenticated) return;

      const now = Date.now();
      const timeSinceLastCall = now - lastFocusTimeRef.current;
      const throttleDelay = 2000; // 2 seconds minimum between calls

      if (timeSinceLastCall >= throttleDelay) {
        lastFocusTimeRef.current = now;
        verifyUser();
      }
    };

    // Add event listener for window focus
    window.addEventListener('focus', handleFocus);

    // Cleanup: remove event listener on unmount
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [isAuthenticated, verifyUser]);

  if (loading) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to signin
  }

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

  const handleSendVerificationEmail = async () => {
    if (!user?.email) return;

    setSendingVerification(true);
    setVerificationMessage("");

    try {
      const response = await fetch(send_verify_email_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: user.email }),
        credentials: "include",
      });

      if (response.ok) {
        setVerificationMessage("Verification email sent! Please check your inbox.");
        toast("Verification email sent — check your inbox.");
      } else {
        let errorMessage = "Failed to send verification email. Please try again.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json();
            errorMessage = errorData?.detail || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = text || errorMessage;
          }
        } catch (parseError) {
          console.error("Error parsing error response:", parseError);
          // Use default error message
        }
        setVerificationMessage(errorMessage);
      }
    } catch (err) {
      console.error("Error sending verification email:", err);
      setVerificationMessage(
        "Network error. Please check your connection and try again."
      );
    } finally {
      setSendingVerification(false);
    }
  };

  // Check if user is not verified (check only is_verified field)
  // User is unverified if is_verified is not explicitly true
  const isUnverified = user && user.is_verified !== true;

  // Derived presentation values (no change to fetching/state)
  const firstName =
    (user.full_name && user.full_name.trim().split(/\s+/)[0]) ||
    user.full_name ||
    "there";
  const orgLine =
    [user.designation, orgName || null, user.email].filter(Boolean).join(" · ");

  // Client-side grouping of the current page of datasets
  const published = datasets.filter((d) => d.approved === true);
  const pending = datasets.filter((d) => d.approved !== true);
  const pendingCount = pending.length;

  const tabList = wsTab === "pending" ? pending : published;


  return (
    <div className="page">
      <div className="wrap">
        <section className="ws-hero" style={{ position: "relative" }}>
          <Contour op={0.35} />
          <span className="eyebrow">Your workspace</span>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              flexWrap: "wrap",
              gap: 16,
              marginTop: 10,
            }}
          >
            <div>
              <h1 className="ws-hi display">
                {greeting()}, {firstName}.
              </h1>
              <p className="ws-sub">{orgLine}</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/create-dataset')}
            >
              <Ic name="plus" size={15} sw={2} />
              Publish dataset
            </button>
          </div>
        </section>

        <div className="dash-stats">
          <div className="dash-stat">
            <b>{datasetsLoading ? "…" : published.length}</b>
            <span>Published datasets</span>
            <span className="trend"><Ic name="grid" size={13} /> Shown on this page</span>
          </div>
          <div className="dash-stat">
            <b>{datasetsLoading ? "…" : pendingCount}</b>
            <span>Awaiting review</span>
            <span className="trend"><Ic name="warn" size={13} /> In the approval queue</span>
          </div>
          <div className="dash-stat">
            <b style={{ fontSize: 22 }}>{user.verified ? "Active" : "Pending"}</b>
            <span>Organization membership</span>
            <span className="trend"><Ic name="org" size={13} /> {orgName || "Your organization"}</span>
          </div>
        </div>

        {(pendingCount > 0 || isUnverified) && (
          <>
            <div className="sec-label" style={{ marginBottom: 14 }}>
              Needs your attention
            </div>
            <div className="attn">
              {pendingCount > 0 && (
                <div
                  className="attn-card warn"
                  onClick={() => setWsTab("pending")}
                  style={{ cursor: "pointer" }}
                >
                  <div className="aic">
                    <Ic name="warn" size={18} sw={2} />
                  </div>
                  <div>
                    <b>
                      {pendingCount} dataset{pendingCount === 1 ? "" : "s"} awaiting
                      approval
                    </b>
                    <p>Your submissions are in the review queue.</p>
                  </div>
                  <span className="go">
                    <Ic name="arrow" size={16} />
                  </span>
                </div>
              )}

              {isUnverified && (
                <div
                  className="attn-card info"
                  onClick={handleSendVerificationEmail}
                  style={{ cursor: sendingVerification ? "default" : "pointer" }}
                >
                  <div className="aic">
                    <Ic name="info" size={18} sw={2} />
                  </div>
                  <div>
                    <b>Verify your email address</b>
                    <p>
                      {sendingVerification
                        ? "Sending verification email…"
                        : verificationMessage
                        ? verificationMessage
                        : "Confirm your email to unlock publishing and approvals."}
                    </p>
                  </div>
                  <span className="go">
                    <Ic name="arrow" size={16} />
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <section className="dash-grid solo">
          <div className="dash-panel">
          <div className="panel-head">
            <div className="seg">
              <button
                className={wsTab === "published" ? "active" : ""}
                onClick={() => setWsTab("published")}
              >
                Published{" "}
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {published.length}
                </span>
              </button>
              <button
                className={wsTab === "pending" ? "active" : ""}
                onClick={() => setWsTab("pending")}
              >
                Pending{" "}
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {pending.length}
                </span>
              </button>
            </div>
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
                aria-label="List view"
                aria-pressed={view === "list"}
                title="List view"
              >
                <Ic name="list" size={16} sw={2} />
              </button>
              <button
                className={view === "grid" ? "active" : ""}
                onClick={() => setView("grid")}
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                title="Grid view"
              >
                <Ic name="grid" size={16} sw={2} />
              </button>
            </div>
          </div>

          <div>
            {datasetsLoading ? (
              <div className="empty"><p>Loading datasets…</p></div>
            ) : tabList.length === 0 ? (
              <div className="empty" style={{ padding: "48px 0" }}>
                <div className="eic"><Ic name="file" size={22} /></div>
                <h3>{wsTab === "pending" ? "Nothing awaiting review" : "No published datasets yet"}</h3>
                <p>
                  {wsTab === "published"
                    ? "Datasets you publish will appear here once approved."
                    : "Submissions waiting on a reviewer will show up here."}
                </p>
                <button className="btn btn-primary" onClick={() => navigate("/create-dataset")}>
                  <Ic name="plus" size={15} sw={2} /> Publish a dataset
                </button>
              </div>
            ) : view === "grid" ? (
              <div className="explore-grid">
                {tabList.map((dataset) => (
                  <DatasetCard key={dataset.dataset_id} dataset={dataset} />
                ))}
              </div>
            ) : (
              <div className="rows">
                {tabList.map((dataset) => (
                  <DatasetRow key={dataset.dataset_id} dataset={dataset} />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!datasetsLoading && (currentPage > 1 || hasMore) && (
            <div
              className="pagination"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 16,
                marginTop: 24,
              }}
            >
              <button
                className="btn btn-ghost"
                onClick={handlePrevious}
                disabled={currentPage === 1 || datasetsLoading}
              >
                <Ic name="chevLeft" size={16} />
                Previous
              </button>
              <span className="mono muted">{currentPage}</span>
              <button
                className="btn btn-ghost"
                onClick={handleNext}
                disabled={!hasMore || datasetsLoading}
              >
                Next
                <Ic name="arrow" size={16} />
              </button>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
