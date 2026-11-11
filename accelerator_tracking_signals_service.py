from __future__ import annotations

from datetime import datetime
from collections import defaultdict
import hashlib

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_program_progress_service import ProgramProgressService
from models import (
    AcceleratorHomeworkAssignment,
    AcceleratorMembership,
    AcceleratorProgramStage,
    AcceleratorProjectAudit,
    AcceleratorProjectAuditTaskLink,
    AcceleratorTrackingSignalState,
    AcceleratorTrackingTask,
)


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def signal_fingerprint(kind: str, source_type: str, source_id: str | int) -> str:
    value = f"{kind}:{source_type}:{source_id}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _signal(
    membership_id: int,
    kind: str,
    severity: str,
    title: str,
    reason: str,
    *,
    source_type: str,
    source_id: str | int,
    due_at=None,
    action_url: str | None = None,
) -> dict:
    return {
        "membership_id": membership_id,
        "kind": kind,
        "fingerprint": signal_fingerprint(kind, source_type, source_id),
        "severity": severity,
        "title": title,
        "reason": reason,
        "due_at": due_at,
        "source_type": source_type,
        "source_id": str(source_id),
        "action_url": action_url,
        "state": "open",
        "snoozed_until": None,
    }


class TrackingSignalsService:
    """Builds deterministic, deduplicated work-queue signals from current facts."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_membership_signals(
        self,
        membership: AcceleratorMembership,
        risk: dict,
        *,
        progress: dict | None = None,
        context: dict | None = None,
    ) -> list[dict]:
        signals: dict[str, dict] = {}
        risk_kind = {
            "no_activity": "no_activity",
            "tasks_overdue": "task_overdue",
            "homework_overdue": "homework_overdue",
            "homework_overdue_many": "homework_overdue",
            "low_attendance": "low_attendance",
            "checkin_missing": "no_checkin",
            "first_checkin_missing": "no_checkin",
            "checkin_health_red": "checkin_risk",
            "checkin_health_yellow": "checkin_risk",
        }
        for reason in risk.get("reason_items", []):
            kind = risk_kind.get(reason.get("code"))
            if not kind:
                continue
            row = _signal(
                membership.id,
                kind,
                reason.get("severity", "medium"),
                reason.get("text", "Требуется внимание"),
                reason.get("text", "Требуется внимание"),
                source_type="risk",
                source_id=reason.get("code", kind),
                action_url=f"/accelerator?participant={membership.id}",
            )
            signals[row["fingerprint"]] = row

        if progress is None:
            progress = await ProgramProgressService(self.db).get_membership_progress(membership.id)
        stage_ids = [row["stage_id"] for row in progress["stages"]]
        stage_titles = context["stage_titles"] if context is not None else (dict((await self.db.execute(select(
            AcceleratorProgramStage.id, AcceleratorProgramStage.title
        ).where(AcceleratorProgramStage.id.in_(stage_ids)))).all()) if stage_ids else {})
        assignment_ids = [
            blocker["id"]
            for stage in progress["stages"]
            for blocker in stage["blockers"]
            if blocker["kind"] == "homework"
        ]
        assignment_due = context["assignment_due"] if context is not None else (dict((await self.db.execute(select(
            AcceleratorHomeworkAssignment.id, AcceleratorHomeworkAssignment.due_at
        ).where(AcceleratorHomeworkAssignment.id.in_(assignment_ids)))).all()) if assignment_ids else {})
        for stage in progress["stages"]:
            if stage["state"] in {"completed", "waived", "locked"}:
                continue
            for blocker in stage["blockers"]:
                reason = blocker["reason"]
                if blocker["kind"] == "homework":
                    kind = "homework_needs_revision" if "доработ" in reason.lower() else "homework_overdue" if "просроч" in reason.lower() else "stage_blocked"
                elif blocker["kind"] == "pitchy_action":
                    kind = "required_action_open"
                elif blocker["kind"] == "attendance":
                    kind = "low_attendance"
                else:
                    kind = "stage_blocked"
                severity = "high" if kind in {"homework_overdue", "homework_needs_revision"} or stage["state"] == "overdue" else "medium"
                row = _signal(
                    membership.id,
                    kind,
                    severity,
                    f"{stage_titles.get(stage['stage_id'], 'Этап')}: {blocker['title']}",
                    reason,
                    source_type=blocker["kind"],
                    source_id=blocker["id"],
                    due_at=assignment_due.get(blocker["id"]) if blocker["kind"] == "homework" else None,
                    action_url=f"/accelerator?participant={membership.id}",
                )
                signals[row["fingerprint"]] = row

        overdue_tasks = context["tasks"].get(membership.id, []) if context is not None else list((await self.db.execute(select(AcceleratorTrackingTask).where(
            AcceleratorTrackingTask.membership_id == membership.id,
            AcceleratorTrackingTask.status == "open",
            AcceleratorTrackingTask.due_at.is_not(None),
            AcceleratorTrackingTask.due_at < datetime.utcnow(),
        ))).scalars().all())
        for task in overdue_tasks:
            row = _signal(
                membership.id, "task_overdue", "high",
                f"Просрочена задача «{task.title}»",
                "Назначенная задача не выполнена в срок",
                source_type="tracking_task", source_id=task.id,
                due_at=task.due_at,
                action_url=f"/accelerator?participant={membership.id}",
            )
            signals[row["fingerprint"]] = row

        latest_audit = context["audits"].get(membership.id) if context is not None else (await self.db.execute(select(AcceleratorProjectAudit).where(
            AcceleratorProjectAudit.membership_id == membership.id,
            AcceleratorProjectAudit.status == "completed",
        ).order_by(AcceleratorProjectAudit.created_at.desc()).limit(1))).scalar_one_or_none()
        if latest_audit:
            linked_indexes = context["audit_links"].get(latest_audit.id, set()) if context is not None else set((await self.db.execute(
                select(AcceleratorProjectAuditTaskLink.recommendation_index).where(
                    AcceleratorProjectAuditTaskLink.audit_id == latest_audit.id
                )
            )).scalars().all())
            recommendations = (latest_audit.result or {}).get("recommendations") or []
            for index, recommendation in enumerate(recommendations):
                if index in linked_indexes or not isinstance(recommendation, dict):
                    continue
                title = str(recommendation.get("title") or "Рекомендация аудита")
                row = _signal(
                    membership.id, "audit_recommendation_open",
                    str(recommendation.get("priority") or "medium"),
                    title,
                    str(recommendation.get("description") or "Рекомендация ещё не превращена в задачу"),
                    source_type="project_audit_recommendation",
                    source_id=f"{latest_audit.id}:{index}",
                    action_url=f"/accelerator?participant={membership.id}",
                )
                signals[row["fingerprint"]] = row

        overrides = context["overrides"].get(membership.id, []) if context is not None else (list((await self.db.execute(select(AcceleratorTrackingSignalState).where(
            AcceleratorTrackingSignalState.membership_id == membership.id,
            AcceleratorTrackingSignalState.fingerprint.in_(list(signals)),
        ))).scalars().all()) if signals else [])
        now = datetime.utcnow()
        for override in overrides:
            row = signals.get(override.fingerprint)
            if not row:
                continue
            state = override.state
            if state == "snoozed" and override.snoozed_until and override.snoozed_until <= now:
                state = "open"
            row.update({
                "state": state,
                "snoozed_until": override.snoozed_until,
                "note": override.note,
            })
        return sorted(signals.values(), key=lambda row: (
            SEVERITY_ORDER.get(row["severity"], 9),
            row["due_at"] is None,
            row["due_at"] or datetime.max,
            row["kind"],
        ))

    async def _cohort_context(self, memberships: list[AcceleratorMembership], progresses: dict[int, dict]) -> dict:
        ids = [row.id for row in memberships]
        stage_ids = {stage["stage_id"] for progress in progresses.values() for stage in progress["stages"]}
        assignment_ids = {blocker["id"] for progress in progresses.values() for stage in progress["stages"]
                          for blocker in stage["blockers"] if blocker["kind"] == "homework"}
        stage_titles = dict((await self.db.execute(select(AcceleratorProgramStage.id, AcceleratorProgramStage.title)
            .where(AcceleratorProgramStage.id.in_(stage_ids)))).all()) if stage_ids else {}
        assignment_due = dict((await self.db.execute(select(AcceleratorHomeworkAssignment.id, AcceleratorHomeworkAssignment.due_at)
            .where(AcceleratorHomeworkAssignment.id.in_(assignment_ids)))).all()) if assignment_ids else {}
        tasks = (await self.db.execute(select(AcceleratorTrackingTask).where(
            AcceleratorTrackingTask.membership_id.in_(ids), AcceleratorTrackingTask.status == "open",
            AcceleratorTrackingTask.due_at < datetime.utcnow(),
        ))).scalars().all()
        ranked = select(AcceleratorProjectAudit.id, func.row_number().over(
            partition_by=AcceleratorProjectAudit.membership_id,
            order_by=(AcceleratorProjectAudit.created_at.desc(), AcceleratorProjectAudit.id.desc()),
        ).label("position")).where(AcceleratorProjectAudit.membership_id.in_(ids),
                                  AcceleratorProjectAudit.status == "completed").subquery()
        audits = (await self.db.execute(select(AcceleratorProjectAudit).join(
            ranked, ranked.c.id == AcceleratorProjectAudit.id,
        ).where(ranked.c.position == 1))).scalars().all()
        links = (await self.db.execute(select(AcceleratorProjectAuditTaskLink).where(
            AcceleratorProjectAuditTaskLink.audit_id.in_([row.id for row in audits]),
        ))).scalars().all() if audits else []
        overrides = (await self.db.execute(select(AcceleratorTrackingSignalState).where(
            AcceleratorTrackingSignalState.membership_id.in_(ids),
        ))).scalars().all()
        by_member_tasks, by_audit_links, by_member_overrides = defaultdict(list), defaultdict(set), defaultdict(list)
        for row in tasks:
            by_member_tasks[row.membership_id].append(row)
        for row in links:
            by_audit_links[row.audit_id].add(row.recommendation_index)
        for row in overrides:
            by_member_overrides[row.membership_id].append(row)
        return {"stage_titles": stage_titles, "assignment_due": assignment_due,
                "tasks": by_member_tasks, "audits": {row.membership_id: row for row in audits},
                "audit_links": by_audit_links, "overrides": by_member_overrides}

    async def get_cohort_signals(
        self,
        memberships: list[AcceleratorMembership],
        risks: dict[int, dict],
        *,
        progresses: dict[int, dict] | None = None,
    ) -> list[dict]:
        if not memberships:
            return []
        if progresses is None:
            progresses = await ProgramProgressService(self.db).get_memberships_progress(memberships)
        context = await self._cohort_context(memberships, progresses)
        rows = []
        for membership in memberships:
            rows.extend(await self.get_membership_signals(
                membership, risks[membership.id], progress=progresses[membership.id], context=context,
            ))
        return rows
