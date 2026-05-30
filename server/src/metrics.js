import client from 'prom-client';

const { Registry, Gauge, Histogram, Counter } = client;

export const register = new Registry();

// ── WebSocket ─────────────────────────────────────────────────────────────────
export const activeRooms = new Gauge({
  name:      'active_rooms_total',
  help:      'Number of rooms with at least one connected user',
  registers: [register],
});

export const connectedUsers = new Gauge({
  name:      'connected_users_total',
  help:      'Number of users currently in a room via WebSocket',
  registers: [register],
});

export const wsActiveConnections = new Gauge({
  name:      'ws_active_connections_total',
  help:      'Number of open WebSocket connections (all states, pre-join)',
  registers: [register],
});

export const wsMessageLatency = new Histogram({
  name:      'ws_message_latency_ms',
  help:      'Time from receiving a WS message to broadcasting it (ms)',
  buckets:   [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
});

// ── Operational Transformation ────────────────────────────────────────────────
export const otOperationsTotal = new Counter({
  name:       'ot_operations_total',
  help:       'Total OT operations successfully applied, labelled by room',
  labelNames: ['room_id'],
  registers:  [register],
});

// ── Snapshots ─────────────────────────────────────────────────────────────────
export const snapshotTotal = new Counter({
  name:      'snapshot_total',
  help:      'Total snapshots created (auto and manual)',
  registers: [register],
});

// ── Code execution ────────────────────────────────────────────────────────────
export const executionQueueDepth = new Gauge({
  name:      'execution_queue_depth',
  help:      'Number of code execution jobs currently in the queue or running',
  registers: [register],
});

export const judge0RequestDuration = new Histogram({
  name:      'judge0_request_duration_ms',
  help:      'Judge0 API round-trip time in milliseconds',
  buckets:   [100, 250, 500, 1000, 2500, 5000, 10000, 18000],
  registers: [register],
});

// ── HTTP ──────────────────────────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name:       'http_request_duration_ms',
  help:       'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:    [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers:  [register],
});

// ── Authentication ────────────────────────────────────────────────────────────
export const authAttemptsTotal = new Counter({
  name:       'auth_attempts_total',
  help:       'Total authentication attempts',
  labelNames: ['provider', 'result'],
  registers:  [register],
});
