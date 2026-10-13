"""Read-only production preflight: program IDs, limits and actor IDs, no secrets."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run():
    from db_async import AsyncSessionLocal
    from sqlalchemy import select, func
    from models import Accelerator, AcceleratorCohort, AcceleratorProgramConfig, AcceleratorMembership, User
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(AcceleratorCohort, Accelerator, AcceleratorProgramConfig)
            .join(Accelerator, Accelerator.id == AcceleratorCohort.accelerator_id)
            .outerjoin(AcceleratorProgramConfig, AcceleratorProgramConfig.cohort_id == AcceleratorCohort.id))).all()
        cohorts = []
        for cohort, accelerator, config in rows:
            name = (accelerator.name + " " + cohort.name).lower()
            if "мтуси" not in name and "mtusi" not in name:
                continue
            count = (await db.execute(select(func.count()).select_from(AcceleratorMembership).where(AcceleratorMembership.cohort_id == cohort.id))).scalar_one()
            cohorts.append({"id": cohort.id, "accelerator_id": accelerator.id, "accelerator": accelerator.name,
                "name": cohort.name, "status": cohort.status, "ends_at": str(cohort.ends_at) if cohort.ends_at else None,
                "quota": cohort.default_quota_config, "modules": config.modules if config else {}, "memberships": count,
                "created_by_user_id": cohort.created_by_user_id})
        actors = (await db.execute(select(User.id).where(User.is_admin.is_(True), User.is_active.is_(True), User.deleted_at.is_(None)))).scalars().all()
        print(json.dumps({"cohorts": cohorts, "admin_actor_ids": list(actors)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(run())
