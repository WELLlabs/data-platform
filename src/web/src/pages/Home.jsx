import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datasets_endpoint, homepage_stats_endpoint } from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";
import { useCmdk } from "../components/wd/CommandPalette";
import { availabilityLabel, isRestrictedAvailability } from "../constants/availability";

const fmt = (v) => (typeof v === "number" ? v.toLocaleString() : v == null ? "—" : v);
const dsLink = (d) => `/dataset-info?dataset_id=${encodeURIComponent(d.dataset_id)}`;
const orgOf = (d) => d.organization || d.organization_name || "WELL Labs";

const TOPICS = [
  { k: "Water", ic: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" },
  { k: "Agriculture", ic: "M12 21V9m0 0c-2.5-2.6-5.5-2-5.5-2s0 3.6 2.6 4.4S12 9 12 9Zm0 0c2.5-2.6 5.5-2 5.5-2s0 3.6-2.6 4.4S12 9 12 9Z" },
  { k: "Climate", ic: "M7 16a4 4 0 0 1 .4-8 5 5 0 0 1 9.5-1A3.5 3.5 0 1 1 17.5 16H7Z" },
  { k: "Land", ic: "M3 18l6-8 4 5 3-4 5 7H3Z" },
  { k: "Governance", ic: "M4 21h16M6 21V10m4 11V10m4 11V10m4 11V10M12 3l8 5H4l8-5Z" },
  { k: "Livelihoods", ic: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
];

function StatusBadge({ d }) {
  const restricted = isRestrictedAvailability(d.availability);
  const label = availabilityLabel(d.availability);
  return restricted
    ? <span className="badge lock"><Ic name="lock" size={12} sw={1.9} />{label}</span>
    : <span className="badge approved"><Ic name="verified" size={12} sw={2} />Public</span>;
}

function DatasetCard({ d }) {
  return (
    <Link className="dcard" to={dsLink(d)}>
      <div className="top"><span className="cat">Dataset</span><StatusBadge d={d} /></div>
      <h3>{d.dataset_title || "Untitled dataset"}</h3>
      <p className="desc">{d.dataset_description || "No description provided."}</p>
      <div className="prov">{orgOf(d)}</div>
      <div className="specs">
        <span className="mono-token">{fmt(d.downloads)} downloads</span>
        {d.file_count != null && <span className="mono-token">{d.file_count} files</span>}
      </div>
    </Link>
  );
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cmdk = useCmdk();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, d] = await Promise.all([
          fetch(homepage_stats_endpoint, { credentials: "include" }),
          fetch(`${datasets_endpoint}?limit=8&offset=0`, { credentials: "include" }),
        ]);
        if (!s.ok || !d.ok) throw new Error("load");
        const [sd, dd] = await Promise.all([s.json(), d.json()]);
        if (!active) return;
        setStats(sd);
        setDatasets(Array.isArray(dd) ? dd : []);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const primary = datasets[0];
  const secondary = datasets.slice(1, 4);
  const grid = datasets.slice(4, 7);
  const orgs = stats?.top_organizations || [];

  return (
    <div className="page">
      <section className="hero">
        <Contour op={0.5} />
        <div className="wrap hero-inner">
          <div className="kicker"><span className="rule" /><span className="eyebrow">Open environmental data · WELL Labs</span></div>
          <h1 className="display">Discover the data behind <em>water, land</em> and livelihoods.</h1>
          <p className="lede">A research library of datasets collected, created and shared by WELL Labs and its partners — with the metadata, provenance and files you need to actually use them.</p>
          <button className="hero-search" onClick={() => cmdk.open()} aria-label="Open search">
            <span className="sic"><Ic name="search" size={20} sw={2} /></span>
            <span style={{ flex: 1, textAlign: "left", color: "var(--muted)", fontSize: 16 }}>Search datasets, places, topics and organizations…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/datasets">Explore datasets <Ic name="arrow" size={16} /></Link>
            <Link className="link-arrow" to="/faq">How the repository works</Link>
          </div>
          <div className="stat-row">
            <div className="stat"><b className="display">{loading ? "…" : fmt(stats?.total_open_datasets)}</b><span>open datasets</span></div>
            <div className="stat"><b className="display">{loading ? "…" : fmt(orgs.length)}</b><span>organizations</span></div>
            <div className="stat"><b className="display">{loading ? "…" : fmt(stats?.top_contributors?.length)}</b><span>top contributors</span></div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 0" }}>
        <div className="section-head">
          <div><span className="eyebrow">Featured data</span><h2 className="section-title" style={{ marginTop: 8 }}>A closer look</h2></div>
          <Link className="link-arrow" to="/datasets">All datasets <Ic name="arrow" size={16} /></Link>
        </div>

        {error ? (
          <div className="empty"><h3 className="display">Data temporarily unavailable</h3><p>Try browsing datasets directly.</p><Link className="btn btn-ghost" to="/datasets">Browse datasets</Link></div>
        ) : loading ? (
          <div className="card-grid"><div className="dcard" /><div className="dcard" /><div className="dcard" /></div>
        ) : primary ? (
          <>
            <div className="featured">
              <Link className="feat-hero" to={dsLink(primary)}>
                <div className="fmeta-top"><span className="cat">Dataset</span><StatusBadge d={primary} /></div>
                <h3 className="display">{primary.dataset_title || "Untitled dataset"}</h3>
                <p className="fd">{primary.dataset_description || "No description provided."}</p>
                <div className="fcoverage"><span><b>{orgOf(primary)}</b></span>{primary.downloads != null && <span>{fmt(primary.downloads)} downloads</span>}</div>
                <div className="frow">
                  <div className="fspecs">{primary.file_count != null && <span className="mono-token">{primary.file_count} files</span>}</div>
                  <span className="link-arrow">View dataset <Ic name="arrow" size={16} /></span>
                </div>
              </Link>
              <div className="feat-side">
                {secondary.map((d) => (
                  <Link className="feat-item" key={d.dataset_id} to={dsLink(d)}>
                    <span className="cat">Dataset</span>
                    <h4>{d.dataset_title || "Untitled dataset"}</h4>
                    <div className="fi-meta">{orgOf(d)}</div>
                  </Link>
                ))}
              </div>
            </div>
            {grid.length > 0 && <div className="card-grid" style={{ marginTop: 20 }}>{grid.map((d) => <DatasetCard key={d.dataset_id} d={d} />)}</div>}
          </>
        ) : (
          <div className="empty"><h3 className="display">No datasets yet</h3><p>Public datasets will appear here once published.</p></div>
        )}
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 0" }}>
        <div className="section-head"><h2 className="section-title">Explore by topic</h2></div>
        <div className="topic-grid">
          {TOPICS.map((t) => (
            <Link className="topic" key={t.k} to={`/search?q=${encodeURIComponent(t.k)}`}>
              <span className="ic"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={t.ic} /></svg></span>
              <span><b>{t.k}</b><span>Browse datasets</span></span>
              <span className="ch"><Ic name="arrow" size={16} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 var(--s7)" }}>
        <div className="section-head">
          <div><span className="eyebrow">Contributors</span><h2 className="section-title" style={{ marginTop: 8 }}>Organizations contributing</h2></div>
          <Link className="link-arrow" to="/orgsearch">View all <Ic name="arrow" size={16} /></Link>
        </div>
        <div className="org-grid">
          {orgs.slice(0, 4).map((o) => (
            <Link className="orgcard" key={o.organization_id} to={`/organisation?id=${encodeURIComponent(o.organization_id)}`}>
              <div className="oi">{String(o.organization_name || "?").slice(0, 2).toUpperCase()}</div>
              <b>{o.organization_name}</b>
              <span>{fmt(o.contributions)} contributions</span>
            </Link>
          ))}
          {!loading && !orgs.length && <div className="empty" style={{ padding: "40px 0" }}><p>Contribution data is not available yet.</p></div>}
        </div>
      </section>
    </div>
  );
}
