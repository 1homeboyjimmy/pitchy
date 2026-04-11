"""
ChromaDB Cleanup Script
- Removes duplicate chunks (same text, different IDs)
- Removes junk chunks (UI elements, navigation, login forms, etc.)
- Reports stats before and after cleanup

Run inside backend container:
  docker compose -f docker-compose.prod.yml exec -T backend python cleanup_chroma.py
"""

import os
os.environ["CHROMA_SERVER_NOFILE"] = "65535"

import chromadb
import hashlib
import re

CHROMA_HTTP_HOST = os.getenv("CHROMA_HTTP_HOST", "chroma")
CHROMA_HTTP_PORT = int(os.getenv("CHROMA_HTTP_PORT", "8000"))

# Junk patterns — chunks matching these are low-quality scraped UI
JUNK_PATTERNS = [
    r"Войти через",
    r"Забыли пароль",
    r"Регистрация\s*$",
    r"пользовательское соглашение",
    r"cookie",
    r"Получать дайджест",
    r"Запомнить меня",
    r"Логин или Email",
    r"Insert$",
    r"Свежие стартапы.*по пятницам",
    r"^\s*\*\s*$",
    r"Product Radar",
    r"Подпишитесь на рассылку",
    r"Нажимая.*соглашаетесь",
    r"©\s*\d{4}",
    r"Все права защищены",
    r"Политика конфиденциальности",
    r"Условия использования",
    r"Toggle navigation",
    r"hamburger|navbar|sidebar",
    r"^\s*(Главная|Контакты|О нас|FAQ)\s*$",
]

# Compile patterns
JUNK_RE = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in JUNK_PATTERNS]

MIN_USEFUL_LENGTH = 80  # Chunks shorter than this are likely junk


def is_junk(text: str) -> bool:
    """Check if a chunk is low-quality scraped UI/navigation text."""
    stripped = text.strip()
    
    # Too short to be useful
    if len(stripped) < MIN_USEFUL_LENGTH:
        return True
    
    # Count how many junk patterns match
    junk_matches = sum(1 for pattern in JUNK_RE if pattern.search(stripped))
    
    # If 2+ junk patterns match, it's definitely junk
    if junk_matches >= 2:
        return True
    
    # High ratio of special characters / newlines (scraped UI)
    alpha_ratio = sum(1 for c in stripped if c.isalpha()) / max(len(stripped), 1)
    if alpha_ratio < 0.3:
        return True
    
    # Too many short lines (navigation menus)
    lines = [l.strip() for l in stripped.split('\n') if l.strip()]
    if len(lines) > 5:
        avg_line_len = sum(len(l) for l in lines) / len(lines)
        if avg_line_len < 20:  # Menu items are typically very short
            return True
    
    return False


def cleanup_collection(client, col_name: str) -> dict:
    """Clean up a single collection: remove duplicates and junk."""
    try:
        col = client.get_collection(name=col_name)
    except Exception:
        return {"name": col_name, "error": "not found"}
    
    count_before = col.count()
    if count_before == 0:
        return {"name": col_name, "before": 0, "after": 0, "duplicates": 0, "junk": 0}
    
    # Fetch all documents
    batch_size = 100
    all_ids = []
    all_docs = []
    
    for offset in range(0, count_before, batch_size):
        result = col.get(
            limit=batch_size,
            offset=offset,
            include=["documents"]
        )
        all_ids.extend(result["ids"])
        all_docs.extend(result["documents"])
    
    print(f"  [{col_name}] Fetched {len(all_ids)} chunks")
    
    # Find duplicates and junk
    seen_hashes = {}
    ids_to_delete = []
    duplicate_count = 0
    junk_count = 0
    
    for doc_id, doc_text in zip(all_ids, all_docs):
        if doc_text is None:
            ids_to_delete.append(doc_id)
            junk_count += 1
            continue
            
        text_hash = hashlib.md5(doc_text.encode('utf-8')).hexdigest()
        
        # Check for duplicate
        if text_hash in seen_hashes:
            ids_to_delete.append(doc_id)
            duplicate_count += 1
            continue
        
        seen_hashes[text_hash] = doc_id
        
        # Check for junk
        if is_junk(doc_text):
            ids_to_delete.append(doc_id)
            junk_count += 1
            # Also remove from seen_hashes so we don't keep it
            del seen_hashes[text_hash]
    
    # Delete in batches
    if ids_to_delete:
        for i in range(0, len(ids_to_delete), 100):
            batch = ids_to_delete[i:i+100]
            col.delete(ids=batch)
        print(f"  [{col_name}] Deleted {len(ids_to_delete)} chunks ({duplicate_count} duplicates, {junk_count} junk)")
    
    count_after = col.count()
    
    return {
        "name": col_name,
        "before": count_before,
        "after": count_after,
        "duplicates": duplicate_count,
        "junk": junk_count,
    }


def main():
    print("Connecting to ChromaDB...")
    client = chromadb.HttpClient(host=CHROMA_HTTP_HOST, port=CHROMA_HTTP_PORT)
    
    collections = client.list_collections()
    print(f"Found {len(collections)} collections\n")
    
    total_before = 0
    total_after = 0
    total_duplicates = 0
    total_junk = 0
    
    results = []
    for col in collections:
        print(f"Processing {col.name}...")
        result = cleanup_collection(client, col.name)
        results.append(result)
        
        if "error" not in result:
            total_before += result["before"]
            total_after += result["after"]
            total_duplicates += result["duplicates"]
            total_junk += result["junk"]
    
    # Summary
    print("\n" + "=" * 60)
    print("CLEANUP SUMMARY")
    print("=" * 60)
    print(f"{'Collection':<25} {'Before':>8} {'After':>8} {'Dupes':>8} {'Junk':>8}")
    print("-" * 60)
    for r in results:
        if "error" in r:
            print(f"{r['name']:<25} ERROR: {r['error']}")
        else:
            print(f"{r['name']:<25} {r['before']:>8} {r['after']:>8} {r['duplicates']:>8} {r['junk']:>8}")
    print("-" * 60)
    print(f"{'TOTAL':<25} {total_before:>8} {total_after:>8} {total_duplicates:>8} {total_junk:>8}")
    print(f"\nSaved: {total_before - total_after} chunks removed ({total_duplicates} duplicates + {total_junk} junk)")


if __name__ == "__main__":
    main()
