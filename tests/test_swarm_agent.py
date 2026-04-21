import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from pydantic import ValidationError

from swarm_agent import ChunkAnalysis, run_analytical_swarm, _process_single_chunk

@pytest.fixture
def mock_chunks():
    return [
        "Цены у конкурента Skyeng начинаются от 1500 рублей за урок.",
        "Сегодня хорошая погода, мы пошли гулять.",
        "Рынок EdTech в 2023 году вырос на 20% по данным РБК."
    ]

@pytest.mark.asyncio
async def test_chunk_analysis_schema_validation():
    """Проверка, что Pydantic схема корректно валидирует данные."""
    valid_data = ChunkAnalysis(
        is_relevant=True,
        competitors=["Skyeng"],
        metrics=["1500 рублей"],
        confidence=0.9
    )
    assert valid_data.is_relevant is True
    
    with pytest.raises(ValidationError):
        ChunkAnalysis(is_relevant=True, confidence=1.5)

@pytest.mark.asyncio
@patch("swarm_agent.get_patched_client")
async def test_swarm_parallel_execution(mock_get_client, mock_chunks):
    """
    Проверка Map-фазы роя: агенты должны извлечь данные, 
    отфильтровать мусор и вернуть только релевантные факты.
    """
    mock_client = AsyncMock()
    mock_get_client.return_value = mock_client
    
    mock_client.chat.completions.create.side_effect = [
        ChunkAnalysis(is_relevant=True, competitors=["Skyeng"], metrics=["1500 руб"], confidence=0.95),
        ChunkAnalysis(is_relevant=False, competitors=[], metrics=[], confidence=0.1),
        ChunkAnalysis(is_relevant=True, competitors=[], metrics=["рост на 20%"], confidence=0.85)
    ]
    
    results = await run_analytical_swarm(mock_chunks)
    
    assert mock_client.chat.completions.create.call_count == 3
    assert len(results) == 2 
    assert results[0].competitors == ["Skyeng"]
    assert results[1].metrics == ["рост на 20%"]

@pytest.mark.asyncio
@patch("swarm_agent.get_patched_client")
async def test_swarm_fault_tolerance(mock_get_client):
    """
    Проверка отказоустойчивости: если один запрос отвалился, остальной рой продолжает работу.
    """
    mock_client = AsyncMock()
    mock_get_client.return_value = mock_client
    
    mock_client.chat.completions.create.side_effect = [
        Exception("RouterAI 502 Bad Gateway"),
        ChunkAnalysis(is_relevant=True, competitors=["Skillbox"], metrics=["500k ARR"], confidence=0.9)
    ]
    
    chunks = ["Чанк с ошибкой", "Нормальный чанк"]
    results = await run_analytical_swarm(chunks)
    
    assert len(results) == 1
    assert results[0].competitors == ["Skillbox"]
