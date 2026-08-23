"""
FastAPI router for Smart Roadmap (Интерактивная дорожная карта) endpoints.

REST API:
- POST /tree/create — create roadmap from text
- POST /tree/upload-pdf — create roadmap from PDF upload
- GET  /tree/list — list user's roadmaps
- GET  /tree/{tree_id} — get single roadmap
- PATCH /tree/{tree_id}/nodes/{node_id} — update a block
- DELETE /tree/{tree_id} — delete roadmap

WebSocket:
- WS /tree/{tree_id}/ws — streaming roadmap updates
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from auth import get_async_current_user
from db_async import get_async_db, AsyncSessionLocal
from models import User, ProjectTree, TreeChatHistory
from schemas import TreeCreateRequest, TreeResponse, TreeNodeUpdateRequest, TreeChatRequest, TreeChatResponse, TreeEvaluateRequest
from tree_orchestrator import generate_tree_from_text, generate_tree_from_pdf
from chat_orchestrator import ChatOrchestrator

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

class NullSpan:
    def update(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass

def get_span(name: str):
    if langfuse_context:
        return langfuse_context.span(name=name)
    return NullSpan()

logger = logging.getLogger("app")

router = APIRouter(prefix="/tree", tags=["Smart Roadmap"])


# ——— REST Endpoints ———

@router.post("/create", response_model=TreeResponse)
@observe(name="Smart Roadmap Quick Create")
async def create_tree(
    payload: TreeCreateRequest,
    request: Request,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> TreeResponse:
    """Create a Smart Roadmap starting with Universal Base Nodes."""
    from subscription_service import consume_quota, require_legacy_access
    handled = await consume_quota(
        db, user, "roadmaps",
        idempotency_key=request.headers.get("X-Idempotency-Key") or f"roadmap:text:{user.id}:{hash(payload.description)}",
        reference_type="project_tree",
    )
    if not handled:
        require_legacy_access(user, "roadmaps")
    
    from core_tree import UNIVERSAL_BASE_NODES
    import copy

    # Instant skeleton initialization instead of slow AI generation
    nodes = copy.deepcopy(UNIVERSAL_BASE_NODES)
    
    # Simple edges for the base nodes (all connected to root)
    edges = [
        {"id": f"e-root-{n['id']}", "source": "root", "target": n["id"]}
        for n in nodes
    ]

    tree = ProjectTree(
        user_id=user.id,
        title=payload.description[:50] + "...",
        source_type="text",
        source_text=payload.description,
        status="ready",  # Ready immediately with base nodes
        tree_data={
            "nodes": nodes,
            "edges": edges
        },
        readiness_index=0
    )
    db.add(tree)
    await db.commit()
    await db.refresh(tree)

    return TreeResponse.model_validate(tree)


@router.post("/upload-pdf", response_model=TreeResponse)
@observe(name="Smart Roadmap PDF Upload")
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> TreeResponse:
    """Upload a PDF and generate a decision tree from its contents."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Только PDF файлы поддерживаются")

    # Read file
    content = await file.read()
    from subscription_service import consume_quota, require_legacy_access
    handled = await consume_quota(
        db, user, "roadmaps",
        idempotency_key=request.headers.get("X-Idempotency-Key") or f"roadmap:pdf:{user.id}:{hash(content)}",
        reference_type="project_tree_pdf",
    )
    if not handled:
        require_legacy_access(user, "roadmaps")
    if len(content) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 20 МБ)")

    # Extract text from PDF
    try:
        from pypdf import PdfReader
        import io

        reader = PdfReader(io.BytesIO(content))
        text_parts = []
        page_refs: dict[str, int] = {}

        for i, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            text_parts.append(page_text)

            # Basic keyword detection for source grounding
            lower = page_text.lower()
            for keyword in ["продукт", "рынок", "там", "sam", "som", "монетизация", "цена", "команда", "юнит", "unit"]:
                if keyword in lower and keyword not in page_refs:
                    page_refs[keyword] = i + 1

        full_text = "\n".join(text_parts)

        if len(full_text.strip()) < 50:
            raise HTTPException(status_code=400, detail="Не удалось извлечь текст из PDF")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF parsing failed: {e}")
        raise HTTPException(status_code=400, detail="Ошибка чтения PDF файла")

    # Create DB record
    tree = ProjectTree(
        user_id=user.id,
        title="Анализ PDF...",
        source_type="pdf",
        source_text=full_text[:10000],  # Store first 10K chars
        status="generating",
    )
    db.add(tree)
    await db.commit()
    await db.refresh(tree)

    # Generate tree structure
    try:
        result = await generate_tree_from_pdf(full_text, page_refs)
        tree.title = result.get("title", f"Анализ: {file.filename}")
        tree.tree_data = result.get("tree_data", {})
        tree.readiness_index = result.get("readiness_index", 0)
        tree.status = "ready"
    except Exception as e:
        logger.error(f"PDF tree generation failed: {e}")
        tree.status = "error"

    tree.updated_at = datetime.utcnow()
    flag_modified(tree, "tree_data")
    await db.commit()
    await db.refresh(tree)

    return TreeResponse.model_validate(tree)


