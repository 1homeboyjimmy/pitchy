"""Add team-level accelerator tracker assignments.

Revision ID: f26a7b8c9d0e
Revises: e15f6a7b8c9d
"""

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "f26a7b8c9d0e"
down_revision = "e15f6a7b8c9d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_team_tracker_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("tracker_user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["accelerator_teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tracker_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("team_id", name="uq_accelerator_team_tracker_team"),
    )
    op.create_index(
        "ix_accelerator_team_tracker_assignments_team_id",
        "accelerator_team_tracker_assignments",
        ["team_id"],
    )
    op.create_index(
        "ix_accelerator_team_tracker_assignments_tracker_user_id",
        "accelerator_team_tracker_assignments",
        ["tracker_user_id"],
    )

    connection = op.get_bind()
    teams = sa.table(
        "accelerator_teams",
        sa.column("id", sa.Integer()),
        sa.column("status", sa.String()),
    )
    members = sa.table(
        "accelerator_team_members",
        sa.column("team_id", sa.Integer()),
        sa.column("membership_id", sa.Integer()),
        sa.column("status", sa.String()),
    )
    personal = sa.table(
        "accelerator_tracker_assignments",
        sa.column("id", sa.Integer()),
        sa.column("membership_id", sa.Integer()),
        sa.column("tracker_user_id", sa.Integer()),
    )
    team_trackers = sa.table(
        "accelerator_team_tracker_assignments",
        sa.column("team_id", sa.Integer()),
        sa.column("tracker_user_id", sa.Integer()),
        sa.column("assigned_by_user_id", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    now = datetime.utcnow()
    for team_id in connection.execute(
        sa.select(teams.c.id).where(teams.c.status == "active")
    ).scalars():
        membership_ids = list(connection.execute(
            sa.select(members.c.membership_id).where(
                members.c.team_id == team_id,
                members.c.status == "active",
            )
        ).scalars())
        if not membership_ids:
            continue
        assignment_rows = list(connection.execute(
            sa.select(
                personal.c.id,
                personal.c.membership_id,
                personal.c.tracker_user_id,
            ).where(personal.c.membership_id.in_(membership_ids))
        ).mappings())
        trackers_by_member = {membership_id: set() for membership_id in membership_ids}
        for row in assignment_rows:
            trackers_by_member[row["membership_id"]].add(row["tracker_user_id"])
        if not all(len(trackers) == 1 for trackers in trackers_by_member.values()):
            continue
        tracker_ids = set().union(*trackers_by_member.values())
        if len(tracker_ids) != 1:
            continue
        tracker_user_id = tracker_ids.pop()
        connection.execute(team_trackers.insert().values(
            team_id=team_id,
            tracker_user_id=tracker_user_id,
            assigned_by_user_id=None,
            created_at=now,
            updated_at=now,
        ))
        connection.execute(
            personal.delete().where(personal.c.membership_id.in_(membership_ids))
        )


def downgrade():
    op.drop_table("accelerator_team_tracker_assignments")
