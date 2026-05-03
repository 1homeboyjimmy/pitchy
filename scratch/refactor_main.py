import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add format_sse helper and import EventSourceResponse
if 'from sse_starlette.sse import EventSourceResponse' not in content:
    content = content.replace(
        'from fastapi.responses import StreamingResponse, FileResponse\n',
        'from fastapi.responses import StreamingResponse, FileResponse\nfrom sse_starlette.sse import EventSourceResponse\n\ndef format_sse(data) -> dict:\n    if isinstance(data, dict):\n        return {"event": data.get("type", "message"), "data": json.dumps(data, ensure_ascii=False)}\n    return {"event": "message", "data": json.dumps(data, ensure_ascii=False)}\n\n'
    )

# Replace yield json.dumps(...) + "\n"
content = re.sub(r'yield json\.dumps\((.*?)\) \+ "\\n"', r'yield format_sse(\1)', content)

# Replace StreamingResponse(..., media_type="text/event-stream") with EventSourceResponse(...)
# E.g. StreamingResponse(chat_generator(), media_type="text/event-stream", headers=headers)
content = re.sub(r'StreamingResponse\(([^,]+),\s*media_type="text/event-stream"(.*?)\)', r'EventSourceResponse(\1\2)', content)

# Sometimes headers are passed. EventSourceResponse also accepts headers=headers
# EventSourceResponse(generator, headers=headers) is valid.

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Refactored main.py for SSE")
