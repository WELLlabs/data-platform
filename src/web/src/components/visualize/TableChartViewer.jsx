import React, { useEffect, useMemo, useRef, useState } from "react";
import { access_file_chart_endpoint, access_file_schema_endpoint } from "../../api/endpoints";

// Brand-led palette: WELL Labs blue first, then green, amber, and supporting hues.
const CHART_COLOURS = [
  "#1769AA", "#3D7658", "#C9822B", "#7A5BA6",
  "#2A9BB5", "#B5524A", "#8C8A2E", "#4C5FA8",
];

const AGGREGATIONS = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "count", label: "Count" },
];

const compactFmt = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function fmtTick(v) {
  return Math.abs(v) >= 10000 ? compactFmt.format(v) : fullFmt.format(v);
}

function fmtValue(v) {
  return v == null ? "–" : fullFmt.format(v);
}

function xLabel(v) {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s === "-" ? "(blank)" : s;
}

function isNumericType(t) {
  const s = String(t || "").toUpperCase();
  return ["INTEGER", "BIGINT", "HUGEINT", "DOUBLE", "FLOAT", "DECIMAL", "REAL", "SMALLINT", "TINYINT", "UBIGINT"].some((n) => s.includes(n));
}

// Bar with rounded corners on the end away from the baseline.
function barPath(x, y0, y1, w, r) {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  const rad = Math.max(0, Math.min(r, w / 2, h));
  if (y1 <= y0) {
    // positive value: round the top
    return `M${x},${top + h}V${top + rad}Q${x},${top} ${x + rad},${top}H${x + w - rad}Q${x + w},${top} ${x + w},${top + rad}V${top + h}Z`;
  }
  // negative value: round the bottom
  return `M${x},${top}V${top + h - rad}Q${x},${top + h} ${x + rad},${top + h}H${x + w - rad}Q${x + w},${top + h} ${x + w},${top + h - rad}V${top}Z`;
}

