"""Stream a stored (uncompressed) zip without holding file bodies in memory."""

from __future__ import annotations

import mimetypes
import struct
import zlib
from typing import Callable, Iterable, Iterator, Sequence

# Local headers use a data descriptor, so sizes are written after each file.
_LOCAL_FLAG = 0x0808  # bit 3 data descriptor, bit 11 UTF-8 names
_VERSION = 20


def open_dataset_download(
    members: Sequence[dict],
    read_chunks: Callable[[dict], Iterable[bytes]],
    zip_filename: str,
) -> tuple[str, str, Iterator[bytes]]:
    """One file is returned as itself. Two or more files are a stored zip."""
    if len(members) == 1:
        member = members[0]
        name = member["arcname"]
        media = mimetypes.guess_type(name)[0] or "application/octet-stream"

        def one_file() -> Iterator[bytes]:
            yield from read_chunks(member)

        return media, name, one_file()

    def zipped() -> Iterator[bytes]:
        def entries():
            for member in members:
                yield member["arcname"], read_chunks(member)

        yield from iter_stored_zip(entries())

    return "application/zip", zip_filename, zipped()


def iter_stored_zip(entries: Iterable[tuple[str, Iterable[bytes]]]) -> Iterator[bytes]:
    """Yield zip bytes for (archive name, chunk iterator) entries."""
    central: list[tuple[bytes, int, int, int]] = []
    offset = 0
    for arcname, chunks in entries:
        name = arcname.encode("utf-8")
        header = struct.pack(
            "<IHHHHHIIIHH",
            0x04034B50,
            _VERSION,
            _LOCAL_FLAG,
            0,
            0,
            0,
            0,
            0,
            0,
            len(name),
            0,
        ) + name
        yield header
        crc = 0
        size = 0
        for chunk in chunks:
            if not chunk:
                continue
            crc = zlib.crc32(chunk, crc) & 0xFFFFFFFF
            size += len(chunk)
            yield chunk
        descriptor = struct.pack("<IIII", 0x08074B50, crc, size, size)
        yield descriptor
        central.append((name, crc, size, offset))
        offset += len(header) + size + len(descriptor)

    central_start = offset
    central_size = 0
    for name, crc, size, local_offset in central:
        record = struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50,
            _VERSION,
            _VERSION,
            _LOCAL_FLAG,
            0,
            0,
            0,
            crc,
            size,
            size,
            len(name),
            0,
            0,
            0,
            0,
            0,
            local_offset,
        ) + name
        central_size += len(record)
        yield record

    yield struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        len(central),
        len(central),
        central_size,
        central_start,
        0,
    )
