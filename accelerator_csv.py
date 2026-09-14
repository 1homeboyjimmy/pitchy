"""Excel-compatible CSV helpers shared by accelerator exports."""
from __future__ import annotations

from datetime import datetime, timezone
import csv
import io
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo


FORMULA_PREFIXES = ("=", "+", "-", "@")


def safe_csv_value(value):
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return f"'{value}"
    return value


def csv_content(rows: Iterable[Sequence[object]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\r\n")
    for row in rows:
        writer.writerow([safe_csv_value(value) for value in row])
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def csv_datetime(value: datetime | None, timezone_name: str = "Europe/Moscow") -> str:
    if value is None:
        return ""
    source = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        target = ZoneInfo(timezone_name)
    except (KeyError, ValueError):
        target = timezone.utc
    return source.astimezone(target).strftime("%d.%m.%Y %H:%M")


def csv_filename(prefix: str, *, now: datetime | None = None) -> str:
    return f"{prefix}-{(now or datetime.utcnow()).strftime('%Y-%m-%d')}.csv"
