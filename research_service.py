from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select

from db_async import AsyncSessionLocal
from makura_client import call_makura
from models import ChatMessage, ResearchClaim, ResearchEvidence, ResearchJob, ResearchSource
from routerai_client import call_routerai, rerank_documents
from search_agent import research_search_documents

logger = logging.getLogger("app.research")
PLANNER_MODEL = os.getenv("RESEARCH_PLANNER_MODEL", "glm-5")
WRITER_MODEL = os.getenv("RESEARCH_WRITER_MODEL", "glm-5")
EXTRACTOR_MODEL = os.getenv("RESEARCH_EXTRACTOR_MODEL", "z-ai/glm-5")
EXTRACTOR_FALLBACK_MODEL = os.getenv("RESEARCH_EXTRACTOR_FALLBACK_MODEL", "openai/gpt-4.1-mini")
VERIFIER_MODEL = os.getenv("RESEARCH_VERIFIER_MODEL", "moonshotai/kimi-k2.6")
RERANK_MODEL = os.getenv("RESEARCH_RERANK_MODEL", "cohere/rerank-v3.5")
RERANK_MIN_SCORE = float(os.getenv("RESEARCH_RERANK_MIN_SCORE", "0.03"))
RERANK_MIN_DOCUMENTS = int(os.getenv("RESEARCH_RERANK_MIN_DOCUMENTS", "15"))


def _json_object(text: str | None, fallback: Any) -> Any:
    if not text:
        return fallback
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except Exception:
                pass
    return fallback


async def _update(job_id: int, phase: str, progress: int, message: str, **values: Any) -> bool:
    async with AsyncSessionLocal() as db:
        job = await db.get(ResearchJob, job_id)
        if not job:
            return False
        if job.cancel_requested:
            job.status = "cancelled"; job.phase = "cancelled"; job.completed_at = datetime.utcnow()
            await db.commit(); return False
        job.status = values.pop("status", "running")
        job.phase = phase; job.progress = progress; job.updated_at = datetime.utcnow()
        event = {"phase": phase, "progress": progress, "message": message, "at": datetime.utcnow().isoformat() + "Z"}
        job.events = [*(job.events or []), event][-100:]
        for key, value in values.items():
            setattr(job, key, value)
        await db.commit()
    return True


async def _plan(query: str) -> dict:
    system = """Ты — Research Planner. Построй универсальный план исследования под конкретный запрос, не применяй фиксированный рыночный шаблон. Верни только JSON: objective, research_type, scope, questions (5-8 объектов с id, question, importance, preferred_sources), report_sections (4-8 объектов id,title,supported_by), validation_rules. Обязательно включи прямой ответ, доказательства и ограничения, но остальные разделы выбирай по смыслу запроса."""
    content, _, _ = await call_makura(system, query, model=PLANNER_MODEL)
    fallback = {"objective": query, "research_type": "general", "scope": {}, "questions": [{"id": f"q{i+1}", "question": q, "importance": "high", "preferred_sources": ["primary", "official"]} for i, q in enumerate([query, f"Ключевые факты и определения: {query}", f"Альтернативные позиции и противоречия: {query}", f"Практические последствия: {query}", f"Ограничения доступных данных: {query}"])], "report_sections": [{"id":"summary","title":"Краткий ответ","supported_by":["q1"]},{"id":"evidence","title":"Результаты исследования","supported_by":["q1","q2","q3"]},{"id":"implications","title":"Практические выводы","supported_by":["q4"]},{"id":"limitations","title":"Ограничения исследования","supported_by":["q5"]}], "validation_rules":["Каждая цифра подтверждена источником", "Оценки явно отделены от фактов"]}
    plan = _json_object(content, fallback)
    if not isinstance(plan.get("questions"), list) or not plan["questions"]:
        return fallback
    plan["questions"] = plan["questions"][:8]
    report_sections = []
    seen_section_titles: set[str] = set()
    for section in plan.get("report_sections") or fallback["report_sections"]:
        title_key = re.sub(r"\W+", "", str(section.get("title") or "")).lower()
        if not title_key or title_key in seen_section_titles:
            continue
        seen_section_titles.add(title_key)
        report_sections.append(section)
        if len(report_sections) == 8:
            break
    plan["report_sections"] = report_sections or fallback["report_sections"]
    return plan


