import { check_files_endpoint } from "./endpoints";
import { storedFilename } from "../utils/filenames";

/**
 * Ask the API which of these file entries already exist in the user's uploads.
 * Returns a Map of entry key -> { datasetId, datasetTitle } for conflicts only.
 * Failures are swallowed: the upload step still reports conflicts.
 */
export async function findExistingFiles(entries) {
  const found = new Map();
  const checkable = entries.filter((e) => storedFilename(e.basename, e.extension));
  if (!checkable.length) return found;
  try {
    const resp = await fetch(check_files_endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: checkable.map((e) => ({
          filename: storedFilename(e.basename, e.extension),
          original_filename: e.file?.name || null,
        })),
      }),
    });
    if (!resp || !resp.ok) return found;
    const data = await resp.json();
    (data?.results || []).forEach((r, i) => {
      if (r && r.exists && checkable[i]) {
        found.set(checkable[i].key, {
          datasetId: r.dataset_id || null,
          datasetTitle: r.dataset_title || null,
        });
      }
    });
  } catch {
    // Network or parsing problem; skip the early check.
  }
  return found;
}
