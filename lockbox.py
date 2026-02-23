import os
import requests
import logging

logger = logging.getLogger(__name__)

class YandexLockbox:
    def __init__(self):
        self.api_key = os.getenv("YC_API_KEY") # We can use the same API key used for YandexGPT 
        self.secret_id = os.getenv("YC_LOCKBOX_SECRET_ID")
        self.base_url = "https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets"
        
        # Cache secrets in memory to avoid requesting them on every payment
        self._cached_secrets = None

    def get_secrets(self) -> dict:
        """Fetch secrets from Yandex Lockbox or return cached ones."""
        if self._cached_secrets:
            return self._cached_secrets

        if not self.api_key or not self.secret_id:
            logger.warning("YC_API_KEY or YC_LOCKBOX_SECRET_ID is missing. Skipping Lockbox.")
            return {}

        headers = {
            "Authorization": f"Api-Key {self.api_key}"
        }
        
        url = f"{self.base_url}/{self.secret_id}/payload"
        logger.info(f"Fetching secrets from Lockbox: {self.secret_id}")

        try:
            resp = requests.get(url, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            
            secrets = {}
            for entry in data.get("entries", []):
                secrets[entry.get("key")] = entry.get("textValue")
            
            self._cached_secrets = secrets
            logger.info("Successfully fetched and cached secrets from Lockbox")
            return secrets
        except Exception as e:
            logger.error(f"Failed to fetch secrets from Yandex Lockbox: {e}")
            return {}

# Singleton instance
lockbox = YandexLockbox()
