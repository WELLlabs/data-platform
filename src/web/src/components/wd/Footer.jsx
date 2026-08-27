import React from "react";
import { Link } from "react-router-dom";
import Contour from "./Contour";

const glyph = (
  <svg className="glyph" viewBox="0 0 24 28" fill="none" aria-hidden="true">
    <path d="M12 1C12 1 4 9.5 4 16.2C4 21 7.6 25 12 25C16.4 25 20 21 20 16.2C20 9.5 12 1 12 1Z" fill="#EAF4FA" stroke="#1769AA" strokeWidth="1.3"/>
    <path d="M12 1C12 1 4 9.5 4 16.2C4 21 7.6 25 12 25V1Z" fill="#0B1F33"/>
  </svg>
);

export default function Footer() {
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
          <Link className="brand" to="/">
            {glyph}
            <span><span className="bt">WELL DATA</span><span className="bs">by WELL Labs</span></span>
          </Link>
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
        <div className="foot-col"><h5>WELL Labs</h5>
          <Link to="/faq">About</Link>
          <Link to="/faq">Research</Link>
          <Link to="/faq">Contact</Link>
        </div>
      </div>
      <div className="wrap"><div className="foot-base">
        <span>© {new Date().getFullYear()} WELL Labs · IFMR</span>
        <span>An open research library for water, land and environmental data</span>
      </div></div>
    </footer>
  );
}
