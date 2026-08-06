"""Эвристики режима основного чата (справка / консультация / разбор).

Классификатор режима — это SLM-вызов, но поверх него работают чистые
эвристики: они страхуют, когда SLM недоступен, и перекрывают его на двух
однозначных классах запросов. Тестируем именно их — без сети.
"""

import pytest

from slm_dispatcher import (
    CHAT_MODE_CONSULT,
    CHAT_MODE_FACT,
    CHAT_MODE_REVIEW,
    resolve_chat_mode,
)


@pytest.mark.parametrize("query", [
    "сколько сейчас мсп в рф",
    "Сколько МСП в России в 2026 году?",
    "что такое CAC",
    "какие есть гранты для IT-компаний",
    "какой объём рынка EdTech в России",
    "перечисли основные налоговые режимы для ИП",
])
def test_reference_questions_are_fact(query):
    """Справочный вопрос не должен уходить в разбор проекта — это и был баг:
    на «сколько сейчас МСП в РФ» чат отвечал «мне мало данных»."""
    assert resolve_chat_mode(query) == CHAT_MODE_FACT


@pytest.mark.parametrize("query", [
    "оцени мою идею",
    "разбери нашу юнит-экономику",
    "проанализируй мой стартап",
    "что думаешь о моём проекте?",
    "найди слабые места в нашей бизнес-модели",
])
def test_project_review_requests(query):
    assert resolve_chat_mode(query) == CHAT_MODE_REVIEW


def test_review_verb_with_attachment_without_pronoun():
    """«Разбери» + приложенный файл — тоже разбор, даже без «мой/наш»."""
    assert resolve_chat_mode("разбери это", has_attachments=True) == CHAT_MODE_REVIEW
    # Без вложения и без упоминания своего проекта — не разбор.
    assert resolve_chat_mode("разбери это") != CHAT_MODE_REVIEW


@pytest.mark.parametrize("query", [
    "как привлечь первых пользователей",
    "какой канал продвижения выбрать для B2B SaaS",
    "стоит ли поднимать раунд на этой стадии",
])
def test_advice_questions_default_to_consult(query):
    assert resolve_chat_mode(query) == CHAT_MODE_CONSULT


def test_fact_heuristic_overrides_wrong_slm_answer():
    """Ошибка SLM на явно справочном вопросе не должна тащить в разбор."""
    assert resolve_chat_mode("сколько сейчас мсп в рф", slm_mode="review") == CHAT_MODE_FACT


def test_slm_answer_used_when_heuristics_are_silent():
    assert resolve_chat_mode("а с деньгами что", slm_mode="review") == CHAT_MODE_REVIEW
    assert resolve_chat_mode("а с деньгами что", slm_mode="fact") == CHAT_MODE_FACT


@pytest.mark.parametrize("slm_mode", [None, "", "garbage", 42])
def test_fallback_is_consult_when_slm_unusable(slm_mode):
    """Дефолт — консультация: она ничего не требует от пользователя и не
    навязывает оценочную рамку."""
    assert resolve_chat_mode("а с деньгами что", slm_mode=slm_mode) == CHAT_MODE_CONSULT


def test_empty_query_does_not_crash():
    assert resolve_chat_mode("") == CHAT_MODE_CONSULT
    assert resolve_chat_mode(None) == CHAT_MODE_CONSULT


def test_own_project_question_with_skolko_is_not_fact():
    """«Сколько мне нужно…» — вопрос о собственном бизнесе, не справка."""
    assert resolve_chat_mode("сколько клиентов нужно моему проекту для выхода в ноль") != CHAT_MODE_FACT
