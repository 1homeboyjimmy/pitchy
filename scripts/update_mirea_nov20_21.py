"""Update two existing MIREA event cards from organizer announcements."""
import argparse
import asyncio
from datetime import datetime
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(apply):
    from sqlalchemy import select
    from db_async import AsyncSessionLocal
    from models import AcceleratorCohort, AcceleratorEvent, AcceleratorEventChange, User
    from mirea_event_announcements import UPDATES
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
            assert event.starts_at.date() == UPDATES[event.id]['starts_at'].date()
            values = UPDATES[event.id]
            changes = {k: v for k, v in values.items() if getattr(event, k) != v}
            if not changes:
                continue
            before = {k: serial(getattr(event, k)) for k in changes}
            for k, v in changes.items():
                setattr(event, k, v)
            event.updated_by_user_id = actor.id
            after = {k: serial(v) for k, v in changes.items()}
            db.add(AcceleratorEventChange(event_id=event.id, actor_user_id=actor.id, action='details_updated',
                reason='Уточнение по объявлениям организаторов от 20 ноября 2026', before=before, after=after))
            plan.append({'event_id': event.id, 'before': before, 'after': after})
        if apply:
            await db.commit()
        else:
            await db.rollback()
        print(json.dumps({'applied': apply, 'changes': plan}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    asyncio.run(run(parser.parse_args().apply))