async def _collect(plan: dict) -> list[dict]:
    semaphore = asyncio.Semaphore(3)
    async def search(question: dict) -> list[dict]:
        objective = str(plan.get("objective") or "").strip()
        scope = json.dumps(plan.get("scope") or {}, ensure_ascii=False)
        preferred = ", ".join(str(item) for item in (question.get("preferred_sources") or []))
        search_query = (
            f"Тема исследования: {objective}\n"
            f"Область и ограничения: {scope}\n"
            f"Исследовательский вопрос: {question.get('question', '')}\n"
            f"Предпочтительные источники: {preferred}"
        )
        async with semaphore:
            docs = await research_search_documents(search_query, 8)
            for doc in docs: doc["question_id"] = question.get("id")
            return docs
    objective_question = {
        "id": "objective",
        "question": plan.get("objective", ""),
        "preferred_sources": ["primary", "official", "industry"],
    }
    search_targets = [objective_question, *plan["questions"]]
    batches = await asyncio.gather(*(search(q) for q in search_targets), return_exceptions=True)
    unique: dict[str, dict] = {}
    for batch in batches:
        if isinstance(batch, Exception):
            logger.warning("Research search branch failed: %s", batch); continue
        for doc in batch:
            key = doc["url"].split("#", 1)[0].rstrip("/")
            if key not in unique or len(doc["content"]) > len(unique[key]["content"]): unique[key] = doc
    return list(unique.values())


def _select_ranked_documents(docs: list[dict], ranking: list[dict]) -> list[dict]:
    if not ranking:
        return docs[:30]
    ranked = [
        {**docs[item["index"]], "relevance_score": float(item["relevance_score"])}
        for item in ranking
        if 0 <= item.get("index", -1) < len(docs)
    ]
    relevant = [doc for doc in ranked if doc["relevance_score"] >= RERANK_MIN_SCORE]
    keep_count = min(30, max(RERANK_MIN_DOCUMENTS, len(relevant)))
    return ranked[:keep_count]


async def _extract_claims(query: str, docs: list[dict]) -> list[dict]:
    batches = [docs[i:i+3] for i in range(0, len(docs), 3)]
    semaphore = asyncio.Semaphore(3)

    async def extract(batch_number: int, batch: list[dict]) -> list[dict]:
        evidence = "\n\n".join(f"SOURCE_INDEX={d['source_index']}\nTITLE={d['title']}\nURL={d['url']}\nTEXT={d['content'][:3500]}" for d in batch)
        system = """Извлеки только проверяемые утверждения, которые прямо помогают ответить на запрос. Полностью игнорируй источник, если его предмет, география или тип рынка не соответствуют запросу. Верни только компактный JSON вида {\"claims\":[{\"claim\":str,\"value_text\":str|null,\"unit\":str|null,\"period\":str|null,\"geography\":str|null,\"is_estimate\":bool,\"source_index\":int,\"passage\":str}]}. Максимум 12 наиболее важных утверждений на пакет, passage не длиннее 500 символов. Не делай выводов, которых нет во фрагменте."""
        allowed_source_indices = {int(doc["source_index"]) for doc in batch}
        prompt = f"ЗАПРОС:\n{query}\n\nИСТОЧНИКИ:\n{evidence}"
        extractor_models = tuple(dict.fromkeys((EXTRACTOR_MODEL, EXTRACTOR_FALLBACK_MODEL)))
        for attempt, extractor_model in enumerate(extractor_models, 1):
            async with semaphore:
                content, _, usage = await call_routerai(
                    system, prompt, model=extractor_model, max_tokens=3500,
                    response_format={"type": "json_object"},
                )
            data = _json_object(content, {"claims": []})
            extracted = data.get("claims", []) if isinstance(data, dict) else []
            cleaned_content = re.sub(r"^```(?:json)?", "", (content or "").strip()).lstrip()
            parseable_json = cleaned_content.startswith("{")
            valid = [
                claim for claim in extracted
                if isinstance(claim, dict)
                and claim.get("claim")
                and claim.get("source_index") in allowed_source_indices
            ]
            if valid or parseable_json and isinstance(data, dict) and "claims" in data:
                return valid
            logger.warning(
                "Claim extraction batch %s attempt %s (%s) returned no parseable JSON: response_chars=%s usage=%s",
                batch_number, attempt, extractor_model, len(content or ""), usage,
            )
        return []

    results = await asyncio.gather(
        *(extract(batch_number, batch) for batch_number, batch in enumerate(batches, 1)),
        return_exceptions=True,
    )
    claims = []
    for batch_number, result in enumerate(results, 1):
        if isinstance(result, Exception):
            logger.warning("Claim extraction batch %s failed: %s", batch_number, result)
            continue
        claims.extend(c for c in result if isinstance(c, dict) and c.get("claim"))
    if not claims:
        raise RuntimeError("Не удалось извлечь проверяемые утверждения из найденных источников")
    return claims[:80]


