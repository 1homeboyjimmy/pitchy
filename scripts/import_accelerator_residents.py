"""Run on the intended backend host; preview by default, write only with --apply."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(args):
    from accelerator_resident_import import ResidentImportManifest, import_residents
    from db_async import AsyncSessionLocal
    from models import User
    manifest = ResidentImportManifest.model_validate_json(Path(args.manifest).read_text(encoding="utf-8"))
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor = await db.get(User, args.actor_id)
            if actor is None:
                raise ValueError("Организатор не найден")
            result, credentials = await import_residents(db, cohort_id=args.cohort_id, actor=actor,
                manifest=manifest, dry_run=not args.apply)
            if credentials:
                if not args.credentials:
                    raise ValueError("Для новых аккаунтов укажите отдельный файл --credentials")
                output = Path(args.credentials).resolve()
                export = {"credentials": credentials, "result": result}
                if args.export_public_key:
                    from credential_export import encrypt_export
                    export = encrypt_export(export, Path(args.export_public_key).read_text(encoding="utf-8"))
                output.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(export, handle, ensure_ascii=False, indent=2)
        # No credentials in stdout or the import registry.
        print(json.dumps({key: value for key, value in result.items() if key not in {"users", "memberships", "projects_by_key", "team_ids"}}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--cohort-id", required=True, type=int)
    parser.add_argument("--actor-id", required=True, type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--credentials")
    parser.add_argument("--export-public-key")
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except Exception as exc:
        # A public CI log must not echo validation inputs or SQL parameters.
        detail = getattr(exc, "detail", "Проверьте пакет и журнал операции")
        print(f"Импорт не выполнен: {type(exc).__name__}: {detail}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
