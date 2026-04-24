import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { taskQueue } from "../queues/mainQueue.ts";
import { db } from "../config/db.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { jobEnqueuedCounter } from "../server.ts";

const priorityMap: Record<string, number> = {
  high: 1,
  standard: 2,
  low: 3,
};

const postedJob = asyncHandler(async (req: Request, res: Response) => {
  const { type, payload, idempotencyKey, priorityLevel } = req.body;
  const iKey = idempotencyKey || uuidv4();

  const selectedPriority = priorityMap[priorityLevel] || 2;

  const existingJob = await db.query(
    "SELECT job_id FROM job_audit WHERE idempotency_key = $1",
    [idempotencyKey],
  );

  if (existingJob.rows.length > 0) {
    return res.status(409).json({ error: "Duplicate task detected" });
  }

  // 2. Add to BullMQ with priority
  const job = await taskQueue.add(
    type,
    { payload },
    {
      jobId: idempotencyKey, // Use key as JobId for easier tracking
      priority: selectedPriority,
    },
  );

  jobEnqueuedCounter.inc({ job_type: type, priority: priorityLevel });

  // 3. Create Audit Record
  await db.query(
    "INSERT INTO job_audit (job_id, idempotency_key, job_type, status) VALUES ($1, $2, $3, $4)",
    [job.id, idempotencyKey, type, "pending"],
  );

  res.status(202).json({
    jobId: job.id,
    priority: priorityLevel || "standard",
    status: "accepted",
  });
});

const getAuditJobs = asyncHandler(async (req: Request, res: Response) => {
  const result = await db.query(
    "SELECT * FROM job_audit ORDER BY created_at DESC LIMIT 50",
  );
  res.json(result.rows);
});

const getJobStatusById = asyncHandler(async (req: Request, res: Response) => {
  const result = await db.query("SELECT * FROM job_audit WHERE job_id = $1", [
    req.params.id,
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
});

const getFailedJobs = asyncHandler(async (req: Request, res: Response) => {
  // Fetch jobs that have exhausted all 3 retries
  const failedJobs = await taskQueue.getFailed();

  const result = failedJobs.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  }));

  res.json(result);
});

const retryJob = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Job ID is required" });
  }

  if (Array.isArray(id)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }

  const job = await taskQueue.getJob(id);

  if (!job) {
    return res.status(404).json({ error: "Job not found in queue" });
  }

  // BullMQ built-in retry
  await job.retry();

  // Sync Postgres to show we are trying again
  await db.query(
    "UPDATE job_audit SET status = $1, error_log = NULL WHERE job_id = $2",
    ["pending", id],
  );

  res.json({ message: `Job ${id} moved from DLQ back to Processing.` });
});

export { postedJob, getAuditJobs, getJobStatusById, getFailedJobs, retryJob };
