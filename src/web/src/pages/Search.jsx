import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { list_organizations_endpoint, search_endpoint } from "../api/endpoints";
import Contour from "../components/wd/Contour";
import Ic from "../components/wd/Icons";

const LIMIT = 10;

export default function Search() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(list_organizations_endpoint, { credentials: "include" });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        const items = data?.items ?? [];
        if (!cancelled) setOrganizations(Array.isArray(items) ? items : []);
      } catch { if (!cancelled) setOrganizations([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.organization) setOrgId((p) => (p === "" ? user.organization : p));
  }, [isAuthenticated, user?.organization]);

  const runSearch = useCallback(async (page = 1) => {
    const q = query?.trim() ?? "";
    if (!q) { setResult([]); setTotal(0); setError(""); setHasSearched(true); return; }
    setLoading(true); setError("");
    const offset = (page - 1) * LIMIT;
    const p = new URLSearchParams();
    p.set("query", q); p.set("limit", String(LIMIT)); p.set("offset", String(offset));
    if (searchWithinOrg && orgId?.trim()) p.set("organization_id", orgId.trim());
    if (startDate?.trim()) p.set("start_date", startDate.trim() + "T00:00:00");
    if (endDate?.trim()) p.set("end_date", endDate.trim() + "T23:59:59");
    if (isAuthenticated && user?.apikey) p.set("apikey", user.apikey);
    try {
      const res = await fetch(`${search_endpoint}?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
      const data = await res.json();
      setResult(data.result ?? []); setTotal(data.total ?? 0); setCurrentPage(page); setHasSearched(true);
    } catch (err) {
      setError(err.message || "Search failed. Please try again."); setResult([]); setTotal(0);
    } finally { setLoading(false); }
  }, [query, searchWithinOrg, orgId, startDate, endDate, isAuthenticated, user?.apikey]);

  useEffect(() => { if (params.get("q")) runSearch(1); /* eslint-disable-next-line */ }, []);

  const hasMore = currentPage * LIMIT < total;
  const openItem = (item) => { if (item?.dataset_id) navigate(`/dataset-info?dataset_id=${encodeURIComponent(item.dataset_id)}`); };

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
              placeholder="Search datasets, places, topics and organizations…" aria-label="Search query" />
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
              <h3 className="display">{query.trim() ? "No results found" : "Start searching"}</h3>
              <p>{query.trim() ? "Try different terms, a place, topic or organization." : "Enter search terms above and press Enter."}</p>
            </div>
          ) : (
            <>
              <div className="rows">
                {result.map((item, i) => (
                  <div className="drow" key={item.dataset_id ? `${item.dataset_id}-${item.file_id ?? i}` : i}
                    style={{ cursor: item.dataset_id ? "pointer" : "default" }} onClick={() => openItem(item)}>
                    <div className="rt"><span className="cat">Result</span><h3>{item.title || "Untitled"}</h3></div>
                    <p className="rd">{item.context || "No context"}</p>
                    {item.dataset_id && <span className="arrow"><Ic name="arrow" size={16} /></span>}
                  </div>
                ))}
              </div>
              {total > 0 && (
                <div className="pagination">
                  <button onClick={() => currentPage > 1 && runSearch(currentPage - 1)} disabled={currentPage === 1 || loading} aria-label="Previous">‹</button>
                  <button className="active">{currentPage}</button>
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
