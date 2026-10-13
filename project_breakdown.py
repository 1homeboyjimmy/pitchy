"""A uniform editable breakdown backed by the canonical project passport."""
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
import passport as passport_lib
from models import Project, ProjectTree

TEMPLATE_VERSION = "mtusi-2026-v1"
ADDITIONAL_PATH = "custom.Дополнительная информация"
DESCRIPTION_PATH = "custom.Краткое описание"
CATEGORIES = [
    ("name", "Название проекта", ["core.name"]),
    ("problem", "Проблема", ["core.problem"]),
    ("solution", "Решение", ["core.solution"]),
    ("audience", "Целевая аудитория", ["core.target_audience"]),
    ("stage", "Стадия", ["core.stage"]),
    ("business_model", "Бизнес-модель", ["core.business_model"]),
    ("geo", "География", ["core.geo"]),
    ("market", "Рынок и конкуренты", ["market.size", "market.competitors"]),
    ("metrics", "Метрики", ["metrics.mrr", "metrics.users", "metrics.cac", "metrics.growth"]),
    ("team", "Команда", ["team"]),
    ("legal", "Юридические данные", ["legal.entity_type"]),
    ("additional", "Дополнительная информация", [ADDITIONAL_PATH]),
]
FIELD_LABELS = {field["path"]: field["label"] for field in passport_lib.PASSPORT_FIELDS}
FIELD_LABELS[ADDITIONAL_PATH] = "Дополнительная информация"
LIST_PATHS = {field["path"] for field in passport_lib.PASSPORT_FIELDS if field.get("list")}


def display_value(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    return str(value)


def build_breakdown(passport):
    nodes = []
    for position, (key, label, paths) in enumerate(CATEGORIES):
        values = {path: display_value(passport_lib._get_path(passport, path)) for path in paths}
        filled = sum(bool(value.strip()) for value in values.values())
        nodes.append({
            "id": key, "type": "customAnalysis", "label": label, "category": key,
            "level": 1, "parent_id": "root", "children_ids": [], "priority": position,
            "status": "completed" if filled == len(paths) else "partial" if filled else "empty",
            "data": {
                "label": label, "form_data": values,
                "form_schema": [{"id": path, "label": FIELD_LABELS[path], "type": "textarea"} for path in paths],
                "summary": {FIELD_LABELS[path]: value for path, value in values.items() if value.strip()},
            },
        })
    return {"template_version": TEMPLATE_VERSION, "nodes": nodes,
            "edges": [{"id": f"root-{node['id']}", "source": "root", "target": node["id"]} for node in nodes]}


async def sync_project_breakdown(db, project):
    tree = (await db.execute(select(ProjectTree).where(ProjectTree.project_id == project.id))).scalar_one_or_none()
    if tree and (tree.tree_data or {}).get("template_version") == TEMPLATE_VERSION:
        tree.tree_data = build_breakdown(project.passport or {})
        tree.readiness_index = passport_lib.compute_readiness(project.passport)
        flag_modified(tree, "tree_data")


async def save_breakdown_fields(db, tree, node_id, fields):
    paths = next((paths for key, _, paths in CATEGORIES if key == node_id), None)
    if paths is None or not set(fields).issubset(paths) or any(not isinstance(value, str) for value in fields.values()):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Неизвестное поле разбивки")
    values = {path: ([line.strip() for line in value.splitlines() if line.strip()] if path in LIST_PATHS else value)
              for path, value in fields.items()}
    project = await db.get(Project, tree.project_id)
    merged = passport_lib.merge_patch(project.passport, values, source="manual")
    import roadmap_service
    project.passport = roadmap_service.invalidate_analyses(merged, set(values))
    project.readiness_index = passport_lib.compute_readiness(project.passport)
    from datetime import datetime
    project.passport_updated_at = datetime.utcnow()
    flag_modified(project, "passport")
    await sync_project_breakdown(db, project)


def accelerator_project_description(project):
    if not project:
        return {}
    passport = project.passport or {}
    return {
        "description": passport_lib._get_path(passport, DESCRIPTION_PATH) or passport_lib._get_path(passport, "core.solution") or "",
        "problem": passport_lib._get_path(passport, "core.problem") or "",
        "solution": passport_lib._get_path(passport, "core.solution") or "",
        "target_audience": passport_lib._get_path(passport, "core.target_audience") or "",
    }
