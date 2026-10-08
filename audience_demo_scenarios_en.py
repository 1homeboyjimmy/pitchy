"""English-language copy for the curated audience-simulation scenarios."""
from __future__ import annotations

from typing import Any


GROUP_LABELS_EN = {
    "Активный специалист старшего возраста": "Active older professional",
    "Взрослый учащийся или человек, меняющий профессию": "Adult learner or career changer",
    "Владелец малого розничного бизнеса": "Small retail business owner",
    "Житель небольшого города с практичным подходом": "Practical resident of a smaller city",
    "ИТ-руководитель с ответственностью за безопасность": "IT manager responsible for security",
    "Менеджер продукта в технологической компании": "Product manager at a technology company",
    "Молодой специалист с плотным графиком": "Busy young professional",
    "Операционный руководитель среднего бизнеса": "Operations lead at a mid-sized business",
    "Опытный специалист, тщательно сравнивающий варианты": "Experienced professional who compares options carefully",
    "Пенсионер, уверенно решающий знакомые задачи онлайн": "Retiree comfortable with familiar online tasks",
    "Работник с физической или сменной занятостью": "Shift or manual worker",
    "Родитель маленького ребёнка": "Parent of a young child",
    "Руководитель отдела персонала": "HR manager",
    "Самозанятый или независимый специалист": "Self-employed or independent professional",
    "Самозанятый предприниматель": "Self-employed business owner",
    "Специалист по закупкам крупной организации": "Procurement specialist at a large organization",
    "Студент, совмещающий учёбу и подработку": "Student balancing studies and part-time work",
    "Финансовый руководитель малого или среднего бизнеса": "Finance lead at a small or mid-sized business",
    "Цифровой специалист на удалённой работе": "Remote digital professional",
    "Человек, планирующий семейные расходы": "Person managing household expenses",
}

SOURCE_TITLES_EN = {
    "food-wciom": "Russian Public Opinion Research Center: Eating habits",
    "food-app-study": "Study of a healthy-eating app (305 respondents)",
    "fatsecret-premium": "fatsecret Premium: food and portion photo logging",
    "fatsecret-store": "Calorie Counter by fatsecret — App Store",
    "fatsecret-reviews": "Reviews of the fatsecret calorie counter",
    "yazio-store": "YAZIO — App Store",
    "levada-languages": "Levada Center: Foreign languages, August 2023",
    "english-career": "Survey: how English affects career prospects",
    "praktika-store": "Praktika — App Store",
    "puzzle-english": "Puzzle English: plans and subscription",
    "englex-pricing": "Englex: English lesson prices",
    "language-app-survey": "Which language-learning apps are popular in Russia",
    "tbank-edtech-spend": "Online learning spending in Russia in 2025",
    "tbank-online-learning": "T-Business and T-Data: online learning payments in Russia",
    "duolingo-store": "Duolingo — Google Play",
    "apple-russia-billing": "Apple: paying for purchases and subscriptions in Russia",
    "nafi-budget": "NAFI: most people who keep a budget do it mentally",
    "nafi-literacy": "Financial literacy in Russia — 2024",
    "dzen-money": "Dzen-mani — App Store",
    "coinkeeper": "CoinKeeper",
    "coinkeeper-reviews": "CoinKeeper customer reviews",
    "budget-apps-review": "T–J: personal budgeting apps",
    "coinkeeper-store": "CoinKeeper — App Store",
    "tutu-weekend": "Tutu: spending on weekend trips",
    "tutu-weekend-page": "Tutu: weekend trips",
    "tutu-rustore": "Tutu — RuStore",
    "tutu-review-refunds": "Tutu review: ticket refunds",
    "tutu-review-fees": "Tutu review: fees and extra services",
    "yandex-weekend": "Yandex Travel: weekend trips",
    "yandex-help": "Yandex Travel Help: weekend trips",
    "rg-autotravel": "Rossiyskaya Gazeta: interest in road trips in Russia",
}


