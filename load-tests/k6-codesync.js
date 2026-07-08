/**
 * k6 load test for CodeSync.
 *
 * Three scenarios run in sequence by default:
 *
 *   baseline    –  10 VUs, 30 s     auth → create room → 5 WS ops → disconnect
 *   concurrent  –  ramp 0→50 VUs over 20 s, hold 40 s  each VU in its own room
 *   stress      – 100 VUs, 30 s     all VUs join the SAME pre-created room
 *
 * Thresholds (hard-fail CI if breached):
 *   baseline   http p95 < 200 ms,  errors < 5
 *   concurrent http p95 < 300 ms,  error rate < 1 %
 *   stress     ws_messages_received > 0 (convergence smoke-check)
 *
 * Usage:
 *   BASE_URL=http://localhost k6 run load-tests/k6-codesync.js
 *
 * Prerequisites:
 *   - Stack running with NODE_ENV=test (enables /api/auth/dev endpoint)
 *   - k6 ≥ 0.46  (https://grafana.com/docs/k6/latest/set-up/install-k6/)
 */

import http from 'k6/http';
import ws   from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Custom metrics ────────────────────────────────────────────────────────────
const wsMessagesReceived = new Counter('ws_messages_received');
const wsConnectTime      = new Trend('ws_connect_time_ms',   true);
const httpErrors         = new Counter('http_errors');
// op_rtt_ms: time from socket.send(op) → receiving own echo back from server.
// Measures the actual "edit propagates to collaborators" latency through the
// full stack (Nginx → Node OT handler → Redis pub/sub → broadcast → client).
// Tracked only in baseline/concurrent (single-VU rooms) where echoes are
// strictly ordered; skipped in stress where a shared room mixes all VUs' ops.
const opRtt = new Trend('op_rtt_ms', true);

// ── Environment ───────────────────────────────────────────────────────────────
const BASE_URL = (__ENV.BASE_URL || 'http://localhost').replace(/\/$/, '');
const WS_URL   = BASE_URL.replace(/^http/, 'ws');

// ── Scenario config ───────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // ── 1. Baseline: 10 VUs × 30 s, each in its own room ─────────────────────
    baseline: {
      executor: 'constant-vus',
      vus:      10,
      duration: '30s',
      exec:     'baselineScenario',
      tags:     { scenario: 'baseline' },
    },

    // ── 2. Concurrent rooms: ramp to 50 VUs, each in a unique room ────────────
    concurrent: {
      executor:   'ramping-vus',
      startVUs:   0,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '40s', target: 50 },
      ],
      exec: 'concurrentScenario',
      tags: { scenario: 'concurrent' },
      startTime: '35s',   // start after baseline finishes
    },

    // ── 3. Stress: 100 VUs hammering ONE shared room ──────────────────────────
    stress: {
      executor: 'constant-vus',
      vus:      100,
      duration: '30s',
      exec:     'stressScenario',
      tags:     { scenario: 'stress' },
      startTime: '100s',  // start after concurrent finishes
    },
  },

  thresholds: {
    // baseline
    'http_req_duration{scenario:baseline}': ['p(95)<200'],
    'http_errors{scenario:baseline}':       ['count<5'],
    // concurrent
    'http_req_duration{scenario:concurrent}': ['p(95)<300'],
    'http_errors{scenario:concurrent}':       ['rate<0.01'],
    // stress — just confirm WS traffic flowed
    'ws_messages_received{scenario:stress}':  ['count>0'],
    // OT operation round-trip (the real-time editing latency number)
    'op_rtt_ms': ['p(95)<150'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Obtain a JWT via the dev-auth backdoor (NODE_ENV=test only).
 * Returns the token string, or null on failure.
 */
function authenticate(username) {
  const name = username || `load-${uuidv4().slice(0, 8)}`;
  const res = http.post(
    `${BASE_URL}/api/auth/dev`,
    JSON.stringify({ username: name }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const ok = check(res, { 'auth 200': (r) => r.status === 200 });
  if (!ok) { httpErrors.add(1); return null; }
  return res.json('token');
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Create a new room; return its id or null on failure. */
function createRoom(token, name, language = 'javascript') {
  const res = http.post(
    `${BASE_URL}/api/rooms`,
    JSON.stringify({ name, language }),
    { headers: authHeaders(token) },
  );
  const ok = check(res, { 'room 201': (r) => r.status === 201 });
  if (!ok) { httpErrors.add(1); return null; }
  return res.json('id');
}

/**
 * Open a WebSocket, join `roomId`, send `opCount` insert ops, then close.
 * Records ws_connect_time_ms and ws_messages_received.
 */
function runWsSession(token, roomId, opCount, scenarioTag, trackRtt = false) {
  const url = `${WS_URL}/ws?token=${encodeURIComponent(token)}`;
  const t0  = Date.now();

  const res = ws.connect(url, { tags: { scenario: scenarioTag } }, (socket) => {
    wsConnectTime.add(Date.now() - t0, { scenario: scenarioTag });

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'join-room', roomId }));
    });

    let joined   = false;
    let opsSent  = 0;
    let acksRecv = 0;
    // Queue of send-timestamps (one per op). Since this VU owns the room,
    // echoes arrive in the same order ops were applied, so FIFO correlation works.
    const sentAt = [];

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      wsMessagesReceived.add(1, { scenario: scenarioTag });

      if (msg.type === 'room-joined' && !joined) {
        joined = true;
        for (let i = 0; i < opCount; i++) {
          const ts = Date.now();
          socket.send(JSON.stringify({
            type:   'operation',
            roomId,
            op: {
              type:     'insert',
              position: i,
              content:  'X',
              revision: i,
            },
          }));
          if (trackRtt) sentAt.push(ts);
          opsSent++;
        }
      }

      // Server echoes the applied op back as type:'operation' (not 'operation-ack')
      if (msg.type === 'operation') {
        if (trackRtt && sentAt.length > 0) {
          opRtt.add(Date.now() - sentAt.shift(), { scenario: scenarioTag });
        }
        acksRecv++;
        if (acksRecv >= opsSent) socket.close();
      }
    });

    socket.on('error', () => {
      httpErrors.add(1, { scenario: scenarioTag });
      socket.close();
    });

    // Hard safety-net: close after 15 s even if acks are missing
    socket.setTimeout(() => socket.close(), 15_000);
  });

  check(res, { 'ws upgraded 101': (r) => r && r.status === 101 });
}

