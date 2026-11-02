import {
  abort_multipart_endpoint,
  complete_multipart_endpoint,
  upload_part_urls_endpoint,
  upload_url_endpoint,
} from "./endpoints";

// Browsers open at most six HTTP/1.1 connections to one host (S3 uses
// HTTP/1.1 for uploads), so more than six parallel parts gains nothing.
const PART_CONCURRENCY = 4;
const LARGE_FILE_CONCURRENCY = 6;
const LARGE_FILE_BYTES = 1024 * 1024 * 1024;
// With the backoff below, a part keeps trying for about four minutes.
const PART_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60000;
const URL_REFRESHES = 2;
const URL_BATCH = 50;
const API_ATTEMPTS = 4;
const STALL_TIMEOUT_MS = 60000;
const STALL_CHECK_MS = 5000;

export function concurrencyFor(size) {
  return size >= LARGE_FILE_BYTES ? LARGE_FILE_CONCURRENCY : PART_CONCURRENCY;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt) {
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));
}

// Waiting out an outage does not use up retry attempts.
function waitForOnline() {
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.addEventListener("online", resolve, { once: true });
  });
}

function storageError(xhr) {
  const body = xhr.responseText || "";
  let reason = `Upload failed with status ${xhr.status}`;
  if (xhr.status === 403 && /expired/i.test(body)) {
    reason = "The upload link expired before the file finished uploading. Please try again.";
  } else if (xhr.status === 403) {
    reason = "Storage refused the upload (403). Please try again, or contact the platform team.";
  }
  const err = new Error(reason);
  err.status = xhr.status;
  // S3 answers 400 RequestTimeout when a slow link stalls mid-request.
  err.retryable =
    xhr.status >= 500 ||
    xhr.status === 429 ||
    (xhr.status === 400 && /RequestTimeout|IncompleteBody/.test(body));
  return err;
}

function putBlob(url, blob, headers, onProgress, track) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sentBytes = 0;
    let lastActivity = Date.now();
    let stalled = false;
    // A dead connection can hang for hours before the browser reports an
    // error. Abort and retry once nothing has moved for a while.
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
        stalled = true;
        xhr.abort();
      }
    }, STALL_CHECK_MS);
    const done = () => {
      clearInterval(watchdog);
      if (track) track.delete(xhr);
    };
    xhr.upload.onprogress = (evt) => {
      lastActivity = Date.now();
      if (!evt.lengthComputable) return;
      sentBytes = evt.loaded;
      if (onProgress) onProgress(evt.loaded, evt.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr);
        return;
      }
      reject(storageError(xhr));
    };
    // The browser hides the cause here. It is a dropped connection, or, when
    // nothing was sent at all, possibly a CORS rule that blocks this site.
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => {
      done();
      let message = "The upload was interrupted by a network error.";
      if (stalled) {
        message = "The upload stalled: no data reached storage for over a minute.";
      } else if (navigator.onLine === false) {
        message = "Your internet connection dropped during the upload.";
      }
      const err = new Error(message);
      err.status = 0;
      err.retryable = true;
      err.stalled = stalled;
      err.sentBytes = sentBytes;
      reject(err);
    };
    xhr.open("PUT", url);
    Object.entries(headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    if (track) track.add(xhr);
    xhr.send(blob);
  });
}

async function postJson(url, body) {
  let lastErr;
  for (let attempt = 1; attempt <= API_ATTEMPTS; attempt += 1) {
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new Error("Could not reach the server. Check your internet connection.");
      lastErr.retryable = true;
    }
    if (resp && resp.ok) return resp.json();
    if (resp) {
      const txt = await resp.text();
      let detail = txt;
      try {
        detail = JSON.parse(txt).detail || txt;
      } catch {
        // Not JSON; keep the raw text.
      }
      lastErr = new Error(
        resp.status === 401
          ? "Your session has expired. Please sign in again, then upload the files."
          : String(detail)
      );
      lastErr.status = resp.status;
      lastErr.retryable = resp.status >= 500 || resp.status === 429;
    }
    if (!lastErr.retryable || attempt === API_ATTEMPTS) break;
    await sleep(backoff(attempt));
    await waitForOnline();
  }
  throw lastErr;
}

