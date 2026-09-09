"""Merge the production and accelerator migration heads.

Revision ID: 20260909_accelerator_prod_merge
Revises: c69d0e1f2a3b, 20260903_merge_heads
"""

from collections.abc import Sequence


revision: str = "20260909_accelerator_prod_merge"
down_revision: tuple[str, str] = ("c69d0e1f2a3b", "20260903_merge_heads")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
