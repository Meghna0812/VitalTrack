// The worker: takes jobs off the queue and does the slow work.
// Locally: run it with `npm run worker` in its own terminal, alongside the API server.
// In production (RUN_WORKER=true) the API process imports this file and runs it in-process.
import { access, unlink } from 'node:fs/promises';
import { Worker, UnrecoverableError } from 'bullmq';
import { config } from './config.js';
import { QUEUE_NAME, enqueueReport } from './queue.js';
import { extractText } from './services/textExtract.js';
import { processText } from './services/pipeline.js';
import * as repo from './db/repo.js';

/** Remove the uploaded PDF once we're done with it (unless KEEP_UPLOADS=true). */
async function discardUpload(reportId) {
  if (config.keepUploads) return;
  const report = await repo.getReport(reportId);
  if (report?.file_path) await unlink(report.file_path).catch(() => {});
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { reportId } = job.data;
    const report = await repo.getReport(reportId);
    if (!report) throw new UnrecoverableError(`Report ${reportId} no longer exists`);

    // On hosts without a permanent disk, a restart wipes uploaded files. Say so clearly
    // instead of retrying a job that can never succeed.
    try { await access(report.file_path); }
    catch { throw new UnrecoverableError('The uploaded file is no longer available. Please upload it again.'); }

    await repo.setStatus(reportId, 'processing');
    const rawText = await extractText(report.file_path, report.mime_type);
    // We know whose report this is, so that person's name is redacted wherever it appears –
    // even in places the label/pattern rules would miss. The name comes from MySQL, not from
    // the job data, so it never sits in Redis.
    const output = await processText(rawText, { knownNames: [report.patient_name] });
    await repo.saveExtraction(reportId, output);

    const flagged = output.results.filter((r) => r.needsReview).length;
    return { results: output.results.length, flagged };
  },
  {
    connection: config.redis,
    concurrency: 2,                         // at most 2 reports processed at the same time
    limiter: { max: 20, duration: 60_000 }, // at most 20 jobs per minute (protects API rate limits & cost)
  },
);

worker.on('completed', async (job, out) => {
  console.log(`report ${job.data.reportId}: ${out.results} results, ${out.flagged} flagged`);
  await discardUpload(job.data.reportId); // only the PII-free text and results are kept
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  const outOfAttempts = job.attemptsMade >= (job.opts.attempts ?? 1);
  console.error(`report ${job.data.reportId} attempt ${job.attemptsMade} failed: ${err.message}`);
  if (outOfAttempts || err instanceof UnrecoverableError) {
    await repo.setStatus(job.data.reportId, 'failed', err.message);
    await discardUpload(job.data.reportId);
  } else {
    await repo.setStatus(job.data.reportId, 'queued', `Retrying: ${err.message}`);
  }
});

// MySQL is the source of truth, Redis is not: free Redis plans can lose their data on a
// restart. So on startup we put every unfinished report back in the queue. (jobId is
// `report-<id>`, so a report that is still queued in Redis is not added twice.)
const unfinished = await repo.listUnfinishedReportIds();
for (const id of unfinished) await enqueueReport(id);
if (unfinished.length) console.log(`Re-queued ${unfinished.length} unfinished report(s)`);

console.log('Worker started, waiting for jobs…');

// Finish the current job before exiting (Ctrl+C locally, SIGTERM when a host redeploys).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await worker.close(); process.exit(0); });
}
