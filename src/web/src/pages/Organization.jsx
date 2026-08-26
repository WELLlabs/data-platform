import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  Container,
  Row,
  Col,
  Card,
  CardBody,
  CardHeader,
  Spinner,
  Alert,
  Button,
  Table,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'reactstrap';
import { useAuth } from '../contexts/AuthContext';
import {
  organization_by_id_endpoint,
  approve_user_endpoint,
  reject_user_endpoint,
  change_user_role_endpoint,
  delete_user_endpoint,
} from '../api/endpoints';

const ROLE_OPTIONS = [
  { value: 0, label: 'Member' },
  { value: 1, label: 'Admin' },
  { value: 2, label: 'Reviewer' },
];

const Organization = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, loading: authLoading } = useAuth();

  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [membersEditOpen, setMembersEditOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [roleDraft, setRoleDraft] = useState(0);
  const [membersActionLoading, setMembersActionLoading] = useState(false);
  const [membersModalError, setMembersModalError] = useState(null);

  const orgIdFromQuery = searchParams.get('id');

  const fetchOrganization = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let organizationId = orgIdFromQuery;

      if (!organizationId && !isAuthenticated && !authLoading) {
        navigate('/signin');
        setLoading(false);
        return;
      }

      if (!organizationId && isAuthenticated && user) {
        organizationId = user.organization;
      }

      if (!organizationId) {
        setError('No organization ID provided');
        setLoading(false);
        return;
      }

      let url = organization_by_id_endpoint(organizationId);
      if (isAuthenticated && user?.apikey) {
        url += `?apikey=${encodeURIComponent(user.apikey)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
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
  }, [orgIdFromQuery, isAuthenticated, user, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading) {
      fetchOrganization();
    }
  }, [fetchOrganization, authLoading]);

  const parseApiError = async (response, fallback) => {
    try {
      const errorData = await response.json();
      const detail = errorData?.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) return detail.map((d) => d.msg || String(d)).join(', ');
      return fallback;
    } catch {
      return response.statusText || fallback;
    }
  };

  const handleOpenMembersEdit = () => {
    const members = organization?.members || [];
    const first = members[0];
    setSelectedMemberId(first ? first.id : null);
    setRoleDraft(first != null ? Number(first.role) : 0);
    setMembersModalError(null);
    setMembersEditOpen(true);
  };

  const handleCloseMembersEdit = () => {
    if (membersActionLoading) return;
    setMembersEditOpen(false);
    setMembersModalError(null);
  };

  const handleSelectMemberChange = (e) => {
    const id = e.target.value;
    setSelectedMemberId(id);
    const m = organization?.members?.find((x) => x.id === id);
    if (m) setRoleDraft(Number(m.role));
  };

  const selectedMember =
    organization?.members?.find((m) => m.id === selectedMemberId) ?? null;

  const isOrgAdmin =
    isAuthenticated &&
    user &&
    Number(user.role) === 1 &&
    String(user.organization) === String(organization?.id);

  const handleApproveMember = async () => {
    if (!selectedMember) return;
    try {
      setMembersActionLoading(true);
      setMembersModalError(null);
      const response = await fetch(
        approve_user_endpoint(selectedMember.id, roleDraft),
        { method: 'PUT', credentials: 'include' }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to approve user.'));
      }
      await fetchOrganization();
    } catch (err) {
      setMembersModalError(err.message || 'Failed to approve user.');
    } finally {
      setMembersActionLoading(false);
    }
  };

  const handleRejectMember = async () => {
    if (!selectedMember) return;
    try {
      setMembersActionLoading(true);
      setMembersModalError(null);
      const response = await fetch(reject_user_endpoint(selectedMember.id), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to reject user.'));
      }
      setMembersEditOpen(false);
      await fetchOrganization();
    } catch (err) {
      setMembersModalError(err.message || 'Failed to reject user.');
    } finally {
      setMembersActionLoading(false);
    }
  };

  const handleChangeMemberRole = async () => {
    if (!selectedMember) return;
    try {
      setMembersActionLoading(true);
      setMembersModalError(null);
      const response = await fetch(
        change_user_role_endpoint(selectedMember.id, roleDraft),
        { method: 'PUT', credentials: 'include' }
      );
      if (!response.ok) {
        throw new Error(
          await parseApiError(response, 'Failed to update user role.')
        );
      }
      await fetchOrganization();
    } catch (err) {
      setMembersModalError(err.message || 'Failed to update user role.');
    } finally {
      setMembersActionLoading(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!selectedMember) return;
    try {
      setMembersActionLoading(true);
      setMembersModalError(null);
      const response = await fetch(delete_user_endpoint(selectedMember.id), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to delete user.'));
      }
      setMembersEditOpen(false);
      await fetchOrganization();
    } catch (err) {
      setMembersModalError(err.message || 'Failed to delete user.');
    } finally {
      setMembersActionLoading(false);
    }
  };

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

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formatArray = (arr) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return 'N/A';
    return arr.join(', ');
  };

  const getRoleDisplay = (role) => {
    if (role === 0) return 'Member';
    if (role === 1) return 'Admin';
    if (role === 2) return 'Reviewer';
    return 'Member';
  };

  return (
    <main className="wd-organization">
    <Container className="wd-content py-5">
      <Row>
        <Col lg="10" className="mx-auto">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 className="mb-0">{organization.name}</h2>
            <div className="d-flex gap-2">
              {organization.privileges?.create && (
                <Button color="success" onClick={() => navigate('/createorg')}>
                  Create
                </Button>
              )}
              {organization.privileges?.edit && (
                <Button
                  color="primary"
                  onClick={() => {
                    console.log('Edit organization clicked');
                  }}
                >
                  Edit
                </Button>
              )}
              <Button color="primary" onClick={() => navigate('/orgsearch')}>
                Search
              </Button>
            </div>
          </div>

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
                  <span
                    title={
                      organization.private
                        ? 'Organization can have both public and private datasets'
                        : 'Organization can have only public datasets'
                    }
                    className="opacity-90"
                    style={{ cursor: 'default' }}
                    role="img"
                    aria-label={
                      organization.private
                        ? 'Private organization'
                        : 'Public organization'
                    }
                  >
                    {organization.private ? (
                      <i className="bi bi-lock-fill fs-4" aria-hidden="true" />
                    ) : (
                      <i className="bi bi-globe fs-4" aria-hidden="true" />
                    )}
                  </span>
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
                <Col md="6" className="mb-3">
                  <strong>Contributions:</strong> {organization.contributions ?? 0}
                </Col>
              </Row>
            </CardBody>
          </Card>

          {organization.members && organization.members.length > 0 && (
            <div className="mb-4">
              <div className="mb-3 d-flex flex-row flex-wrap align-items-center justify-content-between gap-2">
                <h4 className="mb-0">Members</h4>
                {isOrgAdmin && (
                  <button
                    type="button"
                    className="btn btn-sm org-members-btn-primary px-3 py-2"
                    onClick={handleOpenMembersEdit}
                    aria-label="Edit organization members"
                  >
                    Edit
                  </button>
                )}
              </div>
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

          <Modal
            isOpen={membersEditOpen}
            toggle={handleCloseMembersEdit}
            centered
          >
            <ModalHeader toggle={handleCloseMembersEdit}>
              Edit members
            </ModalHeader>
            <ModalBody>
              {membersModalError && (
                <Alert color="danger" className="mb-3">
                  {membersModalError}
                </Alert>
              )}
              {organization.members && organization.members.length > 0 ? (
                <>
                  <div className="mb-3 d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-between gap-2">
                    <span className="fw-bold">Select:</span>
                    <select
                      id="org-member-select"
                      className="form-select w-100"
                      style={{ maxWidth: '20rem' }}
                      value={selectedMemberId || ''}
                      onChange={handleSelectMemberChange}
                      aria-label="Select organization member"
                      disabled={membersActionLoading}
                    >
                      {organization.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedMember && (
                    <>
                      <div className="mb-2 d-flex flex-column flex-sm-row justify-content-sm-between gap-1">
                        <span className="fw-bold">Name:</span>
                        <span className="text-sm-end">{selectedMember.full_name}</span>
                      </div>
                      <div className="mb-2 d-flex flex-column flex-sm-row justify-content-sm-between gap-1">
                        <span className="fw-bold">Email:</span>
                        <span className="text-sm-end text-break">
                          {selectedMember.email || 'N/A'}
                        </span>
                      </div>
                      <div className="mb-4 d-flex flex-column flex-sm-row justify-content-sm-between gap-1">
                        <span className="fw-bold">Designation:</span>
                        <span className="text-sm-end">
                          {selectedMember.designation || 'N/A'}
                        </span>
                      </div>
                      <div className="mb-4 d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-between gap-2">
                        <span className="fw-bold">Role:</span>
                        <select
                          id="org-member-role"
                          className="form-select w-100"
                          style={{ maxWidth: '20rem' }}
                          value={roleDraft}
                          onChange={(e) =>
                            setRoleDraft(Number(e.target.value))
                          }
                          aria-label="Member role"
                          disabled={membersActionLoading}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 d-flex flex-wrap gap-2">
                        {selectedMember.verified === false ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm org-members-btn-primary px-3 py-2"
                              onClick={handleApproveMember}
                              disabled={membersActionLoading}
                              aria-label="Approve member"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm org-members-btn-danger px-3 py-2"
                              onClick={handleRejectMember}
                              disabled={membersActionLoading}
                              aria-label="Reject member"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm org-members-btn-primary px-3 py-2"
                              onClick={handleChangeMemberRole}
                              disabled={membersActionLoading}
                              aria-label="Change member role"
                            >
                              Change
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm org-members-btn-danger px-3 py-2"
                              onClick={handleDeleteMember}
                              disabled={membersActionLoading}
                              aria-label="Delete member"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="mb-0 text-muted">No members to edit.</p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button color="secondary" onClick={handleCloseMembersEdit}>
                Close
              </Button>
            </ModalFooter>
          </Modal>
        </Col>
      </Row>
    </Container>
    </main>
  );
};

export default Organization;
