"""Storage filenames. Do not run these through HTML sanitisers."""

from __future__ import annotations

import re
from typing import Optional

MAX_FILENAME_LENGTH = 200
_CONTROL = re.compile(r"[\x00-\x1f]")
_FORBIDDEN = set('<>:"|?*\\')


class FilenameError(ValueError):
    """The storage name cannot be used."""


def file_extension(name: Optional[str]) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if "." not in base:
        return ""
    stem, ext = base.rsplit(".", 1)
    if not stem or not ext:
        return ""
    return ext.lower()


def sanitize_storage_filename(
    filename: Optional[str],
    original_filename: Optional[str] = None,
) -> str:
    """Return a basename safe to store. Reject path tricks and extension changes."""
    if filename is None:
        raise FilenameError("Invalid filename")
    name = str(filename).replace("\\", "/").rsplit("/", 1)[-1].strip()
    name = _CONTROL.sub("", name)
    if not name or name in {".", ".."}:
        raise FilenameError("Invalid filename")
    if any(char in name for char in _FORBIDDEN):
        raise FilenameError("Invalid filename")
    if len(name) > MAX_FILENAME_LENGTH:
        raise FilenameError("Filename is too long")
    if original_filename:
        if file_extension(name) != file_extension(original_filename):
            raise FilenameError("The original file extension must be kept")
    return name
