import React, { useState, useEffect } from "react";
import { Container, Row, Col, Card, Alert, Button } from "reactstrap";
import { useNavigate, useSearchParams } from "react-router-dom";

function CreateOrgSuccess() {
  const [orgName, setOrgName] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [orgId, setOrgId] = useState("");
  const [isValidAccess, setIsValidAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Check if page was accessed with proper query parameters
    const name = searchParams.get("name");
    const created_at = searchParams.get("created_at");
    const id = searchParams.get("id");

    if (name && created_at && id) {
      setOrgName(decodeURIComponent(name));
      setCreatedAt(decodeURIComponent(created_at));
      setOrgId(decodeURIComponent(id));
      setIsValidAccess(true);
    } else {
      setIsValidAccess(false);
    }
    
    setLoading(false);
  }, [searchParams]);

  // Format date to human readable format
  const formatDate = (dateString) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
      });
    } catch (error) {
      return dateString; // Return original string if parsing fails
    }
  };

  if (loading) {
    return (
      <div className="bg-wave">
        <Container className="py-5">
          <Row className="justify-content-center">
            <Col md="8" lg="6">
              <Card className="p-5 text-center">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <h5 className="mt-3">Loading...</h5>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  // Invalid access - page accessed directly without proper parameters
  if (!isValidAccess) {
    return (
      <div className="bg-wave">
        <Container className="py-5">
          <Row className="justify-content-center">
            <Col md="8" lg="6">
              <Card className="p-4 p-md-5 text-center">
                <Alert color="warning" className="mb-4">
                  <h5 className="alert-heading">Invalid Access</h5>
                  <p className="mb-0">
                    Navigation to this page is invalid. Go to sign up or create organisation.
                  </p>
                </Alert>
                
                <div className="d-flex flex-column flex-md-row gap-2 justify-content-center">
                  <Button 
                    color="primary" 
                    onClick={() => navigate("/signup")}
                    className="mb-2 mb-md-0"
                  >
                    Sign Up
                  </Button>
                  <Button 
                    color="outline-primary" 
                    onClick={() => navigate("/createorg")}
                  >
                    Create Organisation
                  </Button>
                </div>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }

  // Valid access - show success message
  return (
    <div className="bg-wave">
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="8" lg="6">
            <Card className="p-4 p-md-5 text-center">
              <div className="mb-4">
                <div className="text-success mb-3">
                  <i className="bi bi-check-circle-fill" style={{ fontSize: "4rem" }}></i>
                </div>
                <h3 className="text-success mb-3">Success!</h3>
              </div>

              <Alert color="success" className="mb-4">
                <h5 className="alert-heading">Organization Created Successfully</h5>
                <p className="mb-2">
                  Organisation <strong>{orgName}</strong> is successfully created at{" "}
                  <strong>{formatDate(createdAt)}</strong>.
                </p>
                <p className="mb-0">
                  Organisation ID: <strong>{orgId}</strong>
                </p>
              </Alert>

              <div className="d-flex flex-column flex-md-row gap-2 justify-content-center">
                <Button 
                  color="primary" 
                  onClick={() => navigate("/signup")}
                  className="mb-2 mb-md-0"
                >
                  Sign Up
                </Button>
                <Button 
                  color="outline-primary" 
                  onClick={() => navigate("/createorg")}
                  className="mb-2 mb-md-0"
                >
                  Create Another Organization
                </Button>
                <Button 
                  color="outline-secondary" 
                  onClick={() => navigate("/")}
                >
                  Go Home
                </Button>
              </div>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default CreateOrgSuccess;
