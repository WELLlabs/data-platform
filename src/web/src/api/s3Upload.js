import {
  complete_multipart_endpoint,
  upload_url_endpoint,
} from "./endpoints";

function putBlob(url, blob, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        onProgress(evt.loaded, evt.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr);
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Upload blocked by the browser (usually S3 CORS). Add a CORS rule on the bucket allowing PUT from http://localhost:3000, with AllowedHeaders * and ExposeHeaders ETag."
        )
      );
    xhr.open("PUT", url);
    Object.entries(headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.send(blob);
  });
}

async function completeMultipart({ jobId, fileId, uploadId, parts }) {
  const resp = await fetch(complete_multipart_endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      file_id: fileId,
      upload_id: uploadId,
      parts,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Failed to complete multipart upload: ${txt}`);
  }
}

/**
 * Request a presigned URL (or multipart part URLs) and upload the file to S3.
 * @returns {{ fileId: string, uploadData: object }}
 */
export async function requestAndUploadFile({ jobId, file, onProgress }) {
  const params = new URLSearchParams({
    job_id: jobId,
    filename: file.name,
    file_size: String(file.size),
  });
  const uploadResp = await fetch(`${upload_url_endpoint}?${params.toString()}`, {
    credentials: "include",
  });
  if (!uploadResp.ok) {
    const txt = await uploadResp.text();
    throw new Error(`Failed to get upload URL: ${txt}`);
  }
  const uploadData = await uploadResp.json();
  const fileId = uploadData.file_id;
  if (!fileId) {
    throw new Error("File ID missing in response.");
  }

  if (uploadData.multipart) {
    const partSize = uploadData.part_size;
    const partsMeta = uploadData.parts || [];
    let uploaded = 0;
    const etags = [];
    for (const part of partsMeta) {
      const start = (part.part_number - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      const xhr = await putBlob(part.url, blob, {}, (loaded) => {
        if (onProgress) {
          onProgress(Math.round(((uploaded + loaded) / file.size) * 100));
        }
      });
      uploaded += blob.size;
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        throw new Error(
          "S3 did not return an ETag. Check that the bucket CORS rule exposes the ETag header."
        );
      }
      etags.push({ part_number: part.part_number, etag: etag.replace(/"/g, "") });
      if (onProgress) {
        onProgress(Math.round((uploaded / file.size) * 100));
      }
    }
    await completeMultipart({
      jobId,
      fileId,
      uploadId: uploadData.upload_id,
      parts: etags.map((p) => ({
        part_number: p.part_number,
        etag: `"${p.etag}"`,
      })),
    });
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
  await putBlob(uploadUrl, file, { "Content-Type": contentType }, (loaded, total) => {
    if (onProgress && total) {
      onProgress(Math.round((loaded / total) * 100));
    }
  });
  return { fileId, uploadData };
}
