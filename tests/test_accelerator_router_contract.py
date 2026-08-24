from __future__ import annotations

from pathlib import Path

from routers import accelerator_alumni
from routers import accelerator_artifacts
from routers import accelerator_governance
from routers import accelerator_notifications
from routers import accelerator_operations
from routers import accelerator_teams
from routers import accelerators


def test_accelerator_routes_are_unique_and_modular_routers_are_mounted():
    modules = (
        accelerators,
        accelerator_artifacts,
        accelerator_notifications,
        accelerator_teams,
        accelerator_alumni,
        accelerator_operations,
        accelerator_governance,
    )
    main_source = Path("main.py").read_text(encoding="utf-8")
    assert all(f"app.include_router({module.__name__.split('.')[-1]}_router.router)" in main_source for module in modules)
    seen: set[tuple[str, str]] = set()
    duplicates: list[tuple[str, str]] = []
    accelerator_routes: set[tuple[str, str]] = set()
    for module in modules:
        for route in module.router.routes:
            path = getattr(route, "path", None)
            if not isinstance(path, str) or not path.startswith("/api/accelerators"):
                continue
            for method in getattr(route, "methods", None) or set():
                if method in {"HEAD", "OPTIONS"}:
                    continue
                key = (method, path)
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
