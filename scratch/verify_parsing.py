import asyncio
import json
import sys
import os

# Mock the pieces needed to test _parse_thought_generator
class MockGenerator:
    def __init__(self, chunks):
        self.chunks = chunks
    def __aiter__(self):
        return self
    async def __anext__(self):
        if not self.chunks:
            raise StopAsyncIteration
        return self.chunks.pop(0)

async def test_parsing():
    # Import the actual class
    sys.path.append(os.getcwd())
    from chat_orchestrator import ChatOrchestrator
    
    orch = ChatOrchestrator(tree_id=1, user_id=1, db_session=None)
    
    test_cases = [
        {
            "name": "Normal tags",
            "chunks": ["Hello world", "<think>", "my thoughts", "</think>", " final reply"],
            "expected_types": ["chunk", "thought", "chunk"]
        },
        {
            "name": "Split tags",
            "chunks": ["Hello", " <th", "ink>", "thou", "ghts ", "</th", "ink>", " bye"],
            "expected_types": ["chunk", "thought", "thought", "chunk"]
        },
        {
            "name": "No closing tag",
            "chunks": ["Start", " <think>", "thinking forever..."],
            "expected_types": ["chunk", "thought", "thought"]
        },
        {
            "name": "Nested-ish or multiple chunks",
            "chunks": ["P1", "<think>T1</think>", "P2", "<think>T2</think>", "P3"],
            "expected_types": ["chunk", "thought", "chunk", "thought", "chunk"]
        },
        {
            "name": "Makura dicts",
            "chunks": ["Regular text", {"__thinking__": "native thoughts"}, "more text", {"__usage__": {"tokens": 100}}],
            "expected_types": ["chunk", "thought", "chunk", "metadata"]
        }
    ]
    
    for tc in test_cases:
        print(f"--- Testing: {tc['name']} ---")
        generator = MockGenerator(tc["chunks"])
        results = []
        async for result in orch._parse_thought_generator(generator):
            data = json.loads(result)
            results.append(data)
            print(f"Parsed: {data['type']} | Content: {data.get('content', '')}")
            
        # Basic validation
        types = [r["type"] for r in results]
        if types == tc["expected_types"]:
            print(f"OK: types match")
        else:
            print(f"FAIL: Got {types}, expected {tc['expected_types']}")
        print()

    # Case 4: Malformed tag (open but not closed at end of stream)
    print("\n--- Test Case 4: Malformed tool_call (Unclosed) ---")
    async def malformed_gen():
        yield "<tool_call>"
        yield "Final answer text"
    
    results = []
    async for r in orch._parse_thought_generator(malformed_gen()):
        results.append(json.loads(r))
    
    for r in results:
        print(r)
    # Expected: {'type': 'chunk', 'content': 'Final answer text'} 
    # (since tool_call is leaked as fallback)

    # Case 5: Standard think (Unclosed)
    print("\n--- Test Case 5: Standard think (Unclosed) ---")
    async def think_unclosed_gen():
        yield "<think>"
        yield "Deep thinking..."
    
    results = []
    async for r in orch._parse_thought_generator(think_unclosed_gen()):
        results.append(json.loads(r))
    
    for r in results:
        print(r)
    # Expected: {'type': 'thought', 'content': 'Deep thinking...'}

if __name__ == "__main__":
    asyncio.run(test_parsing())
