import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datasets_endpoint, homepage_stats_endpoint } from "../api/endpoints";

function formatCount(value) {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

function DatasetCard({ dataset }) {
  return (
    <Link className="wd-dataset-card" to={`/dataset-info?dataset_id=${encodeURIComponent(dataset.dataset_id)}`}>
      <div className="wd-card-meta">
        <span className="wd-eyebrow">Dataset</span>
        <span className={dataset.private ? "wd-badge wd-badge-private" : "wd-badge"}>
          {dataset.private ? "Private" : "Public"}
        </span>
      </div>
      <h3>{dataset.dataset_title || "Untitled dataset"}</h3>
      <p>{dataset.dataset_description || "No description provided."}</p>
      <div className="wd-card-foot">
        <span>{dataset.organization || "WELL Labs"}</span>
        <span>{formatCount(dataset.downloads)} downloads</span>
      </div>
    </Link>
  );
}

function Home() {
  const [stats, setStats] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadHome() {
      try {
        const [statsResponse, datasetsResponse] = await Promise.all([
          fetch(homepage_stats_endpoint, { credentials: "include" }),
          fetch(`${datasets_endpoint}?limit=4&offset=0`, { credentials: "include" }),
        ]);
        if (!statsResponse.ok || !datasetsResponse.ok) throw new Error("Unable to load homepage data");
        const [statsData, datasetsData] = await Promise.all([statsResponse.json(), datasetsResponse.json()]);
        if (!active) return;
        setStats(statsData);
        setDatasets(Array.isArray(datasetsData) ? datasetsData : []);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadHome();
    return () => { active = false; };
  }, []);

  return (
    <main className="wd-home">
      <section className="wd-hero">
        <div className="wd-contours" aria-hidden="true" />
        <div className="wd-content wd-hero-content">
          <div className="wd-kicker"><span /> Open environmental data · WELL Labs</div>
          <h1>Discover the data behind <em>water, land</em> and livelihoods.</h1>
          <p className="wd-lede">A research library of datasets collected, created and shared by WELL Labs and its partners, with the metadata and files you need to use them.</p>
          <div className="wd-hero-actions">
            <Link className="wd-primary-button" to="/datasets">Explore datasets <span aria-hidden="true">→</span></Link>
            <Link className="wd-text-link" to="/search">Search the repository <span aria-hidden="true">→</span></Link>
          </div>
          <div className="wd-stat-row">
            <div><strong>{loading ? "…" : formatCount(stats?.total_open_datasets)}</strong><span>open datasets</span></div>
            <div><strong>{loading ? "…" : formatCount(stats?.top_organizations?.length)}</strong><span>leading organizations</span></div>
            <div><strong>{loading ? "…" : formatCount(stats?.top_contributors?.length)}</strong><span>top contributors</span></div>
          </div>
        </div>
      </section>

      <section className="wd-content wd-section">
        <div className="wd-section-heading">
          <div><span className="wd-eyebrow">Recently available</span><h2>A closer look</h2></div>
          <Link className="wd-text-link" to="/datasets">All datasets <span aria-hidden="true">→</span></Link>
        </div>
        {error ? <div className="wd-state">Homepage data is temporarily unavailable. Browse datasets to try again.</div> : loading ? (
          <div className="wd-card-grid" aria-label="Loading datasets"><div className="wd-skeleton" /><div className="wd-skeleton" /><div className="wd-skeleton" /><div className="wd-skeleton" /></div>
        ) : datasets.length ? (
          <div className="wd-card-grid">{datasets.map((dataset) => <DatasetCard key={dataset.dataset_id} dataset={dataset} />)}</div>
        ) : <div className="wd-state">No public datasets are available yet.</div>}
      </section>

      <section className="wd-content wd-section wd-section-last">
        <div className="wd-section-heading"><div><span className="wd-eyebrow">Repository signals</span><h2>Who is contributing</h2></div></div>
        <div className="wd-contributor-grid">
          {(stats?.top_organizations || []).slice(0, 3).map((org) => (
            <Link className="wd-contributor" key={org.organization_id} to={`/organisation?id=${encodeURIComponent(org.organization_id)}`}>
              <strong>{org.organization_name}</strong><span>{org.contributions} contributions <span aria-hidden="true">→</span></span>
            </Link>
          ))}
          {!loading && !stats?.top_organizations?.length && <div className="wd-state">Contribution data is not available yet.</div>}
        </div>
      </section>
    </main>
  );
}

export default Home;
