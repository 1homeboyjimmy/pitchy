from __future__ import annotations

from main import app


def test_accelerator_routes_are_unique_and_modular_routers_are_mounted():
    seen: set[tuple[str, str]] = set()
    duplicates: list[tuple[str, str]] = []
    accelerator_routes: set[tuple[str, str]] = set()
    for route in app.routes:
        if not route.path.startswith("/api/accelerators"):
            continue
        for method in route.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            key = (method, route.path)
            if key in seen:
                duplicates.append(key)
            seen.add(key)
            accelerator_routes.add(key)
    assert duplicates == []
    assert {
        ("GET", "/api/accelerators/cohorts/{cohort_id}/artifacts"),
        ("GET", "/api/accelerators/notifications"),
        ("GET", "/api/accelerators/cohorts/{cohort_id}/teams"),
        ("GET", "/api/accelerators/cohorts/{cohort_id}/closure"),
        ("GET", "/api/accelerators/cohorts/{cohort_id}/analytics"),
        ("PUT", "/api/accelerators/memberships/{membership_id}/quota"),
        ("GET", "/api/accelerators/{accelerator_id}/audit"),
    }.issubset(accelerator_routes)
