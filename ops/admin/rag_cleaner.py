import os
import re
import shutil
import logging
import argparse
from pathlib import Path
from datetime import datetime

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("RAG-Cleaner")

# We import the logic from rag.py to ensure consistency
try:
    import rag
except ImportError:
    import sys
    sys.path.append(os.getcwd())
    import rag

ADMIN_DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))

def identify_target_category(file_path: Path, content: str) -> str:
    """Decides which collection a file belongs to based on content and current path.
    Note: Real semantic isolation happens at the chunk level in rag.py, 
    but this helps with initial document management.
    """
    content_lower = content.lower()
    
    # Check for profiles/contacts (The most important isolation)
    contact_patterns = [r't\.me/', r'http', r'@[\w_]+', r'\+\d{10,15}', r'никнейм', r'founder', r'основатель']
    if sum(1 for p in contact_patterns if re.search(p, content_lower)) >= 3:
        return "project_profiles"
        
    # Check for legal/taxes
    legal_patterns = ["налог", "закон", "оферта", "юрист", "договор", "право", "regulation", "tax", "law"]
    if any(p in content_lower for p in legal_patterns):
        return "legal_regulations"
        
    # Check for hard analytics/market
    market_patterns = ["рынок", "объем", "тренд", "анализ", "конкурент", "market", "size", "trend", "analysis"]
    if any(p in content_lower for p in market_patterns):
        return "market_analysis"
    
    # Check for pitching/economics
    pitch_patterns = ["питч", "презентация", "юнит", "экономика", "инвестор", "выступление", "pitch", "deck", "economics"]
    if any(p in content_lower for p in pitch_patterns):
        return "pitching_tips"

    # Default to general if unsure
    return "general"

def migrate_files():
    """Moves files to their semantically correct subdirectories in admin_docs."""
    logger.info("Step 1: Analyzing and migrating files in admin_docs...")
    
    # We look at all .txt files in admin_docs (including subfolders)
    all_files = list(ADMIN_DOCS_DIR.rglob("*.txt"))
    logger.info(f"Found {len(all_files)} files to check.")
    
    counts = {cat: 0 for cat in rag.CATEGORIES}
    moved = 0
    
    for file_path in all_files:
        try:
            content = file_path.read_text(encoding="utf-8")
            target_cat = identify_target_category(file_path, content)
            
            target_dir = ADMIN_DOCS_DIR / target_cat
            target_dir.mkdir(parents=True, exist_ok=True)
            
            target_path = target_dir / file_path.name
            
            if file_path.absolute() != target_path.absolute():
                logger.info(f"Moving {file_path.name} -> {target_cat}/")
                shutil.move(str(file_path), str(target_path))
                moved += 1
            
            counts[target_cat] += 1
        except Exception as e:
            logger.error(f"Failed to process {file_path}: {e}")
            
    logger.info(f"Migration complete. Total moved: {moved}. Current distribution: {counts}")

def perform_reindex():
    """Triggers a full rebuild of the ChromaDB collections."""
    logger.info("Step 2: Triggering full re-indexing in ChromaDB...")
    
    # Force reindex via env var
    os.environ["CHROMA_REINDEX"] = "true"
    
    try:
        # This will call StartupRAG.build() which wipes and seeds
        rag.init_rag()
        logger.info("Re-indexing complete.")
    except Exception as e:
        logger.error(f"Re-indexing failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RAG Semantic Isolation Tool")
    parser.add_argument("--migrate", action="store_true", help="Migrate files to correct subdirectories")
    parser.add_argument("--reindex", action="store_true", help="Wipe and re-index ChromaDB")
    parser.add_argument("--all", action="store_true", help="Perform migration AND re-indexing")
    
    args = parser.parse_args()
    
    if not any([args.migrate, args.reindex, args.all]):
        parser.print_help()
        exit(0)
        
    if args.migrate or args.all:
        migrate_files()
        
    if args.reindex or args.all:
        perform_reindex()
