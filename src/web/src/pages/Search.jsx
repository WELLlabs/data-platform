import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  list_organizations_endpoint,
  search_endpoint,
  tags_list_endpoint,
  topics_endpoint,
} from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";
import { DatasetRow } from "../components/wd/DatasetItems";

const LIMIT = 10;

function toggleValue(cur, value) {
  return cur.includes(value) ? cur.filter((t) => t !== value) : [...cur, value];
}

export default function Search() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [params] = useSearchParams();

  const [query, setQuery] = useState(params.get("q") || "");
  const [searchWithinOrg, setSearchWithinOrg] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [organizations, setOrganizations] = useState([]);
  const [result, setResult] = useState([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [selectedTags, setSelectedTags] = useState(
    () => (params.get("tags") || "").split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [selectedTopics, setSelectedTopics] = useState(
    () => (params.get("topics") || "").split(",").map((t) => t.trim()).filter(Boolean)
  );
  const [tagFacets, setTagFacets] = useState([]);
  const [topicFacets, setTopicFacets] = useState([]);
  const [topics, setTopics] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [orgsResp, topicsResp] = await Promise.all([
          fetch(list_organizations_endpoint, { credentials: "include" }),
          fetch(topics_endpoint, { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (orgsResp.ok) {
          const data = await orgsResp.json();
          const items = data?.items ?? [];
          setOrganizations(Array.isArray(items) ? items : []);
        }
        if (topicsResp.ok) {
          const data = await topicsResp.json();
          setTopics(Array.isArray(data?.topics) ? data.topics : []);
        }
      } catch {
        if (!cancelled) {
          setOrganizations([]);
          setTopics([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = new URLSearchParams({ limit: "300" });
        if (selectedTopics.length) p.set("topic", selectedTopics.join(","));
        const resp = await fetch(`${tags_list_endpoint}?${p}`, { credentials: "include" });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (!cancelled) setTags(Array.isArray(data?.tags) ? data.tags : []);
      } catch {
        if (!cancelled) setTags([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTopics]);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated && user?.organization) {
      setSearchWithinOrg(true);
      setOrgId((p) => (p === "" ? user.organization : p));
    }
    setDefaultsApplied(true);
  }, [authLoading, isAuthenticated, user?.organization]);

  const runSearch = useCallback(async (page = 1) => {
    const q = query?.trim() ?? "";
    setLoading(true); setError("");
    const offset = (page - 1) * LIMIT;
    const p = new URLSearchParams();
    p.set("query", q || "*");
    p.set("limit", String(LIMIT));
    p.set("offset", String(offset));
    if (searchWithinOrg && orgId?.trim()) p.set("organization_id", orgId.trim());
    if (startDate?.trim()) p.set("start_date", startDate.trim() + "T00:00:00");
    if (endDate?.trim()) p.set("end_date", endDate.trim() + "T23:59:59");
    if (selectedTags.length) p.set("tags", selectedTags.join(","));
    if (selectedTopics.length) p.set("topics", selectedTopics.join(","));
    try {
      const res = await fetch(`${search_endpoint}?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
      const data = await res.json();
      setResult(data.result ?? []); setTotal(data.total ?? 0); setCurrentPage(page); setHasSearched(true);
      setTagFacets(Array.isArray(data.tag_facets) ? data.tag_facets : []);
      setTopicFacets(Array.isArray(data.topic_facets) ? data.topic_facets : []);
    } catch (err) {
      setError(err.message || "Search failed. Please try again."); setResult([]); setTotal(0);
    } finally { setLoading(false); }
  }, [query, searchWithinOrg, orgId, startDate, endDate, selectedTags, selectedTopics]);

  const urlQ = params.get("q") || "";
  const urlTags = params.get("tags") || "";
  const urlTopics = params.get("topics") || "";

  useEffect(() => {
    setQuery(urlQ);
    setSelectedTags(urlTags.split(",").map((t) => t.trim()).filter(Boolean));
    setSelectedTopics(urlTopics.split(",").map((t) => t.trim()).filter(Boolean));
  }, [urlQ, urlTags, urlTopics]);

  useEffect(() => {
    if (!defaultsApplied) return;
    if (searchWithinOrg && !orgId?.trim()) return;
    runSearch(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsApplied, searchWithinOrg, orgId, selectedTags, selectedTopics, urlQ]);

  const tagCountByValue = useMemo(() => {
    const m = {};
    tagFacets.forEach((f) => { m[f.value] = f.count; });
    return m;
  }, [tagFacets]);
  const topicCountByValue = useMemo(() => {
    const m = {};
    topicFacets.forEach((f) => { m[f.value] = f.count; });
    return m;
  }, [topicFacets]);

  const shownTopics = useMemo(() => {
    return topics.filter((item) => {
      const name = item.topic;
      const count = topicCountByValue[name] ?? item.dataset_count ?? 0;
      return selectedTopics.includes(name) || count > 0;
    });
  }, [topics, topicCountByValue, selectedTopics]);

  const shownTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    return tags.filter((t) => {
      const name = t.tag;
      const count = tagCountByValue[name] ?? t.dataset_count ?? 0;
      if (!selectedTags.includes(name) && count <= 0) return false;
      if (!needle) return true;
      return (
        String(t.tag || "").toLowerCase().includes(needle) ||
        String(t.label || "").toLowerCase().includes(needle)
      );
    });
  }, [tags, tagQuery, tagCountByValue, selectedTags]);

  const hasMore = currentPage * LIMIT < total;

  return (
    <div className="page">
      <section className="explore-head">
        <Contour op={0.4} />
        <div className="wrap inner">
          <span className="eyebrow">Discover</span>
          <h1 className="display">Search</h1>
          <div className="hero-search" style={{ maxWidth: 640, margin: 0 }}>
            <span className="sic"><Ic name="search" size={20} sw={2} style={{ color: "#667085" }} /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(1); } }}
              placeholder="Search by title, description, tag, topic or file…" aria-label="Search query" />
            <button className="btn btn-primary" style={{ borderRadius: 10 }} onClick={() => runSearch(1)} disabled={loading}>Search</button>
          </div>
        </div>
      </section>

      <div className="wrap"><div className="explore-layout">
        <aside className="filters">
          <div className="fh">Refine</div>
          <div className="fgroup">
            <h4>Organization</h4>
            <div className="fbody">
              <label className="check">
                <input type="checkbox" checked={searchWithinOrg} onChange={(e) => setSearchWithinOrg(e.target.checked)} />
                Search within organization
              </label>
              <select className="field" style={{ marginTop: 4 }} value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={!searchWithinOrg} aria-label="Organization">
                <option value="">Select organization</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div className="fgroup">
            <h4>Topics</h4>
            <div className="fbody filter-scroll">
              {shownTopics.map((item) => {
                const name = item.topic;
                const count = topicCountByValue[name] ?? item.dataset_count;
                return (
                  <label className="check" key={name}>
                    <input
                      type="checkbox"
                      checked={selectedTopics.includes(name)}
                      onChange={() => setSelectedTopics((cur) => toggleValue(cur, name))}
                    />
                    {name}{count != null ? ` (${count})` : ""}
                  </label>
                );
              })}
              {shownTopics.length === 0 && (
                <p className="muted" style={{ fontSize: 13 }}>No topics yet</p>
              )}
            </div>
          </div>
          <div className="fgroup">
            <h4>Tags</h4>
            <div className="fbody">
              <input
                type="search"
                className="filter-search"
                placeholder="Filter tags…"
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                aria-label="Filter tags"
              />
              <div className="filter-scroll">
                {shownTags.map((item) => {
                  const name = item.tag;
                  const count = tagCountByValue[name] ?? item.dataset_count;
                  return (
                    <label className="check" key={name}>
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(name)}
                        onChange={() => setSelectedTags((cur) => toggleValue(cur, name))}
                      />
                      {item.label || name}{count != null ? ` (${count})` : ""}
                    </label>
                  );
                })}
                {shownTags.length === 0 && (
                  <p className="muted" style={{ fontSize: 13 }}>No tags</p>
                )}
              </div>
            </div>
          </div>
          <div className="fgroup">
            <h4>Time period</h4>
            <div className="fbody">
              <div className="field" style={{ margin: 0 }}>
                <label>Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>
        </aside>

        <div>
          <div className="results-bar">
            <span className="count"><b>{total}</b> result{total !== 1 ? "s" : ""}</span>
          </div>

          {error && <div className="auth-note" style={{ background: "#faf3e4", borderColor: "#ecdcb8", color: "#9a6b12" }}>{error}</div>}

          {loading ? (
            <div className="empty"><p>Searching…</p></div>
          ) : hasSearched && result.length === 0 ? (
            <div className="empty">
              <div className="eic"><Ic name="search" size={24} sw={1.6} /></div>
              <h3 className="display">No results found</h3>
              <p>Try different terms, a place, topic or organization.</p>
            </div>
          ) : (
            <>
              <div className="rows">
                {result.map((item, i) => (
                  <DatasetRow
                    key={item.dataset_id || i}
                    dataset={{
                      ...item,
                      dataset_id: item.dataset_id,
                      dataset_title: item.title,
                      dataset_description: item.context,
                    }}
                  />
                ))}
              </div>
              {total > LIMIT && (
                <div className="pagination">
                  <button onClick={() => currentPage > 1 && runSearch(currentPage - 1)} disabled={currentPage === 1 || loading} aria-label="Previous">‹</button>
                  {Array.from({ length: Math.ceil(total / LIMIT) }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === Math.ceil(total / LIMIT) || Math.abs(p - currentPage) <= 2)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push("…");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) => (
                      p === "…"
                        ? <span key={`gap-${i}`} className="muted" style={{ padding: "0 4px" }}>…</span>
                        : <button key={p} className={p === currentPage ? "active" : ""} onClick={() => runSearch(p)} disabled={loading}>{p}</button>
                    ))}
                  <button onClick={() => hasMore && runSearch(currentPage + 1)} disabled={!hasMore || loading} aria-label="Next">›</button>
                </div>
              )}
            </>
          )}
        </div>
      </div></div>
    </div>
  );
}
