"""Read-only Telegram identity reconciliation; export details encrypted, counts only in logs."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(args):
    from sqlalchemy import select, func, or_
    from db_async import AsyncSessionLocal
    from models import User, Project, AcceleratorMembership, AcceleratorParticipantProfile, AcceleratorTeam, AcceleratorTeamMember
    from login_identity import normalize_username
    from credential_export import encrypt_export
    names = sorted({normalize_username(value) for value in json.loads(Path(args.usernames).read_text())})
    aliases = names + ['@' + value for value in names]
    async with AsyncSessionLocal() as db:
        profiles = (await db.execute(select(AcceleratorParticipantProfile, AcceleratorMembership).join(
            AcceleratorMembership, AcceleratorMembership.id == AcceleratorParticipantProfile.membership_id
        ).where(func.lower(func.trim(AcceleratorParticipantProfile.profile['telegram'].as_string())).in_(aliases)))).all()
        profile_names = {}
        for profile, membership in profiles:
            name = normalize_username(profile.profile['telegram'])
            profile_names.setdefault(membership.user_id, set()).add(name)
        users = (await db.execute(select(User).where(or_(User.username.in_(names),
            func.lower(func.trim(User.name)).in_(['@' + name for name in names]), User.id.in_(profile_names))))).scalars().all()
        output = []
        for user in users:
            matches = []
            if user.username in names:
                matches.append({'username': user.username, 'source': 'username'})
            for name in sorted(profile_names.get(user.id, set())):
                if name != user.username:
                    matches.append({'username': name, 'source': 'participant_profile'})
            display = (user.name or '').strip().lower()
            if display.startswith('@') and display[1:] in names and not any(row['username'] == display[1:] for row in matches):
                matches.append({'username': display[1:], 'source': 'display_name_candidate'})
            memberships = (await db.execute(select(AcceleratorMembership).where(AcceleratorMembership.user_id == user.id))).scalars().all()
            shared = (await db.execute(select(AcceleratorTeam.project_id).join(AcceleratorTeamMember,
                AcceleratorTeamMember.team_id == AcceleratorTeam.id).join(AcceleratorMembership,
                AcceleratorMembership.id == AcceleratorTeamMember.membership_id).where(AcceleratorMembership.user_id == user.id,
                    AcceleratorTeam.status == 'active', AcceleratorTeamMember.status == 'active')))).scalars().all()
            projects = (await db.execute(select(Project).where(or_(Project.user_id == user.id, Project.id.in_(shared))))).scalars().all()
            output.append({'id': user.id, 'username': user.username, 'matches': matches,
                'active': user.is_active, 'deleted': user.deleted_at is not None, 'has_password': bool(user.password_hash),
                'email_present': bool(user.email), 'local_login_enabled': user.local_login_enabled,
                'memberships': [{'id': row.id, 'cohort_id': row.cohort_id, 'role': row.role, 'status': row.status, 'project_id': row.project_id} for row in memberships],
                'projects': [{'id': row.id, 'owner_id': row.user_id, 'name': row.name, 'status': row.status, 'passport': row.passport} for row in projects]})
        encrypted = encrypt_export({'requested_usernames': names, 'accounts': output}, Path(args.public_key).read_text())
        Path(args.output).write_text(json.dumps(encrypted), encoding='utf-8')
        print(json.dumps({'requested': len(names), 'matching_accounts': len(output), 'encrypted_export': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--usernames', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--public-key', required=True)
    asyncio.run(run(parser.parse_args()))
