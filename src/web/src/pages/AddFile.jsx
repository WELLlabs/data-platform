import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { upload_url_endpoint, add_files_url_endpoint } from "../api/endpoints";

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
      setFileTitle(f.name.slice(0, 200));
    }
    if (f && !fileFormat) {
      const parts = f.name.split(".");
      if (parts.length > 1) setFileFormat(parts.pop().slice(0, 20));
    }
  };

  const constrained = (v, max) => (v || "").slice(0, max);

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
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream"
        );
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
                  className="form-control"
                  id="fileTitle"
                  value={fileTitle}
                  onChange={(e) =>
                    setFileTitle(constrained(e.target.value, 200))
                  }
                  required
                  maxLength={200}
                  disabled={submitting}
                />
              </div>

              <div className="mb-3">
                <label htmlFor="fileDescription" className="form-label">
                  Description
                </label>
                <textarea
                  className="form-control"
                  id="fileDescription"
                  rows="3"
                  value={fileDescription}
                  onChange={(e) =>
                    setFileDescription(constrained(e.target.value, 1000))
                  }
                  maxLength={1000}
                  disabled={submitting}
                />
              </div>

              <div className="mb-3">
                <label htmlFor="fileFormat" className="form-label">
                  Format
                </label>
                <input
                  type="text"
                  className="form-control"
                  id="fileFormat"
                  value={fileFormat}
                  onChange={(e) =>
                    setFileFormat(constrained(e.target.value, 20))
                  }
                  maxLength={20}
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