async def _verify(query: str, claims: list[dict], docs: list[dict]) -> list[dict]:
    compact = [{"claim_index": i, **{k: c.get(k) for k in ("claim","value_text","unit","period","geography","is_estimate","source_index","passage")}} for i,c in enumerate(claims)]
    system = """Ты независимый фактчекер. Проверь соответствие каждого утверждения его passage, периоды, географию, арифметику и смешение факта с оценкой. Верни только компактный JSON {\"verdicts\":[{\"claim_index\":int,\"status\":\"supported|partial|conflict|rejected\",\"confidence\":0..1,\"reason\":str}]}. Обязательно верни по одному вердикту на каждый claim_index. reason — одно короткое предложение. Строго отклоняй выводы, не следующие из evidence."""
    batches = [compact[i:i+8] for i in range(0, len(compact), 8)]
    semaphore = asyncio.Semaphore(2)

    async def verify_batch(batch_number: int, batch: list[dict]) -> list[dict]:
        prompt = f"Исходный запрос: {query}\n\nУтверждения:\n{json.dumps(batch, ensure_ascii=False)}"
        for attempt, max_tokens in enumerate((3000, 5000), 1):
            async with semaphore:
                content, _, usage = await call_routerai(
                    system, prompt, model=VERIFIER_MODEL, max_tokens=max_tokens,
                    response_format={"type": "json_object"},
                )
            data = _json_object(content, {"verdicts": []})
            verdicts = data.get("verdicts", []) if isinstance(data, dict) else []
            if verdicts:
                return [verdict for verdict in verdicts if isinstance(verdict, dict)]
            logger.warning(
                "Verification batch %s attempt %s returned no parseable verdicts: response_chars=%s usage=%s",
                batch_number, attempt, len(content or ""), usage,
            )
        return []

    results = await asyncio.gather(
        *(verify_batch(batch_number, batch) for batch_number, batch in enumerate(batches, 1)),
        return_exceptions=True,
    )
    verdicts: list[dict] = []
    for batch_number, result in enumerate(results, 1):
        if isinstance(result, Exception):
            logger.warning("Verification batch %s failed: %s", batch_number, result)
            continue
        verdicts.extend(result)

    by_index = {v.get("claim_index"): v for v in verdicts}
    missing_verdicts = 0
    allowed_statuses = {"supported", "partial", "conflict", "rejected"}
    for i, claim in enumerate(claims):
        verdict = by_index.get(i, {})
        status = verdict.get("status")
        if status not in allowed_statuses:
            missing_verdicts += 1
            status = "partial"
            verdict = {
                "confidence": 0.35,
                "reason": "Проверяющий агент не вернул отдельный вердикт; утверждение подтверждено только исходным фрагментом.",
            }
        try:
            confidence = float(verdict.get("confidence", 0.5))
        except (TypeError, ValueError):
            confidence = 0.5
        claim["status"] = status
        claim["confidence"] = max(0, min(1, confidence))
        claim["verification_reason"] = str(verdict.get("reason", ""))
    if missing_verdicts:
        logger.warning(
            "Verification completed with source-only fallback for %s of %s claims",
            missing_verdicts, len(claims),
        )
    return claims


