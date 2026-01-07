import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
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
  Table
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

        // Build URL with optional apikey query parameter
        let url = organization_by_id_endpoint(organizationId);
        if (isAuthenticated && user?.apikey) {
          url += `?apikey=${encodeURIComponent(user.apikey)}`;
        }

        // Fetch organization details
        const response = await fetch(url, {
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

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Helper function to format array as comma-separated string
  const formatArray = (arr) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return 'N/A';
    return arr.join(', ');
  };

  // Helper function to get role display
  const getRoleDisplay = (role) => {
    if (role === 0) return 'Member';
    if (role === 1) return 'Admin';
    if (role === 2) return 'Editor';
    return 'Member';
  };

  return (
    <Container className="py-5">
      <Row>
        <Col lg="8" className="mx-auto">
          {/* Header with title and action buttons */}
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 className="mb-0">{organization.name}</h2>
            <div className="d-flex gap-2">
              {organization.privileges?.create && (
                <Button 
                  color="success" 
                  onClick={() => navigate('/createorg')}
                >
                  Create
                </Button>
              )}
              {organization.privileges?.edit && (
                <Button 
                  color="primary"
                  onClick={() => {
                    // TODO: Navigate to edit page
                    console.log('Edit organization clicked');
                  }}
                >
                  Edit
                </Button>
              )}
              <Button 
                color="primary"
                onClick={() => navigate('/orgsearch')}
              >
                Search
              </Button>
            </div>
          </div>

          {/* Organization Details Card */}
          <Card className="mb-4 shadow-sm">
            <CardHeader className="bg-primary text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
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
              <Row>
                <Col md="6" className="mb-3">
                  <strong>Organization ID:</strong> {organization.id}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Creator:</strong>{' '}
                  {organization.creator_name ? (
                    <Link 
                      to={`/profile?id=${organization.creator}`}
                      style={{ color: '#1b75e0' }}
                    >
                      {organization.creator_name}
                    </Link>
                  ) : (
                    'N/A'
                  )}
                </Col>
                <Col md="12" className="mb-3">
                  <strong>Description:</strong> {organization.description || 'N/A'}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Organization Type:</strong> {organization.org_type || 'N/A'}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Contact:</strong> {organization.contact || 'N/A'}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Website:</strong>{' '}
                  {organization.website ? (
                    <a 
                      href={organization.website} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-decoration-none"
                    >
                      {organization.website}
                      <i className="bi bi-box-arrow-up-right ms-1"></i>
                    </a>
                  ) : (
                    'N/A'
                  )}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Contributions:</strong> {organization.contributions || 0}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Focus:</strong> {formatArray(organization.focus)}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>States:</strong> {formatArray(organization.roi_states)}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Created At:</strong> {formatDate(organization.created_at)}
                </Col>
                <Col md="6" className="mb-3">
                  <strong>Modified At:</strong> {formatDate(organization.modified_at)}
                </Col>
              </Row>
            </CardBody>
          </Card>

          {/* Members Section */}
          {organization.members && organization.members.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-3">Members</h4>
              <Table borderless responsive>
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Designation</th>
                    <th>Email</th>
                    <th>Contributions</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {organization.members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <span
                          title={member.verified ? 'Approved' : 'Not Approved'}
                        >
                          {member.verified ? (
                            <i className="bi bi-check-circle-fill text-success"></i>
                          ) : (
                            <i className="bi bi-x-circle-fill text-danger"></i>
                          )}
                        </span>
                      </td>
                      <td>
                        <Link 
                          to={`/profile?id=${member.id}`}
                          style={{ color: '#1b75e0' }}
                        >
                          {member.full_name}
                        </Link>
                      </td>
                      <td>{member.designation || 'N/A'}</td>
                      <td>{member.email || 'N/A'}</td>
                      <td>{member.contributions || 0}</td>
                      <td>{getRoleDisplay(member.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default Organization;
