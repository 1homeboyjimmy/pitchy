"""Verify every imported account, membership, passport, breakdown, team and quota."""
import argparse
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(args):
    from sqlalchemy import select
    from db_async import AsyncSessionLocal
    from accelerator_resident_import import ResidentImportManifest, manifest_digest
    from models import User, Project, ProjectTree, AcceleratorResidentImport, AcceleratorMembership, AcceleratorResidentQuotaOverride, AcceleratorTeam, AcceleratorTeamMember
    from project_access import get_accessible_project
    from project_breakdown import build_breakdown
    manifest = ResidentImportManifest.model_validate_json(Path(args.manifest).read_text(encoding="utf-8"))
    async with AsyncSessionLocal() as db:
        batch = (await db.execute(select(AcceleratorResidentImport).where(AcceleratorResidentImport.cohort_id == args.cohort_id,
            AcceleratorResidentImport.batch_key == manifest.batch_key))).scalar_one()
        assert batch.digest == manifest_digest(manifest)
        result = batch.result
        for row in manifest.participants:
            user = await db.get(User, result["users"][row.username])
            assert ((user.email or '').lower() == row.username if '@' in row.username else user.username == row.username)
            assert user.password_hash and user.is_active and user.local_login_enabled
            membership = await db.get(AcceleratorMembership, result["memberships"][row.username])
            assert membership.user_id == user.id and membership.cohort_id == args.cohort_id
            assert membership.status == "enrolled" and membership.application_id is None
            assert membership.project_id == result["projects_by_key"][row.primary_project]
            quota = (await db.execute(select(AcceleratorResidentQuotaOverride).where(AcceleratorResidentQuotaOverride.membership_id == membership.id,
                AcceleratorResidentQuotaOverride.source == "cohort", AcceleratorResidentQuotaOverride.superseded_at.is_(None)))).scalar_one()
            assert quota.limits
            for spec in manifest.projects:
                if row.username in spec.members:
                    await get_accessible_project(db, result["projects_by_key"][spec.key], user)
        for spec in manifest.projects:
            project = await db.get(Project, result["projects_by_key"][spec.key])
            tree = (await db.execute(select(ProjectTree).where(ProjectTree.project_id == project.id))).scalar_one()
            assert project.name == spec.name
            assert tree.tree_data == build_breakdown(project.passport)
            import passport as passport_lib
            for path, value in spec.fields.items():
                expected = value + ['@' + name + ' — участник проекта' for name in spec.append_team_members] if path == 'team' and spec.append_team_members else value
                assert passport_lib._get_path(project.passport, path) == expected
            if len(spec.members) > 1 and not spec.secondary_shared:
                team = (await db.execute(select(AcceleratorTeam).where(AcceleratorTeam.project_id == project.id,
                    AcceleratorTeam.cohort_id == args.cohort_id, AcceleratorTeam.status == "active"))).scalar_one()
                members = (await db.execute(select(AcceleratorTeamMember).where(AcceleratorTeamMember.team_id == team.id,
                    AcceleratorTeamMember.status == "active"))).scalars().all()
                assert {member.membership_id for member in members} == {result["memberships"][name] for name in spec.members}
                assert team.owner_membership_id == result["memberships"][spec.owner]
        print(json.dumps({"verified": True, "participants": len(manifest.participants), "projects": len(manifest.projects),
            "teams": len(result["team_ids"]), "category_count": 12}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--cohort-id", required=True, type=int)
    asyncio.run(run(parser.parse_args()))
