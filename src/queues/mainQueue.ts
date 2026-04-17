import { Queue, QueueEvents } from 'bullmq'
import { redisConnection } from '../config/redis.ts'
import { db } from '../config/db.ts'

// 1. define queue
export const taskQueue = new Queue('task-stream', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true, // clean up redis memory after success
    removeOnFail: false, // keep in redis for DLQ inspection (gap2)
  }
});

// 2.define queueEvent for db sync
const queueEvents = new QueueEvents('task-stream', { connection: redisConnection });

// helper to update Postgress status
async function updateJobStatus(jobId: string, status: string, extra: object = {}) {
  const keys = Object.keys(extra);
  if (keys.length === 0) {
    await db.query('UPDATE job_audit SET status = $1 WHERE job_id = $2', [status, jobId]);
    return;
  }

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const values = Object.values(extra);
  const sql = `UPDATE job_audit SET status = $1, ${setClause} WHERE job_id = $2`;
  await db.query(sql, [status, jobId, ...values]);
}

// Event Listeners
queueEvents.on('active', async ({ jobId }) => {
  await updateJobStatus(jobId, 'active', { started_at: new Date() });
});

queueEvents.on('completed', async ({ jobId, returnvalue }) => {
  await updateJobStatus(jobId, 'completed', { 
    finished_at: new Date(), 
    result_summary: returnvalue 
  });
});

queueEvents.on('failed', async ({ jobId, failedReason }) => {
  const job = await taskQueue.getJob(jobId);
  await updateJobStatus(jobId, 'failed', { 
    error_log: failedReason,
    retry_count: job?.attemptsMade || 0
  });
});
