// The job queue. The API server *adds* jobs here; the worker process *takes* them.
// BullMQ stores the queue in Redis, so jobs survive a server restart.
import { Queue } from 'bullmq';
import { config } from './config.js';

export const QUEUE_NAME = 'report-extraction';

export const reportQueue = new Queue(QUEUE_NAME, {
  connection: config.redis,
  defaultJobOptions: {
    attempts: 3,                                   // try up to 3 times...
    backoff: { type: 'exponential', delay: 5000 }, // ...waiting 5s, then 10s (API hiccups, rate limits)
    removeOnComplete: 1000,                        // don't keep finished jobs in Redis forever
    removeOnFail: 1000,
  },
});

// Only the report ID goes into Redis – never the report text or patient details.
export const enqueueReport = (reportId) => reportQueue.add('extract', { reportId }, { jobId: `report-${reportId}` });
