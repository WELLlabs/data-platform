import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Ic from '../components/wd/Icons';
import Contour from '../components/wd/Contour';
import {
  organization_by_id_endpoint,
  organization_add_member_endpoint,
} from '../api/endpoints';

const roleClass = (role) => {
  if (Number(role) === 1) return 'admin';
  if (Number(role) === 2) return 'reviewer';
  return '';
};

// Best-effort contribution count from whatever the API exposes per member.
const contributionsOf = (m = {}) =>
  Number(
    m.contributions ??
      m.datasets_count ??
      m.contributions_count ??
      m.dataset_count ??
      m.datasets ??
      0
  ) || 0;

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

  const [membersActionLoading, setMembersActionLoading] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [addMemberError, setAddMemberError] = useState(null);

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

      const url = organization_by_id_endpoint(organizationId);

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

  const isOrgAdmin =
    isAuthenticated &&
    user &&
    (Boolean(user.is_superuser) ||
      (Number(user.role) === 1 &&
        String(user.organization) === String(organization?.id)));

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!organization?.id || !addMemberEmail.trim()) return;
    try {
      setMembersActionLoading(true);
      setAddMemberError(null);
      const response = await fetch(
        organization_add_member_endpoint(organization.id),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: addMemberEmail.trim(),
            role: 0,
            approve_now: Boolean(user?.is_superuser),
          }),
        }
      );
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to add member.'));
      }
      setAddMemberEmail('');
      await fetchOrganization();
    } catch (err) {
      setAddMemberError(err.message || 'Failed to add member.');
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
  const datasetCount =
    organization.datasets_count ?? organization.contributions;
  const tagline = organization.org_type || organization.contact || '';
  const maxContrib = (organization.members || []).reduce(
    (max, m) => Math.max(max, contributionsOf(m)),
    0
  );

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
            <div className="org-areas" style={{ marginTop: 12 }}>
              {organization.private ? (
                <span className="badge lock">Private data enabled</span>
              ) : (
                <span className="badge public dot">Public organization</span>
              )}
            </div>
            {organization.privileges?.edit && (
              <div className="org-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    console.log('Edit organization clicked');
                  }}
                >
                  Edit
                </button>
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

      {(organization.members?.length > 0 || isOrgAdmin) && (
        <section className="wrap" style={{ padding: 'var(--s7) 0 var(--s8)' }}>
          <hr className="divider" style={{ marginBottom: 'var(--s5)' }} />
          <div className="section-head" style={{ marginBottom: 14 }}>
            <div>
              <div className="sec-label" style={{ marginBottom: 4 }}>
                Members
              </div>
              <span className="muted" style={{ fontSize: 13.5 }}>
                {(organization.members?.length || 0)}{' '}
                {(organization.members?.length || 0) === 1 ? 'person' : 'people'} in
                this organization
              </span>
            </div>
          </div>
          {isOrgAdmin && (
            <form
              onSubmit={handleAddMember}
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}
            >
              <div className="field" style={{ flex: '1 1 240px', marginBottom: 0 }}>
                <label htmlFor="add-org-member-email">Add member by email</label>
                <input
                  id="add-org-member-email"
                  type="email"
                  value={addMemberEmail}
                  onChange={(e) => setAddMemberEmail(e.target.value)}
                  placeholder="member@example.com"
                  disabled={membersActionLoading}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={membersActionLoading || !addMemberEmail.trim()}
              >
                Add member
              </button>
            </form>
          )}
          {addMemberError && (
            <p className="muted" style={{ color: 'var(--danger, #c0392b)', marginBottom: 12 }}>
              {addMemberError}
            </p>
          )}
          {(() => {
            const members = organization.members || [];
            const topId =
              maxContrib > 0
                ? members.reduce(
                    (best, m) =>
                      contributionsOf(m) > contributionsOf(best) ? m : best,
                    members[0]
                  )?.id
                : null;
            return (
              <div className="member-grid">
                {members.map((member, i) => {
                  const isTop = member.id === topId;
                  const contribs = contributionsOf(member);
                  const roleLabel = getRoleDisplay(member.role);
                  return (
                    <div
                      className={'member-card' + (isTop ? ' top' : '')}
                      key={member.id}
                      style={{ animationDelay: `${Math.min(i * 55, 400)}ms` }}
                    >
                      <div className="m-av">{initials(member.full_name)}</div>
                      <div className="m-body">
                        <div className="m-name">
                          <Link to={`/profile?id=${member.id}`}>
                            {member.full_name}
                          </Link>
                          {isTop && (
                            <span className="badge top">
                              <Ic name="trophy" size={12} sw={2} />
                              Top contributor
                            </span>
                          )}
                          {member.verified === false && (
                            <span className="badge pending">Pending</span>
                          )}
                        </div>
                        {member.designation && (
                          <div className="m-desig">{member.designation}</div>
                        )}
                        {member.email && (
                          <div className="m-mail" title={member.email}>
                            <Ic name="mail" size={13} sw={2} />
                            <span>{member.email}</span>
                          </div>
                        )}
                        <div className="m-meta">
                          <span className={'role-badge ' + roleClass(member.role)}>
                            {Number(member.role) === 1 && (
                              <Ic name="star" size={11} sw={2} />
                            )}
                            {roleLabel}
                          </span>
                          {contribs > 0 && (
                            <span className="contrib-count">
                              <b>{contribs.toLocaleString('en-IN')}</b>{' '}
                              {contribs === 1 ? 'dataset' : 'datasets'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {(!organization.members || organization.members.length === 0) && (
            <p className="muted">No members yet.</p>
          )}
        </section>
      )}

    </div>
  );
};

export default Organization;
