import React, { useState, useEffect } from "react";
import {
  Container,
  Row,
  Col,
  Card,
  Form,
  Button,
  Alert,
  Spinner,
  FormGroup,
  Label,
  Input,
  FormText,
} from "reactstrap";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { me_endpoint, organizations_endpoint } from "../api/endpoints";

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
        // Navigate to success page with query parameters
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
      <div className="bg-wave">
        <Container className="py-5">
          <Row className="justify-content-center">
            <Col md="8" lg="6">
              <Card className="p-5 text-center">
                <Spinner color="primary" size="lg" className="mb-3" />
                <h5>Verifying access...</h5>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  // Error state (no user or not superuser)
  if (!user) {
    return (
      <div className="bg-wave">
        <Container className="py-5">
          <Row className="justify-content-center">
            <Col md="8" lg="6">
              <Card className="p-5 text-center">
                <Alert color="danger" className="mb-4">
                  {error}
                </Alert>
                {/*<Button 
                  color="primary" 
                  onClick={() => navigate("/signin")}
                  className="me-2"
                >
                  Sign In
                </Button>*/}
                <Button 
                  color="outline-primary" 
                  onClick={() => navigate("/")}
                >
                  Go Home
                </Button>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  return (
    <div className="bg-wave">
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="10" lg="8">
            <Card className="p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Create Organization</h2>
              <p className="text-muted text-center mb-4">
                Create a new organization to manage data and users.
              </p>

              {error && (
                <Alert color="danger" className="mb-4">
                  {error}
                </Alert>
              )}

              <Form onSubmit={handleSubmit} noValidate>
                {/* Organization Name */}
                <FormGroup className="mb-3">
                  <Label for="name" className="form-label">
                    Organization Name *
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Enter organization name"
                    maxLength={100}
                    required
                    className={formData.name.length > 100 ? "is-invalid" : ""}
                  />
                  {/* <FormText>
                    {formData.name.length}/100 characters
                  </FormText> */}
                  {formData.name.length > 100 && (
                    <div className="invalid-feedback">
                      Organization name must be 100 characters or less
                    </div>
                  )}
                </FormGroup>

                {/* Description */}
                <FormGroup className="mb-3">
                  <Label for="description" className="form-label">
                    Description
                  </Label>
                  <Input
                    id="description"
                    name="description"
                    type="textarea"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Enter organization description"
                    maxLength={1000}
                    rows={3}
                    className={formData.description.length > 1000 ? "is-invalid" : ""}
                  />
                  {/* <FormText>
                    {formData.description.length}/1000 characters
                  </FormText> */}
                  {formData.description.length > 1000 && (
                    <div className="invalid-feedback">
                      Description must be 1000 characters or less
                    </div>
                  )}
                </FormGroup>

                {/* Organization Type */}
                <FormGroup className="mb-3">
                  <Label for="org_type" className="form-label">
                    Organization Type
                  </Label>
                  <Select
                    id="org_type"
                    name="org_type"
                    value={orgTypeOptions.find(option => option.value === formData.org_type) || null}
                    onChange={(selectedOption) => handleSelectChange(selectedOption, "org_type")}
                    options={orgTypeOptions}
                    placeholder="Select organization type"
                    isClearable
                    className="react-select-container"
                    classNamePrefix="react-select"
                  />
                </FormGroup>

                {/* Contact */}
                <FormGroup className="mb-3">
                  <Label for="contact" className="form-label">
                    Contact Information
                  </Label>
                  <Input
                    id="contact"
                    name="contact"
                    type="text"
                    value={formData.contact}
                    onChange={handleInputChange}
                    placeholder="Enter contact information"
                    maxLength={100}
                    className={formData.contact.length > 100 ? "is-invalid" : ""}
                  />
                  {/* <FormText>
                    {formData.contact.length}/100 characters
                  </FormText> */}
                  {formData.contact.length > 100 && (
                    <div className="invalid-feedback">
                      Contact information must be 100 characters or less
                    </div>
                  )}
                </FormGroup>

                {/* Website */}
                <FormGroup className="mb-3">
                  <Label for="website" className="form-label">
                    Website
                  </Label>
                  <Input
                    id="website"
                    name="website"
                    type="url"
                    value={formData.website}
                    onChange={handleInputChange}
                    placeholder="https://example.com"
                    maxLength={200}
                    className={formData.website.length > 200 ? "is-invalid" : ""}
                  />
                  {/* <FormText>
                    {formData.website.length}/200 characters
                  </FormText> */}
                  {formData.website.length > 200 && (
                    <div className="invalid-feedback">
                      Website URL must be 200 characters or less
                    </div>
                  )}
                </FormGroup>

                {/* Private Data */}
                <FormGroup className="mb-3">
                  <Label className="form-label d-block">Private Data</Label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <Input
                        className="form-check-input"
                        type="radio"
                        name="private"
                        id="privateNo"
                        value="No"
                        checked={formData.private === "No"}
                        onChange={handleInputChange}
                      />
                      <Label className="form-check-label" htmlFor="privateNo">
                        No
                      </Label>
                    </div>
                    <div className="form-check">
                      <Input
                        className="form-check-input"
                        type="radio"
                        name="private"
                        id="privateYes"
                        value="Yes"
                        checked={formData.private === "Yes"}
                        onChange={handleInputChange}
                      />
                      <Label className="form-check-label" htmlFor="privateYes">
                        Yes
                      </Label>
                    </div>
                  </div>
                </FormGroup>

                {/* Focus Areas */}
                <FormGroup className="mb-3">
                  <Label for="focus" className="form-label">
                    Focus Areas (multi-select)
                  </Label>
                  <Select
                    id="focus"
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
                </FormGroup>

                {/* States */}
                <FormGroup className="mb-4">
                  <Label for="roi_states" className="form-label">
                    States working in(multi-select)
                  </Label>
                  <Select
                    id="roi_states"
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
                </FormGroup>

                {/* Submit Button */}
                <Button
                  type="submit"
                  color="primary"
                  size="lg"
                  className="w-100 auth-submit-btn"
                  disabled={!isFormValid() || submitting}
                >
                  {submitting ? (
                    <>
                      <Spinner size="sm" className="me-2" />
                      Creating Organization...
                    </>
                  ) : (
                    "Create Organization"
                  )}
                </Button>
              </Form>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default CreateOrg;
