import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { datasets_endpoint } from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";
import { useCmdk } from "../components/wd/CommandPalette";
import { DatasetRow, DatasetCard, normalize } from "../components/wd/DatasetItems";
import { AVAILABILITY_OPTIONS, availabilityLabel, parseAvailability } from "../constants/availability";

const LIMIT = 10;

export default function Datasets() {
  const navigate = useNavigate();
  const cmdk = useCmdk();
  const { isAuthenticated } = useAuth();

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [view, setView] = useState("list");
  const [filters, setFilters] = useState({ availability: [], org: [] });
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const offset = (page - 1) * LIMIT;
        const res = await fetch(`${datasets_endpoint}?limit=${LIMIT}&offset=${offset}`, { credentials: "include" });
        if (!res.ok) throw new Error("fetch");
        const data = await res.json();
        if (!active) return;
        const arr = Array.isArray(data) ? data : [];
        setHasMore(arr.length === LIMIT);
        if (arr.length === 0 && page > 1) return; // keep previous page
        setDatasets(arr);
      } catch {
        if (active) { setDatasets([]); setHasMore(false); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [page]);

  // client-side facets from the current page
  const orgOptions = useMemo(() => {
    const s = new Set();
    datasets.forEach((d) => { const o = normalize(d).org; if (o) s.add(o); });
    return [...s];
  }, [datasets]);

  const shown = useMemo(() => {
    return datasets.filter((raw) => {
      const d = normalize(raw);
      if (filters.availability.length) {
        const key = String(parseAvailability(d.availability));
        if (!filters.availability.includes(key)) return false;
      }
      if (filters.org.length && !filters.org.includes(d.org)) return false;
      return true;
    });
  }, [datasets, filters]);

  const toggle = (group, val) => {
    setFilters((f) => {
      const cur = f[group] || [];
      const next = cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
      return { ...f, [group]: next };
    });
  };
  const clearAll = () => setFilters({ availability: [], org: [] });
  const chips = [
    ...filters.availability.map((v) => ["availability", v, availabilityLabel(v)]),
    ...filters.org.map((v) => ["org", v, v]),
  ];

  const FGroup = ({ id, label, options }) => (
    <div className={"fgroup" + (collapsed[id] ? " collapsed" : "")}>
      <h4 onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))} role="button" tabIndex={0}>
        {label}<span className="chev"><Ic name="chev" size={16} /></span>
      </h4>
      <div className="fbody">
        {options.map(([val, lbl]) => (
          <label className="check" key={val}>
            <input type="checkbox" checked={(filters[id] || []).includes(val)} onChange={() => toggle(id, val)} />
            {lbl}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page">
      <section className="explore-head">
        <Contour op={0.4} />
        <div className="wrap inner">
          <span className="eyebrow">Discover</span>
          <h1 className="display">Explore datasets</h1>
          <button className="hero-search" style={{ maxWidth: 640, margin: 0 }} onClick={() => cmdk.open()} aria-label="Open search">
            <span className="sic"><Ic name="search" size={20} sw={2} style={{ color: "#667085" }} /></span>
            <span style={{ flex: 1, textAlign: "left", color: "var(--muted)", fontSize: 16 }}>Search datasets, places, topics and organizations…</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </section>

      <div className="wrap"><div className="explore-layout">
        <aside className="filters">
          <div className="fh">Refine</div>
          <FGroup id="availability" label="Availability" options={AVAILABILITY_OPTIONS.map((o) => [String(o.value), o.label])} />
          {orgOptions.length > 0 && <FGroup id="org" label="Organization" options={orgOptions.map((o) => [o, o])} />}
          {isAuthenticated && (
            <div className="fgroup">
              <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} onClick={() => navigate("/create-dataset")}>
                <Ic name="plus" size={15} />Publish a dataset
              </button>
            </div>
          )}
        </aside>

        <div>
          <div className="results-bar">
            <span className="count"><b>{shown.length}</b> dataset{shown.length !== 1 ? "s" : ""}{" "}<span style={{ fontSize: 12 }}>· page {page}</span></span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="view-toggle" role="group" aria-label="View">
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><Ic name="list" size={15} /></button>
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Ic name="grid" size={15} /></button>
              </div>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="chips">
              {chips.map(([g, v, lbl]) => (
                <span className="chip" key={g + v}>{lbl}<button onClick={() => toggle(g, v)} aria-label="Remove filter"><Ic name="close" size={12} /></button></span>
              ))}
              <button className="btn-quiet" style={{ fontSize: 12.5, padding: "4px 6px" }} onClick={clearAll}>Clear all</button>
            </div>
          )}

          {loading ? (
            <div className="empty"><p>Loading datasets…</p></div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <div className="eic"><Ic name="search" size={24} sw={1.6} /></div>
              <h3 className="display">No datasets match</h3>
              <p>Try removing a filter or searching for a place, topic or organization.</p>
              {chips.length > 0 && <button className="btn btn-ghost" onClick={clearAll}>Clear filters</button>}
            </div>
          ) : view === "list" ? (
            <div className="rows">{shown.map((d) => <DatasetRow key={normalize(d).id} dataset={d} />)}</div>
          ) : (
            <div className="explore-grid">{shown.map((d) => <DatasetCard key={normalize(d).id} dataset={d} />)}</div>
          )}

          <div className="pagination">
            <button onClick={() => { if (page > 1) { setPage(page - 1); setHasMore(true); } }} disabled={page === 1 || loading} aria-label="Previous">‹</button>
            <button className="active">{page}</button>
            <button onClick={() => { if (hasMore) setPage(page + 1); }} disabled={!hasMore || loading} aria-label="Next">›</button>
          </div>
        </div>
      </div></div>
    </div>
  );
}
