import React, { useEffect, useState } from "react";
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
import {
    AVAILABILITY_OPTIONS,
    AVAILABILITY_PUBLIC,
} from "../constants/availability";

function CreateDataset() {
    const navigate = useNavigate();
    const { user, verifyUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const [orgPrivate, setOrgPrivate] = useState(false);
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

    const [file, setFile] = useState(null);
    const [fileTitle, setFileTitle] = useState("");
    const [fileDescription, setFileDescription] = useState("");
    const [fileFormat, setFileFormat] = useState("");
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
    const [fileTitleError, setFileTitleError] = useState(false);
    const [fileDescriptionError, setFileDescriptionError] = useState(false);
    const [fileFormatError, setFileFormatError] = useState(false);

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

    const handleFileChange = (e) => {
        const f =
            e.target.files && e.target.files[0] ? e.target.files[0] : null;
        setFile(f);
        if (f && !fileTitle) {
            // Filter special characters from filename when auto-filling
            const filteredName = f.name.replace(/[<>"'&;()]/g, "");
            const title = filteredName.slice(0, 200);
            setFileTitle(title);
            if (title !== f.name.slice(0, 200)) {
                setFileTitleError(true);
            }
        }
        if (f && !fileFormat) {
            const parts = f.name.split(".");
            if (parts.length > 1) {
                const format = parts.pop().slice(0, 20);
                // Filter special characters from format
                const filteredFormat = format.replace(/[<>"'&;()]/g, "");
                setFileFormat(filteredFormat);
                if (filteredFormat !== format) {
                    setFileFormatError(true);
                }
            }
        }
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
        if (!file) {
            setError("Please select a file.");
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
        if (!fileTitle.trim()) {
            setError("File title is required.");
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

            // 3) Presign and upload the selected file to S3
            const { fileId } = await requestAndUploadFile({
                jobId: datasetJobId,
                file,
                onProgress: setProgress,
            });

            // 4) Stage file metadata using job_id + file_id
            const addFileForm = new FormData();
            addFileForm.append("job_id", datasetJobId);
            addFileForm.append("file_id", fileId);
            addFileForm.append("file_title", constrained(fileTitle, 200));
            addFileForm.append(
                "file_description",
                constrained(fileDescription, 1000)
            );
            addFileForm.append("file_format", constrained(fileFormat, 20));
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

            // 5) Complete upload job
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

    if (loading) {
        return (
            <div className="page">
                <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
                    <div className="empty"><p>Loading…</p></div>
                </div>
            </div>
        );
    }

    if (!user) return null;

    if (success) {
        return (
            <div className="page">
                <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
                    <div className="auth-wrap">
                        <div className="auth-card">
                            <span className="eyebrow">Datasets</span>
                            <h1 className="display">Upload in progress</h1>
                            <p className="auth-sub">
                                Dataset upload is in progress, it will soon be
                                available in your dashboard.
                            </p>
                            <div style={{ marginTop: 22 }}>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => navigate("/dashboard")}
                                >
                                    Dashboard
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
                <span className="eyebrow">Datasets</span>
                <div className="section-head" style={{ marginTop: 8 }}>
                    <h2 className="section-title">Create a dataset</h2>
                </div>

                {error && (
                    <div className="attn-card warn" role="alert" style={{ marginBottom: 20 }}>
                        <div><b>{error}</b></div>
                    </div>
                )}

                <form onSubmit={onSubmit} className="form-layout">
                    <div className="form-panel">
                    <h3 className="display">Dataset</h3>
                    <div className="field">
                        <label>
                            Dataset Title{" "}
                            <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                            <HelpTooltip
                                text="Name of the dataset. For example: Bangalore Rainfall Data would be dataset and you can add several datasets by year under that Title"
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
                        {titleError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>
                            Dataset Description
                            <HelpTooltip
                                text="What does the dataset contain."
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
                        {datasetDescriptionError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>
                            Tags (keywords separated by comma){" "}
                            <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                            <HelpTooltip
                                text="Think keyword. Which all search results should this dataset appear in."
                                id="tooltip-tags"
                            />
                        </label>
                        <input
                            type="text"
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
                        {tagsError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
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
                            value={availability}
                            onChange={(e) =>
                                setAvailability(Number(e.target.value))
                            }
                            disabled={!orgPrivate}
                        >
                            {AVAILABILITY_OPTIONS.map((opt) => (
                                <option
                                    key={opt.value}
                                    value={opt.value}
                                    disabled={!orgPrivate && opt.value !== AVAILABILITY_PUBLIC}
                                >
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        {!orgPrivate && (
                            <span className="muted" style={{ fontSize: 13 }}>
                                Your organization is public, so datasets stay public.
                            </span>
                        )}
                    </div>
                    </div>
                    <div className="form-panel">
                    <h3 className="display">File</h3>

                    <div className="field">
                        <label>
                            File <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                        </label>
                        <input
                            type="file"
                            onChange={handleFileChange}
                            accept="*/*"
                        />
                    </div>

                    <div className="field">
                        <label>
                            File Title{" "}
                            <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
                        </label>
                        <input
                            type="text"
                            value={fileTitle}
                            onChange={(e) =>
                                validateAndFilterSpecialChars(
                                    e.target.value,
                                    setFileTitle,
                                    setFileTitleError,
                                    200
                                )
                            }
                            required
                        />
                        {fileTitleError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>File Description</label>
                        <textarea
                            rows={3}
                            value={fileDescription}
                            onChange={(e) =>
                                validateAndFilterSpecialChars(
                                    e.target.value,
                                    setFileDescription,
                                    setFileDescriptionError,
                                    1000
                                )
                            }
                        />
                        {fileDescriptionError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>
                            Provenance
                            <HelpTooltip
                                text="Who own the dataset?"
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
                        {provenanceError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
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
                        {sourceError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>
                            Permissions
                            <HelpTooltip
                                text={
                                    <>
                                        To know more about the Creative Commons Licenses please visit{" "}
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
                            Cite As
                            <HelpTooltip
                                text="How should someone give credit for the data?"
                                id="tooltip-cite-as"
                            />
                        </label>
                        <textarea
                            rows={4}
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
                        {citeAsError && (
                            <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                                no special characters &lt; , &gt; , " , ' , &amp; ,
                                ; , ( , )
                            </span>
                        )}
                    </div>

                    <div className="field">
                        <label>
                            Groundtruthed
                            <HelpTooltip
                                text="Has this data been validated in the field?"
                                id="tooltip-groundtruthed"
                            />
                        </label>
                        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                            <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <input
                                    type="radio"
                                    name="groundtruthed"
                                    id="gt_no"
                                    checked={!groundtruthed}
                                    onChange={() => setGroundtruthed(false)}
                                />
                                No
                            </label>
                            <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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

                    <div className="field">
                        <label>
                            Duration
                            <HelpTooltip
                                text="How many years can this data be used for from the date of creation? 0 if not applicable"
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

                    <div className="field-row">
                        <div className="field">
                            <label>
                                Temporal Coverage From
                                <HelpTooltip
                                    text="Start date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                                    id="tooltip-temporal-from"
                                />
                            </label>
                            <input
                                type="datetime-local"
                                value={temporalFrom ? (() => {
                                    // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
                                    try {
                                        const date = new Date(temporalFrom);
                                        if (isNaN(date.getTime())) return "";
                                        // Get local datetime string in format YYYY-MM-DDTHH:mm
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
                                    // Convert to ISO format with timezone
                                    if (val) {
                                        // datetime-local gives us YYYY-MM-DDTHH:mm in local time
                                        // We need to convert it to ISO format
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
                                Temporal Coverage To
                                <HelpTooltip
                                    text="End date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                                    id="tooltip-temporal-to"
                                />
                            </label>
                            <input
                                type="datetime-local"
                                value={temporalTo ? (() => {
                                    // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:mm)
                                    try {
                                        const date = new Date(temporalTo);
                                        if (isNaN(date.getTime())) return "";
                                        // Get local datetime string in format YYYY-MM-DDTHH:mm
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
                                    // Convert to ISO format with timezone
                                    if (val) {
                                        // datetime-local gives us YYYY-MM-DDTHH:mm in local time
                                        // We need to convert it to ISO format
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

                    <div className="field">
                        <label>
                            Geographical Extent
                            <HelpTooltip
                                text="Geographic coverage or location information"
                                id="tooltip-geography"
                            />
                        </label>
                        <textarea
                            rows={3}
                            value={geography}
                            onChange={(e) => setGeography(e.target.value)}
                        />
                    </div>

                    {submitting && (
                        <div className="field">
                            <label>Upload progress</label>
                            <div style={{ background: "var(--wash, #eef2f6)", borderRadius: 999, height: 8, overflow: "hidden" }}>
                                <div
                                    role="progressbar"
                                    aria-valuenow={progress}
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    style={{ width: `${progress}%`, height: "100%", background: "var(--blue, #1b75e0)", transition: "width .2s" }}
                                />
                            </div>
                            <span className="mono-token" style={{ marginTop: 6, display: "inline-block" }}>{progress}%</span>
                        </div>
                    )}
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={submitting}
                        style={{ gridColumn: "1 / -1", justifySelf: "start" }}
                    >
                        {submitting ? "Submitting…" : "Submit"}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default CreateDataset;
