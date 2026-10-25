import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  access_file_endpoint,
  access_file_status_endpoint,
  download_url_endpoint,
} from "../api/endpoints";
import Ic from "../components/wd/Icons";
import Contour from "../components/wd/Contour";

const DocumentViewer = lazy(() => import("../components/visualize/DocumentViewer"));
const TableChartViewer = lazy(() => import("../components/visualize/TableChartViewer"));
const VectorMapViewer = lazy(() => import("../components/visualize/VectorMapViewer"));
const RasterMapViewer = lazy(() => import("../components/visualize/RasterMapViewer"));
const MediaViewer = lazy(() => import("../components/visualize/MediaViewer"));

const POLL_MS = 2000;
// Matches the conversion worker time limit (cpu.convert_file, 2100s).
const TIMEOUT_MS = 2100 * 1000;

export default function FilePreview() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fileId = params.get("file_id") || "";
  const title = params.get("title") || "File preview";
  const datasetId = params.get("dataset_id") || "";

  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [payload, setPayload] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const applyPayload = useCallback((data) => {
    if (data.status === "available") {
      setPayload(data);
      setStatus("ready");
      setErrorMsg("");
      return "ready";
    }
    if (data.status === "processing") {
      setStatus("processing");
      return "processing";
    }
    setPayload(data);
    setStatus("error");
    setErrorMsg(data.error || "Conversion failed.");
    return "error";
  }, []);

  const load = useCallback(async () => {
    if (!fileId) {
      setStatus("error");
      setErrorMsg("No file was specified for preview.");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const resp = await fetch(`${access_file_endpoint}?${new URLSearchParams({ file_id: fileId })}`, {
        method: "GET",
        credentials: "include",
      });
      if (!resp.ok) {
        let detail = "Could not open this file.";
        try {
          const j = await resp.json();
          detail = j.detail || detail;
        } catch {
          /* ignore */
        }
        if (resp.status === 403) detail = "You do not have permission to view this file.";
        if (resp.status === 404 && detail === "Could not open this file.") {
          detail = "This file no longer exists.";
        }
        if (resp.status === 400 && !detail) detail = "This file type cannot be visualised.";
        throw new Error(detail);
      }
      const data = await resp.json();
      applyPayload(data);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong while opening this file.");
    }
  }, [fileId, applyPayload]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (status !== "processing") return undefined;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > TIMEOUT_MS) {
        clearInterval(timer);
        setStatus("error");
        setErrorMsg("Conversion timed out. Try again later.");
        return;
      }
      try {
        const resp = await fetch(`${access_file_status_endpoint}?${new URLSearchParams({ file_id: fileId })}`, {
          credentials: "include",
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const next = applyPayload(data);
        if (next !== "processing") clearInterval(timer);
      } catch {
        /* keep polling */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, fileId, applyPayload]);

  const handleDownload = useCallback(async () => {
    if (!fileId || downloading) return;
    setDownloading(true);
    try {
      const resp = await fetch(`${download_url_endpoint}?${new URLSearchParams({ file_id: fileId })}`, {
        method: "GET",
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Could not start download.");
      const data = await resp.json();
      const url = data.download_url || data.presigned_download_url;
      if (!url) throw new Error("The server did not return a download link.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErrorMsg(e.message || "Download failed.");
    } finally {
      setDownloading(false);
    }
  }, [fileId, downloading]);

  useEffect(() => {
    document.title = `Preview · ${title}`;
  }, [title]);

  const backHref = datasetId ? `/dataset-info?dataset_id=${encodeURIComponent(datasetId)}` : "/datasets";
  const viewer = payload?.viewer;
  const chartLayout = status === "ready" && viewer === "table_chart";

  useEffect(() => {
    if (!chartLayout) return undefined;
    document.body.classList.add("chart-preview");
    return () => document.body.classList.remove("chart-preview");
  }, [chartLayout]);

  return (
    <div className={"page preview-page" + (chartLayout ? " preview-page-full" : "")}>
      <section className="preview-hero">
        <Contour op={0.35} />
        <div className={chartLayout ? "preview-hero-full preview-hero-inner" : "wrap preview-hero-inner"}>
          <div>
            <span className="eyebrow">File preview</span>
            <h1 className="display preview-title">{title}</h1>
          </div>
          <div className="preview-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDownload}
              disabled={!fileId || downloading}
            >
              
              <Ic name="dl" size={15} sw={2} />
              {downloading ? "Preparing…" : "Download"}
            </button>
            <Link className="btn btn-ghost" to={backHref}>
              {datasetId ? "Back to dataset" : "Datasets"}
            </Link>
          </div>
        </div>
      </section>

      <div className={chartLayout ? "preview-chart-page" : "wrap"}>
        <div className={chartLayout ? "preview-chart-stage" : "preview-stage"}>
          {(status === "loading" || status === "processing") && (
            <div className="empty">
              <p>
                {status === "processing"
                  ? "Preparing a cloud-native preview… this can take a minute."
                  : "Loading preview…"}
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="preview-empty">
              <div className="eic"><Ic name="warn" size={22} /></div>
              <h3 className="display">Preview unavailable</h3>
              <p>{errorMsg}</p>
              <div className="preview-actions">
                <button type="button" className="btn btn-ghost" onClick={load} disabled={!fileId}>
                  Retry preview
                </button>
                <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={!fileId || downloading}>
                  <Ic name="dl" size={15} sw={2} /> Download the file
                </button>
              </div>
            </div>
          )}

          {status === "ready" && (
            <Suspense fallback={<div className="empty"><p>Loading viewer…</p></div>}>
              {viewer === "document" && (
                <DocumentViewer url={payload.access_url} title={title} />
              )}
              {viewer === "table_chart" && (
                <TableChartViewer fileId={fileId} />
              )}
              {viewer === "vector_map" && (
                <VectorMapViewer url={payload.access_url} format={payload.format} />
              )}
              {viewer === "raster_map" && (
                <RasterMapViewer
                  accessUrl={payload.access_url}
                  titilerUrl={payload.titiler_url}
                  bidx={payload.bidx}
                  rescale={payload.rescale}
                  colormapName={payload.colormap_name}
                />
              )}
              {(viewer === "image" || viewer === "text" || viewer === "media" || viewer === "embed") && (
                <MediaViewer
                  url={payload.access_url}
                  format={payload.format}
                  kind={viewer === "embed" ? "embed" : viewer}
                  title={title}
                />
              )}
              {!viewer && (
                <div className="preview-empty">
                  <h3 className="display">No in-browser preview</h3>
                  <p>This file type cannot be shown here.</p>
                </div>
              )}
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
