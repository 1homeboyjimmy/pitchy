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
VERIFIER_MODEL = os.getenv("RESEARCH_VERIFIER_MODEL", "moonshotai/kimi-k2.6")
RERANK_MODEL = os.getenv("RESEARCH_RERANK_MODEL", "cohere/rerank-v3.5")


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
    plan["report_sections"] = (plan.get("report_sections") or fallback["report_sections"])[:8]
    return plan


async def _collect(plan: dict) -> list[dict]:
    semaphore = asyncio.Semaphore(3)
    async def search(question: dict) -> list[dict]:
        async with semaphore:
            docs = await research_search_documents(question.get("question", ""), 8)
            for doc in docs: doc["question_id"] = question.get("id")
            return docs
    batches = await asyncio.gather(*(search(q) for q in plan["questions"]), return_exceptions=True)
    unique: dict[str, dict] = {}
    for batch in batches:
        if isinstance(batch, Exception):
            logger.warning("Research search branch failed: %s", batch); continue
        for doc in batch:
            key = doc["url"].split("#", 1)[0].rstrip("/")
            if key not in unique or len(doc["content"]) > len(unique[key]["content"]): unique[key] = doc
    return list(unique.values())


async def _extract_claims(query: str, docs: list[dict]) -> list[dict]:
    batches = [docs[i:i+3] for i in range(0, len(docs), 3)]
    semaphore = asyncio.Semaphore(3)
    async def extract(batch: list[dict]) -> list[dict]:
        evidence = "\n\n".join(f"SOURCE_INDEX={d['source_index']}\nTITLE={d['title']}\nURL={d['url']}\nTEXT={d['content'][:3500]}" for d in batch)
        system = """Извлеки только проверяемые утверждения, которые помогают ответить на запрос. Верни только компактный JSON вида {\"claims\":[{\"claim\":str,\"value_text\":str|null,\"unit\":str|null,\"period\":str|null,\"geography\":str|null,\"is_estimate\":bool,\"source_index\":int,\"passage\":str}]}. Максимум 12 наиболее важных утверждений на пакет, passage не длиннее 500 символов. Не делай выводов, которых нет во фрагменте."""
        async with semaphore:
            content, _, usage = await call_routerai(system, f"ЗАПРОС:\n{query}\n\nИСТОЧНИКИ:\n{evidence}", model=VERIFIER_MODEL, max_tokens=6000)
        data = _json_object(content, {"claims": []})
        if not isinstance(data, dict) or not data.get("claims"):
            logger.warning("Claim extraction returned no parseable claims: response_chars=%s usage=%s", len(content or ""), usage)
        return data.get("claims", []) if isinstance(data, dict) else []
    results = await asyncio.gather(*(extract(b) for b in batches), return_exceptions=True)
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
    system = """Ты независимый фактчекер. Проверь соответствие утверждений приведённым passages, периоды, географию, арифметику и смешение факта с оценкой. Верни только JSON {\"verdicts\":[{\"claim_index\":int,\"status\":\"supported|partial|conflict|rejected\",\"confidence\":0..1,\"reason\":str}]}. Строго отклоняй выводы, не следующие из evidence."""
    content, _, _ = await call_routerai(system, f"Исходный запрос: {query}\n\nУтверждения:\n{json.dumps(compact, ensure_ascii=False)[:50000]}", model=VERIFIER_MODEL)
    verdicts = _json_object(content, {"verdicts": []}).get("verdicts", [])
    if not verdicts:
        raise RuntimeError("Не удалось проверить извлечённые утверждения")
    by_index = {v.get("claim_index"): v for v in verdicts if isinstance(v, dict)}
    for i, claim in enumerate(claims):
        verdict = by_index.get(i, {})
        claim["status"] = verdict.get("status", "partial")
        claim["confidence"] = max(0, min(1, float(verdict.get("confidence", 0.5))))
        claim["verification_reason"] = verdict.get("reason", "")
    return claims


