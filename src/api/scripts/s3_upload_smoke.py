"""Upload a generated file through the portal's multipart path and verify it.

Uses the same presigning code as /upload_url and /upload_part_urls, PUTs every
part over HTTPS like the browser does (with an Origin header, so the bucket's
CORS answer is checked too), completes the upload, checks the object size, and
deletes it.

    uv run python -m scripts.s3_upload_smoke --size 6G
    uv run python -m scripts.s3_upload_smoke --size 40M --origin https://data.welllabs.org

Run it on the server for sizes above a few GB; from a laptop it is limited by
the upload link.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import time
import uuid

import httpx
from core.config import settings
from services.upload import UploadService, get_s3_client

_UNITS = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3}


def parse_size(text: str) -> int:
    text = text.strip().upper().removesuffix("B").removesuffix("I")
    if text and text[-1] in _UNITS:
        return int(float(text[:-1]) * _UNITS[text[-1]])
    return int(text)


def part_bytes(number: int, size: int) -> bytes:
    return bytes([number % 251]) * size


async def put_part(client, url, data, origin, attempts=5):
    for attempt in range(1, attempts + 1):
        try:
            resp = await client.put(url, content=data, headers={"Origin": origin})
        except httpx.TransportError:
            if attempt == attempts:
                raise
            await asyncio.sleep(2 ** attempt)
            continue
        if resp.status_code < 500 or attempt == attempts:
            return resp
        await asyncio.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


async def main(size: int, origin: str, concurrency: int, keep: bool) -> None:
    service = UploadService()
    session = await service.create_multipart_upload(
        "_upload_smoke", f"{uuid.uuid4()}.bin", size
    )
    key, upload_id = session["key"], session["upload_id"]
    part_size, part_count = session["part_size"], session["part_count"]
    print(f"s3://{settings.S3_BUCKET}/{key}: {size:,} bytes in {part_count} parts of {part_size:,}")

    urls = {p["part_number"]: p["url"] for p in session["parts"]}
    etags: dict[int, str] = {}
    cors_problems: set[str] = set()
    next_part = 1
    sent = 0
    started = time.monotonic()

    async def worker(client):
        nonlocal next_part, sent
        while next_part <= part_count:
            n = next_part
            next_part += 1
            if n not in urls:
                batch = list(range(n, min(part_count, n + 99) + 1))
                for p in await service.presign_upload_parts(key, upload_id, batch):
                    urls.setdefault(p["part_number"], p["url"])
            length = min(part_size, size - (n - 1) * part_size)
            resp = await put_part(client, urls.pop(n), part_bytes(n, length), origin)
            if resp.status_code != 200:
                raise RuntimeError(f"part {n}: HTTP {resp.status_code} {resp.text[:300]}")
            if resp.headers.get("access-control-allow-origin") not in (origin, "*"):
                cors_problems.add(f"origin {origin} is not allowed")
            if "etag" not in resp.headers.get("access-control-expose-headers", "").lower():
                cors_problems.add("ETag is not exposed to the browser")
            etags[n] = resp.headers["etag"]
            sent += length
            elapsed = time.monotonic() - started
            print(
                f"\r{sent / size:6.1%}  {sent / max(elapsed, 1e-6) / 1024 ** 2:7.2f} MiB/s",
                end="",
                flush=True,
            )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, write=600)) as client:
            await asyncio.gather(*(worker(client) for _ in range(min(concurrency, part_count))))
        print()
        await service.complete_multipart_upload(
            key, upload_id, [{"part_number": n, "etag": e} for n, e in sorted(etags.items())]
        )
    except BaseException:
        await service.abort_multipart_upload(key, upload_id)
        raise

    elapsed = time.monotonic() - started
    stored = service.object_size(settings.S3_BUCKET, key)
    print(f"completed in {elapsed:.1f}s ({size / elapsed / 1024 ** 2:.2f} MiB/s); stored size {stored:,}")
    if stored != size:
        raise SystemExit("FAIL: stored size does not match")
    if size > 5 * 1024 ** 3:
        print("OK: object is larger than the 5 GiB single-PUT limit")
    print("CORS: " + ("; ".join(sorted(cors_problems)) if cors_problems else f"OK for {origin}"))
    if not keep:
        get_s3_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
        print("deleted test object")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--size", default="6G", help="e.g. 40M, 6G (default 6G)")
    parser.add_argument("--origin", default=settings.DOMAIN.rstrip("/"))
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--keep", action="store_true", help="keep the uploaded object")
    args = parser.parse_args()
    asyncio.run(main(parse_size(args.size), args.origin, args.concurrency, args.keep))
