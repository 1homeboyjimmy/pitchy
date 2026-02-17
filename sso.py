import os

from dotenv import load_dotenv
from fastapi_sso.sso.base import SSOBase, OpenID
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.github import GithubSSO
from fastapi_sso.sso.gitlab import GitlabSSO

load_dotenv()


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

    @classmethod
    async def openid_from_response(cls, response: dict) -> OpenID:
        return OpenID(
            email=response.get("default_email"),
            provider=cls.provider,
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
    allow_insecure_http=True,
)

github_sso = GithubSSO(
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/github/callback",
    allow_insecure_http=True,
)

gitlab_sso = GitlabSSO(
    client_id=os.getenv("GITLAB_CLIENT_ID"),
    client_secret=os.getenv("GITLAB_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/gitlab/callback",
    allow_insecure_http=True,
)

yandex_sso = YandexSSO(
    client_id=os.getenv("YANDEX_CLIENT_ID"),
    client_secret=os.getenv("YANDEX_CLIENT_SECRET"),
    redirect_uri=f"{os.getenv('APP_PUBLIC_URL')}/auth/yandex/callback",
    allow_insecure_http=True,
)
