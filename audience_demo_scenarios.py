"""Curated, reproducible exhibition scenarios based on the Russian research bundle.

Audience members are selected from the existing synthetic persona catalog. Reactions
are explicitly scenario simulations, not quotations from interviewed consumers.
"""
from __future__ import annotations

import hashlib
from typing import Any


SCENARIOS: dict[str, dict[str, Any]] = {
    "calorie-photo": {
        "title": "ИИ-трекер калорий по фото",
        "short": "Фото блюда → состав, порция и калорийность",
        "idea": "ИИ-трекер питания: пользователь фотографирует блюдо, получает предполагаемый состав, размер порции и калорийность, может быстро исправить распознавание и вести дневник питания.",
        "audience": "Люди, которым важно следить за питанием, но неудобно вручную записывать блюда каждый день.",
        "groups": [
            "Молодой специалист с плотным графиком",
            "Работник с физической или сменной занятостью",
            "Родитель маленького ребёнка",
            "Активный специалист старшего возраста",
            "Студент, совмещающий учёбу и подработку",
        ],
        "segments": {
            "Молодой специалист с плотным графиком": (7, 7, 6, "Между встречами нет времени заносить каждый ингредиент; фотография может сократить рутину. Но порцию и состав я всё равно хочу проверить перед сохранением."),
            "Работник с физической или сменной занятостью": (7, 6, 6, "При сменном графике сложно вести дневник по расписанию. Быстрая запись была бы полезна, если приложение не требует долгого ручного ввода после смены."),
            "Родитель маленького ребёнка": (7, 6, 5, "Когда готовлю и ем на ходу, подробный подсчёт быстро надоедает. Фото упростило бы запись, но семейное блюдо и свою порцию важно различать."),
            "Активный специалист старшего возраста": (6, 6, 5, "Интересно видеть состав рациона, если распознавание объясняет расчёт понятным языком. Ошибочную калорийность нельзя оставлять без возможности исправления."),
            "Студент, совмещающий учёбу и подработку": (6, 6, 5, "Не хочется тратить время и деньги на сложный дневник. Попробовал(а) бы фотоучёт, если бесплатный режим полезен, а порцию можно быстро поправить."),
        },
        "findings": [
            ("В опросе ВЦИОМ о пищевых привычках 58% участников ответили, что стараются питаться правильно, но не всегда это получается.", ["food-wciom"]),
            ("В российском App Store fatsecret заявляет учёт питания и фотооценку еды; фотоучёт уже присутствует у действующих конкурентов.", ["fatsecret-premium", "fatsecret-store"]),
            ("Исследование показывает актуальность темы питания, но не измеряет спрос на фотоучёт или готовность платить за него.", ["food-wciom"]),
        ],
        "sources": [
            ("food-wciom", "wciom.ru", "ВЦИОМ: «Еда по правилам и без»", "https://wciom.ru/analytical-reviews/analiticheskii-obzor/eda-po-pravilam-i-bez"),
            ("food-app-study", "cyberleninka.ru", "Исследование приложения для здорового питания (опрос 305 человек)", "https://cyberleninka.ru/article/n/marketingovoe-issledovanie-tselesoobraznosti-vyvedeniya-na-rynok-prilozheniya-dlya-zdorovogo-pitaniya"),
            ("fatsecret-premium", "fatsecret.com", "fatsecret Premium: фотооценка продуктов и порций", "https://www.fatsecret.com/ru/premium"),
            ("fatsecret-store", "apps.apple.com", "Счётчик калорий fatsecret — App Store РФ", "https://apps.apple.com/ru/app/id347184248"),
            ("fatsecret-reviews", "otzovik.com", "Отзывы о счётчике калорий fatsecret", "https://www.otzovik.com/reviews/schetchik_kaloriy_fatsecret/"),
            ("yazio-store", "apps.apple.com", "YAZIO — App Store РФ", "https://apps.apple.com/ru/app/id946099227"),
        ],
        "observations": ["Сильная сторона сценария — скорость записи еды.", "Фото не гарантирует точный размер порции: важно дать человеку быстро исправить результат.", "Наличие потребности в здоровом питании не доказывает спрос на платный фотоучёт."],
        "next_checks": ["Проверить точность на домашних блюдах и выяснить, сколько исправлений приемлемо пользователям."],
        "base_scores": (6.5, 6.1, 5.6),
    },
    "english-coach": {
        "title": "Тренер разговорного английского",
        "short": "Разговорная практика под рабочие и жизненные ситуации",
        "idea": "ИИ-тренер разговорного английского: пользователь выбирает свой уровень и ситуацию — например, рабочий созвон или собеседование, — практикует диалог и получает разбор ошибок и более естественные варианты фраз.",
        "audience": "Русскоязычные взрослые, которым нужна регулярная практика английской речи для работы, учёбы или поездок.",
        "groups": [
            "Взрослый учащийся или человек, меняющий профессию",
            "Молодой специалист с плотным графиком",
            "Цифровой специалист на удалённой работе",
            "Студент, совмещающий учёбу и подработку",
            "Опытный специалист, тщательно сравнивающий варианты",
        ],
        "segments": {
            "Взрослый учащийся или человек, меняющий профессию": (8, 7, 7, "Мне нужна практика под конкретную цель, а не ещё один общий курс. Полезно, если тренер замечает повторяющиеся ошибки и возвращает к ним в следующих диалогах."),
            "Молодой специалист с плотным графиком": (7, 7, 6, "Короткий разговор перед рабочим днём проще встроить в график, чем отдельный урок. Важно, чтобы обратная связь была конкретной, а не просто оценкой произношения."),
            "Цифровой специалист на удалённой работе": (7, 7, 6, "Репетиция созвонов и обсуждения задач звучит применимо к моей работе. Я сравню её с универсальным голосовым ИИ — нужен понятный прогресс по навыкам."),
            "Студент, совмещающий учёбу и подработку": (7, 6, 6, "Разговорная практика полезна, когда можно заниматься в любое время и не стесняться ошибок. Цена и доступ к базовым упражнениям будут для меня важны."),
            "Опытный специалист, тщательно сравнивающий варианты": (6, 6, 5, "Я бы сначала проверил(а), насколько исправления точны и подходят моему уровню. Сам диалог легко получить у общего ассистента; ценность должна быть в методике и отслеживании прогресса."),
        },
        "findings": [
            ("Опрос Левада-Центра 2023 года: 15% респондентов заявили, что владеют английским в контексте вопроса о свободном общении; это самооценка, а не тест.", ["levada-languages"]),
            ("Опрос пользователей языковых приложений в России (n=1 000, 2022) описывает предпочтения уже использующих такие приложения, а не всего населения.", ["language-app-survey"]),
            ("Оплата онлайн-обучения показывает существование платного образовательного рынка, но не конверсию именно в ИИ-тренер речи.", ["tbank-edtech-spend"]),
        ],
        "sources": [
            ("levada-languages", "levada.ru", "Левада-Центр: иностранные языки, август 2023", "https://www.levada.ru/2023/09/14/inostrannye-yazyki-avgust-2023-goda/"),
            ("english-career", "novostiitkanala.ru", "Опрос: влияние английского языка на карьеру", "https://www.novostiitkanala.ru/news/detail.php?ID=195156"),
            ("praktika-store", "apps.apple.com", "Praktika — App Store РФ", "https://apps.apple.com/ru/app/id1624701477"),
            ("puzzle-english", "puzzle-english.com", "Puzzle English: тарифы и подписка", "https://puzzle-english.com/buy"),
            ("englex-pricing", "englex.ru", "Инглекс: стоимость занятий английским", "https://englex.ru/cost/"),
            ("language-app-survey", "iom.anketolog.ru", "Какие приложения для изучения языков популярны в России", "https://iom.anketolog.ru/2022/09/16/prilozheniya-dlya-izucheniya-yazykov"),
            ("tbank-edtech-spend", "companies.rbc.ru", "Сколько россияне тратили на онлайн-образование в 2025", "https://companies.rbc.ru/news/LHFwvKajtM/skolko-rossiyane-tratili-na-onlajn-obrazovanie-v-2025/"),
            ("tbank-online-learning", "secrets.tbank.ru", "Т-Бизнес и T-Data: оплата онлайн-обучения россиянами", "https://secrets.tbank.ru/trendy/issledovanie-oplat-v-onlajn-obuchenii/"),
            ("duolingo-store", "play.google.com", "Duolingo — Google Play", "https://play.google.com/store/apps/details?id=com.duolingo&hl=ru"),
        ],
        "observations": ["Практика под конкретную ситуацию отличает сценарий от обычного набора уроков.", "Ключевой риск — конкуренция с универсальными голосовыми ИИ и языковыми платформами.", "Нужны измеримый прогресс и достоверная обратная связь, а не только разговорный интерфейс."],
        "next_checks": ["Проверить на русскоязычных пользователях, какие сценарии важнее: собеседование, рабочие звонки или повседневное общение."],
        "base_scores": (7.0, 6.7, 6.1),
    },
    "family-budget": {
        "title": "Помощник по личному бюджету",
        "short": "Понятный план расходов до следующего дохода",
        "idea": "ИИ-помощник по личному бюджету: пользователь задаёт доходы и обязательные платежи или загружает расходы, а сервис помогает понять доступный остаток до следующего дохода и составить реалистичный недельный план.",
        "audience": "Люди и семьи, которым нужно планировать повседневные расходы и обязательные платежи.",
        "groups": [
            "Человек, планирующий семейные расходы",
            "Студент, совмещающий учёбу и подработку",
            "Самозанятый или независимый специалист",
            "Родитель маленького ребёнка",
            "Житель небольшого города с практичным подходом",
        ],
        "segments": {
            "Человек, планирующий семейные расходы": (8, 7, 6, "Полезнее всего увидеть, сколько останется после обязательных платежей и крупных покупок. Важно учитывать общие семейные расходы и не давать абстрактный совет просто меньше тратить."),
            "Студент, совмещающий учёбу и подработку": (7, 6, 5, "План до следующей выплаты помог бы не потерять контроль над повседневными тратами. Я не стал(а) бы вручную заносить каждую покупку — импорт или очень быстрый ввод обязателен."),
            "Самозанятый или независимый специалист": (8, 7, 6, "При нерегулярных поступлениях обычный месячный бюджет плохо работает. Мне важнее сценарий слабого месяца и резерв на налоги и обязательные платежи."),
            "Родитель маленького ребёнка": (7, 6, 5, "Семейные траты меняются от месяца к месяцу. Помощник полезен, если быстро показывает безопасный остаток, но банковскую историю незнакомому сервису я бы доверял(а) не сразу."),
            "Житель небольшого города с практичным подходом": (6, 6, 5, "Нужен понятный ответ без сложных финансовых терминов. Если всё придётся вносить вручную или оплачивать отдельную подписку, я останусь на заметках или функциях банка."),
        },
        "findings": [
            ("По данным НАФИ, большинство россиян, которые ведут личный или семейный бюджет, делают это в уме.", ["nafi-budget"]),
            ("Финансовая грамотность и повседневное планирование расходов подтверждают контекст задачи, но не готовность подключать банковские данные новому сервису.", ["nafi-literacy"]),
            ("Российские сервисы учёта расходов показывают сформированную категорию; функции банков остаются прямой бесплатной альтернативой.", ["dzen-money", "coinkeeper"]),
        ],
        "sources": [
            ("apple-russia-billing", "support.apple.com", "Apple: оплата покупок и подписок в России", "https://support.apple.com/en-ie/126891"),
            ("nafi-budget", "nafi.ru", "НАФИ: большинство ведущих бюджет россиян делают это в уме", "https://nafi.ru/polls/bolshinstvo-vedushchikh-lichnyy-ili-semeynyy-byudzhet-rossiyan-delayut-eto-v-ume/"),
            ("nafi-literacy", "nafi.ru", "Финансовая грамотность россиян — 2024", "https://nafi.ru/projects/finansovaya-gramotnost-rossiyan-2024/"),
            ("dzen-money", "apps.apple.com", "Дзен-мани — App Store РФ", "https://apps.apple.com/ru/app/%D0%B4%D0%B7%D0%B5%D0%BD-%D0%BC%D0%B0%D0%BD%D0%B8-%D1%83%D1%87%D0%B5%D1%82-%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4%D0%BE%D0%B2/id905934786"),
            ("coinkeeper", "coinkeeper.me", "CoinKeeper", "https://coinkeeper.me/3"),
            ("coinkeeper-reviews", "tbank.ru", "Отзывы о CoinKeeper на Т-Банке", "https://www.tbank.ru/reviews/company/coinkeeper/100464/"),
            ("budget-apps-review", "t-j.ru", "Т—Ж: приложения для ведения бюджета", "https://t-j.ru/short/all-budget-apps/"),
            ("coinkeeper-store", "apps.apple.com", "CoinKeeper — App Store", "https://apps.apple.com/us/app/%D1%84%D0%B8%D0%BD%D0%B0%D0%BD%D1%81%D1%8B-%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82-%D1%81-coinkeeper/id1335547405?l=ru"),
        ],
        "observations": ["Самая понятная ценность — ответ о доступном остатке и предстоящих платежах.", "Ручной ввод и недоверие к передаче финансовых данных создают сильное трение.", "Наличие сервисов учёта не доказывает спрос на отдельную платную ИИ-подписку."],
        "next_checks": ["Проверить, какие данные люди готовы ввести вручную и доверили бы ли они сервису банковские операции."],
        "base_scores": (6.7, 6.2, 5.5),
    },
    "weekend-trip": {
        "title": "Планировщик поездки на выходные",
        "short": "Маршрут рядом с домом под бюджет и интересы",
        "idea": "ИИ-планировщик поездки на выходные по России: пользователь указывает город отправления, даты, бюджет, состав компании и интересы, а сервис собирает маршрут с вариантами транспорта, мест и примерными расходами.",
        "audience": "Люди, пары и семьи, которые выбирают короткую поездку по России и хотят быстрее собрать выполнимый план.",
        "groups": [
            "Родитель маленького ребёнка",
            "Молодой специалист с плотным графиком",
            "Житель небольшого города с практичным подходом",
            "Самозанятый или независимый специалист",
            "Студент, совмещающий учёбу и подработку",
        ],
        "segments": {
            "Родитель маленького ребёнка": (7, 7, 6, "Семейный маршрут должен учитывать дорогу, время на отдых и места, куда удобно с ребёнком. Красивого списка достопримечательностей мало — важны расстояния и актуальные часы работы."),
            "Молодой специалист с плотным графиком": (6, 7, 6, "Хочется быстро выбраться из города без вечера за поиском вариантов. Я попробовал(а) бы готовый маршрут, если время в пути и цены не окажутся сюрпризом."),
            "Житель небольшого города с практичным подходом": (6, 6, 5, "Полезнее увидеть близкие направления и реальный транспорт, чем общие советы про популярные места. Не каждый маршрут должен начинаться с авиабилета или дорогого отеля."),
            "Самозанятый или независимый специалист": (6, 6, 5, "Поездку проще планировать под свободные даты и ограниченный бюджет. Сервис должен показать, какие части плана проверены, иначе всё равно придётся перепроверять вручную."),
            "Студент, совмещающий учёбу и подработку": (6, 6, 5, "Я бы искал(а) недорогой вариант на день или выходные с понятной стоимостью дороги. За один сгенерированный план отдельно платить вряд ли хочется."),
        },
        "findings": [
            ("Опрос Туту о поездках выходного дня описывает расходы россиян на короткие поездки; это подтверждает сценарий поездок, но не покупку ИИ-планировщика.", ["tutu-weekend"]),
            ("Яндекс Путешествия развивают отдельные подборки поездок на выходные — это подтверждает наличие сформированного пользовательского сценария и конкуренции.", ["yandex-weekend"]),
            ("Для полезного маршрута критична проверка актуальности транспорта, часов работы и цен; сам текстовый план не гарантирует выполнимость.", ["yandex-weekend", "tutu-weekend"]),
        ],
        "sources": [
            ("tutu-weekend", "travelvesti.ru", "Туту: сколько россияне тратят на поездки выходного дня", "https://travelvesti.ru/news/v-tutu-vyyasnili-skolko-rossiyane-tratyat-na-poezdki-vykhodnogo-dnya.html"),
            ("tutu-weekend-page", "tutu.ru", "Туту: поездки на выходные", "https://www.tutu.ru/weekend/"),
            ("tutu-rustore", "rustore.ru", "Туту — RuStore", "https://www.rustore.ru/catalog/app/ru.tutu.tutu_emp"),
            ("tutu-review-refunds", "otzovik.com", "Отзыв о возврате билетов Туту", "https://otzovik.com/review_18460800.html"),
            ("tutu-review-fees", "otzovik.com", "Отзыв о сборах и дополнительных услугах Туту", "https://www.otzovik.com/review_16301717.html"),
            ("yandex-weekend", "yandex.ru", "Яндекс Путешествия: поездки на выходные", "https://yandex.ru/company/news/01-22-07-2024"),
            ("yandex-help", "yandex.ru", "Справка Яндекс Путешествий: поездки на выходные", "https://yandex.ru/support/travel-app/ru/weekend"),
            ("rg-autotravel", "rg.ru", "Российская газета: интерес к автотуризму в России", "https://rg.ru/2023/09/19/nazvany-samye-privlekatelnye-napravleniia-dlia-avtoturizma-v-rossii.html"),
        ],
        "observations": ["Поездки — эмоционально понятный сценарий с наглядным результатом.", "Пользовательская ценность зависит от выполнимости и актуальности деталей маршрута.", "Расходы на поездки не подтверждают готовность платить за сам планировщик."],
        "next_checks": ["Проверить маршрут на одном регионе: сверить транспорт, расписание, часы работы и бюджет с актуальными данными."],
        "base_scores": (6.5, 6.4, 5.7),
    },
}


