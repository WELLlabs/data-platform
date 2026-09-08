import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { BrandLockup } from "../branding";
import { useCmdk } from "./wd/CommandPalette";
import Ic from "./wd/Icons";

function initials(name) {
  if (!name) return "U";
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "U";
}

export default function SiteNavbar() {
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, signOut } = useAuth();
  const cmdk = useCmdk();

  const path = location.pathname;
  const isActive = (m) => m.some((p) => path === p || path.startsWith(p + "/"));

  const handleSignOut = async () => {
    setOpen(false);
    setSignOutError(null);
    try {
      await signOut();
      navigate("/signin", { replace: true });
    } catch (error) {
      setSignOutError(error?.message || "Sign out failed. Please try again.");
    }
  };

  const links = isAuthenticated
    ? [
        { label: "Explore", to: "/datasets", match: ["/datasets", "/search"] },
        { label: "Dashboard", to: `/dashboard${user?.id ? `?userId=${user.id}` : ""}`, match: ["/dashboard"] },
        { label: "Organisation", to: "/organisation", match: ["/organisation", "/orgsearch"] },
        ...(Number(user?.role) > 0 ? [{ label: "Approvals", to: "/approvals", match: ["/approvals"] }] : []),
        { label: "About", to: "/faq", match: ["/faq", "/terms"] },
      ]
    : [
        { label: "Explore", to: "/datasets", match: ["/datasets", "/search"] },
        { label: "Organizations", to: "/orgsearch", match: ["/orgsearch"] },
        { label: "About", to: "/faq", match: ["/faq", "/terms"] },
      ];

  return (
    <>
      {signOutError && (
        <div style={{ background: "#faf3e4", color: "#9a6b12", borderBottom: "1px solid #ecdcb8", padding: "10px 28px", fontSize: 13.5 }} role="alert">
          {signOutError}
          <button onClick={() => setSignOutError(null)} style={{ marginLeft: 12, background: "none", border: "none", color: "inherit", cursor: "pointer" }} aria-label="Close">✕</button>
        </div>
      )}
      <header className={"nav" + (open ? " open" : "")}>
        <div className="nav-inner">
          <BrandLockup onClick={() => setOpen(false)} />
          <nav className="nav-links" aria-label="Primary">
            {links.map((l) => (
              <Link key={l.label} to={l.to} className={isActive(l.match) ? "active" : ""} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            {isAuthenticated && (
              <button className="nav-menu-signout" onClick={handleSignOut}>Sign out</button>
            )}
          </nav>
          <div className="nav-right">
            <button className="navk-icon" onClick={() => cmdk.open()} aria-label="Search (Command K)" title="Search  ⌘K">
              <Ic name="search" size={17} sw={2} />
            </button>
            {isAuthenticated ? (
              <>
                <Link to={`/profile${user?.id ? `?userId=${user.id}` : ""}`} className="avatar" title={user?.name || user?.email || "Profile"}>
                  {initials(user?.name || user?.email)}
                </Link>
                <button className="btn btn-ghost nav-signout" onClick={handleSignOut} style={{ padding: "9px 12px" }}>Sign out</button>
              </>
            ) : (
              <Link className="btn btn-primary" to="/signin">Sign in</Link>
            )}
          </div>
          <button className="nav-burger" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <Ic name="menu" size={18} sw={2} />
          </button>
        </div>
      </header>
    </>
  );
}
