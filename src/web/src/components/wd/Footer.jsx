import React from "react";
import { Link } from "react-router-dom";
import { BrandLockup, useBranding } from "../../branding";
import Contour from "./Contour";

export default function Footer() {
  const { hostName, productName } = useBranding();
  return (
    <footer className="footer">
      <div className="contourfield" aria-hidden="true">
        <svg viewBox="0 0 1200 300" fill="none" stroke="#1769AA" strokeWidth="1" opacity=".08">
          <path d="M-50 60 C 250 20, 500 120, 800 60 S 1150 20, 1260 90"/>
          <path d="M-50 120 C 250 80, 500 180, 800 120 S 1150 80, 1260 150"/>
          <path d="M-50 180 C 250 140, 500 240, 800 180 S 1150 140, 1260 210"/>
        </svg>
      </div>
      <div className="wrap foot-inner">
        <div className="foot-brand">
          <BrandLockup />
          <p>An elegant research library for water, land and environmental data.</p>
        </div>
        <div className="foot-col"><h5>Discover</h5>
          <Link to="/datasets">Explore datasets</Link>
          <Link to="/orgsearch">Organizations</Link>
          <Link to="/datasets">Topics</Link>
        </div>
        <div className="foot-col"><h5>Contribute</h5>
          <Link to="/create-dataset">Publish a dataset</Link>
          <Link to="/faq">Guidelines</Link>
          <Link to="/faq">Metadata standard</Link>
        </div>
        <div className="foot-col"><h5>{hostName || productName}</h5>
          <Link to="/faq">About</Link>
          <Link to="/faq">Research</Link>
          <Link to="/faq">Contact</Link>
        </div>
      </div>
      <div className="wrap"><div className="foot-base">
        <span>© {new Date().getFullYear()} {hostName || productName}</span>
        <span>An open research library for water, land and environmental data</span>
      </div></div>
    </footer>
  );
}
