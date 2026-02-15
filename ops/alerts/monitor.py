#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import ssl
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def yc_payload_get(secret_id: str) -> dict[str, Any]:
    commands = [
        ["yc", "lockbox", "payload", "get", "--secret-id", secret_id, "--format", "json"],
        ["yc", "lockbox", "payload", "get", secret_id, "--format", "json"],
    ]
    last_error = ""
    for cmd in commands:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            try:
                return json.loads(proc.stdout)
            except json.JSONDecodeError as exc:
                raise RuntimeError("Failed to parse yc lockbox payload JSON") from exc
        last_error = (proc.stderr or proc.stdout or "").strip()
    raise RuntimeError(
        f"Failed to read Lockbox payload for secret '{secret_id}': {last_error}"
    )


def lockbox_get_text_value(secret_id: str, entry_key: str) -> str:
    payload = yc_payload_get(secret_id)
    entries = payload.get("entries", [])
    if not entries:
        raise RuntimeError(f"Lockbox secret '{secret_id}' has no entries")

    if entry_key:
        for item in entries:
            if item.get("key") == entry_key:
                value = item.get("textValue") or item.get("text_value")
                if value:
                    return value
                raise RuntimeError(
                    f"Lockbox entry '{entry_key}' in secret '{secret_id}' has no text value"
                )

    for item in entries:
        value = item.get("textValue") or item.get("text_value")
        if value:
            return value

    raise RuntimeError(f"No text entries found in Lockbox secret '{secret_id}'")