// Part URLs are signed in batches, just before they are needed. URLs signed
// hours earlier can stop working when the server's AWS credentials rotate.
function createPartUrls({ ids, partCount, initial }) {
  const urls = new Map();
  (initial || []).forEach((p) => urls.set(p.part_number, p.url));
  const inflight = new Map();

  async function load(numbers) {
    const request = postJson(upload_part_urls_endpoint, {
      ...ids,
      part_numbers: numbers,
    }).then((data) => {
      (data.parts || []).forEach((p) => urls.set(p.part_number, p.url));
    });
    numbers.forEach((n) => inflight.set(n, request));
    try {
      await request;
    } finally {
      numbers.forEach((n) => {
        if (inflight.get(n) === request) inflight.delete(n);
      });
    }
  }

  return {
    async get(n) {
      if (!urls.has(n) && inflight.has(n)) await inflight.get(n);
      if (urls.has(n)) return urls.get(n);
      const numbers = [n];
      for (let m = n + 1; m <= partCount && numbers.length < URL_BATCH; m += 1) {
        if (!urls.has(m) && !inflight.has(m)) numbers.push(m);
      }
      await load(numbers);
      if (!urls.has(n)) throw new Error(`No upload URL for part ${n}.`);
      return urls.get(n);
    },
    // Every cached URL was signed with the same credentials, so drop them all.
    reset() {
      urls.clear();
    },
    release(n) {
      urls.delete(n);
    },
  };
}

// Failures before a single byte reaches storage, while online, look like a
// CORS block. Give up on those quickly instead of retrying for minutes.
const UNREACHABLE_ATTEMPTS = 3;

async function putWithRetry({ getUrl, onExpired, blob, headers, onProgress, uploadState }) {
  let attempt = 0;
  let refreshes = 0;
  for (;;) {
    if (uploadState.cancelled) throw uploadState.error;
    await waitForOnline();
    const url = await getUrl();
    if (uploadState.cancelled) throw uploadState.error;
    try {
      return await putBlob(url, blob, headers, onProgress, uploadState.xhrs);
    } catch (err) {
      if (uploadState.cancelled) throw uploadState.error || err;
      if (err.sentBytes) uploadState.anyProgress = true;
      if (onProgress) onProgress(0);
      if (err.status === 403 && onExpired && refreshes < URL_REFRESHES) {
        refreshes += 1;
        onExpired();
        continue;
      }
      attempt += 1;
      const unreachable =
        err.status === 0 &&
        !err.stalled &&
        !uploadState.anyProgress &&
        navigator.onLine !== false;
      if (unreachable && attempt >= UNREACHABLE_ATTEMPTS) {
        err.message =
          "Could not reach file storage. If your internet connection works, the storage CORS " +
          `settings may not allow uploads from ${window.location.origin}. Contact the platform team.`;
        throw err;
      }
      if (!err.retryable || attempt >= PART_ATTEMPTS) throw err;
      await sleep(backoff(attempt));
    }
  }
}

