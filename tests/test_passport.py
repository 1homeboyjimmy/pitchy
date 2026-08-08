import passport


def complete_required_passport() -> dict:
    return {
        "core": {
            "name": "Pitchy",
            "problem": "Подготовка стартапа занимает много времени",
            "solution": "Единый рабочий кабинет",
            "target_audience": "Ранние стартапы",
            "stage": "Прототип",
            "business_model": "Подписка",
            "geo": "Россия",
        },
        "market": {"size": "1 млрд ₽", "competitors": ["Конкурент"]},
        "metrics": {"mrr": "100 000 ₽", "users": "50"},
        "team": ["Анна — CEO"],
        "legal": {"entity_type": "ИП"},
    }


def test_custdev_is_not_part_of_the_passport_schema_or_readiness():
    project = complete_required_passport()
    before = passport.compute_readiness(project)

    project["custdev"] = {"personas": [], "interviews_done": ""}

    assert before == 100
    assert passport.compute_readiness(project) == 100
    assert passport.missing_sections(project) == []
    assert "CustDev" not in passport.missing_sections({})
    assert all(not field["path"].startswith("custdev.") for field in passport.PASSPORT_FIELDS)


def test_team_is_a_required_field_and_present_in_the_shared_contract():
    fields_by_path = {field["path"]: field for field in passport.PASSPORT_FIELDS}

    assert fields_by_path["team"]["required"] is True
    assert fields_by_path["team"]["list"] is True
    assert ("team", 2) in passport.KEY_FIELDS


def test_custom_fields_raise_readiness_but_cannot_replace_required_fields():
    project = {"core": {"name": "Pitchy"}}
    baseline = passport.compute_readiness(project)

    project["custom"] = {"traction_note": "Есть 20 заявок"}
    assert passport.compute_readiness(project) == baseline + passport.CUSTOM_FIELD_BONUS

    project["custom"].update({f"detail_{i}": f"Значение {i}" for i in range(10)})
    assert passport.compute_readiness(project) == min(
        100,
        baseline + passport.MAX_CUSTOM_FIELDS_FOR_READINESS * passport.CUSTOM_FIELD_BONUS,
    )


def test_manual_custom_field_is_saved_with_metadata():
    merged = passport.merge_patch({}, {"custom.first_pilot": "Подтверждён"})

    assert merged["custom"]["first_pilot"] == "Подтверждён"
    assert merged["_meta"]["custom.first_pilot"]["source"] == "manual"
    assert passport.compute_readiness(merged) == passport.CUSTOM_FIELD_BONUS


def test_readiness_contract_contains_every_editable_field():
    config = passport.readiness_config()
    fields_by_path = {field["path"]: field for field in config["fields"]}

    assert all(not path.startswith("custdev.") for path in fields_by_path)
    assert config["custom_field_bonus"] == passport.CUSTOM_FIELD_BONUS
