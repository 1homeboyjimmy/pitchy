"""Update two existing MIREA event cards from organizer announcements."""
import argparse
import asyncio
from datetime import datetime
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(apply, event_ids=None):
    from sqlalchemy import select
    from db_async import AsyncSessionLocal
    from models import AcceleratorCohort, AcceleratorEvent, AcceleratorEventChange, User
    from mirea_event_announcements import UPDATES
    if event_ids:
        assert set(event_ids).issubset(UPDATES)
        UPDATES = {k: v for k, v in UPDATES.items() if k in event_ids}
    async with AsyncSessionLocal() as db:
        cohort = await db.get(AcceleratorCohort, 8)
        actor = await db.get(User, 13)
        assert cohort and cohort.accelerator_id == 6 and actor and actor.is_admin and actor.is_active
        events = list((await db.execute(select(AcceleratorEvent).where(
            AcceleratorEvent.cohort_id == 8, AcceleratorEvent.id.in_(UPDATES)).order_by(AcceleratorEvent.id).with_for_update())).scalars())
        assert {e.id for e in events} == set(UPDATES)
        plan = []
        def serial(value):
            return value.isoformat() if isinstance(value, datetime) else value
        for event in events:
            allowed_dates = {UPDATES[event.id]['starts_at'].date()}
            if event.id == 34:
                allowed_dates.add(datetime(2026, 11, 24).date())
            assert event.starts_at.date() in allowed_dates
            values = dict(UPDATES[event.id])
            if 'post_materials' in values:
                links = values['post_materials']
                urls = {link['url'] for link in links}
                values['post_materials'] = [link for link in (event.post_materials or []) if link.get('url') not in urls] + links
            changes = {k: v for k, v in values.items() if getattr(event, k) != v}
            if not changes:
                continue
            before = {k: serial(getattr(event, k)) for k in changes}
            for k, v in changes.items():
                setattr(event, k, v)
            event.updated_by_user_id = actor.id
            after = {k: serial(v) for k, v in changes.items()}
            db.add(AcceleratorEventChange(event_id=event.id, actor_user_id=actor.id, action='details_updated',
                reason='Уточнение по объявлению организаторов', before=before, after=after))
            plan.append({'event_id': event.id, 'before': before, 'after': after})
        if apply:
            await db.commit()
        else:
            await db.rollback()
        print(json.dumps({'applied': apply, 'changes': plan}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--event-id', type=int, action='append')
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.event_id))
