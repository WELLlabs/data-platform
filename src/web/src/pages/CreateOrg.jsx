import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { me_endpoint, organizations_endpoint } from "../api/endpoints";
import { clearOrganizationNamesCache } from "../components/wd/DatasetItems";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";

function CreateOrg() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    org_type: "",
    contact: "",
    website: "",
    private: "No",
    focus: [],
    roi_states: [],
    allowed_email_domains: "",
    allow_password: true,
    allow_google: true,
  });

  const navigate = useNavigate();

  // Organization type options
  const orgTypeOptions = [
    { value: "Private", label: "Private" },
    { value: "Government", label: "Government" },
    { value: "NGO", label: "NGO" },
    { value: "Non-Profit", label: "Non-Profit" },
  ];

  // Focus area options
  const focusOptions = [
    { value: "Watershed Management", label: "Watershed Management" },
    { value: "Agricultural Analysis", label: "Agricultural Analysis" },
    { value: "Climate Impact", label: "Climate Impact" },
    { value: "Research & Development", label: "Research & Development" },
    { value: "Government Projects", label: "Government Projects" },
    { value: "NGO Work", label: "NGO Work" },
    { value: "Academic Research", label: "Academic Research" },
    { value: "Commercial", label: "Commercial" },
  ];

  // Indian states options
  const stateOptions = [
    { value: "Andhra Pradesh", label: "Andhra Pradesh" },
    { value: "Arunachal Pradesh", label: "Arunachal Pradesh" },
    { value: "Assam", label: "Assam" },
    { value: "Bihar", label: "Bihar" },
    { value: "Chhattisgarh", label: "Chhattisgarh" },
    { value: "Goa", label: "Goa" },
    { value: "Gujarat", label: "Gujarat" },
    { value: "Haryana", label: "Haryana" },
    { value: "Himachal Pradesh", label: "Himachal Pradesh" },
    { value: "Jammu and Kashmir", label: "Jammu and Kashmir" },
    { value: "Jharkhand", label: "Jharkhand" },
    { value: "Karnataka", label: "Karnataka" },
    { value: "Kerala", label: "Kerala" },
    { value: "Madhya Pradesh", label: "Madhya Pradesh" },
    { value: "Maharashtra", label: "Maharashtra" },
    { value: "Manipur", label: "Manipur" },
    { value: "Meghalaya", label: "Meghalaya" },
    { value: "Mizoram", label: "Mizoram" },
    { value: "Nagaland", label: "Nagaland" },
    { value: "Odisha", label: "Odisha" },
    { value: "Punjab", label: "Punjab" },
    { value: "Rajasthan", label: "Rajasthan" },
    { value: "Sikkim", label: "Sikkim" },
    { value: "Tamil Nadu", label: "Tamil Nadu" },
    { value: "Telangana", label: "Telangana" },
    { value: "Tripura", label: "Tripura" },
    { value: "Uttar Pradesh", label: "Uttar Pradesh" },
    { value: "Uttarakhand", label: "Uttarakhand" },
    { value: "West Bengal", label: "West Bengal" },
    { value: "Andaman and Nicobar Islands", label: "Andaman and Nicobar Islands" },
    { value: "Chandigarh", label: "Chandigarh" },
    { value: "Dadra and Nagar Haveli", label: "Dadra and Nagar Haveli" },
    { value: "Daman and Diu", label: "Daman and Diu" },
    { value: "Lakshadweep", label: "Lakshadweep" },
    { value: "National Capital Territory of Delhi", label: "National Capital Territory of Delhi" },
    { value: "Puducherry", label: "Puducherry" },
  ];

  // Check user authentication and authorization
  useEffect(() => {
    const checkAuth = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await axios.get(me_endpoint, {
          withCredentials: true,
        });

        if (response.status === 200) {
          const userData = response.data;

          // Check if user is superuser
          if (!userData.is_superuser) {
            setError("Access denied. You must be a superuser to create organizations.");
            setUser(null);
            return;
          }

          setUser(userData);
        }
      } catch (err) {
        console.error("Authentication error:", err);

        // Clear any stored auth data
        localStorage.removeItem("user");
        sessionStorage.clear();

        if (err.response?.status === 401) {
          setError("Session expired. Please sign in again.");
        } else if (err.response?.status === 403) {
          setError("Access denied. You must be a superuser to create organizations.");
        } else {
          setError("Authentication failed. Please sign in again.");
        }

        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle multiselect changes
  const handleMultiSelectChange = (selectedOptions, field) => {
    setFormData(prev => ({
      ...prev,
      [field]: selectedOptions || []
    }));
  };

  // Handle single select changes
  const handleSelectChange = (selectedOption, field) => {
    setFormData(prev => ({
      ...prev,
      [field]: selectedOption ? selectedOption.value : ""
    }));
  };

  // Form validation
  const isFormValid = () => {
    return (
      formData.name.trim().length > 0 &&
      formData.name.trim().length <= 100 &&
      formData.description.length <= 1000 &&
      formData.contact.length <= 100 &&
      formData.website.length <= 200
    );
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    if (!isFormValid()) {
      setError("Please fill in all required fields correctly.");
      setSubmitting(false);
      return;
    }

    try {
      // Prepare data for API
      const orgData = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        org_type: formData.org_type || null,
        contact: formData.contact.trim() || null,
        website: formData.website.trim() || null,
        private: formData.private === "Yes",
        focus: formData.focus.map(item => item.value),
        roi_states: formData.roi_states.map(item => item.value),
        allowed_email_domains: formData.allowed_email_domains
          .split(/[,;\s]+/)
          .map((item) => item.trim().replace(/^@/, "").toLowerCase())
          .filter(Boolean),
        allow_password: formData.allow_password,
        allow_google: formData.allow_google,
      };

      const response = await axios.post(organizations_endpoint, orgData, {
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
      });

      if (response.status === 201) {
        clearOrganizationNamesCache();
        const orgName = encodeURIComponent(response.data.name);
        const createdAt = encodeURIComponent(response.data.created_at);
        const orgId = encodeURIComponent(response.data.id);
        navigate(`/createorgsuccess?name=${orgName}&created_at=${createdAt}&id=${orgId}`);
      }
    } catch (err) {
      console.error("Organization creation error:", err);

      if (err.response?.status === 401) {
        setError("Session expired. Please sign in again.");
        // Clear auth data
        localStorage.removeItem("user");
        sessionStorage.clear();
      } else if (err.response?.status === 403) {
        setError("Access denied. You must be a superuser to create organizations.");
      } else {
        const errorMsg = err.response?.data?.detail || "Failed to create organization. Please try again.";
        setError(Array.isArray(errorMsg) ? errorMsg.join(", ") : String(errorMsg));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="page">
        <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
          <div className="empty"><p>Verifying access…</p></div>
        </div>
      </div>
    );
  }

  // Error state (no user or not superuser)
  if (!user) {
    return (
      <div className="page">
        <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
          <div className="auth-wrap">
            <div className="auth-card">
              <span className="eyebrow">Organizations</span>
              <h1 className="display">Access denied</h1>
              <p className="auth-sub">{error}</p>
              <div style={{ marginTop: 22 }}>
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

  const setField = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const counter = (value, max) => (
    <span className={"co-count" + (value.length > max * 0.9 ? " near" : "")}>
      {value.length}/{max}
    </span>
  );

  const renderToggle = (field, title, text) => (
    <label className="co-switch" key={field}>
      <span className="co-switch-text">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={formData[field]}
        onChange={(e) => setField(field, e.target.checked)}
      />
      <span className="co-switch-track" aria-hidden="true">
        <span className="co-switch-thumb" />
      </span>
    </label>
  );

  return (
    <div className="page">
      <div className="wrap ds-form" style={{ padding: "36px 0 88px" }}>
        <button type="button" className="back-link" onClick={() => navigate(-1)}>
          <Ic name="chevLeft" size={15} sw={2} />
          <span>Back</span>
        </button>

        <div className="section-head" style={{ marginTop: 14 }}>
          <div>
            <span className="eyebrow">Organisations</span>
            <h2 className="section-title" style={{ marginTop: 6 }}>
              Create organisation
            </h2>
            <p className="muted" style={{ marginTop: 6, maxWidth: "70ch" }}>
              Set up a new organisation to manage its datasets and members. Only
              the name is required, and every detail can be edited later.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ marginTop: 22 }}>
          {error && (
            <div className="form-note err" role="alert">
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: details */}
          <div className="form-section">
            <div className="fs-head">
              <span className="fs-num">1</span>
              <div>
                <h3>Organisation details</h3>
                <p>How the organisation appears across the platform.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="name">
                Organisation name <span className="req">(required)</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="e.g. WELL Labs"
                maxLength={100}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="description">
                Description <span className="opt">(optional)</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="What does the organisation do, and what kind of data will it share?"
                maxLength={1000}
                rows={3}
              />
              {counter(formData.description, 1000)}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="org_type">
                  Organisation type <span className="opt">(optional)</span>
                </label>
                <Select
                  inputId="org_type"
                  name="org_type"
                  value={orgTypeOptions.find((o) => o.value === formData.org_type) || null}
                  onChange={(opt) => handleSelectChange(opt, "org_type")}
                  options={orgTypeOptions}
                  placeholder="Select a type"
                  isClearable
                  className="react-select-container"
                  classNamePrefix="react-select"
                />
              </div>
              <div className="field">
                <label htmlFor="website">
                  Website <span className="opt">(optional)</span>
                </label>
                <input
                  id="website"
                  name="website"
                  type="url"
                  value={formData.website}
                  onChange={handleInputChange}
                  placeholder="https://example.org"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="contact">
                Contact information <span className="opt">(optional)</span>
              </label>
              <input
                id="contact"
                name="contact"
                type="text"
                value={formData.contact}
                onChange={handleInputChange}
                placeholder="A shared email or phone number for the organisation"
                maxLength={100}
              />
            </div>
          </div>

          {/* Section 2: access */}
          <div className="form-section">
            <div className="fs-head">
              <span className="fs-num">2</span>
              <div>
                <h3>Sign-in &amp; access</h3>
                <p>Who can join, how they sign in, and whether data can be private.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="allowed_email_domains">
                Allowed email domains <span className="opt">(optional)</span>
              </label>
              <input
                id="allowed_email_domains"
                name="allowed_email_domains"
                type="text"
                value={formData.allowed_email_domains}
                onChange={handleInputChange}
                placeholder="e.g. welllabs.org, ifmr.ac.in"
              />
              <span className="hint">
                Separate domains with commas. Leave blank to allow any configured domain.
              </span>
            </div>

            <div className="co-switches">
              {renderToggle("allow_password", "Password sign-up", "Members can create an account with an email and password.")}
              {renderToggle("allow_google", "Google sign-in", "Members can sign in with their Google account.")}
            </div>

            <div className="field co-private">
              <div>
                <label id="private-label" style={{ marginBottom: 2 }}>Private data</label>
                <span className="hint" style={{ marginTop: 0 }}>
                  Allows datasets to be restricted to members of this organisation.
                </span>
              </div>
              <div className="seg" role="radiogroup" aria-labelledby="private-label">
                {["No", "Yes"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={formData.private === v}
                    className={"seg-opt" + (formData.private === v ? " on" : "")}
                    onClick={() => setField("private", v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: focus */}
          <div className="form-section">
            <div className="fs-head">
              <span className="fs-num">3</span>
              <div>
                <h3>Focus &amp; coverage</h3>
                <p>Helps people find the organisation by theme and geography.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="focus">
                Focus areas <span className="opt">(select any)</span>
              </label>
              <Select
                inputId="focus"
                name="focus"
                value={formData.focus}
                onChange={(opts) => handleMultiSelectChange(opts, "focus")}
                options={focusOptions}
                placeholder="Select focus areas"
                isMulti
                isClearable
                closeMenuOnSelect={false}
                className="react-select-container"
                classNamePrefix="react-select"
              />
            </div>

            <div className="field">
              <label htmlFor="roi_states">
                States and union territories <span className="opt">(select any)</span>
              </label>
              <Select
                inputId="roi_states"
                name="roi_states"
                value={formData.roi_states}
                onChange={(opts) => handleMultiSelectChange(opts, "roi_states")}
                options={stateOptions}
                placeholder="Search or select states"
                isMulti
                isClearable
                isSearchable
                closeMenuOnSelect={false}
                className="react-select-container"
                classNamePrefix="react-select"
              />
            </div>
          </div>

          <div className="form-actions">
            <span className="fa-note">
              {formData.name.trim()
                ? "Ready to create"
                : "Add an organisation name to continue"}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate(-1)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!isFormValid() || submitting}
              >
                {submitting ? "Creating…" : "Create organisation"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateOrg;
