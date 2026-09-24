import React, { useEffect, useState } from "react";

export default function DocumentViewer({ url, title }) {
  const [pdfLib, setPdfLib] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reactPdf = await import("react-pdf");
        const { pdfjs } = reactPdf;
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
        await import("react-pdf/dist/esm/Page/AnnotationLayer.css");
        await import("react-pdf/dist/esm/Page/TextLayer.css");
        if (!cancelled) setPdfLib(reactPdf);
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
  if (!pdfLib) return <div className="empty"><p>Loading document viewer…</p></div>;

  const { Document, Page } = pdfLib;
  return (
    <div className="preview-pdf">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={() => setError("Could not open this PDF. The object store may block in-browser reads.")}
        loading={<p>Opening document…</p>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page key={i + 1} pageNumber={i + 1} width={920} />
        ))}
      </Document>
      {title ? <p className="muted" style={{ marginTop: 12 }}>{title}</p> : null}
    </div>
  );
}
