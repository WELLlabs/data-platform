import React, { useEffect, useState } from "react";

const TEXT_LIMIT = 1_500_000;
const VIDEO = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);

export default function MediaViewer({ url, format, kind, title }) {
  const [body, setBody] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [textState, setTextState] = useState(kind === "text" ? "loading" : "ready");

  useEffect(() => {
    if (kind !== "text" || !url) return undefined;
    let cancelled = false;
    setTextState("loading");
    setError("");
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Could not load this file.");
        const len = Number(resp.headers.get("content-length") || 0);
        if (len > TEXT_LIMIT) {
          if (!cancelled) {
            setError("This file is too large to show as text. Download it instead.");
            setTextState("error");
          }
          return;
        }
        const text = await resp.text();
        if (cancelled) return;
        if (text.length > TEXT_LIMIT) {
          setBody(text.slice(0, TEXT_LIMIT));
          setTruncated(true);
        } else {
          setBody(text);
        }
        setTextState("ready");
      } catch {
        if (!cancelled) setTextState("iframe");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, kind]);

  if (!url) {
    return (
      <div className="preview-empty">
        <h3 className="display">Preview unavailable</h3>
        <p>The file link is missing.</p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="preview-media">
        <img src={url} alt={title || "File preview"} />
      </div>
    );
  }

  if (kind === "media") {
    const ext = String(format || "").toLowerCase();
    if (VIDEO.has(ext)) {
      return (
        <div className="preview-media">
          <video src={url} controls style={{ width: "100%", maxHeight: "78vh" }} />
        </div>
      );
    }
    return (
      <div className="preview-media">
        <audio src={url} controls />
      </div>
    );
  }

  if (kind === "text") {
    if (textState === "loading") return <div className="empty"><p>Loading file…</p></div>;
    if (textState === "error") {
      return (
        <div className="preview-empty">
          <h3 className="display">Preview unavailable</h3>
          <p>{error}</p>
        </div>
      );
    }
    if (textState === "iframe") {
      return <iframe className="preview-frame" src={url} title={title || "File preview"} />;
    }
    return (
      <div>
        <pre className="preview-code">{body}</pre>
        {truncated ? <p className="muted">Showing the first part of this file.</p> : null}
      </div>
    );
  }

  return <iframe className="preview-frame" src={url} title={title || "File preview"} />;
}
