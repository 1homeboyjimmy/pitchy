from yandex_gpt_client import analyze_search_intent
from search_agent import execute_search_agent
import logging
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)

def test_router():
    print("=== Testing LLM Router ===")
    
    q1 = "Привет, помоги мне с идеей для стартапа."
    res1 = analyze_search_intent(q1)
    print(f"Query 1: '{q1}'")
    print(f"Result 1: {res1}\n") # Expected: needs_search = false

    q2 = "Каков объем рынка кофеен в Москве в 2026 году?"
    res2 = analyze_search_intent(q2)
    print(f"Query 2: '{q2}'")
    print(f"Result 2: {res2}\n") # Expected: needs_search = true
    
    if res2.get("needs_search") and res2.get("search_query"):
        print("=== Testing Search Agent Execution ===")
        context = execute_search_agent(res2.get("search_query"))
        print(f"Context length retrieved: {len(context)} characters.")
        print("Sample context:\n" + context[:500] + "...\n")

if __name__ == "__main__":
    test_router()
