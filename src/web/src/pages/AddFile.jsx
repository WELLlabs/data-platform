import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  add_files_url_endpoint,
  create_upload_job_endpoint,
  complete_upload_job_endpoint,
} from "../api/endpoints";
import { requestAndUploadFile } from "../api/s3Upload";
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
  const [files, setFiles] = useState([]);
  const [fileDescription, setFileDescription] = useState("");
  const [provenance, setProvenance] = useState("");
  const [source, setSource] = useState("");
  const [citeAs, setCiteAs] = useState("");
  const [groundtruthed, setGroundtruthed] = useState(false);
  const [permissions, setPermissions] = useState("CC0: Public Domain");
  const [duration, setDuration] = useState(0);
  const [temporalFrom, setTemporalFrom] = useState("");
  const [temporalTo, setTemporalTo] = useState("");
  const [geography, setGeography] = useState("");

  // Validation error states
  const [fileDescriptionError, setFileDescriptionError] = useState(false);
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
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (!picked.length) return;
    setFiles((prev) => {
      const next = [...prev];
      picked.forEach((f) => {
        const filteredName = f.name.replace(/[<>"'&;()]/g, "");
        const parts = f.name.split(".");
        const ext = parts.length > 1 ? parts.pop().slice(0, 20) : "";
        const entry = {
          key: `${f.name}-${f.size}-${f.lastModified}`,
          file: f,
          title: filteredName.slice(0, 200),
          format: ext.replace(/[<>"'&;()]/g, ""),
        };
        if (!next.some((x) => x.key === entry.key)) next.push(entry);
      });
      return next;
    });
    e.target.value = "";
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

    if (!files.length) {
      setError("Please select at least one file.");
      return;
    }

    if (files.some((item) => !item.title.trim())) {
      setError("Each file needs a title.");
      return;
    }

    if (!datasetId) {
      setError("Dataset ID is missing.");
      return;
    }

    try {
      setSubmitting(true);
      setProgress(0);

      // 1) Create an upload job
      const createJobResp = await fetch(create_upload_job_endpoint, {
        method: "POST",
        credentials: "include",
      });

      if (!createJobResp.ok) {
        const txt = await createJobResp.text();
        throw new Error(`Failed to create upload job: ${txt}`);
      }

      const createJobData = await createJobResp.json();
      const jobId = createJobData.job_id;
      if (!jobId) {
        throw new Error("Job ID missing in create upload job response.");
      }

      const totalBytes = files.reduce((sum, item) => sum + (item.file.size || 0), 0);
      let uploadedBytes = 0;
      for (const item of files) {
        const { fileId } = await requestAndUploadFile({
          jobId,
          file: item.file,
          onProgress: (pct) => {
            const current = (item.file.size || 0) * (pct / 100);
            const overall = totalBytes
              ? Math.round(((uploadedBytes + current) / totalBytes) * 100)
              : pct;
            setProgress(Math.min(99, overall));
          },
        });

        const form = new FormData();
        form.append("job_id", jobId);
        form.append("file_id", fileId);
        form.append("file_title", constrained(item.title, 200));
        form.append("file_description", constrained(fileDescription, 1000));
        form.append("file_format", constrained(item.format, 20));
        form.append("dataset_id", datasetId);
        form.append("provenance", constrained(provenance, 125));
        form.append("source", constrained(source, 1000));
        form.append("cite_as", constrained(citeAs, 1500));
        if (groundtruthed) form.append("groundtruthed", "true");
        form.append("permissions", constrained(permissions, 1000));
        form.append("duration", duration.toString());
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
        uploadedBytes += item.file.size || 0;
      }

      // 5) Complete the upload job
      const completeJobResp = await fetch(
        `${complete_upload_job_endpoint}?job_id=${encodeURIComponent(jobId)}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (!completeJobResp.ok) {
        const txt = await completeJobResp.text();
        throw new Error(`Failed to complete upload job: ${txt}`);
      }

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
      <div className="page">
        <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to signin
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 720, padding: "48px 0 88px" }}>
        <span className="eyebrow">Datasets</span>
        <div className="section-head" style={{ marginTop: 8 }}>
          <h2 className="section-title">Add file to dataset</h2>
        </div>

        {error && (
          <div className="attn-card warn" role="alert" style={{ marginBottom: 20 }}>
            <div><b>{error}</b></div>
          </div>
        )}

        {success ? (
          <div className="auth-card" style={{ marginTop: 8 }}>
            <h1 className="display" style={{ fontSize: 28 }}>File added</h1>
            <p className="auth-sub">File successfully added to the dataset.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  navigate(`/dataset-info?dataset_id=${datasetId}`);
                }}
              >
                Dataset
              </button>
              <button
                className="btn btn-ghost"
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
            <div className="field">
              <label htmlFor="file">
                Files <span style={{ color: "var(--red, #c62828)" }}>(required)</span>
              </label>
              <input
                type="file"
                id="file"
                onChange={handleFileChange}
                multiple
                accept="*/*"
                disabled={submitting}
              />
              {files.length > 0 && (
                <div className="file-stack">
                  {files.map((item) => (
                    <div className="file-stack-item" key={item.key}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <b>{item.file.name}</b>
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() => setFiles((prev) => prev.filter((x) => x.key !== item.key))}
                          disabled={submitting}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                        <label>File title</label>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) =>
                            setFiles((prev) =>
                              prev.map((x) =>
                                x.key === item.key ? { ...x, title: e.target.value.slice(0, 200) } : x
                              )
                            )
                          }
                          required
                          disabled={submitting}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="fileDescription">Description</label>
              <textarea
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
                <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                  no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                </span>
              )}
            </div>

            <div className="field">
              <label>
                Provenance
                <HelpTooltip
                  text="Who own the dataset?"
                  id="tooltip-provenance-addfile"
                />
              </label>
              <input
                type="text"
                value={provenance}
                onChange={(e) =>
                  validateAndFilterSpecialChars(e.target.value, setProvenance, setProvenanceError, 125)
                }
                disabled={submitting}
              />
              {provenanceError && (
                <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                  no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                </span>
              )}
            </div>

            <div className="field">
              <label>
                Source
                <HelpTooltip
                  text="Who gave you the dataset?"
                  id="tooltip-source-addfile"
                />
              </label>
              <input
                type="text"
                value={source}
                onChange={(e) =>
                  validateAndFilterSpecialChars(e.target.value, setSource, setSourceError, 1000)
                }
                disabled={submitting}
              />
              {sourceError && (
                <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                  no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
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
                  id="tooltip-permissions-addfile"
                />
              </label>
              <select
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

            <div className="field">
              <label>
                Cite As
                <HelpTooltip
                  text="How should someone give credit for the data?"
                  id="tooltip-cite-as-addfile"
                />
              </label>
              <textarea
                rows={4}
                value={citeAs}
                onChange={(e) =>
                  validateAndFilterSpecialChars(e.target.value, setCiteAs, setCiteAsError, 1500)
                }
                disabled={submitting}
              />
              {citeAsError && (
                <span style={{ color: "var(--red, #c62828)", fontSize: 13 }}>
                  no special characters &lt; , &gt; , " , ' , &amp; , ; , ( , )
                </span>
              )}
            </div>

            <div className="field">
              <label>
                Groundtruthed
                <HelpTooltip
                  text="Has this data been validated in the field?"
                  id="tooltip-groundtruthed-addfile"
                />
              </label>
              <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="radio"
                    name="groundtruthed-addfile"
                    id="gt_no_addfile"
                    checked={!groundtruthed}
                    onChange={() => setGroundtruthed(false)}
                    disabled={submitting}
                  />
                  No
                </label>
                <label className="check" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="radio"
                    name="groundtruthed-addfile"
                    id="gt_yes_addfile"
                    checked={groundtruthed}
                    onChange={() => setGroundtruthed(true)}
                    disabled={submitting}
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
                  id="tooltip-duration-addfile"
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
                disabled={submitting}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label>
                  Temporal Coverage From
                  <HelpTooltip
                    text="Start date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                    id="tooltip-temporal-from-addfile"
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
                  disabled={submitting}
                />
              </div>

              <div className="field">
                <label>
                  Temporal Coverage To
                  <HelpTooltip
                    text="End date of temporal coverage (ISO format: YYYY-MM-DDTHH:mm:ssZ)"
                    id="tooltip-temporal-to-addfile"
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
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="field">
              <label>
                Geographical Extent
                <HelpTooltip
                  text="Geographic coverage or location information"
                  id="tooltip-geography-addfile"
                />
              </label>
              <textarea
                rows={3}
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                disabled={submitting}
              />
            </div>

            {submitting && (
              <div className="field">
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

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Uploading…" : "Upload"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default AddFile;
