from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AcceleratorArtifact,
    AcceleratorAttendanceRecord,
    AcceleratorEvent,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorHomeworkTarget,
    AcceleratorMembership,
    AcceleratorProgramAction,
    AcceleratorProgramMaterial,
    AcceleratorProgramMaterialProgress,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    AcceleratorTeamMember,
)


DEFAULT_COMPLETION_POLICY = {
    "mode": "auto",
    "materials": "all_required",
    "homework": "all_required",
    "pitchy_actions": "all_required",
    "attendance": "none",
    "manual_confirmation": False,
}


def stage_completion_policy(stage: AcceleratorProgramStage) -> dict:
    policy = {**DEFAULT_COMPLETION_POLICY, **(stage.completion_policy or {})}
    policy["manual_confirmation"] = policy["mode"] == "manual"
    return policy


class ProgramProgressService:
    """Single explainable source of truth for accelerator program progress."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _active_team_ids(self, membership_id: int) -> set[int]:
        return set((await self.db.execute(select(AcceleratorTeamMember.team_id).where(
            AcceleratorTeamMember.membership_id == membership_id,
            AcceleratorTeamMember.status == "active",
        ))).scalars().all())

    async def _requirements(
        self,
        membership: AcceleratorMembership,
        stage: AcceleratorProgramStage,
    ) -> tuple[list[dict], list[dict]]:
        policy = stage_completion_policy(stage)
        requirements: list[dict] = []
        blockers: list[dict] = []

        if policy["materials"] == "all_required":
            materials = list((await self.db.execute(select(AcceleratorProgramMaterial).where(
                AcceleratorProgramMaterial.stage_id == stage.id,
                AcceleratorProgramMaterial.required.is_(True),
            ).order_by(AcceleratorProgramMaterial.position))).scalars().all())
            material_ids = [row.id for row in materials]
            completed_ids = set((await self.db.execute(
                select(AcceleratorProgramMaterialProgress.material_id).where(
                    AcceleratorProgramMaterialProgress.membership_id == membership.id,
                    AcceleratorProgramMaterialProgress.material_id.in_(material_ids),
                )
            )).scalars().all()) if material_ids else set()
            for material in materials:
                completed = material.id in completed_ids
                requirements.append({
                    "kind": "material", "id": material.id, "title": material.title,
                    "completed": completed,
                })
                if not completed:
                    blockers.append({
                        "kind": "material", "id": material.id, "title": material.title,
                        "reason": "Материал ещё не отмечен как изученный",
                    })

        if policy["homework"] == "all_required":
            assignments = list((await self.db.execute(select(AcceleratorHomeworkAssignment).where(
                AcceleratorHomeworkAssignment.stage_id == stage.id,
                AcceleratorHomeworkAssignment.status == "published",
            ).order_by(AcceleratorHomeworkAssignment.created_at))).scalars().all())
            selected_ids = [row.id for row in assignments if row.audience == "selected"]
            targeted_ids = set((await self.db.execute(select(AcceleratorHomeworkTarget.assignment_id).where(
                AcceleratorHomeworkTarget.membership_id == membership.id,
                AcceleratorHomeworkTarget.assignment_id.in_(selected_ids),
            ))).scalars().all()) if selected_ids else set()
            assignments = [
                row for row in assignments
                if row.audience == "cohort" or row.id in targeted_ids
            ]
            team_ids = await self._active_team_ids(membership.id)
            assignment_ids = [row.id for row in assignments]
            submission_filter = AcceleratorHomeworkSubmission.membership_id == membership.id
            if team_ids:
                submission_filter = or_(
                    submission_filter,
                    AcceleratorHomeworkSubmission.team_id.in_(team_ids),
                )
            submission_rows = list((await self.db.execute(select(AcceleratorHomeworkSubmission).where(
                AcceleratorHomeworkSubmission.assignment_id.in_(assignment_ids),
                submission_filter,
            ))).scalars().all()) if assignment_ids else []
            submissions = {row.assignment_id: row for row in submission_rows}
            now = datetime.utcnow()
            for assignment in assignments:
                submission = submissions.get(assignment.id)
                completed = bool(submission and submission.status == "accepted")
                requirements.append({
                    "kind": "homework", "id": assignment.id, "title": assignment.title,
                    "completed": completed,
                })
                if completed:
                    continue
                if submission and submission.status == "submitted":
                    reason = "Ожидается проверка трекера"
                elif submission and submission.status == "needs_revision":
                    reason = "Работа возвращена на доработку"
                elif assignment.due_at and assignment.due_at < now:
                    reason = "Домашнее задание просрочено"
                else:
                    reason = "Домашнее задание ещё не сдано"
                blockers.append({
                    "kind": "homework", "id": assignment.id, "title": assignment.title,
                    "reason": reason, "due_at": assignment.due_at,
                })

        if policy["pitchy_actions"] == "all_required":
            actions = list((await self.db.execute(select(AcceleratorProgramAction).where(
                AcceleratorProgramAction.stage_id == stage.id,
                AcceleratorProgramAction.required.is_(True),
            ).order_by(AcceleratorProgramAction.position))).scalars().all())
            action_ids = [row.id for row in actions]
            ready_ids = set((await self.db.execute(select(AcceleratorArtifact.action_id).where(
                AcceleratorArtifact.membership_id == membership.id,
                AcceleratorArtifact.action_id.in_(action_ids),
                AcceleratorArtifact.status == "ready",
            ))).scalars().all()) if action_ids else set()
            for action in actions:
                completed = action.id in ready_ids
                requirements.append({
                    "kind": "pitchy_action", "id": action.id, "title": action.title,
                    "completed": completed,
                })
                if not completed:
                    blockers.append({
                        "kind": "pitchy_action", "id": action.id, "title": action.title,
                        "reason": "Сначала завершите обязательные действия в инструментах Pitchy",
                    })

        if policy["attendance"] == "all_required":
            events = list((await self.db.execute(select(AcceleratorEvent).where(
                AcceleratorEvent.stage_id == stage.id,
                AcceleratorEvent.status.in_(("published", "completed")),
            ).order_by(AcceleratorEvent.starts_at))).scalars().all())
            event_ids = [row.id for row in events]
            present_ids = set((await self.db.execute(select(AcceleratorAttendanceRecord.event_id).where(
                AcceleratorAttendanceRecord.membership_id == membership.id,
                AcceleratorAttendanceRecord.event_id.in_(event_ids),
                AcceleratorAttendanceRecord.status == "present",
            ))).scalars().all()) if event_ids else set()
            for event in events:
                completed = event.id in present_ids
                requirements.append({
                    "kind": "attendance", "id": event.id, "title": event.title,
                    "completed": completed,
                })
                if not completed:
                    blockers.append({
                        "kind": "attendance", "id": event.id, "title": event.title,
                        "reason": "Посещение не отмечено",
                    })

        return requirements, blockers

    async def get_stage_state(
        self,
        membership_id: int,
        stage_id: int,
        *,
        locked: bool = False,
        reconcile: bool = True,
    ) -> dict:
        membership = await self.db.get(AcceleratorMembership, membership_id)
        stage = await self.db.get(AcceleratorProgramStage, stage_id)
        if not membership or not stage or membership.cohort_id != stage.cohort_id:
            raise ValueError("Stage does not belong to membership cohort")
        policy = stage_completion_policy(stage)
        progress = (await self.db.execute(select(AcceleratorProgramStageProgress).where(
            AcceleratorProgramStageProgress.stage_id == stage.id,
            AcceleratorProgramStageProgress.membership_id == membership.id,
        ))).scalar_one_or_none()
        requirements, blockers = await self._requirements(membership, stage)
        completed_required = sum(bool(row["completed"]) for row in requirements)
        required_total = len(requirements)
        requirements_met = completed_required == required_total
        became_completed = False

        if progress and progress.completion_source == "auto" and not requirements_met:
            if reconcile:
                await self.db.delete(progress)
                await self.db.flush()
            progress = None

        if reconcile and policy["mode"] == "auto" and requirements_met and not progress:
            progress = AcceleratorProgramStageProgress(
                stage_id=stage.id,
                membership_id=membership.id,
                completion_source="auto",
                last_evaluated_at=datetime.utcnow(),
            )
            self.db.add(progress)
            await self.db.flush()
            became_completed = True
        elif progress:
            progress.last_evaluated_at = datetime.utcnow()

        effective_source = progress.completion_source if progress else None
        if progress and progress.completion_source == "waived":
            state = "waived"
        elif progress:
            state = "completed"
        elif locked:
            state = "locked"
        elif policy["mode"] == "auto" and requirements_met:
            state = "completed"
            effective_source = "auto"
        elif policy["mode"] == "none":
            state = "available"
        elif policy["mode"] == "manual" and requirements_met:
            state = "in_progress"
            blockers = [{
                "kind": "manual_confirmation", "id": stage.id, "title": stage.title,
                "reason": "Ожидается подтверждение трекера",
            }]
        elif stage.due_at and stage.due_at < datetime.utcnow():
            state = "overdue"
        elif completed_required:
            state = "in_progress"
        else:
            state = "available"

        return {
            "stage_id": stage.id,
            "state": state,
            "completed": state in {"completed", "waived"},
            "required_total": required_total,
            "completed_required": completed_required,
            "blockers": blockers,
            "requirements": requirements,
            "completion_source": effective_source,
            "waiver_reason": progress.waiver_reason if progress else None,
            "policy": policy,
            "became_completed": became_completed,
        }

    async def explain_stage_state(self, membership_id: int, stage_id: int) -> dict:
        return await self.get_stage_state(membership_id, stage_id, reconcile=False)

    async def get_membership_progress(self, membership_id: int) -> dict:
        membership = await self.db.get(AcceleratorMembership, membership_id)
        if not membership:
            raise ValueError("Membership not found")
        stages = list((await self.db.execute(select(AcceleratorProgramStage).where(
            AcceleratorProgramStage.cohort_id == membership.cohort_id,
            AcceleratorProgramStage.status == "published",
        ).order_by(AcceleratorProgramStage.position))).scalars().all())
        now = datetime.utcnow()
        blocked_by_previous = False
        rows = []
        for stage in stages:
            policy = stage_completion_policy(stage)
            locked = blocked_by_previous or bool(stage.unlock_at and stage.unlock_at > now)
            row = await self.get_stage_state(
                membership.id, stage.id, locked=locked, reconcile=False
            )
            rows.append(row)
            if stage.required and policy["mode"] != "none" and not row["completed"]:
                blocked_by_previous = True
        counted = [
            (stage, row) for stage, row in zip(stages, rows)
            if stage.required and stage_completion_policy(stage)["mode"] != "none"
        ]
        completed = sum(row["completed"] for _, row in counted)
        total = len(counted)
        return {
            "membership_id": membership.id,
            "completed": completed,
            "total": total,
            "percent": round(completed * 100 / total) if total else 100,
            "stages": rows,
        }

    async def get_cohort_progress(self, cohort_id: int) -> list[dict]:
        membership_ids = list((await self.db.execute(select(AcceleratorMembership.id).where(
            AcceleratorMembership.cohort_id == cohort_id,
            AcceleratorMembership.role == "resident",
        ))).scalars().all())
        return [await self.get_membership_progress(row_id) for row_id in membership_ids]

    async def complete_or_reconcile_stage(
        self,
        membership_id: int,
        stage_id: int,
    ) -> dict:
        return await self.get_stage_state(membership_id, stage_id, reconcile=True)
