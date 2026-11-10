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
//
// jobId = `report-<id>` prevents the same report being queued twice. But BullMQ also
// silently ignores add() while an OLD finished/failed job with that ID is still stored,
// which would leave a re-queued report stuck on "queued" forever. So a finished or failed
// leftover is removed first; a job that is still waiting or running is left alone.
export async function enqueueReport(reportId) {
  const jobId = `report-${reportId}`;
  const existing = await reportQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed') return existing; // already queued or running
    await existing.remove();
  }
  return reportQueue.add('extract', { reportId }, { jobId });
}
