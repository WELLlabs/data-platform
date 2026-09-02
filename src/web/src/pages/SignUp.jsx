import React, { useMemo, useState, useEffect } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import {
    list_organizations_endpoint,
    login_options_endpoint,
    signup_endpoint,
} from "../api/endpoints";

function SignUp() {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [designation, setDesignation] = useState("");
    const [organization, setOrganization] = useState("");
    const [organizations, setOrganizations] = useState([]);
    const [organizationsLoading, setOrganizationsLoading] = useState(false);
    const [organizationsError, setOrganizationsError] = useState(null);
    const [phone, setPhone] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [allowedDomain, setAllowedDomain] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const fetchOrganizations = async () => {
            if (cancelled) return;
            setOrganizationsError(null);
            setOrganizationsLoading(true);
            try {
                const resp = await axios.get(list_organizations_endpoint, {
                    withCredentials: true,
                    signal: controller.signal,
                });
                if (cancelled) return;
                const items = resp?.data?.items ?? [];
                setOrganizations(Array.isArray(items) ? items : []);
            } catch (err) {
                if (axios.isCancel(err) || err?.name === "CanceledError" || err?.code === "ERR_CANCELED") {
                    return;
                }
                if (cancelled) return;
                setOrganizations([]);
                setOrganizationsError(err?.message ?? "Failed to load organizations");
            } finally {
                if (!cancelled) setOrganizationsLoading(false);
            }
        };
        fetchOrganizations();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, []);

    useEffect(() => {
        fetch(login_options_endpoint, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data) {
                    setGoogleEnabled(!!data.google_enabled);
                    setAllowedDomain(data.allowed_email_domain || null);
                }
            })
            .catch(() => {});
    }, []);

    const passwordsMatch = useMemo(
        () => password.length > 0 && password === confirmPassword,
        [password, confirmPassword]
    );

    const emailValid = useMemo(() => {
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
    }, [
        fullName,
        emailValid,
        password,
        passwordsMatch,
        organization,
        phone,
        submitting,
    ]);

    const onPhoneChange = (e) => {
        const value = e.target.value;
        if (value === "" || /^\d+$/.test(value)) {
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
                designation: designation?.trim() || null,
                organization: organization.trim(),
                role: 0,
                phone: phone ? phone.trim() : null,
            };

            const resp = await axios.post(signup_endpoint, payload, {
                headers: { "Content-Type": "application/json" },
                withCredentials: true,
            });

            if (resp.status === 201 || resp.status === 200) {
                const user = resp.data || {};
                const returnedEmail = user.email || email;
                const returnedFullName =
                    user.full_name || user.fullName || fullName;

                setPassword("");
                setConfirmPassword("");

                navigate("/signupsuccess", {
                    state: { email: returnedEmail, fullName: returnedFullName },
                });
                return;
            }
        } catch (err) {
            const msg =
                err?.response?.data?.detail ||
                "Sign up failed. Please try again.";
            setError(Array.isArray(msg) ? msg.join(", ") : String(msg));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="page">
            <div className="wrap">
                <div className="auth-wrap" style={{ maxWidth: 480 }}>
                    <div className="auth-card">
                        <h1 className="display">Create your account</h1>
                        <p className="auth-sub">
                            Create your account to access the WELL Labs Data
                            Portal.
                        </p>

                        {error && (
                            <div
                                className="auth-note"
                                role="alert"
                                style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}
                            >
                                {error}
                            </div>
                        )}
                        {success && (
                            <div className="auth-note" role="alert" style={{ marginTop: 16 }}>
                                {success}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} noValidate>
                            <div className="field">
                                <label htmlFor="fullName">
                                    Full Name{" "}
                                    <span style={{ color: "red" }}>(required)</span>
                                </label>
                                <input
                                    id="fullName"
                                    type="text"
                                    placeholder="Enter your full name"
                                    value={fullName}
                                    onChange={(e) =>
                                        setFullName(e.target.value.slice(0, 50))
                                    }
                                    required
                                    maxLength={50}
                                />
                            </div>

                            <div className="field">
                                <label htmlFor="email">
                                    Email{" "}
                                    <span style={{ color: "red" }}>(required)</span>
                                </label>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder={
                                        allowedDomain
                                            ? `you@${allowedDomain}`
                                            : "you@ifmr.ac.in"
                                    }
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    autoComplete="email"
                                    required
                                />
                                {email && !emailValid && (
                                    <span style={{ fontSize: 12, color: "#9a6b12" }}>
                                        Please enter a valid email address
                                    </span>
                                )}
                            </div>

                            <div className="field-row">
                                <div className="field">
                                    <label htmlFor="password">
                                        Password{" "}
                                        <span style={{ color: "red" }}>(required)</span>
                                    </label>
                                    <input
                                        id="password"
                                        name="password"
                                        type="password"
                                        placeholder="Minimum 8 characters"
                                        value={password}
                                        onChange={(e) =>
                                            setPassword(e.target.value)
                                        }
                                        autoComplete="new-password"
                                        required
                                        minLength={8}
                                    />
                                    {password && password.length < 8 && (
                                        <span style={{ fontSize: 12, color: "#9a6b12" }}>
                                            Password must be at least 8 characters
                                        </span>
                                    )}
                                </div>

                                <div className="field">
                                    <label htmlFor="confirmPassword">
                                        Confirm Password{" "}
                                        <span style={{ color: "red" }}>(required)</span>
                                    </label>
                                    <input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        placeholder="Re-enter your password"
                                        value={confirmPassword}
                                        onChange={(e) =>
                                            setConfirmPassword(e.target.value)
                                        }
                                        autoComplete="new-password"
                                        required
                                    />
                                    {!passwordsMatch && confirmPassword && (
                                        <span style={{ fontSize: 12, color: "#9a6b12" }}>
                                            Passwords do not match
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="field">
                                <label htmlFor="designation">Designation</label>
                                <input
                                    id="designation"
                                    type="text"
                                    placeholder="Enter your designation"
                                    value={designation}
                                    onChange={(e) =>
                                        setDesignation(e.target.value.slice(0, 25))
                                    }
                                    maxLength={25}
                                />
                            </div>

                            <div className="field">
                                <label htmlFor="organization">
                                    Organization ID{" "}
                                    <span style={{ color: "red" }}>(required)</span>
                                </label>
                                <select
                                    id="organization"
                                    style={{ width: "100%" }}
                                    value={organization}
                                    onChange={(e) =>
                                        setOrganization(e.target.value)
                                    }
                                    required
                                    disabled={organizationsLoading}
                                    aria-label="Organization"
                                >
                                    <option value="">
                                        {organizationsLoading
                                            ? "Loading..."
                                            : "Select organization"}
                                    </option>
                                    {organizations.map((org) => (
                                        <option key={org.id} value={org.id}>
                                            {org.name}
                                        </option>
                                    ))}
                                </select>
                                {organizationsError && (
                                    <span style={{ fontSize: 12, color: "#9a6b12" }} role="alert">
                                        {organizationsError}
                                    </span>
                                )}
                            </div>

                            <div className="field">
                                <label htmlFor="phone">Phone</label>
                                <input
                                    id="phone"
                                    type="tel"
                                    inputMode="numeric"
                                    pattern="[0-9]{0,10}"
                                    placeholder="10 digits phone number"
                                    value={phone}
                                    onChange={onPhoneChange}
                                    maxLength={10}
                                />
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ width: "100%", marginTop: 6 }}
                                disabled={!canSubmit}
                            >
                                {submitting ? "Signing Up…" : "Create account"}
                            </button>
                        </form>

                        {googleEnabled && (
                            <a
                                className="btn btn-ghost"
                                href="/api/auth/google"
                                style={{ width: "100%", marginTop: 12, textAlign: "center" }}
                            >
                                Sign up with Google
                            </a>
                        )}

                        <div className="auth-foot">
                            Already have an account? <Link to="/signin">Sign in</Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SignUp;
