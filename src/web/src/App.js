import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import './App.css';

import { AuthProvider } from "./contexts/AuthContext";
import SiteNavbar from "./components/SiteNavbar";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import SignupSuccess from "./pages/SignupSuccess";
import OrgSearch from "./pages/OrgSearch";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import CreateOrg from "./pages/CreateOrg";
import CreateOrgSuccess from "./pages/CreateOrgSuccess";
import Organization from "./pages/Organization";
import CreateDataset from "./pages/CreateDataset";
import DatasetSuccess from "./pages/DatasetSuccess";
import DatasetInfo from "./pages/DatasetInfo";
import AddFile from "./pages/AddFile";
import FAQ from "./pages/FAQ";
import Terms from "./pages/Terms";
import Datasets from "./pages/Datasets";

const ApiDocs = () => (
  <div className="container py-5">
    <h2>API</h2>
    <p>API documentation coming soon...</p>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app-root">
          <SiteNavbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/datasets" element={<Datasets />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signupsuccess" element={<SignupSuccess />} />
            <Route path="/orgsearch" element={<OrgSearch />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/createorg" element={<CreateOrg />} />
            <Route path="/createorgsuccess" element={<CreateOrgSuccess />} />
            <Route path="/organisation" element={<Organization />} />
            <Route path="/create-dataset" element={<CreateDataset />} />
            <Route path="/dataset-success" element={<DatasetSuccess />} />
            <Route path="/dataset-info" element={<DatasetInfo />} />
            <Route path="/add-file" element={<AddFile />} />
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
    </AuthProvider>
  );
}

export default App;
