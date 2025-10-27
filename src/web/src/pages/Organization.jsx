import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  CardBody, 
  CardHeader, 
  Badge, 
  Spinner, 
  Alert,
  Button,
  ListGroup,
  ListGroupItem
} from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import { organization_by_id_endpoint } from '../api/endpoints';

const Organization = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, loading: authLoading, verifyUser } = useAuth();
  
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Get organization ID from query parameter
  const orgIdFromQuery = searchParams.get('id');

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        setLoading(true);
        setError(null);

        let organizationId = orgIdFromQuery;

        // If no ID in query params and user is not authenticated, redirect to signin
        if (!organizationId && !isAuthenticated && !authLoading) {
          navigate('/signin');
          return;
        }

        // If no ID in query params but user is authenticated, use user's organization
        if (!organizationId && isAuthenticated && user) {
          organizationId = user.organization;
        }

        // If still no organization ID, show error
        if (!organizationId) {
          setError('No organization ID provided');
          setLoading(false);
          return;
        }

        // Fetch organization details
        const response = await fetch(organization_by_id_endpoint(organizationId), {
          method: 'GET',
          credentials: 'include'
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError('Organization not found');
          } else {
            setError('Failed to fetch organization details');
          }
          return;
        }

        const orgData = await response.json();
        setOrganization(orgData);

      } catch (err) {
        console.error('Error fetching organization:', err);
        setError('An error occurred while fetching organization details');
      } finally {
        setLoading(false);
      }
    };

    // Only fetch if auth loading is complete
    if (!authLoading) {
      fetchOrganization();
    }
  }, [orgIdFromQuery, isAuthenticated, user, authLoading, navigate]);

  // Show loading spinner while auth is loading
  if (authLoading) {
    return (
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="auto">
            <div className="text-center">
              <Spinner color="primary" size="lg" />
              <p className="mt-3">Loading...</p>
            </div>
          </Col>
        </Row>
      </Container>
    );
  }

  // Show loading spinner while fetching organization
  if (loading) {
    return (
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="auto">
            <div className="text-center">
              <Spinner color="primary" size="lg" />
              <p className="mt-3">Loading organization details...</p>
            </div>
          </Col>
        </Row>
      </Container>
    );
  }

  // Show error message
  if (error) {
    return (
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="8">
            <Alert color="danger">
              <h4 className="alert-heading">Error</h4>
              <p>{error}</p>
              <hr />
              <div className="d-flex gap-2">
                <Button color="primary" onClick={() => window.location.reload()}>
                  Try Again
                </Button>
                <Button color="secondary" onClick={() => navigate('/')}>
                  Go Home
                </Button>
              </div>
            </Alert>
          </Col>
        </Row>
      </Container>
    );
  }

  // Show organization details
  if (!organization) {
    return (
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col md="8">
            <Alert color="warning">
              <h4 className="alert-heading">No Organization Found</h4>
              <p>No organization data available.</p>
            </Alert>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <Row>
        <Col lg="8" className="mx-auto">
          {/* Organization Header */}
          <Card className="mb-4 shadow-sm">
            <CardHeader className="bg-primary text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h2 className="mb-1">{organization.name}</h2>
                  <p className="mb-0 opacity-75">
                    <i className="bi bi-building me-2"></i>
                    Organization Details
                  </p>
                </div>
                <div className="text-end">
                  <Badge 
                    color={organization.private ? "warning" : "success"} 
                    className="fs-6"
                  >
                    {organization.private ? "Private" : "Public"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {organization.description && (
                <div className="mb-4">
                  <h5 className="text-muted mb-2">Description</h5>
                  <p className="lead">{organization.description}</p>
                </div>
              )}

              <Row>
                <Col md="6">
                  <div className="mb-3">
                    <h6 className="text-muted mb-2">
                      <i className="bi bi-tag me-2"></i>
                      Organization Type
                    </h6>
                    <p className="mb-0">
                      {organization.org_type || 'Not specified'}
                    </p>
                  </div>
                </Col>
                <Col md="6">
                  <div className="mb-3">
                    <h6 className="text-muted mb-2">
                      <i className="bi bi-people me-2"></i>
                      Contributions
                    </h6>
                    <p className="mb-0">
                      <Badge color="info" className="fs-6">
                        {organization.contributions}
                      </Badge>
                    </p>
                  </div>
                </Col>
              </Row>

              <Row>
                <Col md="6">
                  <div className="mb-3">
                    <h6 className="text-muted mb-2">
                      <i className="bi bi-calendar me-2"></i>
                      Created
                    </h6>
                    <p className="mb-0">
                      {new Date(organization.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                </Col>
                <Col md="6">
                  <div className="mb-3">
                    <h6 className="text-muted mb-2">
                      <i className="bi bi-hash me-2"></i>
                      Organization ID
                    </h6>
                    <p className="mb-0 font-monospace small">
                      {organization.id}
                    </p>
                  </div>
                </Col>
              </Row>
            </CardBody>
          </Card>

          {/* Contact Information */}
          {(organization.contact || organization.website) && (
            <Card className="mb-4 shadow-sm">
              <CardHeader className="bg-light">
                <h5 className="mb-0">
                  <i className="bi bi-envelope me-2"></i>
                  Contact Information
                </h5>
              </CardHeader>
              <CardBody>
                <Row>
                  {organization.contact && (
                    <Col md="6">
                      <div className="mb-3">
                        <h6 className="text-muted mb-2">Contact</h6>
                        <p className="mb-0">{organization.contact}</p>
                      </div>
                    </Col>
                  )}
                  {organization.website && (
                    <Col md="6">
                      <div className="mb-3">
                        <h6 className="text-muted mb-2">Website</h6>
                        <a 
                          href={organization.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-decoration-none"
                        >
                          {organization.website}
                          <i className="bi bi-box-arrow-up-right ms-1"></i>
                        </a>
                      </div>
                    </Col>
                  )}
                </Row>
              </CardBody>
            </Card>
          )}

          {/* Focus Areas */}
          {organization.focus && organization.focus.length > 0 && (
            <Card className="mb-4 shadow-sm">
              <CardHeader className="bg-light">
                <h5 className="mb-0">
                  <i className="bi bi-bullseye me-2"></i>
                  Focus Areas
                </h5>
              </CardHeader>
              <CardBody>
                <div className="d-flex flex-wrap gap-2">
                  {organization.focus.map((area, index) => (
                    <Badge key={index} color="primary" className="fs-6 px-3 py-2">
                      {area}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* ROI States */}
          {organization.roi_states && organization.roi_states.length > 0 && (
            <Card className="mb-4 shadow-sm">
              <CardHeader className="bg-light">
                <h5 className="mb-0">
                  <i className="bi bi-geo-alt me-2"></i>
                  ROI States
                </h5>
              </CardHeader>
              <CardBody>
                <div className="d-flex flex-wrap gap-2">
                  {organization.roi_states.map((state, index) => (
                    <Badge key={index} color="secondary" className="fs-6 px-3 py-2">
                      {state}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Action Buttons */}
          <Card className="shadow-sm">
            <CardBody className="text-center">
              <div className="d-flex flex-wrap justify-content-center gap-3">
                <Button 
                  color="primary" 
                  size="lg"
                  onClick={() => navigate('/orgsearch')}
                >
                  <i className="bi bi-search me-2"></i>
                  Search Organizations
                </Button>
                {isAuthenticated && (
                  <Button 
                    color="success" 
                    size="lg"
                    onClick={() => navigate('/createorg')}
                  >
                    <i className="bi bi-plus-circle me-2"></i>
                    Create Organization
                  </Button>
                )}
                <Button 
                  color="outline-primary" 
                  size="lg"
                  onClick={() => navigate('/')}
                >
                  <i className="bi bi-house me-2"></i>
                  Go Home
                </Button>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Organization;
