import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { dataset_info_endpoint, download_url_endpoint } from "../api/endpoints";

function DatasetInfo() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState(null);
  const [files, setFiles] = useState([]);
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  const [downloadError, setDownloadError] = useState("");

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

  const handleDownload = async (file) => {
    // Validate required file properties
    if (!file || !file.file_id || !file.file_key) {
      setDownloadError("Invalid file information. Cannot download.");
      console.error("Download failed: Missing file_id or file_key", file);
      return;
    }

    // Clear any previous download errors
    setDownloadError("");
    setDownloadingFileId(file.file_id);

    try {
      // Build the download URL with query parameters
      const params = new URLSearchParams({
        file_key: file.file_key,
        file_id: file.file_id,
      });
      const downloadUrl = `${download_url_endpoint}?${params.toString()}`;

      // Fetch the presigned download URL
      const response = await fetch(downloadUrl, {
        method: "GET",
        credentials: "include",
      });

      // Handle HTTP errors
      if (!response.ok) {
        let errorMessage = "Failed to get download URL";

        // Try to parse error response
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }

        // Provide specific error messages based on status code
        switch (response.status) {
          case 400:
            errorMessage = "Invalid file information. Please try again.";
            break;
          case 404:
            errorMessage = "File not found. It may have been deleted.";
            break;
          case 500:
            errorMessage = "Server error. Please try again later.";
            break;
          case 502:
            errorMessage = "Service temporarily unavailable. Please try again later.";
            break;
          case 504:
            errorMessage = "Request timeout. Please try again.";
            break;
          default:
            errorMessage = `Error ${response.status}: ${errorMessage}`;
        }

        throw new Error(errorMessage);
      }

      // Parse the response
      let responseData;
      try {
        responseData = await response.json();
      } catch (parseError) {
        console.error("Error parsing download URL response:", parseError);
        throw new Error("Invalid response from server. Please try again.");
      }

      // Validate response structure
      if (!responseData || !responseData.download_url) {
        console.error("Invalid response structure:", responseData);
        throw new Error(
          "Download URL not found in response. Please try again."
        );
      }

      // Validate download_url is a string and not empty
      if (
        typeof responseData.download_url !== "string" ||
        !responseData.download_url.trim()
      ) {
        console.error("Invalid download_url value:", responseData.download_url);
        throw new Error("Invalid download URL received. Please try again.");
      }

      // Open the download URL in a new tab
      try {
        window.open(responseData.download_url, "_blank", "noopener,noreferrer");
      } catch (openError) {
        console.error("Error opening download URL:", openError);
        throw new Error(
          "Failed to open download link. Your browser may be blocking pop-ups."
        );
      }

      // Success - clear any errors
      setDownloadError("");
    } catch (err) {
      // Handle all types of errors
      console.error("Download error:", err);

      let errorMessage = "Failed to download file. Please try again.";

      if (err instanceof TypeError && err.message.includes("fetch")) {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (err.message) {
        errorMessage = err.message;
      }

      setDownloadError(errorMessage);

      // Clear error after 5 seconds
      setTimeout(() => {
        setDownloadError("");
      }, 5000);
    } finally {
      // Clear downloading state
      setDownloadingFileId(null);
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
              <strong>Provenance:</strong>
            </div>
            <div className="col-md-9">{dataset.provenance || "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Source:</strong>
            </div>
            <div className="col-md-9">{dataset.source || "N/A"}</div>
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

          {dataset.permissions && (
            <div className="row mb-3">
              <div className="col-md-3">
                <strong>Permissions:</strong>
              </div>
              <div className="col-md-9">{dataset.permissions}</div>
            </div>
          )}

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Duration (years):</strong>
            </div>
            <div className="col-md-9">{dataset.duration ?? 0}</div>
          </div>

          {dataset.value && (
            <div className="row mb-3">
              <div className="col-md-3">
                <strong>Value:</strong>
              </div>
              <div className="col-md-9">{dataset.value}</div>
            </div>
          )}

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Approved:</strong>
            </div>
            <div className="col-md-9">
              {dataset.approved ? (
                <span className="badge bg-success">Yes</span>
              ) : (
                <span className="badge bg-warning">No</span>
              )}
            </div>
          </div>

          {dataset.approved_by && (
            <div className="row mb-3">
              <div className="col-md-3">
                <strong>Approved By:</strong>
              </div>
              <div className="col-md-9">{dataset.approved_by}</div>
            </div>
          )}
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="mb-0">Files</h3>
        <button
          className="btn"
          style={{ backgroundColor: "#1b75e0", color: "#fff" }}
          onClick={() => {
            const datasetId = searchParams.get("dataset_id");
            if (datasetId) {
              navigate(`/add-file?dataset_id=${datasetId}`);
            }
          }}
        >
          <i className="bi bi-plus"></i> Add file
        </button>
      </div>

      {downloadError && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {downloadError}
          <button
            type="button"
            className="btn-close"
            onClick={() => setDownloadError("")}
            aria-label="Close"
          ></button>
        </div>
      )}

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
                    onClick={() => handleDownload(file)}
                    disabled={downloadingFileId === file.file_id}
                  >
                    {downloadingFileId === file.file_id ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        ></span>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-arrow-down"></i> download
                      </>
                    )}
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

