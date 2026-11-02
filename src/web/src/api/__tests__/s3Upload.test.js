import { requestAndUploadFile } from "../s3Upload";

class FakeXHR {
  static handler = () => {};
  static sent = [];

  constructor() {
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.responseText = "";
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key, value) {
    this.headers[key] = value;
  }

  getResponseHeader(name) {
    return name.toLowerCase() === "etag" ? this.etag : null;
  }

  send(blob) {
    this.blob = blob;
    FakeXHR.sent.push(this);
    queueMicrotask(() => FakeXHR.handler(this));
  }

  abort() {
    this.aborted = true;
    if (this.onabort) this.onabort();
  }

  respond(status, { etag, body = "" } = {}) {
    this.status = status;
    this.etag = etag;
    this.responseText = body;
    if (status === 200 && this.upload.onprogress) {
      this.upload.onprogress({ lengthComputable: true, loaded: this.blob.size, total: this.blob.size });
    }
    this.onload();
  }

  dropAfterSomeBytes() {
    this.upload.onprogress({ lengthComputable: true, loaded: 1, total: this.blob.size });
    this.onerror();
  }

  blocked() {
    this.onerror();
  }
}

const PART = 10;
const json = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

function partNumber(url) {
  return Number(new URL(url).searchParams.get("partNumber"));
}

function setup({ size = 25, initialParts = [1] } = {}) {
  const partCount = Math.ceil(size / PART);
  const calls = { partUrls: [], complete: [], abort: 0 };
  let urlVersion = 1;
  const url = (n) => `https://bucket.s3.ap-south-1.amazonaws.com/k?partNumber=${n}&v=${urlVersion}`;
  global.fetch = jest.fn(async (endpoint, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (endpoint.startsWith("/api/upload_url")) {
      return json({
        file_id: "f1",
        multipart: true,
        upload_id: "up1",
        part_size: PART,
        part_count: partCount,
        parts: initialParts.map((n) => ({ part_number: n, url: url(n) })),
      });
    }
    if (endpoint === "/api/upload_part_urls") {
      calls.partUrls.push(body.part_numbers);
      return json({ parts: body.part_numbers.map((n) => ({ part_number: n, url: url(n) })) });
    }
    if (endpoint === "/api/complete_multipart") {
      calls.complete.push(body);
      return calls.completeResponses ? calls.completeResponses.shift() : json({});
    }
    if (endpoint === "/api/abort_multipart") {
      calls.abort += 1;
      return json({});
    }
    throw new Error(`unexpected fetch ${endpoint}`);
  });
  const file = new File(["x".repeat(size)], "big.tif");
  return { calls, file, bumpUrls: () => (urlVersion += 1) };
}

