import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { connectDB, getPool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { connectRedis, publisher } from './redis/index.js';
import { register, httpRequestDuration } from './metrics.js';
import { setupWebSocket }          from './ws/handler.js';
import { setupTerminalWebSocket }  from './terminal/handler.js';
import { startWorkers } from './execution/queue.js';

import authRoutes   from './routes/auth.js';
import roomRoutes   from './routes/rooms.js';
import healthRoutes from './routes/health.js';

const app = express();

// ── Security middleware ──────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:      process.env.CLIENT_URL || 'http://localhost',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── HTTP request duration instrumentation ────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    let route = (req.baseUrl ?? '') + (req.route?.path ?? req.path);
    if (!req.route) {
      route = route.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ':id',
      );
    }
    httpRequestDuration.observe(
      { method: req.method, route, status_code: String(res.statusCode) },
      Date.now() - start,
    );
  });
  next();
});

// ── Global rate limit (per IP) ───────────────────────────────────────────────
// Disabled in test mode: k6 sends all VU traffic from one IP (Docker bridge),
// which would trip the per-IP limit and obscure real WS/OT numbers.
if (process.env.NODE_ENV !== 'test') {
  app.use(rateLimit({
    windowMs:        60 * 1000,
    max:             200,
    standardHeaders: true,
    legacyHeaders:   false,
  }));
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',  authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api',       healthRoutes);

// Prometheus metrics scrape endpoint (internal only — Nginx blocks public access)
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── 404 / error handlers ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
let httpServer;

async function start() {
  await connectDB();
  await runMigrations();
  await connectRedis();
  await startWorkers();

  httpServer = createServer(app);
  const mainWss = setupWebSocket();
  const termWss = setupTerminalWebSocket();

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/ws') {
      mainWss.handleUpgrade(req, socket, head, (ws) => mainWss.emit('connection', ws, req));
    } else if (pathname === '/terminal') {
      termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CodeSync server ${process.env.INSTANCE_ID ?? ''} running on port ${PORT}`);
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`${signal} received — starting graceful shutdown`);

  // Hard cutoff: if we're still not done after 10 s, force exit
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref(); // don't keep the event loop alive just for this timer

  try {
    // Stop accepting new HTTP connections; existing keep-alive connections finish
    await new Promise((resolve, reject) => {
      httpServer?.close((err) => (err ? reject(err) : resolve()));
    });
    console.log('HTTP server closed — no new connections accepted');

    // Close DB pool and Redis (workers will drain naturally since queue.js
    // checks the blocked BLPOP which will error when Redis closes)
    await Promise.all([
      getPool().end(),
      publisher.quit(),
    ]);

    clearTimeout(forceExit);
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
