import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  approve_dataset_endpoint,
  dataset_info_endpoint,
  download_url_endpoint,
  delete_dataset_endpoint,
  delete_file_endpoint,
  edit_dataset_endpoint,
  edit_file_endpoint,
  organization_by_id_endpoint,
  transfer_dataset_endpoint,
} from "../api/endpoints";

const initialDatasetEdit = {
  showModal: false,
  title: "",
  description: "",
  isPrivate: false,
  tags: "",
  error: "",
  submitting: false,
};

function datasetEditReducer(state, action) {
  switch (action.type) {
    case "OPEN":
      return {
        ...state,
        showModal: true,
        title: action.payload.title ?? "",
        description: action.payload.description ?? "",
        isPrivate: action.payload.isPrivate ?? false,
        tags: action.payload.tags ?? "",
        error: "",
      };
    case "CLOSE":
      return { ...state, showModal: false };
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_SUBMITTING":
      return { ...state, submitting: action.submitting };
    default:
      return state;
  }
}

const initialFileEdit = {
  showModal: false,
  file: null,
  title: "",
  description: "",
  provenance: "",
  source: "",
  citeAs: "",
  groundtruthed: false,
  permissions: "CC0: Public Domain",
  duration: 0,
  value: "low",
  temporalFrom: "",
  temporalTo: "",
  geography: "",
  error: "",
  submitting: false,
};

function fileEditReducer(state, action) {
  switch (action.type) {
    case "OPEN":
      return {
        ...initialFileEdit,
        showModal: true,
        file: action.payload.file,
        title: action.payload.title ?? "",
        description: action.payload.description ?? "",
        provenance: action.payload.provenance ?? "",
        source: action.payload.source ?? "",
        citeAs: action.payload.citeAs ?? "",
        groundtruthed: action.payload.groundtruthed ?? false,
        permissions: action.payload.permissions ?? "CC0: Public Domain",
        duration: action.payload.duration ?? 0,
        value: action.payload.value ?? "low",
        temporalFrom: action.payload.temporalFrom ?? "",
        temporalTo: action.payload.temporalTo ?? "",
        geography: action.payload.geography ?? "",
      };
    case "CLOSE":
      return { ...state, showModal: false, file: null };
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_SUBMITTING":
      return { ...state, submitting: action.submitting };
    default:
      return state;
  }
}

