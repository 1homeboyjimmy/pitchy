"""Short-lived, authenticated SSE streams; only revision notices cross Redis."""
import asyncio
import json
import time

from accelerator_dashboard_cache import channel, connection, revision


AUTH_INTERVAL = 15


def message(event, value):
    return f"event: {event}\ndata: {json.dumps(value)}\n\n"


async def dashboard_events(request, cohort_id, check_access):
    # Periodic reconnect bounds resource lifetime and forces a fresh snapshot.
    started = time.monotonic()
    last_ping = started
    last_auth = started
    try:
        async with connection(streaming=True) as client:
            if client is None:
                yield message("fallback", {})
                return
            async with client.pubsub() as subscription:
                await subscription.subscribe(channel(cohort_id), channel("all"))
                current = await revision(client, cohort_id)
                yield "retry: 1500\n\n" + message("ready", {"revision": current})
                while time.monotonic() - started < 55:
                    if await request.is_disconnected():
                        return
                    notice = await subscription.get_message(ignore_subscribe_messages=True, timeout=1)
                    now = time.monotonic()
                    if now - last_auth >= AUTH_INTERVAL:
                        if not await check_access():
                            yield message("forbidden", {})
                            return
                        last_auth = now
                    if notice or now - last_ping >= 15:
                        latest = await revision(client, cohort_id)
                        if latest != current:
                            current = latest
                            yield message("changed", {"revision": current})
                        else:
                            yield message("ping", {"revision": current})
                        last_ping = now
                    if notice is None:
                        await asyncio.sleep(0.01)
    except asyncio.CancelledError:
        raise
    except Exception:
        # The browser falls back to normal authenticated snapshot requests.
        yield message("fallback", {})
