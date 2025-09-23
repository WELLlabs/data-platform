import React, { useState } from "react";
import { Navbar, NavbarBrand, Nav, NavItem, NavbarToggler, Collapse } from "reactstrap";
import { Link } from "react-router-dom";

function SiteNavbar() {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => setIsOpen(!isOpen);

  return (
    <Navbar expand="md" light className="navbar-custom px-3">
      <NavbarBrand tag={Link} to="/" className="d-flex align-items-center gap-2">
        <img src={process.env.PUBLIC_URL + "/assets/logo/well-labs-logo.png"} alt="WELL Labs" />
      </NavbarBrand>
      
      <NavbarToggler onClick={toggle} className="d-md-none" />
      
      <Collapse isOpen={isOpen} navbar>
        <Nav className="ms-auto" navbar>
          <NavItem>
            <Link className="nav-link" to="/datasets" onClick={() => setIsOpen(false)}>
              Datasets
            </Link>
          </NavItem>
          <NavItem className="ms-2">
            <Link 
              className="btn btn-outline-light" 
              to="/signin"
              onClick={() => setIsOpen(false)}
            >
              <i className="bi bi-person-plus me-1" /> Sign In
            </Link>
          </NavItem>
        </Nav>
      </Collapse>
    </Navbar>
  );
}

export default SiteNavbar;