function DatasetInfo() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState(null);
  const [files, setFiles] = useState([]);
  const [privileges, setPrivileges] = useState({
    edit: false,
    delete_dataset: false,
    delete_file: false,
    add_file: false,
    approval: false,
    transfer: false,
  });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferMembers, setTransferMembers] = useState([]);
  const [transferSelectedUserId, setTransferSelectedUserId] = useState("");
  const [transferFetchError, setTransferFetchError] = useState("");
  const [transferLoadingOrg, setTransferLoadingOrg] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const [showDatasetDeleteModal, setShowDatasetDeleteModal] = useState(false);
  const [showFileDeleteModal, setShowFileDeleteModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deletingDataset, setDeletingDataset] = useState(false);
  const [approvingDataset, setApprovingDataset] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  // Dataset edit modal state
  const [datasetEdit, dispatchDatasetEdit] = useReducer(
    datasetEditReducer,
    initialDatasetEdit
  );
  const showDatasetEditModal = datasetEdit.showModal;
  const editDatasetModalRef = useRef(null);
  const editDatasetTitleInputRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const transferModalDialogRef = useRef(null);
  const transferMemberSelectRef = useRef(null);
  const transferPreviousActiveElementRef = useRef(null);

  // File edit modal state
  const [fileEdit, dispatchFileEdit] = useReducer(
    fileEditReducer,
    initialFileEdit
  );
  const showFileEditModal = fileEdit.showModal;
  const fileToEdit = fileEdit.file;

  const fetchDatasetInfo = useCallback(async () => {
    const datasetId = searchParams.get("dataset_id");
    if (!datasetId) {
      navigate("/datasets");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ dataset_id: datasetId });
      if (user?.apikey) params.set("apikey", user.apikey);
      const response = await fetch(
        `${dataset_info_endpoint}?${params.toString()}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        if (response.status === 403) {
          let msg = "Private dataset, Access permission is not granted.";
          try {
            const body = await response.json();
            if (body?.detail) msg = body.detail;
          } catch {
            // use default msg
          }
          setError(msg);
          return;
        }
        if (response.status === 404) {
          setError("Dataset not found");
          return;
        }
        setError(`Failed to fetch dataset: ${response.statusText}`);
        return;
      }
      const data = await response.json();
      setDataset(data.dataset);
      setFiles(data.files || []);
      setPrivileges(
        data.privileges ?? {
          edit: false,
          delete_dataset: false,
          delete_file: false,
          add_file: false,
          approval: false,
          transfer: false,
        }
      );
    } catch (err) {
      console.error("Error fetching dataset info:", err);
      setError(err.message || "Error loading dataset information");
    } finally {
      setLoading(false);
    }
  }, [searchParams, navigate, user?.apikey]);

  useEffect(() => {
    fetchDatasetInfo();
  }, [fetchDatasetInfo]);

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

  const formatToDatetimeLocal = (value) => {
    if (value == null || value === "") return "";
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return "";
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const h = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${d}T${h}:${min}`;
    } catch {
      return "";
    }
  };

  const handleDownload = async (file) => {
    // Validate required file properties
    if (!file || !file.file_id) {
      setDownloadError("Invalid file information. Cannot download.");
      console.error("Download failed: Missing file_id", file);
      return;
    }

    // Clear any previous download errors
    setDownloadError("");
    setDownloadingFileId(file.file_id);

    try {
      // Build the download URL with query parameters (session cookie sent via credentials)
      const params = new URLSearchParams({
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
          case 403:
            errorMessage =
              errorMessage ||
              "Download permission is not granted. You may need to sign in or use a different account.";
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

  const handleDeleteDataset = async () => {
    if (!user?.apikey || !dataset?.dataset_id) {
      setDeleteError("Missing user authentication or dataset information.");
      return;
    }

    setDeletingDataset(true);
    setDeleteError("");

    try {
      const params = new URLSearchParams({
        dataset_id: dataset.dataset_id,
        apikey: user.apikey,
      });

      const response = await fetch(
        `${delete_dataset_endpoint}?${params.toString()}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to delete dataset";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // Success - redirect to dashboard
      navigate("/dashboard");
    } catch (err) {
      console.error("Error deleting dataset:", err);
      setDeleteError(err.message || "Failed to delete dataset. Please try again.");
      setTimeout(() => {
        setDeleteError("");
      }, 5000);
    } finally {
      setDeletingDataset(false);
      setShowDatasetDeleteModal(false);
    }
  };

  const handleApproveDataset = async () => {
    if (!dataset?.dataset_id) {
      setDeleteError("Missing dataset information.");
      return;
    }

    const isConfirmed = window.confirm(
      "Are you sure you want to approve this dataset?"
    );
    if (!isConfirmed) return;

    setApprovingDataset(true);
    setDeleteError("");

    try {
      const response = await fetch(approve_dataset_endpoint(dataset.dataset_id), {
        method: "PUT",
        credentials: "include",
      });

      if (!response.ok) {
        let errorMessage = "Failed to approve dataset";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      window.location.reload();
    } catch (err) {
      console.error("Error approving dataset:", err);
      setDeleteError(err.message || "Failed to approve dataset. Please try again.");
      setTimeout(() => {
        setDeleteError("");
      }, 5000);
    } finally {
      setApprovingDataset(false);
    }
  };

  const roleLabelForTransfer = (role) => {
    if (role === 0) return "Member";
    if (role === 1) return "Admin";
    if (role === 2) return "Reviewer";
    return "Member";
  };

  const handleOpenTransferModal = async () => {
    if (!dataset?.organization) {
      setDeleteError("Missing organization for this dataset.");
      return;
    }
    setShowTransferModal(true);
    setTransferMembers([]);
    setTransferSelectedUserId("");
    setTransferFetchError("");
    setTransferLoadingOrg(true);
    try {
      const params = new URLSearchParams();
      if (user?.apikey) params.set("apikey", user.apikey);
      const qs = params.toString();
      const base = organization_by_id_endpoint(dataset.organization);
      const url = qs ? `${base}?${qs}` : base;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        let msg = "Failed to load organization members.";
        try {
          const errBody = await response.json();
          if (errBody?.detail) msg = errBody.detail;
        } catch {
          msg = response.statusText || msg;
        }
        setTransferFetchError(msg);
        return;
      }
      const orgData = await response.json();
      const members = Array.isArray(orgData.members) ? orgData.members : [];
      setTransferMembers(members);
    } catch (err) {
      console.error("Error loading organization:", err);
      setTransferFetchError(err.message || "Failed to load organization members.");
    } finally {
      setTransferLoadingOrg(false);
    }
  };

  const handleCloseTransferModal = useCallback(() => {
    setShowTransferModal(false);
    setTransferMembers([]);
    setTransferSelectedUserId("");
    setTransferFetchError("");
  }, []);

  const handleSubmitTransfer = async () => {
    if (!dataset?.dataset_id || !transferSelectedUserId) {
      setTransferFetchError("Please select a member to transfer to.");
      return;
    }
    setTransferSubmitting(true);
    setTransferFetchError("");
    try {
      const params = new URLSearchParams({
        dataset_id: dataset.dataset_id,
        user_id: transferSelectedUserId,
      });
      const response = await fetch(
        `${transfer_dataset_endpoint}?${params.toString()}`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!response.ok) {
        let errorMessage = "Failed to transfer dataset.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      handleCloseTransferModal();
      await fetchDatasetInfo();
    } catch (err) {
      console.error("Error transferring dataset:", err);
      setTransferFetchError(err.message || "Transfer failed. Please try again.");
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!user?.apikey || !fileToDelete?.file_id) {
      setDeleteError("Missing user authentication or file information.");
      return;
    }

    setDeletingFileId(fileToDelete.file_id);
    setDeleteError("");

    try {
      const params = new URLSearchParams({
        file_id: fileToDelete.file_id,
        apikey: user.apikey,
      });

      const response = await fetch(
        `${delete_file_endpoint}?${params.toString()}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to delete file";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // Success - refresh the page
      window.location.reload();
    } catch (err) {
      console.error("Error deleting file:", err);
      setDeleteError(err.message || "Failed to delete file. Please try again.");
      setTimeout(() => {
        setDeleteError("");
      }, 5000);
    } finally {
      setDeletingFileId(null);
      setShowFileDeleteModal(false);
      setFileToDelete(null);
    }
  };

  const openFileDeleteModal = (file) => {
    setFileToDelete(file);
    setShowFileDeleteModal(true);
  };

  const openDatasetEditModal = () => {
    if (!dataset) return;
    dispatchDatasetEdit({
      type: "OPEN",
      payload: {
        title: dataset.dataset_title || "",
        description: dataset.dataset_description || "",
        isPrivate: Boolean(dataset.private),
        tags:
          dataset.tags && Array.isArray(dataset.tags)
            ? dataset.tags.join(", ")
            : "",
      },
    });
  };

  // Edit dataset modal: focus management and Escape/focus trap
  useEffect(() => {
    if (!showDatasetEditModal) return;
    previousActiveElementRef.current = document.activeElement;
    const timer = requestAnimationFrame(() => {
      editDatasetTitleInputRef.current?.focus();
    });
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dispatchDatasetEdit({ type: "CLOSE" });
        return;
      }
      if (e.key !== "Tab" || !editDatasetModalRef.current) return;
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = [
        ...editDatasetModalRef.current.querySelectorAll(focusableSelector),
      ].filter((el) => el.offsetParent !== null);
      const len = focusables.length;
      if (len === 0) return;
      const currentIndex = focusables.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          focusables[len - 1].focus();
        }
      } else {
        if (currentIndex === -1 || currentIndex >= len - 1) {
          e.preventDefault();
          focusables[0].focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElementRef.current?.focus?.();
    };
  }, [showDatasetEditModal]);

  // Transfer modal: focus management (select when ready, else close button)
  useEffect(() => {
    if (!showTransferModal) return;
    const timer = requestAnimationFrame(() => {
      const canFocusSelect =
        !transferLoadingOrg &&
        transferMembers.length > 0 &&
        transferMemberSelectRef.current;
      if (canFocusSelect) {
        transferMemberSelectRef.current?.focus();
      } else {
        const closeBtn =
          transferModalDialogRef.current?.querySelector(".btn-close");
        closeBtn?.focus();
      }
    });
    return () => cancelAnimationFrame(timer);
  }, [showTransferModal, transferLoadingOrg, transferMembers.length]);

  // Transfer modal: Escape + Tab focus trap (aligned with dataset edit modal)
  useEffect(() => {
    if (!showTransferModal) return;
    transferPreviousActiveElementRef.current = document.activeElement;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseTransferModal();
        return;
      }
      if (e.key !== "Tab" || !transferModalDialogRef.current) return;
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = [
        ...transferModalDialogRef.current.querySelectorAll(focusableSelector),
      ].filter((el) => el.offsetParent !== null);
      const len = focusables.length;
      if (len === 0) return;
      const currentIndex = focusables.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (currentIndex <= 0) {
          e.preventDefault();
          focusables[len - 1].focus();
        }
      } else if (currentIndex === -1 || currentIndex >= len - 1) {
        e.preventDefault();
        focusables[0].focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      transferPreviousActiveElementRef.current?.focus?.();
    };
  }, [showTransferModal, handleCloseTransferModal]);

  const processTagsForSubmit = (tagsText) => {
    if (!tagsText || !String(tagsText).trim()) return [];
    return tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => tag.replace(/\s+/g, "-"));
  };

  const handleEditDatasetSubmit = async (e) => {
    e.preventDefault();
    dispatchDatasetEdit({ type: "SET_ERROR", error: "" });
    const titleTrimmed = datasetEdit.title.trim();
    const tagsArray = processTagsForSubmit(datasetEdit.tags);
    if (!titleTrimmed) {
      dispatchDatasetEdit({ type: "SET_ERROR", error: "Dataset title is required." });
      return;
    }
    if (tagsArray.length === 0) {
      dispatchDatasetEdit({ type: "SET_ERROR", error: "At least one tag is required." });
      return;
    }
    dispatchDatasetEdit({ type: "SET_SUBMITTING", submitting: true });
    try {
      const body = {
        dataset_id: dataset.dataset_id,
        dataset_title: titleTrimmed,
        dataset_description: datasetEdit.description.trim() || null,
        private: datasetEdit.isPrivate,
        tags: tagsArray,
      };
      const response = await fetch(edit_dataset_endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = "Failed to update dataset.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      dispatchDatasetEdit({ type: "CLOSE" });
      await fetchDatasetInfo();
    } catch (err) {
      console.error("Error editing dataset:", err);
      dispatchDatasetEdit({
        type: "SET_ERROR",
        error: err.message || "Failed to update dataset. Please try again.",
      });
    } finally {
      dispatchDatasetEdit({ type: "SET_SUBMITTING", submitting: false });
    }
  };

  const openFileEditModal = (file) => {
    if (!file) return;
    dispatchFileEdit({
      type: "OPEN",
      payload: {
        file,
        title: file.file_title || "",
        description: file.file_description || "",
        provenance: file.provenance || "",
        source: file.source || "",
        citeAs: file.cite_as || "",
        groundtruthed: Boolean(file.groundtruthed),
        permissions:
          file.permissions && file.permissions.trim()
            ? file.permissions
            : "CC0: Public Domain",
        duration:
          file.duration !== undefined && file.duration !== null
            ? Number(file.duration)
            : 0,
        value:
          file.value && ["high", "medium", "low"].includes(file.value)
            ? file.value
            : "low",
        temporalFrom: formatToDatetimeLocal(file.temporal_from),
        temporalTo: formatToDatetimeLocal(file.temporal_to),
        geography: file.geography || "",
      },
    });
  };

  const handleEditFileSubmit = async (e) => {
    e.preventDefault();
    dispatchFileEdit({ type: "SET_ERROR", error: "" });
    const titleTrimmed = fileEdit.title.trim();
    if (!titleTrimmed) {
      dispatchFileEdit({ type: "SET_ERROR", error: "File title is required." });
      return;
    }
    const fromStr = fileEdit.temporalFrom?.trim();
    const toStr = fileEdit.temporalTo?.trim();
    if (fromStr && toStr) {
      const fromDate = new Date(fromStr);
      const toDate = new Date(toStr);
      if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime()) && fromDate >= toDate) {
        dispatchFileEdit({
          type: "SET_ERROR",
          error: "Temporal From must be before Temporal To.",
        });
        return;
      }
    }
    dispatchFileEdit({ type: "SET_SUBMITTING", submitting: true });
    try {
      const body = {
        file_id: fileEdit.file.file_id,
        file_title: titleTrimmed,
        file_description: fileEdit.description.trim() || null,
        provenance: fileEdit.provenance.trim() || null,
        source: fileEdit.source.trim() || null,
        cite_as: fileEdit.citeAs.trim() || null,
        groundtruthed: fileEdit.groundtruthed,
        permissions: fileEdit.permissions.trim() || null,
        duration: Math.max(0, parseInt(fileEdit.duration, 10) || 0),
        value: fileEdit.value || null,
        temporal_from: fromStr ? new Date(fromStr).toISOString() : null,
        temporal_to: toStr ? new Date(toStr).toISOString() : null,
        geography: fileEdit.geography.trim() || null,
      };
      const response = await fetch(edit_file_endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = "Failed to update file.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      dispatchFileEdit({ type: "CLOSE" });
      await fetchDatasetInfo();
    } catch (err) {
      console.error("Error editing file:", err);
      dispatchFileEdit({
        type: "SET_ERROR",
        error: err.message || "Failed to update file. Please try again.",
      });
    } finally {
      dispatchFileEdit({ type: "SET_SUBMITTING", submitting: false });
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
    <main className="wd-detail">
      <div className="wd-content py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <h2 className="mb-0">Dataset Information</h2>
          <span
            className={`badge ${dataset.private ? "text-bg-secondary" : "text-bg-success"}`}
            aria-label={
              dataset.private ? "This dataset is private" : "This dataset is public"
            }
          >
            {dataset.private ? "Private" : "Public"}
          </span>
        </div>
        <div className="d-flex gap-2">
          {privileges.transfer && (
            <button
              type="button"
              className="btn text-white"
              style={{ backgroundColor: "#0d6efd", borderColor: "#0d6efd" }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = "#0b5ed7";
                event.currentTarget.style.borderColor = "#0b5ed7";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = "#0d6efd";
                event.currentTarget.style.borderColor = "#0d6efd";
              }}
              onClick={handleOpenTransferModal}
              aria-label="Transfer dataset ownership"
            >
              Transfer
            </button>
          )}
          {privileges.approval && (
            <button
              type="button"
              className="btn text-white"
              style={{ backgroundColor: "#0d6efd", borderColor: "#0d6efd" }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = "#0b5ed7";
                event.currentTarget.style.borderColor = "#0b5ed7";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = "#0d6efd";
                event.currentTarget.style.borderColor = "#0d6efd";
              }}
              onClick={handleApproveDataset}
              disabled={approvingDataset}
              aria-label="Approve dataset"
            >
              {approvingDataset ? "Approving..." : "Approve"}
            </button>
          )}
          {privileges.edit && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openDatasetEditModal}
              aria-label="Edit dataset"
            >
              <i className="bi bi-pencil"></i> Edit
            </button>
          )}
          {privileges.delete_dataset && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setShowDatasetDeleteModal(true)}
              disabled={deletingDataset}
              aria-label="Delete dataset"
            >
              <i className="bi bi-trash"></i> Delete
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {deleteError}
          <button
            type="button"
            className="btn-close"
            onClick={() => setDeleteError("")}
            aria-label="Close"
          ></button>
        </div>
      )}

      {/* Transfer dataset modal */}
      {showTransferModal && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-dataset-modal-title"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="modal-dialog modal-dialog-scrollable"
            ref={transferModalDialogRef}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 id="transfer-dataset-modal-title" className="modal-title">
                  Transfer dataset
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleCloseTransferModal}
                  aria-label="Close transfer dialog"
                />
              </div>
              <div className="modal-body">
                {transferLoadingOrg && (
                  <div className="text-center py-3" role="status">
                    <div className="spinner-border spinner-border-sm" aria-hidden="true" />
                    <span className="visually-hidden">Loading members</span>
                  </div>
                )}
                {transferFetchError && (
                  <div className="alert alert-danger" role="alert">
                    {transferFetchError}
                  </div>
                )}
                {!transferLoadingOrg && !transferFetchError && transferMembers.length === 0 && (
                  <p className="text-muted mb-0">No members found for this organization.</p>
                )}
                {!transferLoadingOrg && transferMembers.length > 0 && (
                  <>
                    <div className="row mb-3 align-items-center">
                      <div className="col-sm-4">
                        <label htmlFor="transfer-member-select" className="col-form-label">
                          Transfer to:{" "}
                        </label>
                      </div>
                      <div className="col-sm-8">
                        <select
                          id="transfer-member-select"
                          ref={transferMemberSelectRef}
                          className="form-select"
                          value={transferSelectedUserId}
                          onChange={(e) => setTransferSelectedUserId(e.target.value)}
                          aria-label="Select member to transfer dataset to"
                        >
                          <option value="">Select a member…</option>
                          {transferMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {(() => {
                      const sel = transferMembers.find(
                        (m) =>
                          String(m.id) === String(transferSelectedUserId)
                      );
                      return (
                        <>
                          <div className="row mb-2">
                            <div className="col-sm-4">
                              <span className="fw-semibold">Name: </span>
                            </div>
                            <div className="col-sm-8">
                              {sel ? sel.full_name : "—"}
                            </div>
                          </div>
                          <div className="row mb-2">
                            <div className="col-sm-4">
                              <span className="fw-semibold">Email: </span>
                            </div>
                            <div className="col-sm-8">{sel ? sel.email : "—"}</div>
                          </div>
                          <div className="row mb-2">
                            <div className="col-sm-4">
                              <span className="fw-semibold">Designation: </span>
                            </div>
                            <div className="col-sm-8">
                              {sel?.designation != null && sel.designation !== ""
                                ? sel.designation
                                : "—"}
                            </div>
                          </div>
                          <div className="row mb-4">
                            <div className="col-sm-4">
                              <span className="fw-semibold">Role: </span>
                            </div>
                            <div className="col-sm-8">
                              {sel ? roleLabelForTransfer(sel.role) : "—"}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                    <div className="mt-4 pt-2">
                      <button
                        type="button"
                        className="btn text-white"
                        style={{ backgroundColor: "#0d6efd", borderColor: "#0d6efd" }}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.backgroundColor = "#0b5ed7";
                          event.currentTarget.style.borderColor = "#0b5ed7";
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.backgroundColor = "#0d6efd";
                          event.currentTarget.style.borderColor = "#0d6efd";
                        }}
                        onClick={handleSubmitTransfer}
                        disabled={
                          transferSubmitting || !transferSelectedUserId
                        }
                        aria-label="Submit dataset transfer"
                      >
                        {transferSubmitting ? "Submitting…" : "Submit"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dataset Edit Modal */}
      {showDatasetEditModal && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-dataset-modal-title"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog" ref={editDatasetModalRef}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 id="edit-dataset-modal-title" className="modal-title">Edit Dataset</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => dispatchDatasetEdit({ type: "CLOSE" })}
                  aria-label="Close"
                />
              </div>
              <form onSubmit={handleEditDatasetSubmit}>
                <div className="modal-body">
                  {datasetEdit.error && (
                    <div className="alert alert-danger" role="alert">
                      {datasetEdit.error}
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label" htmlFor="edit-dataset-title">
                      Dataset Title <span style={{ color: "red" }}>(required)</span>
                    </label>
                    <input
                      id="edit-dataset-title"
                      ref={editDatasetTitleInputRef}
                      type="text"
                      className="form-control"
                      value={datasetEdit.title}
                      onChange={(e) =>
                        dispatchDatasetEdit({
                          type: "SET_FIELD",
                          field: "title",
                          value: e.target.value,
                        })
                      }
                      required
                      aria-required="true"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Dataset Description</label>
                    <textarea
                      className="form-control"
                      rows={4}
                      value={datasetEdit.description}
                      onChange={(e) =>
                        dispatchDatasetEdit({
                          type: "SET_FIELD",
                          field: "description",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Availability</label>
                    <select
                      className="form-select"
                      value={datasetEdit.isPrivate ? "private" : "public"}
                      onChange={(e) =>
                        dispatchDatasetEdit({
                          type: "SET_FIELD",
                          field: "isPrivate",
                          value: e.target.value === "private",
                        })
                      }
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">
                      Tags (keywords separated by comma){" "}
                      <span style={{ color: "red" }}>(required)</span>
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      value={datasetEdit.tags}
                      onChange={(e) =>
                        dispatchDatasetEdit({
                          type: "SET_FIELD",
                          field: "tags",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => dispatchDatasetEdit({ type: "CLOSE" })}
                    disabled={datasetEdit.submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={datasetEdit.submitting}
                  >
                    {datasetEdit.submitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Dataset Delete Confirmation Modal */}
      {showDatasetDeleteModal && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Confirm Dataset Deletion</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowDatasetDeleteModal(false)}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to delete this dataset? This action will
                  permanently delete the dataset and all associated files. This
                  action cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDatasetDeleteModal(false)}
                  disabled={deletingDataset}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteDataset}
                  disabled={deletingDataset}
                >
                  {deletingDataset ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Deleting...
                    </>
                  ) : (
                    "Delete Dataset"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Delete Confirmation Modal */}
      {showFileDeleteModal && fileToDelete && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Confirm File Deletion</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowFileDeleteModal(false);
                    setFileToDelete(null);
                  }}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to delete the file "{fileToDelete.file_title}"?
                  This action cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowFileDeleteModal(false);
                    setFileToDelete(null);
                  }}
                  disabled={deletingFileId === fileToDelete.file_id}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteFile}
                  disabled={deletingFileId === fileToDelete.file_id}
                >
                  {deletingFileId === fileToDelete.file_id ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Deleting...
                    </>
                  ) : (
                    "Delete File"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Edit Modal */}
      {showFileEditModal && fileToEdit && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit File</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => dispatchFileEdit({ type: "CLOSE" })}
                  aria-label="Close"
                />
              </div>
              <form onSubmit={handleEditFileSubmit}>
                <div
                  className="modal-body"
                  style={{ maxHeight: "60vh", overflowY: "auto" }}
                >
                  {fileEdit.error && (
                    <div className="alert alert-danger" role="alert">
                      {fileEdit.error}
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label">
                      File Title <span style={{ color: "red" }}>(required)</span>
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      value={fileEdit.title}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "title",
                          value: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">File Description</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={fileEdit.description}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "description",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Provenance</label>
                    <input
                      type="text"
                      className="form-control"
                      value={fileEdit.provenance}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "provenance",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Source</label>
                    <input
                      type="text"
                      className="form-control"
                      value={fileEdit.source}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "source",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Cite As</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      value={fileEdit.citeAs}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "citeAs",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label me-3">Groundtruthed</label>
                    <div>
                      <div className="form-check form-check-inline">
                        <input
                          className="form-check-input"
                          type="radio"
                          name="fileEditGroundtruthed"
                          id="fileEdit_gt_no"
                          checked={!fileEdit.groundtruthed}
                          onChange={() =>
                            dispatchFileEdit({
                              type: "SET_FIELD",
                              field: "groundtruthed",
                              value: false,
                            })
                          }
                        />
                        <label className="form-check-label" htmlFor="fileEdit_gt_no">
                          No
                        </label>
                      </div>
                      <div className="form-check form-check-inline">
                        <input
                          className="form-check-input"
                          type="radio"
                          name="fileEditGroundtruthed"
                          id="fileEdit_gt_yes"
                          checked={fileEdit.groundtruthed}
                          onChange={() =>
                            dispatchFileEdit({
                              type: "SET_FIELD",
                              field: "groundtruthed",
                              value: true,
                            })
                          }
                        />
                        <label className="form-check-label" htmlFor="fileEdit_gt_yes">
                          Yes
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Permissions</label>
                    <select
                      className="form-select"
                      value={fileEdit.permissions}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "permissions",
                          value: e.target.value,
                        })
                      }
                    >
                      <option value="CC0: Public Domain">CC0: Public Domain</option>
                      <option value="CC BY: Attribution">CC BY: Attribution</option>
                      <option value="CC BY-SA: Attribution-ShareAlike">
                        CC BY-SA: Attribution-ShareAlike
                      </option>
                      <option value="CC BY-NC: Attribution-NonCommercial">
                        CC BY-NC: Attribution-NonCommercial
                      </option>
                      <option value="CC BY-NC-SA: Attribution-NonCommercial-ShareAlike">
                        CC BY-NC-SA: Attribution-NonCommercial-ShareAlike
                      </option>
                      <option value="CC BY-ND: Attribution-NoDerivatives">
                        CC BY-ND: Attribution-NoDerivatives
                      </option>
                      <option value="CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives">
                        CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives
                      </option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Duration</label>
                    <input
                      type="number"
                      className="form-control"
                      value={fileEdit.duration}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "duration",
                          value: Math.max(0, val),
                        });
                      }}
                      min={0}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Value</label>
                    <select
                      className="form-select"
                      value={fileEdit.value}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "value",
                          value: e.target.value,
                        })
                      }
                    >
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Temporal Coverage From</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={fileEdit.temporalFrom}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "temporalFrom",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Temporal Coverage To</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={fileEdit.temporalTo}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "temporalTo",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Geographical Extent</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={fileEdit.geography}
                      onChange={(e) =>
                        dispatchFileEdit({
                          type: "SET_FIELD",
                          field: "geography",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => dispatchFileEdit({ type: "CLOSE" })}
                    disabled={fileEdit.submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={fileEdit.submitting}
                  >
                    {fileEdit.submitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
            <div className="col-md-9">
              {dataset.creator ? (
                <Link to={`/profile?id=${encodeURIComponent(dataset.creator)}`}>
                  {dataset.creator_name || dataset.creator || "N/A"}
                </Link>
              ) : (
                dataset.creator_name || "N/A"
              )}
            </div>
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
            <div className="col-md-9">
              {dataset.organization ? (
                <Link
                  to={`/organisation?id=${encodeURIComponent(dataset.organization)}`}
                >
                  {dataset.organization_name || dataset.organization || "N/A"}
                </Link>
              ) : (
                dataset.organization_name || "N/A"
              )}
            </div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Tags:</strong>
            </div>
            <div className="col-md-9">
              {dataset.tags && Array.isArray(dataset.tags) && dataset.tags.length > 0
                ? dataset.tags.join(", ")
                : "N/A"}
            </div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Total Downloads:</strong>
            </div>
            <div className="col-md-9">{dataset.downloads ?? "N/A"}</div>
          </div>

          <div className="row mb-3">
            <div className="col-md-3">
              <strong>Approved:</strong>
            </div>
            <div className="col-md-9">
              {dataset.approved ? (
                <span className="badge bg-success">Yes</span>
              ) : (
                <span className="badge bg-warning text-dark">No</span>
              )}
            </div>
          </div>

          {dataset.approved_by && (
            <div className="row mb-3">
              <div className="col-md-3">
                <strong>Approved By:</strong>
              </div>
              <div className="col-md-9">
                <Link to={`/profile?id=${encodeURIComponent(dataset.approved_by)}`}>
                  {dataset.approver_name || dataset.approved_by}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="mb-0">Files</h3>
        {privileges.add_file && (
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
        )}
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
                  {file.provenance && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Provenance:</strong> {file.provenance}
                      </small>
                    </div>
                  )}
                  {file.source && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Source:</strong> {file.source}
                      </small>
                    </div>
                  )}
                  {file.cite_as && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Cite As:</strong> {file.cite_as}
                      </small>
                    </div>
                  )}
                  {file.groundtruthed !== undefined && file.groundtruthed !== null && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Groundtruthed:</strong> {file.groundtruthed ? "Yes" : "No"}
                      </small>
                    </div>
                  )}
                  {file.permissions && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Permissions:</strong> {file.permissions}
                      </small>
                    </div>
                  )}
                  {file.duration !== undefined && file.duration !== null && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Duration (years):</strong> {file.duration}
                      </small>
                    </div>
                  )}
                  {file.value && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Value:</strong> {file.value}
                      </small>
                    </div>
                  )}
                  {file.temporal_from && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Temporal From:</strong> {formatDate(file.temporal_from)}
                      </small>
                    </div>
                  )}
                  {file.temporal_to && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Temporal To:</strong> {formatDate(file.temporal_to)}
                      </small>
                    </div>
                  )}
                  {file.geography && (
                    <div className="mb-2">
                      <small className="text-muted">
                        <strong>Geography:</strong> {file.geography}
                      </small>
                    </div>
                  )}
                  <div className="d-flex gap-2">
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
                    {privileges.edit && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => openFileEditModal(file)}
                        aria-label="Edit file"
                      >
                        <i className="bi bi-pencil"></i>
                      </button>
                    )}
                    {privileges.delete_file && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => openFileDeleteModal(file)}
                        disabled={deletingFileId === file.file_id}
                        aria-label="Delete file"
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}

export default DatasetInfo;

