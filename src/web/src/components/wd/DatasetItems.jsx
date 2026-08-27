import React from "react";
import { Link } from "react-router-dom";
import Ic from "./Icons";

export const dsLink = (id) => `/dataset-info?dataset_id=${encodeURIComponent(id)}`;
export const fmtCount = (v) => (typeof v === "number" ? v.toLocaleString() : v == null ? null : v);

export function AvailBadge({ isPrivate }) {
  return isPrivate
    ? <span className="badge lock"><Ic name="lock" size={12} sw={1.9} />Private</span>
    : <span className="badge public dot">Public</span>;
}

// Normalize the various API row shapes into one view model.
export function normalize(d) {
  return {
    id: d.dataset_id ?? d.id ?? d.datasetId,
    title: d.dataset_title || d.title || "Untitled dataset",
    desc: d.dataset_description || d.context || d.description || "",
    org: d.organization || d.organization_name || "",
    downloads: d.downloads,
    files: d.file_count,
    isPrivate: !!d.private,
    date: d.created_at || d.updated_at,
  };
}

export function DatasetRow({ dataset }) {
  const d = normalize(dataset);
  const specs = [];
  if (d.files != null) specs.push(`${d.files} files`);
  if (d.downloads != null) specs.push(`${fmtCount(d.downloads)} downloads`);
  return (
    <Link className="drow" to={dsLink(d.id)}>
      <div className="rt"><span className="cat">Dataset</span><h3>{d.title}</h3></div>
      {d.desc && <p className="rd">{d.desc}</p>}
      <div className="rm">
        {d.org && <span>{d.org}</span>}
        {specs.length > 0 && <span className="spec">{specs.join(" · ")}</span>}
        <AvailBadge isPrivate={d.isPrivate} />
      </div>
      <span className="arrow"><Ic name="arrow" size={16} /></span>
    </Link>
  );
}

export function DatasetCard({ dataset }) {
  const d = normalize(dataset);
  return (
    <Link className="dcard" to={dsLink(d.id)}>
      <div className="top"><span className="cat">Dataset</span><AvailBadge isPrivate={d.isPrivate} /></div>
      <h3>{d.title}</h3>
      <p className="desc">{d.desc || "No description provided."}</p>
      {d.org && <div className="prov">{d.org}</div>}
      <div className="specs">
        {d.files != null && <span className="mono-token">{d.files} files</span>}
        {d.downloads != null && <span className="mono-token">{fmtCount(d.downloads)} downloads</span>}
      </div>
    </Link>
  );
}
