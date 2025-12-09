import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { upload_url_endpoint, add_files_url_endpoint } from "../api/endpoints";
import HelpTooltip from "../components/HelpTooltip";

function AddFile() {
  const navigate = useNavigate();
  const { user, verifyUser } = useAuth();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Form state
  const [file, setFile] = useState(null);
  const [fileTitle, setFileTitle] = useState("");
  const [fileDescription, setFileDescription] = useState("");
  const [fileFormat, setFileFormat] = useState("");
  const [provenance, setProvenance] = useState("");
  const [source, setSource] = useState("");
  const [citeAs, setCiteAs] = useState("");
  const [groundtruthed, setGroundtruthed] = useState(false);
  const [permissions, setPermissions] = useState("CC0: Public Domain");
  const [duration, setDuration] = useState(0);
  const [value, setValue] = useState("low");
  const [temporalFrom, setTemporalFrom] = useState("");
  const [temporalTo, setTemporalTo] = useState("");
  const [geography, setGeography] = useState("");

  // Validation error states
  const [fileTitleError, setFileTitleError] = useState(false);
  const [fileDescriptionError, setFileDescriptionError] = useState(false);
  const [fileFormatError, setFileFormatError] = useState(false);
  const [provenanceError, setProvenanceError] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [citeAsError, setCiteAsError] = useState(false);

  const datasetId = searchParams.get("dataset_id");

  // Check authentication and dataset_id
  useEffect(() => {
    const init = async () => {
      try {
        // Check if dataset_id is present
        if (!datasetId) {
          navigate("/datasets");
          return;
        }

        // Verify user authentication
        const userData = await verifyUser();
        if (!userData) {
          navigate("/signin");
          return;
        }
      } catch (e) {
        console.error("Error checking authentication:", e);
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
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
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
  const validateAndFilterSpecialChars = (value, setValue, setError, maxLength) => {
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

    if (!fileTitle.trim()) {
      setError("File title is required.");
      return;
    }

    if (!datasetId) {
      setError("Dataset ID is missing.");
      return;
    }

    try {
      setSubmitting(true);
      setProgress(0);

      // 1) Get upload URL for selected filename
      const filenameOnly = file.name; // do not include path
      const uploadResp = await fetch(
        `${upload_url_endpoint}?filename=${encodeURIComponent(filenameOnly)}`,
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
      const contentType = uploadData.content_type || file.type || "application/octet-stream";

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
          else reject(new Error(`Upload failed with status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Upload network error"));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.send(file);
      });

      // 3) Call add_file endpoint with FormData
      const userId = user.id;
      const fileKey = `${userId}/${filenameOnly}`;

      const form = new FormData();
      form.append("file_title", constrained(fileTitle, 200));
      form.append("file_key", fileKey);
      form.append("file_description", constrained(fileDescription, 1000));
      form.append("file_format", constrained(fileFormat, 20));
      form.append("dataset_id", datasetId);
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

      const addFileResp = await fetch(add_files_url_endpoint, {
        method: "POST",
        body: form,
        credentials: "include",
      });

      if (!addFileResp.ok) {
        const txt = await addFileResp.text();
        throw new Error(`Failed to add file: ${txt}`);
      }

      const result = await addFileResp.json();
      console.log("File added successfully:", result);

      // Success
      setSuccess(true);
      setProgress(100);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unexpected error");
      setProgress(0);
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

  if (!user) {
    return null; // Will redirect to signin
  }

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-8 col-lg-6">
          <h2 className="mb-4">Add File to Dataset</h2>

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          {success ? (
            <div>
              <div className="alert alert-success" role="alert">
                <strong>File successfully added to the dataset</strong>
              </div>
              <div className="d-flex gap-2 mt-3">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    navigate(`/dataset-info?dataset_id=${datasetId}`);
                  }}
                >
                  Dataset
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    navigate("/dashboard");
                  }}
                >
                  Dashboard
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div className="mb-3">
                <label htmlFor="file" className="form-label">
                  File <span style={{ color: "red" }}>(required)</span>
                </label>
                <input
                  type="file"
                  className="form-control"
                  id="file"
                  onChange={handleFileChange}
                  required
                  disabled={submitting}
                />
              </div>

              <div className="mb-3">
                <label htmlFor="fileTitle" className="form-label">
                  Title <span style={{ color: "red" }}>(required)</span>
                </label>
                <input
                  type="text"
                  className={`form-control ${fileTitleError ? "is-invalid" : ""}`}
                  id="fileTitle"
                  value={fileTitle}
                  onChange={(e) =>
                    validateAndFilterSpecialChars(e.target.value, setFileTitle, setFileTitleError, 200)
                  }
                  required
                  maxLength={200}
                  disabled={submitting}
                />
                {fileTitleError && (
                  <div className="invalid-feedback" style={{ display: "block", color: "red" }}>
                    no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label htmlFor="fileDescription" className="form-label">
                  Description
                </label>
                <textarea
                  className={`form-control ${fileDescriptionError ? "is-invalid" : ""}`}
                  id="fileDescription"
                  rows="3"
                  value={fileDescription}
                  onChange={(e) =>
                    validateAndFilterSpecialChars(e.target.value, setFileDescription, setFileDescriptionError, 1000)
                  }
                  maxLength={1000}
                  disabled={submitting}
                />
                {fileDescriptionError && (
                  <div className="invalid-feedback" style={{ display: "block", color: "red" }}>
                    no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label">
                  Provenance
                  <HelpTooltip
                    text="Who own the dataset?"
                    id="tooltip-provenance-addfile"
                  />
                </label>
                <input
                  type="text"
                  className={`form-control ${provenanceError ? "is-invalid" : ""}`}
                  value={provenance}
                  onChange={(e) =>
                    validateAndFilterSpecialChars(e.target.value, setProvenance, setProvenanceError, 125)
                  }
                  disabled={submitting}
                />
                {provenanceError && (
                  <div className="invalid-feedback" style={{ display: "block", color: "red" }}>
                    no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label">
                  Source
                  <HelpTooltip
                    text="Who gave you the dataset?"
                    id="tooltip-source-addfile"
                  />
                </label>
                <input
                  type="text"
                  className={`form-control ${sourceError ? "is-invalid" : ""}`}
                  value={source}
                  onChange={(e) =>
                    validateAndFilterSpecialChars(e.target.value, setSource, setSourceError, 1000)
                  }
                  disabled={submitting}
                />
                {sourceError && (
                  <div className="invalid-feedback" style={{ display: "block", color: "red" }}>
                    no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
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
                    id="tooltip-permissions-addfile"
                  />
                </label>
                <select
                  className="form-select"
                  value={permissions}
                  onChange={(e) => setPermissions(e.target.value)}
                  disabled={submitting}
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
                    id="tooltip-cite-as-addfile"
                  />
                </label>
                <textarea
                  className={`form-control ${citeAsError ? "is-invalid" : ""}`}
                  rows={4}
                  value={citeAs}
                  onChange={(e) =>
                    validateAndFilterSpecialChars(e.target.value, setCiteAs, setCiteAsError, 1500)
                  }
                  disabled={submitting}
                />
                {citeAsError && (
                  <div className="invalid-feedback" style={{ display: "block", color: "red" }}>
                    no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label me-3">
                  Groundtruthed
                  <HelpTooltip
                    text="Has this data been validated in the field?"
                    id="tooltip-groundtruthed-addfile"
                  />
                </label>
                <div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="groundtruthed-addfile"
                      id="gt_no_addfile"
                      checked={!groundtruthed}
                      onChange={() => setGroundtruthed(false)}
                      disabled={submitting}
                    />
                    <label className="form-check-label" htmlFor="gt_no_addfile">
                      No
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="groundtruthed-addfile"
                      id="gt_yes_addfile"
                      checked={groundtruthed}
                      onChange={() => setGroundtruthed(true)}
                      disabled={submitting}
                    />
                    <label className="form-check-label" htmlFor="gt_yes_addfile">
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
                    id="tooltip-duration-addfile"
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
                  disabled={submitting}
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
                    id="tooltip-value-addfile"
                  />
                </label>
                <select
                  className="form-select"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={submitting}
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
                    id="tooltip-temporal-from-addfile"
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
                  disabled={submitting}
                />
              </div>

              <div className="mb-3">
                <label className="form-label">
                  Temporal Coverage To
                  <HelpTooltip
                    text="End date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                    id="tooltip-temporal-to-addfile"
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
                  disabled={submitting}
                />
              </div>

              <div className="mb-3">
                <label className="form-label">
                  Geographical Extent
                  <HelpTooltip
                    text="Geographic coverage or location information"
                    id="tooltip-geography-addfile"
                  />
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={geography}
                  onChange={(e) => setGeography(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {submitting && (
                <div className="mb-3">
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
                {submitting ? (
                  <>
                    <span
                      className="spinner-border spinner-border-sm me-2"
                      role="status"
                      aria-hidden="true"
                    ></span>
                    Uploading...
                  </>
                ) : (
                  "Upload"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddFile;

