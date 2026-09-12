import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { me_endpoint, organizations_endpoint } from "../api/endpoints";
import { clearOrganizationNamesCache } from "../components/wd/DatasetItems";
import Contour from "../components/wd/Contour";

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

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
        <span className="eyebrow">Organizations</span>
        <div className="section-head" style={{ marginTop: 8 }}>
          <h2 className="section-title">Create organization</h2>
        </div>
        <p className="lede" style={{ marginTop: -8, marginBottom: 26 }}>
          Create a new organization to manage data and users.
        </p>

        {error && (
          <div className="attn-card warn" role="alert" style={{ marginBottom: 20 }}>
            <div><b>{error}</b></div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Organization Name */}
          <div className="field">
            <label htmlFor="name">Organization name *</label>
            <input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Enter organization name"
              maxLength={100}
              required
            />
            {formData.name.length > 100 && (
              <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                Organization name must be 100 characters or less
              </span>
            )}
          </div>

          {/* Description */}
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Enter organization description"
              maxLength={1000}
              rows={3}
            />
            {formData.description.length > 1000 && (
              <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                Description must be 1000 characters or less
              </span>
            )}
          </div>

          {/* Organization Type */}
          <div className="field">
            <label htmlFor="org_type">Organization type</label>
            <Select
              inputId="org_type"
              name="org_type"
              value={orgTypeOptions.find(option => option.value === formData.org_type) || null}
              onChange={(selectedOption) => handleSelectChange(selectedOption, "org_type")}
              options={orgTypeOptions}
              placeholder="Select organization type"
              isClearable
              className="react-select-container"
              classNamePrefix="react-select"
            />
          </div>

          {/* Contact */}
          <div className="field">
            <label htmlFor="contact">Contact information</label>
            <input
              id="contact"
              name="contact"
              type="text"
              value={formData.contact}
              onChange={handleInputChange}
              placeholder="Enter contact information"
              maxLength={100}
            />
            {formData.contact.length > 100 && (
              <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                Contact information must be 100 characters or less
              </span>
            )}
          </div>

          {/* Website */}
          <div className="field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="url"
              value={formData.website}
              onChange={handleInputChange}
              placeholder="https://example.com"
              maxLength={200}
            />
            {formData.website.length > 200 && (
              <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                Website URL must be 200 characters or less
              </span>
            )}
          </div>

          {/* Private Data */}
          <div className="field">
            <label>Private data</label>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="private"
                  id="privateNo"
                  value="No"
                  checked={formData.private === "No"}
                  onChange={handleInputChange}
                />
                No
              </label>
              <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="private"
                  id="privateYes"
                  value="Yes"
                  checked={formData.private === "Yes"}
                  onChange={handleInputChange}
                />
                Yes
              </label>
            </div>
          </div>

          {/* Focus Areas */}
          <div className="field">
            <label htmlFor="focus">Focus areas (multi-select)</label>
            <Select
              inputId="focus"
              name="focus"
              value={formData.focus}
              onChange={(selectedOptions) => handleMultiSelectChange(selectedOptions, "focus")}
              options={focusOptions}
              placeholder="Select focus areas"
              isMulti
              isClearable
              className="react-select-container"
              classNamePrefix="react-select"
            />
          </div>

          {/* States */}
          <div className="field">
            <label htmlFor="roi_states">States working in (multi-select)</label>
            <Select
              inputId="roi_states"
              name="roi_states"
              value={formData.roi_states}
              onChange={(selectedOptions) => handleMultiSelectChange(selectedOptions, "roi_states")}
              options={stateOptions}
              placeholder="Select states"
              isMulti
              isClearable
              isSearchable
              className="react-select-container"
              classNamePrefix="react-select"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={!isFormValid() || submitting}
          >
            {submitting ? "Creating organization…" : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default CreateOrg;
