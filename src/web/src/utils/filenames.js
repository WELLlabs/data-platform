/** Split a browser file name into an editable basename and a locked extension. */
export function splitFilename(name) {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { basename: base, extension: "" };
  return { basename: base.slice(0, dot), extension: base.slice(dot + 1) };
}

const FORBIDDEN = '<>:"|?*\\/';

export function filenameHasForbiddenChar(value) {
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || FORBIDDEN.includes(text[i])) return true;
  }
  return false;
}

/** Compose the storage name. Returns "" when the basename is not usable. */
export function storedFilename(basename, extension) {
  const stem = String(basename || "").trim();
  if (!stem || stem === "." || stem === ".." || filenameHasForbiddenChar(stem)) return "";
  const ext = String(extension || "").replace(/^\./, "").trim();
  if (filenameHasForbiddenChar(ext)) return "";
  return ext ? `${stem}.${ext}` : stem;
}
