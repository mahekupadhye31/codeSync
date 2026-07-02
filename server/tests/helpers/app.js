/**
 * Minimal Express app factory for integration tests.
 * Does NOT start an HTTP server or WebSocket server.
 */
import express     from 'express';
import authRoutes  from '../../src/routes/auth.js';
import roomRoutes  from '../../src/routes/rooms.js';
import healthRoutes from '../../src/routes/health.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth',  authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api',       healthRoutes);
  return app;
}
