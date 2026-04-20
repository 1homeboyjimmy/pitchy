import os
import logging
import argparse
import sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

# Add project root to path
sys.path.append(os.getcwd())

import rag

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("RAG-Maintenance")

def perform_reindex():
    """Triggers a full rebuild of the ChromaDB collections using the new Smart Ingestion pipeline."""
    logger.info("Triggering full re-indexing in ChromaDB...")
    
    # Force reindex via env var
    os.environ["CHROMA_REINDEX"] = "true"
    
    try:
        # StartupRAG.build() will now:
        # 1. Wipe collections
        # 2. Load all raw documents
        # 3. Use SLM to classify chunks (Smart Ingestion)
        # 4. Seed into isolated buckets
        rag.init_rag()
        logger.info("SMART RE-INDEXING COMPLETE.")
    except Exception as e:
        logger.error(f"Re-indexing failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RAG Smart Maintenance Tool")
    parser.add_argument("--reindex", action="store_true", help="Wipe and perform Smart Ingestion")
    
    args = parser.parse_args()
    
    if args.reindex:
        perform_reindex()
    else:
        # Default behavior for --all or no args
        perform_reindex()
