
import os
import sys
import asyncio

# Add project root to path
sys.path.append(os.getcwd())

import rag

async def check_rag():
    print("Initializing RAG...")
    try:
        rag.init_rag()
        print("RAG initialized.")
    except Exception as e:
        print(f"RAG init failed: {e}")
        return

    queries = [
        "Роскомнадзор",
        "оператор персональных данных",
        "штрафы Роскомнадзор",
        "регистрация ООО документы"
    ]

    for query in queries:
        print(f"\n--- Querying: '{query}' ---")
        # Try different categories or general
        chunks = rag.get_relevant_chunks(query, categories=["legal_and_taxes", "general"], top_k=5)
        if not chunks:
            print("No chunks found.")
            continue
        
        for i, chunk in enumerate(chunks):
            print(f"Chunk {i+1}:")
            print(chunk[:500] + "..." if len(chunk) > 500 else chunk)
            print("-" * 20)

if __name__ == "__main__":
    asyncio.run(check_rag())
