import React, { useEffect, useState } from "react";
import { homepage_stats_endpoint } from "../api/endpoints";
import Ic from "../components/wd/Icons";
import { RankRow } from "../components/wd/RankList";

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
              <RankRow
                key={c.user_id}
                rank={i + 1}
                name={c.full_name || "Contributor"}
                contributions={c.contributions}
                delay={80 + i * 90}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
