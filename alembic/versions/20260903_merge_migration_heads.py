"""Merge the payment and grants migration branches.

Both branches are already applied independently where needed; this revision
only joins their graph so ``alembic upgrade head`` has a single target.
"""

from collections.abc import Sequence

revision: str = "20260903_merge_heads"
down_revision: tuple[str, str] = ("20260812_payment_provider", "a8c9d0e1f2b3")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
