"""Merge the payment and chat migration branches.

Both branches are already applied independently where needed; this revision
only joins their graph so ``alembic upgrade head`` has a single target.
"""

from collections.abc import Sequence

revision: str = "20260903_merge_heads"
down_revision: tuple[str, str] = ("20260812_payment_provider", "d5e6f7a8b9c0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
