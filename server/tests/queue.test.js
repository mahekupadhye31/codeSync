/**
 * Execution queue tests.
 * Judge0 is intentionally NOT configured (JUDGE0_API_KEY unset) so
 * runCode() returns the mock response — no external API calls needed.
 *
 * Run: node --test tests/queue.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { setup, teardown } from './helpers/setup.js';

before(() => setup({ withWorkers: true }));
after(teardown);

test('enqueueJob returns a UUID job ID', async () => {
  const { enqueueJob } = await import('../src/execution/queue.js');
  const jobId = await enqueueJob({ language: 'javascript', code: 'console.log(1)' });
  assert.ok(jobId, 'should return a job ID');
  assert.match(
    jobId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'job ID should be a UUID',
  );
});

test('waitForResult receives mock execution result', async () => {
  const { enqueueJob, waitForResult } = await import('../src/execution/queue.js');
  const jobId  = await enqueueJob({ language: 'python', code: 'print("hello")' });
  const result = await waitForResult(jobId, 10_000);

  assert.ok(result,             'should receive a result');
  assert.ok(result.status,      'result should have a status field');
  assert.equal(result.statusId, 3, 'mock always returns statusId 3 (Accepted)');
  assert.ok(typeof result.stdout === 'string', 'stdout should be a string');
});

test('waitForResult rejects if jobId does not exist after timeout', async () => {
  const { waitForResult } = await import('../src/execution/queue.js');
  await assert.rejects(
    () => waitForResult('non-existent-job-id', 500),
    /timed out/i,
  );
});

test('enqueueJob rejects when queue is full', async () => {
  const { enqueueJob } = await import('../src/execution/queue.js');
  const { publisher }  = await import('../src/redis/index.js');

  // Force the queue to appear full by setting lLen via RPUSH
  const key = 'execution:queue';
  await publisher.del(key);
  for (let i = 0; i < 20; i++) {
    await publisher.rPush(key, JSON.stringify({ jobId: `fake-${i}`, language: 'javascript', code: '' }));
  }

  await assert.rejects(
    () => enqueueJob({ language: 'javascript', code: '' }),
    /queue is full/i,
  );

  // Drain the fake jobs so they don't pollute other tests
  await publisher.del(key);
});
