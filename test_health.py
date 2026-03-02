import time

print("Testing DB...")
t0 = time.time()
try:
    from db import SessionLocal
    from sqlalchemy import text
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    print(f"DB OK in {time.time() - t0:.2f}s")
except Exception as e:
    print(f"DB FAILED: {e}")

print("Testing Redis...")
t0 = time.time()
try:
    import redis_client
    if redis_client.get_redis():
        redis_client.get_redis().ping()
        print(f"Redis OK in {time.time() - t0:.2f}s")
    else:
        print("Redis NOT CONFIGURED")
except Exception as e:
    print(f"Redis FAILED: {e}")

print("Testing RAG...")
t0 = time.time()
try:
    import rag
    # Note: rag might not be initialized, but we can try to call healthcheck 
    # Actually wait, rag.healthcheck() requires _RAG_INSTANCE to not be None
    rag.init_rag()
    res = rag.healthcheck()
    print(f"RAG OK: {res} in {time.time() - t0:.2f}s")
except Exception as e:
    print(f"RAG FAILED: {e}")
