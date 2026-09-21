import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { download_url_endpoint, preview_url_endpoint } from "../api/endpoints";
import Ic from "../components/wd/Icons";
import Contour from "../components/wd/Contour";

/*
  FilePreview
  -----------
  Standalone preview page opened in a new browser tab from the Files tab of a
  dataset. It resolves a preview URL (does not increment download counts), then
  renders the file according to its type.

    - Spreadsheet (xlsx, xls, csv, tsv): the viewer chooses Table or Chart.
      In Chart mode the user picks the chart type and the X and Y columns.
    - Image: shown inline.
    - PDF: shown in an embedded frame.
    - JSON / GeoJSON: pretty printed.
    - Plain text, markdown: shown as text.
    - Anything else: a download link.

  Spreadsheet parsing needs to read the file bytes with fetch(), which requires
  the object store (S3) to allow cross-origin GET from this site. If that CORS
  rule is missing the fetch fails; the page then explains this and offers a
  direct download instead.
*/

// ---------- helpers ----------

const SPREADSHEET_EXT = ["xlsx", "xlsm", "xlsb", "xls", "csv", "tsv"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff"];
const TEXT_EXT = ["txt", "md", "markdown", "log", "yaml", "yml"];

function getExtension(name, format) {
  const fromName = (name || "").split("?")[0].split("#")[0].split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) {
    return fromName.toLowerCase();
  }
  const f = (format || "").toLowerCase().trim();
  if (f.includes("excel") || f.includes("spreadsheetml") || f.includes("sheet")) return "xlsx";
  if (f.includes("csv")) return "csv";
  if (f.includes("tsv")) return "tsv";
  if (f.includes("geojson")) return "geojson";
  if (f.includes("json")) return "json";
  if (f.includes("pdf")) return "pdf";
  const m = f.match(/[a-z0-9]+/g);
  return m ? m[m.length - 1] : "";
}

function classifyKind(ext) {
  if (SPREADSHEET_EXT.includes(ext)) return "spreadsheet";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "geojson" || ext === "json") return "json";
  if (TEXT_EXT.includes(ext)) return "text";
  return "other";
}

function isNumericColumn(rows, colIndex) {
  let seen = 0;
  let numeric = 0;
  for (let i = 0; i < rows.length && seen < 40; i += 1) {
    const v = rows[i][colIndex];
    if (v === null || v === undefined || v === "") continue;
    seen += 1;
    if (typeof v === "number" && Number.isFinite(v)) numeric += 1;
    else if (!Number.isNaN(Number(String(v).replace(/,/g, "")))) numeric += 1;
  }
  return seen > 0 && numeric / seen >= 0.6;
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

function trimZeros(n) {
  return Number(n.toFixed(2)).toLocaleString("en-IN");
}

function formatTick(v) {
  const a = Math.abs(v);
  if (a >= 1e7) return trimZeros(v / 1e7) + "Cr";
  if (a >= 1e5) return trimZeros(v / 1e5) + "L";
  if (a >= 1e3) return trimZeros(v / 1e3) + "K";
  return trimZeros(v);
}

const CHART_COLOURS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#dc2626", "#ca8a04", "#4f46e5",
];

const MAX_CHART_POINTS = 500;

// ---------- SVG chart ----------

