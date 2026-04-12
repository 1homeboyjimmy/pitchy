import os
import requests
import base64
import json
import uuid
from datetime import datetime
from dotenv import load_dotenv

# Load local .env keys
load_dotenv()

pk = os.getenv('LANGFUSE_PUBLIC_KEY')
sk = os.getenv('LANGFUSE_SECRET_KEY')
host = os.getenv('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com')

# Basic Auth
auth = base64.b64encode(f"{pk}:{sk}".encode()).decode()
headers = {
    'Authorization': f'Basic {auth}',
    'Content-Type': 'application/json'
}

# Generate a fake trace id
trace_id = str(uuid.uuid4())

# Send Trace
payload = {
    "batch": [
        {
            "type": "trace-create",
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "body": {
                "id": trace_id,
                "name": "manual_test_trace",
                "userId": "test_user_123",
                "metadata": {"test": "It works!"},
                "tags": ["test_stream"]
            }
        },
        {
            "type": "span-create",
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "body": {
                "traceId": trace_id,
                "id": str(uuid.uuid4()),
                "name": "my_generator_test",
                "input": {"message": "Hello?"},
                "output": {"reply": "Yes, I am working!"}
            }
        }
    ]
}

res = requests.post(f"{host}/api/public/ingestion", headers=headers, json=payload)
print(f"Status: {res.status_code}")
print(f"Response: {res.text}")
