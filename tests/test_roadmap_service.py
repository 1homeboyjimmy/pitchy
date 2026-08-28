import roadmap_service


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


def test_passport_edit_invalidates_overall_and_only_affected_step():
    passport = {
        "assets": {
            "deck_session_id": "deck-1",
            "roadmap_analysis": {"text": "Старый полный отчёт"},
            "roadmap_step_analyses": {
                "idea": {"text": "Старый разбор идеи"},
                "legal": {"text": "Актуальный юридический разбор"},
            },
        },
    }

    updated = roadmap_service.invalidate_analyses(passport, {"core.problem"})

    assert "roadmap_analysis" not in updated["assets"]
    assert "idea" not in updated["assets"]["roadmap_step_analyses"]
    assert updated["assets"]["roadmap_step_analyses"]["legal"]["text"] == "Актуальный юридический разбор"
    assert updated["assets"]["deck_session_id"] == "deck-1"