async def _write_report(job_id: int, query: str, plan: dict, claims: list[dict], docs: list[dict]) -> tuple[str, set[int]]:
    usable = [
        c for c in claims
        if c.get("status") in ("supported", "partial")
        and float(c.get("confidence") or 0) >= 0.5
    ]
    source_map = {d["source_index"]: d for d in docs}
    sections = []
    used_source_indices: set[int] = set()
    report_sections = plan.get("report_sections", [])
    for section_number, section in enumerate(report_sections, 1):
        supported_by = set(section.get("supported_by") or [])
        evidence = []
        for c in usable:
            src = source_map.get(c.get("source_index"))
            if src and (not supported_by or src.get("question_id") in supported_by):
                evidence.append({"claim": c.get("claim"), "status": c.get("status"), "confidence": c.get("confidence"), "is_estimate": c.get("is_estimate"), "period": c.get("period"), "geography": c.get("geography"), "source_index": c.get("source_index")})
                used_source_indices.add(int(src["source_index"]))
        section_title = str(section.get("title") or "Раздел")
        section_progress = 82 + round((section_number - 1) / max(1, len(report_sections)) * 15)
        if not await _update(
            job_id,
            "writing",
            section_progress,
            f"Агент отчёта: пишу раздел «{section_title}» ({section_number}/{len(report_sections)})",
        ):
            return "\n\n".join(sections), used_source_indices
        is_limitations = "огранич" in section_title.lower()
        if not evidence and not is_limitations:
            sections.append(f"## {section_title}\n\nНедостаточно подтверждённых данных для содержательного вывода по этому разделу.")
            continue
        if len(evidence) >= 12:
            target_length = "700–1100 слов"
        elif len(evidence) >= 6:
            target_length = "450–750 слов"
        elif len(evidence) >= 3:
            target_length = "250–450 слов"
        else:
            target_length = "100–200 слов"
        system = """Напиши один раздел профессионального глубокого исследования на русском языке. Синтезируй данные, не пересказывай источники по очереди. Используй только утверждения из evidence: не добавляй факты, числа, даты, названия организаций или выводы, которых там нет. Не используй отвергнутые факты. Оценки явно называй оценками Pitchy. Не выдавай корреляцию, техническую метрику или косвенный признак за доказанную причинно-следственную связь. Если данных недостаточно, честно и кратко укажи ограничение вместо догадки. Не вставляй URL, Markdown-ссылки, номера источников или список источников — интерфейс показывает источники отдельно. Не повторяй название раздела и не добавляй вводную или заключение за его пределами."""
        prompt = f"Исходный запрос: {query}\nНазвание раздела: {section_title}\nЦель: {plan.get('objective')}\nЦелевой объём: {target_length}. Раскрой причинно-следственные связи, сравнения, неопределённости и практическое значение, если это подтверждается evidence. Не растягивай текст повторениями.\nПроверенные утверждения:\n{json.dumps(evidence[:60], ensure_ascii=False)}"
        content, _, _ = await call_makura(system, prompt, model=WRITER_MODEL)
        body = (content or "Недостаточно подтверждённых данных для раздела.").strip()
        body = re.sub(r"^\s*#{1,6}\s+[^\n]+\n+", "", body, count=1)
        sections.append(f"## {section_title}\n\n{body}")
    conflicts = [c for c in claims if c.get("status") in ("conflict", "rejected")]
    if conflicts:
        sections.append("## Противоречия и исключённые утверждения\n\n" + "\n".join(f"- {c.get('claim')} — {c.get('verification_reason') or c.get('status')}" for c in conflicts[:15]))
    return "\n\n".join(sections), used_source_indices

