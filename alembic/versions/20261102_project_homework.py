"""Attribute homework versions to their original performers; permit solo projects."""

from alembic import op
import sqlalchemy as sa

revision = "20261102_project_homework"
down_revision = "20261029_team_transfer"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "accelerator_homework_assignments",
        sa.Column("min_participants", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "accelerator_homework_assignments",
        sa.Column(
            "require_project", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    for table in ["accelerator_homework_submissions", "accelerator_homework_attempts"]:
        op.add_column(table, sa.Column("context", sa.JSON(), nullable=True))
    with op.batch_alter_table("accelerator_homework_submissions") as batch:
        batch.drop_constraint(
            "uq_accelerator_homework_submission_membership", type_="unique"
        )
        batch.create_index(
            "uq_accelerator_homework_solo",
            ["assignment_id", "membership_id"],
            unique=True,
            postgresql_where=sa.text("team_id IS NULL"),
            sqlite_where=sa.text("team_id IS NULL"),
        )
    op.create_table(
        "accelerator_homework_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "attempt_id",
            sa.Integer(),
            sa.ForeignKey("accelerator_homework_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "membership_id",
            sa.Integer(),
            sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "granted_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.UniqueConstraint(
            "attempt_id", "membership_id", name="uq_homework_attempt_participant"
        ),
    )
    op.create_index(
        "ix_accelerator_homework_participants_attempt_id",
        "accelerator_homework_participants",
        ["attempt_id"],
    )
    op.create_index(
        "ix_accelerator_homework_participants_membership_id",
        "accelerator_homework_participants",
        ["membership_id"],
    )
    op.create_table(
        "accelerator_homework_exceptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "assignment_id",
            sa.Integer(),
            sa.ForeignKey("accelerator_homework_assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "membership_id",
            sa.Integer(),
            sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("allow_individual", sa.Boolean(), nullable=False),
        sa.Column("due_at", sa.DateTime()),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "assignment_id", "membership_id", name="uq_homework_exception"
        ),
    )
    for col in ["assignment_id", "membership_id"]:
        op.create_index(
            "ix_accelerator_homework_exceptions_" + col,
            "accelerator_homework_exceptions",
            [col],
        )
    # Reconstruct original attribution from dated membership history, never today's roster.
    db = op.get_bind()
    meta = sa.MetaData()
    tables = {
        n: sa.Table("accelerator_" + n, meta, autoload_with=db)
        for n in [
            "homework_submissions",
            "homework_attempts",
            "homework_assignments",
            "homework_targets",
            "homework_participants",
            "team_members",
            "teams",
            "memberships",
            "audit_logs",
        ]
    }
    users = sa.Table("users", meta, autoload_with=db)
    sub, att = tables["homework_submissions"], tables["homework_attempts"]
    audit_rows = db.execute(
        sa.select(tables["audit_logs"])
        .where(tables["audit_logs"].c.action == "homework.submitted")
        .order_by(tables["audit_logs"].c.id)
    ).mappings()
    senders = {
        (r["target_id"], (r["details"] or {}).get("attempt")): r["actor_user_id"]
        for r in audit_rows
    }

    for submission in db.execute(sa.select(sub)).mappings().all():
        versions = (
            db.execute(
                sa.select(att)
                .where(att.c.submission_id == submission["id"])
                .order_by(att.c.attempt_number)
            )
            .mappings()
            .all()
        )
        if not versions:
            db.execute(
                att.insert().values(
                    submission_id=submission["id"],
                    attempt_number=submission["attempt_count"],
                    **{
                        k: submission[k]
                        for k in [
                            "answer_text",
                            "attachments",
                            "quiz_answers",
                            "score",
                            "passed",
                            "review_comment",
                            "reviewed_by_user_id",
                            "reviewed_at",
                        ]
                    },
                    review_status=submission["status"],
                    created_at=submission["submitted_at"]
                )
            )
            versions = (
                db.execute(
                    sa.select(att).where(att.c.submission_id == submission["id"])
                )
                .mappings()
                .all()
            )
        assignment = (
            db.execute(
                sa.select(tables["homework_assignments"]).where(
                    tables["homework_assignments"].c.id == submission["assignment_id"]
                )
            )
            .mappings()
            .one()
        )
        for version in versions:
            when = version["created_at"] or submission["submitted_at"]
            m = tables["memberships"]
            original = (
                db.execute(sa.select(m).where(m.c.id == submission["membership_id"]))
                .mappings()
                .one()
            )
            sender_user_id = senders.get((submission["id"], version["attempt_number"]))
            sender = (
                db.execute(
                    sa.select(m).where(
                        m.c.user_id == sender_user_id,
                        m.c.cohort_id == assignment["cohort_id"],
                        m.c.role == "resident",
                    )
                )
                .mappings()
                .first()
                if sender_user_id
                else None
            )
            ids = set() if submission["team_id"] else {submission["membership_id"]}
            if submission["team_id"]:
                tm = tables["team_members"]
                ids.update(
                    db.execute(
                        sa.select(tm.c.membership_id).where(
                            tm.c.team_id == submission["team_id"],
                            tm.c.joined_at <= when,
                            sa.or_(tm.c.left_at.is_(None), tm.c.left_at > when),
                        )
                    ).scalars()
                )
            if sender:
                ids.add(sender["id"])
            if not ids:
                ids.add(submission["membership_id"])
            if assignment["audience"] == "selected":
                target = tables["homework_targets"]
                ids &= set(
                    db.execute(
                        sa.select(target.c.membership_id).where(
                            target.c.assignment_id == assignment["id"]
                        )
                    ).scalars()
                )
                if sender:
                    ids.add(sender["id"])
                if not ids:
                    ids.add(submission["membership_id"])
            m = tables["memberships"]
            people = (
                db.execute(
                    sa.select(m.c.id, users.c.id.label("user_id"), users.c.name)
                    .join(users, users.c.id == m.c.user_id)
                    .where(m.c.id.in_(ids))
                )
                .mappings()
                .all()
            )
            team = (
                db.execute(
                    sa.select(tables["teams"]).where(
                        tables["teams"].c.id == submission["team_id"]
                    )
                )
                .mappings()
                .first()
                if submission["team_id"]
                else None
            )
            owner = original
            context = {
                "team_id": submission["team_id"],
                "team_name": team["name"] if team else None,
                "project_id": team["project_id"] if team else None,
                "submitted_by_user_id": sender_user_id
                or (owner["user_id"] if owner["id"] in ids else None),
                "members": [
                    {
                        "membership_id": p["id"],
                        "user_id": p["user_id"],
                        "name": p["name"],
                    }
                    for p in people
                ],
                "legacy": True,
            }
            db.execute(
                att.update().where(att.c.id == version["id"]).values(context=context)
            )
            db.execute(
                tables["homework_participants"].insert(),
                [{"attempt_id": version["id"], "membership_id": mid} for mid in ids],
            )
            if version["attempt_number"] == submission["attempt_count"]:
                db.execute(
                    sub.update()
                    .where(sub.c.id == submission["id"])
                    .values(context=context)
                )


def downgrade():
    # Multiple scopes for one submitter cannot be collapsed without losing work.
    db = op.get_bind()
    if db.execute(
        sa.text(
            "SELECT 1 FROM accelerator_homework_submissions GROUP BY assignment_id, membership_id HAVING count(*) > 1"
        )
    ).first():
        raise RuntimeError(
            "Cannot downgrade: multiple homework scopes must be reconciled first"
        )
    op.drop_table("accelerator_homework_exceptions")
    op.drop_table("accelerator_homework_participants")
    with op.batch_alter_table("accelerator_homework_submissions") as batch:
        batch.drop_index("uq_accelerator_homework_solo")
        batch.create_unique_constraint(
            "uq_accelerator_homework_submission_membership",
            ["assignment_id", "membership_id"],
        )
    for table in ["accelerator_homework_submissions", "accelerator_homework_attempts"]:
        op.drop_column(table, "context")
    op.drop_column("accelerator_homework_assignments", "min_participants")
    op.drop_column("accelerator_homework_assignments", "require_project")
