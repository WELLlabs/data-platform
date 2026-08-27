import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Ic from '../components/wd/Icons';
import Contour from '../components/wd/Contour';
import { DatasetRow } from '../components/wd/DatasetItems';
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

const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'OR';

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

  const [dsFilter, setDsFilter] = useState('all');

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

  const getRoleDisplay = (role) => {
    if (role === 0) return 'Member';
    if (role === 1) return 'Admin';
    if (role === 2) return 'Reviewer';
    return 'Member';
  };

  if (authLoading || loading) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: 'var(--s7) 0' }}>
          <div className="empty">
            <p>Loading organization…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: 'var(--s7) 0' }}>
          <div className="empty">
            <h3 className="display">Error</h3>
            <p>{error}</p>
            <div className="dh-actions" style={{ marginTop: 18 }}>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                Try again
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/')}>
                Go home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: 'var(--s7) 0' }}>
          <div className="empty">
            <h3 className="display">No organization found</h3>
            <p>No organization data available.</p>
          </div>
        </div>
      </div>
    );
  }

  const areas = [
    ...(Array.isArray(organization.focus) ? organization.focus : []),
    ...(Array.isArray(organization.roi_states) ? organization.roi_states : []),
  ];
  const since = organization.created_at
    ? new Date(organization.created_at).getFullYear()
    : null;
  const datasets = Array.isArray(organization.datasets)
    ? organization.datasets
    : [];
  const datasetCount =
    organization.datasets_count ??
    (datasets.length || organization.contributions);
  const cats = [
    ...new Set(
      datasets.map((d) => d.category || d.cat).filter(Boolean)
    ),
  ];
  const shownDatasets =
    dsFilter === 'all'
      ? datasets
      : datasets.filter((d) => (d.category || d.cat) === dsFilter);
  const tagline = organization.org_type || organization.contact || '';

  return (
    <div className="page">
      <section className="org-hero">
        <Contour op={0.3} />
        <div className="wrap org-inner">
          <div className="org-badge">{initials(organization.name)}</div>
          <div style={{ flex: 1 }}>
            <Link className="back" to="/orgsearch">
              <Ic name="chevLeft" size={16} />
              Organizations
            </Link>
            <h1 className="display" style={{ marginTop: 6 }}>
              {organization.name}
            </h1>
            {tagline && <p className="tagline">{tagline}</p>}
            <div className="org-meta">
              {datasetCount != null && (
                <>
                  <span>{datasetCount} datasets</span>
                  <span className="sep"></span>
                </>
              )}
              <span>{areas.length} research areas</span>
              {since && (
                <>
                  <span className="sep"></span>
                  <span>Contributing since {since}</span>
                </>
              )}
            </div>
            {areas.length > 0 && (
              <div className="org-areas">
                {areas.map((a, i) => (
                  <span className="tag" key={`${a}-${i}`}>
                    {a}
                  </span>
                ))}
              </div>
            )}
            {(organization.privileges?.create ||
              organization.privileges?.edit) && (
              <div className="dh-actions" style={{ marginTop: 20 }}>
                {organization.privileges?.create && (
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate('/createorg')}
                  >
                    Create
                  </button>
                )}
                {organization.privileges?.edit && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      console.log('Edit organization clicked');
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {organization.description && (
        <section className="wrap" style={{ padding: 'var(--s6) 0 0' }}>
          <div className="sec-label">About</div>
          <p className="org-about">{organization.description}</p>
        </section>
      )}

      <section className="wrap" style={{ padding: 'var(--s7) 0 var(--s6)' }}>
        <div className="section-head">
          <h2 className="section-title">Datasets</h2>
          {cats.length > 0 && (
            <div className="seg">
              <button
                className={dsFilter === 'all' ? 'active' : ''}
                onClick={() => setDsFilter('all')}
              >
                All
              </button>
              {cats.map((c) => (
                <button
                  key={c}
                  className={dsFilter === c ? 'active' : ''}
                  onClick={() => setDsFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="rows">
          {shownDatasets.length > 0 ? (
            shownDatasets.map((d) => (
              <DatasetRow
                key={d.dataset_id ?? d.id ?? d.datasetId}
                dataset={d}
              />
            ))
          ) : (
            <p className="muted" style={{ padding: '22px 0' }}>
              No datasets in this area yet.
            </p>
          )}
        </div>
      </section>

      {organization.members && organization.members.length > 0 && (
        <section className="wrap" style={{ padding: '0 0 var(--s8)' }}>
          <hr className="divider" style={{ marginBottom: 'var(--s5)' }} />
          <div className="section-head" style={{ marginBottom: 14 }}>
            <div className="sec-label" style={{ marginBottom: 0 }}>
              Members
            </div>
            {isOrgAdmin && (
              <button
                className="btn btn-ghost"
                onClick={handleOpenMembersEdit}
                aria-label="Edit organization members"
              >
                Edit
              </button>
            )}
          </div>
          <div className="members">
            {organization.members.map((member) => (
              <div className="member" key={member.id}>
                <div
                  className="avatar"
                  style={{ width: 40, height: 40, fontSize: 14 }}
                >
                  {initials(member.full_name)}
                </div>
                <div>
                  <b>
                    <Link
                      to={`/profile?id=${member.id}`}
                      style={{ color: 'inherit' }}
                    >
                      {member.full_name}
                    </Link>
                  </b>
                  <span>{member.designation || getRoleDisplay(member.role)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {membersEditOpen && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseMembersEdit();
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <h3>Edit members</h3>
              <p>Approve, update or remove organization members.</p>
            </div>
            <div className="modal-body">
              {membersModalError && (
                <p className="muted" style={{ color: 'var(--danger, #c0392b)' }}>
                  {membersModalError}
                </p>
              )}
              {organization.members && organization.members.length > 0 ? (
                <>
                  <div className="field">
                    <label htmlFor="org-member-select">Select member</label>
                    <select
                      id="org-member-select"
                      value={selectedMemberId || ''}
                      onChange={handleSelectMemberChange}
                      aria-label="Select organization member"
                      disabled={membersActionLoading}
                      style={{ width: '100%' }}
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
                      <div className="field-row">
                        <div className="field">
                          <label>Name</label>
                          <input value={selectedMember.full_name} readOnly />
                        </div>
                        <div className="field">
                          <label>Email</label>
                          <input
                            value={selectedMember.email || 'N/A'}
                            readOnly
                          />
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Designation</label>
                          <input
                            value={selectedMember.designation || 'N/A'}
                            readOnly
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="org-member-role">Role</label>
                          <select
                            id="org-member-role"
                            value={roleDraft}
                            onChange={(e) => setRoleDraft(Number(e.target.value))}
                            aria-label="Member role"
                            disabled={membersActionLoading}
                            style={{ width: '100%' }}
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        {selectedMember.verified === false ? (
                          <>
                            <button
                              className="btn btn-primary"
                              onClick={handleApproveMember}
                              disabled={membersActionLoading}
                              aria-label="Approve member"
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-ghost"
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
                              className="btn btn-primary"
                              onClick={handleChangeMemberRole}
                              disabled={membersActionLoading}
                              aria-label="Change member role"
                            >
                              Change
                            </button>
                            <button
                              className="btn btn-ghost"
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
                <p className="muted">No members to edit.</p>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-ghost"
                onClick={handleCloseMembersEdit}
                disabled={membersActionLoading}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Organization;
