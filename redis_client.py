from __future__ import annotations

import os
from typing import Optional

import redis

_REDIS_CLIENT: Optional[redis.Redis] = None


def get_redis() -> Optional[redis.Redis]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT

    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        client = redis.Redis.from_url(url, decode_responses=True)
        client.ping()
    except redis.RedisError:
        return None
    _REDIS_CLIENT = client
    return _REDIS_CLIENT
