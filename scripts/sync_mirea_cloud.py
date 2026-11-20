"""Reconcile MIREA's public workbooks. Preview by default; never delete events.

Run from the backend runtime with --apply. Undated attendance columns, empty
cells and ambiguous matches are reported, never interpreted as absences.
"""
import argparse
import asyncio
from collections import defaultdict
from datetime import date, datetime, time, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import secrets
import sys
import unicodedata
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ATTENDANCE_URL = 'https://cloud.mirea.ru/index.php/s/cXFxNqcn9tYTNfc/download'
SCHEDULE_URL = 'https://cloud.mirea.ru/index.php/s/fWbnJ6mFDMQEbD3/download'
SOURCE_COMMENT = 'МИРЭА: автоматическая сверка облачной таблицы'
# Verified against the previous organizer-authorized import, row 168.
TEAM_ALIASES = {'камерыдляадаптивногопереключениясветофорасприоритетомобщественноготранспорта': 140}
MONTHS = {'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'ма': 5, 'июн': 6,
          'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12}


def normalized(value):
    return re.sub(r'[^\w]', '', unicodedata.normalize('NFKC', str(value or '')).casefold().replace('ё', 'е'))


def text(value):
    return str(value or '').strip()


def workbook(content):
    import openpyxl
    if len(content) > 12 * 1024 * 1024 or not content.startswith(b'PK'):
        raise ValueError('Источник не является допустимой XLSX-таблицей')
    import zipfile
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if sum(f.file_size for f in archive.infolist()) > 80 * 1024 * 1024:
            raise ValueError('Распакованная таблица слишком велика')
    return openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)


def source_date(value, year):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    value = text(value).casefold()
    numeric = re.search(r'\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b', value)
    if numeric:
        return date(int(numeric[3] or year), int(numeric[2]), int(numeric[1]))
    russian = re.search(r'\b(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?', value)
    if russian:
        month = next((n for prefix, n in MONTHS.items() if russian[2].startswith(prefix)), None)
        if month:
            return date(int(russian[3] or year), month, int(russian[1]))
    return None


def safe_url(value):
    value = text(value)
    parsed = urlparse(value)
    return value if parsed.scheme in ('http', 'https') and parsed.netloc and not parsed.username else None


def parse_schedule(content, year=2026, zone='Europe/Moscow'):
    result = []
    for sheet in workbook(content):
        for row_number, cells in enumerate(sheet.iter_rows(values_only=True), 1):
            values = list(cells) + [None] * 8
            day = source_date(values[3], year)
            if not day or not any(text(values[i]) for i in (1, 2, 4, 5)):
                continue
            title = text(values[1]) or 'Очное мероприятие'
            clock = re.search(r'(\d{1,2}):([0-5]\d)\s*[-–—]\s*(\d{1,2}):([0-5]\d)', text(values[4]))
            if not clock:
                raise ValueError(f'Не распознано время мероприятия, строка {row_number}')
            start, end = [datetime.combine(day, time(int(clock[i]), int(clock[i+1])), ZoneInfo(zone)) for i in (1, 3)]
            if end <= start:
                raise ValueError(f'Некорректный интервал, строка {row_number}')
            kind = normalized(values[5])
            if 'офлайн' in kind or 'оффлайн' in kind:
                event_format = 'offline'
            elif 'онлайн' in kind:
                event_format = 'online'
            elif 'гибрид' in kind:
                event_format = 'hybrid'
            else:
                raise ValueError(f'Не распознан формат, строка {row_number}')
            item = dict(source_row=row_number, title=title, host_name=text(values[2]) or None,
                        starts_at=start.astimezone(timezone.utc).replace(tzinfo=None),
                        ends_at=end.astimezone(timezone.utc).replace(tzinfo=None), event_format=event_format)
            if safe_url(values[6]):
                item['meeting_url'] = safe_url(values[6])
            elif text(values[6]) and event_format != 'online':
                item['location'] = text(values[6])
            if safe_url(values[7]):
                item['recording_url'] = safe_url(values[7])
            result.append(item)
    keys = [(normalized(i['title']), i['starts_at']) for i in result]
    if not result or len(keys) != len(set(keys)):
        raise ValueError('Расписание пустое либо содержит дубликаты')
    return sorted(result, key=lambda i: i['starts_at'])


def parse_attendance(content, year=2026):
    sheets = list(workbook(content))
    if len(sheets) != 1:
        raise ValueError('Ожидался один лист посещаемости')
    rows = list(sheets[0].iter_rows(values_only=True))
    header_index = next((i for i, r in enumerate(rows[:10]) if len(r) > 1 and normalized(r[1]) == 'проект'), None)
    if header_index is None:
        raise ValueError('Заголовок таблицы посещаемости не найден')
    headers, skipped = [], []
    for col, label in enumerate(rows[header_index][2:], 2):
        if 'встреч' not in text(label).casefold():
            continue
        day = source_date(label, year)
        if day:
            headers.append((col, day))
        else:
            skipped.append(text(label))
    projects = []
    for row_no, row in enumerate(rows[header_index+1:], header_index+2):
        if len(row) < 2 or not text(row[1]):
            continue
        marks = {}
        for col, day in headers:
            value = normalized(row[col] if col < len(row) else None)
            if not value:
                continue
            status = {'был': 'present', 'да': 'present', 'небыл': 'absent', 'нет': 'absent', 'ставрополь': 'excused'}.get(value)
            if status is None:
                raise ValueError(f'Неизвестная отметка, строка {row_no}, колонка {col+1}')
            marks[col] = status
        projects.append(dict(row=row_no, name=text(row[1]), marks=marks))
    if not headers or not projects:
        raise ValueError('Таблица посещаемости не содержит дат или проектов')
    return headers, projects, skipped


