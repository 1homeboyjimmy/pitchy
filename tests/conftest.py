import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

TEST_DATABASE_URL = "sqlite:///./test.db"
TEST_DB_PATH = PROJECT_ROOT / "test.db"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("APP_SECRET_KEY", "test_secret_key_1234567890")


def _alembic_config() -> Config:
    cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    return cfg


def pytest_sessionstart(session):
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    command.upgrade(_alembic_config(), "head")


def pytest_sessionfinish(session, exitstatus):
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
