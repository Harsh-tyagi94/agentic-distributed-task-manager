import express from 'express'
import { taskQueue } from './queues/mainQueue.ts'
import jobRoutes from './routes/job.route.ts'
import dotenv from 'dotenv'
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'

dotenv.config();

const app = express()
app.use(express.json())

const register = new Registry();
collectDefaultMetrics({ register });

export const jobEnqueuedCounter = new Counter({
  name: 'jobs_enqueued_total',
  help: 'Total jobs enqueued by type and priority',
  labelNames: ['job_type', 'priority'],
  registers: [register],
});

export const queueDepthGauge = new Gauge({
  name: 'queue_depth',
  help: 'Current number of waiting jobs per queue',
  labelNames: ['queue_name'],
  registers: [register],
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
})

app.use('/jobs', jobRoutes);

app.post('/enqueue', async (req, res) => {
  console.log("Received request body:", req.body);
  const { prompt, idempotencyKey } = req.body;
  
  if (!prompt) {
    return res.status(400).json({error: 'Agent need prompt to start.' })
  }

  try {
    const job = await taskQueue.add(
      'agent_research', 
      { prompt },
      { jobId: idempotencyKey }
    );

    return res.status(202).json({
      message: 'agent task dispatched to queue',
      jobId: job.id,
    })
  } catch (error) {
    console.error('Failed to enqueue:', error)
    return res.status(500).json({ error: 'Internal server error' });
  }
})

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`agent live on port ${port}`)

  setInterval(async () => {
    try {
      const counts = await taskQueue.getJobCounts('waiting', 'paused', 'delayed');
      
      // Update the gauge for your main stream
      queueDepthGauge.set({ queue_name: 'task-stream' }, Number(counts.waiting));
      
      // Optional: log to console for debugging during test
      // console.log(`Metrics Sync: ${counts.waiting} jobs waiting`);
    } catch (err) {
      console.error('Metrics Poller Error:', err);
    }
  }, 5000);
});
