import os
import sys
import logging
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diag")

def diagnose():
    load_dotenv()
    
    logger.info("--- DIAGNOSTIC START ---")
    
    # Check Secret Key
    secret = os.getenv("APP_SECRET_KEY")
    if not secret:
        logger.error("MISSING: APP_SECRET_KEY is not set!")
    else:
        logger.info(f"FOUND: APP_SECRET_KEY is set (length: {len(secret)})")
        
    # Check Database URL
    db_url = os.getenv("DATABASE_URL", "sqlite:///./app.db")
    logger.info(f"USING DATABASE: {db_url}")
    
    try:
        engine = create_engine(db_url, connect_args={"check_same_thread": False} if db_url.startswith("sqlite") else {}, pool_pre_ping=True)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            logger.info(f"SUCCESS: Database connection established. Result: {result.scalar()}")
            
            # Check User table
            result = conn.execute(text("SELECT COUNT(*) FROM users"))
            logger.info(f"SUCCESS: User table exists. Count: {result.scalar()}")
            
    except Exception as e:
        logger.error(f"FAILURE: Database connection failed: {e}")
        
    logger.info("--- DIAGNOSTIC END ---")

if __name__ == "__main__":
    diagnose()
