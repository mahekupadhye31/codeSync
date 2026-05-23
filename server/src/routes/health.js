import { Router } from 'express';
import { getPool } from '../db/index.js';
import { publisher } from '../redis/index.js';

const router  = Router();
const VERSION = process.env.npm_package_version ?? '1.0.0';
const STARTED = Date.now();

// Judge0 system_info URL — defaults to the Docker-internal hostname
const JUDGE0_URL       = process.env.JUDGE0_API_URL || 'http://judge0-server:2358';
const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || 'local_dev_token';

router.get('/health', async (_req, res) => {
  const checks = {
    status:  'ok',
    version: VERSION,
    uptime:  Math.floor((Date.now() - STARTED) / 1000),
    db:      'ok',
    redis:   'ok',
    judge0:  'ok',
  };

  // ── Postgres ──────────────────────────────────────────────────────────────
  try {
    await getPool().query('SELECT 1');
  } catch {
    checks.db     = 'error';
    checks.status = 'degraded';
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  try {
    await publisher.ping();
  } catch {
    checks.redis  = 'error';
    checks.status = 'degraded';
  }

  // ── Judge0 CE ─────────────────────────────────────────────────────────────
  // A 2-second timeout prevents slow Judge0 startup from blocking health checks.
  try {
    const j0Res = await fetch(`${JUDGE0_URL}/system_info`, {
      headers: { 'X-Auth-Token': JUDGE0_AUTH_TOKEN },
      signal:  AbortSignal.timeout(2000),
    });
    if (!j0Res.ok) checks.judge0 = 'error';
  } catch {
    checks.judge0 = 'error';
  }

  // HTTP 503 only when core infrastructure (DB + Redis) is down
  res.status(checks.db === 'ok' && checks.redis === 'ok' ? 200 : 503).json(checks);
});

export default router;
