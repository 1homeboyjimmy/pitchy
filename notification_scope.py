"""Private notification streams for the current cohort and workspace role."""
from sqlalchemy import case, func, or_, select, false
from fastapi import HTTPException
from models import (AcceleratorNotification as Notification, AcceleratorCohort,
                    AcceleratorMembership, AcceleratorApplication,
                    AcceleratorDemoDay, AcceleratorDemoDayExpert, AcceleratorMatch, AcceleratorMatchProfile)

# Historical notifications have no audience metadata. Only known participant
# events enter the participant stream; unknown events fail closed to staff.
RESIDENT_EVENTS = frozenset({
    "application_approved", "application_invitation_resent", "application_needs_info", "application_rejected",
    "homework_published", "homework_reminder", "homework_deadline_reminder", "homework_accepted", "homework_needs_revision",
    "event_rescheduled", "event_cancelled", "tracking_feedback_created", "tracking_task_created",
    "project_audit_task_created", "demo_day_project_selected", "demo_day_finalized", "cohort_completed",
    "team_invitation_created", "team_invitation_responded", "team_invitation_removed", "team_archived",
    "team_member_removed", "team_member_left",
})


def default_audience(event_type):
    return "resident" if event_type in RESIDENT_EVENTS else "staff"


async def notification_filters(db, user, cohort_id, context):
    if cohort_id is None:
        # Old/unscoped clients cannot fall back to the account-wide inbox.
        return [false()]
    cohort = await db.get(AcceleratorCohort, cohort_id)
    if cohort is None:
        raise HTTPException(status_code=404, detail="Поток не найден")
    memberships = select(AcceleratorMembership.id).where(
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
    )
    if context == "resident":
        membership = (await db.execute(memberships.limit(1))).scalar_one_or_none()
        application = (await db.execute(select(AcceleratorApplication.id).where(
            AcceleratorApplication.user_id == user.id, AcceleratorApplication.cohort_id == cohort.id,
        ).limit(1))).scalar_one_or_none() if membership is None else None
        if membership is None and application is None:
            raise HTTPException(status_code=403, detail="Нет участия в этом потоке")
    elif context == "staff":
        from accelerator_service import require_cohort_reader
        try:
            await require_cohort_reader(db, user, cohort)
        except HTTPException as error:
            if error.status_code != 403:
                raise
            expert = (await db.execute(select(AcceleratorDemoDayExpert.id)
                .join(AcceleratorDemoDay, AcceleratorDemoDay.id == AcceleratorDemoDayExpert.demo_day_id)
                .where(AcceleratorDemoDay.cohort_id == cohort.id,
                       AcceleratorDemoDayExpert.user_id == user.id).limit(1))).scalar_one_or_none()
            expert_match = (await db.execute(select(AcceleratorMatch.id)
                .join(AcceleratorMatchProfile, AcceleratorMatchProfile.id == AcceleratorMatch.counterpart_profile_id)
                .where(AcceleratorMatch.cohort_id == cohort.id, AcceleratorMatch.status == "active",
                       AcceleratorMatchProfile.user_id == user.id, AcceleratorMatchProfile.role == "expert").limit(1))).scalar_one_or_none()
            if cohort.expert_user_id != user.id and expert is None and expert_match is None:
                raise error
    else:
        raise HTTPException(status_code=422, detail="Неизвестный контекст уведомлений")
    legacy_audience = case((Notification.event_type.in_(RESIDENT_EVENTS), "resident"), else_="staff")
    audience = func.coalesce(Notification.event_metadata["audience"].as_string(), legacy_audience)
    filters = [Notification.user_id == user.id, Notification.cohort_id == cohort.id,
               Notification.accelerator_id == cohort.accelerator_id, audience == context]
    if context == "resident":
        filters.append(or_(Notification.membership_id.is_(None), Notification.membership_id.in_(memberships)))
    return filters
