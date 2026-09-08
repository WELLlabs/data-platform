import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";

function CreateOrgSuccess() {
  const [orgName, setOrgName] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [orgId, setOrgId] = useState("");
  const [isValidAccess, setIsValidAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Check if page was accessed with proper query parameters
    const name = searchParams.get("name");
    const created_at = searchParams.get("created_at");
    const id = searchParams.get("id");

    if (name && created_at && id) {
      setOrgName(decodeURIComponent(name));
      setCreatedAt(decodeURIComponent(created_at));
      setOrgId(decodeURIComponent(id));
      setIsValidAccess(true);
    } else {
      setIsValidAccess(false);
    }

    setLoading(false);
  }, [searchParams]);

  // Format date to human readable format
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
      });
    } catch (error) {
      return dateString; // Return original string if parsing fails
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="empty"><p>Loading…</p></div>
          </div>
        </div>
      </div>
    );
  }

  // Invalid access - page accessed directly without proper parameters
  if (!isValidAccess) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="auth-wrap">
            <div className="auth-card" style={{ position: "relative", overflow: "hidden" }}>
              <Contour op={0.35} />
              <span className="eyebrow">Organizations</span>
              <h1 className="display">Invalid access</h1>
              <p className="auth-sub">
                Navigation to this page is invalid. Go to sign up or create an organisation.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 22 }}>
                <button className="btn btn-primary" onClick={() => navigate("/signup")}>
                  Sign up
                </button>
                <button className="btn btn-ghost" onClick={() => navigate("/")}>
                  Go home
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Valid access - show success message
  return (
    <div className="page">
      <div className="wrap">
        <div className="auth-wrap">
          <div className="auth-card" style={{ position: "relative", overflow: "hidden" }}>
            <Contour op={0.35} />
            <span className="eyebrow">Organizations</span>
            <h1 className="display">Organization created</h1>
            <p className="auth-sub">
              Organisation <strong>{orgName}</strong> was successfully created on{" "}
              <strong>{formatDate(createdAt)}</strong>.
            </p>
            <div className="rail-card" style={{ marginTop: 18 }}>
              <div className="rrow">
                <span>Organisation ID</span>
                <span className="mono-token">{orgId}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 22 }}>
              <button className="btn btn-primary" onClick={() => navigate("/signup")}>
                Sign up<Ic name="arrow" size={16} />
              </button>
              <button className="btn btn-ghost" onClick={() => navigate("/createorg")}>
                Create another organization
              </button>
              <button className="btn btn-ghost" onClick={() => navigate("/")}>
                Go home
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateOrgSuccess;
