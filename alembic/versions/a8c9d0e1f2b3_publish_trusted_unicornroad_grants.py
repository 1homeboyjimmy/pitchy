"""publish trusted Unicorn Road grants

Revision ID: a8c9d0e1f2b3
Revises: d5e6f7a8b9c0
Create Date: 2026-08-09

The deployment backfill imports the curated Unicorn Road feed. Historically
those rows were left pending, which could make the entire public catalogue
empty. Publish only untouched pending rows; explicit rejections remain intact.
Also backfill programs verified as open on 2026-08-09 from official Skolkovo
pages; the hourly maintenance job will close them at their deadlines.
"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "a8c9d0e1f2b3"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    grants = sa.table(
        "grants",
        sa.column("source", sa.String()),
        sa.column("moderation", sa.String()),
        sa.column("name", sa.String()),
        sa.column("organization", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("url", sa.Text()),
        sa.column("logo_url", sa.Text()),
        sa.column("geo", sa.String()),
        sa.column("stages", sa.JSON()),
        sa.column("sectors", sa.JSON()),
        sa.column("entity_types", sa.JSON()),
        sa.column("requirements", sa.JSON()),
        sa.column("deadline", sa.DateTime()),
        sa.column("status", sa.String()),
        sa.column("category", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    op.execute(
        grants.update()
        .where(grants.c.source == "unicornroad")
        .where(grants.c.moderation == "pending")
        .values(moderation="approved")
    )
    for column in (grants.c.stages, grants.c.sectors, grants.c.entity_types):
        op.execute(grants.update().where(column.is_(None)).values({column.name: []}))

    now = datetime(2026, 8, 9, 12, 0, 0)
    current_programs = [
        {
            "name": "Axoft × Сколково — акселерация корпоративных продаж",
            "organization": "Axoft и Фонд «Сколково»",
            "description": (
                "Бесплатная акселерационная программа для российских IT-команд: "
                "упаковка продукта, выход в корпоративный канал, экспертиза и "
                "возможность пилота. Для победителей предусмотрен дистрибьюторский "
                "контракт с инвестициями Axoft в продвижение решения."
            ),
            "url": "https://axoft.sk.ru/",
            "deadline": datetime(2026, 9, 7, 20, 59, 0),
            "category": "accelerator",
            "sectors": ["it", "ai", "industry", "hardware"],
            "entity_types": ["ООО", "ИП"],
            "requirements": {
                "business_model": "B2B, B2B2C или B2G",
                "legal_entity": "Наличие юридического лица",
                "ip_rights": "Права на разработку принадлежат заявителю",
            },
        },
        {
            "name": "Agrotech 2026 — конкурс технологических решений для тракторной техники",
            "organization": "Фонд «Сколково»",
            "description": (
                "Конкурс технологических решений в области тракторной техники "
                "для разработчиков готовых продуктов и технологий "
                "агропромышленного и машиностроительного профиля."
            ),
            "url": "https://agrotech.sk.ru/",
            "deadline": datetime(2026, 8, 24, 20, 59, 0),
            "category": "contest",
            "sectors": ["agro", "hardware", "industry", "ai"],
            "entity_types": ["ООО", "ИП"],
            "requirements": {"focus": "Технологические решения для тракторной техники"},
        },
        {
            "name": "Энергопрорыв–2026",
            "organization": "Группа «Россети» и Фонд «Сколково»",
            "description": (
                "Конкурс инновационных проектов и разработок в электроэнергетике. "
                "Лучшие решения получают возможность пилотного внедрения на "
                "объектах энергокомпаний, отраслевую экспертизу и доступ к "
                "партнёрам и инвесторам."
            ),
            "url": "https://energy.sk.ru/",
            "deadline": datetime(2026, 8, 31, 20, 59, 0),
            "category": "contest",
            "sectors": ["energy", "ai", "hardware", "industry"],
            "entity_types": ["ООО", "ИП"],
            "requirements": {
                "participants": (
                    "Технологические компании и разработчики решений для "
                    "электроэнергетики"
                )
            },
        },
        {
            "name": (
                "ПЕРВЫЕ — Реестр национального технологического первенства, "
                "цикл 2026"
            ),
            "organization": "Фонд «Сколково»",
            "description": (
                "Программа официальной фиксации технологического лидерства для "
                "проектов, создающих впервые в мире, России или отрасли технологию, "
                "продукт или производственную компетенцию. Финалисты получают "
                "сопровождение по инструментам финансовой поддержки."
            ),
            "url": "https://pervye.sk.ru/",
            "deadline": datetime(2026, 8, 31, 20, 59, 0),
            "category": "support_measure",
            "sectors": ["it", "ai", "hardware", "industry", "energy", "biotech"],
            "entity_types": ["ООО", "ИП"],
            "requirements": {
                "novelty": (
                    "Подтверждаемое технологическое первенство и доказательная база"
                )
            },
        },
    ]
    bind = op.get_bind()
    for program in current_programs:
        values = {
            **program,
            "logo_url": "/logos/skolkovo.svg",
            "geo": "RF",
            "stages": ["seed", "growth", "scale"],
            "source": "manual",
            "moderation": "approved",
            "status": "open",
            "created_at": now,
            "updated_at": now,
        }
        exists = bind.execute(
            sa.select(grants.c.url).where(grants.c.url == program["url"])
        ).first()
        if exists is None:
            bind.execute(grants.insert().values(**values))
        else:
            bind.execute(grants.update().where(grants.c.url == program["url"]).values(**values))

    # Make the deployment immediately consistent; the background loop keeps it
    # current afterwards. Programs without a deadline are left untouched.
    bind.execute(
        grants.update()
        .where(grants.c.deadline.is_not(None))
        .where(grants.c.deadline <= now)
        .values(status="closed", updated_at=now)
    )


def downgrade() -> None:
    # Publishing is a moderation decision and must not be undone implicitly.
    pass
