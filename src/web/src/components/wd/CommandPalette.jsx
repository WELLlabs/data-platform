import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Ic from "./Icons";
import { search_endpoint } from "../../api/endpoints";

const CmdCtx = createContext({ open: () => {}, close: () => {} });
export const useCmdk = () => useContext(CmdCtx);

export function CommandPalette({ children }) {
  const [visible, setVisible] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const open = useCallback(() => {
    setVisible(true);
    setQ("");
    setItems([]);
    setSel(0);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  }, []);
  const close = useCallback(() => setVisible(false), []);

  // global ⌘K / ctrl-K + esc
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

  // live search against the real API (defensive about response shape)
  useEffect(() => {
    if (!visible) return;
    const term = q.trim();
    if (!term) { setItems([]); setSel(0); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${search_endpoint}?q=${encodeURIComponent(term)}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.results || data.datasets || data.items || []);
        if (cancelled) return;
        setItems(arr.slice(0, 8).map((d) => ({
          id: d.id ?? d.dataset_id ?? d.datasetId,
          title: d.title || d.name || d.dataset_name || "Untitled dataset",
          sub: d.organization_name || d.org || d.description || "",
        })));
        setSel(0);
      } catch (_) { /* ignore */ }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, visible]);

  const goToItem = (i) => {
    const it = items[i];
    close();
    if (it && it.id != null) navigate(`/dataset-info?datasetId=${it.id}`);
    else navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const onInputKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); goToItem(sel); }
  };

  return (
    <CmdCtx.Provider value={{ open, close }}>
      {children}
      <div className={"cmdk-overlay" + (visible ? " show" : "")} role="dialog" aria-modal="true" aria-label="Search"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="cmdk">
          <div className="cmdk-input">
            <Ic name="search" size={18} sw={2} style={{ color: "#667085" }} />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
              placeholder="Search datasets, places, topics and organizations…" autoComplete="off" />
            <kbd style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", border: "1px solid var(--line-strong)", borderRadius: 5, padding: "2px 6px", background: "var(--bg-tint)" }}>esc</kbd>
          </div>
          <div className="cmdk-results">
            {items.length > 0 && <div className="cmdk-sec">Datasets</div>}
            {items.map((it, i) => (
              <div key={i} className={"cmdk-item" + (i === sel ? " sel" : "")} onClick={() => goToItem(i)}>
                <span className="ci"><Ic name="file" size={16} sw={1.7} /></span>
                <span className="cmain"><b>{it.title}</b><span>{it.sub}</span></span>
              </div>
            ))}
            {q.trim() && items.length === 0 && (
              <div className="cmdk-empty">Press <kbd>↵</kbd> to search for “{q.trim()}”.</div>
            )}
            {!q.trim() && (
              <div className="cmdk-empty">Search datasets, places, topics and organizations.</div>
            )}
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
