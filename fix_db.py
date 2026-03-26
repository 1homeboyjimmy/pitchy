import os
import psycopg2

# Manual override for Windows host to connect to Docker container
db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app")
db_url = db_url.replace("+psycopg2", "") # Remove SQLAlchemy dialect
if "postgres:5432" in db_url:
    db_url = db_url.replace("postgres:5432", "localhost:5432")

print(f"Connecting to: {db_url}")

try:
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        print("Checking for node_id column...")
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='tree_chat_history' AND column_name='node_id';
        """)
        if not cur.fetchone():
            print("Adding node_id column...")
            cur.execute("ALTER TABLE tree_chat_history ADD COLUMN node_id VARCHAR(50);")
            print("DONE!")
        else:
            print("Already exists.")
    conn.close()
except Exception as e:
    print(f"CONNECTION ERROR: {e}")
    print("\nPROBABLE CAUSE: Docker containers are not running or port 5432 is not exposed.")
