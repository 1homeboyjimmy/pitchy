from typing import Any

CORE_SKELETON: list[dict[str, Any]] = [
    {
        "id": "project_description",
        "type": "core",
        "status": "empty",
        "label": "Описание проекта",
        "level": 1,
        "parent_id": "root",
        "required": True,
        "priority": 1,
        "impact_score": 0.8,
        "data": {
            "description": "Что это за проект, какую ценность он несет и в чем его суть.",
            "completion_criteria": {
                "concept": "Определен",
                "goal": "Определена"
            },
            "inputs": [
                {
                    "field": "concept",
                    "label": "Суть проекта",
                    "type": "text",
                    "placeholder": "Uber для выгула собак",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "business_type",
                    "label": "Тип бизнеса",
                    "type": "select",
                    "options": ["B2B SaaS", "Mobile App", "E-commerce", "Offline", "Hardware", "Marketplace", "Other"],
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Определить целевую аудиторию",
                "target_block": "target_audience",
                "reason": "Для описанной идеи нужно понять, кто за это будет платить."
            },
            "chat_hint": "Расскажите в 1-2 предложениях: что вы делаете и для чего?",
            "dependencies": []
        }
    },
    {
        "id": "target_audience",
        "type": "core",
        "status": "empty",
        "label": "Целевая аудитория",
        "level": 2,
        "parent_id": "project_description",
        "required": True,
        "priority": 2,
        "impact_score": 0.9,
        "data": {
            "description": "Кто ваш основной клиент и почему именно он",
            "completion_criteria": {
                "client_type": "Определен",
                "geo": "Определена",
                "segment_size": "Оценен"
            },
            "inputs": [
                {
                    "field": "client_type",
                    "label": "Тип клиента",
                    "type": "select",
                    "options": ["B2C", "B2B", "B2G"],
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "geo",
                    "label": "География",
                    "type": "text",
                    "placeholder": "Москва, Россия",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "segment_size",
                    "label": "Размер сегмента",
                    "type": "number",
                    "placeholder": "Сколько таких клиентов?",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Сформулировать проблему клиента",
                "target_block": "customer_problem",
                "reason": "Теперь, когда мы знаем клиента, нужно понять его главную боль."
            },
            "chat_hint": "Расскажите подробнее про вашего клиента. Кто он, где живет, какую аудиторию охватываете?",
            "dependencies": ["project_description"]
        }
    },
    {
        "id": "customer_problem",
        "type": "core",
        "status": "empty",
        "label": "Проблема клиента",
        "level": 2,
        "parent_id": "target_audience",
        "required": True,
        "priority": 3,
        "impact_score": 0.8,
        "data": {
            "description": "Какую боль или потребность закрывает проект",
            "completion_criteria": {
                "pain_point": "Описана",
                "current_solution": "Изучено"
            },
            "inputs": [
                {
                    "field": "pain_point",
                    "label": "Основная боль",
                    "type": "text",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "current_solution",
                    "label": "Как решают сейчас",
                    "type": "text",
                    "required": False,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Описать предлагаемое решение",
                "target_block": "product_solution",
                "reason": "Проблема ясна, теперь покажите, почему ваш продукт её решает лучше."
            },
            "chat_hint": "Какую проблему вы решаете? Почему клиентам сейчас больно или неудобно?",
            "dependencies": ["target_audience"]
        }
    },
    {
        "id": "product_solution",
        "type": "core",
        "status": "empty",
        "label": "Продукт/Решение",
        "level": 2,
        "parent_id": "customer_problem",
        "required": True,
        "priority": 4,
        "impact_score": 0.9,
        "data": {
            "description": "Что именно вы предлагаете как продукт или услугу",
            "completion_criteria": {
                "features": "Перечислены",
                "value_proposition": "Сформулировано"
            },
            "inputs": [
                {
                    "field": "value_proposition",
                    "label": "Уникальная ценность (UVP)",
                    "type": "text",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "key_features",
                    "label": "Ключевые фичи",
                    "type": "text",
                    "placeholder": "Максимум 3 главные функции",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Проанализировать конкурентов",
                "target_block": "competitors",
                "reason": "Решение описано, нужно проверить наличие аналогов."
            },
            "chat_hint": "В чем главная фишка продукта? Чем он круче текущих альтернатив?",
            "dependencies": ["customer_problem"]
        }
    },
    {
        "id": "competitors",
        "type": "core",
        "status": "empty",
        "label": "Конкуренты",
        "level": 2,
        "parent_id": "product_solution",
        "required": True,
        "priority": 5,
        "impact_score": 0.6,
        "data": {
            "description": "Прямые и косвенные конкуренты, аналоги на рынке",
            "completion_criteria": {
                "competitors_list": "Составлен",
                "advantages": "Определены"
            },
            "inputs": [
                {
                    "field": "competitor_names",
                    "label": "Главные конкуренты",
                    "type": "text",
                    "placeholder": "Кто уже делает что-то подобное?",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "competitive_advantage",
                    "label": "Наше преимущество",
                    "type": "text",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Оценить объем рынка",
                "target_block": "market_size",
                "reason": "Конкуренция понятна, теперь оценим, сколько там денег."
            },
            "chat_hint": "Кого вы считаете главным конкурентом? В чем вы лучше?",
            "dependencies": ["product_solution"]
        }
    },
    {
        "id": "market_size",
        "type": "core",
        "status": "empty",
        "label": "Размер рынка",
        "level": 1,
        "parent_id": "root",
        "required": True,
        "priority": 6,
        "impact_score": 0.7,
        "data": {
            "description": "Объем рынка: TAM, SAM, SOM",
            "completion_criteria": {
                "tam": "Рассчитан",
                "som": "Рассчитан"
            },
            "inputs": [
                {
                    "field": "tam",
                    "label": "Общий рынок (TAM)",
                    "type": "number",
                    "placeholder": "В долларах или локальной валюте",
                    "required": False,
                    "status": "empty"
                },
                {
                    "field": "som",
                    "label": "Достижимый рынок (SOM)",
                    "type": "number",
                    "placeholder": "Сколько можете забрать?",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Описать бизнес-модель",
                "target_block": "monetization",
                "reason": "Рынок оценен, теперь определим как мы на нем зарабатываем."
            },
            "chat_hint": "Как вы оцениваете размер рынка, на который выходите?",
            "dependencies": []
        }
    },
    {
        "id": "monetization",
        "type": "core",
        "status": "empty",
        "label": "Монетизация",
        "level": 2,
        "parent_id": "market_size",
        "required": True,
        "priority": 7,
        "impact_score": 0.9,
        "data": {
            "description": "Бизнес-модель: как компания зарабатывает",
            "completion_criteria": {
                "model_type": "Выбран",
                "price": "Установлена"
            },
            "inputs": [
                {
                    "field": "revenue_model",
                    "label": "Модель дохода",
                    "type": "select",
                    "options": ["Подписка (SaaS)", "Транзакционная (Комиссия)", "Разовая продажа", "Рекламная", "Freemium", "Другое"],
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "avg_check",
                    "label": "Средний чек (ARPU)",
                    "type": "number",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Посчитать Юнит-экономику",
                "target_block": "unit_economics",
                "reason": "Цены заданы, нужно свести экономику одного клиента."
            },
            "chat_hint": "За что и сколько будет платить ваш клиент?",
            "dependencies": ["market_size"]
        }
    },
    {
        "id": "unit_economics",
        "type": "core",
        "status": "empty",
        "label": "Юнит-экономика",
        "level": 2,
        "parent_id": "monetization",
        "required": True,
        "priority": 8,
        "impact_score": 0.8,
        "data": {
            "description": "Сходится ли LTV и CAC (Lifetime Value > Customer Acquisition Cost)",
            "completion_criteria": {
                "cac": "Известен",
                "ltv": "Спрогнозирован",
                "margin": "Сходится"
            },
            "inputs": [
                {
                    "field": "cac",
                    "label": "Стоимость привлечения (CAC)",
                    "type": "number",
                    "required": False,
                    "status": "empty"
                },
                {
                    "field": "ltv",
                    "label": "Пожизненная ценность (LTV)",
                    "type": "number",
                    "required": False,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Определить каналы",
                "target_block": "acquisition_channels",
                "reason": "Для улучшения экономики нужно проработать каналы."
            },
            "chat_hint": "Считали ли вы юнит-экономику? Во сколько обходится привлечение 1 клиента?",
            "dependencies": ["monetization"]
        }
    },
    {
        "id": "acquisition_channels",
        "type": "core",
        "status": "empty",
        "label": "Каналы привлечения",
        "level": 2,
        "parent_id": "customer_problem",
        "required": True,
        "priority": 9,
        "impact_score": 0.7,
        "data": {
            "description": "Как клиенты узнают о продукте (Go-To-Market)",
            "completion_criteria": {
                "main_channel": "Выбран",
                "test_budget": "Заложен"
            },
            "inputs": [
                {
                    "field": "primary_channel",
                    "label": "Основной канал",
                    "type": "text",
                    "placeholder": "Например: SEO, Ads, Прямые продажи",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "secondary_channels",
                    "label": "Доп. каналы",
                    "type": "text",
                    "required": False,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Зафиксировать команду",
                "target_block": "team",
                "reason": "Каналы ясны, теперь нужно собрать людей для реализации."
            },
            "chat_hint": "Откуда к вам сейчас приходят клиенты или как вы планируете их искать?",
            "dependencies": ["target_audience", "unit_economics"]
        }
    },
    {
        "id": "team",
        "type": "core",
        "status": "empty",
        "label": "Команда",
        "level": 1,
        "parent_id": "root",
        "required": True,
        "priority": 10,
        "impact_score": 0.6,
        "data": {
            "description": "Основатели, ключевой состав и недостающие роли",
            "completion_criteria": {
                "founders": "Найдены",
                "key_roles": "Закрыты"
            },
            "inputs": [
                {
                    "field": "team_size",
                    "label": "Размер команды",
                    "type": "number",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "missing_roles",
                    "label": "Кого не хватает?",
                    "type": "text",
                    "placeholder": "Например: CTO, Маркетолог",
                    "required": False,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Оценить готовность",
                "target_block": "mvp_stage",
                "reason": "Команда собрана, нужно понять, на каком этапе разработка."
            },
            "chat_hint": "Кто сейчас в команде? Кого не хватает для работы?",
            "dependencies": []
        }
    },
    {
        "id": "mvp_stage",
        "type": "core",
        "status": "empty",
        "label": "MVP/Стадия готовности",
        "level": 2,
        "parent_id": "team",
        "required": True,
        "priority": 11,
        "impact_score": 0.8,
        "data": {
            "description": "Что уже сделано и какие метрики есть сейчас",
            "completion_criteria": {
                "current_status": "Определен",
                "traction": "Зафиксирован"
            },
            "inputs": [
                {
                    "field": "traction",
                    "label": "Текущий трекшн",
                    "type": "text",
                    "placeholder": "Например: 100 юзеров, $1k MRR",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "mvp_ready",
                    "label": "MVP готов?",
                    "type": "select",
                    "options": ["Да", "В разработке", "Нет (только идея)"],
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Проработать риски",
                "target_block": "risks",
                "reason": "Продукт создается, самое время оценить угрозы."
            },
            "chat_hint": "На какой стадии вы сейчас находитесь? Есть ли первые клиенты или прибыль?",
            "dependencies": ["product_solution"]
        }
    },
    {
        "id": "risks",
        "type": "core",
        "status": "empty",
        "label": "Риски проекта",
        "level": 2,
        "parent_id": "mvp_stage",
        "required": True,
        "priority": 12,
        "impact_score": 0.5,
        "data": {
            "description": "Ключевые угрозы и пути их минимизации",
            "completion_criteria": {
                "top_risk": "Найден",
                "mitigation": "Продуман"
            },
            "inputs": [
                {
                    "field": "top_risk",
                    "label": "Главный риск",
                    "type": "text",
                    "placeholder": "Что может убить стартап?",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "mitigation_plan",
                    "label": "План Б",
                    "type": "text",
                    "required": False,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": {
                "title": "Определить следующие шаги",
                "target_block": "next_steps",
                "reason": "Риски задокументированы, нужно составить roadmap."
            },
            "chat_hint": "Чего вы больше всего опасаетесь? Что может пойти не так?",
            "dependencies": []
        }
    },
    {
        "id": "next_steps",
        "type": "core",
        "status": "empty",
        "label": "Следующие шаги",
        "level": 1,
        "parent_id": "root",
        "required": True,
        "priority": 13,
        "impact_score": 0.5,
        "data": {
            "description": "Ближайшие майлстоуны и цели на 3-6 месяцев",
            "completion_criteria": {
                "short_term_goal": "Сформулирована",
                "resources_needed": "Оценены"
            },
            "inputs": [
                {
                    "field": "short_term_goal",
                    "label": "Ближайшая цель (3 мес)",
                    "type": "text",
                    "required": True,
                    "status": "empty"
                },
                {
                    "field": "resources_needed",
                    "label": "Что для этого нужно?",
                    "type": "text",
                    "placeholder": "Деньги, люди, время",
                    "required": True,
                    "status": "empty"
                }
            ],
            "outputs": {},
            "next_action": None,
            "chat_hint": "Какая у вас главная цель на ближайшие 3 месяца и что мешает её достичь прямо сейчас?",
            "dependencies": ["mvp_stage"]
        }
    }
]
UNIVERSAL_BASE_NODES: list[dict[str, Any]] = [
    {
        "id": "problem",
        "type": "customAnalysis",
        "status": "active",
        "label": "Проблема клиента",
        "level": 1,
        "parent_id": "root",
        "data": {
            "label": "Проблема клиента",
            "description": "Какую именно боль или потребность закрывает ваш проект?",
            "form_schema": [
                {
                    "id": "pain",
                    "label": "В чем заключается главная боль?",
                    "placeholder": "Например: Компании теряют время на ручной ввод данных...",
                    "type": "textarea"
                },
                {
                    "id": "impact",
                    "label": "Насколько это критично для клиента?",
                    "placeholder": "Например: Это стоит им $2000 в месяц на одного сотрудника...",
                    "type": "textarea"
                }
            ]
        }
    },
    {
        "id": "solution",
        "type": "customAnalysis",
        "status": "active",
        "label": "Решение / Продукт",
        "level": 1,
        "parent_id": "root",
        "data": {
            "label": "Решение / Продукт",
            "description": "Что вы предлагаете рынку?",
            "form_schema": [
                {
                    "id": "product_concept",
                    "label": "Суть вашего решения",
                    "placeholder": "Например: AI-ассистент, который автоматизирует перенос данных...",
                    "type": "textarea"
                },
                {
                    "id": "uvp",
                    "label": "В чем уникальность (UVP)?",
                    "placeholder": "Например: Мы работаем в 10 раз быстрее существующих API...",
                    "type": "textarea"
                }
            ]
        }
    },
    {
        "id": "audience",
        "type": "customAnalysis",
        "status": "active",
        "label": "Целевая аудитория",
        "level": 1,
        "parent_id": "root",
        "data": {
            "label": "Целевая аудитория",
            "description": "Кто ваши идеальные клиенты?",
            "form_schema": [
                {
                    "id": "segments",
                    "label": "Кто ваш идеальный клиент?",
                    "placeholder": "Например: B2B SaaS компании от 50 человек...",
                    "type": "textarea"
                },
                {
                    "id": "pain_points",
                    "label": "Почему они купят именно у вас?",
                    "placeholder": "Например: Они ищут способы сократить расходы на операционку...",
                    "type": "textarea"
                }
            ]
        }
    }
]