async def run_research_job(job_id: int) -> None:
    try:
        if not await _update(job_id, "planning", 5, "Формирую план исследования", started_at=datetime.utcnow()): return
        async with AsyncSessionLocal() as db:
            job = await db.get(ResearchJob, job_id); query = job.query if job else ""
        plan = await _plan(query)
        if not await _update(job_id, "searching", 12, f"Агент-планировщик сформировал {len(plan['questions'])} исследовательских вопросов", blueprint=plan): return
        if not await _update(job_id, "searching", 18, f"Поисковые агенты изучают {len(plan['questions']) + 1} направлений параллельно"): return
        docs = await _collect(plan)
        if not docs: raise RuntimeError("Поиск не вернул пригодных источников")
        if not await _update(job_id, "reranking", 38, f"Поисковые агенты нашли {len(docs)} уникальных источников"): return
        if not await _update(job_id, "reranking", 42, "Агент-реранкер сравнивает источники с целью исследования"): return
        ranking = await rerank_documents(query, [f"{d['title']}\n{d['content'][:3800]}" for d in docs], top_n=30, model=RERANK_MODEL)
        docs = _select_ranked_documents(docs, ranking)
        if not docs:
            raise RuntimeError("После ранжирования не осталось релевантных источников")
        for i, doc in enumerate(docs, 1): doc["source_index"] = i
        discovered_sources = [{"title":d["title"],"url":d["url"],"index":d["source_index"],"relevance_score":d.get("relevance_score")} for d in docs]
        if not await _update(job_id, "extracting", 48, f"Агент-реранкер отобрал {len(docs)} наиболее релевантных источников", sources=discovered_sources): return
        if not await _update(job_id, "extracting", 55, f"Агенты извлечения читают источники пакетами и выделяют проверяемые факты"): return
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ResearchSource).where(ResearchSource.job_id == job_id))
            rows=[]
            for d in docs:
                row=ResearchSource(job_id=job_id,title=d["title"],url=d["url"],content=d["content"],rank=d["source_index"],relevance_score=d.get("relevance_score"),metadata_json={"published_date":d.get("published_date"),"question_id":d.get("question_id")})
                db.add(row); rows.append(row)
            await db.commit()
            for row in rows: await db.refresh(row)
            source_db_ids={row.rank:row.id for row in rows}
        claims = await _extract_claims(query, docs)
        if not await _update(job_id, "verifying", 64, f"Агенты извлечения выделили {len(claims)} проверяемых утверждений"): return
        if not await _update(job_id, "verifying", 70, "Независимый фактчекер проверяет географию, периоды и противоречия"): return
        claims = await _verify(query, claims, docs)
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ResearchClaim).where(ResearchClaim.job_id == job_id))
            for c in claims:
                claim=ResearchClaim(job_id=job_id,claim=str(c.get("claim",""))[:8000],value_text=c.get("value_text"),unit=c.get("unit"),period=c.get("period"),geography=c.get("geography"),status=c.get("status","partial"),confidence=c.get("confidence",0.5),is_estimate=bool(c.get("is_estimate")))
                db.add(claim); await db.flush()
                sid=source_db_ids.get(c.get("source_index"))
                if sid and c.get("passage"): db.add(ResearchEvidence(claim_id=claim.id,source_id=sid,passage=str(c["passage"])[:12000],supports=c.get("status") not in ("conflict","rejected")))
            await db.commit()
        supported_count = sum(c.get("status") in ("supported", "partial") for c in claims)
        conflict_count = sum(c.get("status") in ("conflict", "rejected") for c in claims)
        if not await _update(job_id, "writing", 78, f"Фактчекер подтвердил {supported_count} утверждений и отметил {conflict_count} спорных"): return
        if not await _update(job_id, "writing", 82, "Агент отчёта синтезирует выводы по разделам"): return
        report, used_source_indices = await _write_report(job_id, query, plan, claims, docs)
        public_sources=[{"title":d["title"],"url":d["url"],"index":d["source_index"],"relevance_score":d.get("relevance_score"),"used_in_report":d["source_index"] in used_source_indices} for d in docs]
        async with AsyncSessionLocal() as db:
            job=await db.get(ResearchJob,job_id)
            if not job or job.cancel_requested: return
            job.report=report; job.sources=public_sources; job.status="completed"; job.phase="completed"; job.progress=100; job.completed_at=datetime.utcnow(); job.events=[*(job.events or []),{"phase":"completed","progress":100,"message":"Исследование завершено","at":datetime.utcnow().isoformat()+"Z"}]
            message=(await db.execute(select(ChatMessage).where(ChatMessage.research_job_id==job_id,ChatMessage.role=="assistant"))).scalar_one_or_none()
            if message: message.content=report; message.sources=public_sources; message.thoughts="\n".join(f"› {e['message']}" for e in job.events)
            await db.commit()
    except Exception as exc:
        logger.exception("Research job %s failed", job_id)
        async with AsyncSessionLocal() as db:
            job=await db.get(ResearchJob,job_id)
            if job:
                job.status="failed"; job.phase="failed"; job.error=str(exc)[:1000]; job.completed_at=datetime.utcnow(); await db.commit()


async def resume_pending_research_jobs() -> None:
    async with AsyncSessionLocal() as db:
        ids=(await db.execute(select(ResearchJob.id).where(ResearchJob.status.in_(["queued","running"])))).scalars().all()
        for job_id in ids:
            job=await db.get(ResearchJob,job_id)
            if job: job.status="queued"; job.phase="planning"; job.progress=0
        await db.commit()
    for job_id in ids: asyncio.create_task(run_research_job(job_id))
