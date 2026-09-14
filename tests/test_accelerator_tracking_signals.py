from types import SimpleNamespace

from accelerator_program_progress_service import stage_completion_policy
from accelerator_tracking_signals_service import signal_fingerprint


def test_signal_fingerprint_is_stable_and_source_specific():
    first = signal_fingerprint("homework_overdue", "homework", 42)

    assert first == signal_fingerprint("homework_overdue", "homework", 42)
    assert first != signal_fingerprint("homework_overdue", "homework", 43)
    assert first != signal_fingerprint("task_overdue", "homework", 42)
    assert len(first) == 64


def test_program_policy_has_safe_defaults_and_manual_confirmation():
    automatic = stage_completion_policy(SimpleNamespace(completion_policy={}))
    manual = stage_completion_policy(SimpleNamespace(completion_policy={"mode": "manual"}))

    assert automatic == {
        "mode": "auto",
        "materials": "all_required",
        "homework": "all_required",
        "pitchy_actions": "all_required",
        "attendance": "none",
        "manual_confirmation": False,
    }
    assert manual["manual_confirmation"] is True
