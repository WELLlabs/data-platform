import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datasets_endpoint, homepage_stats_endpoint, topics_endpoint } from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";
import { useCmdk } from "../components/wd/CommandPalette";
import { availabilityLabel, isRestrictedAvailability } from "../constants/availability";
import { orgDisplayName, useOrganizationNames, DatasetMeta, normalize } from "../components/wd/DatasetItems";
import { RankRow } from "../components/wd/RankList";
import { useBranding } from "../branding";

const fmt = (v) => (typeof v === "number" ? v.toLocaleString() : v == null ? "—" : v);
const dsLink = (d) => `/dataset-info?dataset_id=${encodeURIComponent(d.dataset_id)}`;

function fmtBytes(n) {
  if (typeof n !== "number" || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const shown = i === 0 || v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1);
  return `${shown} ${units[i]}`;
}

const TOPIC_ICONS = {
  Water: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z",
  Agriculture: "M12 21V9m0 0c-2.5-2.6-5.5-2-5.5-2s0 3.6 2.6 4.4S12 9 12 9Zm0 0c2.5-2.6 5.5-2 5.5-2s0 3.6-2.6 4.4S12 9 12 9Z",
  Climate: "M7 16a4 4 0 0 1 .4-8 5 5 0 0 1 9.5-1A3.5 3.5 0 1 1 17.5 16H7Z",
  Land: "M3 18l6-8 4 5 3-4 5 7H3Z",
  Governance: "M4 21h16M6 21V10m4 11V10m4 11V10m4 11V10M12 3l8 5H4l8-5Z",
  Livelihoods: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  "Socio-Economic": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
};
const DEFAULT_TOPIC_ICON = "M4 6h16M4 12h10M4 18h7";

function topicIcon(name) {
  return TOPIC_ICONS[name] || DEFAULT_TOPIC_ICON;
}

