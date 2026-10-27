import React, { useEffect, useState } from "react";

export default function DocumentViewer({ url, title }) {
  const [Preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@files-preview-app/preview-file/react");
        await import("@files-preview-app/preview-file/styles.css");
        if (!cancelled) setPreview(() => mod.FilePreview);
      } catch (e) {
        if (!cancelled) setError("Could not load the document viewer.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="preview-empty">
        <h3 className="display">Document unavailable</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!Preview) return <div className="empty"><p>Loading document viewer…</p></div>;

  return (
    <div className="preview-pdf" style={{ width: "100%", height: "75vh" }}>
      <Preview
        src={url}
        options={{ theme: "light", showToolbar: true, toolbarPosition: "top" }}
        onError={() =>
          setError("Could not open this document. The object store may block in-browser reads.")
        }
      />
      {title ? <p className="muted" style={{ marginTop: 12 }}>{title}</p> : null}
    </div>
  );
}
