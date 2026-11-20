"""Cloud dates, team credit, safe repeats and manual decision precedence."""
from datetime import datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import openpyxl
import pytest
from sqlalchemy import select

from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceRecord, AcceleratorAttendanceCorrection, AcceleratorEvent
from scripts.sync_mirea_cloud import parse_attendance, parse_schedule, match_event, synchronize, SOURCE_COMMENT
from tests.test_accelerator_team_attendance import group


def xlsx(rows):
    book = openpyxl.Workbook()
    for row in rows:
        book.active.append(row)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def test_parser_dates_duplicates_empty_cells_and_offline_placeholder():
    schedule = xlsx([
        [1, 'Первое', 'Один', datetime(2026, 11, 13), '18:00–19:30', 'Онлайн - вебинар', 'https://example.test/one'],
        [2, 'Второе', 'Два', datetime(2026, 11, 13), '20:00-21:30', 'Онлайн - вебинар'],
        [3, None, 'Два', datetime(2026, 11, 21), '12:00-13:30', 'Офлайн', 'Брифинг-зона'],
        [4, None, None, datetime(2026, 11, 22)],
    ])
    events = parse_schedule(schedule)
    assert len(events) == 3
    assert events[0]['starts_at'].hour == 15
    assert events[2]['title'] == 'Очное мероприятие'
    assert events[2]['location'] == 'Брифинг-зона'
    header, rows, skipped = parse_attendance(xlsx([
        ['Трек', 'Проект', '13 Ноября Встреча № 4', '13 Ноября Встреча № 5', 'Встреча № 8'],
        ['Тех', 'Команда', 'Был', None, 'Не был'],
    ]))
    assert len(header) == 2 and rows[0]['marks'] == {2: 'present'}
    assert skipped == ['Встреча № 8']
    with pytest.raises(ValueError):
        parse_attendance(xlsx([['Трек', 'Проект', '19.11 Встреча №8'], ['Тех', 'Команда', 'Ошибка']]))


def test_event_move_keeps_identity_and_ambiguous_move_fails():
    event = SimpleNamespace(id=1, title='Название', starts_at=datetime(2026, 11, 9), host_name='Спикер', meeting_url='https://example.test/id')
    item = dict(title='Новое название', starts_at=datetime(2026, 11, 10), host_name='Спикер', meeting_url='https://example.test/id')
    assert match_event(item, [event], set()) is event
    item.update(title='Название', meeting_url=None)
    duplicate = SimpleNamespace(**{**vars(event), 'id': 2})
    with pytest.raises(ValueError):
        match_event(item, [event, duplicate], set())


async def fixture(db):
    actor, cohort, user, member, event, peer, peer_member = await group(db)
    actor.is_admin = True
    event.starts_at = datetime(2026, 11, 9, 15)
    event.ends_at = datetime(2026, 11, 9, 16, 30)
    cohort.attendance_policy = {'planned_events': 10, 'event_ids': [event.id], 'excluded_events_by_team': {}}
    await db.commit()
    schedule = xlsx([[1, event.title, 'Спикер', datetime(2026, 11, 9), '18:00–19:30', 'Онлайн - вебинар']])
    return actor, cohort, member, event, peer_member, schedule


def marks(value='Был', day='9 Ноября'):
    return xlsx([['Трек', 'Проект', day+' Встреча №1', 'Встреча №2'], ['Тех', 'Team', value, 'Не был']])


@pytest.mark.asyncio
async def test_preview_rollback_team_import_repeat_and_blank_preservation():
    async with AsyncSessionLocal() as db:
        actor, cohort, member, event, peer, schedule = await fixture(db)
        args = dict(cohort_id=cohort.id, actor_id=actor.id, accelerator_id=cohort.accelerator_id)
        eid, mids = event.id, {member.id, peer.id}
        result = await synchronize(db, schedule, marks(), **args)
        assert result['attendance_records_changed'] == 2
        assert not list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == eid))).scalars())
        result = await synchronize(db, schedule, marks(), apply=True, **args)
        assert result['attendance_records_changed'] == 2
        rows = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == eid))).scalars())
        assert {r.membership_id for r in rows} == mids
        assert all(r.status == 'present' and r.comment == SOURCE_COMMENT for r in rows)
        assert (await synchronize(db, schedule, marks(), apply=True, **args))['attendance_records_changed'] == 0
        assert (await synchronize(db, schedule, marks(None), apply=True, **args))['attendance_records_changed'] == 0
        assert (await synchronize(db, schedule, marks('Не был'), apply=True, **args))['attendance_records_changed'] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('approved', [False, True])