function StatusBadge({ d }) {
  const restricted = isRestrictedAvailability(d.availability);
  const label = availabilityLabel(d.availability);
  return restricted
    ? <span className="badge lock"><Ic name="lock" size={12} sw={1.9} />{label}</span>
    : <span className="badge approved"><Ic name="verified" size={12} sw={2} />Public</span>;
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cmdk = useCmdk();
  const { hostName, brandLine } = useBranding();
  const orgNames = useOrganizationNames();
  const orgOf = (d) => orgDisplayName(d, orgNames) || hostName || "Unknown organization";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, d, t] = await Promise.all([
          fetch(homepage_stats_endpoint, { credentials: "include" }),
          fetch(`${datasets_endpoint}?limit=5&offset=0`, { credentials: "include" }),
          fetch(topics_endpoint, { credentials: "include" }),
        ]);
        if (!s.ok || !d.ok) throw new Error("load");
        const [sd, dd, td] = await Promise.all([
          s.json(),
          d.json(),
          t.ok ? t.json() : Promise.resolve({ topics: [] }),
        ]);
        if (!active) return;
        setStats(sd);
        const topicList = Array.isArray(td?.topics) ? td.topics : [];
        setTopics(topicList.filter((item) => item?.topic && String(item.topic).toUpperCase() !== "NA"));
        const list = Array.isArray(dd) ? dd : [];
        const recent = [...list].sort((a, b) => {
          const ta = new Date(a.created_at || a.updated_at || 0).getTime();
          const tb = new Date(b.created_at || b.updated_at || 0).getTime();
          return tb - ta;
        }).slice(0, 5);
        setDatasets(recent);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const primary = datasets[0];
  const secondary = datasets.slice(1, 5);
  const orgs = [...(stats?.top_organizations || [])].sort(
    (a, b) => (b.contributions || 0) - (a.contributions || 0)
  );
  const contributors = [...(stats?.top_contributors || [])].sort(
    (a, b) => (b.contributions || 0) - (a.contributions || 0)
  );

  return (
    <div className="page">
      <section className="hero">
        <Contour op={0.5} />
        <div className="wrap hero-inner">
          <div className="kicker"><span className="rule" /><span className="eyebrow">Open environmental data{hostName ? ` · ${hostName}` : ""}</span></div>
          <h1 className="display">Discover the data behind <em>water, land</em> and livelihoods.</h1>
          <p className="lede">A research library of datasets collected, created and shared by {hostName || brandLine} and its partners — with the metadata, provenance and files you need to actually use them.</p>
          <button className="hero-search" onClick={() => cmdk.open()} aria-label="Open search">
            <span className="sic"><Ic name="search" size={20} sw={2} /></span>
            <span style={{ flex: 1, textAlign: "left", color: "var(--muted)", fontSize: 16 }}>Search datasets, places, topics and organizations…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/datasets">Explore datasets <Ic name="arrow" size={16} /></Link>
          </div>
          <div className="stat-row">
            <Link className="stat" to="/datasets">
              <b className="display">{loading ? "…" : fmt(stats?.total_open_datasets)}</b>
              <span>total datasets</span>
            </Link>
            <Link className="stat" to="/orgsearch?sort=top">
              <b className="display">{loading ? "…" : fmt(orgs.length)}</b>
              <span>top organizations</span>
            </Link>
            <Link className="stat" to="/contributors">
              <b className="display">{loading ? "…" : fmt(contributors.length)}</b>
              <span>top contributors</span>
            </Link>
            <div className="stat">
              <b className="display">{loading ? "…" : fmtBytes(stats?.total_file_size)}</b>
              <span>total file sizes</span>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 0" }}>
        <div className="section-head">
          <div><span className="eyebrow">Featured data</span><h2 className="section-title" style={{ marginTop: 8 }}>Recent top 5 datasets</h2></div>
          <Link className="link-arrow" to="/datasets">All datasets <Ic name="arrow" size={16} /></Link>
        </div>

        {error ? (
          <div className="empty"><h3 className="display">Data temporarily unavailable</h3><p>Try browsing datasets directly.</p><Link className="btn btn-ghost" to="/datasets">Browse datasets</Link></div>
        ) : loading ? (
          <div className="card-grid"><div className="dcard" /><div className="dcard" /><div className="dcard" /></div>
        ) : primary ? (
          <div className="featured">
            <Link className="feat-hero" to={dsLink(primary)}>
              <div className="fmeta-top"><StatusBadge d={primary} /></div>
              <h3 className="display">{primary.dataset_title || "Untitled dataset"}</h3>
              <p className="fd">{primary.dataset_description || "No description provided."}</p>
              <DatasetMeta d={normalize(primary, orgNames)} hideAccess />
              <div className="frow">
                <span className="link-arrow">View dataset <Ic name="arrow" size={16} /></span>
              </div>
            </Link>
            <div className="feat-side">
              {secondary.map((d) => (
                <Link className="feat-item" key={d.dataset_id} to={dsLink(d)}>
                  <h4>{d.dataset_title || "Untitled dataset"}</h4>
                  <div className="fi-meta">
                    {[d.creator_name, orgOf(d)].filter(Boolean).join(" · ")}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty"><h3 className="display">No datasets yet</h3><p>Public datasets will appear here once published.</p></div>
        )}
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 0" }}>
        <div className="section-head"><h2 className="section-title">Explore by topic</h2></div>
        <div className="topic-grid">
          {topics.length === 0 ? (
            <p className="lede" style={{ gridColumn: "1 / -1", margin: 0 }}>Topics will appear here once tags are published.</p>
          ) : topics.map((t) => (
            <Link className="topic" key={t.topic} to={`/datasets?topic=${encodeURIComponent(t.topic)}`}>
              <span className="ic"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={topicIcon(t.topic)} /></svg></span>
              <span><b>{t.topic}</b><span>{t.dataset_count ? `${t.dataset_count} dataset${t.dataset_count === 1 ? "" : "s"}` : "Browse datasets"}</span></span>
              <span className="ch"><Ic name="arrow" size={16} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="wrap" id="top-contributors" style={{ padding: "var(--s8) 0 0" }}>
        <div className="section-head">
          <div><span className="eyebrow">Ranked</span><h2 className="section-title" style={{ marginTop: 8 }}>Top contributors</h2></div>
          <Link className="link-arrow" to="/contributors">View all <Ic name="arrow" size={16} /></Link>
        </div>
        <div className="rank-list">
          {contributors.slice(0, 10).map((c, i) => (
            <RankRow
              key={c.user_id}
              rank={i + 1}
              name={c.full_name || "Contributor"}
              contributions={c.contributions}
              delay={80 + i * 90}
            />
          ))}
          {!loading && !contributors.length && <div className="empty" style={{ padding: "40px 0" }}><p>Contributor rankings are not available yet.</p></div>}
        </div>
      </section>

      <section className="wrap" style={{ padding: "var(--s8) 0 var(--s7)" }}>
        <div className="section-head">
          <div><span className="eyebrow">Contributors</span><h2 className="section-title" style={{ marginTop: 8 }}>Top organizations</h2></div>
          <Link className="link-arrow" to="/orgsearch?sort=top">View all <Ic name="arrow" size={16} /></Link>
        </div>
        <div className="org-grid">
          {orgs.slice(0, 4).map((o, i) => (
            <Link className="orgcard" key={o.organization_id} to={`/organisation?id=${encodeURIComponent(o.organization_id)}`}>
              <div className="oi">{String(o.organization_name || "?").slice(0, 2).toUpperCase()}</div>
              <span className="rank-chip">#{i + 1}</span>
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
