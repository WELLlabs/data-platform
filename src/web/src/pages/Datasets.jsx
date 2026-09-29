import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { datasets_endpoint } from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";
import { useCmdk } from "../components/wd/CommandPalette";
import { DatasetRow, DatasetCard, normalize, useOrganizationNames } from "../components/wd/DatasetItems";
import Pagination, { PAGE_SIZE_OPTIONS } from "../components/wd/Pagination";
import { AVAILABILITY_OPTIONS, availabilityLabel, parseAvailability } from "../constants/availability";


async function countDatasets(topic) {
  const STEP = 50;
  let count = 0;
  for (let i = 0; i < 40; i++) {
    const params = new URLSearchParams({ limit: String(STEP), offset: String(i * STEP) });
    if (topic) params.set("topic", topic);
    const res = await fetch(`${datasets_endpoint}?${params.toString()}`, { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    count += arr.length;
    if (arr.length < STEP) return count;
  }
  return null;
}

export default function Datasets() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cmdk = useCmdk();
  const { isAuthenticated } = useAuth();
  const topic = (searchParams.get("topic") || "").trim();

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(null);

  const [view, setView] = useState("list");
  const [filters, setFilters] = useState({ availability: [], org: [] });
  const [collapsed, setCollapsed] = useState({});
  const orgNames = useOrganizationNames();

  useEffect(() => {
    setPage(1);
  }, [topic]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const offset = (page - 1) * pageSize;
        const params = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset),
          with_meta: "true",
        });
        if (topic) params.set("topic", topic);
        const res = await fetch(`${datasets_endpoint}?${params.toString()}`, { credentials: "include" });
        if (!res.ok) throw new Error("fetch");
        const data = await res.json();
        if (!active) return;
        // with_meta=true returns {items, total, ...}; older APIs return a plain list
        const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        const t = Number.isFinite(Number(data?.total))
          ? Number(data.total)
          : parseInt(res.headers.get("X-Total-Count"), 10);
        let knownTotal = Number.isFinite(t) ? t : null;
        if (knownTotal == null) {
          // Fallback for an API that does not report a total yet: count the
          // visible datasets by walking the list in pages of 50.
          knownTotal = await countDatasets(topic);
          if (!active) return;
        }
        setTotal(knownTotal);
        setHasMore(knownTotal != null ? page * pageSize < knownTotal : arr.length === pageSize);
        if (arr.length === 0 && page > 1) return; // keep previous page
        setDatasets(arr);
      } catch {
        if (active) { setDatasets([]); setHasMore(false); setTotal(null); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [page, pageSize, topic]);

  // client-side facets from the current page
  const orgOptions = useMemo(() => {
    const s = new Set();
    datasets.forEach((d) => { const o = normalize(d, orgNames).org; if (o) s.add(o); });
    return [...s];
  }, [datasets, orgNames]);

  const shown = useMemo(() => {
    if (isAuthenticated) return datasets;
    return datasets.filter((raw) => {
      const d = normalize(raw, orgNames);
      if (filters.availability.length) {
        const key = String(parseAvailability(d.availability));
        if (!filters.availability.includes(key)) return false;
      }
      if (filters.org.length && !filters.org.includes(d.org)) return false;
      return true;
    });
  }, [datasets, filters, isAuthenticated, orgNames]);

  const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const goTo = (p) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
          <h1 className="display">{topic ? `Explore ${topic}` : "Explore datasets"}</h1>
          <button className="hero-search" style={{ maxWidth: 640, margin: 0 }} onClick={() => cmdk.open()} aria-label="Open search">
            <span className="sic"><Ic name="search" size={20} sw={2} style={{ color: "#667085" }} /></span>
            <span style={{ flex: 1, textAlign: "left", color: "var(--muted)", fontSize: 16 }}>Search datasets, places, topics and organizations…</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </section>

      <div className="wrap"><div className={"explore-layout" + (isAuthenticated ? " no-filters" : "")}>
        {!isAuthenticated && (
          <aside className="filters">
            <div className="fh">Refine</div>
            <FGroup id="availability" label="Availability" options={AVAILABILITY_OPTIONS.map((o) => [String(o.value), o.label])} />
            {orgOptions.length > 0 && <FGroup id="org" label="Organization" options={orgOptions.map((o) => [o, o])} />}
          </aside>
        )}

        <div>
          <div className="results-bar">
            <span className="count">
              <b>{total ?? shown.length}</b> dataset{(total ?? shown.length) !== 1 ? "s" : ""}
              {totalPages != null && (
                <span className="count-pages">
                  Page {page} of {totalPages} · {pageSize} per page
                  {totalPages - page > 0
                    ? ` · ${totalPages - page} more page${totalPages - page === 1 ? "" : "s"}`
                    : " · last page"}
                </span>
              )}
            </span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {isAuthenticated && (
                <button className="btn btn-primary" onClick={() => navigate("/create-dataset")}>
                  <Ic name="plus" size={15} />Publish a dataset
                </button>
              )}
              <div className="view-toggle" role="group" aria-label="View">
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><Ic name="list" size={15} /></button>
                <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Ic name="grid" size={15} /></button>
              </div>
            </div>
          </div>

          {topic && (
            <div className="chips">
              <span className="chip">
                Topic: {topic}
                <button
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("topic");
                    setSearchParams(next);
                    setPage(1);
                  }}
                  aria-label="Clear topic"
                >
                  <Ic name="close" size={12} />
                </button>
              </span>
            </div>
          )}

          {!isAuthenticated && chips.length > 0 && (
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

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            hasMore={hasMore}
            loading={loading}
            itemsOnPage={datasets.length}
            noun="dataset"
            onPageChange={goTo}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </div></div>
    </div>
  );
}
