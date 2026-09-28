import React, { useEffect, useMemo, useState } from "react";
import { access_file_chart_endpoint, access_file_schema_endpoint, access_file_table_endpoint } from "../../api/endpoints";

const CHART_COLOURS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#dc2626", "#ca8a04", "#4f46e5",
];

function isNumericType(t) {
  const s = String(t || "").toUpperCase();
  return ["INTEGER", "BIGINT", "HUGEINT", "DOUBLE", "FLOAT", "DECIMAL", "REAL", "SMALLINT", "TINYINT", "UBIGINT"].some((n) => s.includes(n));
}

function D3Chart({ points, series, chartType }) {
  const [d3, setD3] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let cancelled = false;
    import("d3").then((mod) => {
      if (!cancelled) setD3(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const layout = useMemo(() => {
    if (!d3 || !points.length) return null;
    const W = 920;
    const H = 460;
    const m = { top: 24, right: 24, bottom: 90, left: 92 };
    const x = d3.scaleBand().domain(points.map((p) => String(p.x))).range([m.left, W - m.right]).padding(0.18);
    let ymin = 0;
    let ymax = 0;
    points.forEach((p) => {
      series.forEach((_, i) => {
        const v = p[`y${i}`];
        if (v == null) return;
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      });
    });
    if (ymin === ymax) ymax = ymin + 1;
    const y = d3.scaleLinear().domain([ymin, ymax]).nice().range([H - m.bottom, m.top]);
    return { W, H, m, x, y, ymin, ymax };
  }, [d3, points, series]);

  if (!d3 || !layout) return <div className="empty"><p>Drawing chart…</p></div>;
  if (!series.length) return <div style={styles.chartEmpty}>Select at least one Y-axis column.</div>;
  if (!points.length) return <div style={styles.chartEmpty}>No aggregated values to plot.</div>;

  const { W, H, m, x, y } = layout;
  const ticks = y.ticks(5);
  const n = points.length;
  const labelEvery = Math.max(1, Math.ceil(n / 18));

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block", margin: "0 auto" }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} y1={y(t)} x2={W - m.right} y2={y(t)} stroke="#e5e7eb" />
            <text x={m.left - 12} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{t}</text>
          </g>
        ))}
        <line x1={m.left} y1={m.top} x2={m.left} y2={H - m.bottom} stroke="#9ca3af" strokeWidth="1.5" />
        <line x1={m.left} y1={y(0)} x2={W - m.right} y2={y(0)} stroke="#9ca3af" strokeWidth="1.5" />
        {chartType === "bar"
          ? points.map((p, i) => {
              const band = x.bandwidth();
              const barW = band / Math.max(series.length, 1);
              return (
                <g key={i}>
                  {series.map((_, k) => {
                    const v = p[`y${k}`];
                    if (v == null) return null;
                    const bh = Math.abs(y(v) - y(0));
                    return (
                      <rect
                        key={k}
                        x={x(String(p.x)) + k * barW}
                        y={Math.min(y(v), y(0))}
                        width={Math.max(barW - 2, 1)}
                        height={Math.max(bh, 0.5)}
                        fill={CHART_COLOURS[k % CHART_COLOURS.length]}
                        onMouseEnter={() => setHover(p)}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              );
            })
          : series.map((_, k) => {
              const line = d3.line()
                .defined((p) => p[`y${k}`] != null)
                .x((p) => x(String(p.x)) + x.bandwidth() / 2)
                .y((p) => y(p[`y${k}`]));
              return (
                <g key={k}>
                  <path d={line(points)} fill="none" stroke={CHART_COLOURS[k % CHART_COLOURS.length]} strokeWidth="2" />
                </g>
              );
            })}
        {points.map((p, i) => (i % labelEvery !== 0 ? null : (
          <text
            key={`x${i}`}
            x={x(String(p.x)) + x.bandwidth() / 2}
            y={H - m.bottom + 18}
            textAnchor="end"
            fontSize="11"
            fill="#6b7280"
            transform={`rotate(-40 ${x(String(p.x)) + x.bandwidth() / 2} ${H - m.bottom + 18})`}
          >
            {String(p.x).length > 18 ? `${String(p.x).slice(0, 17)}…` : String(p.x)}
          </text>
        )))}
      </svg>
      <div style={styles.legend}>
        {series.map((s, k) => (
          <span key={s} style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, background: CHART_COLOURS[k % CHART_COLOURS.length] }} />
            {s}
          </span>
        ))}
      </div>
      {hover && (
        <div style={styles.tooltip}>
          <strong>{String(hover.x)}</strong>
          {series.map((s, k) => (
            <div key={s}>{s}: {hover[`y${k}`] == null ? "—" : hover[`y${k}`]}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TableChartViewer({ fileId }) {
  const [mode, setMode] = useState("table");
  const [schema, setSchema] = useState(null);
  const [table, setTable] = useState(null);
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("bar");
  const [xCol, setXCol] = useState("");
  const [yCols, setYCols] = useState([]);
  const [agg, setAgg] = useState("sum");
  const [chart, setChart] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${access_file_schema_endpoint}?${new URLSearchParams({ file_id: fileId })}`, {
          credentials: "include",
        });
        if (!resp.ok) throw new Error("Could not read table schema.");
        const data = await resp.json();
        if (cancelled) return;
        setSchema(data);
        const cols = data.columns || [];
        const numeric = cols.filter((c) => isNumericType(c.type));
        const nonNumeric = cols.filter((c) => !isNumericType(c.type));
        setXCol((nonNumeric[0] || cols[0] || {}).name || "");
        setYCols(numeric[0] ? [numeric[0].name] : []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load schema.");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  useEffect(() => {
    if (mode !== "table") return undefined;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${access_file_table_endpoint}?${new URLSearchParams({ file_id: fileId, limit: "200", offset: "0" })}`, {
          credentials: "include",
        });
        if (!resp.ok) throw new Error("Could not load table rows.");
        const data = await resp.json();
        if (!cancelled) setTable(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load table.");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, mode]);

  const loadChart = async () => {
    if (!xCol || yCols.length === 0) return;
    setError("");
    try {
      const resp = await fetch(access_file_chart_endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileId,
          x_column: xCol,
          y_columns: yCols.map((c) => ({ column: c, aggregation: agg })),
          limit: 200,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.detail || "Chart aggregation failed.");
      }
      setChart(await resp.json());
    } catch (e) {
      setError(e.message || "Chart aggregation failed.");
    }
  };

  useEffect(() => {
    if (mode === "chart" && xCol && yCols.length) {
      loadChart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, xCol, yCols.join("|"), agg]);

  const toggleY = (name) => {
    setYCols((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  };

  const columns = schema?.columns || [];

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.segmented}>
          <button type="button" onClick={() => setMode("table")} style={mode === "table" ? styles.segOn : styles.segOff}>Table</button>
          <button type="button" onClick={() => setMode("chart")} style={mode === "chart" ? styles.segOn : styles.segOff}>Chart</button>
        </div>
        {schema?.row_count != null && (
          <span className="muted">{Number(schema.row_count).toLocaleString("en-IN")} rows</span>
        )}
      </div>
      {error && <p className="muted" style={{ color: "#9a6b12" }}>{error}</p>}
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
            <span style={styles.controlLabel}>Aggregation</span>
            <select value={agg} onChange={(e) => setAgg(e.target.value)} style={styles.select}>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label style={styles.control}>
            <span style={styles.controlLabel}>X-axis</span>
            <select value={xCol} onChange={(e) => setXCol(e.target.value)} style={styles.select}>
              {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <div style={styles.control}>
            <span style={styles.controlLabel}>Y-axis</span>
            <div style={styles.yList}>
              {columns.map((c) => (
                <label key={c.name} style={styles.yItem}>
                  <input type="checkbox" checked={yCols.includes(c.name)} onChange={() => toggleY(c.name)} />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
      {mode === "table" && table && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.thIndex }}>#</th>
                {(table.headers || []).map((h) => <th key={h} style={styles.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(table.rows || []).map((r, i) => (
                <tr key={i} style={i % 2 ? styles.trAlt : undefined}>
                  <td style={{ ...styles.td, ...styles.tdIndex }}>{i + 1 + (table.offset || 0)}</td>
                  {r.map((cell, ci) => (
                    <td key={ci} style={styles.td}>{cell == null ? "" : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === "chart" && chart && (
        <D3Chart points={chart.points || []} series={chart.series || []} chartType={chartType} />
      )}
    </div>
  );
}

const styles = {
  toolbar: { display: "flex", gap: 16, alignItems: "center", marginBottom: 16, flexWrap: "wrap" },
  segmented: { display: "inline-flex", background: "#EFEEE8", borderRadius: 8, padding: 3 },
  segOn: { border: "none", background: "#0B1F33", color: "#fff", padding: "7px 18px", borderRadius: 6, fontWeight: 600, cursor: "pointer" },
  segOff: { border: "none", background: "transparent", color: "#334155", padding: "7px 18px", borderRadius: 6, fontWeight: 600, cursor: "pointer" },
  chartControls: { display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap", background: "#FCFCFA", border: "1px solid #E7E6DF", borderRadius: 10, padding: 16, marginBottom: 16 },
  control: { display: "flex", flexDirection: "column", gap: 6 },
  controlLabel: { fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 },
  select: { padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D7CE", background: "#fff", fontSize: 14, minWidth: 140 },
  yList: { display: "flex", flexWrap: "wrap", gap: "6px 14px", maxWidth: 520, maxHeight: 132, overflow: "auto" },
  yItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 },
  tableWrap: { background: "#FCFCFA", border: "1px solid #E7E6DF", borderRadius: 10, overflow: "auto", maxHeight: "78vh" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th: { position: "sticky", top: 0, background: "#F3F4EF", textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #E7E6DF", fontWeight: 700, whiteSpace: "nowrap", zIndex: 1 },
  thIndex: { left: 0, zIndex: 2 },
  td: { padding: "8px 12px", borderBottom: "1px solid #EFEEE8", whiteSpace: "nowrap", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" },
  tdIndex: { color: "#8a93a0", background: "#F7F7F3", position: "sticky", left: 0 },
  trAlt: { background: "#FBFCF8" },
  chartEmpty: { padding: "50px 0", textAlign: "center", color: "#667085", background: "#FCFCFA", border: "1px dashed #D8D7CE", borderRadius: 10 },
  legend: { display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap", marginTop: 10 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#31404f" },
  legendSwatch: { width: 14, height: 14, borderRadius: 3, display: "inline-block" },
  tooltip: { position: "absolute", top: 8, right: 8, background: "rgba(11,31,51,0.92)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", minWidth: 120 },
};
