
import os
import requests
import urllib3
from pathlib import Path
import time

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MODEL_NAME = "intfloat/multilingual-e5-small"
LOCAL_DIR = Path("model_data/multilingual-e5-small")
BASE_URL = f"https://hf-mirror.com/{MODEL_NAME}/resolve/main"

FILES_TO_DOWNLOAD = [
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
    "special_tokens_map.json",
    "modules.json",
    "sentence_bert_config.json",
    "1_Pooling/config.json",
    "2_Dense/config.json",
    "2_Dense/pytorch_model.bin",
]


def download_file(filename):
    url = f"{BASE_URL}/{filename}"
    local_path = LOCAL_DIR / filename

    # Ensure directory exists
    local_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {filename}...")
    try:
        response = requests.get(url, verify=False, stream=True, timeout=60)
        if response.status_code == 404:
            print(f"File {filename} not found (404), skipping.")
            return
        response.raise_for_status()

        with open(local_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Saved to {local_path} ({local_path.stat().st_size / 1024 / 1024:.1f} MB)")
    except Exception as e:
        print(f"Error downloading {filename}: {e}")


def main():
    os.makedirs(LOCAL_DIR, exist_ok=True)
    print(f"Downloading model {MODEL_NAME} to {LOCAL_DIR}...")

    for filename in FILES_TO_DOWNLOAD:
        local_path = LOCAL_DIR / filename
        if local_path.exists() and local_path.stat().st_size > 0:
            print(f"Skipping {filename} (already exists, {local_path.stat().st_size / 1024 / 1024:.1f} MB).")
            continue

        # Retry up to 3 times
        for i in range(3):
            try:
                download_file(filename)
                break
            except Exception as e:
                print(f"Retry {i+1}/3 failed for {filename}: {e}")
                time.sleep(2)

    print("Download complete.")


if __name__ == "__main__":
    main()
