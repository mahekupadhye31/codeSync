/**
 * Redis-backed execution queue.
 *
 * Jobs are pushed to `execution:queue` (Redis list). A pool of 3 worker
 * coroutines each block on BLPOP, run the Judge0 call, then write the result
 * to `execution:result:{jobId}` with a 60-second TTL.
 *
 * The caller (WS handler) uses enqueueJob() + waitForResult() which polls
 * the result key every 300 ms until it appears or the timeout elapses.
 */

import { publisher } from '../redis/index.js';
import { runCode } from './local.js';
import { executionQueueDepth } from '../metrics.js';

const QUEUE_KEY      = 'execution:queue';
const MAX_DEPTH      = 20;
const RESULT_TTL_S   = 60;
const WORKER_COUNT   = 3;
const BLPOP_TIMEOUT  = 30;   // seconds to wait per BLPOP call before looping
const POLL_INTERVAL  = 300;  // ms between result-key polls

export async function enqueueJob({ language, code, stdin = '' }) {
  const depth = await publisher.lLen(QUEUE_KEY);
  if (depth >= MAX_DEPTH) {
    throw new Error('Execution queue is full — try again in a moment.');
  }

  const jobId = crypto.randomUUID();
  await publisher.rPush(QUEUE_KEY, JSON.stringify({ jobId, language, code, stdin }));
  return jobId;
}

export async function waitForResult(jobId, timeoutMs = 35_000) {
  const resultKey = `execution:result:${jobId}`;
  const deadline  = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await publisher.get(resultKey);
    if (raw) {
      await publisher.del(resultKey);
      return JSON.parse(raw);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error('Execution timed out waiting for a worker.');
}

async function workerLoop(workerClient, index) {
  console.log(`[execution-worker-${index}] ready`);

  while (true) {
    try {
      const item = await workerClient.blPop(QUEUE_KEY, BLPOP_TIMEOUT);
      if (!item) continue; // timed out — loop back

      executionQueueDepth.inc();
      const { jobId, language, code, stdin } = JSON.parse(item.element);

      let result;
      try {
        result = await runCode({ language, code, stdin });
      } catch (err) {
        result = {
          stdout:          '',
          stderr:          err.message,
          compile_output:  '',
          status:          'Error',
          statusId:        0,
          time:            '0',
          memory:          0,
        };
      } finally {
        executionQueueDepth.dec();
      }

      await workerClient.setEx(
        `execution:result:${jobId}`,
        RESULT_TTL_S,
        JSON.stringify(result),
      );
    } catch (err) {
      if (!workerClient.isOpen) {
        console.warn(`[execution-worker-${index}] Redis closed, exiting loop`);
        break;
      }
      console.error(`[execution-worker-${index}] error:`, err.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function startWorkers() {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const workerClient = publisher.duplicate();
    workerClient.on('error', (err) =>
      console.error(`[execution-worker-${i}] Redis error:`, err.message)
    );
    await workerClient.connect();
    workerLoop(workerClient, i).catch((err) =>
      console.error(`[execution-worker-${i}] died unexpectedly:`, err.message)
    );
  }
}
