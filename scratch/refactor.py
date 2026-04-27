import re

with open('chat_orchestrator.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add _format_sse
if 'def _format_sse' not in content:
    content = content.replace(
        'class ChatOrchestrator:\n',
        'class ChatOrchestrator:\n    def _format_sse(self, data_dict: dict) -> str:\n        return f"data: {json.dumps(data_dict, ensure_ascii=False)}\\n\\n"\n\n'
    )

# Replace single-line yield json.dumps(...) + "\n"
content = re.sub(r'yield json\.dumps\((.*?)\) \+ "\\n"', r'yield self._format_sse(\1)', content)

# There is a multi-line yield json.dumps(...) + "\n" around line 859:
# yield json.dumps({
#     "type": "sources",
#     "data": state.get("sources", [])
# }) + "\n"
content = re.sub(r'yield json\.dumps\(\{(.*?)\}\) \+ "\\n"', r'yield self._format_sse({\1})', content, flags=re.DOTALL)

with open('chat_orchestrator.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored SSE formats")
