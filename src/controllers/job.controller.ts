import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { taskQueue } from '../queues/mainQueue.ts';
import { db } from '../config/db.ts';
import { asyncHandler } from '../utils/asyncHandler.ts';

const postedJob = asyncHandler(async (req: Request, res: Response) => {
  const { type, payload, idempotencyKey } = req.body;
  const iKey = idempotencyKey || uuidv4();

  const result = await db.query(
    `INSERT INTO job_audit (job_id, idempotency_key, job_type) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (idempotency_key) DO NOTHING 
     RETURNING job_id`,
    [uuidv4(), iKey, type]
  );

  if (result.rowCount === 0) {
    return res.status(409).json({ error: 'Duplicate request detected' });
  }

  const jobId = result.rows[0].job_id;
  await taskQueue.add(type, payload, { jobId });

  res.status(202).json({ jobId, status: 'accepted' });
});

const getAuditJobs = asyncHandler(async (req: Request, res: Response) => {
  const result = await db.query('SELECT * FROM job_audit ORDER BY created_at DESC LIMIT 50');
  res.json(result.rows);
});

const getJobStatusById = asyncHandler(async (req: Request, res: Response) => {
  const result = await db.query('SELECT * FROM job_audit WHERE job_id = $1', [req.params.id]);
  
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(result.rows[0]);
});

const getFailedJobs = asyncHandler(async (req: Request, res: Response) => {
  // Fetch jobs that have exhausted all 3 retries
  const failedJobs = await taskQueue.getFailed();
  
  const result = failedJobs.map(job => ({
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null
  }));

  res.json(result);
});

const retryJob = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const job = await taskQueue.getJob(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found in queue' });
  }

  // BullMQ built-in retry
  await job.retry();
  
  // Sync Postgres to show we are trying again
  await db.query('UPDATE job_audit SET status = $1, error_log = NULL WHERE job_id = $2', ['pending', id]);

  res.json({ message: `Job ${id} moved from DLQ back to Processing.` });
});

export { postedJob, getAuditJobs, getJobStatusById, getFailedJobs, retryJob };
