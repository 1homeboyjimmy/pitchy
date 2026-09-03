import os

from dotenv import load_dotenv
from fastapi_sso.sso.base import SSOBase, OpenID
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.github import GithubSSO
from fastapi_sso.sso.gitlab import GitlabSSO

load_dotenv()

# OAuth обязан ходить по https в проде. allow_insecure_http=True допустим
# только локально/на dev (http-редиректы). На APP_ENV=prod выключаем.
_ALLOW_INSECURE_HTTP = os.getenv("APP_ENV", "dev").lower() != "prod"


class YandexSSO(SSOBase):
    """Class providing login via Yandex OAuth"""
    provider = "yandex"
    scope = ["login:email", "login:info", "login:avatar"]

    async def get_discovery_document(self) -> dict:
        return {
            "authorization_endpoint": "https://oauth.yandex.ru/authorize",
            "token_endpoint": "https://oauth.yandex.ru/token",
            "userinfo_endpoint": "https://login.yandex.ru/info",
        }

    async def openid_from_response(self, response: dict, session: dict | None = None) -> OpenID:
        # Yandex ID requires the ``OAuth`` auth scheme for the user-info
        # endpoint. Some fastapi-sso/oauthlib combinations send ``Bearer``
        # first; retry with the scheme documented by Yandex when that request
        # did not return a user identity.
        if not response.get("id") and session is not None and self.access_token:
            userinfo = await session.get(
                "https://login.yandex.ru/info",
                headers={"Authorization": f"OAuth {self.access_token}"},
            )
            userinfo.raise_for_status()
            response = userinfo.json()

        # Yandex может вернуть default_email = "" (пустая строка): например,
        # когда у приложения нет доступа к почте или у аккаунта не задан
        # основной адрес. Пустая строка не проходит EmailStr-валидацию и
        # роняла весь SSO (ValidationError → "SSO Authentication Failed").
        # Берём email по цепочке фолбэков и никогда не отдаём пустую строку.
        email = (response.get("default_email") or "").strip() or None
        if not email:
            emails = response.get("emails") or []
            email = next((e for e in emails if e), None)
        if not email:
            login = response.get("login")
            email = f"{login}@yandex.ru" if login else None
        return OpenID(
            email=email,
            provider=self.provider,
            id=response.get("id"),
            display_name=(
                response.get("real_name")
                or response.get("display_name")
            ),
            picture=(
                "https://avatars.yandex.net/get-yapic/"
                f"{response.get('default_avatar_id')}/islands-200"
            ),
        )


# Initialize SSO providers
google_sso = GoogleSSO(
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/google/callback",
    allow_insecure_http=_ALLOW_INSECURE_HTTP,
)

github_sso = GithubSSO(
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/github/callback",
    allow_insecure_http=_ALLOW_INSECURE_HTTP,
)

gitlab_sso = GitlabSSO(
    client_id=os.getenv("GITLAB_CLIENT_ID"),
    client_secret=os.getenv("GITLAB_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/gitlab/callback",
    allow_insecure_http=_ALLOW_INSECURE_HTTP,
)

yandex_sso = YandexSSO(
    client_id=os.getenv("YANDEX_CLIENT_ID"),
    client_secret=os.getenv("YANDEX_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/yandex/callback",
    allow_insecure_http=_ALLOW_INSECURE_HTTP,
)
