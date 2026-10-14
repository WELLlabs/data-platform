import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  add_files_url_endpoint,
  create_upload_job_endpoint,
  complete_upload_job_endpoint,
} from "../api/endpoints";
import { requestAndUploadFile } from "../api/s3Upload";
import FileAccordionList from "../components/FileAccordionList";
import { splitFilename, storedFilename } from "../utils/filenames";

const INVALID_CHARS = /[<>"'&;()]/;
const INVALID_CHARS_G = /[<>"'&;()]/g;

function AddFile() {
  const navigate = useNavigate();
  const { user, verifyUser } = useAuth();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [partialNote, setPartialNote] = useState("");
  const [files, setFiles] = useState([]);
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const datasetId = searchParams.get("dataset_id");

  useEffect(() => {
    const init = async () => {
      try {
        if (!datasetId) {
          navigate("/datasets");
          return;
        }
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

  const constrained = (v, max) => (v || "").slice(0, max);

  const toFileEntry = (f) => {
    const { basename, extension } = splitFilename(f.name);
    const nameWithExt = (storedFilename(basename, extension) || f.name).replace(
      INVALID_CHARS_G,
      ""
    );
    return {
      key: `${f.name}-${f.size}-${f.lastModified}`,
      file: f,
      basename: basename.slice(0, 180),
      extension: extension.slice(0, 20),
      title: nameWithExt.slice(0, 200),
      description: "",
      format: extension.replace(INVALID_CHARS_G, "").slice(0, 20),
      provenance: "",
      source: "",
      permissions: "CC0: Public Domain",
      citeAs: "",
      groundtruthed: "no",
      temporalFrom: "",
      temporalTo: "",
      duration: 0,
      geography: "",
      errors: {},
      status: "",
      statusMessage: "",
    };
  };

  const handleFileChange = (e) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (!picked.length) return;
    const incoming = picked.map((f) => toFileEntry(f));
    setFiles((prev) => {
      const next = [...prev];
      incoming.forEach((entry) => {
        if (!next.some((x) => x.key === entry.key)) next.push(entry);
      });
      return next;
    });
    setOpenKeys((prev) => {
      const next = new Set(prev);
      incoming.forEach((entry) => next.add(entry.key));
      return next;
    });
    e.target.value = "";
  };

  const updateFileEntry = (key, field, value) => {
    setFiles((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

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
    setOpenKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const toggleOpen = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setFileStatus = (key, status, statusMessage = "") => {
    setFiles((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, status, statusMessage } : item
      )
    );
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setPartialNote("");

    if (!user) {
      navigate("/signin");
      return;
    }
    if (!files.length) {
      setError("Please select at least one file.");
      return;
    }
    const invalid = files.filter(
      (item) =>
        !item.title.trim() ||
        !storedFilename(item.basename, item.extension) ||
        (item.temporalFrom && item.temporalTo && item.temporalFrom > item.temporalTo)
    );
    if (invalid.length) {
      setOpenKeys((prev) => {
        const next = new Set(prev);
        invalid.forEach((item) => next.add(item.key));
        return next;
      });
      setError("Each file needs a name, a title, and a valid date range.");
      return;
    }
    if (!datasetId) {
      setError("Dataset ID is missing.");
      return;
    }

    try {
      setSubmitting(true);
      setProgress(0);

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
      let staged = 0;
      const failures = [];

      for (const item of files) {
        const priorBytes = uploadedBytes;
        setFileStatus(item.key, "uploading");
        try {
          const { fileId } = await requestAndUploadFile({
            jobId,
            file: item.file,
            filename: storedFilename(item.basename, item.extension),
            onProgress: (pct) => {
              const current = (item.file.size || 0) * (pct / 100);
              const overall = totalBytes
                ? Math.round(((priorBytes + current) / totalBytes) * 100)
                : pct;
              setProgress(Math.min(99, overall));
            },
          });

          const form = new FormData();
          form.append("job_id", jobId);
          form.append("file_id", fileId);
          form.append(
            "file_title",
            constrained(storedFilename(item.basename, item.extension) || item.title, 200)
          );
          form.append("file_description", constrained(item.description, 1000));
          form.append("file_format", constrained(item.format, 20));
          form.append("dataset_id", datasetId);
          form.append("provenance", constrained(item.provenance, 125));
          form.append("source", constrained(item.source, 1000));
          form.append("cite_as", constrained(item.citeAs, 1500));
          if (item.groundtruthed === "yes") form.append("groundtruthed", "true");
          form.append("permissions", constrained(item.permissions, 1000));
          form.append("duration", String(item.duration || 0));
          if (item.temporalFrom) form.append("temporal_from", item.temporalFrom);
          if (item.temporalTo) form.append("temporal_to", item.temporalTo);
          if (item.geography) form.append("geography", constrained(item.geography, 2000));

          const addFileResp = await fetch(add_files_url_endpoint, {
            method: "POST",
            body: form,
            credentials: "include",
          });
          if (!addFileResp.ok) {
            const txt = await addFileResp.text();
            throw new Error(txt || "Failed to add file");
          }
          staged += 1;
          setFileStatus(item.key, "ok");
        } catch (err) {
          const message = err.message || "Upload failed";
          failures.push(`${item.file.name}: ${message}`);
          setFileStatus(item.key, "error", message);
        }
        uploadedBytes += item.file.size || 0;
      }

      if (!staged) {
        setError(
          failures.length
            ? `No files were added. ${failures.join(" ")}`
            : "No files were added."
        );
        setProgress(0);
        return;
      }

      const completeJobResp = await fetch(
        `${complete_upload_job_endpoint}?job_id=${encodeURIComponent(jobId)}`,
        { method: "POST", credentials: "include" }
      );
      if (!completeJobResp.ok) {
        const txt = await completeJobResp.text();
        throw new Error(`Failed to complete upload job: ${txt}`);
      }

      setSuccess(true);
      setProgress(100);
      if (failures.length) {
        setPartialNote(
          `${staged} file${staged === 1 ? "" : "s"} added. These were not: ${failures.join(" ")}`
        );
      }
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
        <div className="wrap" style={{ maxWidth: 860, padding: "48px 0 88px" }}>
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 860, padding: "48px 0 88px" }}>
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
            <p className="auth-sub">
              {partialNote || "File successfully added to the dataset."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/dataset-info?dataset_id=${datasetId}`)}
              >
                Dataset
              </button>
              <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>
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
                aria-label="Add files"
              />
            </div>

            <FileAccordionList
              files={files}
              openKeys={openKeys}
              onToggle={toggleOpen}
              onRemove={removeFileEntry}
              onText={updateFileText}
              onField={updateFileEntry}
              disabled={submitting}
            />

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

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Uploading…" : "Upload"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default AddFile;