beforeEach(() => {
  FakeXHR.sent = [];
  FakeXHR.handler = (xhr) => xhr.respond(200, { etag: `"etag-${partNumber(xhr.url)}"` });
  global.XMLHttpRequest = FakeXHR;
  jest.spyOn(global, "setTimeout").mockImplementation((fn) => {
    fn();
    return 0;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("uploads every part, fetching later part URLs on demand", async () => {
  const { calls, file } = setup({ size: 25 });
  const progress = [];
  const { fileId } = await requestAndUploadFile({
    jobId: "j1",
    file,
    onProgress: (pct) => progress.push(pct),
  });
  expect(fileId).toBe("f1");
  expect(calls.partUrls).toEqual([[2, 3]]);
  const sizes = Object.fromEntries(FakeXHR.sent.map((x) => [partNumber(x.url), x.blob.size]));
  expect(sizes).toEqual({ 1: 10, 2: 10, 3: 5 });
  expect(calls.complete).toHaveLength(1);
  expect(calls.complete[0].parts).toEqual([
    { part_number: 1, etag: '"etag-1"' },
    { part_number: 2, etag: '"etag-2"' },
    { part_number: 3, etag: '"etag-3"' },
  ]);
  expect(progress[progress.length - 1]).toBe(100);
});

test("a dropped connection retries only that part", async () => {
  const { calls, file } = setup({ size: 25, initialParts: [1, 2, 3] });
  let dropped = false;
  FakeXHR.handler = (xhr) => {
    if (partNumber(xhr.url) === 2 && !dropped) {
      dropped = true;
      xhr.dropAfterSomeBytes();
      return;
    }
    xhr.respond(200, { etag: `"etag-${partNumber(xhr.url)}"` });
  };
  await requestAndUploadFile({ jobId: "j1", file });
  expect(FakeXHR.sent.map((x) => partNumber(x.url)).sort()).toEqual([1, 2, 2, 3]);
  expect(calls.complete).toHaveLength(1);
  expect(calls.abort).toBe(0);
});

test("a stalled connection is aborted after a minute and the part retried", async () => {
  const { calls, file } = setup({ size: 10, initialParts: [1] });
  let now = 0;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const watchdogs = [];
  jest.spyOn(global, "setInterval").mockImplementation((fn) => watchdogs.push(fn));
  jest.spyOn(global, "clearInterval").mockImplementation(() => {});
  let stalled = false;
  let abortedEarly = null;
  FakeXHR.handler = (xhr) => {
    if (!stalled) {
      stalled = true;
      now += 30000;
      watchdogs[watchdogs.length - 1]();
      abortedEarly = Boolean(xhr.aborted);
      now += 31000;
      watchdogs[watchdogs.length - 1]();
      return;
    }
    xhr.respond(200, { etag: '"e"' });
  };
  await requestAndUploadFile({ jobId: "j1", file });
  expect(abortedEarly).toBe(false);
  expect(FakeXHR.sent[0].aborted).toBe(true);
  expect(FakeXHR.sent).toHaveLength(2);
  expect(calls.complete).toHaveLength(1);
});

test("S3 RequestTimeout on a slow link is retried", async () => {
  const { calls, file } = setup({ size: 10, initialParts: [1] });
  let timedOut = false;
  FakeXHR.handler = (xhr) => {
    if (!timedOut) {
      timedOut = true;
      xhr.respond(400, { body: "<Code>RequestTimeout</Code>" });
      return;
    }
    xhr.respond(200, { etag: '"e"' });
  };
  await requestAndUploadFile({ jobId: "j1", file });
  expect(calls.complete).toHaveLength(1);
});

test("an expired part URL is re-signed and the part retried", async () => {
  const { calls, file, bumpUrls } = setup({ size: 20, initialParts: [1, 2] });
  FakeXHR.handler = (xhr) => {
    if (xhr.url.endsWith("v=1") && partNumber(xhr.url) === 2) {
      bumpUrls();
      xhr.respond(403, { body: "<Code>AccessDenied</Code><Message>Request has expired</Message>" });
      return;
    }
    xhr.respond(200, { etag: `"etag-${partNumber(xhr.url)}"` });
  };
  await requestAndUploadFile({ jobId: "j1", file });
  expect(calls.partUrls).toEqual([[2]]);
  expect(calls.complete).toHaveLength(1);
});

test("a part that keeps failing aborts the upload and stops the other parts", async () => {
  const { calls, file } = setup({ size: 80, initialParts: [1, 2, 3, 4, 5, 6, 7, 8] });
  FakeXHR.handler = (xhr) => {
    if (partNumber(xhr.url) === 1) {
      xhr.respond(500, { body: "InternalError" });
      return;
    }
    xhr.respond(200, { etag: `"etag-${partNumber(xhr.url)}"` });
  };
  await expect(requestAndUploadFile({ jobId: "j1", file })).rejects.toThrow("status 500");
  expect(calls.abort).toBe(1);
  expect(calls.complete).toHaveLength(0);
  expect(FakeXHR.sent.filter((x) => partNumber(x.url) === 1)).toHaveLength(8);
});

test("storage that is never reachable points at CORS quickly", async () => {
  const { calls, file } = setup({ size: 10, initialParts: [1] });
  FakeXHR.handler = (xhr) => xhr.blocked();
  await expect(requestAndUploadFile({ jobId: "j1", file })).rejects.toThrow(/CORS/);
  expect(FakeXHR.sent).toHaveLength(3);
  expect(calls.abort).toBe(1);
});

test("completion is retried when the API has a transient error", async () => {
  const { calls, file } = setup({ size: 10, initialParts: [1] });
  calls.completeResponses = [json({ detail: "S3 service unavailable" }, 502), json({})];
  await requestAndUploadFile({ jobId: "j1", file });
  expect(calls.complete).toHaveLength(2);
});

test("small files go up in one PUT with the signed content type", async () => {
  global.fetch = jest.fn(async () =>
    json({ file_id: "f2", presigned_upload_url: "https://bucket/k", content_type: "text/csv" })
  );
  FakeXHR.handler = (xhr) => xhr.respond(200);
  const file = new File(["a,b\n1,2\n"], "t.csv");
  const { fileId } = await requestAndUploadFile({ jobId: "j1", file });
  expect(fileId).toBe("f2");
  expect(FakeXHR.sent).toHaveLength(1);
  expect(FakeXHR.sent[0].headers["Content-Type"]).toBe("text/csv");
});

test("a duplicate file keeps the conflict details", async () => {
  global.fetch = jest.fn(async () => json({ dataset_id: "d1", dataset_title: "Rain" }, 409));
  const err = await requestAndUploadFile({ jobId: "j1", file: new File(["x"], "a.csv") }).catch((e) => e);
  expect(err.status).toBe(409);
  expect(err.conflict).toEqual({ datasetId: "d1", datasetTitle: "Rain" });
});
