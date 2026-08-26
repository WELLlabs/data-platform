import React, { useState } from "react";
import { Navbar, NavbarBrand, Nav, NavItem, NavbarToggler, Collapse } from "reactstrap";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function SiteNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [signOutError, setSignOutError] = useState(null);
  const navigate = useNavigate();
  const { isAuthenticated, user, signOut } = useAuth();

  const toggle = () => setIsOpen(!isOpen);

  const handleSignOut = async () => {
    setIsOpen(false);
    setSignOutError(null);
    try {
      await signOut();
      navigate("/signin", { replace: true });
    } catch (error) {
      const message = error?.message || "Sign out failed. Please try again.";
      setSignOutError(message);
      if (process.env.NODE_ENV === "development") {
        console.error("handleSignOut: signOut failed", { error });
      }
    }
  };

  return (
    <>
      {signOutError && (
        <div
          className="alert alert-danger alert-dismissible fade show mb-0 rounded-0"
          role="alert"
        >
          {signOutError}
          <button
            type="button"
            className="btn-close"
            onClick={() => setSignOutError(null)}
            aria-label="Close"
          />
        </div>
      )}
      <Navbar expand="md" light className="wd-navbar">
      <div className="wd-navbar-inner d-flex align-items-center">
      <NavbarBrand tag={Link} to="/" className="wd-brand d-flex align-items-center gap-2">
        <img src={process.env.PUBLIC_URL + "/assets/logo/well-labs-logo.png"} alt="WELL Labs" />
        <span><span>WELL DATA</span><span className="wd-brand-sub">by WELL Labs</span></span>
      </NavbarBrand>
      
      <NavbarToggler onClick={toggle} className="wd-nav-toggle d-md-none" />
      
      <Collapse isOpen={isOpen} navbar>
        <Nav className="ms-auto" navbar>
          {isAuthenticated ? (
            <>
              <NavItem>
                <Link 
                  className="nav-link wd-nav-link" 
                  to={`/dashboard?userId=${user?.id}`} 
                  onClick={() => setIsOpen(false)}
                >
                  Dashboard
                </Link>
              </NavItem>
              <NavItem>
                <Link className="nav-link wd-nav-link" to="/datasets" onClick={() => setIsOpen(false)}>
                  Explore
                </Link>
              </NavItem>
              <NavItem>
                <Link className="nav-link wd-nav-link" to="/organisation" onClick={() => setIsOpen(false)}>
                  Organisation
                </Link>
              </NavItem>
              <NavItem>
                <Link 
                  className="nav-link wd-nav-link" 
                  to={`/profile?userId=${user?.id}`} 
                  onClick={() => setIsOpen(false)}
                >
                  Profile
                </Link>
              </NavItem>
              {Number(user?.role) > 0 && (
                <NavItem>
                  <Link className="nav-link wd-nav-link" to="/approvals" onClick={() => setIsOpen(false)}>
                    Approvals
                  </Link>
                </NavItem>
              )}
              <NavItem className="ms-2">
                <button 
                  className="wd-nav-action" 
                  onClick={handleSignOut}
                >
                  Sign out
                </button>
              </NavItem>
            </>
          ) : (
            <>
              <NavItem>
                <Link className="nav-link wd-nav-link" to="/datasets" onClick={() => setIsOpen(false)}>
                  Explore
                </Link>
              </NavItem>
              <NavItem className="ms-2">
                <Link 
                  className="wd-nav-action" 
                  to="/signin"
                  onClick={() => setIsOpen(false)}
                >
                  Sign in
                </Link>
              </NavItem>
            </>
          )}
        </Nav>
      </Collapse>
      </div>
    </Navbar>
    </>
  );
}

export default SiteNavbar;