async def test_manual_or_approved_decision_is_not_overwritten(approved):
    async with AsyncSessionLocal() as db:
        actor, cohort, member, event, peer, schedule = await fixture(db)
        db.add(AcceleratorAttendanceRecord(event_id=event.id, membership_id=member.id, status='absent',
               checkin_method='manual', marked_by_user_id=actor.id, comment=SOURCE_COMMENT if approved else 'Проверено организатором'))
        if approved:
            db.add(AcceleratorAttendanceCorrection(cohort_id=cohort.id, membership_id=member.id, event_id=event.id,
                full_name='Участник', was_present=False, description='Проверено', status='approved'))
        await db.commit()
        result = await synchronize(db, schedule, marks(), cohort_id=cohort.id, actor_id=actor.id,
                                   accelerator_id=cohort.accelerator_id, apply=True)
        assert result['protected_team_events'] == 1 and result['attendance_records_changed'] == 0


@pytest.mark.asyncio
async def test_ambiguous_day_skipped_and_invalid_source_rolls_back():
    async with AsyncSessionLocal() as db:
        actor, cohort, member, event, peer, schedule = await fixture(db)
        db.add(AcceleratorEvent(cohort_id=cohort.id, title='Второе', starts_at=datetime(2026, 11, 9, 17),
            ends_at=datetime(2026, 11, 9, 18, 30), status='published', checkin_code='second-'+str(cohort.id),
            created_by_user_id=actor.id, updated_by_user_id=actor.id))
        await db.commit()
        result = await synchronize(db, schedule, marks(), cohort_id=cohort.id, actor_id=actor.id,
                                   accelerator_id=cohort.accelerator_id, apply=True)
        assert result['ambiguous_dates'] == ['2026-11-09']
        assert result['attendance_records_changed'] == 0


@pytest.mark.asyncio
async def test_two_same_date_columns_map_by_time_and_new_event_is_idempotent():
    async with AsyncSessionLocal() as db:
        actor, cohort, member, event, peer, schedule = await fixture(db)
        args = dict(cohort_id=cohort.id, actor_id=actor.id, accelerator_id=cohort.accelerator_id, apply=True)
        title = event.title
        schedule = xlsx([
            [1, title, 'Спикер', datetime(2026, 11, 9), '18:00-19:30', 'Онлайн - вебинар'],
            [2, 'Второе занятие', 'Другой', datetime(2026, 11, 9), '20:00-21:30', 'Онлайн - вебинар'],
        ])
        attendance = xlsx([['Трек', 'Проект', '9 Ноября Встреча №1', '9 Ноября Встреча №2'], ['Тех', 'Team', 'Был', 'Не был']])
        result = await synchronize(db, schedule, attendance, **args)
        assert result['events_created'] == 1 and result['attendance_records_changed'] == 4
        events = list((await db.execute(select(AcceleratorEvent).where(AcceleratorEvent.cohort_id == cohort.id).order_by(AcceleratorEvent.starts_at))).scalars())
        rows = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id.in_([e.id for e in events])))).scalars())
        assert all(r.status == ('present' if r.event_id == events[0].id else 'absent') for r in rows)
        assert (await synchronize(db, schedule, attendance, **args))['events_created'] == 0


@pytest.mark.asyncio
async def test_future_column_does_not_create_absences():
    async with AsyncSessionLocal() as db:
        actor, cohort, member, event, peer, schedule = await fixture(db)
        future = datetime.utcnow()+timedelta(days=10)
        event.starts_at = future
        event.ends_at = future+timedelta(hours=2)
        await db.commit()
        schedule = xlsx([[1, event.title, 'Спикер', future, '18:00-19:30', 'Онлайн - вебинар']])
        attendance = marks('Не был', future.strftime('%d.%m.%Y'))
        result = await synchronize(db, schedule, attendance, cohort_id=cohort.id, actor_id=actor.id,
                                   accelerator_id=cohort.accelerator_id, apply=False)
        assert result['attendance_records_changed'] == 0
        assert result['future_columns'] == 1
