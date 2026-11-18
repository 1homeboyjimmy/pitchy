"""Attach supplied posters to five existing November events. Dry run by default."""
import argparse
from datetime import timezone
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

POSTERS = {
    '09': ('nov-09.jpg', 'Леонид Чернигов', 'Сооснователь и руководитель IT-стартапов, трекер и ведущий трекер акселерационных программ ФРИИ.'),
    '11': ('nov-11.jpg', 'Дмитрий Разбегаев', 'Технологический предприниматель, эксперт Сколково, федеральный тренер МЭР РФ, тренер ОТУС, трекер, разработчик образовательных и акселерационных программ.'),
    '12': ('nov-12.jpg', 'Андрей Горячев', 'Предприниматель, основатель технологических стартапов, специалист Проектного офиса по развитию молодёжного предпринимательства в университетах Минобрнауки России.'),
    '13-market': ('nov-13-market.jpg', 'Леонид Чернигов', 'Сооснователь IT-стартапов, трекер ФРИИ и ментор Сколково, преподаватель МФТИ/ВШЭ, руководитель проектов Family Office.'),
    '13-marketing': ('nov-13-marketing.jpg', 'Алексей Добрусин', 'Кандидат экономических наук, эксперт Фонда «Сколково», академический директор магистратуры по маркетингу РАНХиГС, трекер акселерационных программ, преподаёт маркетинг и прикладной ИИ.'),
}


def poster_key(event, year, tz):
    local = event.starts_at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz))
    if local.year != year or local.month != 11:
        return None
    day = f'{local.day:02d}'
    if day == '13':
        title = event.title.casefold()
        if 'маркетинг' in title or 'продвижен' in title:
            return '13-marketing'
        if 'рын' in title or 'проверка решения' in title:
            return '13-market'
        return None
    return day if day in POSTERS else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort-id', type=int, required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    from sqlalchemy import select
    from db import SessionLocal
    from models import AcceleratorCohort, AcceleratorEvent, AcceleratorEventChange
    with SessionLocal() as db:
        cohort = db.get(AcceleratorCohort, args.cohort_id)
        if not cohort:
            raise SystemExit('Поток не найден')
        print(f'Поток {cohort.id}: {cohort.name}, год {args.year}')
        events = db.scalars(select(AcceleratorEvent).where(AcceleratorEvent.cohort_id == cohort.id)).all()
        matches = {}
        for event in events:
            key = poster_key(event, args.year, cohort.timezone)
            if key:
                if key in matches:
                    raise SystemExit(f'Неоднозначное соответствие афиши {key}; изменения отменены')
                matches[key] = event
        if set(matches) != set(POSTERS):
            raise SystemExit(f'Не найдены все пять мероприятий: {sorted(set(POSTERS) - set(matches))}; изменения отменены')
        for key, event in matches.items():
            filename, speaker, bio = POSTERS[key]
            before = {field: getattr(event, field) for field in ('preview_url', 'host_name', 'description')}
            event.preview_url = f'/events/mirea/{filename}'
            if not (event.host_name or '').strip():
                event.host_name = speaker
            note = f'Спикер: {speaker}. {bio}'
            if bio not in (event.description or ''):
                event.description = '\n\n'.join(filter(None, [(event.description or '').strip(), note]))
            after = {field: getattr(event, field) for field in before}
            print(f'{event.id}: {event.title} → {filename}, {speaker}')
            if before != after:
                db.add(AcceleratorEventChange(event_id=event.id, action='updated', reason='Афиша и сведения о спикере из предоставленных материалов', before=before, after=after))
        if args.apply:
            db.commit()
            print('Сохранено')
        else:
            db.rollback()
            print('Предпросмотр. Для сохранения добавьте --apply.')


if __name__ == '__main__':
    main()
