"""Organizer's November 20 update; supersedes the older workbook wording."""
from datetime import datetime

UPDATES = {
    32: {
        'title': 'Бизнес-модель и монетизация',
        'host_name': 'Артём Михеев',
        'starts_at': datetime(2026, 11, 20, 15),
        'ends_at': datetime(2026, 11, 20, 16, 30),
        'event_format': 'online',
        'event_type': 'webinar',
        'meeting_url': 'https://my.mts-link.ru/j/152085126/28462969787',
        'online_platform': 'МТС Линк',
        'description': 'Business Model Canvas и Lean Canvas: как превратить идею в работающую бизнес-модель.\n\nЧто разберём:\n• Как связать создание, доставку и получение ценности в бизнес-модели проекта.\n• Business Model Canvas и Lean Canvas.\n• Модели монетизации и выбор подходящей модели для своего рынка.\n• Ценовые гипотезы и формирование коммерческого предложения, которое клиент готов купить.\n\nО спикере\nАртём Михеев — сооснователь стартапа Runtimy, эксперт с 15-летним опытом в финансах и венчурных стартапах.',
        'outcome': 'Бизнес-модель проекта на основе Canvas, гипотезы монетизации и цены, основа коммерческого предложения.',
    },
    37: {
        'title': 'Customer Development: как не создать никому не нужный продукт',
        'host_name': 'Дмитрий Разбегаев',
        'starts_at': datetime(2026, 11, 21, 9),
        'ends_at': datetime(2026, 11, 21, 10, 30),
        'event_format': 'offline',
        'event_type': 'other',
        'location': 'А-213б (Международный молодёжный ресурсный медиацентр)',
        'venue_details': None,
        'preview_url': '/events/mirea/nov-21.jpg',
        'description': 'Лекция о Customer Development — проверке бизнес-гипотез через общение с клиентами.\n\nЧто разберём:\n• Как выявлять реальные проблемы и потребности аудитории.\n• Какие вопросы задавать на интервью, чтобы получать правдивые инсайты.\n• Как отличить настоящую потребность от вежливого «да, мне интересно».\n• Как принимать решения о продукте на основе фактов, а не догадок.\n\nО спикере\nДмитрий Разбегаев — технологический предприниматель, эксперт «Сколково», федеральный тренер МЭР РФ, трекер и разработчик образовательных и акселерационных программ.',
    },
}


def correct_stale_schedule(item, cohort_id):
    """Replace only known outdated cells; later workbook edits still propagate."""
    if cohort_id != 8:
        return item
    item = dict(item)
    if item['starts_at'].date() == datetime(2026, 11, 20).date() and item['title'] == 'Финансы стартапа':
        item['title'] = UPDATES[32]['title']
    if item['starts_at'].date() == datetime(2026, 11, 21).date():
        if item['title'] == 'Очное мероприятие':
            item['title'] = UPDATES[37]['title']
        location = item.get('location', '').casefold()
        if 'техноковоркинг' in location and 'брифинг' in location:
            item['location'] = UPDATES[37]['location']
    return item
