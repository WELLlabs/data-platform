import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  add_files_url_endpoint,
  create_upload_job_endpoint,
  complete_upload_job_endpoint,
  dataset_info_endpoint,
} from "../api/endpoints";
import { requestAndUploadFile } from "../api/s3Upload";
import { findExistingFiles } from "../api/fileCheck";
import FileAccordionList from "../components/FileAccordionList";
import Ic from "../components/wd/Icons";
import { splitFilename, storedFilename } from "../utils/filenames";

const INVALID_CHARS = /[<>"'&;()]/;
const INVALID_CHARS_G = /[<>"'&;()]/g;

function fmtBytes(n) {
  if (!n) return "0 KB";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
  const [dragging, setDragging] = useState(false);
  const [datasetTitle, setDatasetTitle] = useState("");

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
        try {
          const params = new URLSearchParams({ dataset_id: datasetId });
          const resp = await fetch(`${dataset_info_endpoint}?${params.toString()}`, {
            credentials: "include",
          });
          if (resp && resp.ok) {
            const data = await resp.json();
            if (data?.dataset?.dataset_title) setDatasetTitle(data.dataset.dataset_title);
          }
        } catch {
          // The title is only for context; the page still works without it.
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

  const addFiles = (picked) => {
    if (!picked.length) return;
    setError("");
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
    findExistingFiles(incoming).then((found) => {
      if (!found.size) return;
      setFiles((prev) =>
        prev.map((item) =>
          found.has(item.key) ? { ...item, conflict: found.get(item.key) } : item
        )
      );
    });
  };

  const handleFileChange = (e) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    addFiles(picked);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (submitting) return;
    const picked = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    addFiles(picked);
  };

  const resetForm = () => {
    setFiles([]);
    setOpenKeys(new Set());
    setSuccess(false);
    setPartialNote("");
    setError("");
    setProgress(0);
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
    if (files.some((item) => item.conflict)) {
      setError(
        "Some files are already uploaded in other datasets. Remove them before uploading."
      );
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
          if (err.status === 409 && err.conflict) {
            setFiles((prev) =>
              prev.map((x) => (x.key === item.key ? { ...x, conflict: err.conflict } : x))
            );
          }
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
        <div className="wrap ds-form" style={{ padding: "48px 0 88px" }}>
          <div className="empty"><p>Loading…</p></div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const datasetLabel = datasetTitle || "this dataset";
  const totalSize = files.reduce((sum, item) => sum + (item.file?.size || 0), 0);
  const goToDataset = () => navigate(`/dataset-info?dataset_id=${datasetId}`);

  if (success) {
    return (
      <div className="page">
        <div className="wrap" style={{ maxWidth: 560, padding: "72px 0 88px" }}>
          <div className="auth-card" style={{ textAlign: "center" }}>
            <div className={"af-done-ic" + (partialNote ? " warn" : "")}>
              <Ic name={partialNote ? "warn" : "check"} size={26} sw={2.4} />
            </div>
            <span className="eyebrow">Datasets</span>
            <h1 className="display" style={{ marginTop: 6 }}>
              {partialNote ? "Some files were added" : "Files added"}
            </h1>
            <p className="auth-sub" style={{ maxWidth: "46ch", margin: "8px auto 0" }}>
              {partialNote ||
                `Your files were uploaded to ${datasetLabel}. They are being processed and will appear in the dataset shortly.`}
            </p>
            <div className="af-done-actions">
              <button type="button" className="btn btn-primary" onClick={goToDataset}>
                Back to dataset
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Add more files
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap ds-form" style={{ padding: "36px 0 88px" }}>
        <button type="button" className="back-link" onClick={goToDataset}>
          <Ic name="chevLeft" size={15} sw={2} />
          <span>Back to {datasetTitle || "dataset"}</span>
        </button>

        <div className="section-head" style={{ marginTop: 14 }}>
          <div>
            <span className="eyebrow">Datasets</span>
            <h2 className="section-title" style={{ marginTop: 6 }}>
              Add files
            </h2>
            <p className="muted" style={{ marginTop: 6, maxWidth: "70ch" }}>
              Upload new files to{" "}
              {datasetTitle ? <b className="af-ds-name">{datasetTitle}</b> : "this dataset"}.
              Every file keeps its own attribution and coverage, so open each one
              below to record where it came from and what it covers.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 22 }}>
          <div className="form-section">
            <div className="fs-head">
              <div>
                <h3>Files &amp; attribution</h3>
                <p>Only the file itself is required. All other details are optional.</p>
              </div>
              {files.length > 0 && (
                <span className="af-count">
                  {files.length} {files.length === 1 ? "file" : "files"} · {fmtBytes(totalSize)}
                </span>
              )}
            </div>

            {error && (
              <div className="form-note err" role="alert">
                <span>{error}</span>
              </div>
            )}

            <FileAccordionList
              files={files}
              openKeys={openKeys}
              onToggle={toggleOpen}
              onRemove={removeFileEntry}
              onText={updateFileText}
              onField={updateFileEntry}
              disabled={submitting}
            />

            <div
              className={
                "file-drop af-drop" +
                (files.length ? "" : " lg") +
                (dragging ? " drag" : "") +
                (submitting ? " is-disabled" : "")
              }
              onDragOver={(e) => {
                e.preventDefault();
                if (!submitting) setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <span className="fdic">
                <Ic name="dl" size={files.length ? 18 : 22} sw={2} />
              </span>
              <div className="fdmain">
                <b>
                  {dragging
                    ? "Drop files to add them"
                    : files.length
                    ? "Add another file"
                    : "Drag files here, or click to browse"}
                </b>
                <span>
                  {files.length
                    ? "Drop it here or browse. Its attribution starts blank."
                    : "Any format. You can select several files at once."}
                </span>
              </div>
              <span className="af-browse" aria-hidden="true">
                Browse files
              </span>
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
          </div>

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
                  {files.length
                    ? `${files.length} ${files.length === 1 ? "file" : "files"} ready to upload`
                    : "No files selected yet"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={goToDataset}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !files.length}
              >
                {submitting
                  ? "Uploading…"
                  : files.length > 1
                  ? `Upload ${files.length} files`
                  : "Upload file"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddFile;
