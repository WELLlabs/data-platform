import React from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";

import { AuthProvider } from "./contexts/AuthContext";
import { BrandingProvider } from "./branding";
import { ToastProvider } from "./components/wd/Toast";
import { CommandPalette } from "./components/wd/CommandPalette";
import SiteNavbar from "./components/SiteNavbar";
import Footer from "./components/wd/Footer";

import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import SignupSuccess from "./pages/SignupSuccess";
import ChangePassword from "./pages/ChangePassword";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import OrgSearch from "./pages/OrgSearch";
import Contributors from "./pages/Contributors";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import CreateOrg from "./pages/CreateOrg";
import CreateOrgSuccess from "./pages/CreateOrgSuccess";
import Organization from "./pages/Organization";
import CreateDataset from "./pages/CreateDataset";
import DatasetInfo from "./pages/DatasetInfo";
import AddFile from "./pages/AddFile";
import FilePreview from "./pages/FilePreview";
import FAQ from "./pages/FAQ";
import Terms from "./pages/Terms";
import Datasets from "./pages/Datasets";
import Search from "./pages/Search";
import Approvals from "./pages/Approvals";
import CompleteProfile from "./pages/CompleteProfile";
import ProfileCompleteGate from "./components/ProfileCompleteGate";

const ApiDocs = () => (
  <div className="page"><section className="wrap" style={{ padding: "72px 0", maxWidth: 720 }}>
    <span className="eyebrow">Developers</span>
    <h1 className="display" style={{ fontSize: 40, fontWeight: 450, color: "var(--navy)", letterSpacing: "-.03em", margin: "12px 0 16px" }}>API</h1>
    <p className="muted">API documentation coming soon.</p>
  </section></div>
);

const NotFound = () => (
  <div className="page"><section className="wrap" style={{ padding: "96px 0" }}>
    <div className="empty">
      <h3 className="display">Page not found</h3>
      <p>The page you were looking for may have moved.</p>
      <Link className="btn btn-ghost" to="/">Back home</Link>
    </div>
  </section></div>
);

const AUTH_BARE_PATHS = ["/signin", "/signup"];

function AppShell() {
  const { pathname } = useLocation();
  const bare = AUTH_BARE_PATHS.includes(pathname);
  return (
            <div className={bare ? "app-root auth-bare" : "app-root"}>
              {!bare && <SiteNavbar />}
              <main id="app">
                <ProfileCompleteGate>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/datasets" element={<Datasets />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/signin" element={<SignIn />} />
                  <Route path="/signup" element={<SignUp />} />
                  <Route path="/complete-profile" element={<CompleteProfile />} />
                  <Route path="/signupsuccess" element={<SignupSuccess />} />
                  <Route path="/change-password" element={<ChangePassword />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/verify-email" element={<VerifyEmail />} />
                  <Route path="/orgsearch" element={<OrgSearch />} />
                  <Route path="/contributors" element={<Contributors />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/approvals" element={<Approvals />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/createorg" element={<CreateOrg />} />
                  <Route path="/createorgsuccess" element={<CreateOrgSuccess />} />
                  <Route path="/organisation" element={<Organization />} />
                  <Route path="/create-dataset" element={<CreateDataset />} />
                  <Route path="/dataset-info" element={<DatasetInfo />} />
                  <Route path="/add-file" element={<AddFile />} />
                  <Route path="/file-preview" element={<FilePreview />} />
                  <Route path="/faq" element={<FAQ />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/api" element={<ApiDocs />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
                </ProfileCompleteGate>
              </main>
              {!bare && <Footer />}
            </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <Router>
          <ToastProvider>
            <CommandPalette>
              <AppShell />
            </CommandPalette>
          </ToastProvider>
        </Router>
      </BrandingProvider>
    </AuthProvider>
  );
}

export default App;