def http_get_text(url: str, timeout: int, host_header: str = "") -> str:
    headers = {}
    if host_header:
        headers["Host"] = host_header
    req = Request(url, method="GET", headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def http_get_json(url: str, timeout: int, host_header: str = "") -> Any:
    return json.loads(http_get_text(url, timeout, host_header=host_header))


def telegram_send(bot_token: str, chat_id: str, text: str, timeout: int) -> None:
    api = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = urlencode(
        {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
    req = Request(
        api,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(req, timeout=timeout) as _:
        return


def read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"last_5xx_total": 0.0, "active_alerts": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"last_5xx_total": 0.0, "active_alerts": []}


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")


def parse_5xx_total(metrics_text: str) -> float:
    total = 0.0
    pattern = re.compile(r'^http_requests_total\{([^}]*)\}\s+([0-9eE+\-.]+)$')
    status_pattern = re.compile(r'status="(\d{3})"')
    for line in metrics_text.splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        labels_raw, value_raw = match.groups()
        status_match = status_pattern.search(labels_raw)
        if not status_match:
            continue
        if status_match.group(1).startswith("5"):
            try:
                total += float(value_raw)
            except ValueError:
                continue
    return total


def ssl_days_left(host: str, port: int, timeout: int) -> int:
    context = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls:
            cert = tls.getpeercert()
    not_after = cert.get("notAfter")
    if not not_after:
        raise RuntimeError("SSL certificate has no notAfter field")
    expires_at = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(
        tzinfo=timezone.utc
    )
    delta = expires_at - datetime.now(timezone.utc)
    return max(0, delta.days)


@dataclass
class Config:
    bot_token: str
    chat_ids: list[str]
    health_url: str
    metrics_url: str
    ssl_host: str
    ssl_port: int
    ssl_days_threshold: int
    disk_path: str
    disk_usage_threshold_pct: int
    error_spike_threshold: int
    request_timeout_seconds: int
    http_host_header: str
    state_file: Path
    enabled: bool


def load_config(env_file: Path) -> Config:
    env = load_dotenv(env_file)
    bot_token = env.get("ALERT_TELEGRAM_BOT_TOKEN", "")
    raw_chat_ids = env.get("ALERT_TELEGRAM_CHAT_ID", "")
    chat_ids = [item.strip() for item in raw_chat_ids.split(",") if item.strip()]
    lockbox_secret_id = env.get("ALERT_TELEGRAM_BOT_TOKEN_LOCKBOX_SECRET_ID", "")
    lockbox_entry_key = env.get(
        "ALERT_TELEGRAM_BOT_TOKEN_LOCKBOX_ENTRY_KEY", "ALERT_TELEGRAM_BOT_TOKEN"
    )
    if not bot_token and lockbox_secret_id:
        if shutil.which("yc") is None:
            raise RuntimeError(
                "yc CLI is required to read ALERT_TELEGRAM_BOT_TOKEN from Lockbox"
            )
        bot_token = lockbox_get_text_value(lockbox_secret_id, lockbox_entry_key)
    return Config(
        bot_token=bot_token,
        chat_ids=chat_ids,
        health_url=env.get("ALERT_HEALTH_URL", "https://pitchy.pro/health"),
        metrics_url=env.get("ALERT_METRICS_URL", "https://pitchy.pro/metrics"),
        ssl_host=env.get("ALERT_SSL_HOST", "pitchy.pro"),
        ssl_port=parse_int(env.get("ALERT_SSL_PORT"), 443),
        ssl_days_threshold=parse_int(env.get("ALERT_SSL_DAYS_THRESHOLD"), 14),
        disk_path=env.get("ALERT_DISK_PATH", "/"),
        disk_usage_threshold_pct=parse_int(
            env.get("ALERT_DISK_USAGE_THRESHOLD_PCT"), 85
        ),
        error_spike_threshold=parse_int(env.get("ALERT_5XX_SPIKE_THRESHOLD"), 20),
        request_timeout_seconds=parse_int(env.get("ALERT_REQUEST_TIMEOUT_SECONDS"), 10),
        http_host_header=env.get("ALERT_HTTP_HOST_HEADER", ""),
        state_file=Path(
            env.get("ALERT_STATE_FILE", "/opt/ai-startup/ops/alerts/state.json")
        ),
        enabled=parse_bool(env.get("ALERTS_ENABLED"), False),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Pitchy alerts monitor")
    parser.add_argument(
        "--env-file",
        default="ops/alerts/.env",
        help="Path to monitor env file",
    )
    args = parser.parse_args()

    cfg = load_config(Path(args.env_file))
    if not cfg.enabled:
        print("Alerts disabled. Set ALERTS_ENABLED=true to enable checks.")
        return 0
    if not cfg.bot_token or not cfg.chat_ids:
        raise SystemExit(
            "ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID are required"
        )

    state = read_state(cfg.state_file)
    prev_active = set(state.get("active_alerts", []))
    current_active: dict[str, str] = {}
    events: list[str] = []

    # health + db availability
    try:
        health = http_get_json(
            cfg.health_url,
            cfg.request_timeout_seconds,
            host_header=cfg.http_host_header,
        )
        status = str(health.get("status", "unknown"))
        db_ok = health.get("db")
        if status != "ok":
            current_active["health_degraded"] = (
                f"Health degraded: status={status}, db={health.get('db')}, "
                f"redis={health.get('redis')}, rag={health.get('rag')}"
            )
        if db_ok is False:
            current_active["db_unavailable"] = "Database healthcheck failed"
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        current_active["health_unreachable"] = f"Health endpoint unreachable: {exc}"

    # disk usage
    disk = shutil.disk_usage(cfg.disk_path)
    disk_used_pct = int((disk.used / disk.total) * 100)
    if disk_used_pct >= cfg.disk_usage_threshold_pct:
        current_active["disk_high"] = (
            f"Disk usage is high on {cfg.disk_path}: {disk_used_pct}%"
        )

    # ssl expiration
    try:
        days_left = ssl_days_left(
            cfg.ssl_host, cfg.ssl_port, cfg.request_timeout_seconds
        )
        if days_left <= cfg.ssl_days_threshold:
            current_active["ssl_expiring"] = (
                f"SSL cert for {cfg.ssl_host} expires in {days_left} day(s)"
            )
    except Exception as exc:  # noqa: BLE001
        current_active["ssl_check_failed"] = f"SSL check failed for {cfg.ssl_host}: {exc}"

    # 5xx spike (event-based)
    try:
        metrics_text = http_get_text(
            cfg.metrics_url,
            cfg.request_timeout_seconds,
            host_header=cfg.http_host_header,
        )
        current_5xx_total = parse_5xx_total(metrics_text)
        prev_5xx_total = float(state.get("last_5xx_total", 0.0))
        delta = current_5xx_total - prev_5xx_total
        if delta < 0:
            delta = 0
        if delta >= cfg.error_spike_threshold:
            events.append(
                f"5xx spike detected: +{int(delta)} errors since last check "
                f"(threshold={cfg.error_spike_threshold})"
            )
        state["last_5xx_total"] = current_5xx_total
    except Exception as exc:  # noqa: BLE001
        current_active["metrics_unreachable"] = f"Metrics endpoint unreachable: {exc}"

    # new/resolved alerts
    for key, message in current_active.items():
        if key not in prev_active:
            events.append(f"ALERT: {message}")
    for key in prev_active - set(current_active.keys()):
        events.append(f"RESOLVED: {key}")

    state["active_alerts"] = sorted(current_active.keys())
    write_state(cfg.state_file, state)

    if events:
        lines = [
            "Pitchy monitor alerts:",
            *[f"- {line}" for line in events],
        ]
        for chat_id in cfg.chat_ids:
            telegram_send(
                cfg.bot_token,
                chat_id,
                "\n".join(lines),
                cfg.request_timeout_seconds,
            )
        print("Alerts sent:")
        for event in events:
            print(f" - {event}")
    else:
        print("No new alerts.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
