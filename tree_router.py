"""
FastAPI router for Decision Tree endpoints.

REST API:
- POST /tree/create — create tree from text
- POST /tree/upload-pdf — create tree from PDF upload
- GET  /tree/list — list user's trees
- GET  /tree/{tree_id} — get single tree
- PATCH /tree/{tree_id}/nodes/{node_id} — update a node
- DELETE /tree/{tree_id} — delete tree

WebSocket:
- WS /tree/{tree_id}/ws — streaming tree updates
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_user
from db import get_db, SessionLocal
from models import User, ProjectTree
from schemas import TreeCreateRequest, TreeResponse, TreeNodeUpdateRequest, TreeChatRequest, TreeChatResponse, TreeEvaluateRequest
from tree_orchestrator import generate_tree_from_text, generate_tree_from_pdf
from chat_orchestrator import ChatOrchestrator

logger = logging.getLogger("app")

router = APIRouter(prefix="/tree", tags=["tree"])


# ——— REST Endpoints ———

@router.post("/create", response_model=TreeResponse)
async def create_tree(
    payload: TreeCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeResponse:
    """Create a decision tree starting with Universal Base Nodes."""
    if user.subscription_tier == "tester":
        raise HTTPException(status_code=403, detail="Древо стартапа недоступно в тарифе Tester. Оформите подписку.")
    
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
    db.commit()
    db.refresh(tree)

    return TreeResponse.model_validate(tree)


@router.post("/upload-pdf", response_model=TreeResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeResponse:
    """Upload a PDF and generate a decision tree from its contents."""
    if user.subscription_tier == "tester":
        raise HTTPException(status_code=403, detail="Загрузка PDF недоступна в тарифе Tester. Оформите подписку.")
        
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Только PDF файлы поддерживаются")

    # Read file
    content = await file.read()
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
    db.commit()
    db.refresh(tree)

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
    db.commit()
    db.refresh(tree)

    return TreeResponse.model_validate(tree)


@router.get("/list", response_model=list[TreeResponse])
def list_trees(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TreeResponse]:
    """List all trees for the authenticated user."""
    trees = (
        db.query(ProjectTree)
        .filter(ProjectTree.user_id == user.id)
        .order_by(ProjectTree.created_at.desc())
        .limit(50)
        .all()
    )
    return [TreeResponse.model_validate(t) for t in trees]


@router.get("/{tree_id}", response_model=TreeResponse)
def get_tree(
    tree_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeResponse:
    """Get a single tree by ID."""
    tree = (
        db.query(ProjectTree)
        .filter(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
        .first()
    )
    if not tree:
        raise HTTPException(status_code=404, detail="Древо не найдено")
    return TreeResponse.model_validate(tree)


@router.patch("/{tree_id}/nodes/{node_id}")
def update_tree_node(
    tree_id: int,
    node_id: str,
    payload: TreeNodeUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Update a specific node in the tree."""
    tree = (
        db.query(ProjectTree)
        .filter(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
        .first()
    )
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

    db.commit()

    return {"status": "ok", "readiness_index": tree.readiness_index}


@router.post("/{tree_id}/chat")
async def tree_chat(
    tree_id: int,
    payload: TreeChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Intelligent chat orchestration for the decision tree (Streaming)."""
    from fastapi.responses import StreamingResponse
    orchestrator = ChatOrchestrator(tree_id, user.id, db)
    
    return StreamingResponse(
        orchestrator.process_message(payload.message, payload.active_node_id, client_id=payload.client_id, assistant_client_id=payload.assistant_client_id),
        media_type="text/event-stream"
    )

@router.get("/{tree_id}/history")
async def get_tree_chat_history(
    tree_id: int,
    node_id: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieve chat history for a specific tree or node from Redis/DB."""
    orchestrator = ChatOrchestrator(tree_id, user.id, db)
    history = await orchestrator.get_chat_history(node_id=node_id)
    
    if not history and node_id:
        # Create an automated greeting if history is empty
        tree = db.query(ProjectTree).filter(ProjectTree.id == tree_id).first()
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
async def evaluate_node(
    tree_id: int,
    payload: TreeEvaluateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Evaluate a node using form data and dynamic branching."""
    from makura_client import call_makura
    import copy

    tree = db.query(ProjectTree).filter(ProjectTree.id == tree_id, ProjectTree.user_id == user.id).first()
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

    # Update Node
    target_node["status"] = "completed"
    target_node["data"]["summary"] = ai_res.get("summary", {})
    target_node["data"]["feedback"] = ai_res.get("feedback", "")
    target_node["data"]["form_data"] = payload.form_data # Save the inputs too

    # Dynamic Branching Logic
    new_nodes = []
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

    # Recalculate node positions for new_nodes
    if new_nodes:
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

    # Recalculate Index
    total = len(nodes)
    completed = sum(1 for n in nodes if n["status"] == "completed")
    tree.readiness_index = int((completed / max(total, 1)) * 100)
    
    # CRITICAL: Re-assign and flag modified for SQLAlchemy to detect JSON change
    tree.tree_data = {"nodes": nodes, "edges": edges}
    flag_modified(tree, "tree_data")
    
    tree.updated_at = datetime.utcnow()
    db.commit()

    return TreeResponse.model_validate(tree)


@router.delete("/{tree_id}")
def delete_tree(
    tree_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Delete a tree."""
    tree = (
        db.query(ProjectTree)
        .filter(ProjectTree.id == tree_id, ProjectTree.user_id == user.id)
        .first()
    )
    if not tree:
        raise HTTPException(status_code=404, detail="Древо не найдено")

    db.delete(tree)
    db.commit()
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
        with SessionLocal() as db:
            tree = db.query(ProjectTree).filter(ProjectTree.id == tree_id).first()
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
                    with SessionLocal() as db:
                        tree = db.query(ProjectTree).filter(ProjectTree.id == tree_id).first()
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
