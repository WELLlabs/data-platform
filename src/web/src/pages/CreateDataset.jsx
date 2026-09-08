import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    create_upload_job_endpoint,
    complete_upload_job_endpoint,
    create_dataset_endpoint,
    add_files_url_endpoint,
    organization_by_id_endpoint,
    dataset_owners_endpoint,
} from "../api/endpoints";
import { requestAndUploadFile } from "../api/s3Upload";
import HelpTooltip from "../components/HelpTooltip";
import Ic from "../components/wd/Icons";
import {
    AVAILABILITY_OPTIONS,
    AVAILABILITY_PUBLIC,
} from "../constants/availability";

function CreateDataset() {
    const navigate = useNavigate();
    const { user, verifyUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const [orgPrivate, setOrgPrivate] = useState(false);
    const [orgMembers, setOrgMembers] = useState([]);
    const [ownerIds, setOwnerIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    // Form state
    const [title, setTitle] = useState("");
    const [datasetDescription, setDatasetDescription] = useState("");
    const [tags, setTags] = useState("");
    const [provenance, setProvenance] = useState("");
    const [source, setSource] = useState("");
    const [citeAs, setCiteAs] = useState("");
    const [groundtruthed, setGroundtruthed] = useState(false);
    const [availability, setAvailability] = useState(AVAILABILITY_PUBLIC);
    const [permissions, setPermissions] = useState("CC0: Public Domain");
    const [duration, setDuration] = useState(0);

    const [files, setFiles] = useState([]);
    const [temporalFrom, setTemporalFrom] = useState("");
    const [temporalTo, setTemporalTo] = useState("");
    const [geography, setGeography] = useState("");

    // Validation error states
    const [titleError, setTitleError] = useState(false);
    const [datasetDescriptionError, setDatasetDescriptionError] =
        useState(false);
    const [tagsError, setTagsError] = useState(false);
    const [provenanceError, setProvenanceError] = useState(false);
    const [sourceError, setSourceError] = useState(false);
    const [citeAsError, setCiteAsError] = useState(false);
    const [permissionsError, setPermissionsError] = useState(false);

    // Ensure auth and populate query params with userId and organization
    useEffect(() => {
        const init = async () => {
            try {
                const userData = await verifyUser();
                if (!userData) {
                    navigate("/signin");
                    return;
                }
                // Ensure query params include userId and organization
                const qp = new URLSearchParams(searchParams);
                let updated = false;
                if (qp.get("userId") !== userData.id) {
                    qp.set("userId", userData.id);
                    updated = true;
                }
                if (qp.get("organization") !== userData.organization) {
                    qp.set("organization", userData.organization);
                    updated = true;
                }
                if (updated) {
                    setSearchParams(qp);
                }

                // Fetch organization to know if private can be set from UI
                if (userData.organization) {
                    const resp = await fetch(
                        organization_by_id_endpoint(userData.organization),
                        { credentials: "include" }
                    );
                    if (resp.ok) {
                        const data = await resp.json();
                        setOrgPrivate(Boolean(data.private));
                        const members = Array.isArray(data.members) ? data.members : [];
                        setOrgMembers(members);
                    } else {
                        setOrgPrivate(false);
                        setOrgMembers([]);
                    }
                }
            } catch (e) {
                navigate("/signin");
                return;
            } finally {
                setLoading(false);
            }
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toFileEntry = (f) => {
        const filteredName = f.name.replace(/[<>"'&;()]/g, "");
        const parts = f.name.split(".");
        const ext = parts.length > 1 ? parts.pop().slice(0, 20) : "";
        const filteredFormat = ext.replace(/[<>"'&;()]/g, "");
        return {
            key: `${f.name}-${f.size}-${f.lastModified}`,
            file: f,
            title: filteredName.slice(0, 200),
            description: "",
            format: filteredFormat,
        };
    };

    const handleFileChange = (e) => {
        const picked = e.target.files ? Array.from(e.target.files) : [];
        if (!picked.length) return;
        setFiles((prev) => {
            const next = [...prev];
            picked.forEach((f) => {
                const entry = toFileEntry(f);
                if (!next.some((x) => x.key === entry.key)) next.push(entry);
            });
            return next;
        });
        e.target.value = "";
    };

    const updateFileEntry = (key, field, value) => {
        setFiles((prev) =>
            prev.map((item) =>
                item.key === key ? { ...item, [field]: value } : item
            )
        );
    };

    const removeFileEntry = (key) => {
        setFiles((prev) => prev.filter((item) => item.key !== key));
    };

    const toggleOwner = (id) => {
        setOwnerIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const constrained = (v, max) => (v || "").slice(0, max);

    // Helper function to validate and filter special characters
    const validateAndFilterSpecialChars = (
        value,
        setValue,
        setError,
        maxLength
    ) => {
        // Characters to block: <, >, ", ', &, ;, (, )
        const invalidChars = /[<>"'&;()]/g;
        const hasInvalidChars = invalidChars.test(value);

        if (hasInvalidChars) {
            // Filter out invalid characters
            const filtered = value.replace(invalidChars, "");
            setValue(constrained(filtered, maxLength));
            setError(true);
        } else {
            setValue(constrained(value, maxLength));
            setError(false);
        }
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess(false);
        if (!user) {
            navigate("/signin");
            return;
        }
        if (!files.length) {
            setError("Add at least one file to this dataset folder.");
            return;
        }
        if (!title.trim()) {
            setError("Dataset title is required.");
            return;
        }
        if (!tags.trim()) {
            setError("Tags are required.");
            return;
        }
        if (files.some((item) => !item.title.trim())) {
            setError("Each file needs a title.");
            return;
        }

        try {
            setSubmitting(true);
            setProgress(0);

            // 1) Create upload job
            const uploadJobResp = await fetch(create_upload_job_endpoint, {
                method: "POST",
                credentials: "include",
            });
            if (!uploadJobResp.ok) {
                const txt = await uploadJobResp.text();
                throw new Error(`Failed to create upload job: ${txt}`);
            }
            const uploadJobData = await uploadJobResp.json();
            const jobId = uploadJobData.job_id;
            if (!jobId) {
                throw new Error("Upload job ID missing in response.");
            }

            // 2) Stage dataset metadata using job_id
            const datasetForm = new FormData();
            datasetForm.append("title", constrained(title, 200));
            datasetForm.append(
                "description",
                constrained(datasetDescription, 2000)
            );
            datasetForm.append(
                "availability",
                String(orgPrivate ? availability : AVAILABILITY_PUBLIC)
            );
            datasetForm.append("job_id", jobId);

            // Process tags: split by comma, strip whitespace, replace internal spaces with hyphens, send as array
            if (tags && tags.trim()) {
                const tagsArray = tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0)
                    .map((tag) => tag.replace(/\s+/g, "-"));
                tagsArray.forEach((tag) => {
                    datasetForm.append("tags", tag);
                });
            }

            const createResp = await fetch(create_dataset_endpoint, {
                method: "POST",
                body: datasetForm,
                credentials: "include",
            });
            if (!createResp.ok) {
                const txt = await createResp.text();
                throw new Error(`Create dataset failed: ${txt}`);
            }
            const datasetResult = await createResp.json();
            const datasetId = datasetResult.dataset_id;
            const datasetJobId = datasetResult.job_id || jobId;
            if (!datasetId) {
                throw new Error("Dataset ID not found in response.");
            }

            // 3) Upload every file into this dataset folder
            const totalBytes = files.reduce((sum, item) => sum + (item.file.size || 0), 0);
            let uploadedBytes = 0;
            for (const item of files) {
                const { fileId } = await requestAndUploadFile({
                    jobId: datasetJobId,
                    file: item.file,
                    onProgress: (pct) => {
                        const current = (item.file.size || 0) * (pct / 100);
                        const overall = totalBytes
                            ? Math.round(((uploadedBytes + current) / totalBytes) * 100)
                            : pct;
                        setProgress(Math.min(99, overall));
                    },
                });

                const addFileForm = new FormData();
                addFileForm.append("job_id", datasetJobId);
                addFileForm.append("file_id", fileId);
                addFileForm.append("file_title", constrained(item.title, 200));
                addFileForm.append(
                    "file_description",
                    constrained(item.description, 1000)
                );
                addFileForm.append("file_format", constrained(item.format, 20));
                addFileForm.append("dataset_id", datasetId);
                if (groundtruthed) addFileForm.append("groundtruthed", "true");
                addFileForm.append("provenance", constrained(provenance, 125));
                addFileForm.append("source", constrained(source, 1000));
                addFileForm.append("cite_as", constrained(citeAs, 1500));
                addFileForm.append("permissions", constrained(permissions, 1000));
                addFileForm.append("duration", duration.toString());
                if (temporalFrom) addFileForm.append("temporal_from", temporalFrom);
                if (temporalTo) addFileForm.append("temporal_to", temporalTo);
                if (geography) {
                    addFileForm.append("geography", constrained(geography, 2000));
                }

                const addFileResp = await fetch(add_files_url_endpoint, {
                    method: "POST",
                    body: addFileForm,
                    credentials: "include",
                });
                if (!addFileResp.ok) {
                    const txt = await addFileResp.text();
                    throw new Error(`Failed to add file: ${txt}`);
                }
                await addFileResp.json();
                uploadedBytes += item.file.size || 0;
            }

            // 4) Complete upload job
            const completeResp = await fetch(
                `${complete_upload_job_endpoint}?job_id=${encodeURIComponent(
                    datasetJobId
                )}`,
                {
                    method: "POST",
                    credentials: "include",
                }
            );
            if (!completeResp.ok) {
                const txt = await completeResp.text();
                throw new Error(`Failed to complete upload job: ${txt}`);
            }
            await completeResp.json();

            // 5) Attach extra owners after the dataset exists
            for (const ownerId of ownerIds) {
                if (!ownerId || String(ownerId) === String(user.id)) continue;
                try {
                    await fetch(dataset_owners_endpoint, {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            dataset_id: datasetId,
                            user_id: ownerId,
                        }),
                    });
                } catch (ownerErr) {
                    console.error("Failed to add owner", ownerId, ownerErr);
                }
            }

            setProgress(100);
            setSuccess(true);
        } catch (err) {
            console.error(err);
            setError(err.message || "Unexpected error");
        } finally {
            setSubmitting(false);
        }
    };

    const invalidCharsNote = (
        <span className="err">
            No special characters &lt; &gt; " ' &amp; ; ( )
        </span>
    );

    const fmtBytes = (n) => {
        if (!n && n !== 0) return "";
        if (n < 1024) return `${n} B`;
        if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1048576).toFixed(1)} MB`;
    };

    if (loading) {
        return (
            <div className="page">
                <div className="wrap" style={{ maxWidth: 760, padding: "48px 0 88px" }}>
                    <div className="empty"><p>Loading…</p></div>
                </div>
            </div>
        );
    }

    if (!user) return null;

    if (success) {
        return (
            <div className="page">
                <div className="wrap" style={{ maxWidth: 560, padding: "72px 0 88px" }}>
                    <div className="auth-card" style={{ textAlign: "center" }}>
                        <div
                            style={{
                                width: 56,
                                height: 56,
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                margin: "0 auto 18px",
                                color: "var(--green)",
                                background: "var(--green-soft)",
                                border: "1px solid var(--green-line)",
                            }}
                        >
                            <Ic name="check" size={26} sw={2.4} />
                        </div>
                        <span className="eyebrow">Datasets</span>
                        <h1 className="display" style={{ marginTop: 6 }}>Dataset submitted</h1>
                        <p className="auth-sub" style={{ maxWidth: "42ch", margin: "8px auto 0" }}>
                            Your dataset was uploaded successfully. It is being processed
                            and will appear in your dashboard shortly.
                        </p>
                        <div style={{ marginTop: 24, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => navigate("/dashboard")}
                            >
                                Go to dashboard
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => window.location.reload()}
                            >
                                Publish another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="wrap ds-form" style={{ padding: "48px 0 88px" }}>
                <span className="eyebrow">Datasets</span>
                <div className="section-head" style={{ marginTop: 8 }}>
                    <div>
                        <h2 className="section-title">Publish a dataset</h2>
                        <p className="muted" style={{ marginTop: 8, maxWidth: "56ch" }}>
                            A dataset is a folder for any number of files. Set tags,
                            availability, and ownership once; then add every file type
                            that belongs in this collection.
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="attn-card warn" role="alert" style={{ margin: "20px 0" }}>
                        <div className="aic"><Ic name="warn" size={18} sw={2} /></div>
                        <div><b>{error}</b></div>
                    </div>
                )}

                <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
                    {/* Section 1 — Dataset details */}
                    <div className="form-section">
                        <div className="fs-head">
                            <span className="fs-num">1</span>
                            <div>
                                <h3>Dataset details</h3>
                                <p>Folder metadata: title, tags, availability, and who owns it.</p>
                            </div>
                        </div>

                        <div className="field">
                            <label>
                                Dataset title <span className="req">(required)</span>
                                <HelpTooltip
                                    text="Name of the dataset. For example: Bangalore Rainfall Data would be the dataset, and you can add several files by year under that title."
                                    id="tooltip-dataset-title"
                                />
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) =>
                                    validateAndFilterSpecialChars(
                                        e.target.value,
                                        setTitle,
                                        setTitleError,
                                        200
                                    )
                                }
                                required
                            />
                            {titleError && invalidCharsNote}
                        </div>

                        <div className="field">
                            <label>
                                Dataset description
                                <HelpTooltip
                                    text="What does the dataset contain?"
                                    id="tooltip-dataset-description"
                                />
                            </label>
                            <textarea
                                rows={4}
                                value={datasetDescription}
                                onChange={(e) =>
                                    validateAndFilterSpecialChars(
                                        e.target.value,
                                        setDatasetDescription,
                                        setDatasetDescriptionError,
                                        2000
                                    )
                                }
                            />
                            {datasetDescriptionError && invalidCharsNote}
                        </div>

                        <div className="field">
                            <label>
                                Tags <span className="req">(required)</span>
                                <HelpTooltip
                                    text="Think keywords. Which search results should this dataset appear in?"
                                    id="tooltip-tags"
                                />
                            </label>
                            <input
                                type="text"
                                placeholder="Separate keywords with commas, e.g. rainfall, karnataka, groundwater"
                                value={tags}
                                onChange={(e) =>
                                    validateAndFilterSpecialChars(
                                        e.target.value,
                                        setTags,
                                        setTagsError,
                                        500
                                    )
                                }
                            />
                            {tagsError && invalidCharsNote}
                        </div>

                        <div className="field">
                            <label>
                                Availability
                                <HelpTooltip
                                    text="Who can view this dataset: Public, Private (creator only), Organization, Admins, or Owners. Restricted levels apply only when your organization is private."
                                    id="tooltip-private"
                                />
                            </label>
                            <select
                                value={String(availability)}
                                onChange={(e) =>
                                    setAvailability(Number(e.target.value))
                                }
                                disabled={!orgPrivate}
                                aria-disabled={!orgPrivate}
                            >
                                {AVAILABILITY_OPTIONS.map((opt) => (
                                    <option
                                        key={opt.value}
                                        value={String(opt.value)}
                                    >
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            {!orgPrivate && (
                                <span className="hint">
                                    Availability is locked to Public because your
                                    organization does not have private data enabled.
                                </span>
                            )}
                        </div>

                        <div className="field">
                            <label>
                                Ownership
                                <HelpTooltip
                                    text="You are the creator. Optionally add other organization members as owners of this dataset folder."
                                    id="tooltip-ownership"
                                />
                            </label>
                            <div className="owner-pick">
                                <label className="check">
                                    <input type="checkbox" checked disabled />
                                    You (creator)
                                </label>
                                {orgMembers
                                    .filter((m) => String(m.id) !== String(user.id))
                                    .map((m) => (
                                        <label className="check" key={m.id}>
                                            <input
                                                type="checkbox"
                                                checked={ownerIds.includes(m.id)}
                                                onChange={() => toggleOwner(m.id)}
                                            />
                                            {m.full_name || m.email}
                                        </label>
                                    ))}
                                {orgMembers.filter((m) => String(m.id) !== String(user.id)).length === 0 && (
                                    <span className="hint">No other organization members to add yet.</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Section 2 — File upload */}
                    <div className="form-section">
                        <div className="fs-head">
                            <span className="fs-num">2</span>
                            <div>
                                <h3>Files in this folder</h3>
                                <p>Add any file types. Each file stays inside this dataset.</p>
                            </div>
                        </div>

                        <div className="field">
                            <label>
                                Data files <span className="req">(required)</span>
                            </label>
                            <div className="file-drop">
                                <span className="fdic"><Ic name="dl" size={18} sw={2} /></span>
                                <div className="fdmain">
                                    <b>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose files to add"}</b>
                                    <span>Any format. You can select multiple files at once.</span>
                                </div>
                                <input
                                    type="file"
                                    onChange={handleFileChange}
                                    accept="*/*"
                                    multiple
                                />
                            </div>
                            {files.length > 0 && (
                                <div className="file-stack">
                                    {files.map((item) => (
                                        <div className="file-stack-item" key={item.key}>
                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                                                <div>
                                                    <b>{item.file.name}</b>
                                                    <span className="muted" style={{ display: "block", fontSize: 12.5 }}>
                                                        {fmtBytes(item.file.size)}{item.format ? ` · ${item.format.toUpperCase()}` : ""}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn-quiet"
                                                    onClick={() => removeFileEntry(item.key)}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                                                <label>File title</label>
                                                <input
                                                    type="text"
                                                    value={item.title}
                                                    onChange={(e) =>
                                                        updateFileEntry(item.key, "title", e.target.value.slice(0, 200))
                                                    }
                                                    required
                                                />
                                            </div>
                                            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                                                <label>File description</label>
                                                <textarea
                                                    rows={2}
                                                    value={item.description}
                                                    onChange={(e) =>
                                                        updateFileEntry(item.key, "description", e.target.value.slice(0, 1000))
                                                    }
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section 3 — Attribution and licensing */}
                    <div className="form-section">
                        <div className="fs-head">
                            <span className="fs-num">3</span>
                            <div>
                                <h3>Attribution &amp; licensing</h3>
                                <p>Where the data came from and how others may use it.</p>
                            </div>
                        </div>

                        <div className="field-row">
                            <div className="field">
                                <label>
                                    Provenance
                                    <HelpTooltip
                                        text="Who owns the dataset?"
                                        id="tooltip-provenance"
                                    />
                                </label>
                                <input
                                    type="text"
                                    value={provenance}
                                    onChange={(e) =>
                                        validateAndFilterSpecialChars(
                                            e.target.value,
                                            setProvenance,
                                            setProvenanceError,
                                            125
                                        )
                                    }
                                />
                                {provenanceError && invalidCharsNote}
                            </div>

                            <div className="field">
                                <label>
                                    Source
                                    <HelpTooltip
                                        text="Who gave you the dataset?"
                                        id="tooltip-source"
                                    />
                                </label>
                                <input
                                    type="text"
                                    value={source}
                                    onChange={(e) =>
                                        validateAndFilterSpecialChars(
                                            e.target.value,
                                            setSource,
                                            setSourceError,
                                            1000
                                        )
                                    }
                                />
                                {sourceError && invalidCharsNote}
                            </div>
                        </div>

                        <div className="field">
                            <label>
                                Permissions
                                <HelpTooltip
                                    text={
                                        <>
                                            To learn more about the Creative Commons licenses, visit{" "}
                                            <a
                                                href="https://creativecommons.org/share-your-work/cclicenses/"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                here
                                            </a>
                                            .
                                        </>
                                    }
                                    id="tooltip-permissions"
                                />
                            </label>
                            <select
                                value={permissions}
                                onChange={(e) => setPermissions(e.target.value)}
                            >
                                <option value="CC0: Public Domain">CC0: Public Domain</option>
                                <option value="CC BY: Attribution">CC BY: Attribution</option>
                                <option value="CC BY-SA: Attribution-ShareAlike">CC BY-SA: Attribution-ShareAlike</option>
                                <option value="CC BY-NC: Attribution-NonCommercial">CC BY-NC: Attribution-NonCommercial</option>
                                <option value="CC BY-NC-SA: Attribution-NonCommercial-ShareAlike">CC BY-NC-SA: Attribution-NonCommercial-ShareAlike</option>
                                <option value="CC BY-ND: Attribution-NoDerivatives">CC BY-ND: Attribution-NoDerivatives</option>
                                <option value="CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives">CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives</option>
                            </select>
                        </div>

                        <div className="field">
                            <label>
                                Cite as
                                <HelpTooltip
                                    text="How should someone give credit for the data?"
                                    id="tooltip-cite-as"
                                />
                            </label>
                            <textarea
                                rows={3}
                                value={citeAs}
                                onChange={(e) =>
                                    validateAndFilterSpecialChars(
                                        e.target.value,
                                        setCiteAs,
                                        setCiteAsError,
                                        1500
                                    )
                                }
                            />
                            {citeAsError && invalidCharsNote}
                        </div>
                    </div>

                    {/* Section 4 — Coverage and validity */}
                    <div className="form-section">
                        <div className="fs-head">
                            <span className="fs-num">4</span>
                            <div>
                                <h3>Coverage &amp; validity</h3>
                                <p>When and where the data applies, and how long it stays valid.</p>
                            </div>
                        </div>

                        <div className="field">
                            <label>
                                Groundtruthed
                                <HelpTooltip
                                    text="Has this data been validated in the field?"
                                    id="tooltip-groundtruthed"
                                />
                            </label>
                            <div className="seg-radio" role="radiogroup" aria-label="Groundtruthed">
                                <label className={!groundtruthed ? "on" : ""}>
                                    <input
                                        type="radio"
                                        name="groundtruthed"
                                        id="gt_no"
                                        checked={!groundtruthed}
                                        onChange={() => setGroundtruthed(false)}
                                    />
                                    No
                                </label>
                                <label className={groundtruthed ? "on" : ""}>
                                    <input
                                        type="radio"
                                        name="groundtruthed"
                                        id="gt_yes"
                                        checked={groundtruthed}
                                        onChange={() => setGroundtruthed(true)}
                                    />
                                    Yes
                                </label>
                            </div>
                        </div>

                        <div className="field-row">
                            <div className="field">
                                <label>
                                    Temporal coverage from
                                    <HelpTooltip
                                        text="Start date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                                        id="tooltip-temporal-from"
                                    />
                                </label>
                                <input
                                    type="datetime-local"
                                    value={temporalFrom ? (() => {
                                        try {
                                            const date = new Date(temporalFrom);
                                            if (isNaN(date.getTime())) return "";
                                            const year = date.getFullYear();
                                            const month = String(date.getMonth() + 1).padStart(2, '0');
                                            const day = String(date.getDate()).padStart(2, '0');
                                            const hours = String(date.getHours()).padStart(2, '0');
                                            const minutes = String(date.getMinutes()).padStart(2, '0');
                                            return `${year}-${month}-${day}T${hours}:${minutes}`;
                                        } catch {
                                            return "";
                                        }
                                    })() : ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val) {
                                            const date = new Date(val);
                                            if (!isNaN(date.getTime())) {
                                                setTemporalFrom(date.toISOString());
                                            } else {
                                                setTemporalFrom("");
                                            }
                                        } else {
                                            setTemporalFrom("");
                                        }
                                    }}
                                />
                            </div>

                            <div className="field">
                                <label>
                                    Temporal coverage to
                                    <HelpTooltip
                                        text="End date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                                        id="tooltip-temporal-to"
                                    />
                                </label>
                                <input
                                    type="datetime-local"
                                    value={temporalTo ? (() => {
                                        try {
                                            const date = new Date(temporalTo);
                                            if (isNaN(date.getTime())) return "";
                                            const year = date.getFullYear();
                                            const month = String(date.getMonth() + 1).padStart(2, '0');
                                            const day = String(date.getDate()).padStart(2, '0');
                                            const hours = String(date.getHours()).padStart(2, '0');
                                            const minutes = String(date.getMinutes()).padStart(2, '0');
                                            return `${year}-${month}-${day}T${hours}:${minutes}`;
                                        } catch {
                                            return "";
                                        }
                                    })() : ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val) {
                                            const date = new Date(val);
                                            if (!isNaN(date.getTime())) {
                                                setTemporalTo(date.toISOString());
                                            } else {
                                                setTemporalTo("");
                                            }
                                        } else {
                                            setTemporalTo("");
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        <div className="field-row">
                            <div className="field">
                                <label>
                                    Duration (years)
                                    <HelpTooltip
                                        text="How many years can this data be used for from the date of creation? 0 if not applicable."
                                        id="tooltip-duration"
                                    />
                                </label>
                                <input
                                    type="number"
                                    value={duration}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setDuration(Math.max(0, val));
                                    }}
                                    min="0"
                                />
                            </div>

                            <div className="field">
                                <label>
                                    Geographical extent
                                    <HelpTooltip
                                        text="Geographic coverage or location information"
                                        id="tooltip-geography"
                                    />
                                </label>
                                <input
                                    type="text"
                                    value={geography}
                                    onChange={(e) => setGeography(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Sticky submit bar */}
                    <div className="form-actions">
                        <div style={{ flex: 1, minWidth: 200 }}>
                            {submitting ? (
                                <>
                                    <div className="progress-track">
                                        <div
                                            className="progress-fill"
                                            role="progressbar"
                                            aria-valuenow={progress}
                                            aria-valuemin="0"
                                            aria-valuemax="100"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                    <span className="mono-token" style={{ marginTop: 6, display: "inline-block" }}>
                                        Uploading… {progress}%
                                    </span>
                                </>
                            ) : (
                                <span className="fa-note">
                                    Fields marked <span className="req">(required)</span> must be filled before publishing.
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => navigate("/dashboard")}
                                disabled={submitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={submitting}
                            >
                                {submitting ? "Publishing…" : "Publish dataset"}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CreateDataset;