def _stable_number(seed: str, key: str) -> int:
    return int(hashlib.sha256(f"{seed}:{key}".encode("utf-8")).hexdigest()[:8], 16)


def _stable_spread(seed: int, channel: str, scale: float) -> float:
    digest = hashlib.sha256(f"{seed}:{channel}".encode("utf-8")).digest()
    # Summing independent uniform values gives a natural, centered spread instead of score bands.
    centered = sum(int.from_bytes(digest[offset:offset + 2], "big") / 65535 for offset in (0, 2, 4)) - 1.5
    return centered * scale


def get_prebuilt_scenario(scenario_id: str) -> dict[str, Any] | None:
    return SCENARIOS.get(scenario_id)


def get_demo_search_stats(scenario_id: str, run_id: int | None = None) -> dict[str, Any] | None:
    """Return per-run illustrative volume for the prebuilt scenario animation."""
    if scenario_id not in SCENARIOS:
        return None
    seed = _stable_number(scenario_id, f"exhibition-search-volume:{run_id or 0}")
    mentions = 60 + seed % 61
    review_share = 0.24 + ((seed >> 4) % 11) / 100
    community_share = 0.19 + ((seed >> 9) % 10) / 100
    reviews = round(mentions * review_share)
    communities = round(mentions * community_share)
    return {
        "kind": "illustrative_demo_volume",
        "mentions": mentions,
        "bundle_links": 50 + _stable_number(scenario_id, "curated-bundle-volume") % 11,
        "linked_findings": 40 + _stable_number(scenario_id, "linked-findings-volume") % 11,
        "categories": {
            "reviews": reviews,
            "communities": communities,
            "search_materials": mentions - reviews - communities,
        },
    }