SCENARIOS_EN: dict[str, dict[str, Any]] = {
    "calorie-photo": {
        "title": "AI Photo Calorie Tracker",
        "short": "Log meals with a photo and estimate nutrition",
        "idea": "An AI meal tracker: users photograph a dish to estimate its ingredients, portion size, and calories, correct recognition errors, and keep a food diary.",
        "audience": "People who want to monitor their nutrition but find manual meal logging inconvenient.",
        "segments": {
            "Молодой специалист с плотным графиком": (7, 7, 6, "Between meetings, I do not have time to enter every ingredient. A photo could make logging quicker, but I would still want to check the portion and ingredients before saving."),
            "Работник с физической или сменной занятостью": (7, 6, 6, "Keeping a diary is hard with shift work. Quick logging would help if I did not have to do a lot of manual entry after a shift."),
            "Родитель маленького ребёнка": (7, 6, 5, "When I am cooking and eating on the go, detailed calorie counting gets tiring. Photos could make logging easier, but I would need to separate my portion from a family meal."),
            "Активный специалист старшего возраста": (6, 6, 5, "I would like to understand what I eat if the app explains its estimate clearly. I would need a way to correct inaccurate calorie counts."),
            "Студент, совмещающий учёбу и подработку": (6, 6, 5, "I do not want to spend time or money on a complicated food diary. I would try photo logging if the free version were useful and I could adjust the portion quickly."),
        },
        "findings": [
            ("In a survey on eating habits, 58% of respondents said they try to eat healthily, though they do not always manage to.", ["food-wciom"]),
            ("The Russian App Store listing for fatsecret promotes food tracking and photo-based food estimates; photo logging is already offered by competitors.", ["fatsecret-premium", "fatsecret-store"]),
            ("The research supports the relevance of nutrition as a topic, but does not measure demand for photo logging or willingness to pay for it.", ["food-wciom"]),
        ],
        "observations": [
            "The clearest benefit is saving time when logging meals.",
            "A photo cannot guarantee an accurate portion estimate, so users need a quick way to correct it.",
            "Interest in healthy eating does not prove demand for paid photo-based tracking.",
        ],
        "next_checks": ["Test recognition on home-cooked meals and find out how many corrections users will tolerate."],
    },
    "english-coach": {
        "title": "AI English Conversation Coach",
        "short": "Practise English for real work and everyday situations",
        "idea": "An AI English conversation coach: users choose their level and a situation, such as a work call or job interview, practise a dialogue, and get feedback on mistakes and more natural phrasing.",
        "audience": "Russian-speaking adults who want regular English speaking practice for work, study, or travel.",
        "segments": {
            "Взрослый учащийся или человек, меняющий профессию": (8, 7, 7, "I need practice for a specific goal, not another general course. It would help if the coach noticed recurring mistakes and brought them up in later conversations."),
            "Молодой специалист с плотным графиком": (7, 7, 6, "A short conversation before work is easier to fit into my day than a separate lesson. The feedback needs to be specific, not just a pronunciation score."),
            "Цифровой специалист на удалённой работе": (7, 7, 6, "Practising work calls and project discussions sounds useful. I would compare it with a general-purpose voice AI, so progress needs to be clear."),
            "Студент, совмещающий учёбу и подработку": (7, 6, 6, "Speaking practice is useful if I can do it anytime and make mistakes without feeling embarrassed. Price and access to basic exercises would matter to me."),
            "Опытный специалист, тщательно сравнивающий варианты": (6, 6, 5, "I would first check whether the corrections are accurate and suited to my level. A general assistant can already hold a conversation; the value needs to come from a method and visible progress."),
        },
        "findings": [
            ("A 2023 Levada Center survey found that 15% of respondents said they could communicate freely in English. This is self-reported, not a language test.", ["levada-languages"]),
            ("A 2022 survey of language-app users in Russia (n=1,000) describes the preferences of existing app users, not the whole population.", ["language-app-survey"]),
            ("Spending on online education shows that people pay for learning, but does not measure conversion to an AI speaking coach.", ["tbank-edtech-spend"]),
        ],
        "observations": [
            "Practice for a specific situation sets this idea apart from a standard set of lessons.",
            "The main risk is competition from general-purpose voice AI and established language platforms.",
            "The product needs measurable progress and trustworthy feedback, not just a voice interface.",
        ],
        "next_checks": ["Ask English learners which situations matter most: interviews, work calls, or everyday conversation."],
    },
    "family-budget": {
        "title": "Personal Budget Assistant",
        "short": "Plan everyday spending until the next payday",
        "idea": "An AI personal budget assistant: users enter their income and recurring bills or upload expenses. The service shows how much money remains until the next payday and helps create a realistic weekly plan.",
        "audience": "People and families who need to plan everyday spending and recurring bills.",
        "segments": {
            "Человек, планирующий семейные расходы": (8, 7, 6, "The most useful thing would be seeing what remains after bills and large purchases. It should account for shared family expenses, not just give generic advice to spend less."),
            "Студент, совмещающий учёбу и подработку": (7, 6, 5, "A plan for the time until my next payment could help me keep everyday spending under control. I would not enter every purchase by hand, so importing data or very quick entry would be essential."),
            "Самозанятый или независимый специалист": (8, 7, 6, "A standard monthly budget does not work well when income is irregular. I would care more about planning for a slow month and setting aside money for taxes and bills."),
            "Родитель маленького ребёнка": (7, 6, 5, "Family spending changes from month to month. An assistant could help if it quickly shows a safe balance, but I would not trust an unfamiliar service with my bank history right away."),
            "Житель небольшого города с практичным подходом": (6, 6, 5, "I need a clear answer without financial jargon. If I have to enter everything by hand or pay for another subscription, I would stick with notes or my bank app."),
        },
        "findings": [
            ("According to NAFI, most Russians who keep a personal or family budget do the calculations in their head.", ["nafi-budget"]),
            ("Financial literacy and everyday budgeting support the relevance of the problem, but do not show whether people will share bank data with a new service.", ["nafi-literacy"]),
            ("Russian expense-tracking apps show that the category exists; banking apps remain a direct free alternative.", ["dzen-money", "coinkeeper"]),
        ],
        "observations": [
            "The clearest value is quickly showing how much money remains after bills.",
            "Manual entry and concerns about sharing financial data can create significant friction.",
            "The existence of budgeting apps does not prove demand for a separate paid AI subscription.",
        ],
        "next_checks": ["Find out which data people are willing to enter manually and whether they would connect a service to their bank."],
    },
    "weekend-trip": {
        "title": "Weekend Trip Planner",
        "short": "Build a nearby route around budget and interests",
        "idea": "An AI weekend trip planner for travel in Russia: users enter their departure city, dates, budget, group size, and interests. The service creates an itinerary with transport, places to visit, and estimated costs.",
        "audience": "People, couples, and families planning a short trip in Russia who want to put together a practical itinerary faster.",
        "segments": {
            "Родитель маленького ребёнка": (7, 7, 6, "A family itinerary needs to account for travel time, breaks, and places that work with a child. A nice list of attractions is not enough; distances and current opening hours matter."),
            "Молодой специалист с плотным графиком": (6, 7, 6, "I would like to get out of the city without spending an evening searching for options. I would try a ready-made itinerary if travel times and prices were not a surprise."),
            "Житель небольшого города с практичным подходом": (6, 6, 5, "Nearby destinations and realistic transport would be more useful than general tips about popular places. Not every trip needs a flight or an expensive hotel."),
            "Самозанятый или независимый специалист": (6, 6, 5, "It is easier to plan a trip around open dates and a limited budget. The service should show which details have been checked; otherwise I would still verify everything myself."),
            "Студент, совмещающий учёбу и подработку": (6, 6, 5, "I would look for an affordable day trip or weekend away with a clear transport cost. I probably would not pay separately for a single generated itinerary."),
        },
        "findings": [
            ("A Tutu survey describes how Russians spend on short weekend trips. It supports the travel scenario, but not demand for an AI planner.", ["tutu-weekend"]),
            ("Yandex Travel has dedicated weekend-trip collections, showing that this is an established user scenario with existing competition.", ["yandex-weekend"]),
            ("A useful itinerary depends on up-to-date transport, opening hours, and prices; a text plan alone does not guarantee that a trip is practical.", ["yandex-weekend", "tutu-weekend"]),
        ],
        "observations": [
            "A short trip is an easy-to-understand scenario with a tangible outcome.",
            "The value depends on whether itinerary details are current and practical.",
            "Spending money on a trip does not prove willingness to pay for the planner itself.",
        ],
        "next_checks": ["Test one regional itinerary against current transport, schedules, opening hours, and prices."],
    },
}


