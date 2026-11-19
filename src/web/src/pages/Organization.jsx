import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import Select from 'react-select';
import { useAuth } from '../contexts/AuthContext';
import Ic from '../components/wd/Icons';
import Contour from '../components/wd/Contour';
import { clearOrganizationNamesCache } from '../components/wd/DatasetItems';
import {
  organization_by_id_endpoint,
  organization_add_member_endpoint,
} from '../api/endpoints';

const ORG_TYPE_OPTIONS = [
  { value: 'Private', label: 'Private' },
  { value: 'Government', label: 'Government' },
  { value: 'NGO', label: 'NGO' },
  { value: 'Non-Profit', label: 'Non-Profit' },
];

const FOCUS_OPTIONS = [
  { value: 'Watershed Management', label: 'Watershed Management' },
  { value: 'Agricultural Analysis', label: 'Agricultural Analysis' },
  { value: 'Climate Impact', label: 'Climate Impact' },
  { value: 'Research & Development', label: 'Research & Development' },
  { value: 'Government Projects', label: 'Government Projects' },
  { value: 'NGO Work', label: 'NGO Work' },
  { value: 'Academic Research', label: 'Academic Research' },
  { value: 'Commercial', label: 'Commercial' },
];

const STATE_OPTIONS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli',
  'Daman and Diu',
  'Lakshadweep',
  'National Capital Territory of Delhi',
  'Puducherry',
].map((value) => ({ value, label: value }));

// react-select menus render in a body portal so the modal's scrolling body
// does not clip them; zIndex sits above the .cmdk-overlay (z-index 100).
const SELECT_PORTAL_STYLES = { menuPortal: (base) => ({ ...base, zIndex: 120 }) };

