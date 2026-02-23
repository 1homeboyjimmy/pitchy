import os
import requests
import logging

logger = logging.getLogger(__name__)

class YandexLockbox:
    def __init__(self):
        self.api_key = os.getenv("YC_API_KEY")
        self.secret_id = os.getenv("YC_LOCKBOX_SECRET_ID")  # combined secret (optional)
        self.base_url = "https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets"
        
        # Cache secrets in memory to avoid requesting them on every payment
        self._cached_secrets = None

    def _fetch_one_secret(self, secret_id: str) -> dict:
        """Fetch a single Lockbox secret payload and return its entries as a dict."""
        headers = {"Authorization": f"Api-Key {self.api_key}"}
        url = f"{self.base_url}/{secret_id}/payload"

        try:
            resp = requests.get(url, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            entries = {}
            for entry in data.get("entries", []):
                entries[entry.get("key")] = entry.get("textValue")
            return entries
        except Exception as e:
            logger.error(f"Failed to fetch Lockbox secret {secret_id}: {e}")
            return {}

    def get_secrets(self) -> dict:
        """Fetch secrets from Yandex Lockbox or return cached ones.
        
        Supports two modes:
        1. Combined secret: YC_LOCKBOX_SECRET_ID points to one secret with multiple entries.
        2. Individual secrets: env vars like YC_LOCKBOX_YOOKASSA_SHOP_ID=<lockbox_id>
           will fetch that secret and store its first value under key YOOKASSA_SHOP_ID.
        """
        if self._cached_secrets is not None:
            return self._cached_secrets

        if not self.api_key:
            logger.warning("YC_API_KEY is missing. Skipping Lockbox.")
            return {}

        secrets = {}

        # Mode 1: Combined secret with multiple entries
        if self.secret_id:
            logger.info(f"Fetching combined secret from Lockbox: {self.secret_id}")
            secrets.update(self._fetch_one_secret(self.secret_id))

        # Mode 2: Individual secrets (YC_LOCKBOX_<KEY_NAME>=<secret_id>)
        prefix = "YC_LOCKBOX_"
        skip = "YC_LOCKBOX_SECRET_ID"
        for env_key, lockbox_id in os.environ.items():
            if env_key.startswith(prefix) and env_key != skip and lockbox_id:
                key_name = env_key[len(prefix):]  # e.g. YOOKASSA_SHOP_ID
                logger.info(f"Fetching individual secret '{key_name}' from Lockbox: {lockbox_id}")
                entries = self._fetch_one_secret(lockbox_id)
                # Take the first text value from this secret
                for val in entries.values():
                    if val:
                        secrets[key_name] = val
                        break

        if secrets:
            self._cached_secrets = secrets
            logger.info(f"Successfully fetched {len(secrets)} secret(s) from Lockbox: {list(secrets.keys())}")
        else:
            logger.warning("No secrets fetched from Lockbox.")
            self._cached_secrets = {}

        return secrets

# Singleton instance
lockbox = YandexLockbox()

