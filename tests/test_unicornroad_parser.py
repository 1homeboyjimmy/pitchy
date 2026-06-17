from unicornroad_parser import _enrich_from_post, _merge_source_details, _post_to_draft


def test_event_post_keeps_structure_and_external_link():
    post = {
        "url": "https://unicornroad.ru/event/online/tpost/abc-example",
        "text": """
            <div>
              Дата: 22 июня 2026 года 11:00<br><br>
              Место проведения: Онлайн<br><br>
              Вебинар посвящён финансовым механизмам взаимодействия.<br><br>
              Ключевые тезисы:<br>
              - Escrow-счета в Турции<br>
              - Валютные операции и снижение комиссий<br><br>
              Спикер:<br>
              Даниэла Эдис — амбассадор МЭЦ в Турции<br><br>
              Регистрация по <a href="https://example.org/register">ссылке</a>
            </div>
        """,
    }

    result = _enrich_from_post(post, "#Онлайн,Международные рынки")

    assert result["location"] == "Онлайн"
    assert result["event_format"] == "online"
    assert result["source_url"] == "https://example.org/register"
    assert result["registration_url"] == "https://example.org/register"
    assert result["event_details"]["agenda"] == [
        "Escrow-счета в Турции",
        "Валютные операции и снижение комиссий",
    ]
    assert result["event_details"]["speakers"][0]["name"] == "Даниэла Эдис"
    assert "финансовым механизмам" in result["description"]
    assert "Спикер" not in result["description"]


def test_source_enrichment_only_fills_gaps():
    base = {
        "description": "Точное описание агрегатора",
        "location": "Онлайн",
        "event_format": "online",
        "event_details": {"agenda": [], "speakers": [], "participation_terms": None},
    }
    source = {
        "description": "Другое описание",
        "location": "Москва",
        "agenda": ["Первый тезис"],
        "speakers": [{"name": "Иван Иванов"}],
        "participation_terms": "Бесплатно, по регистрации",
        "organization": "Организатор",
    }

    merged = _merge_source_details(base, source)

    assert merged["description"] == "Точное описание агрегатора"
    assert merged["location"] == "Онлайн"
    assert merged["organization"] == "Организатор"
    assert merged["event_details"]["agenda"] == ["Первый тезис"]
    assert merged["event_details"]["participation_terms"] == "Бесплатно, по регистрации"


def test_draft_keeps_discovery_url_separate_from_public_source():
    post = {
        "title": "Тестовое мероприятие",
        "url": "https://unicornroad.ru/event/tpost/test",
        "date": "2026-06-22 11:00",
        "parts": "#Онлайн,Финансы",
    }
    enrichment = {
        "source_url": "https://source.example/event",
        "registration_url": "https://source.example/register",
        "location": "Онлайн",
        "event_format": "online",
        "description": "Полное описание",
        "event_details": {"agenda": ["Тезис"], "speakers": []},
    }

    draft = _post_to_draft(post, "event", enrichment)

    assert draft["url"] == post["url"]
    assert draft["source_url"] == "https://source.example/event"
    assert draft["registration_url"] == "https://source.example/register"
    assert draft["deadline"].hour == 11
