"""Render transactional email HTML from files in this directory."""

from __future__ import annotations

import html as html_lib
import re
from pathlib import Path
from typing import Any

TEMPLATES_DIR = Path(__file__).resolve().parent
_IF_BLOCK = re.compile(r"\{%\s*if\s+(\w+)\s*%\}(.*?)\{%\s*endif\s*%\}", re.DOTALL)
_RAW_VAR = re.compile(r"\{\{\{\s*(\w+)\s*\}\}\}")
_ESC_VAR = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def _truthy(value: str) -> bool:
    return bool(value and value.strip())


def _apply_if_blocks(source: str, values: dict[str, str]) -> str:
    def repl(match: re.Match[str]) -> str:
        return match.group(2) if _truthy(values.get(match.group(1), "")) else ""

    return _IF_BLOCK.sub(repl, source)


def _substitute(source: str, values: dict[str, str], *, raw_keys: set[str]) -> str:
    def raw_repl(match: re.Match[str]) -> str:
        return values.get(match.group(1), "")

    def esc_repl(match: re.Match[str]) -> str:
        key = match.group(1)
        val = values.get(key, "")
        if key in raw_keys:
            return val
        return html_lib.escape(val, quote=True)

    filled = _RAW_VAR.sub(raw_repl, source)
    return _ESC_VAR.sub(esc_repl, filled)


def render_email(
    template_name: str,
    *,
    email_title: str,
    sender_name: str,
    host_name: str = "",
    **context: Any,
) -> str:
    """Render ``template_name`` inside ``base.html`` with HTML-escaped variables."""
    values = {key: "" if value is None else str(value) for key, value in context.items()}
    values["email_title"] = email_title
    values["sender_name"] = sender_name
    values["host_name"] = host_name

    inner_src = (TEMPLATES_DIR / template_name).read_text(encoding="utf-8")
    inner_html = _substitute(_apply_if_blocks(inner_src, values), values, raw_keys=set())

    base_src = (TEMPLATES_DIR / "base.html").read_text(encoding="utf-8")
    base_values = {**values, "content": inner_html}
    return _substitute(
        _apply_if_blocks(base_src, base_values),
        base_values,
        raw_keys={"content"},
    )