async def _write_report(query: str, plan: dict, claims: list[dict], docs: list[dict]) -> str:
    usable = [c for c in claims if c.get("status") in ("supported", "partial")]
    source_map = {d["source_index"]: d for d in docs}
    sections = []
    for section in plan.get("report_sections", []):
        supported_by = set(section.get("supported_by") or [])
        evidence = []
        for c in usable:
            src = source_map.get(c.get("source_index"))
            if src and (not supported_by or src.get("question_id") in supported_by):
                evidence.append({"claim": c.get("claim"), "status": c.get("status"), "confidence": c.get("confidence"), "is_estimate": c.get("is_estimate"), "period": c.get("period"), "geography": c.get("geography")})
        system = """Напиши один раздел профессионального глубокого исследования на русском языке. Синтезируй данные, не пересказывай источники по очереди. Используй только утверждения из evidence: не добавляй факты, числа, даты, названия организаций или выводы, которых там нет. Не используй отвергнутые факты. Оценки явно называй оценками Pitchy. Если данных недостаточно, честно и кратко укажи ограничение вместо догадки. Не вставляй URL, Markdown-ссылки, номера источников или список источников — интерфейс показывает источники отдельно. Не повторяй название раздела и не добавляй вводную или заключение за его пределами."""
        prompt = f"Исходный запрос: {query}\nНазвание раздела: {section.get('title')}\nЦель: {plan.get('objective')}\nПроверенные утверждения:\n{json.dumps(evidence[:60], ensure_ascii=False)}"
        content, _, _ = await call_makura(system, prompt, model=WRITER_MODEL)
        body = (content or "Недостаточно подтверждённых данных для раздела.").strip()
        body = re.sub(r"^\s*#{1,6}\s+[^\n]+\n+", "", body, count=1)
        sections.append(f"## {section.get('title')}\n\n{body}")
    conflicts = [c for c in claims if c.get("status") in ("conflict", "rejected")]
    if conflicts:
        sections.append("## Противоречия и исключённые утверждения\n\n" + "\n".join(f"- {c.get('claim')} — {c.get('verification_reason') or c.get('status')}" for c in conflicts[:15]))
    return "\n\n".join(sections)

async def run_research_job(job_id: int) -> None:
    try:
        if not await _update(job_id, "planning", 5, "Формирую план исследования", started_at=datetime.utcnow()): return
        async with AsyncSessionLocal() as db:
            job = await db.get(ResearchJob, job_id); query = job.query if job else ""
        plan = await _plan(query)
        if not await _update(job_id, "searching", 18, f"Сформировано {len(plan['questions'])} исследовательских вопросов", blueprint=plan): return
        docs = await _collect(plan)
        if not docs: raise RuntimeError("Поиск не вернул пригодных источников")
        if not await _update(job_id, "reranking", 42, f"Найдено {len(docs)} источников, ранжирую релевантность"): return
        ranking = await rerank_documents(query, [f"{d['title']}\n{d['content'][:3800]}" for d in docs], top_n=30, model=RERANK_MODEL)
        if ranking:
            docs = [{**docs[r["index"]], "relevance_score": r["relevance_score"]} for r in ranking if 0 <= r["index"] < len(docs)]
        docs = docs[:30]
        for i, doc in enumerate(docs, 1): doc["source_index"] = i
        if not await _update(job_id, "extracting", 55, f"Отобрано {len(docs)} источников, извлекаю факты"): return
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
        if not await _update(job_id, "verifying", 70, f"Извлечено {len(claims)} утверждений, проверяю противоречия"): return
        claims = await _verify(query, claims, docs)
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ResearchClaim).where(ResearchClaim.job_id == job_id))
            for c in claims:
                claim=ResearchClaim(job_id=job_id,claim=str(c.get("claim",""))[:8000],value_text=c.get("value_text"),unit=c.get("unit"),period=c.get("period"),geography=c.get("geography"),status=c.get("status","partial"),confidence=c.get("confidence",0.5),is_estimate=bool(c.get("is_estimate")))
                db.add(claim); await db.flush()
                sid=source_db_ids.get(c.get("source_index"))
                if sid and c.get("passage"): db.add(ResearchEvidence(claim_id=claim.id,source_id=sid,passage=str(c["passage"])[:12000],supports=c.get("status") not in ("conflict","rejected")))
            await db.commit()
        if not await _update(job_id, "writing", 82, "Пишу отчёт по разделам"): return
        report = await _write_report(query, plan, claims, docs)
        public_sources=[{"title":d["title"],"url":d["url"],"index":d["source_index"],"relevance_score":d.get("relevance_score")} for d in docs]
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
