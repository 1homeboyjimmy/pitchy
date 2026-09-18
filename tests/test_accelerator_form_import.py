import io
import json
import uuid

import pytest
from fastapi import HTTPException, UploadFile
from openpyxl import Workbook

from accelerator_form_import import parse_form_export
from db_async import AsyncSessionLocal
from models import AcceleratorApplication, User
from routers.accelerators import create_accelerator, create_cohort, import_application_answers
from schemas.accelerators import AcceleratorCreate, CohortCreate
from sqlalchemy import select


def test_csv_and_xlsx_exports_are_read_with_original_columns():
    csv_file = "Имя;Email;Почему участвуете?\nАнна;anna@example.test;Проверить спрос\n"
    parsed = parse_form_export(csv_file.encode("utf-8-sig"), "answers.csv")
    assert parsed["headers"] == ["Имя", "Email", "Почему участвуете?"]
    assert parsed["rows"][0][2] == "Проверить спрос"
    numbered = parse_form_export("Имя;Email\n\nАнна;anna@example.test\n".encode(), "answers.csv")
    assert numbered["row_numbers"] == [3]

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Ответы"
    sheet.append(["Name", "Email", "Answer"])
    sheet.append(["Anna", "anna@example.test", "Original value"])
    data = io.BytesIO()
    workbook.save(data)
    parsed_xlsx = parse_form_export(data.getvalue(), "answers.xlsx", "Ответы")
    assert parsed_xlsx["rows"][0] == ["Anna", "anna@example.test", "Original value"]


@pytest.mark.asyncio
async def test_import_preview_commit_replay_and_access():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"import-admin-{suffix}@example.test", name="Admin", is_admin=True)
        outsider = User(email=f"import-outsider-{suffix}@example.test", name="Outsider", is_admin=False)
        db.add_all([admin, outsider])
        await db.commit()
        await db.refresh(admin)
        await db.refresh(outsider)
        accelerator = await create_accelerator(AcceleratorCreate(name="Import test"), admin, db)
        cohort = await create_cohort(accelerator["id"], CohortCreate(name="Import cohort"), admin, db)
        content = (
            "Имя,Email,Опыт\n"
            f"Анна,anna-{suffix}@example.com,Провела 10 интервью\n"
            "Без адреса,invalid,Ответ\n"
        ).encode()

        def upload():
            return UploadFile(filename="answers.csv", file=io.BytesIO(content))

        kwargs = {
            "cohort_id": cohort["id"], "mapping_json": json.dumps({"name": 0, "email": 1}),
            "sheet": "", "source": "google_forms", "default_type": "participant",
            "user": admin, "db": db,
        }
        with pytest.raises(HTTPException) as denied:
            await import_application_answers(file=upload(), commit=False, **{**kwargs, "user": outsider})
        assert denied.value.status_code == 403

        preview = await import_application_answers(file=upload(), commit=False, **kwargs)
        assert preview["counts"]["ready"] == 1, preview["rows"]
        assert preview["counts"]["invalid"] == 1
        saved = await import_application_answers(file=upload(), commit=True, **kwargs)
        assert saved["counts"]["imported"] == 1
        replay = await import_application_answers(file=upload(), commit=True, **kwargs)
        assert replay["counts"]["imported"] == 0
        assert replay["counts"]["duplicate"] == 1

        rows = (await db.execute(select(AcceleratorApplication).where(
            AcceleratorApplication.cohort_id == cohort["id"],
        ))).scalars().all()
        assert len(rows) == 1
        assert rows[0].form_version == 0
        assert rows[0].source_type == "google_forms"
        assert rows[0].form_payload["external_2"] == "Провела 10 интервью"
        assert rows[0].form_schema_snapshot["fields"][0]["label"] == "Опыт"
