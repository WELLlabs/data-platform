import React, { useEffect, useState } from "react";
import { homepage_stats_endpoint } from "../api/endpoints";
import Ic from "../components/wd/Icons";

const fmt = (v) => (typeof v === "number" ? v.toLocaleString() : v == null ? "—" : v);

export default function Contributors() {
  const [contributors, setContributors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(homepage_stats_endpoint, { credentials: "include" });
        if (!res.ok) throw new Error("load");
        const data = await res.json();
        if (cancelled) return;
        const list = [...(data.top_contributors || [])].sort(
          (a, b) => (b.contributions || 0) - (a.contributions || 0)
        );
        setContributors(list);
      } catch {
        if (!cancelled) setContributors([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const maxContrib = contributors.reduce((m, c) => Math.max(m, c.contributions || 0), 0) || 1;

  return (
    <div className="page">
      <section className="wrap" style={{ padding: "var(--s7) 0 var(--s8)" }}>
        <span className="eyebrow">Ranked</span>
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
          Top contributors
        </h1>
        <p className="muted" style={{ maxWidth: "56ch", marginBottom: "var(--s6)" }}>
          Contributors ranked from highest to lowest by published contributions.
        </p>

        {loading ? (
          <div className="empty"><p>Loading contributors…</p></div>
        ) : contributors.length === 0 ? (
          <div className="empty">
            <div className="eic"><Ic name="org" size={22} /></div>
            <p>Contributor rankings are not available yet.</p>
          </div>
        ) : (
          <div className="rank-list">
            {contributors.map((c, i) => (
              <div
                className="rank-row"
                key={c.user_id}
                style={{ animationDelay: `${80 + i * 90}ms` }}
              >
                <span className="rank-num">#{i + 1}</span>
                <div className="rank-body">
                  <b>{c.full_name || "Contributor"}</b>
                  <span>{fmt(c.contributions)} contributions</span>
                  <div className="rank-bar" aria-hidden="true">
                    <i style={{ "--bar": `${Math.max(8, ((c.contributions || 0) / maxContrib) * 100)}%`, animationDelay: `${180 + i * 90}ms` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
