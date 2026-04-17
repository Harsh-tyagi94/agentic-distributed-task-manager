import { Router } from "express"
import { postedJob, getAuditJobs, getJobStatusById, getFailedJobs, retryJob } from "../controllers/job.controller.ts";

const jobRouter = Router()

jobRouter.route('/')
  .post(postedJob)
  .get(getAuditJobs)

jobRouter.route('/:id').get(getJobStatusById)
jobRouter.route('/failed').get(getFailedJobs)
jobRouter.route('/:id/retry').post(retryJob)

export default jobRouter;
