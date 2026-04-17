import asyncio
import os
from dotenv import load_dotenv
from bullmq import Worker
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

load_dotenv()

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.7,
    max_retries=2 # Internal LangChain retries before hitting BullMQ
)

async def process_agent_task(job, job_token):
    print(f"\n🤖 [AGENT START] Job ID: {job.id}")
    
    # Gap 1 structure: data contains a 'payload' object
    data = job.data
    payload = data.get("payload", {})
    prompt = payload.get("prompt") or data.get("prompt")

    if not prompt:
        print(f"⚠️  Missing prompt in Job {job.id}")
        return {"status": "failed", "error": "No prompt provided"}

    print(f"🧠 Reasoning (2.5 Flash) on: '{prompt[:150]}...'")

    try:
        # Using ainvoke for better concurrency
        response = await llm.ainvoke([HumanMessage(content=prompt)])

        print(f"✅ [AGENT COMPLETE] Job {job.id}")
        
        return {
            "status": "completed",
            "output": response.content,
            "metadata": {
                "model": "gemini-2.5-flash",
                "usage": response.response_metadata.get("token_usage")
            }
        }
    except Exception as e:
        print(f"❌ Agent Error on Job {job.id}: {e}")
        # Raising the error is what moves the job to 'failed' in BullMQ
        # and triggers the exponential backoff we set in Node.js
        raise e 

async def main():
    redis_host = os.getenv("REDIS_HOST", "localhost")
    print(f"🐍 Python Agent Worker (Gemini 2.5 Flash) online at {redis_host}...")

    worker = Worker("task-stream", process_agent_task, {
        "connection": f"redis://{redis_host}:6379"
    })

    try:
        # Native BullMQ run loop
        await worker.run()
    except (asyncio.CancelledError, KeyboardInterrupt):
        await worker.close()

if __name__ == "__main__":
    asyncio.run(main())
