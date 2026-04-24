import logging
from prometheus_client import Counter, Gauge, Histogram, start_http_server
from worker.config import METRICS_PORT, get_logger

logger = get_logger(__name__)

JOBS_PROCESSED = Counter(
    "jobs_processed_total",
    "Total jobs processed by the Python worker",
    ["job_type", "status"],
)

JOB_DURATION = Histogram(
    "job_duration_seconds",
    "End-to-end job processing latency",
    ["job_type"],
    buckets=[1, 5, 10, 30, 60, 120],
)

ACTIVE_TASKS = Gauge(
    "active_agent_tasks",
    "Number of jobs currently being processed",
)

AGENT_TOOL_CALLS = Counter(
    "agent_tool_calls_total",
    "Total LLM tool calls made by the agent",
    ["tool_name"],
)


def start_metrics_server() -> None:
    try:
        start_http_server(METRICS_PORT)
        logger.info("Prometheus metrics server started on port %d", METRICS_PORT)
    except OSError as e:
        logger.error(
            "Failed to start metrics server on port %d: %s — "
            "Prometheus will not be able to scrape this worker.",
            METRICS_PORT, e,
        )
