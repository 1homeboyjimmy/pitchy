import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("ROUTERAI_API_KEY")
base_url = os.getenv("SLM_API_BASE", "https://routerai.ru/api/v1")

client = OpenAI(api_key=api_key, base_url=base_url)

try:
    models = client.models.list()
    print("Available models on RouterAI:")
    for model in models.data:
        if "qwen" in model.id.lower():
            print(f"- {model.id}")
except Exception as e:
    print(f"Failed to list models: {e}")
