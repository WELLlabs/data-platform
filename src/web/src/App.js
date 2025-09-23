import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import './App.css';

import SiteNavbar from "./components/SiteNavbar";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";

// Simple placeholders for routes that will be implemented later
const Datasets = () => (
  <div className="container py-5">
    <h2>Datasets</h2>
    <p>Coming soon...</p>
  </div>
);

const FAQ = () => (
  <div className="container py-5">
    <h2>FAQ</h2>
    <p>Content coming soon...</p>
  </div>
);

const Terms = () => (
  <div className="container py-5">
    <h2>Terms of Usage</h2>
    <p>Content coming soon...</p>
  </div>
);

const ApiDocs = () => (
  <div className="container py-5">
    <h2>API</h2>
    <p>API documentation coming soon...</p>
  </div>
);

function App() {
  return (
    <Router>
      <div className="app-root">
        <SiteNavbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/api" element={<ApiDocs />} />
          <Route path="*" element={
            <div className="container py-5">
              <h2>Page Not Found</h2>
              <p>
                Go back to <Link to="/">Home</Link>
              </p>
            </div>
          } />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
