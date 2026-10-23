import React, { useEffect, useMemo, useRef, useState } from "react";
import { access_file_chart_endpoint, access_file_schema_endpoint } from "../../api/endpoints";

const CHART_COLOURS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#dc2626", "#ca8a04", "#4f46e5",
];

function isNumericType(t) {
  const s = String(t || "").toUpperCase();
  return ["INTEGER", "BIGINT", "HUGEINT", "DOUBLE", "FLOAT", "DECIMAL", "REAL", "SMALLINT", "TINYINT", "UBIGINT"].some((n) => s.includes(n));
}

function D3Chart({ points, series, chartType }) {
  const hostRef = useRef(null);
  const [d3, setD3] = useState(null);
  const [hover, setHover] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    import("d3").then((mod) => {
      if (!cancelled) setD3(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.floor(rect.width),
        h: Math.floor(rect.height),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!d3 || !points.length || size.w < 1 || size.h < 1) return null;
    const W = size.w;
    const H = size.h;
    const m = { top: 24, right: 28, bottom: 96, left: 96 };
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
  }, [d3, points, series, size]);

  if (!series.length) {
    return <div className="preview-chart-plot" style={styles.chartEmpty}>Select a Y-axis column.</div>;
  }
  if (!points.length) {
    return <div className="preview-chart-plot" style={styles.chartEmpty}>No aggregated values to plot.</div>;
  }

  const ticks = layout ? layout.y.ticks(6) : [];
  const labelEvery = layout
    ? Math.max(1, Math.ceil(points.length / Math.max(12, Math.floor(layout.W / 72))))
    : 1;

  return (
    <>
    <div ref={hostRef} className="preview-chart-plot">
      {!layout && <div className="empty"><p>Drawing chart…</p></div>}
      {layout && (
      <svg viewBox={`0 0 ${layout.W} ${layout.H}`} width="100%" height="100%" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={layout.m.left} y1={layout.y(t)} x2={layout.W - layout.m.right} y2={layout.y(t)} stroke="#e5e7eb" />
            <text x={layout.m.left - 12} y={layout.y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{t}</text>
          </g>
        ))}
        <line x1={layout.m.left} y1={layout.m.top} x2={layout.m.left} y2={layout.H - layout.m.bottom} stroke="#9ca3af" strokeWidth="1.5" />
        <line x1={layout.m.left} y1={layout.y(0)} x2={layout.W - layout.m.right} y2={layout.y(0)} stroke="#9ca3af" strokeWidth="1.5" />
        {chartType === "bar"
          ? points.map((p, i) => {
              const band = layout.x.bandwidth();
              const barW = band / Math.max(series.length, 1);
              return (
                <g key={i}>
                  {series.map((_, k) => {
                    const v = p[`y${k}`];
                    if (v == null) return null;
                    const bh = Math.abs(layout.y(v) - layout.y(0));
                    return (
                      <rect
                        key={k}
                        x={layout.x(String(p.x)) + k * barW}
                        y={Math.min(layout.y(v), layout.y(0))}
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
                .x((p) => layout.x(String(p.x)) + layout.x.bandwidth() / 2)
                .y((p) => layout.y(p[`y${k}`]));
              return (
                <g key={k}>
                  <path d={line(points)} fill="none" stroke={CHART_COLOURS[k % CHART_COLOURS.length]} strokeWidth="2" />
                </g>
              );
            })}
        {points.map((p, i) => (i % labelEvery !== 0 ? null : (
          <text
            key={`x${i}`}
            x={layout.x(String(p.x)) + layout.x.bandwidth() / 2}
            y={layout.H - layout.m.bottom + 18}
            textAnchor="end"
            fontSize="11"
            fill="#6b7280"
            transform={`rotate(-40 ${layout.x(String(p.x)) + layout.x.bandwidth() / 2} ${layout.H - layout.m.bottom + 18})`}
          >
            {String(p.x).length > 18 ? `${String(p.x).slice(0, 17)}…` : String(p.x)}
          </text>
        )))}
      </svg>
      )}
      {hover && layout && (
        <div style={styles.tooltip}>
          <strong>{String(hover.x)}</strong>
          {series.map((s, k) => (
            <div key={s}>{s}: {hover[`y${k}`] == null ? "—" : hover[`y${k}`]}</div>
          ))}
        </div>
      )}
    </div>
    <div style={styles.legend}>
      {series.map((s, k) => (
        <span key={s} style={styles.legendItem}>
          <span style={{ ...styles.legendSwatch, background: CHART_COLOURS[k % CHART_COLOURS.length] }} />
          {s}
        </span>
      ))}
    </div>
    </>
  );
}

export default function TableChartViewer({ fileId }) {
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("bar");
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");
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
        const xName = (nonNumeric[0] || cols[0] || {}).name || "";
        const yName = (numeric[0] || cols.find((c) => c.name !== xName) || cols[0] || {}).name || "";
        setXCol(xName);
        setYCol(yName);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load schema.");
      }
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  const loadChart = async () => {
    if (!xCol || !yCol) return;
    setError("");
    try {
      const resp = await fetch(access_file_chart_endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileId,
          x_column: xCol,
          y_columns: [{ column: yCol, aggregation: "sum" }],
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
    if (xCol && yCol) {
      loadChart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xCol, yCol]);

  const columns = schema?.columns || [];

  return (
    <div className="preview-chart">
      <div className="preview-chart-controls">
        <label style={styles.control}>
          <span style={styles.controlLabel}>Chart</span>
          <select value={chartType} onChange={(e) => setChartType(e.target.value)} style={styles.select}>
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
        </label>
        <label style={styles.control}>
          <span style={styles.controlLabel}>X-axis</span>
          <select value={xCol} onChange={(e) => setXCol(e.target.value)} style={styles.select}>
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label style={styles.control}>
          <span style={styles.controlLabel}>Y-axis</span>
          <select value={yCol} onChange={(e) => setYCol(e.target.value)} style={styles.select}>
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        {schema?.row_count != null && (
          <span className="muted">{Number(schema.row_count).toLocaleString("en-IN")} rows</span>
        )}
      </div>
      {error && <p className="muted" style={{ color: "#9a6b12" }}>{error}</p>}
      {chart && (
        <D3Chart points={chart.points || []} series={chart.series || []} chartType={chartType} />
      )}
    </div>
  );
}

const styles = {
  control: { display: "flex", flexDirection: "column", gap: 6 },
  controlLabel: { fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 },
  select: { padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D7CE", background: "#fff", fontSize: 14, minWidth: 180 },
  chartEmpty: { padding: "50px 0", textAlign: "center", color: "#667085" },
  legend: { display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap", marginTop: 8, flex: "none" },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#31404f" },
  legendSwatch: { width: 14, height: 14, borderRadius: 3, display: "inline-block" },
  tooltip: { position: "absolute", top: 8, right: 8, background: "rgba(11,31,51,0.92)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 12, pointerEvents: "none", minWidth: 120 },
};
