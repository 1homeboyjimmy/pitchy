"""
Test script to verify RAG integration in ChatOrchestrator.
Tests that the orchestrator fetches relevant chunks and passes them to LLM prompts.
"""
import asyncio
import json
import logging
import os

# Load .env before anything else
from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO)

from unittest.mock import MagicMock, PropertyMock

import rag
from chat_orchestrator import ChatOrchestrator


def make_mock_db():
    """Create a mock DB session that returns proper values instead of MagicMock."""
    mock_db = MagicMock()
    # Make query().filter().first() return None (no tree in DB for test)
    mock_db.query.return_value.filter.return_value.first.return_value = None
    # Make query().filter().order_by().limit().all() return [] (no chat history)
    mock_db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
    return mock_db


async def test_rag_retrieval_only():
    """Test that RAG retrieval works correctly for legal queries."""
    print("\n" + "="*60)
    print("TEST 1: RAG Retrieval Only (no LLM calls)")
    print("="*60)
    
    print("Initializing RAG...")
    try:
        rag.init_rag()
    except Exception as e:
        print(f"RAG init failed: {e}")
        return False

    # Test legal query
    query = "Какие штрафы предусмотрены за отсутствие в реестре Роскомнадзора?"
    print(f"\nQuery: {query}")
    
    chunks = rag.get_relevant_chunks(query, categories=["legal_and_taxes"], top_k=3)
    print(f"\nRetrieved {len(chunks)} chunks:")
    
    found_rkn = False
    found_fine = False
    for i, chunk in enumerate(chunks):
        print(f"\n--- Chunk {i+1} (first 200 chars) ---")
        print(chunk[:200])
        if "Роскомнадзор" in chunk:
            found_rkn = True
        if "300 000" in chunk or "штраф" in chunk.lower():
            found_fine = True
    
    # Test LLC query
    query2 = "Какие документы нужны для регистрации ООО?"
    print(f"\n\nQuery 2: {query2}")
    
    chunks2 = rag.get_relevant_chunks(query2, categories=["legal_and_taxes"], top_k=3)
    print(f"Retrieved {len(chunks2)} chunks:")
    
    found_llc = False
    for i, chunk in enumerate(chunks2):
        print(f"\n--- Chunk {i+1} (first 200 chars) ---")
        print(chunk[:200])
        if "ООО" in chunk or "Устав" in chunk or "Р11001" in chunk:
            found_llc = True

    print("\n\n" + "="*60)
    print("RESULTS:")
    print(f"  RKN content found: {'✅' if found_rkn else '❌'}")
    print(f"  Fine info found:   {'✅' if found_fine else '❌'}")
    print(f"  LLC docs found:    {'✅' if found_llc else '❌'}")
    print("="*60)
    
    return found_rkn and found_llc


async def test_orchestrator_with_rag():
    """Test that ChatOrchestrator integrates RAG into its process_message flow."""
    print("\n" + "="*60)
    print("TEST 2: ChatOrchestrator + RAG (full pipeline)")
    print("="*60)
    
    mock_db = make_mock_db()
    orchestrator = ChatOrchestrator(tree_id=1, user_id=123, db_session=mock_db)
    
    user_message = "Какие штрафы предусмотрены за отсутствие в реестре Роскомнадзора?"
    print(f"Query: {user_message}\n")
    
    try:
        response_gen = orchestrator.process_message(
            user_message=user_message,
            active_node_id=None
        )
        
        full_reply = ""
        model_used = ""
        async for chunk_str in response_gen:
            try:
                data = json.loads(chunk_str.strip())
            except json.JSONDecodeError:
                continue
                
            if data.get("type") == "chunk":
                full_reply += data["content"]
                print(data["content"], end="", flush=True)
            elif data.get("type") == "metadata":
                model_used = data.get("model", "unknown")
            elif data.get("type") == "thought":
                pass  # skip thoughts in output
        
        print(f"\n\n[Model used: {model_used}]")
        
        print("\n" + "="*60)
        print("RESULTS:")
        has_rkn = "Роскомнадзор" in full_reply or "роскомнадзор" in full_reply.lower()
        has_law = "152" in full_reply or "персональн" in full_reply.lower()
        print(f"  Mentions Roskomnadzor: {'✅' if has_rkn else '❌'}")
        print(f"  Mentions 152-FZ/PD:    {'✅' if has_law else '❌'}")
        print(f"  Reply length:          {len(full_reply)} chars")
        print("="*60)
        
        return len(full_reply) > 0
        
    except Exception as e:
        print(f"\nError during orchestrator test: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    # Test 1: Pure RAG retrieval (no API keys needed)
    result1 = asyncio.run(test_rag_retrieval_only())
    
    # Test 2: Full orchestrator pipeline (needs API keys)
    has_api_keys = bool(os.getenv("MAKURA_API_KEY") or os.getenv("YC_API_KEY"))
    if has_api_keys:
        result2 = asyncio.run(test_orchestrator_with_rag())
    else:
        print("\n⚠️  Skipping orchestrator test (no MAKURA_API_KEY/YC_API_KEY in .env)")
        result2 = None
    
    print("\n\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"  RAG retrieval:     {'✅ PASS' if result1 else '❌ FAIL'}")
    if result2 is not None:
        print(f"  Orchestrator+RAG:  {'✅ PASS' if result2 else '❌ FAIL'}")
    else:
        print(f"  Orchestrator+RAG:  ⏭️  SKIPPED (no API keys)")
