import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    upload_url_endpoint,
    create_dataset_endpoint,
    organization_by_id_endpoint,
} from "../api/endpoints";
import HelpTooltip from "../components/HelpTooltip";

function CreateDataset() {
    const navigate = useNavigate();
    const { user, verifyUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const [orgPrivate, setOrgPrivate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");

    // Form state
    const [title, setTitle] = useState("");
    const [datasetDescription, setDatasetDescription] = useState("");
    const [tags, setTags] = useState("");
    const [provenance, setProvenance] = useState("");
    const [source, setSource] = useState("");
    const [citeAs, setCiteAs] = useState("");
    const [groundtruthed, setGroundtruthed] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [permissions, setPermissions] = useState("CC0: Public Domain");
    const [duration, setDuration] = useState(0);
    const [value, setValue] = useState("low");

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

            // 1) Get upload URL for selected filename
            const filenameOnly = file.name; // do not include path
            const uploadResp = await fetch(
                `${upload_url_endpoint}?filename=${encodeURIComponent(
                    filenameOnly
                )}`,
                { credentials: "include" }
            );
            if (!uploadResp.ok) {
                const txt = await uploadResp.text();
                throw new Error(`Failed to get upload URL: ${txt}`);
            }
            const uploadData = await uploadResp.json();
            const uploadUrl =
                uploadData.upload_url || uploadData.url || uploadData.uploadUrl;
            if (!uploadUrl) {
                throw new Error("Upload URL missing in response.");
            }

            // Use the content_type from the response (matches what was used to sign the presigned URL)
            // Fallback to file.type for backward compatibility
            const contentType =
                uploadData.content_type ||
                file.type ||
                "application/octet-stream";

            // 2) Upload the file to S3 using the presigned URL (PUT)
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.upload.onprogress = (evt) => {
                    if (evt.lengthComputable) {
                        const pct = Math.round((evt.loaded / evt.total) * 100);
                        setProgress(pct);
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else
                        reject(
                            new Error(`Upload failed with status ${xhr.status}`)
                        );
                };
                xhr.onerror = () => reject(new Error("Upload network error"));
                xhr.open("PUT", uploadUrl);
                xhr.setRequestHeader("Content-Type", contentType);
                xhr.send(file);
            });

            // 3) Call create_dataset endpoint with FormData
            const userId = user.id;
            const organizationId = user.organization;
            const fileKey = `${userId}/${filenameOnly}`;

            const form = new FormData();
            form.append("title", constrained(title, 200));
            form.append("creator", userId);
            form.append(
                "dataset_description",
                constrained(datasetDescription, 2000)
            );
            // Process tags: split by comma, strip whitespace, replace internal spaces with hyphens, send as array
            if (tags && tags.trim()) {
                const tagsArray = tags
                    .split(",")
                    .map(tag => tag.trim())
                    .filter(tag => tag.length > 0)
                    .map(tag => tag.replace(/\s+/g, "-")); // Replace one or more spaces with single hyphen
                tagsArray.forEach(tag => {
                    form.append("tags", tag);
                });
            }
            form.append("organization", organizationId);
            form.append("private", orgPrivate && isPrivate ? "true" : "false");

            form.append("filename", constrained(fileTitle, 200));
            form.append("file_key", fileKey);
            form.append("file_description", constrained(fileDescription, 1000));
            form.append("file_format", constrained(fileFormat, 20));
            form.append("provenance", constrained(provenance, 125));
            form.append("source", constrained(source, 1000));
            form.append("cite_as", constrained(citeAs, 1500));
            if (groundtruthed) form.append("groundtruthed", "true");
            form.append("permissions", constrained(permissions, 1000));
            form.append("duration", duration.toString());
            if (value) form.append("value", value);
            if (temporalFrom) form.append("temporal_from", temporalFrom);
            if (temporalTo) form.append("temporal_to", temporalTo);
            if (geography) form.append("geography", constrained(geography, 2000));

            const createResp = await fetch(create_dataset_endpoint, {
                method: "POST",
                body: form,
                credentials: "include",
            });
            if (!createResp.ok) {
                const txt = await createResp.text();
                throw new Error(`Create dataset failed: ${txt}`);
            }
            const result = await createResp.json();

            // 4) Redirect to dataset-info with dataset_id
            const datasetId = result.dataset?.dataset_id || result.dataset_id;
            if (datasetId) {
                navigate(`/dataset-info?dataset_id=${datasetId}`);
            } else {
                throw new Error("Dataset ID not found in response");
            }
        } catch (err) {
            console.error(err);
            setError(err.message || "Unexpected error");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="container py-5 text-center">
                <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    if (!user) return null;

    return (
        <div className="container py-4">
            <h2 className="mb-4">Create a Dataset</h2>

            {error && (
                <div className="alert alert-danger" role="alert">
                    {error}
                </div>
            )}

            <form onSubmit={onSubmit}>
                <div className="mb-3">
                    <label className="form-label">
                        Dataset Title{" "}
                        <span style={{ color: "red" }}>(required)</span>
                        <HelpTooltip
                            text="Name of the dataset. For example: Bangalore Rainfall Data would be dataset and you can add several datasets by year under that Title"
                            id="tooltip-dataset-title"
                        />
                    </label>
                    <input
                        type="text"
                        className={`form-control ${
                            titleError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Dataset Description
                        <HelpTooltip
                            text="What does the dataset contain."
                            id="tooltip-dataset-description"
                        />
                    </label>
                    <textarea
                        className={`form-control ${
                            datasetDescriptionError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Tags (keywords separated by comma){" "}
                        <span style={{ color: "red" }}>(required)</span>
                        <HelpTooltip
                            text="Think keyword. Which all search results should this dataset appear in."
                            id="tooltip-tags"
                        />
                    </label>
                    <input
                        type="text"
                        className={`form-control ${
                            tagsError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                {orgPrivate && (
                    <div className="mb-3">
                        <label className="form-label">
                            Availability
                            <HelpTooltip
                                text="Is the dataset public or available to only your organisation?"
                                id="tooltip-private"
                            />
                        </label>
                        <select
                            className="form-select"
                            value={isPrivate ? "private" : "public"}
                            onChange={(e) =>
                                setIsPrivate(e.target.value === "private")
                            }
                        >
                            <option value="public">Public</option>
                            <option value="private">Private</option>
                        </select>
                    </div>
                )}

                <h4 className="mt-4">File Upload</h4>

                <div className="mb-3">
                    <label className="form-label">
                        File <span style={{ color: "red" }}>(required)</span>
                    </label>
                    <input
                        type="file"
                        className="form-control"
                        onChange={handleFileChange}
                        accept="*/*"
                    />
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        File Title{" "}
                        <span style={{ color: "red" }}>(required)</span>
                    </label>
                    <input
                        type="text"
                        className={`form-control ${
                            fileTitleError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">File Description</label>
                    <textarea
                        className={`form-control ${
                            fileDescriptionError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Provenance
                        <HelpTooltip
                            text="Who own the dataset?"
                            id="tooltip-provenance"
                        />
                    </label>
                    <input
                        type="text"
                        className={`form-control ${
                            provenanceError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Source
                        <HelpTooltip
                            text="Who gave you the dataset?"
                            id="tooltip-source"
                        />
                    </label>
                    <input
                        type="text"
                        className={`form-control ${
                            sourceError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label">
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
                        className="form-select"
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

                <div className="mb-3">
                    <label className="form-label">
                        Cite As
                        <HelpTooltip
                            text="How should someone give credit for the data?"
                            id="tooltip-cite-as"
                        />
                    </label>
                    <textarea
                        className={`form-control ${
                            citeAsError ? "is-invalid" : ""
                        }`}
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
                        <div
                            className="invalid-feedback"
                            style={{ display: "block", color: "red" }}
                        >
                            no special characters &lt; , &gt; , " , ' , &amp; ,
                            ; , ( , )
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <label className="form-label me-3">
                        Groundtruthed
                        <HelpTooltip
                            text="Has this data been validated in the field?"
                            id="tooltip-groundtruthed"
                        />
                    </label>
                    <div>
                        <div className="form-check form-check-inline">
                            <input
                                className="form-check-input"
                                type="radio"
                                name="groundtruthed"
                                id="gt_no"
                                checked={!groundtruthed}
                                onChange={() => setGroundtruthed(false)}
                            />
                            <label className="form-check-label" htmlFor="gt_no">
                                No
                            </label>
                        </div>
                        <div className="form-check form-check-inline">
                            <input
                                className="form-check-input"
                                type="radio"
                                name="groundtruthed"
                                id="gt_yes"
                                checked={groundtruthed}
                                onChange={() => setGroundtruthed(true)}
                            />
                            <label
                                className="form-check-label"
                                htmlFor="gt_yes"
                            >
                                Yes
                            </label>
                        </div>
                    </div>
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Duration
                        <HelpTooltip
                            text="How many years can this data be used for from the date of creation? 0 if not applicable"
                            id="tooltip-duration"
                        />
                    </label>
                    <input
                        type="number"
                        className="form-control"
                        value={duration}
                        onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setDuration(Math.max(0, val));
                        }}
                        min="0"
                    />
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Value
                        <HelpTooltip
                            text={`What is the value of the data?
High: data has high acquisition cost or sensitive information
Medium: data is specific to a particular organisation and hard to search online
Low: Openly downloadable in public domain`}
                            id="tooltip-value"
                        />
                    </label>
                    <select
                        className="form-select"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                    </select>
                </div>

                <div className="mb-3">
                    <label className="form-label">
                        Temporal Coverage From
                        <HelpTooltip
                            text="Start date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                            id="tooltip-temporal-from"
                        />
                    </label>
                    <input
                        type="datetime-local"
                        className="form-control"
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

                <div className="mb-3">
                    <label className="form-label">
                        Temporal Coverage To
                        <HelpTooltip
                            text="End date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                            id="tooltip-temporal-to"
                        />
                    </label>
                    <input
                        type="datetime-local"
                        className="form-control"
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

                <div className="mb-3">
                    <label className="form-label">
                        Geographical Extent
                        <HelpTooltip
                            text="Geographic coverage or location information"
                            id="tooltip-geography"
                        />
                    </label>
                    <textarea
                        className="form-control"
                        rows={3}
                        value={geography}
                        onChange={(e) => setGeography(e.target.value)}
                    />
                </div>

                {submitting && (
                    <div className="mb-3">
                        <label className="form-label">Upload progress</label>
                        <div className="progress">
                            <div
                                className="progress-bar"
                                role="progressbar"
                                style={{ width: `${progress}%` }}
                                aria-valuenow={progress}
                                aria-valuemin="0"
                                aria-valuemax="100"
                            >
                                {progress}%
                            </div>
                        </div>
                    </div>
                )}

                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting}
                >
                    {submitting ? "Submitting..." : "Submit"}
                </button>
            </form>
        </div>
    );
}

export default CreateDataset;
