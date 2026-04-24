import asyncio
import functools

from bullmq import Worker
from langgraph.checkpoint.redis import AsyncRedisSaver

from worker.config import METRICS_PORT, QUEUE_NAME, REDIS_URL, get_logger
from worker.metrics import start_metrics_server
from worker.processor import process_agent_task

logger = get_logger(__name__)

async def main() -> None:
    start_metrics_server()
    logger.info("Connecting to Redis at %s", REDIS_URL)
    logger.info("Monitoring queue: %s", QUEUE_NAME)

    async with AsyncRedisSaver.from_conn_string(REDIS_URL) as checkpointer:
        # Inject checkpointer into the handler via functools.partial
        # BullMQ calls handler(job, job_token) — we need a third arg
        handler = functools.partial(process_agent_task, checkpointer=checkpointer)

        connection_config = {
            "host": "localhost",
            "port": 6379,
        }

        # worker takes jobs/tasks from bullmq
        worker = Worker(QUEUE_NAME, handler, {"connection": connection_config})
        logger.info("Worker online. Press Ctrl+C to stop.")

        try:
            while True:
                await asyncio.sleep(1)
        except (asyncio.CancelledError, KeyboardInterrupt):
            logger.info("Shutting down worker...")
            await worker.close()

if __name__ == "__main__":
   asyncio.run(main())
