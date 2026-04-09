import os
import logging
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("diagnose_langfuse")

def diagnose():
    print("=== Langfuse Diagnostic Script (Server Optimized) ===")
    
    # 1. Load .env
    print("\n1. Loading .env and environment...")
    load_dotenv()
    
    # 2. Check for keys and mapping
    base_url = os.getenv("LANGFUSE_BASE_URL")
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST")
    
    print(f"   LANGFUSE_PUBLIC_KEY: {'[SET]' if public_key else '[MISSING]'}")
    print(f"   LANGFUSE_SECRET_KEY: {'[SET]' if secret_key else '[MISSING]'}")
    print(f"   LANGFUSE_BASE_URL:   {base_url if base_url else '[NOT SET]'}")
    print(f"   LANGFUSE_HOST:       {host if host else '[NOT SET]'}")
    
    # Simulate the normalization logic from the app
    if base_url and not host:
        print("   👉 Normalizing LANGFUSE_BASE_URL to LANGFUSE_HOST...")
        os.environ["LANGFUSE_HOST"] = base_url
        host = base_url
    
    if not public_key or not secret_key:
        print("\n❌ Error: Missing Langfuse keys in environment.")
    
    # 3. Check for library installation
    print("\n2. Checking for langfuse library...")
    try:
        import langfuse
        from langfuse.decorators import observe, langfuse_context
        print(f"   ✅ langfuse version: {langfuse.__version__ if hasattr(langfuse, '__version__') else 'unknown'}")
    except ImportError:
        print("   ❌ Error: langfuse library not found.")
        return

    # 4. Attempt to send a test trace
    print("\n3. Sending test trace to Langfuse...")
    
    @observe(name="diagnostic_test_final")
    def test_function():
        print("      ...inside observed function...")
        if langfuse_context:
            langfuse_context.update_current_observation(
                input="Diagnostic check final",
                output="Successfully mapped and observed"
            )
            return "OK (context found)"
        return "OK (context missing but @observe ran)"

    try:
        result = test_function()
        print(f"   Result: {result}")
        
        from langfuse import Langfuse
        langf = Langfuse()
        print(f"   Flushing to {langf.base_url}...")
        langf.flush()
        print("   ✅ Test trace attempt complete. Check Langfuse dashboard.")
    except Exception as e:
        print(f"   ❌ Failed to send trace: {e}")

if __name__ == "__main__":
    diagnose()
