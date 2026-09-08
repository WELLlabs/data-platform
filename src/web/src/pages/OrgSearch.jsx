import React, { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { homepage_stats_endpoint, list_organizations_endpoint } from "../api/endpoints";
import Ic from "../components/wd/Icons";

const initials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "OR";

function OrgSearch() {
  const [searchParams] = useSearchParams();
  const sortTop = searchParams.get("sort") === "top";
  const [organizations, setOrganizations] = useState([]);
  const [rankById, setRankById] = useState({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(list_organizations_endpoint, {
          credentials: "include",
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        const items = data?.items ?? [];
        if (!cancelled) setOrganizations(Array.isArray(items) ? items : []);
      } catch {
        if (!cancelled) setOrganizations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sortTop) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(homepage_stats_endpoint, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ranked = [...(data.top_organizations || [])].sort(
          (a, b) => (b.contributions || 0) - (a.contributions || 0)
        );
        const map = {};
        ranked.forEach((o, i) => {
          map[String(o.organization_id)] = { rank: i + 1, contributions: o.contributions };
        });
        if (!cancelled) setRankById(map);
      } catch {
        if (!cancelled) setRankById({});
      }
    })();
    return () => { cancelled = true; };
  }, [sortTop]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = q
      ? organizations.filter((o) => {
          const hay = [
            o.name,
            o.description,
            o.org_type,
            ...(Array.isArray(o.focus) ? o.focus : []),
            ...(Array.isArray(o.roi_states) ? o.roi_states : []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : organizations;
    if (!sortTop) return filtered;
    return [...filtered].sort((a, b) => {
      const ra = rankById[String(a.id)]?.contributions ?? -1;
      const rb = rankById[String(b.id)]?.contributions ?? -1;
      return rb - ra;
    });
  }, [organizations, q, sortTop, rankById]);

  return (
    <div className="page">
      <section className="wrap" style={{ padding: "var(--s7) 0 var(--s8)" }}>
        <span className="eyebrow">Research entities</span>
        <h1
          className="display"
          style={{
            fontSize: 40,
            fontWeight: 450,
            color: "var(--navy)",
            letterSpacing: "-.03em",
            margin: "10px 0 8px",
          }}
        >
          {sortTop ? "Top organizations" : "Organizations"}
        </h1>
        <p className="muted" style={{ maxWidth: "56ch", marginBottom: "var(--s6)" }}>
          {sortTop
            ? "Organizations ranked from highest to lowest by contributions."
            : "Research institutions and public bodies that collect, curate and share environmental data on the platform."}
        </p>

        <div className="hero-search" style={{ marginTop: 0, marginBottom: "var(--s6)" }}>
          <span className="sic">
            <Ic name="search" size={18} />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search organizations…"
            aria-label="Search organizations"
          />
        </div>

        {shown.length > 0 ? (
          <div className="org-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            {shown.map((o) => {
              const areas = [
                ...(Array.isArray(o.focus) ? o.focus : []),
                ...(Array.isArray(o.roi_states) ? o.roi_states : []),
              ].slice(0, 3);
              const since = o.created_at
                ? new Date(o.created_at).getFullYear()
                : null;
              const ranked = rankById[String(o.id)];
              const datasetCount = o.datasets_count ?? o.contributions ?? ranked?.contributions;
              return (
                <Link
                  className="orgcard"
                  to={`/organisation?id=${o.id}`}
                  key={o.id}
                  style={{ padding: 24 }}
                >
                  <div className="oi" style={{ width: 46, height: 46, fontSize: 17 }}>
                    {initials(o.name)}
                  </div>
                  {ranked?.rank != null && <span className="rank-chip">#{ranked.rank}</span>}
                  <b
                    style={{
                      fontSize: 17,
                      fontFamily: "var(--display)",
                      fontWeight: 450,
                    }}
                  >
                    {o.name}
                  </b>
                  {(o.description || o.org_type) && (
                    <p
                      className="muted"
                      style={{
                        fontSize: 13,
                        margin: "8px 0 14px",
                        lineHeight: 1.55,
                      }}
                    >
                      {o.description || o.org_type}
                    </p>
                  )}
                  {areas.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {areas.map((a, i) => (
                        <span className="mono-token" key={`${a}-${i}`}>
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {(datasetCount != null || since) && (
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
                      {datasetCount != null && `${datasetCount} ${ranked ? "contributions" : "datasets"}`}
                      {datasetCount != null && since && " · "}
                      {since && `since ${since}`}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <p>No organizations found.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default OrgSearch;