@router.get("/list", response_model=list[TreeResponse])
async def list_trees(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[TreeResponse]:
    """List all trees for the authenticated user."""
    res = await db.execute(
        select(ProjectTree)
        .where(ProjectTree.user_id == user.id)
        .order_by(ProjectTree.created_at.desc())
        .limit(50)
    )
    trees = res.scalars().all()
    return [TreeResponse.model_validate(t) for t in trees]


@router.get("/{tree_id}", response_model=TreeResponse)
async def get_tree(
    tree_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> TreeResponse:
    """Get a single tree by ID."""
    res = await db.execute(
        select(ProjectTree)
        .where(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
    )
    tree = res.scalar_one_or_none()
    if not tree:
        raise HTTPException(status_code=404, detail="Древо не найдено")
    return TreeResponse.model_validate(tree)


@router.patch("/{tree_id}/nodes/{node_id}")
async def update_tree_node(
    tree_id: int,
    node_id: str,
    payload: TreeNodeUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Update a specific node in the tree."""
    res = await db.execute(
        select(ProjectTree)
        .where(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
    )
    tree = res.scalar_one_or_none()
    if not tree:
        raise HTTPException(status_code=404, detail="Древо не найдено")

    tree_data = tree.tree_data or {}
    nodes = tree_data.get("nodes", [])

    # Find and update node
    updated = False
    for node in nodes:
        if node.get("id") == node_id:
            if payload.data:
                node_data = node.get("data", {})
                update_dict = payload.data.model_dump(exclude_none=True)
                node_data.update(update_dict)
                node["data"] = node_data
            if payload.status:
                node["status"] = payload.status
            updated = True
            break

    if not updated:
        raise HTTPException(status_code=404, detail="Узел не найден")

    tree.tree_data = tree_data
    tree.updated_at = datetime.utcnow()

    # Recalculate readiness index
    total = len(nodes)
    completed = sum(1 for n in nodes if n.get("status") == "completed")
    tree.readiness_index = int((completed / max(total, 1)) * 100)

    flag_modified(tree, "tree_data")
    await db.commit()

    return {"status": "ok", "readiness_index": tree.readiness_index}


@router.post("/{tree_id}/chat")
async def tree_chat(
    tree_id: int,
    payload: TreeChatRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Intelligent chat orchestration for the decision tree (Streaming)."""
    from fastapi.responses import StreamingResponse

    tree_result = await db.execute(
        select(ProjectTree).where(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
    )
    if tree_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Roadmap not found")

    # Replay completed requests and reject ambiguous half-finished duplicates.
    # The database partial unique index is the final race-condition guard.
    if payload.assistant_client_id:
        assistant_result = await db.execute(
            select(TreeChatHistory).where(
                TreeChatHistory.project_id == tree_id,
                TreeChatHistory.client_id == payload.assistant_client_id,
            )
        )
        existing_assistant = assistant_result.scalar_one_or_none()
        if existing_assistant:
            async def replay():
                events = [
                    {"type": "metadata", "model": "Pitchy (replay)"},
                    {"type": "chunk", "content": existing_assistant.message or ""},
                    {"type": "final", "assistant_client_id": payload.assistant_client_id},
                ]
                for event in events:
                    yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

            return StreamingResponse(replay(), media_type="text/event-stream")

    if payload.client_id:
        user_message_result = await db.execute(
            select(TreeChatHistory).where(
                TreeChatHistory.project_id == tree_id,
                TreeChatHistory.client_id == payload.client_id,
            )
        )
        if user_message_result.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Chat request is already being processed")

        db.add(TreeChatHistory(
            project_id=tree_id,
            role="user",
            message=payload.message,
            client_id=payload.client_id,
            node_id=payload.active_node_id,
        ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Chat request is already being processed")

    orchestrator = ChatOrchestrator(tree_id, user.id, db)
    
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Encoding": "identity",
        "X-Content-Type-Options": "nosniff"
    }
    return StreamingResponse(
        orchestrator.process_message(
            payload.message,
            payload.active_node_id,
            client_id=payload.client_id,
            assistant_client_id=payload.assistant_client_id,
            persist_user_message=not bool(payload.client_id),
        ),
        media_type="text/event-stream",
        headers=headers
    )

@router.get("/{tree_id}/history")
async def get_tree_chat_history(
    tree_id: int,
    node_id: str | None = None,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Retrieve chat history for a specific tree or node from Redis/DB."""
    orchestrator = ChatOrchestrator(tree_id, user.id, db)
    history = await orchestrator.get_chat_history(node_id=node_id)
    
    if not history and node_id:
        # Create an automated greeting if history is empty
        res = await db.execute(select(ProjectTree).where(ProjectTree.id == tree_id))
        tree = res.scalar_one_or_none()
        node_label = "этого блока"
        if tree and tree.tree_data:
            nodes = tree.tree_data.get("nodes", [])
            node = next((n for n in nodes if n["id"] == node_id), None)
            if node:
                node_label = f"блока **'{node.get('label')}'**"

        greeting = f"Привет! Я Pitchy AI. Я готов помочь тебе заполнить данные для {node_label}. Что именно мы хотим здесь уточнить или рассчитать?"
        await orchestrator.add_chat_message("assistant", greeting, node_id=node_id)
        # Reload history to include the new message
        history = await orchestrator.get_chat_history(node_id=node_id)

    return {"history": history}


@router.post("/{tree_id}/evaluate-node")
@observe(name="Smart Roadmap Evaluation")
async def evaluate_node(
    tree_id: int,
    payload: TreeEvaluateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Evaluate a node using form data and dynamic branching."""
    from makura_client import call_makura
    import copy

    res = await db.execute(select(ProjectTree).where(ProjectTree.id == tree_id, ProjectTree.user_id == user.id))
    tree = res.scalar_one_or_none()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    tree_data = copy.deepcopy(tree.tree_data)
    nodes = tree_data.get("nodes", [])
    edges = tree_data.get("edges", [])

    # Find the target node
    target_node = next((n for n in nodes if n["id"] == payload.node_id), None)
    if not target_node:
        raise HTTPException(status_code=404, detail="Node not found")

    # LLM Analysis
    prompt = f"""Ты — строгий венчурный аналитик. Основатель стартапа заполнил блок '{target_node.get('label')}'.
Ответы основателя (form_data): {json.dumps(payload.form_data, ensure_ascii=False)}.

Твоя задача:
1. Создать краткую выжимку (summary) из ответов. Максимум 3-4 ключа. Значения должны быть очень короткими (1-3 слова), так как они пойдут в UI-таблицу.
2. Дать профессиональный фидбек (feedback). Укажи на риски, слепые зоны или похвали за четкость.

Верни СТРОГО JSON:
{{ "summary": {{ "Ключ1": "Значение1", "Ключ2": "Значение2" }}, "feedback": "Твой развернутый комментарий" }}"""

    with get_span(name="LLM Analysis") as span:
        try:
            raw_ai, _, _ = await call_makura("Ты — бизнес-аналитик. Отвечай СТРОГО в формате JSON.", prompt)
            # Parse JSON from AI
            start = raw_ai.find("{")
            end = raw_ai.rfind("}") + 1
            ai_res = json.loads(raw_ai[start:end])
        except Exception as e:
            logger.error(f"Analysis failed: {e}")
            ai_res = {
                "summary": {"Status": "Ошибка анализа"},
                "feedback": "Не удалось проанализировать данные. Попробуйте еще раз."
            }
        span.update(metadata={"node_id": payload.node_id})

    # Update Node
    target_node["status"] = "completed"
    target_node["data"]["summary"] = ai_res.get("summary", {})
    target_node["data"]["feedback"] = ai_res.get("feedback", "")
    target_node["data"]["form_data"] = payload.form_data # Save the inputs too

    # Dynamic Branching Logic
    new_nodes = []
    with get_span(name="Branch Generation") as span:
        if payload.node_id == "audience":
            # Add Channels and Competitors
            if not any(n["id"] == "channels" for n in nodes):
                new_nodes.append({
                    "id": "channels", "type": "customAnalysis", "status": "active", "label": "Каналы продаж", "level": 2, "parent_id": "audience",
                    "data": {"label": "Каналы продаж", "form_schema": [
                        {"id": "primary", "label": "Основной канал", "type": "textarea", "placeholder": "SEO, Ads..."},
                        {"id": "budget", "label": "Тестовый бюджет", "type": "textarea", "placeholder": "100к руб..."}
                    ]}
                })
            if not any(n["id"] == "competitors" for n in nodes):
                new_nodes.append({
                    "id": "competitors", "type": "customAnalysis", "status": "active", "label": "Конкуренты", "level": 2, "parent_id": "audience",
                    "data": {"label": "Конкуренты", "form_schema": [
                        {"id": "list", "label": "Кто конкуренты?", "type": "textarea", "placeholder": "Google, Yandex..."},
                        {"id": "advantage", "label": "Ваше преимущество", "type": "textarea", "placeholder": "В 10 раз быстрее..."}
                    ]}
                })
        elif payload.node_id == "solution":
            if not any(n["id"] == "monetization" for n in nodes):
                new_nodes.append({
                    "id": "monetization", "type": "customAnalysis", "status": "active", "label": "Монетизация", "level": 2, "parent_id": "solution",
                    "data": {"label": "Монетизация", "form_schema": [
                        {"id": "model", "label": "Модель дохода", "type": "textarea", "placeholder": "SaaS, Реклама..."},
                        {"id": "price", "label": "Средний чек", "type": "textarea", "placeholder": "500 руб/мес..."}
                    ]}
                })
        span.update(metadata={"new_nodes_count": len(new_nodes)})

    # Recalculate node positions for new_nodes
    if new_nodes:
        with get_span(name="Node Layout & Relation Mapping") as span:
            # Get parent position
            parent_x = target_node.get("position", {}).get("x", 0)
            parent_y = target_node.get("position", {}).get("y", 0)
            
            y_offset = 250
            x_spacing = 350
            num_new = len(new_nodes)
            
            for i, nn in enumerate(new_nodes):
                calc_x = parent_x + (i - (num_new - 1) / 2) * x_spacing
                nn["position"] = {"x": calc_x, "y": parent_y + y_offset}
                nodes.append(nn)
                edges.append({"id": f"e-{nn['parent_id']}-{nn['id']}", "source": nn["parent_id"], "target": nn["id"]})
            span.update(metadata={"edges_created": len(new_nodes)})

    # Recalculate Index
    total = len(nodes)
    completed = sum(1 for n in nodes if n["status"] == "completed")
    tree.readiness_index = int((completed / max(total, 1)) * 100)
    
    # CRITICAL: Re-assign and flag modified for SQLAlchemy to detect JSON change
    tree.tree_data = {"nodes": nodes, "edges": edges}
    flag_modified(tree, "tree_data")
    
    tree.updated_at = datetime.utcnow()
    await db.commit()

    return TreeResponse.model_validate(tree)


@router.delete("/{tree_id}")
async def delete_tree(
    tree_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Delete a tree."""
    res = await db.execute(
        select(ProjectTree)
        .where(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
    )
    tree = res.scalar_one_or_none()
    if not tree:
        raise HTTPException(status_code=404, detail="Древо не найдено")

    await db.delete(tree)
    await db.commit()
    return {"status": "deleted"}


# ——— WebSocket for streaming updates ———

@router.websocket("/{tree_id}/ws")
async def tree_websocket(
    websocket: WebSocket,
    tree_id: int,
):
    """
    WebSocket endpoint for real-time tree updates.
    Sends updates as the AI generates/modifies nodes.
    """
    await websocket.accept()

    try:
        # Verify access
        # In production, authenticate via token in query params
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(ProjectTree).where(ProjectTree.id == tree_id))
            tree = res.scalar_one_or_none()
            if not tree:
                await websocket.send_json({"type": "error", "data": {"message": "Tree not found"}})
                await websocket.close()
                return

            # Send initial state
            await websocket.send_json({
                "type": "init",
                "data": {
                    "tree_data": tree.tree_data,
                    "readiness_index": tree.readiness_index,
                    "status": tree.status,
                },
            })

        # Keep connection alive and listen for updates
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                data = json.loads(msg)

                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif data.get("type") == "refresh":
                    async with AsyncSessionLocal() as db:
                        res = await db.execute(select(ProjectTree).where(ProjectTree.id == tree_id))
                        tree = res.scalar_one_or_none()
                        if tree:
                            await websocket.send_json({
                                "type": "update",
                                "data": {
                                    "tree_data": tree.tree_data,
                                    "readiness_index": tree.readiness_index,
                                    "status": tree.status,
                                },
                            })
            except asyncio.TimeoutError:
                # Send keepalive
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for tree {tree_id}")
    except Exception as e:
        logger.error(f"WebSocket error for tree {tree_id}: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
