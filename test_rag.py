
import os
import sys

# Add project root to path
sys.path.append(os.getcwd())

from rag import StartupRAG  # noqa: E402

def test_rag():
    print("Initializing RAG (may download model)...")
    rag = StartupRAG.build()
    print("RAG initialized.")
    
    query = "стартап"
    print(f"Querying: '{query}'")
    results = rag.query(query)
    print("Results:")

    for i, res in enumerate(results):
        print(f"{i+1}. {res[:100]}...")


if __name__ == "__main__":
    test_rag()