def build_prebuilt_responses(scenario_id: str, members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Create stable profile-specific scenario reactions without external model calls."""
    scenario = SCENARIOS[scenario_id]
    responses: list[dict[str, Any]] = []
    for member in members:
        persona_id = str(member.get("id") or "")
        group = str(member.get("group") or "")
        profile = scenario["segments"].get(group)
        if not profile:
            continue
        problem, interest, willingness, reaction = profile
        traits = member.get("traits") if isinstance(member.get("traits"), dict) else {}
        behavior = traits.get("behavior") if isinstance(traits.get("behavior"), dict) else {}
        current = traits.get("current_behaviors") if isinstance(traits.get("current_behaviors"), list) else []
        index = _stable_number(scenario_id, persona_id)
        # Existing catalog traits shape the scenario response; no trait or biography is invented.
        price_sensitivity = int(behavior.get("price_sensitivity") or 3)
        digital_skill = int(behavior.get("digital_skill") or 3)
        # A continuous, stable spread avoids depicting the panel as equally enthusiastic or
        # drawing responses in visible horizontal/vertical bands.
        problem_score = round(max(1, min(10, problem + _stable_spread(index, "problem", 1.55))), 1)
        interest_score = round(max(1, min(10, interest + _stable_spread(index, "interest", 1.9) + (0.35 if digital_skill >= 4 else 0))), 1)
        # Trial intent is lower than interest: switching cost, price and trust matter even
        # when a person recognizes the problem or likes the idea.
        try_score = round(max(1, min(10, willingness - 1.05 + _stable_spread(index, "trial", 2.0) - (0.65 if price_sensitivity >= 4 else 0))), 1)
        context = str(current[index % len(current)]) if current else "" 
        reaction_text = reaction
        if context:
            reaction_text += f" В моём профиле также отмечено: {context}."
        if price_sensitivity >= 4:
            reaction_text += " При регулярной оплате сначала сравню цену с привычными альтернативами."
        if digital_skill <= 2:
            reaction_text += " Мне нужен простой первый запуск без сложных настроек."
        responses.append({
            "persona_id": persona_id,
            "group": group,
            "problem_relevance": problem_score,
            "problem_severity": max(1, min(10, problem_score - 1 + (index % 3))),
            "solution_clarity": max(1, min(10, interest_score + ((index // 11 % 3) - 1))),
            "interest": interest_score,
            "willingness_to_try": try_score,
            "reaction": reaction_text[:700],
            "motivators": [reaction.split(".")[0][:150]],
            "barriers": ["Доверие к точности и качеству результата", "Сравнение с привычными бесплатными альтернативами"],
        })
    return responses


def aggregate_prebuilt_responses(responses: list[dict[str, Any]], requested: int) -> dict[str, Any]:
    keys = ("problem_relevance", "interest", "willingness_to_try", "problem_severity", "solution_clarity")
    averages = {
        key: round(sum(float(item[key]) for item in responses if isinstance(item.get(key), (int, float))) / len(responses), 2)
        if responses else None
        for key in keys
    }
    positive = ("problem_relevance", "interest", "willingness_to_try")
    percentages = {
        key: round(sum(1 for item in responses if int(item.get(key) or 0) >= 7) / len(responses) * 100, 1)
        if responses else None
        for key in positive
    }
    return {
        "valid_responses": len(responses),
        "requested_responses": requested,
        "averages": averages,
        "percent_at_least_7": percentages,
        "denominators": {key: len(responses) for key in positive},
    }
