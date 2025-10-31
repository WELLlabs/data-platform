import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { dataset_info_endpoint } from "../api/endpoints";

function DatasetInfo() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState(null);
  const [files, setFiles] = useState([]);

  useEffect(() => {
    const datasetId = searchParams.get("dataset_id");
    
    if (!datasetId) {
      navigate("/datasets");
      return;
    }

    const fetchDatasetInfo = async () => {
      try {
        setLoading(true);
        setError("");
        
        const response = await fetch(
          `${dataset_info_endpoint}?dataset_id=${encodeURIComponent(datasetId)}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Dataset not found");
          }
          throw new Error(`Failed to fetch dataset: ${response.statusText}`);
        }

        const data = await response.json();
        setDataset(data.dataset);
        setFiles(data.files || []);
      } catch (err) {
        console.error("Error fetching dataset info:", err);
        setError(err.message || "Error loading dataset information");
      } finally {
        setLoading(false);
      }
    };

    fetchDatasetInfo();
  }, [searchParams, navigate]);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  if (error) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="container py-5">
        <div className="alert alert-warning" role="alert">
          No dataset information available.
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <h2 className="mb-4">Dataset Information</h2>

      <div className="card mb-4">
        <div className="card-body">
          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Title:</strong>
            </div>
            <div className="col-md-9">{dataset.dataset_title || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Description:</strong>
            </div>
            <div className="col-md-9">{dataset.dataset_description || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Creator:</strong>
            </div>
            <div className="col-md-9">{dataset.creator || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Created At:</strong>
            </div>
            <div className="col-md-9">{formatDate(dataset.created_at)}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Organization:</strong>
            </div>
            <div className="col-md-9">{dataset.organization || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Groundtruthed:</strong>
            </div>
            <div className="col-md-9">
              {dataset.groundtruthed === true
                ? "Yes"
                : dataset.groundtruthed === false
                ? "No"
                : "N/A"}
            </div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Author:</strong>
            </div>
            <div className="col-md-9">{dataset.author || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Source URL:</strong>
            </div>
            <div className="col-md-9">
              {dataset.source_url ? (
                <a
                  href={dataset.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {dataset.source_url}
                </a>
              ) : (
                "N/A"
              )}
            </div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Cite As:</strong>
            </div>
            <div className="col-md-9">{dataset.cite_as || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Tags:</strong>
            </div>
            <div className="col-md-9">{dataset.tags || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Total Downloads:</strong>
            </div>
            <div className="col-md-9">{dataset.downloads ?? "N/A"}</div>
          </div>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="mb-0">Files</h3>
        <button
          className="btn"
          style={{ backgroundColor: "#1b75e0", color: "#fff" }}
          onClick={() => {
            // Placeholder for add file functionality
            console.log("Add file clicked");
          }}
        >
          <i className="bi bi-plus"></i> Add file
        </button>
      </div>

      {files.length === 0 ? (
        <div className="alert alert-info" role="alert">
          No files associated with this dataset.
        </div>
      ) : (
        <div className="row">
          {files.map((file) => (
            <div key={file.file_id} className="col-md-6 col-lg-4 mb-4">
              <div className="card h-100">
                <div className="card-body">
                  <h5 className="card-title">{file.file_title || "N/A"}</h5>
                  <p className="card-text">
                    <small className="text-muted">
                      <strong>Description:</strong> {file.file_description || "N/A"}
                    </small>
                  </p>
                  <div className="mb-2">
                    <small className="text-muted">
                      <strong>Size:</strong> {formatFileSize(file.file_size)}
                    </small>
                  </div>
                  <div className="mb-2">
                    <small className="text-muted">
                      <strong>Format:</strong> {file.file_format || "N/A"}
                    </small>
                  </div>
                  <div className="mb-2">
                    <small className="text-muted">
                      <strong>Created At:</strong> {formatDate(file.created_at)}
                    </small>
                  </div>
                  <div className="mb-3">
                    <small className="text-muted">
                      <strong>Downloads:</strong> {file.downloads ?? "N/A"}
                    </small>
                  </div>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => {
                      // Placeholder for download functionality
                      console.log("Download file:", file.file_id);
                    }}
                  >
                    <i className="bi bi-arrow-down"></i>
                    download
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DatasetInfo;

