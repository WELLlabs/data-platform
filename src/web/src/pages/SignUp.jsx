import React, { useMemo, useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { signup_endpoint } from "../api/endpoints";

function SignUp() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isStudent, setIsStudent] = useState(false);
  const [designation, setDesignation] = useState("");
  const [team, setTeam] = useState("");
  const [organization, setOrganization] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  // When student is true, force designation to "student" and lock the field
  useEffect(() => {
    if (isStudent) {
      setDesignation("student");
    }
  }, [isStudent]);

  const passwordsMatch = useMemo(
    () => password.length > 0 && password === confirmPassword,
    [password, confirmPassword]
  );

  const emailValid = useMemo(() => {
    // Simple email regex for client-side validation
    const re = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    return re.test(email.trim());
  }, [email]);

  const canSubmit = useMemo(() => {
    return (
      fullName.trim().length > 0 &&
      emailValid &&
      password.length >= 8 &&
      passwordsMatch &&
      organization.trim().length > 0 &&
      (!phone || (/^\d+$/.test(phone) && phone.length <= 10)) &&
      !submitting
    );
  }, [fullName, emailValid, password, passwordsMatch, organization, phone, submitting]);

  const onPhoneChange = (e) => {
    const value = e.target.value;
    // Allow only digits
    if (value === "" || /^\d+$/.test(value)) {
      // Limit to 10 digits
      setPhone(value.slice(0, 10));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        student: isStudent,
        designation: isStudent ? "student" : (designation?.trim() || null),
        team: team?.trim() || null,
        organization: organization.trim(), // backend expects string
        role: 0,
        bio: bio?.trim() || null,
        phone: phone ? Number(phone) : null,
      };

      const resp = await axios.post(signup_endpoint, payload, {
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
      });

      if (resp.status === 201 || resp.status === 200) {
        // Extract returned user fields robustly (API may use snake_case or camelCase)
        const user = resp.data || {};
        const returnedEmail = user.email || email;
        const returnedFullName = user.full_name || user.fullName || fullName;

        // clear sensitive fields
        setPassword("");
        setConfirmPassword("");

        // Navigate to signup success page and pass user info via location state
        navigate("/signupsuccess", { state: { email: returnedEmail, fullName: returnedFullName } });
        return;
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Sign up failed. Please try again.";
      setError(Array.isArray(msg) ? msg.join(", ") : String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-wave">
      <section className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-sm-10 col-md-8 col-lg-6">
            <div className="card auth-card p-4 p-md-5">
              <h2 className="mb-3 text-center auth-title">Sign Up</h2>
              <p className="text-muted text-center mb-4">
                Create your account to access the WELL Labs Data Portal.
              </p>

              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}
              {success && (
                <div className="alert alert-success" role="alert">
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate>
                {/* <div className="alert alert-info py-2">
                  <small>
                    Required: full name, email, password, confirm password, are you a student?, {isStudent ? "institution" : "organization"}
                  </small>
                </div> */}
                <div className="mb-3">
                  <label htmlFor="fullName" className="form-label">Full Name *</label>
                  <input
                    id="fullName"
                    type="text"
                    className="form-control"
                    placeholder="Enter your full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value.slice(0, 50))}
                    required
                    maxLength={50}
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="email" className="form-label">Email *</label>
                  <input
                    id="email"
                    type="email"
                    className={`form-control ${email && !emailValid ? 'is-invalid' : ''}`}
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  {email && !emailValid && (
                    <div className="invalid-feedback">Please enter a valid email address</div>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="password" className="form-label">Password *</label>
                  <input
                    id="password"
                    type="password"
                    className={`form-control ${password && password.length < 8 ? 'is-invalid' : ''}`}
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  {password && password.length < 8 && (
                    <div className="invalid-feedback">Password must be at least 8 characters</div>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="confirmPassword" className="form-label">Confirm Password *</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    className={`form-control ${confirmPassword && !passwordsMatch ? 'is-invalid' : ''}`}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  {!passwordsMatch && confirmPassword && (
                    <div className="invalid-feedback">Passwords do not match</div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="form-label d-block">Are you a student? *</label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="studentRadio"
                        id="studentNo"
                        checked={!isStudent}
                        onChange={() => setIsStudent(false)}
                      />
                      <label className="form-check-label" htmlFor="studentNo">
                        No
                      </label>
                    </div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name="studentRadio"
                        id="studentYes"
                        checked={isStudent}
                        onChange={() => setIsStudent(true)}
                      />
                      <label className="form-check-label" htmlFor="studentYes">
                        Yes
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  <label htmlFor="designation" className="form-label">Designation</label>
                  <input
                    id="designation"
                    type="text"
                    className="form-control"
                    placeholder={isStudent ? "student" : "Enter your designation"}
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value.slice(0, 25))}
                    disabled={isStudent}
                    maxLength={25}
                  />
                  {/* {!isStudent && <small className="text-muted">Max 25 characters</small>} */}
                </div>

                <div className="mb-3">
                  <label htmlFor="team" className="form-label">{isStudent ? "Department" : "Team"}</label>
                  <input
                    id="team"
                    type="text"
                    className="form-control"
                    placeholder={isStudent ? "Enter your department" : "Enter your team"}
                    value={team}
                    onChange={(e) => setTeam(e.target.value.slice(0, 25))}
                    maxLength={25}
                  />
                  {/* <small className="text-muted">Max 25 characters</small> */}
                </div>

                <div className="mb-1">
                  <label htmlFor="organization" className="form-label">{isStudent ? "Institution" : "Organization ID"} *</label>
                  <input
                    id="organization"
                    type="text"
                    className="form-control"
                    placeholder={isStudent ? "Enter your institution" : "Enter your organization ID"}
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value.slice(0, 50))}
                    required
                    maxLength={50}
                  />
                </div>
                {!isStudent && (
                  <div className="mb-3">
                    <small>
                      Search for the Organization ID <a href="/orgsearch" target="_blank" rel="noreferrer">here</a>.
                    </small>
                  </div>
                )}

                <div className="mb-3">
                  <label htmlFor="bio" className="form-label">Area of Work and Interest</label>
                  <input
                    id="bio"
                    type="text"
                    className="form-control"
                    placeholder="Describe your area of work and interest (max 250 chars)"
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 250))}
                    maxLength={250}
                  />
                  {/* <small className="text-muted">Max 250 characters</small> */}
                </div>

                <div className="mb-4">
                  <label htmlFor="phone" className="form-label">Phone</label>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]{0,10}"
                    className="form-control"
                    placeholder="10 digits phone number"
                    value={phone}
                    onChange={onPhoneChange}
                    maxLength={10}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-100 auth-submit-btn"
                  disabled={!canSubmit}
                >
                  {submitting ? "Signing Up..." : "Sign Up"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SignUp;


