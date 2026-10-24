from types import SimpleNamespace

import pytest

from scripts.audit_mtusi_matchmaking import Audit, require_test_target


@pytest.mark.parametrize('cohort', [
    SimpleNamespace(id=5, accelerator_id=5, name='Акселератор МТУСИ.Бизнес 2026', status='draft'),
    SimpleNamespace(id=6, accelerator_id=5, name='Акселератор МТУСИ.Бизнес 2026', status='draft'),
    SimpleNamespace(id=6, accelerator_id=9, name='[!ТЕСТ!] МТУСИ', status='draft'),
    SimpleNamespace(id=6, accelerator_id=5, name='[!ТЕСТ!] МТУСИ', status='archived'),
    None,
])
def test_live_audit_refuses_any_target_except_existing_mutable_mtusi_test(cohort):
    accelerator = SimpleNamespace(id=5, name='Акселератор МТУСИ.Бизнес')
    with pytest.raises(ValueError, match='Refusing mutation'):
        require_test_target(cohort, accelerator)


def test_live_audit_allows_exact_named_test_cohort_and_rejects_shell_payload():
    accelerator = SimpleNamespace(id=5, name='Акселератор МТУСИ.Бизнес')
    cohort = SimpleNamespace(id=6, accelerator_id=5, name='[!ТЕСТ!] Акселератор МТУСИ.Бизнес 2026', status='draft')
    require_test_target(cohort, accelerator)
    with pytest.raises(ValueError, match='Invalid batch key'):
        Audit('batch;invalid', 10)
