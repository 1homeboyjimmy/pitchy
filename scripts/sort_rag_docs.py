import os
import shutil
import time
from pathlib import Path
import sys

# Add parent dir to path to import app modules
sys.path.append(str(Path(__file__).parent.parent))

from main import call_yandex_gpt, logger

CATEGORIES = {
    "pitching", "grants_and_funds", "unit_economics",
    "target_audience", "legal_and_taxes", "product_management",
    "platform_rules", "general", "useless"
}

DOCS_DIR = Path("sample_docs")
USELESS_DIR = DOCS_DIR / "useless"

def setup_dirs():
    for cat in CATEGORIES:
        (DOCS_DIR / cat).mkdir(exist_ok=True, parents=True)

def classify_doc(content: str, filename: str) -> str:
    # Take a snippet of the document to save tokens
    snippet = content[:2000]
    system_prompt = (
        "Ты — AI сортировщик документов. Твоя задача — прочитать отрывок документа и определить ЕДИНСТВЕННУЮ категорию из списка.\n"
        "Список категорий: pitching, grants_and_funds, unit_economics, target_audience, legal_and_taxes, product_management, platform_rules, general.\n"
        "ВАЖНОЕ ПРАВИЛО: Если документ вообще не связан ни с одной из этих тем, является бессмысленным набором символов, спамом или совершенно бесполезен для стартапера, ответь СТРОГО словом 'useless'.\n"
        "В остальных случаях выбери наиболее подходящую категорию. Ответь ТОЛЬКО названием категории без знаков препинания."
    )
    
    user_prompt = f"Файл: {filename}\nТекст:\n{snippet}"
    try:
        raw_response, usage = call_yandex_gpt(system_prompt, user_prompt)
        logger.info(f"YandexGPT classified {filename} as: {raw_response}")
        cat = raw_response.strip().lower()
        if cat in CATEGORIES:
            return cat
        else:
            return "general"
    except Exception as e:
        logger.error(f"Failed to classify {filename}: {e}")
        return "general"

def main():
    setup_dirs()
    
    # Get all .txt files in root of sample_docs
    txt_files = [f for f in DOCS_DIR.glob("*.txt") if f.is_file()]
    
    if not txt_files:
        print("No .txt files found in the root of sample_docs to sort.")
        return

    print(f"Found {len(txt_files)} files. Starting AI classification...\n")
    
    moved_count = 0
    useless_count = 0
    
    for file_path in txt_files:
        try:
            content = file_path.read_text(encoding="utf-8").strip()
            if not content:
                print(f"Skipping {file_path.name} (empty file)")
                continue
                
            print(f"Analyzing {file_path.name}...")
            category = classify_doc(content, file_path.name)
            
            dest_dir = DOCS_DIR / category
            dest_path = dest_dir / file_path.name
            
            # Move the file
            shutil.move(str(file_path), str(dest_path))
            print(f"[OK] Moved to -> {category}/")
            
            if category == "useless":
                useless_count += 1
            else:
                moved_count += 1
                
            # Pause to respect AI rate limits
            time.sleep(1)
            
        except Exception as e:
            print(f"[ERROR] Error processing {file_path.name}: {e}")
            
    print(f"\nSorting complete! Successfully sorted {moved_count} files into categories. Moved {useless_count} files to 'useless/'.")
    print("\nYou can now restart the backend to trigger CHROMA_REINDEX and ingest these files into the new Multi-RAG system.")

if __name__ == "__main__":
    main()
