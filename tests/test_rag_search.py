from unittest import mock
from fastapi.testclient import TestClient
import os
import pytest

# Ensure RAG_API_KEY is set for the test environment
os.environ["RAG_API_KEY"] = "test_token_123"

import main
from main import app

def test_rag_search_success():
    """Test successful RAG search with valid token."""
    mock_chunks = [
        {"text": "Результат 1", "metadata": {"collection": "general"}},
        {"text": "Результат 2", "metadata": {"collection": "general"}}
    ]
    with mock.patch("rag.get_relevant_chunks", return_value=mock_chunks):
        with TestClient(app) as client:
            headers = {"Authorization": "Bearer test_token_123"}
            response = client.post("/api/rag/search", json={"query": "как платить налоги?"}, headers=headers)
            
            assert response.status_code == 200
            assert response.json() == {"context": "Результат 1\n\nРезультат 2"}

def test_rag_search_invalid_token():
    """Test RAG search with incorrect token."""
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer wrong_token"}
        response = client.post("/api/rag/search", json={"query": "test"}, headers=headers)
        
        assert response.status_code == 401
        assert "Invalid or missing RAG API Key" in response.json()["detail"]

def test_rag_search_missing_token():
    """Test RAG search without authorization header."""
    with TestClient(app) as client:
        response = client.post("/api/rag/search", json={"query": "test"})
        
        # HTTPBearer returns 401 by default if missing
        assert response.status_code == 401

def test_rag_search_empty_query():
    """Test RAG search with empty query (should fail pydantic validation)."""
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer test_token_123"}
        response = client.post("/api/rag/search", json={"query": ""}, headers=headers)
        
        assert response.status_code == 422

def test_rag_search_error_handling():
    """Test RAG search when RAG service fails."""
    with mock.patch("rag.get_relevant_chunks", side_effect=Exception("DB Down")):
        with TestClient(app) as client:
            headers = {"Authorization": "Bearer test_token_123"}
            response = client.post("/api/rag/search", json={"query": "test"}, headers=headers)
            
            assert response.status_code == 200
            assert response.json() == {"context": ""}