function D3Chart({ points, series, chartType, yTitle, xTitle }) {
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
      setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
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
    const labels = points.map((p) => xLabel(p.x));
    const longest = labels.reduce((n, l) => Math.max(n, Math.min(l.length, 18)), 0);
    const left = 72;
    const right = 24;
    const slot = (W - left - right) / points.length;
    const rotate = longest * 6.6 > slot - 8;
    const bottom = rotate ? Math.min(40 + longest * 5.2, 120) : 52;
    const m = { top: 28, right, bottom, left };
    const x = d3.scaleBand().domain(points.map((_, i) => String(i))).range([m.left, W - m.right]).padding(0.28);
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
    const y = d3.scaleLinear().domain([ymin, ymax]).nice(6).range([H - m.bottom, m.top]);
    return { W, H, m, x, y, labels, rotate };
  }, [d3, points, series, size]);

  if (!series.length) {
    return <div className="pc-plot pc-plot-empty">Select a Y-axis column.</div>;
  }
  if (!points.length) {
    return <div className="pc-plot pc-plot-empty">No aggregated values to plot.</div>;
  }

  const ticks = layout ? layout.y.ticks(6) : [];
  const labelEvery = layout
    ? Math.max(1, Math.ceil(points.length / Math.max(12, Math.floor(layout.W / 64))))
    : 1;
  const showValues = chartType === "bar" && series.length === 1 && points.length <= 24;

  const onMove = (e, i) => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    setHover({ i, left: e.clientX - r.left, top: e.clientY - r.top, flip: e.clientX - r.left > r.width - 200 });
  };

  return (
    <>
      <div ref={hostRef} className="pc-plot" onMouseLeave={() => setHover(null)}>
        {!layout && <div className="pc-plot-empty">Drawing chart…</div>}
        {layout && (
          <svg viewBox={`0 0 ${layout.W} ${layout.H}`} width="100%" height="100%" role="img" aria-label={`${yTitle} by ${xTitle}`}>
            {/* grid + y ticks */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={layout.m.left}
                  y1={layout.y(t)}
                  x2={layout.W - layout.m.right}
                  y2={layout.y(t)}
                  className={t === 0 ? "pc-baseline" : "pc-grid"}
                />
                <text x={layout.m.left - 10} y={layout.y(t) + 4} textAnchor="end" className="pc-tick">{fmtTick(t)}</text>
              </g>
            ))}

            {/* y-axis title */}
            <text
              className="pc-axis-title"
              textAnchor="middle"
              transform={`translate(16 ${(layout.m.top + layout.H - layout.m.bottom) / 2}) rotate(-90)`}
            >
              {yTitle}
            </text>

            {/* hover column */}
            {hover && (
              <rect
                className="pc-hover-band"
                x={layout.x(String(hover.i)) - (layout.x.step() * layout.x.paddingInner()) / 2}
                y={layout.m.top}
                width={layout.x.step()}
                height={layout.H - layout.m.bottom - layout.m.top}
              />
            )}

            {chartType === "bar"
              ? points.map((p, i) => {
                  const band = layout.x.bandwidth();
                  const barW = band / Math.max(series.length, 1);
                  const dim = hover && hover.i !== i;
                  return (
                    <g key={i} className={"pc-bar" + (dim ? " is-dim" : "")}>
                      {series.map((_, k) => {
                        const v = p[`y${k}`];
                        if (v == null) return null;
                        const bx = layout.x(String(i)) + k * barW;
                        const y0 = layout.y(0);
                        const y1 = layout.y(v);
                        return (
                          <path
                            key={k}
                            d={barPath(bx, y0, Math.abs(y1 - y0) < 1 ? y0 - (v < 0 ? -1 : 1) : y1, Math.max(barW - 2, 1), 5)}
                            fill={CHART_COLOURS[k % CHART_COLOURS.length]}
                          />
                        );
                      })}
                      {showValues && p.y0 != null && (
                        <text
                          className="pc-value"
                          x={layout.x(String(i)) + band / 2}
                          y={p.y0 >= 0 ? layout.y(p.y0) - 8 : layout.y(p.y0) + 16}
                          textAnchor="middle"
                        >
                          {fmtTick(p.y0)}
                        </text>
                      )}
                    </g>
                  );
                })
              : series.map((_, k) => {
                  const colour = CHART_COLOURS[k % CHART_COLOURS.length];
                  const cx = (i) => layout.x(String(i)) + layout.x.bandwidth() / 2;
                  const line = d3.line()
                    .defined((p) => p[`y${k}`] != null)
                    .x((_p, i) => cx(i))
                    .y((p) => layout.y(p[`y${k}`]))
                    .curve(d3.curveMonotoneX);
                  const area = d3.area()
                    .defined((p) => p[`y${k}`] != null)
                    .x((_p, i) => cx(i))
                    .y0(layout.y(0))
                    .y1((p) => layout.y(p[`y${k}`]))
                    .curve(d3.curveMonotoneX);
                  return (
                    <g key={k}>
                      {series.length === 1 && <path d={area(points)} fill={colour} opacity="0.08" />}
                      <path d={line(points)} fill="none" stroke={colour} strokeWidth="2.25" strokeLinejoin="round" />
                      {points.map((p, i) => (p[`y${k}`] == null ? null : (
                        <circle
                          key={i}
                          cx={cx(i)}
                          cy={layout.y(p[`y${k}`])}
                          r={hover && hover.i === i ? 5 : points.length > 60 ? 0 : 3}
                          fill="#fff"
                          stroke={colour}
                          strokeWidth="2"
                        />
                      )))}
                    </g>
                  );
                })}

            {/* hit targets for hover */}
            {points.map((_, i) => (
              <rect
                key={`hit${i}`}
                x={layout.x(String(i)) - (layout.x.step() * layout.x.paddingInner()) / 2}
                y={layout.m.top}
                width={layout.x.step()}
                height={layout.H - layout.m.bottom - layout.m.top}
                fill="transparent"
                onMouseMove={(e) => onMove(e, i)}
              />
            ))}

            {/* x labels */}
            {layout.labels.map((label, i) => {
              if (i % labelEvery !== 0) return null;
              const cx = layout.x(String(i)) + layout.x.bandwidth() / 2;
              const ly = layout.H - layout.m.bottom + 18;
              const text = label.length > 18 ? `${label.slice(0, 17)}…` : label;
              return layout.rotate ? (
                <text key={`x${i}`} x={cx} y={ly} textAnchor="end" className="pc-tick pc-xtick" transform={`rotate(-35 ${cx} ${ly})`}>
                  {text}
                </text>
              ) : (
                <text key={`x${i}`} x={cx} y={ly} textAnchor="middle" className="pc-tick pc-xtick">
                  {text}
                </text>
              );
            })}
          </svg>
        )}
        {hover && layout && (
          <div
            className="pc-tooltip"
            style={{
              left: hover.flip ? undefined : hover.left + 14,
              right: hover.flip ? layout.W - hover.left + 14 : undefined,
              top: Math.max(hover.top - 20, 8),
            }}
          >
            <div className="pc-tooltip-title">{layout.labels[hover.i]}</div>
            {series.map((s, k) => (
              <div key={s} className="pc-tooltip-row">
                <span className="pc-swatch" style={{ background: CHART_COLOURS[k % CHART_COLOURS.length] }} />
                <span className="pc-tooltip-name">{s}</span>
                <strong>{fmtValue(points[hover.i][`y${k}`])}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="pc-legend">
          {series.map((s, k) => (
            <span key={s} className="pc-legend-item">
              <span className="pc-swatch" style={{ background: CHART_COLOURS[k % CHART_COLOURS.length] }} />
              {s}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export default function TableChartViewer({ fileId }) {
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("bar");
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");
  const [agg, setAgg] = useState("sum");
  const [chart, setChart] = useState(null);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!xCol || !yCol) return undefined;
    let cancelled = false;
    (async () => {
      setError("");
      setLoading(true);
      try {
        const resp = await fetch(access_file_chart_endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_id: fileId,
            x_column: xCol,
            y_columns: [{ column: yCol, aggregation: agg }],
            limit: 200,
          }),
        });
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error(j.detail || "Chart aggregation failed.");
        }
        const data = await resp.json();
        if (!cancelled) setChart(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Chart aggregation failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fileId, xCol, yCol, agg]);

  const columns = schema?.columns || [];
  const yColumn = columns.find((c) => c.name === yCol);
  const yNumeric = yColumn ? isNumericType(yColumn.type) : true;

  useEffect(() => {
    if (!yNumeric && agg !== "count") setAgg("count");
  }, [yNumeric, agg]);

  const aggLabel =(AGGREGATIONS.find((a) => a.value === agg) || AGGREGATIONS[0]).label;
  const yTitle = agg === "count" ? `Count of ${yCol}` : `${aggLabel} of ${yCol}`;

  return (
    <div className="preview-chart">
      <div className="pc-card">
        <div className="pc-toolbar">
          <div className="pc-field">
            <span className="pc-label">Chart</span>
            <div className="pc-seg" role="radiogroup" aria-label="Chart type">
              {[
                { v: "bar", label: "Bar" },
                { v: "line", label: "Line" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={chartType === o.v}
                  className={"pc-seg-btn" + (chartType === o.v ? " is-active" : "")}
                  onClick={() => setChartType(o.v)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <label className="pc-field">
            <span className="pc-label">X-axis</span>
            <select className="pc-select" value={xCol} onChange={(e) => setXCol(e.target.value)}>
              {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="pc-field">
            <span className="pc-label">Y-axis</span>
            <select className="pc-select" value={yCol} onChange={(e) => setYCol(e.target.value)}>
              {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="pc-field">
            <span className="pc-label">Aggregation</span>
            <select className="pc-select pc-select-sm" value={agg} onChange={(e) => setAgg(e.target.value)}>
              {AGGREGATIONS.map((a) => (
                <option key={a.value} value={a.value} disabled={!yNumeric && a.value !== "count"}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {schema?.row_count != null && (
            <span className="pc-rows">
              {Number(schema.row_count).toLocaleString("en-IN")} rows
              {chart?.points ? ` · ${chart.points.length.toLocaleString("en-IN")} groups` : ""}
            </span>
          )}
        </div>

        <div className="pc-head">
          <h2 className="pc-title">
            {yTitle} <span className="pc-title-by">by {xCol}</span>
          </h2>
          {loading && <span className="pc-loading">Updating…</span>}
        </div>

        {error && <p className="pc-error">{error}</p>}
        {chart ? (
          <D3Chart
            points={chart.points || []}
            series={chart.series || []}
            chartType={chartType}
            yTitle={yTitle}
            xTitle={xCol}
          />
        ) : (
          !error && <div className="pc-plot pc-plot-empty">Loading chart…</div>
        )}
      </div>
    </div>
  );
}