function SimpleChart({ rows, headers, xCol, yCols, chartType }) {
  const [hover, setHover] = useState(null);

  const data = useMemo(() => {
    const pts = [];
    for (let i = 0; i < rows.length; i += 1) {
      const label = rows[i][xCol];
      const values = yCols.map((c) => toNumber(rows[i][c]));
      if (values.every((v) => v === null)) continue;
      pts.push({ label: label === undefined || label === null ? "" : String(label), values });
      if (pts.length >= MAX_CHART_POINTS) break;
    }
    return pts;
  }, [rows, xCol, yCols]);

  if (yCols.length === 0) {
    return <div style={styles.chartEmpty}>Select at least one Y-axis column to draw the chart.</div>;
  }
  if (data.length === 0) {
    return <div style={styles.chartEmpty}>No numeric values found for the selected Y column(s).</div>;
  }

  const W = 920;
  const H = 460;
  const padL = 92;
  const padR = 24;
  const padT = 24;
  const padB = 90;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let min = Infinity;
  let max = -Infinity;
  data.forEach((p) => p.values.forEach((v) => {
    if (v === null) return;
    if (v < min) min = v;
    if (v > max) max = v;
  }));
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (min === max) max = min + 1;

  const yToPx = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;
  const n = data.length;
  const bandW = plotW / n;

  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);
  const labelEvery = Math.ceil(n / 18);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block", margin: "0 auto" }} role="img">
        {/* gridlines + y labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={yToPx(t)} x2={W - padR} y2={yToPx(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 12} y={yToPx(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#9ca3af" strokeWidth="1.5" />
        <line x1={padL} y1={yToPx(0)} x2={W - padR} y2={yToPx(0)} stroke="#9ca3af" strokeWidth="1.5" />

        {/* marks */}
        {chartType === "bar"
          ? data.map((p, i) => {
              const groupW = bandW * 0.72;
              const barW = groupW / yCols.length;
              const x0 = padL + i * bandW + (bandW - groupW) / 2;
              return (
                <g key={`b${i}`}>
                  {p.values.map((v, k) => {
                    if (v === null) return null;
                    const x = x0 + k * barW;
                    const y = yToPx(Math.max(v, 0));
                    const h = Math.abs(yToPx(v) - yToPx(0));
                    return (
                      <rect
                        key={k}
                        x={x}
                        y={y}
                        width={Math.max(barW - 2, 1)}
                        height={Math.max(h, 0.5)}
                        fill={CHART_COLOURS[k % CHART_COLOURS.length]}
                        onMouseEnter={() => setHover({ i, label: p.label, values: p.values })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              );
            })
          : yCols.map((c, k) => {
              const path = data
                .map((p, i) => {
                  const v = p.values[k];
                  if (v === null) return null;
                  const x = padL + i * bandW + bandW / 2;
                  return `${x},${yToPx(v)}`;
                })
                .filter(Boolean)
                .join(" ");
              return (
                <g key={`l${k}`}>
                  <polyline points={path} fill="none" stroke={CHART_COLOURS[k % CHART_COLOURS.length]} strokeWidth="2" />
                  {data.map((p, i) => {
                    const v = p.values[k];
                    if (v === null) return null;
                    const x = padL + i * bandW + bandW / 2;
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={yToPx(v)}
                        r="3"
                        fill={CHART_COLOURS[k % CHART_COLOURS.length]}
                        onMouseEnter={() => setHover({ i, label: p.label, values: p.values })}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              );
            })}

        {/* x labels */}
        {data.map((p, i) => {
          if (i % labelEvery !== 0) return null;
          const x = padL + i * bandW + bandW / 2;
          return (
            <text
              key={`x${i}`}
              x={x}
              y={padT + plotH + 18}
              textAnchor="end"
              fontSize="11"
              fill="#6b7280"
              transform={`rotate(-40 ${x} ${padT + plotH + 18})`}
            >
              {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
            </text>
          );
        })}
      </svg>

      {/* legend */}
      <div style={styles.legend}>
        {yCols.map((c, k) => (
          <span key={c} style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, background: CHART_COLOURS[k % CHART_COLOURS.length] }} />
            {headers[c]}
          </span>
        ))}
      </div>

      {hover && (
        <div style={styles.tooltip}>
          <strong>{hover.label || "(blank)"}</strong>
          {yCols.map((c, k) => (
            <div key={c}>
              {headers[c]}: {hover.values[k] === null ? "—" : hover.values[k].toLocaleString("en-IN")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- table ----------

function DataTable({ headers, rows }) {
  const shown = rows.slice(0, 500);
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, ...styles.thIndex }}>#</th>
            {headers.map((h, i) => (
              <th key={i} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} style={ri % 2 ? styles.trAlt : undefined}>
              <td style={{ ...styles.td, ...styles.tdIndex }}>{ri + 1}</td>
              {headers.map((_, ci) => (
                <td key={ci} style={styles.td}>
                  {r[ci] === null || r[ci] === undefined ? "" : String(r[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div style={styles.tableNote}>
          Showing first {shown.length.toLocaleString("en-IN")} of {rows.length.toLocaleString("en-IN")} rows.
        </div>
      )}
    </div>
  );
}

// ---------- spreadsheet viewer ----------

function SpreadsheetView({ arrayBuffer, onDownload }) {
  const [workbook, setWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [parseError, setParseError] = useState("");
  const [mode, setMode] = useState("table"); // table | chart
  const [chartType, setChartType] = useState("bar");
  const [xCol, setXCol] = useState(0);
  const [yCols, setYCols] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(arrayBuffer, { type: "array" });
        if (cancelled) return;
        setWorkbook(wb);
        setSheetName(wb.SheetNames[0] || "");
      } catch (e) {
        if (!cancelled) setParseError("Could not parse this file as a spreadsheet.");
        // eslint-disable-next-line no-console
        console.error("Spreadsheet parse error", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arrayBuffer]);

  const { headers, rows } = useMemo(() => {
    if (!workbook || !sheetName) return { headers: [], rows: [] };
    // eslint-disable-next-line global-require
    const XLSX = require("xlsx");
    const ws = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    if (aoa.length === 0) return { headers: [], rows: [] };
    const rawHeader = aoa[0] || [];
    const width = aoa.reduce((m, r) => Math.max(m, r.length), rawHeader.length);
    const hdr = Array.from({ length: width }, (_, i) => {
      const h = rawHeader[i];
      return h === null || h === undefined || h === "" ? `Column ${i + 1}` : String(h);
    });
    const body = aoa.slice(1).map((r) => Array.from({ length: width }, (_, i) => (i < r.length ? r[i] : null)));
    return { headers: hdr, rows: body };
  }, [workbook, sheetName]);

  // choose sensible default X and Y once data is available
  useEffect(() => {
    if (headers.length === 0) return;
    const numericCols = headers.map((_, i) => i).filter((i) => isNumericColumn(rows, i));
    const nonNumeric = headers.map((_, i) => i).filter((i) => !numericCols.includes(i));
    setXCol(nonNumeric.length ? nonNumeric[0] : 0);
    setYCols(numericCols.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.length, sheetName]);

  const toggleY = (i) => {
    setYCols((prev) => (prev.includes(i) ? prev.filter((c) => c !== i) : [...prev, i]));
  };

  if (parseError) {
    return (
      <div style={styles.errorBox}>
        <p>{parseError}</p>
        <button type="button" className="btn btn-primary" onClick={onDownload}>
          Download the file
        </button>
      </div>
    );
  }

  if (!workbook) return <div style={styles.loading}>Reading spreadsheet…</div>;

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.segmented}>
          <button
            onClick={() => setMode("table")}
            style={mode === "table" ? styles.segOn : styles.segOff}
          >
            Table
          </button>
          <button
            onClick={() => setMode("chart")}
            style={mode === "chart" ? styles.segOn : styles.segOff}
          >
            Chart
          </button>
        </div>

        {workbook.SheetNames.length > 1 && (
          <label style={styles.control}>
            <span style={styles.controlLabel}>Sheet</span>
            <select value={sheetName} onChange={(e) => setSheetName(e.target.value)} style={styles.select}>
              {workbook.SheetNames.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {mode === "chart" && (
        <div style={styles.chartControls}>
          <label style={styles.control}>
            <span style={styles.controlLabel}>Chart type</span>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)} style={styles.select}>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          </label>
          <label style={styles.control}>
            <span style={styles.controlLabel}>X-axis</span>
            <select value={xCol} onChange={(e) => setXCol(Number(e.target.value))} style={styles.select}>
              {headers.map((h, i) => (
                <option key={i} value={i}>{h}</option>
              ))}
            </select>
          </label>
          <div style={styles.control}>
            <span style={styles.controlLabel}>Y-axis (one or more)</span>
            <div style={styles.yList}>
              {headers.map((h, i) => (
                <label key={i} style={styles.yItem} title={h}>
                  <input type="checkbox" checked={yCols.includes(i)} onChange={() => toggleY(i)} />
                  <span style={styles.yItemText}>{h}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "table" ? (
        <DataTable headers={headers} rows={rows} />
      ) : (
        <SimpleChart rows={rows} headers={headers} xCol={xCol} yCols={yCols} chartType={chartType} />
      )}
    </div>
  );
}

// ---------- page ----------

export default function FilePreview() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fileId = params.get("file_id") || "";
  const title = params.get("title") || "File preview";
  const format = params.get("format") || "";
  const name = params.get("name") || "";
  const datasetId = params.get("dataset_id") || "";

  const ext = useMemo(() => getExtension(name || title, format), [name, title, format]);
  const kind = useMemo(() => classifyKind(ext), [ext]);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [arrayBuffer, setArrayBuffer] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!fileId) {
      setStatus("error");
      setErrorMsg("No file was specified for preview.");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const resp = await fetch(`${preview_url_endpoint}?${new URLSearchParams({ file_id: fileId })}`, {
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
        if (resp.status === 404) detail = "This file no longer exists.";
        throw new Error(detail);
      }
      const data = await resp.json();
      const url = data.download_url || data.preview_url || data.presigned_download_url;
      if (!url) throw new Error("The server did not return a file link.");
      setPreviewUrl(url);

      // Image and PDF render straight from the URL, no byte fetch needed.
      if (kind === "image" || kind === "pdf" || kind === "other") {
        setStatus("ready");
        return;
      }

      // Text, JSON and spreadsheets need the bytes; this needs object-store CORS.
      const fileResp = await fetch(url);
      if (!fileResp.ok) throw new Error("Could not fetch the file contents.");
      if (kind === "spreadsheet") {
        const buf = await fileResp.arrayBuffer();
        setArrayBuffer(new Uint8Array(buf));
      } else {
        const text = await fileResp.text();
        setTextContent(kind === "json" ? prettyJson(text) : text);
      }
      setStatus("ready");
    } catch (e) {
      // A failed byte fetch is most often a missing CORS rule on the bucket.
      const corsHint =
        (kind === "spreadsheet" || kind === "json" || kind === "text") &&
        (e instanceof TypeError || String(e.message).includes("fetch"));
      setStatus("error");
      setErrorMsg(
        corsHint
          ? "The file could not be read for in-browser preview. You can still download it below."
          : e.message || "Something went wrong while opening this file."
      );
      // eslint-disable-next-line no-console
      console.error("Preview load error", e);
    }
  }, [fileId, kind]);

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
    load();
  }, [load]);

  useEffect(() => {
    document.title = `Preview · ${title}`;
  }, [title]);

  const kindLabel = (format || ext || "file").toString().toUpperCase();
  const backHref = datasetId ? `/dataset-info?dataset_id=${encodeURIComponent(datasetId)}` : "/datasets";

  return (
    <div className="page preview-page">
      <section className="preview-hero">
        <Contour op={0.35} />
        <div className="wrap preview-hero-inner">
          <div>
            <span className="eyebrow">File preview</span>
            <h1 className="display preview-title">{title}</h1>
            <p className="preview-meta">
              <span className="fmt-chip">{kindLabel}</span>
              {name ? <span className="muted">{name}</span> : null}
            </p>
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

      <div className="wrap">
        <div className="preview-stage">
          {status === "loading" && (
            <div className="empty">
              <p>Loading preview…</p>
            </div>
          )}

          {status === "error" && (
            <div className="preview-empty">
              <div className="eic"><Ic name="warn" size={22} /></div>
              <h3 className="display">Preview unavailable</h3>
              <p>{errorMsg}</p>
              <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={!fileId || downloading}>
                <Ic name="dl" size={15} sw={2} /> Download the file
              </button>
            </div>
          )}

          {status === "ready" && kind === "spreadsheet" && arrayBuffer && (
            <SpreadsheetView arrayBuffer={arrayBuffer} onDownload={handleDownload} />
          )}

          {status === "ready" && kind === "image" && (
            <div className="preview-media">
              <img src={previewUrl} alt={title} />
            </div>
          )}

          {status === "ready" && kind === "pdf" && (
            <iframe className="preview-frame" title={title} src={previewUrl} />
          )}

          {status === "ready" && (kind === "json" || kind === "text") && (
            <pre className="preview-code">{textContent}</pre>
          )}

          {status === "ready" && kind === "other" && (
            <div className="preview-empty">
              <div className="eic"><Ic name="file" size={22} /></div>
              <h3 className="display">No in-browser preview</h3>
              <p>This file type ({(ext || "unknown").toUpperCase()}) cannot be shown here.</p>
              <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={!fileId || downloading}>
                <Ic name="dl" size={15} sw={2} /> Download the file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// ---------- inline styles ----------

const styles = {
  loading: { padding: "60px 0", textAlign: "center", color: "#667085" },
  toolbar: { display: "flex", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" },
  segmented: { display: "inline-flex", background: "#EFEEE8", borderRadius: 8, padding: 3 },
  segOn: { border: "none", background: "#0B1F33", color: "#fff", padding: "7px 18px", borderRadius: 6, fontWeight: 600, cursor: "pointer" },
  segOff: { border: "none", background: "transparent", color: "#334155", padding: "7px 18px", borderRadius: 6, fontWeight: 600, cursor: "pointer" },
  chartControls: { display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap", background: "#FCFCFA", border: "1px solid #E7E6DF", borderRadius: 10, padding: 16, marginBottom: 16 },
  control: { display: "flex", flexDirection: "column", gap: 6 },
  controlLabel: { fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 },
  select: { padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D7CE", background: "#fff", fontSize: 14, minWidth: 140 },
  yList: { display: "flex", flexWrap: "wrap", gap: "6px 14px", maxWidth: 520, maxHeight: 132, overflow: "auto", padding: "2px 2px" },
  yItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, maxWidth: 240 },
  yItemText: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 },
  tableWrap: { background: "#FCFCFA", border: "1px solid #E7E6DF", borderRadius: 10, overflow: "auto", maxHeight: "78vh" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th: { position: "sticky", top: 0, background: "#F3F4EF", textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #E7E6DF", fontWeight: 700, whiteSpace: "nowrap", zIndex: 1 },
  thIndex: { left: 0, zIndex: 2 },
  td: { padding: "8px 12px", borderBottom: "1px solid #EFEEE8", whiteSpace: "nowrap", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" },
  tdIndex: { color: "#8a93a0", background: "#F7F7F3", position: "sticky", left: 0 },
  trAlt: { background: "#FBFCF8" },
  tableNote: { padding: "10px 12px", fontSize: 12, color: "#667085", borderTop: "1px solid #EFEEE8" },
  chartEmpty: { padding: "50px 0", textAlign: "center", color: "#667085", background: "#FCFCFA", border: "1px dashed #D8D7CE", borderRadius: 10 },
  legend: { display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap", marginTop: 10 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#31404f" },
  legendSwatch: { width: 14, height: 14, borderRadius: 3, display: "inline-block" },
  tooltip: { position: "absolute", top: 8, right: 8, background: "rgba(11,31,51,0.92)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", minWidth: 120 },
  errorBox: { background: "#FCFCFA", border: "1px solid #ecdcb8", borderRadius: 10, padding: 24, color: "#9a6b12", textAlign: "center" },
};
