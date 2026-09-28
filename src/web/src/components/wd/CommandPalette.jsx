import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Ic from "./Icons";
import { dsLink } from "./DatasetItems";
import {
  list_organizations_endpoint,
  search_endpoint,
  tags_suggest_endpoint,
  topics_endpoint,
} from "../../api/endpoints";

const CmdCtx = createContext({ open: () => {}, close: () => {} });
export const useCmdk = () => useContext(CmdCtx);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, q }) {
  const value = String(text || "");
  const needle = (q || "").trim();
  if (!value || needle.length < 2) return value;
  const re = new RegExp(`(${escapeRe(needle)})`, "ig");
  const parts = value.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part
  );
}

function snippet(text, max = 140) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

export function CommandPalette({ children }) {
  const [visible, setVisible] = useState(false);
  const [q, setQ] = useState("");
  const [datasets, setDatasets] = useState([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState([]);
  const [topics, setTopics] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [catalog, setCatalog] = useState({ topics: [], orgs: [] });
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const open = useCallback(() => {
    setVisible(true);
    setQ("");
    setDatasets([]);
    setTags([]);
    setTopics([]);
    setOrgs([]);
    setTotal(0);
    setSel(0);
    setLoading(false);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  }, []);
  const close = useCallback(() => setVisible(false), []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setVisible((v) => !v);
      } else if (e.key === "Escape") {
        setVisible(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (visible) setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [topicsRes, orgsRes] = await Promise.all([
          fetch(topics_endpoint, { credentials: "include" }),
          fetch(list_organizations_endpoint, { credentials: "include" }),
        ]);
        const topicData = topicsRes.ok ? await topicsRes.json() : { topics: [] };
        const orgData = orgsRes.ok ? await orgsRes.json() : { items: [] };
        if (cancelled) return;
        setCatalog({
          topics: Array.isArray(topicData?.topics) ? topicData.topics : [],
          orgs: Array.isArray(orgData?.items) ? orgData.items : [],
        });
      } catch {
        if (!cancelled) setCatalog({ topics: [], orgs: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const term = q.trim();
    if (!term) {
      setDatasets([]);
      setTags([]);
      setTopics([]);
      setOrgs([]);
      setTotal(0);
      setSel(0);
      setLoading(false);
      return undefined;
    }

    const needle = term.toLowerCase();
    setTopics(
      catalog.topics
        .filter((t) => String(t.topic || "").toLowerCase().includes(needle))
        .slice(0, 3)
    );
    setOrgs(
      catalog.orgs
        .filter((o) => {
          const hay = [o.name, o.description, o.org_type].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(needle);
        })
        .slice(0, 3)
    );

    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const searchParams = new URLSearchParams({
          query: term,
          limit: "8",
          offset: "0",
        });
        const [searchRes, tagRes] = await Promise.all([
          fetch(`${search_endpoint}?${searchParams}`, { credentials: "include" }),
          fetch(`${tags_suggest_endpoint}?q=${encodeURIComponent(term)}&limit=6`, { credentials: "include" }),
        ]);
        if (cancelled) return;
        const searchData = searchRes.ok ? await searchRes.json() : { result: [], total: 0 };
        const tagData = tagRes.ok ? await tagRes.json() : { suggestions: [] };
        const rows = Array.isArray(searchData.result) ? searchData.result : [];
        setDatasets(rows);
        setTotal(Number(searchData.total) || rows.length);
        setTags(Array.isArray(tagData.suggestions) ? tagData.suggestions.slice(0, 3) : []);
        setSel(0);
      } catch {
        if (cancelled) return;
        setDatasets([]);
        setTags([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, visible, catalog]);

  const rows = useMemo(() => {
    const term = q.trim();
    const list = [];
    datasets.forEach((d) => {
      const id = d.dataset_id || d.id;
      list.push({
        kind: "dataset",
        key: `ds:${id}`,
        title: d.title || "Untitled dataset",
        sub: d.organization_name || "",
        desc: snippet(d.context),
        tags: Array.isArray(d.tags) ? d.tags.slice(0, 3) : [],
        href: id != null ? dsLink(id) : `/search?q=${encodeURIComponent(term)}`,
      });
    });
    topics.forEach((t) => {
      const count = Number(t.dataset_count);
      list.push({
        kind: "topic",
        key: `topic:${t.topic}`,
        title: t.topic,
        sub: count > 0 ? `${count} dataset${count === 1 ? "" : "s"}` : "Topic",
        href: `/search?topics=${encodeURIComponent(t.topic)}`,
      });
    });
    tags.forEach((t) => {
      list.push({
        kind: "tag",
        key: `tag:${t.tag}`,
        title: t.label || t.tag,
        sub: t.topic && t.topic !== "NA" ? t.topic : "Tag",
        href: `/search?tags=${encodeURIComponent(t.tag)}`,
      });
    });
    orgs.forEach((o) => {
      list.push({
        kind: "org",
        key: `org:${o.id}`,
        title: o.name,
        sub: o.org_type || "Organization",
        href: `/organisation?id=${encodeURIComponent(o.id)}`,
      });
    });
    if (term) {
      list.push({
        kind: "all",
        key: "all",
        title: `Search all results for “${term}”`,
        sub: total > 0 ? `${total} dataset${total === 1 ? "" : "s"}` : "Open full search",
        href: `/search?q=${encodeURIComponent(term)}`,
      });
    }
    return list;
  }, [topics, tags, orgs, datasets, q, total]);

  const goTo = (item) => {
    if (!item) return;
    close();
    navigate(item.href);
  };

  const onInputKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[sel]) goTo(rows[sel]);
      else if (q.trim()) {
        close();
        navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  const iconFor = (kind) => {
    if (kind === "topic") return "grid";
    if (kind === "tag") return "list";
    if (kind === "org") return "org";
    if (kind === "all") return "search";
    return "file";
  };

  const sectionFor = (kind) => {
    if (kind === "topic") return "Topics";
    if (kind === "tag") return "Tags";
    if (kind === "org") return "Organizations";
    if (kind === "dataset") return "Datasets";
    return "";
  };

  let lastSection = "";

  return (
    <CmdCtx.Provider value={{ open, close }}>
      {children}
      <div
        className={"cmdk-overlay" + (visible ? " show" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        aria-hidden={!visible}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div className="cmdk">
          <div className="cmdk-input">
            <Ic name="search" size={18} sw={2} style={{ color: "#667085" }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search datasets, places, topics and organizations…"
              autoComplete="off"
              aria-autocomplete="list"
              tabIndex={visible ? 0 : -1}
            />
            {loading ? <span className="cmdk-spin" aria-hidden="true" /> : <kbd>esc</kbd>}
          </div>
          <div className="cmdk-modes" aria-hidden="true">
            <span>Instant prefix</span>
            <span>Fuzzy typos</span>
            <span>Semantic meaning</span>
          </div>
          <div className="cmdk-results" role="listbox">
            {!q.trim() && (
              <div className="cmdk-empty cmdk-idle">
                <p>Type to search as you go. Misspellings and related meaning still match.</p>
              </div>
            )}
            {q.trim() && !loading && rows.length === 1 && rows[0].kind === "all" && (
              <div className="cmdk-empty">No exact hits. Press <kbd>↵</kbd> to search for “{q.trim()}”.</div>
            )}
            {rows.map((it, i) => {
              const section = sectionFor(it.kind);
              const showSec = section && section !== lastSection;
              if (showSec) lastSection = section;
              return (
                <React.Fragment key={it.key}>
                  {showSec && <div className="cmdk-sec">{section}</div>}
                  <div
                    className={"cmdk-item" + (it.kind === "dataset" ? " cmdk-item-rich" : "") + (i === sel ? " sel" : "")}
                    role="option"
                    aria-selected={i === sel}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => goTo(it)}
                  >
                    <span className="ci"><Ic name={iconFor(it.kind)} size={16} sw={1.7} /></span>
                    <span className="cmain">
                      <b><Highlight text={it.title} q={q} /></b>
                      {it.sub && <span className="csub">{it.sub}</span>}
                      {it.desc && <span className="csnippet"><Highlight text={it.desc} q={q} /></span>}
                      {it.tags?.length > 0 && (
                        <span className="ctags">
                          {it.tags.map((tag) => <em key={tag}>{tag}</em>)}
                        </span>
                      )}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="cmdk-foot">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </div>
      </div>
    </CmdCtx.Provider>
  );
}