def match_event(item, events, used):
    available = [e for e in events if e.id not in used]
    for predicate in (
        lambda e: item.get('meeting_url') and e.meeting_url == item['meeting_url'],
        lambda e: normalized(e.title) == normalized(item['title']) and e.starts_at.date() == item['starts_at'].date(),
        lambda e: normalized(e.title) == normalized(item['title']) and normalized(e.host_name) == normalized(item['host_name']),
    ):
        matches = [e for e in available if predicate(e)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f'Неоднозначное мероприятие: {item["title"]}')
    if any(normalized(e.title) == normalized(item['title']) for e in available):
        raise ValueError(f'Неоднозначный перенос мероприятия: {item["title"]}')
    if any(e.starts_at == item['starts_at'] and normalized(e.host_name) == normalized(item['host_name']) for e in available):
        raise ValueError(f'Возможное переименование мероприятия без постоянной ссылки: {item["title"]}')
    return None


async def synchronize(db, schedule, attendance, *, cohort_id, actor_id, apply=False, accelerator_id=6):
    from sqlalchemy import select, text as sql_text
    from models import (AcceleratorCohort, AcceleratorEvent, AcceleratorEventChange, AcceleratorTeam,
                        AcceleratorAttendanceRecord, AcceleratorAttendanceCorrection, AcceleratorAuditLog, AcceleratorMembership, User)
    from accelerator_team_roster import attendance_team_roster
    from accelerator_team_attendance import record_team_attendance
    if db.bind.dialect.name == 'postgresql':
        # Transaction-scoped: release automatically on rollback, commit or process exit.
        locked = await db.scalar(sql_text('SELECT pg_try_advisory_xact_lock(:key)'), {'key': 9100000 + cohort_id})
        if not locked:
            return {'skipped': 'previous_run_active'}
    cohort = await db.get(AcceleratorCohort, cohort_id)
    actor = await db.get(User, actor_id)
    if not cohort or cohort.accelerator_id != accelerator_id or cohort.status != 'active' or cohort.attendance_scope != 'team':
        raise ValueError('Синхронизация разрешена только для активного командного потока МИРЭА')
    if not actor or not actor.is_admin or not actor.is_active:
        raise ValueError('Не найден активный служебный администратор')
    year = 2026
    incoming = parse_schedule(schedule, year, cohort.timezone)
    from mirea_event_announcements import correct_stale_schedule
    incoming = [correct_stale_schedule(item, cohort.id) for item in incoming]
    headers, projects, undated = parse_attendance(attendance, year)
    events = list((await db.execute(select(AcceleratorEvent).where(AcceleratorEvent.cohort_id == cohort.id).order_by(AcceleratorEvent.id).with_for_update())).scalars())
    report = dict(events_created=0, events_updated=0, attendance_records_changed=0, teams_matched=0,
                  protected_team_events=0, undated_columns=undated, unmatched_projects=[], ambiguous_dates=[], future_columns=0,
                  attendance_changes=[])
    used = set()
    for item in incoming:
        existing = match_event(item, events, used)
        values = {k: v for k, v in item.items() if k != 'source_row' and v is not None}
        if existing is None:
            existing = AcceleratorEvent(cohort_id=cohort.id, status='published', published_at=datetime.utcnow(),
                                        checkin_code=secrets.token_urlsafe(32), created_by_user_id=actor.id,
                                        updated_by_user_id=actor.id, **values)
            db.add(existing)
            await db.flush()
            events.append(existing)
            report['events_created'] += 1
        else:
            changes = {k: v for k, v in values.items() if getattr(existing, k) != v}
            if changes:
                before = {k: str(getattr(existing, k)) for k in changes}
                for k, value in changes.items():
                    setattr(existing, k, value)
                existing.updated_by_user_id = actor.id
                db.add(AcceleratorEventChange(event_id=existing.id, actor_user_id=actor.id, action='details_updated',
                       reason=SOURCE_COMMENT, before=before, after={k: str(v) for k, v in changes.items()}))
                report['events_updated'] += 1
        used.add(existing.id)
    # Match dates against the actual current schedule. Repeated dates are only
    # accepted when all events that day are represented, in chronological order.
    by_day, by_header = defaultdict(list), defaultdict(list)
    for e in events:
        if e.status in ('published', 'completed'):
            by_day[e.starts_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(cohort.timezone)).date()].append(e)
    for col, day in headers:
        by_header[day].append(col)
    columns = {}
    for day, cols in by_header.items():
        candidates = sorted(by_day[day], key=lambda e: e.starts_at)
        if len(cols) != len(candidates) or len({e.starts_at for e in candidates}) != len(candidates):
            report['ambiguous_dates'].append(day.isoformat())
            continue
        for col, event in zip(cols, candidates):
            if event.ends_at <= datetime.utcnow():
                columns[col] = event
            else:
                report['future_columns'] += 1
    teams = list((await db.execute(select(AcceleratorTeam).where(AcceleratorTeam.cohort_id == cohort.id, AcceleratorTeam.status == 'active'))).scalars())
    team_index = defaultdict(list)
    for t in teams:
        team_index[normalized(t.name)].append(t)
    by_id = {t.id: t for t in teams}
    roster = attendance_team_roster()
    members = defaultdict(list)
    for tid, member in (await db.execute(select(roster.c.team_id, AcceleratorMembership).join(
        AcceleratorMembership, AcceleratorMembership.id == roster.c.membership_id).where(
        roster.c.cohort_id == cohort.id, AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == 'resident', AcceleratorMembership.status.in_(('enrolled', 'completed'))))).all():
        members[tid].append(member)
    records = {(r.event_id, r.membership_id): r for r in (await db.execute(select(AcceleratorAttendanceRecord).where(
        AcceleratorAttendanceRecord.event_id.in_([e.id for e in events])))).scalars()}
    protected = set()
    member_teams = {m.id: tid for tid, group in members.items() for m in group}
    for correction in (await db.execute(select(AcceleratorAttendanceCorrection).where(
        AcceleratorAttendanceCorrection.cohort_id == cohort.id, AcceleratorAttendanceCorrection.status == 'approved'))).scalars():
        protected.add((member_teams.get(correction.membership_id), correction.event_id))
    grouped = defaultdict(list)
    for project in projects:
        key = normalized(project['name'])
        matches = team_index[key]
        if not matches and cohort.id == 8 and TEAM_ALIASES.get(key) in by_id:
            matches = [by_id[TEAM_ALIASES[key]]]
        anchors = {t.attendance_team_id or t.id for t in matches}
        if len(anchors) != 1:
            report['unmatched_projects'].append({'row': project['row'], 'name': project['name']})
            continue
        grouped[next(iter(anchors))].append(project)
    for tid, source_rows in grouped.items():
        group = members[tid]
        if not group:
            continue
        report['teams_matched'] += 1
        for col, event in columns.items():
            marks = {p['marks'][col] for p in source_rows if col in p['marks']}
            if not marks:
                continue
            # Multiple rows for one team count as present if any row is present.
            if 'present' in marks:
                status = 'present'
            elif len(marks) == 1:
                status = next(iter(marks))
            else:
                report['protected_team_events'] += 1
                continue
            current = [records.get((event.id, m.id)) for m in group]
            changed = sum(r is None or r.status != status for r in current)
            if not changed:
                continue
            # Approved corrections and later manual/QR decisions outrank imports.
            if (tid, event.id) in protected or any(r and not (
                (r.comment or '').startswith(SOURCE_COMMENT) or (r.comment or '').startswith('Таблица посещаемости')
                or (r.comment or '').startswith('По таблице посещаемости команды')
            ) for r in current):
                report['protected_team_events'] += 1
                continue
            await record_team_attendance(db, cohort=cohort, event=event, members=group, actor=actor,
                status=status, method='manual', comment=SOURCE_COMMENT)
            report['attendance_records_changed'] += changed
            report['attendance_changes'].append({'team_id': tid, 'event_id': event.id, 'status': status, 'records': changed})
    # Add new dated meetings to the existing reporting policy without changing
    # organizer-set denominators or team exemptions.
    policy = cohort.attendance_policy
    if policy:
        ids = sorted(set(policy['event_ids']) | {e.id for e in columns.values()})
        if ids != sorted(policy['event_ids']):
            cohort.attendance_policy = {**policy, 'event_ids': ids, 'planned_events': max(policy['planned_events'], len(ids))}
    if any(report[k] for k in ('events_created', 'events_updated', 'attendance_records_changed')):
        db.add(AcceleratorAuditLog(accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=actor.id,
               action='mirea.cloud_synced', target_type='cohort', target_id=cohort.id,
               details={**report, 'attendance_sha256': hashlib.sha256(attendance).hexdigest(),
                        'schedule_sha256': hashlib.sha256(schedule).hexdigest()}))
    if apply:
        await db.commit()
    else:
        await db.rollback()
    return {'applied': apply, **report}


async def run(args):
    import httpx
    from db_async import AsyncSessionLocal
    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
        async def download(url):
            async with client.stream('GET', url) as response:
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 12 * 1024 * 1024:
                        raise ValueError('Превышен размер облачной таблицы')
                return bytes(content)
        schedule, attendance = await asyncio.gather(download(SCHEDULE_URL), download(ATTENDANCE_URL))
    async with AsyncSessionLocal() as db:
        report = await synchronize(db, schedule, attendance, cohort_id=args.cohort_id, actor_id=args.actor_id, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, default=str))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort-id', type=int, default=8)
    parser.add_argument('--actor-id', type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    asyncio.run(run(parser.parse_args()))
