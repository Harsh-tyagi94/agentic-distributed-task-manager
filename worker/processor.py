import time
import traceback

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.redis import AsyncRedisSaver

from worker.agent import AgentState, build_graph
from worker.config import get_logger
from worker.metrics import ACTIVE_TASKS, JOB_DURATION, JOBS_PROCESSED

logger = get_logger(__name__)


def _extract_prompt(job_data: dict) -> str | None:
    if not isinstance(job_data, dict):
        return None
    payload = job_data.get("payload", {})
    if not isinstance(payload, dict):
        return None
    return payload.get("prompt")


async def process_agent_task(job, job_token, checkpointer) -> dict:
    """
    BullMQ job handler. Receives a compiled checkpointer injected from main()
    so we reuse one Redis connection across all jobs.
    """
    job_type = job.data.get("type", "unknown") if isinstance(job.data, dict) else "unknown"
    logger.info("Picked up job id=%s type=%s", job.id, job_type)

    prompt_text = _extract_prompt(job.data)
    if not prompt_text:
        logger.error("No prompt found in job data: %s", job.data)
        JOBS_PROCESSED.labels(job_type=job_type, status="failed").inc()
        raise ValueError(f"Missing prompt in job {job.id}. Data received: {job.data}")

    initial_state: AgentState = {
        "messages": [HumanMessage(content=prompt_text)],
        "job_id": job.id,
    }
    config = {"configurable": {"thread_id": job.id}}

    ACTIVE_TASKS.inc()
    start = time.monotonic()

    try:
        # Reuse the injected checkpointer — no new connection opened here
        app = build_graph().compile(checkpointer=checkpointer)
        final_state = await app.ainvoke(initial_state, config=config)

        output = final_state["messages"][-1].content
        logger.info("Job %s completed. Output length: %d chars", job.id, len(output))
        JOBS_PROCESSED.labels(job_type=job_type, status="success").inc()

        return {"status": "completed", "output": output}

    except Exception:
        logger.error("Job %s failed:\n%s", job.id, traceback.format_exc())
        JOBS_PROCESSED.labels(job_type=job_type, status="failed").inc()
        raise  # re-raise so BullMQ triggers retry

    finally:
        elapsed = time.monotonic() - start
        JOB_DURATION.labels(job_type=job_type).observe(elapsed)
        ACTIVE_TASKS.dec()
