import roadmap_service


CORE = {
    "core": {
        "name": "Проект",
        "problem": "Команды теряют результаты экспериментов",
        "solution": "Единая карта прогресса",
        "target_audience": "Команды вузовских акселераторов",
    },
}


def test_saved_step_analysis_is_returned_with_checkpoint():
    roadmap = roadmap_service.build_roadmap({
        "legal": {"entity_type": "ООО"},
        "assets": {
            "roadmap_step_analyses": {
                "legal": {"text": "Юридический разбор", "generated_at": "2026-08-28"},
            },
        },
    })

    legal = next(checkpoint for checkpoint in roadmap["checkpoints"] if checkpoint["id"] == "legal")
    assert legal["analysis"]["text"] == "Юридический разбор"


def test_passport_edit_marks_reports_stale_and_preserves_history():
    passport = {
        "assets": {
            "deck_session_id": "deck-1",
            "roadmap_analysis": {"text": "Старый полный отчёт"},
            "roadmap_analysis_versions": [{"text": "Первая версия", "generated_at": "2026-01-01"}],
            "roadmap_step_analyses": {
                "idea": {"text": "Старый разбор идеи"},
                "legal": {"text": "Актуальный юридический разбор"},
            },
        },
    }

    updated = roadmap_service.invalidate_analyses(passport, {"core.problem"})

    assert updated["assets"]["roadmap_analysis"]["stale"] is True
    assert updated["assets"]["roadmap_analysis_versions"][0]["text"] == "Первая версия"
    assert updated["assets"]["roadmap_step_analyses"]["idea"]["stale"] is True
    assert updated["assets"]["roadmap_step_analyses"]["legal"].get("stale") is None
    assert updated["assets"]["deck_session_id"] == "deck-1"


def test_stage_transition_adds_questions_without_losing_answers():
    hypothesis = roadmap_service.build_roadmap({
        **CORE,
        "roadmap": {"stage": "hypothesis"},
        "metrics": {"mrr": 15000},  # future answer is preserved but not active yet
    })
    mvp = roadmap_service.build_roadmap({
        **CORE,
        "roadmap": {"stage": "mvp"},
        "metrics": {"mrr": 15000},
    })
    sales = roadmap_service.build_roadmap({
        **CORE,
        "roadmap": {"stage": "sales"},
        "metrics": {"mrr": 15000},
    })

    hypothesis_paths = {field["path"] for cp in hypothesis["checkpoints"] for field in cp["fields"]}
    mvp_paths = {field["path"] for cp in mvp["checkpoints"] for field in cp["fields"]}
    sales_fields = {field["path"]: field for cp in sales["checkpoints"] for field in cp["fields"]}

    assert "validation.prototype" not in hypothesis_paths
    assert "validation.prototype" in mvp_paths
    assert "metrics.mrr" not in mvp_paths
    assert sales_fields["metrics.mrr"]["value"] == 15000
    assert hypothesis["progress"] > mvp["progress"] > sales["progress"]


def test_analysis_is_available_on_first_stage_after_idea_core():
    roadmap = roadmap_service.build_roadmap({**CORE, "roadmap": {"stage": "hypothesis"}})

    assert roadmap["analysis_ready"] is True
    assert roadmap["analysis_missing"] == []
    assert roadmap["stage"]["id"] == "hypothesis"
    assert roadmap["stages"][1]["available"] is True
    assert roadmap["stages"][2]["available"] is False


def test_cac_and_arppu_are_calculated_only_from_explicit_inputs():
    derived = roadmap_service.derive_metrics({
        "metrics": {"mrr": 120000, "paying_customers": 12},
        "acquisition": {"spend_monthly": 30000, "new_paying_customers": 6},
    })

    assert derived["arppu"]["value"] == 10000
    assert derived["calculated_cac"]["value"] == 5000
    assert roadmap_service.derive_metrics({"metrics": {"mrr": 120000}}) == {}


def test_existing_projects_infer_maturity_until_user_selects_stage():
    assert roadmap_service.get_stage_id({"core": {"stage": "MVP+"}}) == "mvp"
    assert roadmap_service.get_stage_id({"metrics": {"mrr": 1}}) == "sales"
    assert roadmap_service.get_stage_id({"roadmap": {"stage": "hypothesis"}, "metrics": {"mrr": 1}}) == "hypothesis"