REPORT_COPY_EN: dict[str, dict[str, Any]] = {
    "calorie-photo": {
        "insight_strength": "Fast meal logging is the clearest benefit. A photo and quick estimate can reduce manual entry, making this the easiest value to explain and test.",
        "insight_critical_note": "Wanting to eat more healthily does not prove demand for paid photo-based food tracking. People may use free apps, estimate portions themselves, or stop tracking after a few weeks. Photos reduce effort but do not create motivation on their own; users need a visible outcome, such as better nutrition habits or weight tracking.",
        "reference_scores": {"problem_relevance": 6.7, "interest": 6.2, "willingness_to_try": 4.8},
        "reference_percent_at_least_7": {"problem_relevance": 36, "interest": 30, "willingness_to_try": 11},
        "report_sections": [
            {"title": "The problem and how people see it", "paragraphs": [
                "Keeping a food diary can be tiring. Searching for dishes and entering ingredients takes time, which can lead people to stop tracking. Photo recognition could make logging easier.",
                "Accurately identifying ingredients and portion sizes remains a challenge. The original scenario mentions a 10–15% error range for complex dishes; this figure needs separate verification. If users have to spend a long time correcting a dish, the speed benefit disappears.",
            ]},
            {"title": "Competition", "paragraphs": [
                "The category already includes food trackers with photo recognition, such as MyFitnessPal, Cal AI, PlateLens, Nutrola, SnapCalorie, Foodvisor, Lose It!, Yazio, and FatSecret.",
                "Adding a photo feature is not enough to stand out. Users will compare accuracy, ease of correction, usefulness of guidance, and price.",
            ]},
            {"title": "Demand and payment", "paragraphs": [
                "Interest in healthy eating does not mean people will pay for a separate photo tracker. Many may stay on a free plan or stop using the app after a trial.",
                "The original ready-made scenario cites a 3–8% payment benchmark among app installers. This is an external estimate, not a result from this run, and should be checked against current data.",
                "Users need a meaningful outcome, not just a way to photograph meals. Test willingness to pay with a clear offer and price.",
            ]},
            {"title": "Risks", "items": [
                "People may be used to existing apps and reluctant to move their food diary.",
                "Recognition may fail on home-cooked or complex dishes, in poor light, or with mixed portions.",
                "Health data must be handled carefully, and the product should not promise medical outcomes.",
                "Not everyone wants to log food every day; some people prefer to change their diet without a diary.",
            ]},
            {"title": "Ways to improve the idea", "items": [
                "Make it possible to correct a dish or portion in one or two steps.",
                "Connect logging to a clear outcome, such as nutrition awareness, habits, or weight trends.",
                "Test specific groups, such as athletes, people using GLP-1 medication, families, and people with particular dietary needs.",
                "Offer a useful free plan and clearly explain what users get with a paid plan.",
            ]},
        ],
    },
    "english-coach": {
        "insight_strength": "Practice for a specific situation—such as a work call, interview, or trip—sets this idea apart from standard lessons. Users can practise what they are actually about to do.",
        "insight_critical_note": "Wanting to speak English better does not mean people will pay for another voice coach. General-purpose voice assistants already handle basic conversation practice. Without visible progress and useful feedback, the product may feel like just another chat.",
        "reference_scores": {"problem_relevance": 7.1, "interest": 6.6, "willingness_to_try": 4.8},
        "reference_percent_at_least_7": {"problem_relevance": 40, "interest": 32, "willingness_to_try": 13},
        "report_sections": [
            {"title": "The problem and how people see it", "paragraphs": [
                "Fear of speaking and a lack of practice can stop people from using words and grammar they already know. Rehearsing a specific situation—such as an interview, work call, or trip—may be more useful than a general lesson.",
                "Talking to software is no longer a unique feature. Users need to speak better in real situations and trust that practice is helping.",
                "Some people have tried language apps and stopped. A new product needs to show right away how it differs from familiar lessons and chat exercises.",
            ]},
            {"title": "Competition", "paragraphs": [
                "The category includes Speak, Duolingo, Loora, Praktika, ELSA Speak, Puzzle English, and other language services. Large platforms are also adding voice features.",
                "Conversation alone is not a strong differentiator. The product needs accurate feedback, visible progress, and scenarios that reflect users' real goals.",
            ]},
            {"title": "Demand and payment", "paragraphs": [
                "English matters for work and careers, but people may be less willing to pay for a voice assistant than for lessons with a teacher.",
                "Users will compare the service with free apps, general-purpose voice assistants, tutors, and language schools. The value needs to be demonstrated through learning outcomes.",
            ]},
            {"title": "Risks", "items": [
                "Strong competition from language platforms and general-purpose voice assistants.",
                "Progress can be hard to prove; if users do not notice improvement after a few sessions, interest may fade.",
                "Speech recognition and natural conversation need to work well.",
                "Irregular practice can make it hard to keep users engaged.",
            ]},
            {"title": "Ways to improve the idea", "items": [
                "Start with focused situations, such as interviews, work calls, or travel.",
                "Show what has improved, such as vocabulary, fluency, or recurring mistakes.",
                "Give short, practical suggestions with more natural ways to phrase things.",
                "Keep sessions short and regular so users can notice progress.",
            ]},
        ],
    },
    "family-budget": {
        "insight_strength": "The clearest benefit is quickly showing how much money remains after essential bills. This can reduce uncertainty and help people feel more in control.",
        "insight_critical_note": "Wanting better control over money does not mean people will pay for a separate assistant. Many calculate expenses mentally or use their bank app. Manual entry and sharing financial data may create strong resistance.",
        "reference_scores": {"problem_relevance": 7.3, "interest": 6.4, "willingness_to_try": 3.8},
        "reference_percent_at_least_7": {"problem_relevance": 32, "interest": 24, "willingness_to_try": 8},
        "report_sections": [
            {"title": "The problem and how people see it", "paragraphs": [
                "People at different income levels need to know what remains after essential bills. A quick estimate of the money available until the next payday could help.",
                "Many people already track spending mentally, in a spreadsheet, or in their banking app. A new service needs to earn trust before users share financial data.",
            ]},
            {"title": "Competition", "paragraphs": [
                "Users can already see spending and balances in banking apps such as Sber or T-Bank, or use dedicated trackers such as Dzen-mani and CoinKeeper.",
                "A separate assistant needs a clear advantage over checking a bank account—for example, a practical plan until the next payday instead of another list of expenses.",
            ]},
            {"title": "Demand and payment", "paragraphs": [
                "Budgeting may be especially useful to people who find everyday spending hard to predict. But willingness to pay for a separate subscription may be low when similar features are free elsewhere.",
                "Concerns about sharing income and expense data may also stop people from trying the product.",
            ]},
            {"title": "Risks", "items": [
                "Users may not trust a new service with income and expense details.",
                "Manual entry or connecting bank accounts may feel like too much work.",
                "People may prefer their banking app or their own way of tracking expenses.",
                "Users may not see enough value to justify paying.",
            ]},
            {"title": "Ways to improve the idea", "items": [
                "Answer “How much can I spend?” quickly, without a long setup.",
                "Let users start with simple manual entry, without connecting a bank account.",
                "Show clear figures: available balance, upcoming bills, and a weekly buffer.",
                "Test situations such as irregular income, family expenses, and making it to payday.",
                "Explain what data is needed, why it is needed, and how it is protected.",
            ]},
        ],
    },
    "weekend-trip": {
        "insight_strength": "A trip is an emotionally appealing idea with a tangible outcome. An itinerary tailored to budget, group, and interests can make people feel that the main choices are already taken care of.",
        "insight_critical_note": "Spending money on a trip does not prove willingness to pay for the planner itself. People may pay for transport, lodging, and food while putting the itinerary together themselves or using free tools. The plan is only useful if its details are accurate and practical.",
        "reference_scores": {"problem_relevance": 6.2, "interest": 6.3, "willingness_to_try": 3.8},
        "reference_percent_at_least_7": {"problem_relevance": 20, "interest": 23, "willingness_to_try": 7},
        "report_sections": [
            {"title": "The problem and how people see it", "paragraphs": [
                "Planning a weekend trip means comparing transport, places to stay, activities, and costs. An itinerary tailored to a specific situation could save time.",
                "People take short trips only a few times a year and often use maps, search, and reviews. A separate tool may feel optional, even when the idea sounds appealing.",
            ]},
            {"title": "Competition", "paragraphs": [
                "Ticket services, Yandex Travel, maps, travel guides, and general-purpose search assistants already compete for users' attention.",
                "An itinerary needs to use available transport and places. Out-of-date prices, schedules, or opening hours can quickly undermine trust.",
            ]},
            {"title": "Demand and payment", "paragraphs": [
                "People are interested in short trips, but they may not want to pay just to create an itinerary. Many expect to plan a route for free.",
                "A subscription may not fit a product people use only a few times a year. Booking fees or partner offers make sense only when the options are accurate and trustworthy.",
            ]},
            {"title": "Risks", "items": [
                "People may take only a few trips each year.",
                "The plan depends on current prices, schedules, and availability.",
                "Users may prefer finding options themselves in services they already know.",
                "There may be little reason to return after the first trip.",
                "Many basic planning tools are already free.",
            ]},
            {"title": "Ways to improve the idea", "items": [
                "Suggest practical routes with checked travel times and costs.",
                "Start with specific situations, such as travelling with children, as a couple, without a car, or on a limited budget.",
                "Suggest an alternative if a place is closed or transport is unavailable.",
                "Let users move from an itinerary to a real booking.",
                "Offer fewer verified options instead of a long list of uncertain suggestions.",
            ]},
        ],
    },
}
