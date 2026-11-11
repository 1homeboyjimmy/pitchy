"""Request-scoped read snapshot for progress of an already-authorized membership set."""
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select

from accelerator_homework_service import participant_results
from models import (
    AcceleratorArtifact, AcceleratorAttendanceRecord, AcceleratorEvent,
    AcceleratorHomeworkAssignment, AcceleratorHomeworkException, AcceleratorHomeworkTarget,
    AcceleratorProgramAction, AcceleratorProgramMaterial, AcceleratorProgramMaterialProgress,
    AcceleratorProgramStage, AcceleratorProgramStageProgress,
)


def grouped(rows, key, value=lambda row: row):
    result = defaultdict(list)
    for row in rows:
        result[key(row)].append(value(row))
    return result


@dataclass
class ProgressSnapshot:
    memberships: dict
    stages: dict
    stages_by_cohort: dict
    progress: dict
    materials: dict
    completed_materials: dict
    assignments: dict
    targets: dict
    results: dict
    deadlines: dict
    actions: dict
    ready_actions: dict
    events: dict
    present_events: dict

    @classmethod
    async def load(cls, db, memberships):
        ids = [row.id for row in memberships]
        cohort_ids = {row.cohort_id for row in memberships}
        async def rows(model, *conditions, order=()):
            return list((await db.execute(select(model).where(*conditions).order_by(*order))).scalars().all())
        stages = await rows(AcceleratorProgramStage,
            AcceleratorProgramStage.cohort_id.in_(cohort_ids), AcceleratorProgramStage.status == "published",
            order=(AcceleratorProgramStage.position,))
        stage_ids = [row.id for row in stages]
        progress = await rows(AcceleratorProgramStageProgress,
            AcceleratorProgramStageProgress.membership_id.in_(ids), AcceleratorProgramStageProgress.stage_id.in_(stage_ids))
        materials = await rows(AcceleratorProgramMaterial,
            AcceleratorProgramMaterial.stage_id.in_(stage_ids), AcceleratorProgramMaterial.required.is_(True),
            order=(AcceleratorProgramMaterial.position,))
        material_progress = await rows(AcceleratorProgramMaterialProgress,
            AcceleratorProgramMaterialProgress.membership_id.in_(ids),
            AcceleratorProgramMaterialProgress.material_id.in_([row.id for row in materials]))
        assignments = await rows(AcceleratorHomeworkAssignment,
            AcceleratorHomeworkAssignment.stage_id.in_(stage_ids), AcceleratorHomeworkAssignment.status == "published",
            order=(AcceleratorHomeworkAssignment.created_at,))
        assignment_ids = [row.id for row in assignments]
        targets = await rows(AcceleratorHomeworkTarget,
            AcceleratorHomeworkTarget.membership_id.in_(ids), AcceleratorHomeworkTarget.assignment_id.in_(assignment_ids))
        # Preserve accepted versions and their original performers after team transfers.
        results = await participant_results(db, ids, assignment_ids) if assignment_ids else {}
        exceptions = await rows(AcceleratorHomeworkException,
            AcceleratorHomeworkException.membership_id.in_(ids), AcceleratorHomeworkException.assignment_id.in_(assignment_ids))
        actions = await rows(AcceleratorProgramAction,
            AcceleratorProgramAction.stage_id.in_(stage_ids), AcceleratorProgramAction.required.is_(True),
            order=(AcceleratorProgramAction.position,))
        artifacts = await rows(AcceleratorArtifact,
            AcceleratorArtifact.membership_id.in_(ids), AcceleratorArtifact.action_id.in_([row.id for row in actions]),
            AcceleratorArtifact.status == "ready")
        events = await rows(AcceleratorEvent,
            AcceleratorEvent.stage_id.in_(stage_ids), AcceleratorEvent.status.in_(("published", "completed")),
            order=(AcceleratorEvent.starts_at,))
        attendance = await rows(AcceleratorAttendanceRecord,
            AcceleratorAttendanceRecord.membership_id.in_(ids),
            AcceleratorAttendanceRecord.event_id.in_([row.id for row in events]), AcceleratorAttendanceRecord.status == "present")
        return cls(
            memberships={row.id: row for row in memberships}, stages={row.id: row for row in stages},
            stages_by_cohort=grouped(stages, lambda row: row.cohort_id),
            progress={(row.membership_id, row.stage_id): row for row in progress},
            materials=grouped(materials, lambda row: row.stage_id),
            completed_materials=grouped(material_progress, lambda row: row.membership_id, lambda row: row.material_id),
            assignments=grouped(assignments, lambda row: row.stage_id),
            targets=grouped(targets, lambda row: row.membership_id, lambda row: row.assignment_id),
            results=results, deadlines={(row.assignment_id, row.membership_id): row.due_at for row in exceptions},
            actions=grouped(actions, lambda row: row.stage_id),
            ready_actions=grouped(artifacts, lambda row: row.membership_id, lambda row: row.action_id),
            events=grouped(events, lambda row: row.stage_id),
            present_events=grouped(attendance, lambda row: row.membership_id, lambda row: row.event_id),
        )
