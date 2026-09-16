import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Ic from "../components/wd/Icons";
import Contour from "../components/wd/Contour";
import TagMultiSelect from "../components/wd/TagMultiSelect";
import { useToast } from "../components/wd/Toast";
import { useBranding } from "../branding";
import { dsLink } from "../components/wd/DatasetItems";
import {
  approve_dataset_endpoint,
  dataset_info_endpoint,
  download_url_endpoint,
  delete_dataset_endpoint,
  delete_file_endpoint,
  edit_dataset_endpoint,
  edit_file_endpoint,
  organization_by_id_endpoint,
  dataset_owners_endpoint,
  list_organizations_endpoint,
} from "../api/endpoints";
import {
  AVAILABILITY_OPTIONS,
  AVAILABILITY_PUBLIC,
  availabilityLabel,
  parseAvailability,
} from "../constants/availability";

const initialDatasetEdit = {
  showModal: false,
  title: "",
  description: "",
  availability: AVAILABILITY_PUBLIC,
  tags: [],
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
        availability: action.payload.availability ?? AVAILABILITY_PUBLIC,
        tags: action.payload.tags ?? [],
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
  const toast = useToast();
  const { productName } = useBranding();
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
    manage_owners: false,
  });
  const [showOwnersModal, setShowOwnersModal] = useState(false);
  const [ownerMembers, setOwnerMembers] = useState([]);
  const [ownerOrgs, setOwnerOrgs] = useState([]);
  const [ownerSelectedOrgId, setOwnerSelectedOrgId] = useState("");
  const [ownerSelectedUserId, setOwnerSelectedUserId] = useState("");
  const [ownerFetchError, setOwnerFetchError] = useState("");
  const [ownerLoadingOrg, setOwnerLoadingOrg] = useState(false);
  const [ownerSubmitting, setOwnerSubmitting] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const [showDatasetDeleteModal, setShowDatasetDeleteModal] = useState(false);
  const [showFileDeleteModal, setShowFileDeleteModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [deletingDataset, setDeletingDataset] = useState(false);
  const [approvingDataset, setApprovingDataset] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [orgPrivate, setOrgPrivate] = useState(false);

  // Presentational-only UI state (accordions, read-more, copy feedback)
  const [openFiles, setOpenFiles] = useState({});
  const [aboutOpen, setAboutOpen] = useState(false);
  const [citeCopied, setCiteCopied] = useState(false);

  // Dataset edit modal state
  const [datasetEdit, dispatchDatasetEdit] = useReducer(
    datasetEditReducer,
    initialDatasetEdit
  );
  const showDatasetEditModal = datasetEdit.showModal;
  const editDatasetModalRef = useRef(null);
  const editDatasetTitleInputRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const ownersModalDialogRef = useRef(null);
  const ownerMemberSelectRef = useRef(null);
  const ownersPreviousActiveElementRef = useRef(null);

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
      const orgId = data.dataset?.organization;
      if (orgId) {
        try {
          const orgResp = await fetch(organization_by_id_endpoint(orgId), {
            credentials: "include",
          });
          if (orgResp.ok) {
            const orgData = await orgResp.json();
            setOrgPrivate(Boolean(orgData.private));
          } else {
            setOrgPrivate(false);
          }
        } catch {
          setOrgPrivate(false);
        }
      } else {
        setOrgPrivate(false);
      }
      setPrivileges(
        data.privileges ?? {
          edit: false,
          delete_dataset: false,
          delete_file: false,
          add_file: false,
          approval: false,
          manage_owners: false,
        }
      );
    } catch (err) {
      console.error("Error fetching dataset info:", err);
      setError(err.message || "Error loading dataset information");
    } finally {
      setLoading(false);
    }
  }, [searchParams, navigate]);

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

  const formatDateShort = (dateString) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "";
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
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

  const fileType = (fmt) => {
    const s = (fmt || "").toLowerCase();
    if (s.includes("csv") || s.includes("tsv")) return "csv";
    if (s.includes("xls") || s.includes("excel") || s.includes("sheet")) return "excel";
    if (s.includes("geojson")) return "geojson";
    if (s.includes("json")) return "geojson";
    if (s.includes("pdf") || s.includes("doc")) return "pdf";
    if (
      s.includes("png") ||
      s.includes("jpg") ||
      s.includes("jpeg") ||
      s.includes("gif") ||
      s.includes("webp") ||
      s.includes("svg") ||
      s.includes("tif") ||
      s.includes("tiff")
    )
      return "image";
    if (
      s.includes("gpkg") ||
      s.includes("shp") ||
      s.includes("kml") ||
      s.includes("zip") ||
      s.includes("geo")
    )
      return "geo";
    return "";
  };

  const fileLabel = (fmt) => {
    const s = (fmt || "").toString().toLowerCase();
    if (s.includes("geojson")) return "GEO";
    if (s.includes("json")) return "JSON";
    if (s.includes("csv")) return "CSV";
    if (s.includes("tsv")) return "TSV";
    if (s.includes("xlsx") || s.includes("xls") || s.includes("excel") || s.includes("sheet"))
      return "XLS";
    if (s.includes("pdf")) return "PDF";
    if (s.includes("png")) return "PNG";
    if (s.includes("jpg") || s.includes("jpeg")) return "JPG";
    if (s.includes("tif")) return "TIF";
    if (s.includes("gpkg")) return "GPKG";
    if (s.includes("shp")) return "SHP";
    return (
      (fmt || "DAT").toString().replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "DAT"
    );
  };

  const scrollToSec = (id) => {
    const el = document.getElementById("sec-" + id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleFile = (id) => {
    setOpenFiles((prev) => ({ ...prev, [id]: !prev[id] }));
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
    if (!dataset?.dataset_id) {
      setDeleteError("Missing dataset information.");
      return;
    }

    setDeletingDataset(true);
    setDeleteError("");

    try {
      const params = new URLSearchParams({
        dataset_id: dataset.dataset_id,
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

  const roleLabelForOwner = (role) => {
    if (role === 0) return "Member";
    if (role === 1) return "Admin";
    if (role === 2) return "Reviewer";
    return "Member";
  };

  const loadOwnerMembersForOrg = async (orgId) => {
    const response = await fetch(organization_by_id_endpoint(orgId), {
      credentials: "include",
    });
    if (!response.ok) {
      let msg = "Failed to load organization members.";
      try {
        const errBody = await response.json();
        if (errBody?.detail) msg = errBody.detail;
      } catch {
        msg = response.statusText || msg;
      }
      throw new Error(msg);
    }
    const orgData = await response.json();
    return Array.isArray(orgData.members) ? orgData.members : [];
  };

  const handleOpenOwnersModal = async () => {
    if (!dataset?.organization) {
      setDeleteError("Missing organization for this dataset.");
      return;
    }
    setShowOwnersModal(true);
    setOwnerMembers([]);
    setOwnerOrgs([]);
    setOwnerSelectedUserId("");
    setOwnerFetchError("");
    setOwnerSelectedOrgId(String(dataset.organization));
    setOwnerLoadingOrg(true);
    try {
      if (user?.is_superuser) {
        const listResp = await fetch(list_organizations_endpoint, {
          credentials: "include",
        });
        if (listResp.ok) {
          const listData = await listResp.json();
          setOwnerOrgs(Array.isArray(listData?.items) ? listData.items : []);
        }
      }
      const members = await loadOwnerMembersForOrg(dataset.organization);
      setOwnerMembers(members);
    } catch (err) {
      console.error("Error loading organization:", err);
      setOwnerFetchError(err.message || "Failed to load organization members.");
    } finally {
      setOwnerLoadingOrg(false);
    }
  };

  const handleOwnerOrgChange = async (orgId) => {
    setOwnerSelectedOrgId(orgId);
    setOwnerSelectedUserId("");
    setOwnerFetchError("");
    if (!orgId) {
      setOwnerMembers([]);
      return;
    }
    setOwnerLoadingOrg(true);
    try {
      const members = await loadOwnerMembersForOrg(orgId);
      setOwnerMembers(members);
    } catch (err) {
      setOwnerMembers([]);
      setOwnerFetchError(err.message || "Failed to load organization members.");
    } finally {
      setOwnerLoadingOrg(false);
    }
  };

  const handleCloseOwnersModal = useCallback(() => {
    setShowOwnersModal(false);
    setOwnerMembers([]);
    setOwnerOrgs([]);
    setOwnerSelectedOrgId("");
    setOwnerSelectedUserId("");
    setOwnerFetchError("");
  }, []);

  const handleAddOwner = async () => {
    if (!dataset?.dataset_id || !ownerSelectedUserId) {
      setOwnerFetchError("Please select a member to add as owner.");
      return;
    }
    setOwnerSubmitting(true);
    setOwnerFetchError("");
    try {
      const response = await fetch(dataset_owners_endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: dataset.dataset_id,
          user_id: ownerSelectedUserId,
        }),
      });
      if (!response.ok) {
        let errorMessage = "Failed to add owner.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      setOwnerSelectedUserId("");
      await fetchDatasetInfo();
    } catch (err) {
      console.error("Error adding owner:", err);
      setOwnerFetchError(err.message || "Could not add owner.");
    } finally {
      setOwnerSubmitting(false);
    }
  };

  const handleRemoveOwner = async (userId) => {
    if (!dataset?.dataset_id || !userId) return;
    setOwnerSubmitting(true);
    setOwnerFetchError("");
    try {
      const params = new URLSearchParams({
        dataset_id: dataset.dataset_id,
        user_id: userId,
      });
      const response = await fetch(
        `${dataset_owners_endpoint}?${params.toString()}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      if (!response.ok) {
        let errorMessage = "Failed to remove owner.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      await fetchDatasetInfo();
    } catch (err) {
      console.error("Error removing owner:", err);
      setOwnerFetchError(err.message || "Could not remove owner.");
    } finally {
      setOwnerSubmitting(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete?.file_id) {
      setDeleteError("Missing file information.");
      return;
    }

    setDeletingFileId(fileToDelete.file_id);
    setDeleteError("");

    try {
      const params = new URLSearchParams({
        file_id: fileToDelete.file_id,
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
        availability: parseAvailability(dataset.availability),
        tags:
          dataset.tags && Array.isArray(dataset.tags) ? dataset.tags : [],
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

  useEffect(() => {
    if (!showOwnersModal) return;
    const timer = requestAnimationFrame(() => {
      const canFocusSelect =
        !ownerLoadingOrg &&
        ownerMembers.length > 0 &&
        ownerMemberSelectRef.current;
      if (canFocusSelect) {
        ownerMemberSelectRef.current?.focus();
      } else {
        const closeBtn =
          ownersModalDialogRef.current?.querySelector(".btn-close");
        closeBtn?.focus();
      }
    });
    return () => cancelAnimationFrame(timer);
  }, [showOwnersModal, ownerLoadingOrg, ownerMembers.length]);

  useEffect(() => {
    if (!showOwnersModal) return;
    ownersPreviousActiveElementRef.current = document.activeElement;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseOwnersModal();
        return;
      }
      if (e.key !== "Tab" || !ownersModalDialogRef.current) return;
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = [
        ...ownersModalDialogRef.current.querySelectorAll(focusableSelector),
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
      ownersPreviousActiveElementRef.current?.focus?.();
    };
  }, [showOwnersModal, handleCloseOwnersModal]);

  const handleEditDatasetSubmit = async (e) => {
    e.preventDefault();
    dispatchDatasetEdit({ type: "SET_ERROR", error: "" });
    const titleTrimmed = datasetEdit.title.trim();
    const tagsArray = (Array.isArray(datasetEdit.tags) ? datasetEdit.tags : [])
      .map((tag) => String(tag).trim())
      .filter((tag) => tag.length > 0);
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
        availability: orgPrivate ? datasetEdit.availability : AVAILABILITY_PUBLIC,
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
      <div className="page">
        <div className="wrap" style={{ padding: "80px 0" }}>
          <div className="empty">
            <p>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: "80px 0" }}>
          <div className="empty">
            <h3 className="display">Unable to load dataset</h3>
            <p>{error}</p>
            <Link className="btn btn-ghost" to="/datasets">
              Back to datasets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="page">
        <div className="wrap" style={{ padding: "80px 0" }}>
          <div className="empty">
            <h3 className="display">No dataset information available.</h3>
            <Link className="btn btn-ghost" to="/datasets">
              Back to datasets
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Derived presentation values (from whatever the API provides) ---
  const orgName = dataset.organization_name || dataset.organization || "";
  const availabilityText = availabilityLabel(dataset.availability);
  const isPublic = parseAvailability(dataset.availability) === AVAILABILITY_PUBLIC;
  const geoVal = files.map((f) => f.geography).find(Boolean) || "";
  const licenseVal = files.map((f) => f.permissions).find(Boolean) || "";
  const timeVal = formatDateShort(dataset.created_at);
  const description = dataset.dataset_description || "";
  const isLongDesc = description.length > 320;
  const tagsList =
    dataset.tags && Array.isArray(dataset.tags) ? dataset.tags : [];

  const citeText =
    files.map((f) => f.cite_as).find(Boolean) ||
    `${orgName || "Unknown source"} (${
      dataset.created_at ? new Date(dataset.created_at).getFullYear() : new Date().getFullYear()
    }). ${dataset.dataset_title || "Untitled dataset"} [Dataset]. ${productName}.${
      licenseVal ? " " + licenseVal + "." : ""
    }`;

  // Provenance is built from any file-level source/provenance info.
  const provSteps = files
    .filter((f) => f.source || f.provenance)
    .map((f) => ({
      title: f.file_title || "File",
      meta: f.source || "",
      detail: f.provenance || "",
    }));
  const hasProvenance = provSteps.length > 0;

  const copyCitation = () => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(citeText);
    } catch {
      // ignore clipboard failures
    }
    setCiteCopied(true);
    toast("Citation copied to clipboard");
    setTimeout(() => setCiteCopied(false), 1900);
  };

  const datasetId = searchParams.get("dataset_id");

  return (
    <div className="page">
      <section className="detail-hero" style={{ position: "relative" }}>
        <Contour op={0.35} />
        <div className="wrap dh-inner">
          <Link className="back" to="/datasets">
            <Ic name="chevLeft" size={16} sw={2} />
            Datasets
          </Link>
          <div className="dh-grid">
            <div>
              {/* <div className="folder-id">
                <span className="folder-glyph">
                  <Ic name="folder" size={26} sw={1.7} />
                </span>
                <div className="folder-id-text">
                  <span className="folder-eyebrow">Dataset folder</span>
                  <span className="folder-count">
                    {files.length} {files.length === 1 ? "file" : "files"} inside
                  </span>
                </div>
              </div> */}
              <h1 className="dh-title">{dataset.dataset_title || "Untitled dataset"}</h1>
              {/* {description && <p className="dh-desc">{description}</p>} */}
              <div className="dh-facts">
                {orgName && (
                  <>
                    <span className="who">{orgName}</span>
                  </>
                )}
                {geoVal && (
                  <>
                    <span className="sep"></span>
                    <span>{geoVal}</span>
                  </>
                )}
                {timeVal && (
                  <>
                    <span className="sep"></span>
                    <span>{timeVal}</span>
                  </>
                )}
              </div>
              <div className="dh-badges">
                {isPublic ? (
                  <span className="badge public dot">Public</span>
                ) : (
                  <span className="badge lock">
                    <Ic name="lock" size={13} sw={2} />
                    {availabilityText}
                  </span>
                )}
                {dataset.approved ? (
                  <span className="badge approved">
                    <Ic name="check" size={13} sw={2.4} />
                    Approved
                  </span>
                ) : (
                  <span className="badge pending">Pending</span>
                )}
              </div>
              {tagsList.length > 0 && (
                <div className="dh-tags mb-4">
                  {tagsList.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="dh-actions">
              <button className="btn btn-primary" onClick={() => scrollToSec("files")}>
                <Ic name="dl" size={16} sw={2} />
                Download dataset
              </button>
              <button className="btn btn-ghost" onClick={() => scrollToSec("usage")}>
                <Ic name="cite" size={16} sw={2} />
                Cite
              </button>
              {privileges.manage_owners && (
                <button className="btn btn-ghost" onClick={handleOpenOwnersModal}>
                  <Ic name="link" size={16} sw={2} />
                  Manage owners
                </button>
              )}
              {privileges.approval && (
                <button
                  className="btn btn-ghost"
                  onClick={handleApproveDataset}
                  disabled={approvingDataset}
                >
                  <Ic name="check" size={16} sw={2} />
                  {approvingDataset ? "Approving…" : "Approve"}
                </button>
              )}
              {privileges.edit && (
                <button className="btn btn-ghost" onClick={openDatasetEditModal}>
                  Edit
                </button>
              )}
              {privileges.delete_dataset && (
                <button
                  className="btn btn-ghost"
                  style={{ color: "#b3402f", borderColor: "#e6c9c2" }}
                  onClick={() => setShowDatasetDeleteModal(true)}
                  disabled={deletingDataset}
                >
                  Delete dataset
                </button>
              )}
              <div className="meta-mini">
                {(dataset.downloads ?? 0).toLocaleString()} downloads
                {timeVal ? ` · Updated ${timeVal}` : ""}
              </div>
            </div>
          </div>
        </div>
      </section>

      {(deleteError || downloadError) && (
        <div className="wrap" style={{ paddingTop: "16px" }}>
          {deleteError && (
            <div className="attn attn-card warn" role="alert" style={{ marginBottom: "10px" }}>
              <span>{deleteError}</span>
              <button
                className="btn btn-quiet"
                onClick={() => setDeleteError("")}
                aria-label="Dismiss"
              >
                <Ic name="close" size={15} sw={2} />
              </button>
            </div>
          )}
          {downloadError && (
            <div className="attn attn-card warn" role="alert">
              <span>{downloadError}</span>
              <button
                className="btn btn-quiet"
                onClick={() => setDownloadError("")}
                aria-label="Dismiss"
              >
                <Ic name="close" size={15} sw={2} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="wrap">
        <div className="detail-body">
          <div className="detail-main">
            <section className="sec" id="sec-overview">
              <div className="sec-label">About this dataset</div>
              <div className="prose">
                {description ? (
                  isLongDesc ? (
                    <>
                      <p>{description.slice(0, 320)}</p>
                      <div className={"about-extra" + (aboutOpen ? " show" : "")}>
                        <p>{description.slice(320)}</p>
                      </div>
                      <button
                        className="readmore"
                        onClick={() => setAboutOpen((v) => !v)}
                      >
                        {aboutOpen ? "Read less ↑" : "Read more ↓"}
                      </button>
                    </>
                  ) : (
                    <p>{description}</p>
                  )
                ) : (
                  <p className="muted">No description provided for this dataset.</p>
                )}
                <div className="mgroups" style={{ marginTop: "22px" }}>
                  <div className="mgroup">
                    <div className="mgl">Creator</div>
                    <div className="mgv">
                      {dataset.creator ? (
                        <Link to={`/profile?id=${encodeURIComponent(dataset.creator)}`}>
                          {dataset.creator_name || dataset.creator}
                        </Link>
                      ) : (
                        dataset.creator_name || "N/A"
                      )}
                    </div>
                  </div>
                  <div className="mgroup">
                    <div className="mgl">Owners</div>
                    <div className="mgv">
                      {Array.isArray(dataset.owners) && dataset.owners.length > 0
                        ? dataset.owners.map((o, idx) => (
                            <span key={o.user_id}>
                              {idx > 0 ? ", " : ""}
                              <Link to={`/profile?id=${encodeURIComponent(o.user_id)}`}>
                                {o.full_name || o.user_id}
                              </Link>
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                  <div className="mgroup">
                    <div className="mgl">Organization</div>
                    <div className="mgv">
                      {dataset.organization ? (
                        <Link
                          to={`/organisation?id=${encodeURIComponent(
                            dataset.organization
                          )}`}
                        >
                          {orgName || "N/A"}
                        </Link>
                      ) : (
                        orgName || "N/A"
                      )}
                    </div>
                  </div>
                  <div className="mgroup">
                    <div className="mgl">Created</div>
                    <div className="mgv">{formatDate(dataset.created_at)}</div>
                  </div>
                  {dataset.approved_by && (
                    <div className="mgroup">
                      <div className="mgl">Approved by</div>
                      <div className="mgv">
                        <Link
                          to={`/profile?id=${encodeURIComponent(dataset.approved_by)}`}
                        >
                          {dataset.approver_name || dataset.approved_by}
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="sec" id="sec-files">
              <div className="sec-label">Inside this folder</div>
              <div className="files-head">
                <h2
                  className="display"
                  style={{
                    fontFamily: "var(--display)",
                    fontSize: "26px",
                    fontWeight: 450,
                    color: "var(--navy)",
                  }}
                >
                  Files
                </h2>
                <div className="files-head-right">
                  <span className="muted files-hint">
                    {files.length} {files.length === 1 ? "file" : "files"} · click a file
                    to open its full details
                  </span>
                  {privileges.add_file && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "7px 13px" }}
                      onClick={() => {
                        if (datasetId) {
                          navigate(`/add-file?dataset_id=${datasetId}`);
                        }
                      }}
                    >
                      <Ic name="plus" size={15} sw={2} />
                      Add file
                    </button>
                  )}
                </div>
              </div>

              {files.length === 0 ? (
                <div className="empty" style={{ padding: "48px 0" }}>
                  <div className="eic">
                    <Ic name="folder" size={26} sw={1.6} />
                  </div>
                  <h3 className="display">This folder is empty</h3>
                  <p>No files have been added to this dataset yet.</p>
                  {privileges.add_file && (
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        datasetId && navigate(`/add-file?dataset_id=${datasetId}`)
                      }
                    >
                      <Ic name="plus" size={15} sw={2} />
                      Add the first file
                    </button>
                  )}
                </div>
              ) : (
                <div className="fcards">
                  {files.map((file) => {
                    const t = fileType(file.file_format);
                    const isOpen = !!openFiles[file.file_id];
                    const temporal =
                      file.temporal_from || file.temporal_to
                        ? `${
                            file.temporal_from
                              ? formatDateShort(file.temporal_from)
                              : "…"
                          } – ${
                            file.temporal_to
                              ? formatDateShort(file.temporal_to)
                              : "…"
                          }`
                        : "";
                    const gt = Boolean(file.groundtruthed);
                    return (
                      <div
                        key={file.file_id}
                        className={"fcard" + (isOpen ? " open" : "")}
                      >
                        <div className="fcard-head">
                          <button
                            className="fcard-toggle"
                            onClick={() => toggleFile(file.file_id)}
                            aria-expanded={isOpen}
                          >
                            <span className={"fcard-ic" + (t ? " " + t : "")}>
                              {fileLabel(file.file_format)}
                            </span>
                            <span className="fcard-main">
                              <span className="fcard-title">
                                {file.file_title || "Untitled file"}
                              </span>
                              <span
                                className="fcard-sub"
                                title={file.file_name || ""}
                              >
                                {file.file_name || "—"}
                              </span>
                            </span>
                            <span className="fcard-specs">
                              <span className="fmt-chip">
                                {(file.file_format || "DATA")
                                  .toString()
                                  .toUpperCase()}
                              </span>
                              <span className="fcard-size">
                                {formatFileSize(file.file_size)}
                              </span>
                              {gt && (
                                <span className="gt-pill on" title="Groundtruthed">
                                  <Ic name="verified" size={13} sw={2} />
                                  Groundtruthed
                                </span>
                              )}
                            </span>
                            <span className="fcard-chev">
                              <Ic name="chev" size={18} sw={2} />
                            </span>
                          </button>
                          <div className="fcard-quick">
                            <button
                              className="fbtn primary"
                              onClick={() => handleDownload(file)}
                              disabled={downloadingFileId === file.file_id}
                              title="Download file"
                              aria-label="Download file"
                            >
                              <Ic name="dl" size={16} sw={2} />
                            </button>
                            {privileges.edit && (
                              <button
                                className="fbtn"
                                onClick={() => openFileEditModal(file)}
                                title="Edit file"
                                aria-label="Edit file"
                              >
                                <Ic name="edit" size={15} sw={2} />
                              </button>
                            )}
                            {privileges.delete_file && (
                              <button
                                className="fbtn danger"
                                onClick={() => openFileDeleteModal(file)}
                                disabled={deletingFileId === file.file_id}
                                title="Delete file"
                                aria-label="Delete file"
                              >
                                <Ic name="trash" size={15} sw={2} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="fcard-body">
                          <div className="fcard-body-inner">
                            <div className="fcard-body-pad">
                              {file.file_description && (
                                <p className="fcard-desc">
                                  {file.file_description}
                                </p>
                              )}
                              <div className="fmeta">
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="file" size={12} sw={2} />
                                    File name
                                  </div>
                                  <div className="fmv mono">
                                    {file.file_name || "—"}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="fmt" size={12} sw={2} />
                                    Format
                                  </div>
                                  <div className="fmv mono">
                                    {(file.file_format || "N/A")
                                      .toString()
                                      .toUpperCase()}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="dl" size={12} sw={2} />
                                    Size
                                  </div>
                                  <div className="fmv">
                                    {formatFileSize(file.file_size)}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="org" size={12} sw={2} />
                                    Provenance
                                  </div>
                                  <div className="fmv">{file.provenance || "—"}</div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="link" size={12} sw={2} />
                                    Source
                                  </div>
                                  <div className="fmv">{file.source || "—"}</div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="lic" size={12} sw={2} />
                                    Permissions
                                  </div>
                                  <div className="fmv">
                                    {file.permissions || "—"}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="verified" size={12} sw={2} />
                                    Groundtruthed
                                  </div>
                                  <div className="fmv">
                                    <span
                                      className={"gt-pill" + (gt ? " on" : "")}
                                    >
                                      <Ic
                                        name={gt ? "verified" : "close"}
                                        size={13}
                                        sw={2}
                                      />
                                      {gt ? "Yes" : "No"}
                                    </span>
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="clock" size={12} sw={2} />
                                    Duration
                                  </div>
                                  <div className="fmv">
                                    {file.duration
                                      ? `${file.duration} ${
                                          Number(file.duration) === 1
                                            ? "year"
                                            : "years"
                                        }`
                                      : "—"}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="cal" size={12} sw={2} />
                                    Temporal coverage
                                  </div>
                                  <div className="fmv">{temporal || "—"}</div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="loc" size={12} sw={2} />
                                    Geographical extent
                                  </div>
                                  <div className="fmv">{file.geography || "—"}</div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="cal" size={12} sw={2} />
                                    Added
                                  </div>
                                  <div className="fmv">
                                    {formatDateShort(file.created_at) || "N/A"}
                                  </div>
                                </div>
                                <div className="fm">
                                  <div className="fml">
                                    <Ic name="dl" size={12} sw={2} />
                                    Downloads
                                  </div>
                                  <div className="fmv">
                                    {(file.downloads ?? 0).toLocaleString("en-IN")}
                                  </div>
                                </div>
                                {file.cite_as && (
                                  <div className="fm wide">
                                    <div className="fml">
                                      <Ic name="cite" size={12} sw={2} />
                                      Cite as
                                    </div>
                                    <div className="fmv cite">{file.cite_as}</div>
                                  </div>
                                )}
                              </div>
                              <div className="fcard-actions">
                                <button
                                  className="btn btn-primary"
                                  onClick={() => handleDownload(file)}
                                  disabled={downloadingFileId === file.file_id}
                                >
                                  <Ic name="dl" size={16} sw={2} />
                                  {downloadingFileId === file.file_id
                                    ? "Downloading…"
                                    : "Download file"}
                                </button>
                                {privileges.edit && (
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => openFileEditModal(file)}
                                  >
                                    <Ic name="edit" size={15} sw={2} />
                                    Edit
                                  </button>
                                )}
                                {privileges.delete_file && (
                                  <button
                                    className="btn btn-ghost danger"
                                    onClick={() => openFileDeleteModal(file)}
                                    disabled={deletingFileId === file.file_id}
                                  >
                                    <Ic name="trash" size={15} sw={2} />
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* {hasProvenance && (
              <section className="sec" id="sec-provenance">
                <div className="sec-label">How it was produced</div>
                <h2 className="display">Provenance</h2>
                <div className="prov">
                  {provSteps.map((s, i) => (
                    <div className="prov-step" key={i}>
                      <div className="prov-rail">
                        <div className="prov-dot">
                          <Ic name="file" size={16} sw={1.8} />
                        </div>
                        <div className="prov-line"></div>
                      </div>
                      <div className="prov-body">
                        <b>{s.title}</b>
                        {s.meta && <div className="pm">{s.meta}</div>}
                        {s.detail && <p>{s.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="sec" id="sec-usage">
              <div className="sec-label">How can I use this data?</div>
              <h2 className="display">Usage &amp; citation</h2>
              <div className="usage-lead">
                <span className="license-chip">
                  <Ic name="lic" size={15} sw={2} />
                  {licenseVal || "License not specified"}
                </span>
                <span className="muted" style={{ fontSize: "14px" }}>
                  {isPublic
                    ? "Publicly available for use with attribution"
                    : "Access controlled — request permission to reuse"}
                </span>
              </div>
              <div className="usage-grid">
                <div className="ubox">
                  <h4>What you can do</h4>
                  <p>
                    Reuse and adapt this dataset in line with its license
                    {licenseVal ? ` (${licenseVal})` : ""}. Give appropriate credit
                    to {orgName || "the source organization"} and indicate any changes
                    you make.
                  </p>
                </div>
                <div className="ubox">
                  <h4>Attribution</h4>
                  <p>
                    Cite {orgName || "the source organization"} as the source and link
                    back to this dataset. A ready-to-use citation is below.
                  </p>
                </div>
              </div>
              <h4
                style={{
                  fontSize: "11px",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--faint)",
                  marginBottom: "12px",
                }}
              >
                Cite this dataset
              </h4>
              <div className="cite-block">
                <div className="ct">{citeText}</div>
                <button
                  className={"copy-btn" + (citeCopied ? " done" : "")}
                  onClick={copyCitation}
                >
                  <Ic name={citeCopied ? "check" : "cite"} size={15} sw={2} />
                  <span>{citeCopied ? "Copied" : "Copy citation"}</span>
                </button>
              </div>
            </section> */}
          </div>

          <aside>
            <div className="rail">
              <div className="rail-card">
                <h4>Details</h4>
                <div className="rrow">
                  <span className="k">Source</span>
                  {dataset.organization ? (
                    <Link
                      className="v"
                      style={{ color: "var(--blue)" }}
                      to={`/organisation?id=${encodeURIComponent(dataset.organization)}`}
                    >
                      {orgName || "N/A"}
                    </Link>
                  ) : (
                    <span className="v">{orgName || "N/A"}</span>
                  )}
                </div>
                <div className="rrow">
                  <span className="k">Owners</span>
                  <span className="v">
                    {Array.isArray(dataset.owners) && dataset.owners.length > 0
                      ? dataset.owners
                          .map((o) => o.full_name || o.user_id)
                          .join(", ")
                      : dataset.creator_name || dataset.creator || "N/A"}
                  </span>
                </div>
                <div className="rrow">
                  <span className="k">Availability</span>
                  <span className="v">{availabilityText}</span>
                </div>
                <div className="rrow">
                  <span className="k">Status</span>
                  <span className="v">{dataset.approved ? "Approved" : "Pending"}</span>
                </div>
                {/* <div className="rrow">
                  <span className="k">License</span>
                  <span className="v mono">{licenseVal || "N/A"}</span>
                </div> */}
                <div className="rrow">
                  <span className="k">Files</span>
                  <span className="v mono">{files.length}</span>
                </div>
                <div className="rrow">
                  <span className="k">Downloads</span>
                  <span className="v mono">
                    {(dataset.downloads ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="rrow">
                  <span className="k">Updated</span>
                  <span className="v">{timeVal || "N/A"}</span>
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => scrollToSec("files")}
                style={{ width: "100%" }}
              >
                <Ic name="dl" size={16} sw={2} />
                Download
              </button>
            </div>
          </aside>
        </div>
      </div>

      {showOwnersModal && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-owners-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseOwnersModal();
          }}
        >
          <div className="modal-card" ref={ownersModalDialogRef}>
            <div className="modal-head">
              <h3 id="manage-owners-modal-title">Manage owners</h3>
              <p>Add or remove owners. The original creator cannot be removed.</p>
              <button
                className="btn-close btn btn-quiet"
                onClick={handleCloseOwnersModal}
                aria-label="Close owners dialog"
                style={{ position: "absolute", top: "16px", right: "16px" }}
              >
                <Ic name="close" size={16} sw={2} />
              </button>
            </div>
            <div className="modal-body">
              {ownerLoadingOrg && (
                <div className="empty" role="status">
                  <p>Loading members…</p>
                </div>
              )}
              {ownerFetchError && (
                <div className="attn attn-card warn" role="alert" style={{ marginBottom: "14px" }}>
                  <span>{ownerFetchError}</span>
                </div>
              )}
              <div className="mgroups" style={{ marginBottom: "16px" }}>
                {(dataset.owners || []).map((o) => {
                  const isCreator = String(o.user_id) === String(dataset.creator);
                  return (
                    <div className="mgroup" key={o.user_id}>
                      <div className="mgl">{isCreator ? "Creator" : "Owner"}</div>
                      <div className="mgv" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{o.full_name || o.user_id}</span>
                        {!isCreator && (
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={ownerSubmitting}
                            onClick={() => handleRemoveOwner(o.user_id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!ownerLoadingOrg && user?.is_superuser && ownerOrgs.length > 0 && (
                <div className="field">
                  <label htmlFor="owner-org-select">Organization</label>
                  <select
                    id="owner-org-select"
                    value={ownerSelectedOrgId}
                    onChange={(e) => handleOwnerOrgChange(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {ownerOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!ownerLoadingOrg && ownerMembers.length > 0 && (
                <>
                  <div className="field">
                    <label htmlFor="owner-member-select">Add owner</label>
                    <select
                      id="owner-member-select"
                      ref={ownerMemberSelectRef}
                      value={ownerSelectedUserId}
                      onChange={(e) => setOwnerSelectedUserId(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select a member…</option>
                      {ownerMembers
                        .filter(
                          (m) =>
                            !(dataset.owners || []).some(
                              (o) => String(o.user_id) === String(m.id)
                            )
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name} ({roleLabelForOwner(m.role)})
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}
              {!ownerLoadingOrg &&
                ownerMembers.filter(
                  (m) =>
                    !(dataset.owners || []).some(
                      (o) => String(o.user_id) === String(m.id)
                    )
                ).length === 0 && (
                  <p className="muted">
                    No members in this organization to add as owners. Add people
                    to the organization first.
                  </p>
                )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={handleCloseOwnersModal}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddOwner}
                disabled={
                  ownerSubmitting ||
                  !ownerSelectedUserId ||
                  ownerLoadingOrg
                }
              >
                {ownerSubmitting ? "Saving…" : "Add owner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dataset Edit Modal */}
      {showDatasetEditModal && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-dataset-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget)
              dispatchDatasetEdit({ type: "CLOSE" });
          }}
        >
          <div className="modal-card" ref={editDatasetModalRef}>
            <form onSubmit={handleEditDatasetSubmit}>
              <div className="modal-head">
                <h3 id="edit-dataset-modal-title">Edit dataset</h3>
                <p>Update the title, description, availability and tags.</p>
              </div>
              <div className="modal-body">
                {datasetEdit.error && (
                  <div className="attn attn-card warn" role="alert" style={{ marginBottom: "14px" }}>
                    <span>{datasetEdit.error}</span>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="edit-dataset-title">
                    Dataset title <span style={{ color: "#b3402f" }}>(required)</span>
                  </label>
                  <input
                    id="edit-dataset-title"
                    ref={editDatasetTitleInputRef}
                    type="text"
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
                <div className="field">
                  <label>Dataset description</label>
                  <textarea
                    rows={4}
                    value={datasetEdit.description}
                    onChange={(e) =>
                      dispatchDatasetEdit({
                        type: "SET_FIELD",
                        field: "description",
                        value: e.target.value,
                      })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="field">
                  <label>Availability</label>
                  <select
                    value={String(datasetEdit.availability)}
                    onChange={(e) =>
                      dispatchDatasetEdit({
                        type: "SET_FIELD",
                        field: "availability",
                        value: Number(e.target.value),
                      })
                    }
                    disabled={!orgPrivate}
                    style={{ width: "100%" }}
                  >
                    {AVAILABILITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {!orgPrivate && (
                    <span className="hint">
                      Availability is locked to Public because this organization
                      does not have private data enabled.
                    </span>
                  )}
                </div>
                <div className="field">
                  <label>
                    Tags{" "}
                    <span style={{ color: "#b3402f" }}>(required)</span>
                  </label>
                  <TagMultiSelect
                    value={Array.isArray(datasetEdit.tags) ? datasetEdit.tags : []}
                    onChange={(next) =>
                      dispatchDatasetEdit({
                        type: "SET_FIELD",
                        field: "tags",
                        value: next,
                      })
                    }
                    disabled={datasetEdit.submitting}
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button
                  type="button"
                  className="btn btn-ghost"
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
                  {datasetEdit.submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dataset Delete Confirmation Modal */}
      {showDatasetDeleteModal && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDatasetDeleteModal(false);
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <h3>Confirm dataset deletion</h3>
              <p>This action cannot be undone.</p>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.55 }}>
                Are you sure you want to delete this dataset? This will permanently
                delete the dataset and all associated files.
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-ghost"
                onClick={() => setShowDatasetDeleteModal(false)}
                disabled={deletingDataset}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "#b3402f", borderColor: "#b3402f" }}
                onClick={handleDeleteDataset}
                disabled={deletingDataset}
              >
                {deletingDataset ? "Deleting…" : "Delete dataset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Delete Confirmation Modal */}
      {showFileDeleteModal && fileToDelete && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowFileDeleteModal(false);
              setFileToDelete(null);
            }
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <h3>Confirm file deletion</h3>
              <p>This action cannot be undone.</p>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.55 }}>
                Are you sure you want to delete the file "{fileToDelete.file_title}"?
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowFileDeleteModal(false);
                  setFileToDelete(null);
                }}
                disabled={deletingFileId === fileToDelete.file_id}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "#b3402f", borderColor: "#b3402f" }}
                onClick={handleDeleteFile}
                disabled={deletingFileId === fileToDelete.file_id}
              >
                {deletingFileId === fileToDelete.file_id ? "Deleting…" : "Delete file"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Edit Modal */}
      {showFileEditModal && fileToEdit && (
        <div
          className="cmdk-overlay show"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) dispatchFileEdit({ type: "CLOSE" });
          }}
        >
          <div className="modal-card" style={{ maxWidth: "640px" }}>
            <form onSubmit={handleEditFileSubmit}>
              <div className="modal-head">
                <h3>Edit file</h3>
                <p>Update metadata for {fileToEdit.file_title || "this file"}.</p>
              </div>
              <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                {fileEdit.error && (
                  <div className="attn attn-card warn" role="alert" style={{ marginBottom: "14px" }}>
                    <span>{fileEdit.error}</span>
                  </div>
                )}
                <div className="field">
                  <label>
                    File title <span style={{ color: "#b3402f" }}>(required)</span>
                  </label>
                  <input
                    type="text"
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
                <div className="field">
                  <label>File description</label>
                  <textarea
                    rows={3}
                    value={fileEdit.description}
                    onChange={(e) =>
                      dispatchFileEdit({
                        type: "SET_FIELD",
                        field: "description",
                        value: e.target.value,
                      })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="field">
                  <label>Provenance</label>
                  <input
                    type="text"
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
                <div className="field">
                  <label>Source</label>
                  <input
                    type="text"
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
                <div className="field">
                  <label>Cite as</label>
                  <textarea
                    rows={2}
                    value={fileEdit.citeAs}
                    onChange={(e) =>
                      dispatchFileEdit({
                        type: "SET_FIELD",
                        field: "citeAs",
                        value: e.target.value,
                      })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="field">
                  <label>Groundtruthed</label>
                  <div style={{ display: "flex", gap: "18px", alignItems: "center" }}>
                    <label style={{ display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 }}>
                      <input
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
                      No
                    </label>
                    <label style={{ display: "flex", gap: "6px", alignItems: "center", fontWeight: 400 }}>
                      <input
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
                      Yes
                    </label>
                  </div>
                </div>
                <div className="field">
                  <label>Permissions</label>
                  <select
                    value={fileEdit.permissions}
                    onChange={(e) =>
                      dispatchFileEdit({
                        type: "SET_FIELD",
                        field: "permissions",
                        value: e.target.value,
                      })
                    }
                    style={{ width: "100%" }}
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
                <div className="field">
                  <label>Duration</label>
                  <input
                    type="number"
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
                <div className="field-row">
                  <div className="field">
                    <label>Temporal coverage from</label>
                    <input
                      type="datetime-local"
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
                  <div className="field">
                    <label>Temporal coverage to</label>
                    <input
                      type="datetime-local"
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
                </div>
                <div className="field">
                  <label>Geographical extent</label>
                  <textarea
                    rows={3}
                    value={fileEdit.geography}
                    onChange={(e) =>
                      dispatchFileEdit({
                        type: "SET_FIELD",
                        field: "geography",
                        value: e.target.value,
                      })
                    }
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button
                  type="button"
                  className="btn btn-ghost"
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
                  {fileEdit.submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DatasetInfo;