// ── Scenario functions (each called via `exec` in options.scenarios) ──────────

/** Scenario 1 — baseline: own room, 5 ops */
export function baselineScenario() {
  const token = authenticate();
  if (!token) { sleep(1); return; }

  const roomId = createRoom(token, `bl-${uuidv4().slice(0, 8)}`);
  if (!roomId) { sleep(1); return; }

  runWsSession(token, roomId, 5, 'baseline', true);
  sleep(1);
}

/** Scenario 2 — concurrent: own room, 5 ops, 50 VUs */
export function concurrentScenario() {
  const token = authenticate();
  if (!token) { sleep(1); return; }

  const roomId = createRoom(token, `cc-${uuidv4().slice(0, 8)}`);
  if (!roomId) { sleep(1); return; }

  runWsSession(token, roomId, 5, 'concurrent', true);
  sleep(1);
}

/** Scenario 3 — stress: shared room, 3 ops per VU, 100 VUs */
export function stressScenario(data) {
  const roomId = data && data.stressRoomId;

  const token = authenticate();
  if (!token || !roomId) { sleep(1); return; }

  runWsSession(token, roomId, 3, 'stress');
  sleep(0.5);
}

// k6 requires a default export even when all scenarios use `exec`
export default function () { baselineScenario(); }

// ── setup: create the shared stress room once before VUs start ────────────────
export function setup() {
  const token = authenticate('load-setup');
  if (!token) {
    console.warn('[setup] auth failed — stress scenario WS ops will be skipped');
    return { stressRoomId: null };
  }

  const res = http.post(
    `${BASE_URL}/api/rooms`,
    JSON.stringify({ name: 'stress-shared', language: 'python' }),
    { headers: authHeaders(token) },
  );
  const stressRoomId = res.status === 201 ? res.json('id') : null;
  console.log(`[setup] stress room id = ${stressRoomId}`);
  return { stressRoomId };
}

// ── handleSummary: emit a compact JSON result + write full report ─────────────
export function handleSummary(data) {
  // Gather pass/fail for every threshold
  const results = {};
  for (const [metric, m] of Object.entries(data.metrics)) {
    if (!m.thresholds) continue;
    for (const [expr, t] of Object.entries(m.thresholds)) {
      results[`${metric} ${expr}`] = t.ok ? 'PASS' : 'FAIL';
    }
  }

  const allPassed = Object.values(results).every((v) => v === 'PASS');

  const summary = {
    passed:            allPassed,
    thresholds:        results,
    http_p95_ms:       data.metrics.http_req_duration?.values?.['p(95)']   ?? null,
    ws_connect_p95_ms: data.metrics.ws_connect_time_ms?.values?.['p(95)']  ?? null,
    op_rtt_p50_ms:     data.metrics.op_rtt_ms?.values?.['p(50)']           ?? null,
    op_rtt_p95_ms:     data.metrics.op_rtt_ms?.values?.['p(95)']           ?? null,
    op_rtt_p99_ms:     data.metrics.op_rtt_ms?.values?.['p(99)']           ?? null,
    ws_msgs_total:     data.metrics.ws_messages_received?.values?.count     ?? 0,
    http_errors:       data.metrics.http_errors?.values?.count              ?? 0,
  };

  console.log(JSON.stringify(summary, null, 2));

  return {
    // Full raw report for archiving / Grafana import
    'load-tests/results/summary.json': JSON.stringify(data, null, 2),
  };
}