async function uploadMultipart({ jobId, fileId, file, uploadData, onProgress }) {
  const ids = { job_id: jobId, file_id: fileId, upload_id: uploadData.upload_id };
  const partSize = uploadData.part_size;
  const partCount = uploadData.part_count || Math.max(1, Math.ceil(file.size / partSize));
  const partUrls = createPartUrls({ ids, partCount, initial: uploadData.parts });
  const uploadState = { cancelled: false, error: null, anyProgress: false, xhrs: new Set() };
  const loadedByPart = new Map();
  const etags = [];

  const report = () => {
    if (!onProgress) return;
    let loaded = 0;
    loadedByPart.forEach((v) => {
      loaded += v;
    });
    onProgress(Math.min(100, Math.round((loaded / file.size) * 100)), loaded);
  };

  let next = 1;
  const worker = async () => {
    while (!uploadState.cancelled && next <= partCount) {
      const partNumber = next;
      next += 1;
      const start = (partNumber - 1) * partSize;
      const blob = file.slice(start, Math.min(start + partSize, file.size));
      const xhr = await putWithRetry({
        getUrl: () => partUrls.get(partNumber),
        onExpired: () => partUrls.reset(),
        blob,
        headers: {},
        onProgress: (loaded) => {
          if (loaded) uploadState.anyProgress = true;
          loadedByPart.set(partNumber, loaded);
          report();
        },
        uploadState,
      });
      partUrls.release(partNumber);
      loadedByPart.set(partNumber, blob.size);
      report();
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        throw new Error(
          "S3 did not return an ETag. Check that the bucket CORS rule exposes the ETag header."
        );
      }
      etags.push({ part_number: partNumber, etag: `"${etag.replace(/"/g, "")}"` });
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrencyFor(file.size), partCount) }, () =>
        worker().catch((err) => {
          if (!uploadState.cancelled) {
            uploadState.cancelled = true;
            uploadState.error = err;
            uploadState.xhrs.forEach((x) => x.abort());
          }
          throw uploadState.error;
        })
      )
    );
  } catch (err) {
    postJson(abort_multipart_endpoint, ids).catch(() => {});
    throw err;
  }

  etags.sort((a, b) => a.part_number - b.part_number);
  try {
    await postJson(complete_multipart_endpoint, { ...ids, parts: etags });
  } catch (err) {
    throw new Error(`Failed to complete multipart upload: ${err.message}`);
  }
}

/**
 * Request a presigned URL (or a multipart session) and upload the file to S3.
 * @returns {{ fileId: string, uploadData: object }}
 */
export async function requestAndUploadFile({ jobId, file, filename, onProgress }) {
  const params = new URLSearchParams({
    job_id: jobId,
    filename: filename || file.name,
    file_size: String(file.size),
  });
  if (file?.name) params.set("original_filename", file.name);
  const uploadResp = await fetch(`${upload_url_endpoint}?${params.toString()}`, {
    credentials: "include",
  });
  if (!uploadResp.ok) {
    const txt = await uploadResp.text();
    let body = null;
    try {
      body = JSON.parse(txt);
    } catch {
      // Not JSON; fall through to the raw text.
    }
    if (uploadResp.status === 409) {
      const err = new Error("This file is already uploaded in some dataset.");
      err.status = 409;
      err.conflict = {
        datasetId: body?.dataset_id || null,
        datasetTitle: body?.dataset_title || null,
      };
      throw err;
    }
    if (uploadResp.status === 401) {
      const err = new Error("Your session has expired. Please sign in again, then upload the files.");
      err.status = 401;
      throw err;
    }
    const detail = typeof body?.detail === "string" ? body.detail : txt;
    const err = new Error(`Failed to get upload URL: ${detail}`);
    err.status = uploadResp.status;
    throw err;
  }
  const uploadData = await uploadResp.json();
  const fileId = uploadData.file_id;
  if (!fileId) {
    throw new Error("File ID missing in response.");
  }

  if (uploadData.multipart) {
    await uploadMultipart({ jobId, fileId, file, uploadData, onProgress });
    return { fileId, uploadData };
  }

  const uploadUrl =
    uploadData.presigned_upload_url ||
    uploadData.upload_url ||
    uploadData.url ||
    uploadData.uploadUrl;
  if (!uploadUrl) {
    throw new Error("Upload URL missing in response.");
  }
  const contentType =
    uploadData.content_type || file.type || "application/octet-stream";
  await putWithRetry({
    getUrl: async () => uploadUrl,
    blob: file,
    headers: { "Content-Type": contentType },
    onProgress: (loaded, total) => {
      if (onProgress) onProgress(total ? Math.round((loaded / total) * 100) : 0, loaded);
    },
    uploadState: { cancelled: false, error: null, anyProgress: false, xhrs: new Set() },
  });
  return { fileId, uploadData };
}
