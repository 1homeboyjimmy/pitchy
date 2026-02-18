import requests
import urllib3

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Global patch for requests to disable SSL verification
old_request = requests.Session.request


def new_request(self, method, url, *args, **kwargs):
    kwargs['verify'] = False
    return old_request(self, method, url, *args, **kwargs)


requests.Session.request = new_request

from sentence_transformers import SentenceTransformer
import time

print("Start loading model...")
start = time.time()
try:
    model = SentenceTransformer("cointegrated/rubert-tiny2")
    print(f"Model loaded in {time.time() - start:.2f} seconds.")
    
    val = model.encode("тестовый запрос")
    print("Encoding successful. Vector shape:", val.shape)
except Exception as e:
    print(f"Error loading model: {e}")