const toOptions = (values) =>
  (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map((value) => ({ value, label: value }));

const withCurrentOptions = (options, selected) => {
  const known = new Set(options.map((option) => option.value));
  return [...options, ...selected.filter((option) => !known.has(option.value))];
};

const formFromOrganization = (org) => ({
  name: org.name || '',
  description: org.description || '',
  org_type: org.org_type || '',
  contact: org.contact || '',
  website: org.website || '',
  private: Boolean(org.private),
  focus: toOptions(org.focus),
  roi_states: toOptions(org.roi_states),
  allowed_email_domains: (org.allowed_email_domains || []).join(', '),
  allow_password: org.allow_password !== false,
  allow_google: org.allow_google !== false,
});

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
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const editModalRef = useRef(null);
  const editNameInputRef = useRef(null);

  const orgIdFromQuery = searchParams.get('id');

  const fetchOrganization = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
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

  const openEdit = () => {
    if (!organization) return;
    setEditForm(formFromOrganization(organization));
    setEditError(null);
    setEditing(true);
  };

  const closeEdit = useCallback(() => {
    if (editSaving) return;
    setEditing(false);
    setEditError(null);
  }, [editSaving]);

  // Edit organisation modal: initial focus, Escape to close, focus trap,
  // background scroll lock, and focus return to the trigger on close.
  useEffect(() => {
    if (!editing) return undefined;
    const previousActive = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => editNameInputRef.current?.focus());
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // react-select handles Escape itself (closing its menu) and marks it handled.
        if (e.defaultPrevented) return;
        e.preventDefault();
        closeEdit();
        return;
      }
      if (e.key !== 'Tab' || !editModalRef.current) return;
      const focusables = [
        ...editModalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const idx = focusables.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) {
        e.preventDefault();
        focusables[focusables.length - 1].focus();
      } else if (!e.shiftKey && (idx === -1 || idx >= focusables.length - 1)) {
        e.preventDefault();
        focusables[0].focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.();
    };
  }, [editing, closeEdit]);

  const handleEditChange = (event) => {
    const { name, value, type, checked } = event.target;
    setEditForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveOrganization = async (event) => {
    event.preventDefault();
    if (!organization?.id || !editForm) return;
    const name = editForm.name.trim();
    if (!name || name.length > 100) {
      setEditError('Organisation name is required and must be 100 characters or fewer.');
      return;
    }
    if (editForm.description.length > 250) {
      setEditError('Description must be 250 characters or fewer.');
      return;
    }
    try {
      setEditSaving(true);
      setEditError(null);
      const domains = editForm.allowed_email_domains
        .split(/[,;\s]+/)
        .map((item) => item.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
      const response = await fetch(organization_by_id_endpoint(organization.id), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: editForm.description.trim() || null,
          org_type: editForm.org_type || null,
          contact: editForm.contact.trim() || null,
          website: editForm.website.trim() || null,
          private: editForm.private,
          focus: editForm.focus.map((item) => item.value),
          roi_states: editForm.roi_states.map((item) => item.value),
          allowed_email_domains: domains.length ? domains : null,
          allow_password: editForm.allow_password,
          allow_google: editForm.allow_google,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to save organisation.'));
      }
      clearOrganizationNamesCache();
      setEditing(false);
      setEditForm(null);
      await fetchOrganization({ silent: true });
    } catch (err) {
      setEditError(err.message || 'Failed to save organisation.');
    } finally {
      setEditSaving(false);
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
                  type="button"
                  className="btn btn-ghost"
                  onClick={openEdit}
                  aria-haspopup="dialog"
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


      {editing && editForm && (
        <div
          className="cmdk-overlay show org-edit-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="org-edit-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className="modal-card modal-lg" ref={editModalRef}>
          <form onSubmit={handleSaveOrganization} noValidate>
            <div className="modal-head">
              <div>
                <h3 id="org-edit-modal-title">Edit organisation</h3>
                <p>Update how this organisation appears and who can join it.</p>
              </div>
              <button
                type="button"
                className="modal-x"
                onClick={closeEdit}
                aria-label="Close"
                disabled={editSaving}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {editError && (
                <div className="form-note err" role="alert">
                  <span>{editError}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor="org-edit-name">
                  Organisation name <span className="req">(required)</span>
                </label>
                <input
                  id="org-edit-name"
                  ref={editNameInputRef}
                  name="name"
                  type="text"
                  value={editForm.name}
                  onChange={handleEditChange}
                  maxLength={100}
                  required
                  disabled={editSaving}
                />
              </div>
              <div className="field">
                <label htmlFor="org-edit-description">
                  Description <span className="opt">(optional)</span>
                </label>
                <textarea
                  id="org-edit-description"
                  name="description"
                  value={editForm.description}
                  onChange={handleEditChange}
                  maxLength={250}
                  rows={3}
                  disabled={editSaving}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="org-edit-type">
                    Organisation type <span className="opt">(optional)</span>
                  </label>
                  <Select
                    inputId="org-edit-type"
                    name="org_type"
                    value={
                      withCurrentOptions(ORG_TYPE_OPTIONS, toOptions([editForm.org_type])).find(
                        (option) => option.value === editForm.org_type
                      ) || null
                    }
                    onChange={(option) =>
                      setEditForm((prev) => ({
                        ...prev,
                        org_type: option ? option.value : '',
                      }))
                    }
                    options={withCurrentOptions(ORG_TYPE_OPTIONS, toOptions([editForm.org_type]))}
                    placeholder="Select a type"
                    isClearable
                    isDisabled={editSaving}
                    className="react-select-container"
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={SELECT_PORTAL_STYLES}
                    classNamePrefix="react-select"
                  />
                </div>
                <div className="field">
                  <label htmlFor="org-edit-website">
                    Website <span className="opt">(optional)</span>
                  </label>
                  <input
                    id="org-edit-website"
                    name="website"
                    type="text"
                    value={editForm.website}
                    onChange={handleEditChange}
                    maxLength={200}
                    disabled={editSaving}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="org-edit-contact">
                  Contact information <span className="opt">(optional)</span>
                </label>
                <input
                  id="org-edit-contact"
                  name="contact"
                  type="text"
                  value={editForm.contact}
                  onChange={handleEditChange}
                  maxLength={100}
                  disabled={editSaving}
                />
              </div>
              <div className="field">
                <label htmlFor="org-edit-domains">
                  Allowed email domains <span className="opt">(optional)</span>
                </label>
                <input
                  id="org-edit-domains"
                  name="allowed_email_domains"
                  type="text"
                  value={editForm.allowed_email_domains}
                  onChange={handleEditChange}
                  placeholder="e.g. welllabs.org, ifmr.ac.in"
                  disabled={editSaving}
                />
              </div>
              <div className="co-switches">
                <label className="co-switch">
                  <span className="co-switch-text">
                    <b>Password sign-up</b>
                    <small>Members can create an account with an email and password.</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    name="allow_password"
                    checked={editForm.allow_password}
                    onChange={handleEditChange}
                    disabled={editSaving}
                  />
                  <span className="co-switch-track" aria-hidden="true">
                    <span className="co-switch-thumb" />
                  </span>
                </label>
                <label className="co-switch">
                  <span className="co-switch-text">
                    <b>Google sign-in</b>
                    <small>Members can sign in with their Google account.</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    name="allow_google"
                    checked={editForm.allow_google}
                    onChange={handleEditChange}
                    disabled={editSaving}
                  />
                  <span className="co-switch-track" aria-hidden="true">
                    <span className="co-switch-thumb" />
                  </span>
                </label>
              </div>
              <div className="field co-private">
                <div>
                  <label id="org-edit-private-label" style={{ marginBottom: 2 }}>
                    Private data
                  </label>
                  <span className="hint" style={{ marginTop: 0 }}>
                    Allows datasets to be restricted to members of this organisation.
                  </span>
                </div>
                <div className="seg" role="radiogroup" aria-labelledby="org-edit-private-label">
                  {[
                    { label: 'No', value: false },
                    { label: 'Yes', value: true },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={editForm.private === option.value}
                      className={'seg-opt' + (editForm.private === option.value ? ' on' : '')}
                      onClick={() =>
                        setEditForm((prev) => ({ ...prev, private: option.value }))
                      }
                      disabled={editSaving}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="org-edit-focus">
                  Focus areas <span className="opt">(select any)</span>
                </label>
                <Select
                  inputId="org-edit-focus"
                  name="focus"
                  value={editForm.focus}
                  onChange={(options) =>
                    setEditForm((prev) => ({ ...prev, focus: options || [] }))
                  }
                  options={withCurrentOptions(FOCUS_OPTIONS, editForm.focus)}
                  isMulti
                  isClearable
                  closeMenuOnSelect={false}
                  isDisabled={editSaving}
                  className="react-select-container"
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={SELECT_PORTAL_STYLES}
                  classNamePrefix="react-select"
                />
              </div>
              <div className="field">
                <label htmlFor="org-edit-states">
                  States and union territories <span className="opt">(select any)</span>
                </label>
                <Select
                  inputId="org-edit-states"
                  name="roi_states"
                  value={editForm.roi_states}
                  onChange={(options) =>
                    setEditForm((prev) => ({ ...prev, roi_states: options || [] }))
                  }
                  options={withCurrentOptions(STATE_OPTIONS, editForm.roi_states)}
                  isMulti
                  isClearable
                  isSearchable
                  closeMenuOnSelect={false}
                  isDisabled={editSaving}
                  className="react-select-container"
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={SELECT_PORTAL_STYLES}
                  classNamePrefix="react-select"
                />
              </div>
            </div>
            <div className="modal-foot org-edit-foot">
              <span className="fa-note">Changes apply to this organisation only.</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeEdit}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Organization;
