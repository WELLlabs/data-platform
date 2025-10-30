import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  upload_url_endpoint,
  create_dataset_endpoint,
  organization_by_id_endpoint,
} from "../api/endpoints";

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
  const [author, setAuthor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [citeAs, setCiteAs] = useState("");
  const [groundtruthed, setGroundtruthed] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

  const [file, setFile] = useState(null);
  const [fileTitle, setFileTitle] = useState("");
  const [fileDescription, setFileDescription] = useState("");
  const [fileFormat, setFileFormat] = useState("");

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
        `${upload_url_endpoint}?filename=${encodeURIComponent(filenameOnly)}`,
        { credentials: "include" }
      );
      if (!uploadResp.ok) {
        const txt = await uploadResp.text();
        throw new Error(`Failed to get upload URL: ${txt}`);
      }
      const uploadData = await uploadResp.json();
      const uploadUrl = uploadData.upload_url || uploadData.url || uploadData.uploadUrl;
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
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      // 3) Call create_dataset endpoint with FormData
      const userId = user.id;
      const organizationId = user.organization;
      const fileKey = `${userId}/${filenameOnly}`;

      const form = new FormData();
      form.append("title", constrained(title, 200));
      form.append("creator", userId);
      form.append("dataset_description", constrained(datasetDescription, 2000));
      form.append("tags", constrained(tags, 500));
      form.append("organization", organizationId);
      form.append("author", constrained(author, 125));
      form.append("source_url", constrained(sourceUrl, 1000));
      form.append("cite_as", constrained(citeAs, 1500));
      if (groundtruthed) form.append("groundtruthed", "true");
      form.append("private", orgPrivate && isPrivate ? "true" : "false");

      form.append("filename", constrained(filenameOnly, 200));
      form.append("file_key", fileKey);
      form.append("file_description", constrained(fileDescription, 1000));
      form.append("file_format", constrained(fileFormat, 20));

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

      // 4) Redirect to dataset-success with response as query parameter
      const payload = encodeURIComponent(JSON.stringify(result));
      navigate(`/dataset-success?data=${payload}`);
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
      <h2 className="mb-4">create a dataset</h2>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="form-label">Dataset title</label>
          <input
            type="text"
            className="form-control"
            value={title}
            onChange={(e) => setTitle((e.target.value || "").slice(0, 200))}
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Dataset description</label>
          <textarea
            className="form-control"
            rows={4}
            value={datasetDescription}
            onChange={(e) => setDatasetDescription((e.target.value || "").slice(0, 2000))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Tags</label>
          <input
            type="text"
            className="form-control"
            value={tags}
            onChange={(e) => setTags((e.target.value || "").slice(0, 500))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Author</label>
          <input
            type="text"
            className="form-control"
            value={author}
            onChange={(e) => setAuthor((e.target.value || "").slice(0, 125))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Source URL</label>
          <input
            type="text"
            className="form-control"
            value={sourceUrl}
            onChange={(e) => setSourceUrl((e.target.value || "").slice(0, 1000))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Cite as</label>
          <input
            type="text"
            className="form-control"
            value={citeAs}
            onChange={(e) => setCiteAs((e.target.value || "").slice(0, 1500))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label me-3">Groundtruthed</label>
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
              <label className="form-check-label" htmlFor="gt_yes">
                Yes
              </label>
            </div>
          </div>
        </div>

        {orgPrivate && (
          <div className="mb-3">
            <label className="form-label me-3">Private</label>
            <div>
              <div className="form-check form-check-inline">
                <input
                  className="form-check-input"
                  type="radio"
                  name="private"
                  id="pr_no"
                  checked={!isPrivate}
                  onChange={() => setIsPrivate(false)}
                />
                <label className="form-check-label" htmlFor="pr_no">
                  No
                </label>
              </div>
              <div className="form-check form-check-inline">
                <input
                  className="form-check-input"
                  type="radio"
                  name="private"
                  id="pr_yes"
                  checked={isPrivate}
                  onChange={() => setIsPrivate(true)}
                />
                <label className="form-check-label" htmlFor="pr_yes">
                  Yes
                </label>
              </div>
            </div>
          </div>
        )}

        <h5 className="mt-4">File upload</h5>

        <div className="mb-3">
          <label className="form-label">File</label>
          <input
            type="file"
            className="form-control"
            onChange={handleFileChange}
            accept="*/*"
          />
        </div>

        <div className="mb-3">
          <label className="form-label">File title</label>
          <input
            type="text"
            className="form-control"
            value={fileTitle}
            onChange={(e) => setFileTitle((e.target.value || "").slice(0, 200))}
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label">File description</label>
          <textarea
            className="form-control"
            rows={3}
            value={fileDescription}
            onChange={(e) => setFileDescription((e.target.value || "").slice(0, 1000))}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">File format</label>
          <input
            type="text"
            className="form-control"
            value={fileFormat}
            onChange={(e) => setFileFormat((e.target.value || "").slice(0, 20))}
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

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}

export default CreateDataset;


