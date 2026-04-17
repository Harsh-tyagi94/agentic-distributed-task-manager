import express from 'express'
import { taskQueue } from './queues/mainQueue.ts'
import jobRoutes from './routes/job.route.ts'
import dotenv from 'dotenv'

dotenv.config();

const app = express()
app.use(express.json())

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
app.listen(port, '0.0.0.0', () => console.log(`agent live on port ${port}`));
