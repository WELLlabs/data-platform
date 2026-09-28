import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
    complete_profile_endpoint,
    list_organizations_endpoint,
} from "../api/endpoints";
import { useAuth } from "../contexts/AuthContext";

function CompleteProfile() {
    const { user, verifyUser, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [fullName, setFullName] = useState("");
    const [designation, setDesignation] = useState("");
    const [organization, setOrganization] = useState("");
    const [organizations, setOrganizations] = useState([]);
    const [organizationsLoading, setOrganizationsLoading] = useState(false);
    const [organizationsError, setOrganizationsError] = useState(null);
    const [phone, setPhone] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (user) {
            setFullName(user.full_name || "");
            setDesignation(user.designation || "");
            setOrganization(user.organization || "");
            setPhone(user.phone || "");
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading && !user) {
            navigate("/signin", { replace: true });
        }
        if (!authLoading && user?.profile_complete) {
            navigate("/", { replace: true });
        }
    }, [authLoading, user, navigate]);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const fetchOrganizations = async () => {
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
                if (axios.isCancel(err) || err?.name === "CanceledError") return;
                if (!cancelled) {
                    setOrganizations([]);
                    setOrganizationsError(err?.message ?? "Failed to load organizations");
                }
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

    const canSubmit = useMemo(
        () =>
            fullName.trim().length > 0 &&
            organization.trim().length > 0 &&
            (!phone || (/^\d+$/.test(phone) && phone.length <= 10)) &&
            !submitting,
        [fullName, organization, phone, submitting]
    );

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError("");
        try {
            const resp = await axios.put(
                complete_profile_endpoint,
                {
                    full_name: fullName.trim(),
                    organization: organization.trim(),
                    designation: designation.trim() || null,
                    phone: phone ? phone.trim() : null,
                },
                {
                    headers: { "Content-Type": "application/json" },
                    withCredentials: true,
                }
            );
            if (resp.status === 200) {
                await verifyUser();
                navigate("/", { replace: true });
            }
        } catch (err) {
            const msg =
                err?.response?.data?.detail ||
                "Could not save profile. Please try again.";
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
                        <h1 className="display">Complete your profile</h1>
                        <p className="auth-sub">
                            Add your organization and contact details to continue.
                        </p>
                        {error && (
                            <div
                                className="auth-note"
                                role="alert"
                                style={{
                                    background: "#faf3e4",
                                    borderColor: "#ecdcb8",
                                    color: "#9a6b12",
                                }}
                            >
                                {error}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} noValidate>
                            <div className="field">
                                <label htmlFor="fullName">
                                    Name <span style={{ color: "red" }}>(required)</span>
                                </label>
                                <input
                                    id="fullName"
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value.slice(0, 50))}
                                    required
                                    maxLength={50}
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
                                    onChange={(e) => setOrganization(e.target.value)}
                                    required
                                    disabled={organizationsLoading}
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
                                    <span style={{ fontSize: 12, color: "#9a6b12" }}>
                                        {organizationsError}
                                    </span>
                                )}
                            </div>
                            <div className="field">
                                <label htmlFor="designation">Designation</label>
                                <input
                                    id="designation"
                                    type="text"
                                    value={designation}
                                    onChange={(e) =>
                                        setDesignation(e.target.value.slice(0, 25))
                                    }
                                    maxLength={25}
                                />
                            </div>
                            <div className="field">
                                <label htmlFor="phone">Phone</label>
                                <input
                                    id="phone"
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === "" || /^\d+$/.test(value)) {
                                            setPhone(value.slice(0, 10));
                                        }
                                    }}
                                    maxLength={10}
                                />
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{ width: "100%", marginTop: 6 }}
                                disabled={!canSubmit}
                            >
                                {submitting ? "Saving…" : "Save and continue"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CompleteProfile;
