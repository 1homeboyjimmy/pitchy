from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in (
            "method",
            "path",
            "status_code",
            "status",
            "latency_ms",
            "ip",
            "user_id",
            "event",
            "run_id",
            "campaign_id",
            "persona_id",
            "model",
            "stage",
            "operation",
            "attempt",
            "attempts",
            "query_index",
            "context_size",
            "source_count",
            "requested_count",
            "completed_count",
            "failed_count",
            "invalid_count",
            "duration_ms",
            "error_type",
            "error_message",
            "provider_status_code",
            "provider_request_id",
            "validation_reason",
            "json_error_line",
            "json_error_column",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def configure_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    if not root.handlers:
        root.addHandler(handler)

    # Suppress verbose library logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("chromadb").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
