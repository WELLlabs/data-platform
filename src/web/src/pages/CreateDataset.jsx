import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    create_upload_job_endpoint,
    complete_upload_job_endpoint,
    create_dataset_endpoint,
    add_files_url_endpoint,
    organization_by_id_endpoint,
} from "../api/endpoints";
import { requestAndUploadFile } from "../api/s3Upload";
import HelpTooltip from "../components/HelpTooltip";
import Ic from "../components/wd/Icons";
import TagMultiSelect from "../components/wd/TagMultiSelect";
import {
    AVAILABILITY_OPTIONS,
    AVAILABILITY_PUBLIC,
} from "../constants/availability";

const INVALID_CHARS = /[<>"'&;()]/;
const INVALID_CHARS_G = /[<>"'&;()]/g;

const PERMISSION_OPTIONS = [
    "CC0: Public Domain",
    "CC BY: Attribution",
    "CC BY-SA: Attribution-ShareAlike",
    "CC BY-NC: Attribution-NonCommercial",
    "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
    "CC BY-ND: Attribution-NoDerivatives",
    "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
];

// Attribution and coverage fields that "apply to all files" copies across.
const SHARED_FILE_FIELDS = [
    "provenance",
    "source",
    "permissions",
    "citeAs",
    "groundtruthed",
    "temporalFrom",
    "temporalTo",
    "duration",
    "geography",
];

// Textarea that grows to fit its content as the user types.
function AutoTextarea({ value, minRows = 2, onChange, ...rest }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            rows={minRows}
            value={value}
            onChange={onChange}
            className="autogrow"
            {...rest}
        />
    );
}

// Convert a datetime-local input value into an ISO string (or "").
function localToIso(val) {
    if (!val) return "";
    const date = new Date(val);
    return isNaN(date.getTime()) ? "" : date.toISOString();
}

// Convert a stored ISO string back into a datetime-local input value.
function isoToLocal(iso) {
    if (!iso) return "";
    try {
        const date = new Date(iso);
        if (isNaN(date.getTime())) return "";
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
        return "";
    }
}

function CreateDataset() {
    const navigate = useNavigate();
    const { user, verifyUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const [orgPrivate, setOrgPrivate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [success, setSuccess] = useState(false);

    // Dataset-level state
    const [title, setTitle] = useState("");
    const [datasetDescription, setDatasetDescription] = useState("");
    const [tags, setTags] = useState([]);
    const [availability, setAvailability] = useState(AVAILABILITY_PUBLIC);

    // Per-file state
    const [files, setFiles] = useState([]);
    const [expanded, setExpanded] = useState({});
    const [dragging, setDragging] = useState(false);

    // Dataset-level validation flags
    const [titleError, setTitleError] = useState(false);
    const [datasetDescriptionError, setDatasetDescriptionError] =
        useState(false);

    // Ensure auth and populate query params with userId and organization
    useEffect(() => {
        const init = async () => {
            try {
                const userData = await verifyUser();
                if (!userData) {
                    navigate("/signin");
                    return;
                }
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

                if (userData.organization) {
                    const resp = await fetch(
                        organization_by_id_endpoint(userData.organization),
                        { credentials: "include" }
                    );
                    if (resp.ok) {
                        const data = await resp.json();
                        setOrgPrivate(Boolean(data.private));
                    } else {
                        setOrgPrivate(false);
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

    const constrained = (v, max) => (v || "").slice(0, max);

    const toFileEntry = (f) => {
        const filteredName = f.name.replace(INVALID_CHARS_G, "");
        const parts = f.name.split(".");
        const ext = parts.length > 1 ? parts.pop().slice(0, 20) : "";
        const filteredFormat = ext.replace(INVALID_CHARS_G, "");
        return {
            key: `${f.name}-${f.size}-${f.lastModified}`,
            file: f,
            title: filteredName.slice(0, 200),
            description: "",
            format: filteredFormat,
            provenance: "",
            source: "",
            permissions: "CC0: Public Domain",
            citeAs: "",
            groundtruthed: false,
            temporalFrom: "",
            temporalTo: "",
            duration: 0,
            geography: "",
            errors: {},
        };
    };

    const addFiles = (picked) => {
        if (!picked.length) return;
        const newlyExpanded = {};
        setFiles((prev) => {
            const next = [...prev];
            picked.forEach((f) => {
                const entry = toFileEntry(f);
                if (!next.some((x) => x.key === entry.key)) {
                    next.push(entry);
                    newlyExpanded[entry.key] = true;
                }
            });
            return next;
        });
        setExpanded((prev) => ({ ...prev, ...newlyExpanded }));
    };

    const handleFileChange = (e) => {
        const picked = e.target.files ? Array.from(e.target.files) : [];
        addFiles(picked);
        e.target.value = "";
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const picked = e.dataTransfer?.files
            ? Array.from(e.dataTransfer.files)
            : [];
        addFiles(picked);
    };

    // Plain per-file field update (no special-character filtering).
    const updateFileEntry = (key, field, value) => {
        setFiles((prev) =>
            prev.map((item) =>
                item.key === key ? { ...item, [field]: value } : item
            )
        );
    };

    // Per-file text update that strips blocked characters and flags the field.
    const updateFileText = (key, field, value, max) => {
        const bad = INVALID_CHARS.test(value);
        const cleaned = bad ? value.replace(INVALID_CHARS_G, "") : value;
        setFiles((prev) =>
            prev.map((item) =>
                item.key === key
                    ? {
                          ...item,
                          [field]: constrained(cleaned, max),
                          errors: { ...item.errors, [field]: bad },
                      }
                    : item
            )
        );
    };

    const removeFileEntry = (key) => {
        setFiles((prev) => prev.filter((item) => item.key !== key));
        setExpanded((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const toggleExpand = (key) => {
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // Copy this file's attribution and coverage fields onto every other file.
    const applyToAll = (key) => {
        setFiles((prev) => {
            const src = prev.find((f) => f.key === key);
            if (!src) return prev;
            const shared = {};
            SHARED_FILE_FIELDS.forEach((f) => {
                shared[f] = src[f];
            });
            return prev.map((item) =>
                item.key === key ? item : { ...item, ...shared }
            );
        });
        setNotice(
            "Attribution and coverage copied to all files. You can still edit each file individually."
        );
        setTimeout(() => setNotice(""), 4000);
    };

    // Dataset-level special-character validation helper.
    const validateAndFilterSpecialChars = (
        value,
        setValue,
        setErrorFlag,
        maxLength
    ) => {
        const bad = INVALID_CHARS.test(value);
        if (bad) {
            setValue(constrained(value.replace(INVALID_CHARS_G, ""), maxLength));
            setErrorFlag(true);
        } else {
            setValue(constrained(value, maxLength));
            setErrorFlag(false);
        }
    };

    const validate = () => {
        if (!title.trim()) return "Dataset title is required.";
        if (!tags.length) return "At least one tag is required.";
        if (!files.length)
            return "Add at least one file to this dataset folder.";
        const untitled = files.find((item) => !item.title.trim());
        if (untitled) {
            setExpanded((prev) => ({ ...prev, [untitled.key]: true }));
            return "Each file needs a title.";
        }
        return "";
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess(false);
        if (!user) {
            navigate("/signin");
            return;
        }
        const msg = validate();
        if (msg) {
            setError(msg);
            window.scrollTo({ top: 0, behavior: "smooth" });
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
            if (tags.length) {
                tags.forEach((tag) => {
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

            // 3) Upload every file with its own metadata
            const totalBytes = files.reduce(
                (sum, item) => sum + (item.file.size || 0),
                0
            );
            let uploadedBytes = 0;
            for (const item of files) {
                const priorBytes = uploadedBytes;
                const { fileId } = await requestAndUploadFile({
                    jobId: datasetJobId,
                    file: item.file,
                    onProgress: (pct) => {
                        const current = (item.file.size || 0) * (pct / 100);
                        const overall = totalBytes
                            ? Math.round(
                                  ((priorBytes + current) / totalBytes) * 100
                              )
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
                if (item.groundtruthed)
                    addFileForm.append("groundtruthed", "true");
                addFileForm.append("provenance", constrained(item.provenance, 125));
                addFileForm.append("source", constrained(item.source, 1000));
                addFileForm.append("cite_as", constrained(item.citeAs, 1500));
                addFileForm.append(
                    "permissions",
                    constrained(item.permissions, 1000)
                );
                addFileForm.append("duration", String(item.duration || 0));
                if (item.temporalFrom)
                    addFileForm.append("temporal_from", item.temporalFrom);
                if (item.temporalTo)
                    addFileForm.append("temporal_to", item.temporalTo);
                if (item.geography) {
                    addFileForm.append(
                        "geography",
                        constrained(item.geography, 2000)
                    );
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
                <div
                    className="wrap"
                    style={{ maxWidth: 860, padding: "48px 0 88px" }}
                >
                    <div className="empty">
                        <p>Loading…</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!user) return null;

    if (success) {
        return (
            <div className="page">
                <div
                    className="wrap"
                    style={{ maxWidth: 560, padding: "72px 0 88px" }}
                >
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
                        <h1 className="display" style={{ marginTop: 6 }}>
                            Dataset submitted
                        </h1>
                        <p
                            className="auth-sub"
                            style={{ maxWidth: "42ch", margin: "8px auto 0" }}
                        >
                            Your dataset was uploaded successfully. It is being
                            processed and will appear in your dashboard shortly.
                        </p>
                        <div
                            style={{
                                marginTop: 24,
                                display: "flex",
                                gap: 10,
                                justifyContent: "center",
                                flexWrap: "wrap",
                            }}
                        >
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
                        <p
                            className="muted"
                            style={{ marginTop: 8, maxWidth: "60ch" }}
                        >
                            A dataset is a folder for any number of files. Set
                            the folder details, drag in your files, then record
                            where each file came from and what it covers. Every
                            file keeps its own attribution and coverage.
                        </p>
                    </div>
                </div>

                {error && (
                    <div
                        className="attn-card warn"
                        role="alert"
                        style={{ margin: "20px 0" }}
                    >
                        <div className="aic">
                            <Ic name="warn" size={18} sw={2} />
                        </div>
                        <div>
                            <b>{error}</b>
                        </div>
                    </div>
                )}

                {notice && (
                    <div
                        className="attn-card info"
                        role="status"
                        style={{ margin: "20px 0" }}
                    >
                        <div className="aic">
                            <Ic name="info" size={18} sw={2} />
                        </div>
                        <div>
                            <b>{notice}</b>
                        </div>
                    </div>
                )}

                <form onSubmit={onSubmit} style={{ marginTop: 22 }}>
                    {/* Dataset details */}
                    <div className="form-section">
                        <div className="fs-head">
                            <div>
                                <h3>Dataset details</h3>
                                <p>
                                    Folder metadata: title, description, tags,
                                    and who can see it.
                                </p>
                            </div>
                        </div>

                        <div className="field">
                            <label>
                                Dataset title{" "}
                                <span className="req">(required)</span>
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
                            <AutoTextarea
                                minRows={3}
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
                                    text="Search existing tags as you type. If none fit, add a custom tag (it will be grouped under topic NA)."
                                    id="tooltip-tags"
                                />
                            </label>
                            <TagMultiSelect
                                value={tags}
                                onChange={(next) => setTags(next)}
                                disabled={submitting}
                            />
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
                                    Availability is locked to Public because
                                    your organization does not have private data
                                    enabled.
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Files */}
                    <div className="form-section">
                        <div className="fs-head">
                            <div>
                                <h3>Files in this folder</h3>
                                <p>
                                    Drag files in or browse. Open each file to
                                    record its source, licence, and coverage.
                                </p>
                            </div>
                        </div>

                        <div
                            className={"file-drop" + (dragging ? " drag" : "")}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={(e) => {
                                e.preventDefault();
                                setDragging(false);
                            }}
                            onDrop={handleDrop}
                        >
                            <span className="fdic">
                                <Ic name="dl" size={18} sw={2} />
                            </span>
                            <div className="fdmain">
                                <b>
                                    {dragging
                                        ? "Drop files to add them"
                                        : files.length
                                        ? `${files.length} file${
                                              files.length === 1 ? "" : "s"
                                          } added`
                                        : "Drag files here, or click to browse"}
                                </b>
                                <span>
                                    Any format. You can add multiple files at
                                    once.
                                </span>
                            </div>
                            <input
                                type="file"
                                onChange={handleFileChange}
                                accept="*/*"
                                multiple
                                aria-label="Add files"
                            />
                        </div>

                        {files.length > 0 && (
                            <div className="fa-list">
                                {files.map((item, idx) => {
                                    const isOpen = !!expanded[item.key];
                                    return (
                                        <div
                                            className={
                                                "fa-card" +
                                                (isOpen ? " open" : "")
                                            }
                                            key={item.key}
                                        >
                                            <div className="fa-head">
                                                <button
                                                    type="button"
                                                    className="fa-toggle"
                                                    onClick={() =>
                                                        toggleExpand(item.key)
                                                    }
                                                    aria-expanded={isOpen}
                                                >
                                                    <span className="fa-chev">
                                                        <Ic
                                                            name="chev"
                                                            size={16}
                                                        />
                                                    </span>
                                                    <span className="fa-name">
                                                        <b>{item.file.name}</b>
                                                        <span className="muted">
                                                            {fmtBytes(
                                                                item.file.size
                                                            )}
                                                            {item.format
                                                                ? ` · ${item.format.toUpperCase()}`
                                                                : ""}
                                                            {item.title.trim()
                                                                ? ""
                                                                : " · title needed"}
                                                        </span>
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-quiet"
                                                    onClick={() =>
                                                        removeFileEntry(
                                                            item.key
                                                        )
                                                    }
                                                >
                                                    Remove
                                                </button>
                                            </div>

                                            {isOpen && (
                                                <div className="fa-body">
                                                    <div className="field">
                                                        <label>
                                                            File title{" "}
                                                            <span className="req">
                                                                (required)
                                                            </span>
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={item.title}
                                                            onChange={(e) =>
                                                                updateFileEntry(
                                                                    item.key,
                                                                    "title",
                                                                    e.target.value.slice(
                                                                        0,
                                                                        200
                                                                    )
                                                                )
                                                            }
                                                            required
                                                        />
                                                    </div>

                                                    <div className="field">
                                                        <label>
                                                            File description
                                                        </label>
                                                        <AutoTextarea
                                                            minRows={2}
                                                            value={
                                                                item.description
                                                            }
                                                            onChange={(e) =>
                                                                updateFileEntry(
                                                                    item.key,
                                                                    "description",
                                                                    e.target.value.slice(
                                                                        0,
                                                                        1000
                                                                    )
                                                                )
                                                            }
                                                        />
                                                    </div>

                                                    <div className="fa-sub">
                                                        Attribution &amp;
                                                        licensing
                                                    </div>

                                                    <div className="field-row">
                                                        <div className="field">
                                                            <label>
                                                                Provenance
                                                                <HelpTooltip
                                                                    text="Who owns this file's data?"
                                                                    id={`tooltip-provenance-${idx}`}
                                                                />
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={
                                                                    item.provenance
                                                                }
                                                                onChange={(e) =>
                                                                    updateFileText(
                                                                        item.key,
                                                                        "provenance",
                                                                        e.target
                                                                            .value,
                                                                        125
                                                                    )
                                                                }
                                                            />
                                                            {item.errors
                                                                ?.provenance &&
                                                                invalidCharsNote}
                                                        </div>

                                                        <div className="field">
                                                            <label>
                                                                Source
                                                                <HelpTooltip
                                                                    text="Who gave you this file?"
                                                                    id={`tooltip-source-${idx}`}
                                                                />
                                                            </label>
                                                            <AutoTextarea
                                                                minRows={1}
                                                                value={
                                                                    item.source
                                                                }
                                                                onChange={(e) =>
                                                                    updateFileText(
                                                                        item.key,
                                                                        "source",
                                                                        e.target
                                                                            .value,
                                                                        1000
                                                                    )
                                                                }
                                                            />
                                                            {item.errors
                                                                ?.source &&
                                                                invalidCharsNote}
                                                        </div>
                                                    </div>

                                                    <div className="field">
                                                        <label>
                                                            Permissions
                                                            <HelpTooltip
                                                                text={
                                                                    <>
                                                                        To learn
                                                                        more
                                                                        about
                                                                        the
                                                                        Creative
                                                                        Commons
                                                                        licenses,
                                                                        visit{" "}
                                                                        <a
                                                                            href="https://creativecommons.org/share-your-work/cclicenses/"
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            onClick={(
                                                                                e
                                                                            ) =>
                                                                                e.stopPropagation()
                                                                            }
                                                                        >
                                                                            here
                                                                        </a>
                                                                        .
                                                                    </>
                                                                }
                                                                id={`tooltip-permissions-${idx}`}
                                                            />
                                                        </label>
                                                        <select
                                                            value={
                                                                item.permissions
                                                            }
                                                            onChange={(e) =>
                                                                updateFileEntry(
                                                                    item.key,
                                                                    "permissions",
                                                                    e.target
                                                                        .value
                                                                )
                                                            }
                                                        >
                                                            {PERMISSION_OPTIONS.map(
                                                                (opt) => (
                                                                    <option
                                                                        key={opt}
                                                                        value={
                                                                            opt
                                                                        }
                                                                    >
                                                                        {opt}
                                                                    </option>
                                                                )
                                                            )}
                                                        </select>
                                                    </div>

                                                    <div className="field">
                                                        <label>
                                                            Cite as
                                                            <HelpTooltip
                                                                text="How should someone give credit for this file?"
                                                                id={`tooltip-cite-as-${idx}`}
                                                            />
                                                        </label>
                                                        <AutoTextarea
                                                            minRows={2}
                                                            value={item.citeAs}
                                                            onChange={(e) =>
                                                                updateFileText(
                                                                    item.key,
                                                                    "citeAs",
                                                                    e.target
                                                                        .value,
                                                                    1500
                                                                )
                                                            }
                                                        />
                                                        {item.errors?.citeAs &&
                                                            invalidCharsNote}
                                                    </div>

                                                    <div className="fa-sub">
                                                        Coverage &amp; validity
                                                    </div>

                                                    <div className="field">
                                                        <label>
                                                            Groundtruthed
                                                            <HelpTooltip
                                                                text="Has this file's data been validated in the field?"
                                                                id={`tooltip-groundtruthed-${idx}`}
                                                            />
                                                        </label>
                                                        <div
                                                            className="gt-toggle"
                                                            role="radiogroup"
                                                            aria-label="Groundtruthed"
                                                        >
                                                            <button
                                                                type="button"
                                                                className={
                                                                    "gt-opt" +
                                                                    (!item.groundtruthed
                                                                        ? " on"
                                                                        : "")
                                                                }
                                                                onClick={() =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "groundtruthed",
                                                                        false
                                                                    )
                                                                }
                                                                aria-pressed={
                                                                    !item.groundtruthed
                                                                }
                                                            >
                                                                <span className="gt-mark">
                                                                    <Ic
                                                                        name="close"
                                                                        size={
                                                                            14
                                                                        }
                                                                        sw={2.4}
                                                                    />
                                                                </span>
                                                                <span className="gt-label">
                                                                    <b>No</b>
                                                                    <small>
                                                                        Not
                                                                        field-validated
                                                                    </small>
                                                                </span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={
                                                                    "gt-opt" +
                                                                    (item.groundtruthed
                                                                        ? " on"
                                                                        : "")
                                                                }
                                                                onClick={() =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "groundtruthed",
                                                                        true
                                                                    )
                                                                }
                                                                aria-pressed={
                                                                    item.groundtruthed
                                                                }
                                                            >
                                                                <span className="gt-mark">
                                                                    <Ic
                                                                        name="verified"
                                                                        size={
                                                                            15
                                                                        }
                                                                        sw={2}
                                                                    />
                                                                </span>
                                                                <span className="gt-label">
                                                                    <b>Yes</b>
                                                                    <small>
                                                                        Validated
                                                                        in the
                                                                        field
                                                                    </small>
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="field-row">
                                                        <div className="field">
                                                            <label>
                                                                Temporal
                                                                coverage from
                                                                <HelpTooltip
                                                                    text="Start date of temporal coverage."
                                                                    id={`tooltip-temporal-from-${idx}`}
                                                                />
                                                            </label>
                                                            <input
                                                                type="datetime-local"
                                                                value={isoToLocal(
                                                                    item.temporalFrom
                                                                )}
                                                                onChange={(e) =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "temporalFrom",
                                                                        localToIso(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        )
                                                                    )
                                                                }
                                                            />
                                                        </div>

                                                        <div className="field">
                                                            <label>
                                                                Temporal
                                                                coverage to
                                                                <HelpTooltip
                                                                    text="End date of temporal coverage."
                                                                    id={`tooltip-temporal-to-${idx}`}
                                                                />
                                                            </label>
                                                            <input
                                                                type="datetime-local"
                                                                value={isoToLocal(
                                                                    item.temporalTo
                                                                )}
                                                                onChange={(e) =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "temporalTo",
                                                                        localToIso(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        )
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="field-row">
                                                        <div className="field">
                                                            <label>
                                                                Duration (years)
                                                                <HelpTooltip
                                                                    text="How many years can this data be used for from the date of creation? 0 if not applicable."
                                                                    id={`tooltip-duration-${idx}`}
                                                                />
                                                            </label>
                                                            <input
                                                                type="number"
                                                                value={
                                                                    item.duration
                                                                }
                                                                onChange={(e) =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "duration",
                                                                        Math.max(
                                                                            0,
                                                                            parseInt(
                                                                                e
                                                                                    .target
                                                                                    .value
                                                                            ) ||
                                                                                0
                                                                        )
                                                                    )
                                                                }
                                                                min="0"
                                                            />
                                                        </div>

                                                        <div className="field">
                                                            <label>
                                                                Geographical
                                                                extent
                                                                <HelpTooltip
                                                                    text="Geographic coverage or location information."
                                                                    id={`tooltip-geography-${idx}`}
                                                                />
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={
                                                                    item.geography
                                                                }
                                                                onChange={(e) =>
                                                                    updateFileEntry(
                                                                        item.key,
                                                                        "geography",
                                                                        e.target
                                                                            .value
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    </div>

                                                    {files.length > 1 && (
                                                        <div className="fa-apply">
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-sm"
                                                                onClick={() =>
                                                                    applyToAll(
                                                                        item.key
                                                                    )
                                                                }
                                                            >
                                                                <Ic
                                                                    name="copy"
                                                                    size={14}
                                                                    sw={2}
                                                                />
                                                                Apply this
                                                                file&rsquo;s
                                                                attribution
                                                                &amp; coverage
                                                                to all files
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Sticky navigation bar */}
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
                                    <span
                                        className="mono-token"
                                        style={{
                                            marginTop: 6,
                                            display: "inline-block",
                                        }}
                                    >
                                        Uploading… {progress}%
                                    </span>
                                </>
                            ) : (
                                <span className="fa-note">
                                    Fields marked{" "}
                                    <span className="req">(required)</span> must
                                    be filled before publishing.
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
