import os
import traceback
import asyncio

# Setup the environment mapping locally for our test
os.environ.setdefault('LANGFUSE_HOST', os.environ.get('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com'))

try:
    from langfuse.decorators import observe, langfuse_context
    from langfuse import Langfuse

    print("Langfuse is imported")
    
    @observe(name="my_test_stream", as_type="generation")
    async def my_generator():
        print("Generator Started")
        yield "Hello"
        await asyncio.sleep(0.5)
        yield "World"
        print("Generator Ended")
        
    async def main():
        print("Starting stream consume...")
        async for c in my_generator():
            print(f"Yield: {c}")
        
        print("Flushing...")
        client = Langfuse()
        client.flush()
        print("Done flushing!")
        
    asyncio.run(main())
except Exception as e:
    traceback.print_exc()
