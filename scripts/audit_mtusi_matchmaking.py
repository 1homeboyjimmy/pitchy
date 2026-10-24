"""Persist synthetic matchmaking scenarios ONLY in the existing MTUSI test cohort.

The operator explicitly requested creation and retention of these test records.
Calls the application's own handlers, with their real permission/business checks.
Background mail delivery is deliberately not executed for synthetic accounts.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime
import hashlib
import inspect
import json
from pathlib import Path
import re
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from auth import hash_password
from db_async import AsyncSessionLocal
from models import (
    Accelerator, AcceleratorApplication, AcceleratorAuditLog, AcceleratorCohort,
    AcceleratorHomeworkAssignment, AcceleratorMatchProfile, AcceleratorMembership,
    AcceleratorProgramConfig, AcceleratorProgramStage, AcceleratorTeam, Project, User,
)
from routers import accelerators as program
from routers import accelerator_teams as teams
from schemas.accelerators import (
    ApplicationCreate, ApplicationReview, HomeworkAssignmentCreate, HomeworkReview,
    HomeworkSubmissionUpsert, MatchCreate, MatchPoolProfileCreate, MatchProfileData,
    MatchStatusUpdate, ProgramStageCreate, StatusUpdate,
)
from schemas.accelerator_teams import (
    AcceleratorTeamApplicationCreate, AcceleratorTeamApplicationUpdate,
    AcceleratorTeamCaptainTransfer, AcceleratorTeamContactUpdate, AcceleratorTeamCreate,
    AcceleratorTeamInvitationCreate, AcceleratorTeamInvitationUpdate,
    AcceleratorTeamTrackerAssign, AcceleratorTeamUpdate,
)

COHORT_ID = 6
MAIN_COHORT_ID = 5
ACCELERATOR_ID = 5


def require_test_target(cohort, accelerator):
    if not (
        cohort and accelerator and cohort.id == COHORT_ID
        and cohort.accelerator_id == ACCELERATOR_ID
        and accelerator.id == ACCELERATOR_ID
        and '[!ТЕСТ!]' in cohort.name
        and 'МТУСИ' in accelerator.name
        and cohort.status not in {'archived', 'completed'}
    ):
        raise ValueError('Refusing mutation: exact existing MTUSI TEST cohort 6 required')


async def main_fingerprint(db):
    result = {}
    # No resident details are exported; only a digest and counts leave the server.
    for model in (
        AcceleratorProgramStage, AcceleratorHomeworkAssignment,
        AcceleratorApplication, AcceleratorMembership, AcceleratorTeam, AcceleratorMatchProfile,
    ):
        rows = (await db.execute(select(model).where(
            model.cohort_id == MAIN_COHORT_ID
        ).order_by(model.id))).scalars().all()
        raw = [{column.name: getattr(row, column.name) for column in model.__table__.columns} for row in rows]
        digest = hashlib.sha256(json.dumps(raw, default=str, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        result[model.__tablename__] = {'count': len(rows), 'sha256': digest}
    return result


class Audit:
    def __init__(self, batch_key, actor_id):
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', batch_key):
            raise ValueError('Invalid batch key')
        self.batch_key = batch_key
        self.prefix = 'ТЕСТ МТУСИ ' + batch_key
        self.actor_id = actor_id
        self.users = {'admin': actor_id}
        self.memberships = {}
        self.applications = {}
        self.profiles = {}
        self.results = []
        self.created = {'users': [], 'teams': [], 'applications': [], 'homework': []}

    async def call(self, name, handler, *, as_user='admin', expected=None, check=None, **kwargs):
        async with AsyncSessionLocal() as db:
            user = await db.get(User, self.users[as_user])
            try:
                if 'background_tasks' in inspect.signature(handler).parameters and 'background_tasks' not in kwargs:
                    kwargs['background_tasks'] = BackgroundTasks()
                result = await handler(user=user, db=db, **kwargs)
                if expected is not None:
                    raise AssertionError(f'Expected HTTP {expected}; operation succeeded')
                if check is not None:
                    assert check(result), 'Unexpected result'
                self.results.append({'case': name, 'pass': True})
                return result
            except HTTPException as exc:
                await db.rollback()
                ok = expected == exc.status_code or isinstance(expected, tuple) and exc.status_code in expected
                self.results.append({'case': name, 'pass': ok, 'http_status': exc.status_code, 'detail': str(exc.detail)})
                return None
            except Exception as exc:
                await db.rollback()
                self.results.append({'case': name, 'pass': False, 'error': type(exc).__name__, 'detail': str(exc)[:160] if isinstance(exc, AssertionError) else 'Handler raised an unhandled exception'})
                return None

    def verify(self, name, condition):
        self.results.append({'case': name, 'pass': bool(condition)})

    async def seed(self):
        async with AsyncSessionLocal() as db:
            cohort = await db.get(AcceleratorCohort, COHORT_ID)
            accelerator = await db.get(Accelerator, ACCELERATOR_ID)
            require_test_target(cohort, accelerator)
            actor = await db.get(User, self.actor_id)
            if not actor or not actor.is_admin or not actor.is_active or actor.deleted_at:
                raise ValueError('Active administrator required')
            config = (await db.execute(select(AcceleratorProgramConfig).where(
                AcceleratorProgramConfig.cohort_id == COHORT_ID
            ))).scalar_one_or_none()
            if not config or not (config.modules or {}).get('matchmaking'):
                raise ValueError('Test cohort matchmaking must already be enabled')
            existing = list((await db.execute(select(User).where(
                User.username.like(self.batch_key.replace('-', '_') + '_%')
            ))).scalars().all())
            if existing:
                existing_ids = [row.id for row in existing]
                linked = (await db.execute(select(AcceleratorApplication.id).where(
                    AcceleratorApplication.user_id.in_(existing_ids)
                ))).first() or (await db.execute(select(AcceleratorMembership.id).where(
                    AcceleratorMembership.user_id.in_(existing_ids)
                ))).first()
                if linked or len(existing) != 9:
                    raise ValueError('Batch already used; use a new batch key')
            existing_by_username = {row.username: row for row in existing}
            self.initial_status = cohort.status
            self.before = await main_fingerprint(db)
            self.source_homework = list((await db.execute(select(AcceleratorHomeworkAssignment).where(
                AcceleratorHomeworkAssignment.cohort_id == MAIN_COHORT_ID,
                AcceleratorHomeworkAssignment.status == 'published',
            ).order_by(AcceleratorHomeworkAssignment.id))).scalars().all())
            if len(self.source_homework) != 2 or self.before['accelerator_program_stages']['count'] != 14:
                raise ValueError('Main program must be filled and verified before audit')
            self.source_homework = [{'title': x.title, 'description': x.description} for x in self.source_homework]
            for key, label in [('a', 'Капитан Альфа'), ('b', 'Капитан Бета'), ('c', 'Продажи'),
                               ('d', 'Дизайн'), ('e', 'Разработка'), ('f', 'Маркетинг'),
                               ('tracker', 'Трекер'), ('expert', 'Эксперт'), ('outsider', 'Внешний пользователь')]:
                username = self.batch_key.replace('-', '_') + '_' + key
                user = existing_by_username.get(username)
                if user:
                    if user.name != f'{self.prefix} {label}' or user.email != f'{self.batch_key}.{key}@example.test' or user.is_admin or not user.is_active or user.deleted_at:
                        raise ValueError('Existing account does not match the unused synthetic batch')
                else:
                    user = User(
                        name=f'{self.prefix} {label}', username=username,
                        email=f'{self.batch_key}.{key}@example.test',
                        password_hash=hash_password(secrets.token_urlsafe(24)),
                        local_login_enabled=True, is_admin=False, is_active=True,
                    )
                    db.add(user)
                    await db.flush()
                self.users[key] = user.id
                self.created['users'].append({'id': user.id, 'label': label})
            db.add(AcceleratorAuditLog(
                accelerator_id=ACCELERATOR_ID, cohort_id=COHORT_ID,
                actor_user_id=self.actor_id, action='test_audit.seeded',
                target_type='test_audit', details={'batch_key': self.batch_key, 'user_ids': list(self.users.values())[1:]},
            ))
            await db.commit()

    async def run(self):
        await self.seed()
        await self.call('open_test_intake', program.update_cohort_status, cohort_id=COHORT_ID, payload=StatusUpdate(status='accepting'))
        for key in 'abcdef':
            payload = ApplicationCreate(
                application_type='project' if key == 'a' else 'participant',
                form_payload={'project_name': self.prefix + ' Проект Альфа', 'motivation': 'ТЕСТ аудита',
                              'problem': 'ТЕСТ: проверка заявок, подбора участников и работы с командой',
                              'competencies': ['продукт' if key == 'a' else 'продажи'],
                              'telegram': '@' + self.batch_key.replace('-', '_') + '_' + key},
                accept_privacy=True, accept_program_rules=True,
            )
            application = await self.call('submit_application_' + key, program.submit_application, as_user=key, cohort_id=COHORT_ID, payload=payload)
            if not application:
                raise RuntimeError('Cannot seed application ' + key)
            self.applications[key] = application['id']
            self.created['applications'].append(application['id'])
            if key == 'a':
                await self.call('duplicate_accelerator_application_rejected', program.submit_application, as_user=key, cohort_id=COHORT_ID, payload=payload, expected=409)
            accepted = await self.call('accept_application_' + key, program.accept_application,
                                       application_id=application['id'], payload=ApplicationReview(), background_tasks=BackgroundTasks())
            if not accepted:
                raise RuntimeError('Cannot accept application ' + key)
            self.memberships[key] = accepted['membership_id']
            await self.call('enroll_' + key, program.enroll_application, as_user=key, application_id=application['id'])
            profile = await self.call('match_profile_' + key, program.upsert_resident_match_profile,
                                     as_user=key, membership_id=self.memberships[key],
                                     payload=MatchProfileData(expertise=['продукт' if key == 'a' else 'продажи'], needs=['продажи'],
                                                             industries=['SaaS'], goals=['рост'], preferred_formats=['онлайн']))
            self.profiles[key] = profile['id']
        await self.call('repeated_enrollment_rejected', program.enroll_application, as_user='a', application_id=self.applications['a'], expected=409)
        await self.call('foreign_profile_write_rejected', program.upsert_resident_match_profile, as_user='outsider', membership_id=self.memberships['a'], payload=MatchProfileData(bio='ТЕСТ'), expected=(403, 404))
        a = await self.call('create_project_team', teams.create_membership_team, as_user='a', membership_id=self.memberships['a'], payload=AcceleratorTeamCreate(name=self.prefix + ' Альфа', max_members=2))
        b = await self.call('create_team_without_project', teams.create_membership_team, as_user='b', membership_id=self.memberships['b'], payload=AcceleratorTeamCreate(name=self.prefix + ' Бета', max_members=4))
        if not a or not b:
            raise RuntimeError('Cannot create fixture teams')
        self.created['teams'] = [a['id'], b['id']]
        await self.call('duplicate_team_rejected', teams.create_membership_team, as_user='a', membership_id=self.memberships['a'], payload=AcceleratorTeamCreate(name=self.prefix + ' Дубликат'), expected=409)
        pool = await self.call('team_pool_resident', teams.get_team_pool, as_user='c', membership_id=self.memberships['c'])
        self.verify('team_pool_contains_both_test_teams', bool(pool) and {a['id'], b['id']}.issubset({x['id'] for x in pool['teams']}))
        await self.call('outsider_cannot_read_test_pool', teams.get_team_pool, as_user='outsider', membership_id=self.memberships['c'], expected=404)
        await self.call('outsider_cannot_read_main_cohort', program.list_residents, as_user='outsider', cohort_id=MAIN_COHORT_ID, expected=403)
        application = await self.call('apply_to_team', teams.create_team_application, as_user='c', team_id=a['id'], payload=AcceleratorTeamApplicationCreate(message='ТЕСТ хочу присоединиться', desired_role='Продажи'))
        await self.call('duplicate_team_application_is_409', teams.create_team_application, as_user='c', team_id=a['id'], payload=AcceleratorTeamApplicationCreate(), expected=409)
        await self.call('one_pending_application_is_409', teams.create_team_application, as_user='c', team_id=b['id'], payload=AcceleratorTeamApplicationCreate(), expected=409)
        await self.call('foreign_application_decision_rejected', teams.respond_team_application, as_user='d', application_id=application['id'], payload=AcceleratorTeamApplicationUpdate(status='accepted'), expected=403)
        await self.call('captain_accepts_application', teams.respond_team_application, as_user='a', application_id=application['id'], payload=AcceleratorTeamApplicationUpdate(status='accepted'))
        async with AsyncSessionLocal() as db:
            joined = await db.get(AcceleratorMembership, self.memberships['c'])
            self.verify('application_acceptance_links_canonical_project', joined.project_id == a['project']['id'])
        owner_view = await self.call('owner_reads_team', teams.get_membership_team, as_user='a', membership_id=self.memberships['a'])
        c_member = next(x for x in owner_view['team']['members'] if x['membership_id'] == self.memberships['c'])
        self.verify('application_acceptance_does_not_publish_contact_without_consent', not c_member['person'].get('email'))
        await self.call('full_team_application_rejected', teams.create_team_application, as_user='d', team_id=a['id'], payload=AcceleratorTeamApplicationCreate(), expected=409)
        await self.call('full_team_invitation_rejected', teams.invite_team_member, as_user='a', team_id=a['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['e']), background_tasks=BackgroundTasks(), expected=409)
        await self.call('member_cannot_join_second_team', teams.create_team_application, as_user='c', team_id=b['id'], payload=AcceleratorTeamApplicationCreate(), expected=409)
        await self.call('increase_capacity', teams.patch_team, as_user='a', team_id=a['id'], payload=AcceleratorTeamUpdate(max_members=4), background_tasks=BackgroundTasks())
        await self.call('close_recruiting', teams.patch_team, as_user='a', team_id=a['id'], payload=AcceleratorTeamUpdate(recruiting_open=False), background_tasks=BackgroundTasks())
        await self.call('closed_team_rejects_application', teams.create_team_application, as_user='d', team_id=a['id'], payload=AcceleratorTeamApplicationCreate(), expected=409)
        await self.call('open_recruiting', teams.patch_team, as_user='a', team_id=a['id'], payload=AcceleratorTeamUpdate(recruiting_open=True), background_tasks=BackgroundTasks())
        declined = await self.call('second_candidate_applies', teams.create_team_application, as_user='d', team_id=a['id'], payload=AcceleratorTeamApplicationCreate(message='ТЕСТ отклонение'))
        await self.call('captain_declines_application', teams.respond_team_application, as_user='a', application_id=declined['id'], payload=AcceleratorTeamApplicationUpdate(status='declined'))
        cancelled = await self.call('reapply_after_decline', teams.create_team_application, as_user='d', team_id=b['id'], payload=AcceleratorTeamApplicationCreate(message='ТЕСТ отзыв'))
        await self.call('candidate_cancels_application', teams.respond_team_application, as_user='d', application_id=cancelled['id'], payload=AcceleratorTeamApplicationUpdate(status='cancelled'))
        invitation = await self.call('captain_invites_member', teams.invite_team_member, as_user='b', team_id=b['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['e'], message='ТЕСТ приглашение'), background_tasks=BackgroundTasks())
        await self.call('duplicate_invitation_rejected', teams.invite_team_member, as_user='b', team_id=b['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['e']), background_tasks=BackgroundTasks(), expected=409)
        await self.call('foreign_invitation_response_rejected', teams.answer_team_invitation, as_user='d', invitation_id=invitation['id'], payload=AcceleratorTeamInvitationUpdate(status='accepted'), background_tasks=BackgroundTasks(), expected=(403, 404))
        await self.call('invitee_declines', teams.answer_team_invitation, as_user='e', invitation_id=invitation['id'], payload=AcceleratorTeamInvitationUpdate(status='declined'), background_tasks=BackgroundTasks())
        invitation = await self.call('reinvite_after_decline', teams.invite_team_member, as_user='b', team_id=b['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['e']), background_tasks=BackgroundTasks())
        await self.call('captain_cancels_invitation', teams.delete_team_invitation, as_user='b', invitation_id=invitation['id'], background_tasks=BackgroundTasks())
        invitation = await self.call('reinvite_after_cancellation', teams.invite_team_member, as_user='b', team_id=b['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['e']), background_tasks=BackgroundTasks())
        await self.call('invitee_accepts', teams.answer_team_invitation, as_user='e', invitation_id=invitation['id'], payload=AcceleratorTeamInvitationUpdate(status='accepted'), background_tasks=BackgroundTasks())
        await self.call('hide_contact', teams.patch_team_member_contact, as_user='c', member_id=c_member['id'], payload=AcceleratorTeamContactUpdate(share_contact=False))
        owner_view = await self.call('contact_visibility_after_hiding', teams.get_membership_team, as_user='a', membership_id=self.memberships['a'])
        self.verify('contact_hidden_from_captain', not next(x for x in owner_view['team']['members'] if x['id'] == c_member['id'])['person'].get('email'))
        await self.call('foreign_contact_change_rejected', teams.patch_team_member_contact, as_user='d', member_id=c_member['id'], payload=AcceleratorTeamContactUpdate(share_contact=True), expected=(403, 404))
        await self.call('assign_team_tracker', teams.assign_team_tracker, team_id=a['id'], payload=AcceleratorTeamTrackerAssign(tracker_user_id=self.users['tracker']))
        await self.call('tracker_reads_assigned_team', teams.get_membership_team, as_user='tracker', membership_id=self.memberships['a'])
        await self.call('tracker_cannot_read_unassigned_team', teams.get_membership_team, as_user='tracker', membership_id=self.memberships['b'], expected=403)
        expert = await self.call('add_expert_profile', program.create_matchmaking_pool_profile, cohort_id=COHORT_ID, payload=MatchPoolProfileCreate(user_id=self.users['expert'], role='expert', expertise=['продажи'], industries=['SaaS'], goals=['рост'], preferred_formats=['онлайн'], max_matches=1))
        recommendations = await self.call('expert_recommendations', program.matchmaking_recommendations, as_user='a', membership_id=self.memberships['a'], role='expert')
        self.verify('expert_is_recommended_with_explanations', bool(recommendations) and any(x['profile']['id'] == expert['id'] and x['score'] > 50 and x['reasons'] for x in recommendations))
        self.verify('resident_recommendations_hide_email', bool(recommendations) and all('email' not in x['profile'] for x in recommendations))
        match = await self.call('confirm_expert_match', program.create_accelerator_match, membership_id=self.memberships['a'], payload=MatchCreate(counterpart_profile_id=expert['id']), background_tasks=BackgroundTasks())
        await self.call('expert_capacity_enforced', program.create_accelerator_match, membership_id=self.memberships['b'], payload=MatchCreate(counterpart_profile_id=expert['id']), background_tasks=BackgroundTasks(), expected=409)
        await self.call('end_match', program.update_accelerator_match, match_id=match['id'], payload=MatchStatusUpdate(status='ended'))
        await self.call('reopen_match', program.update_accelerator_match, match_id=match['id'], payload=MatchStatusUpdate(status='active'))
        await self.call('transfer_captain', teams.transfer_team_captain, as_user='a', team_id=a['id'], payload=AcceleratorTeamCaptainTransfer(membership_id=self.memberships['c']))
        async with AsyncSessionLocal() as db:
            project = await db.get(Project, a['project']['id'])
            self.verify('new_captain_owns_project_even_without_tree', project.user_id == self.users['c'])
        await self.call('old_captain_loses_management', teams.patch_team, as_user='a', team_id=a['id'], payload=AcceleratorTeamUpdate(name=self.prefix + ' Запрещённая правка'), background_tasks=BackgroundTasks(), expected=403)
        await self.call('new_captain_can_rename', teams.patch_team, as_user='c', team_id=a['id'], payload=AcceleratorTeamUpdate(name=self.prefix + ' Альфа после смены капитана'), background_tasks=BackgroundTasks())
        b_view = await self.call('member_reads_joined_team', teams.get_membership_team, as_user='e', membership_id=self.memberships['e'])
        e_member = next(x for x in b_view['team']['members'] if x['membership_id'] == self.memberships['e'])
        await self.call('member_leaves_team', teams.delete_team_member, as_user='e', member_id=e_member['id'], background_tasks=BackgroundTasks())
        await self.call('captain_archives_team', teams.patch_team, as_user='b', team_id=b['id'], payload=AcceleratorTeamUpdate(status='archived', reason='ТЕСТ жизненного цикла команды'), background_tasks=BackgroundTasks())
        replacement = await self.call('new_team_after_archive', teams.create_membership_team, as_user='b', membership_id=self.memberships['b'], payload=AcceleratorTeamCreate(name=self.prefix + ' Бета новая'))
        self.created['teams'].append(replacement['id'])
        await self.call('leave_pending_application_for_review', teams.create_team_application, as_user='f', team_id=replacement['id'], payload=AcceleratorTeamApplicationCreate(message='ТЕСТ: сохранённая заявка для просмотра', desired_role='Маркетинг'))
        await self.call('leave_pending_invitation_for_review', teams.invite_team_member, as_user='b', team_id=replacement['id'], payload=AcceleratorTeamInvitationCreate(membership_id=self.memberships['d'], message='ТЕСТ: сохранённое приглашение для просмотра'), background_tasks=BackgroundTasks())
        await self.call('history_available_to_manager', teams.matchmaking_history, cohort_id=COHORT_ID)
        await self.check_homework()

    async def check_homework(self):
        stage = await self.call('create_test_homework_stage', program.create_program_stage, cohort_id=COHORT_ID,
                                payload=ProgramStageCreate(title=self.prefix + ' Проверка ДЗ', required=False))
        await self.call('publish_test_homework_stage', program.publish_program_stage, stage_id=stage['id'])
        for index, source in enumerate(self.source_homework, 1):
            homework = await self.call('clone_homework_' + str(index), program.create_homework_assignment,
                                       cohort_id=COHORT_ID, payload=HomeworkAssignmentCreate(
                                           title=self.prefix + ' ' + source['title'], description=source['description'],
                                           stage_id=stage['id'], due_at=None, audience='selected',
                                           target_membership_ids=[self.memberships['a']], assignment_type='text_files', allow_resubmit=True))
            self.created['homework'].append(homework['id'])
            await self.call('publish_test_homework_' + str(index), program.publish_homework_assignment,
                            assignment_id=homework['id'], background_tasks=BackgroundTasks())
            submission = await self.call('submit_free_text_' + str(index), program.submit_homework,
                                         assignment_id=homework['id'], as_user='a', payload=HomeworkSubmissionUpsert(answer_text='ТЕСТ: проверка отправки свободного ответа.'))
            await self.call('request_homework_revision_' + str(index), program.review_homework_submission,
                            submission_id=submission['id'], payload=HomeworkReview(status='needs_revision', comment='ТЕСТ: добавить измеримый результат.'), background_tasks=BackgroundTasks())
            submission = await self.call('resubmit_homework_' + str(index), program.submit_homework,
                                         assignment_id=homework['id'], as_user='a', payload=HomeworkSubmissionUpsert(answer_text='ТЕСТ: доработанный ответ с измеримым результатом 5 интервью.'))
            await self.call('accept_homework_' + str(index), program.review_homework_submission,
                            submission_id=submission['id'], payload=HomeworkReview(status='accepted', comment='ТЕСТ принято'), background_tasks=BackgroundTasks())

    async def finish(self):
        if hasattr(self, 'initial_status'):
            await self.call('restore_test_cohort_status', program.update_cohort_status, cohort_id=COHORT_ID, payload=StatusUpdate(status=self.initial_status))
        async with AsyncSessionLocal() as db:
            after = await main_fingerprint(db)
            self.verify('main_cohort_unchanged', self.before == after)
            user_ids = [x['id'] for x in self.created['users']]
            wrong = (await db.execute(select(AcceleratorMembership.id).where(
                AcceleratorMembership.user_id.in_(user_ids), AcceleratorMembership.cohort_id != COHORT_ID
            ))).all()
            self.verify('synthetic_memberships_only_in_test_cohort', not wrong)
        return {'batch_key': self.batch_key, 'cohort_id': COHORT_ID, 'main_cohort_fingerprint': after,
                'created': self.created, 'cases': self.results,
                'passed': sum(x['pass'] for x in self.results), 'failed': sum(not x['pass'] for x in self.results)}


async def run_cli(args):
    audit = Audit(args.batch_key, args.actor_id)
    fatal = None
    try:
        await audit.run()
    except Exception as exc:
        fatal = type(exc).__name__ + ': ' + (str(exc) if isinstance(exc, (ValueError, RuntimeError, TypeError)) else 'See failing case')
    if not hasattr(audit, 'before'):
        raise RuntimeError(fatal or 'Preflight failed')
    report = await audit.finish()
    if fatal:
        report['fatal'] = fatal
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    print(json.dumps(report, ensure_ascii=False, default=str))
    return 1 if fatal or report['failed'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch-key', required=True)
    parser.add_argument('--actor-id', type=int, required=True)
    parser.add_argument('--output', required=True)
    raise SystemExit(asyncio.run(run_cli(parser.parse_args())))
