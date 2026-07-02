/**
 * Shared test environment setup/teardown.
 * Connects to the real postgres + redis specified by env vars,
 * which in CI are the service containers defined in the workflow.
 */
import 'dotenv/config';
import { connectDB, getPool } from '../../src/db/index.js';
import { runMigrations }     from '../../src/db/migrate.js';
import { connectRedis, publisher } from '../../src/redis/index.js';
import { startWorkers } from '../../src/execution/queue.js';

let workersStarted = false;

export async function setup({ withWorkers = false } = {}) {
  await connectDB();
  await runMigrations();
  await connectRedis();
  if (withWorkers && !workersStarted) {
    await startWorkers();
    workersStarted = true;
  }
}

export async function teardown() {
  try { await getPool().end(); }   catch {}
  try { await publisher?.quit(); } catch {}
}

/** Insert a test user and return a signed JWT ready for Authorization headers. */
export async function createTestUser(suffix = '1') {
  const { query }    = await import('../../src/db/index.js');
  const { signToken } = await import('../../src/auth/jwt.js');

  const { rows } = await query(
    `INSERT INTO users (github_id, username, avatar_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (github_id) DO UPDATE
       SET username = EXCLUDED.username
     RETURNING id, username`,
    [`test-gh-${suffix}`, `testuser${suffix}`, 'https://example.com/avatar.png']
  );

  const token = signToken({
    sub:        rows[0].id,
    username:   rows[0].username,
    avatar_url: 'https://example.com/avatar.png',
  });

  return { id: rows[0].id, username: rows[0].username, token, header: `Bearer ${token}` };
}
