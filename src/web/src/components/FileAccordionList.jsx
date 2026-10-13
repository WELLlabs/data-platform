import React from "react";
import Ic from "./wd/Icons";

function fmtBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const PERMISSION_OPTIONS = [
  "CC0: Public Domain",
  "CC BY: Attribution",
  "CC BY-SA: Attribution-ShareAlike",
  "CC BY-NC: Attribution-NonCommercial",
  "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
  "CC BY-ND: Attribution-NoDerivatives",
  "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
];

function invalidNote() {
  return (
    <span className="err">
      Those characters are removed: &lt; &gt; &quot; &apos; &amp; ; ( )
    </span>
  );
}

/**
 * Per-file name, title, and metadata. Used by dataset creation and later adds.
 */
export default function FileAccordionList({
  files,
  openKeys,
  onToggle,
  onRemove,
  onText,
  onField,
  onBasename,
  disabled = false,
}) {
  if (!files.length) return null;
  return (
    <div className="acc-list">
      {files.map((item) => {
        const isOpen = openKeys.has(item.key);
        const complete = !!item.title?.trim() && !!item.basename?.trim();
        return (
          <div className={"acc" + (isOpen ? " open" : "")} key={item.key}>
            <div className="acc-head">
              <button
                type="button"
                className="acc-toggle"
                onClick={() => onToggle(item.key)}
                aria-expanded={isOpen}
              >
                <span className="acc-chev">
                  <Ic name="chev" size={16} />
                </span>
                <span className="fico">
                  {item.format ? item.format.slice(0, 4).toUpperCase() : "FILE"}
                </span>
                <span className="acc-name">
                  <b>{item.title?.trim() || item.file?.name}</b>
                  <small>
                    {item.file?.name}
                    {item.file?.size != null ? ` · ${fmtBytes(item.file.size)}` : ""}
                  </small>
                </span>
              </button>
              <span className={"chip " + (complete ? "ok" : "todo")}>
                {complete ? "Complete" : "Needs title"}
              </span>
              <button
                type="button"
                className="btn btn-remove"
                aria-label="Remove file"
                onClick={() => onRemove(item.key)}
                disabled={disabled}
              >
                Remove
              </button>
            </div>
            {isOpen && (
              <div className="acc-body">
                <div className="field-row">
                  <div className="field">
                    <label>
                      File name <span className="req">(required)</span>
                    </label>
                    <div className="filename-row">
                      <input
                        type="text"
                        aria-label={`File name for ${item.file?.name || "file"}`}
                        value={item.basename}
                        onChange={(e) => onBasename(item.key, e.target.value)}
                        required
                        disabled={disabled}
                      />
                      {item.extension ? (
                        <span className="filename-ext">.{item.extension}</span>
                      ) : null}
                    </div>
                    {item.errors?.basename && (
                      <span className="err">
                        Enter a file name. The original extension is kept.
                      </span>
                    )}
                  </div>
                  <div className="field">
                    <label>
                      File title <span className="req">(required)</span>
                    </label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => onText(item.key, "title", e.target.value, 200)}
                      required
                      disabled={disabled}
                    />
                    {item.errors?.title && invalidNote()}
                  </div>
                </div>
                <div className="field">
                  <label>File description</label>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      onField(item.key, "description", e.target.value.slice(0, 1000))
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="grid3">
                  <div className="field">
                    <label>Provenance</label>
                    <input
                      type="text"
                      value={item.provenance}
                      onChange={(e) =>
                        onText(item.key, "provenance", e.target.value, 125)
                      }
                      disabled={disabled}
                    />
                    {item.errors?.provenance && invalidNote()}
                  </div>
                  <div className="field">
                    <label>Source</label>
                    <input
                      type="text"
                      value={item.source}
                      onChange={(e) => onText(item.key, "source", e.target.value, 1000)}
                      disabled={disabled}
                    />
                    {item.errors?.source && invalidNote()}
                  </div>
                  <div className="field">
                    <label>Permissions / licence</label>
                    <select
                      value={item.permissions}
                      onChange={(e) => onField(item.key, "permissions", e.target.value)}
                      disabled={disabled}
                    >
                      {PERMISSION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Cite as</label>
                    <input
                      type="text"
                      value={item.citeAs}
                      onChange={(e) =>
                        onField(item.key, "citeAs", e.target.value.slice(0, 1500))
                      }
                      disabled={disabled}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Groundtruthed{" "}
                      <span className="opt">(optional, defaults to No)</span>
                    </label>
                    <div className="seg">
                      <button
                        type="button"
                        className={"seg-opt" + (item.groundtruthed === "yes" ? " on" : "")}
                        onClick={() => onField(item.key, "groundtruthed", "yes")}
                        disabled={disabled}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={"seg-opt" + (item.groundtruthed === "no" ? " on" : "")}
                        onClick={() => onField(item.key, "groundtruthed", "no")}
                        disabled={disabled}
                      >
                        No
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>Duration (years)</label>
                    <input
                      type="number"
                      value={item.duration}
                      onChange={(e) =>
                        onField(
                          item.key,
                          "duration",
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                      min="0"
                      disabled={disabled}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Temporal coverage from <span className="opt">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={item.temporalFrom || ""}
                      onChange={(e) => onField(item.key, "temporalFrom", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Temporal coverage to <span className="opt">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={item.temporalTo || ""}
                      onChange={(e) => onField(item.key, "temporalTo", e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Geographical extent <span className="opt">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={item.geography}
                      onChange={(e) =>
                        onText(item.key, "geography", e.target.value, 2000)
                      }
                      disabled={disabled}
                    />
                    {item.errors?.geography && invalidNote()}
                  </div>
                </div>
                {item.status === "ok" && (
                  <div className="file-status ok">Uploaded</div>
                )}
                {item.status === "error" && (
                  <div className="file-status err" role="alert">
                    {item.statusMessage || "This file was not uploaded."}
                  </div>
                )}
                {item.status === "uploading" && (
                  <div className="file-status">Uploading…</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
