import React, { useEffect, useRef, useState } from "react";
import { tags_suggest_endpoint } from "../../api/endpoints";
import Ic from "./Icons";

const INVALID_CHARS = /[<>"'&;()]/g;

export function normalizeTagSlug(raw) {
  return String(raw || "")
    .replace(INVALID_CHARS, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export default function TagMultiSelect({
  value = [],
  onChange,
  disabled = false,
  id,
  placeholder = "Search tags or add a custom tag",
}) {
  const selected = Array.isArray(value) ? value : [];
  const [query, setQuery] = useState("");
  const [hasInvalidChars, setHasInvalidChars] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const fetchSuggestions = (q) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${tags_suggest_endpoint}?q=${encodeURIComponent(q)}&limit=12`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error("suggest");
        const data = await res.json();
        const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
        const selectedSet = new Set(selected.map((t) => t.toLowerCase()));
        setSuggestions(
          list.filter((s) => s.tag && !selectedSet.has(String(s.tag).toLowerCase()))
        );
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  const updateQuery = (raw) => {
    const invalid = INVALID_CHARS.test(raw);
    INVALID_CHARS.lastIndex = 0;
    const cleaned = raw.replace(INVALID_CHARS, "").slice(0, 80);
    setHasInvalidChars(invalid);
    setQuery(cleaned);
    setOpen(true);
    fetchSuggestions(cleaned);
  };

  const addTag = (slug) => {
    const normalized = normalizeTagSlug(slug);
    if (!normalized) return;
    if (selected.some((t) => t.toLowerCase() === normalized)) {
      setQuery("");
      setSuggestions([]);
      return;
    }
    onChange([...selected, normalized]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  };

  const removeTag = (slug) => {
    onChange(selected.filter((t) => t !== slug));
  };

  const exactMatch = suggestions.some(
    (s) => String(s.tag).toLowerCase() === normalizeTagSlug(query)
  );
  const canAddCustom = Boolean(normalizeTagSlug(query)) && !exactMatch;

  return (
    <div className="tag-multiselect" ref={wrapRef}>
      <div
        className={"tag-multiselect-control" + (disabled ? " disabled" : "")}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          if (!suggestions.length) fetchSuggestions(query);
        }}
      >
        {selected.map((tag) => (
          <span className="chip" key={tag}>
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              aria-label={`Remove ${tag}`}
            >
              <Ic name="close" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          disabled={disabled}
          value={query}
          placeholder={selected.length ? "Add another tag" : placeholder}
          onChange={(e) => updateQuery(e.target.value)}
          onFocus={() => {
            setOpen(true);
            fetchSuggestions(query);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions[0]) addTag(suggestions[0].tag);
              else if (canAddCustom) addTag(query);
            } else if (e.key === "Backspace" && !query && selected.length) {
              removeTag(selected[selected.length - 1]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          autoComplete="off"
        />
      </div>
      {open && !disabled && (loading || suggestions.length > 0 || canAddCustom) && (
        <div className="tag-suggest" role="listbox">
          {loading && suggestions.length === 0 && (
            <div className="tag-suggest-empty">Searching tags…</div>
          )}
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.tag}
              role="option"
              onClick={() => addTag(s.tag)}
            >
              <span>{s.label || s.tag}</span>
              {s.topic && s.topic !== "NA" && (
                <span className="tag-suggest-topic">{s.topic}</span>
              )}
            </button>
          ))}
          {canAddCustom && (
            <button
              type="button"
              className="tag-suggest-add"
              onClick={() => addTag(query)}
            >
              Add “{normalizeTagSlug(query)}”
            </button>
          )}
        </div>
      )}
      {hasInvalidChars && (
        <span className="err">Some characters were removed from the tag.</span>
      )}
    </div>
  );
}
