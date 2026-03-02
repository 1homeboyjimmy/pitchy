import asyncio
from search_agent import execute_search_agent

def main():
    query = "гранты ит стартап 2026 для студентов"
    print(f"Executing search for: {query}")
    result = execute_search_agent(query)
    with open("test_search_output.txt", "w", encoding="utf-8") as f:
        f.write(result)
    print(f"Total length written to test_search_output.txt: {len(result)}")

if __name__ == "__main__":
    main()
