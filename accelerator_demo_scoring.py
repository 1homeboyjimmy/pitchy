"""Demo-day scoring policies, with legacy defaults for existing cohorts."""
import math
from fastapi import HTTPException

def project_track(project):
    return (project.passport or {}).get("accelerator_track", "")

def criteria_for_project(demo_day, project):
    config = demo_day.evaluation_config or {}
    groups = config.get("criteria_by_track", {})
    if groups:
        criteria = groups.get(project_track(project))
        if not criteria:
            raise HTTPException(409, "Для трека проекта не настроены критерии")
        return criteria
    return demo_day.criteria or []

def uses_raw_sum(demo_day):
    return (demo_day.evaluation_config or {}).get("method") == "raw_sum"

def raw_score(criteria, scores):
    if set(scores) != {c["key"] for c in criteria}:
        raise HTTPException(422, "Оцените проект по всем критериям")
    for c in criteria:
        value = float(scores[c["key"]])
        if not math.isfinite(value) or not value.is_integer() or not 0 <= value <= c["max_score"]:
            raise HTTPException(422, f"Оценка «{c['label']}» должна быть целой от 0 до {c['max_score']}")
    return sum(float(v) for v in scores.values())
