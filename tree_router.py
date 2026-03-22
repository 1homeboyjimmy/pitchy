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

from auth import get_current_user
from db import get_db, SessionLocal
from models import User, ProjectTree
from schemas import TreeCreateRequest, TreeResponse, TreeNodeUpdateRequest
from tree_orchestrator import generate_tree_from_text, generate_tree_from_pdf

logger = logging.getLogger("app")

router = APIRouter(prefix="/tree", tags=["tree"])


# ——— REST Endpoints ———

@router.post("/create", response_model=TreeResponse)
async def create_tree(
    payload: TreeCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeResponse:
    """Create a decision tree from text description."""
    # Create DB record first
    tree = ProjectTree(
        user_id=user.id,
        title="Генерация...",
        source_type="text",
        source_text=payload.description,
        status="generating",
    )
    db.add(tree)
    db.commit()
    db.refresh(tree)

    # Generate tree structure via AI
    try:
        result = await generate_tree_from_text(payload.description)
        tree.title = result.get("title", "Анализ стартапа")
        tree.tree_data = result.get("tree_data", {})
        tree.readiness_index = result.get("readiness_index", 0)
        tree.status = "ready"
    except Exception as e:
        logger.error(f"Tree generation failed: {e}")
        tree.status = "error"

    tree.updated_at = datetime.utcnow()
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
