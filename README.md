# CodeSync

**Real-time collaborative code editor** — edit together, run code live, review history.

[![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/your-username/codesync/actions/workflows/deploy.yml/badge.svg)](https://github.com/your-username/codesync/actions)

**Live demo:** _deploy to your own server using the instructions below_

---

## Features

- ⚡ **Real-time collaborative editing** — Operational Transformation keeps every cursor and keystroke consistent across all connected clients with zero conflicts
- 🌐 **5 languages** — JavaScript, Python, C++, Java, Go with full syntax highlighting and code folding
- ▶️ **In-browser code execution** — run code against Judge0 sandbox; stdout / stderr / compiler output streamed back via WebSocket
- 📸 **Version history** — manual and auto snapshots with diff viewer and one-click restore
- 🔗 **Shareable read-only links** — JWT-signed 30-day share URLs; no account required to view
- 💬 **Presence + live chat** — colored cursors, typing indicators, and per-room chat
- 📊 **Prometheus + Grafana** — 10-panel dashboard tracking WS latency, OT throughput, queue depth
- 🚀 **Zero-downtime deploys** — rolling restart across 2 Nginx-load-balanced Node.js instances

---

## Architecture

```
┌─ Internet ────────────────────────────────────────────────────────────────┐
│                         Browser (React 18 + Vite)                         │
│              CodeMirror 6 · Tailwind CSS · WebSocket client               │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │  HTTP / WebSocket
┌─ Docker Compose ─────────────┼────────────────────────────────────────────┐
│                              ▼                                             │
│              ┌───────────────────────────────┐                            │
│              │          nginx  :80            │                            │
│              │  rate limit · gzip · static    │                            │
│              └────────┬───────────┬───────────┘                           │
│                       │ REST      │ WebSocket                              │
│               least_conn      hash(cookie)                                 │
│                       │           │                                        │
│              ┌────────┴─┐   ┌─────┴────┐                                  │
│              │backend-1 │   │backend-2 │   Node.js 20 · Express · ws      │
│              │  :3001   │   │  :3001   │                                   │
│              └────┬─────┘   └────┬─────┘                                  │
│                   │              │                                         │
│          ┌────────┴──────────────┴──────┐                                 │
│          │                              │                                  │
│   ┌──────┴──────┐             ┌─────────┴────────┐                        │
│   │  postgres   │             │      redis        │                        │
│   │   :5432     │             │  :6379  pub/sub   │                        │
│   │  rooms,     │             │  OT state cache   │                        │
│   │  snapshots  │             │  execution queue  │                        │
│   └─────────────┘             └──────────────────┘                        │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────┐            │
│   │  prometheus :9090  ────────►  grafana :3000              │            │
│   │  scrapes /metrics from both backends every 15 s          │            │
│   └──────────────────────────────────────────────────────────┘            │
│                                                                            │
│   ┌──────────────────────┐                                                 │
│   │  frontend (Vite SPA) │  served by nginx in production                  │
│   │  :5173 (dev only)    │                                                 │
│   └──────────────────────┘                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech stack

| Category | Technology | Why |
|---|---|---|
| Frontend | React 18, Vite | Fast HMR, tree-shaking |
| Editor | CodeMirror 6 | Extensible, accessible, mobile-friendly |
| Styling | Tailwind CSS | Utility-first, no runtime overhead |
| OT engine | Custom (pure JS) | Full control over convergence semantics |
| Backend | Node.js 20, Express | Non-blocking I/O, native ESM |
| WebSocket | `ws` library | Lightweight; no Socket.IO overhead |
| Database | PostgreSQL 15 | ACID for rooms, snapshots, users |
| Cache / queue | Redis 7 | Pub/Sub for multi-instance sync; BLPOP queue |
| Execution | Judge0 CE | Sandboxed multi-language runner |
| Reverse proxy | Nginx 1.25 | Load balancing, rate limiting, TLS termination |
| Metrics | Prometheus + Grafana | Industry-standard observability stack |
| CI/CD | GitHub Actions | Lint → test → build → rolling deploy |
| Containerisation | Docker Compose | One-command local setup; mirrors production |

---

## Performance

Measured with k6 load tests against the full Docker Compose stack on a single host.
See [`load-tests/results/METRICS.md`](load-tests/results/METRICS.md) for full breakdown.

| Metric | Value |
|---|---|
| Concurrent WebSocket connections (peak) | 160 |
| WS message latency p50 | 7 ms |
| WS message latency p95 | 29 ms |
| OT operations processed (total across 3 scenarios) | 14,208 |
| HTTP p95 — baseline (10 VU) | 38 ms |
| HTTP p95 — concurrent (50 VU) | 94 ms |
| Error rate | 0.00 % |
| Stress scenario — 100 VU same room | 100 / 100 passed |

---

## Getting started

### Prerequisites
- Docker & Docker Compose
- A [GitHub OAuth App](https://github.com/settings/developers)

> **Code execution is fully self-hosted via Judge0 CE — no external API keys required.**
> Judge0 and its dependencies start automatically as part of `docker compose up`.

### 1 — Clone and configure

```bash
git clone https://github.com/your-username/codesync.git
cd codesync
cp .env.example .env
# Edit .env — fill in POSTGRES_PASSWORD, JWT_SECRET, GITHUB_CLIENT_ID, etc.
```

### 2 — Start the stack

```bash
docker compose up --build
```

Services start in dependency order. **The first run takes 2–3 minutes** because
Judge0 pulls language runtime images and runs database migrations before marking
itself healthy. Subsequent starts are fast (images are cached).

Nginx is ready when both backends pass their health checks
(`GET /api/health → { status: "ok", db: "ok", redis: "ok", judge0: "ok" }`).

| Service | URL |
|---|---|
| App | http://localhost |
| Grafana | http://localhost:3000 (admin / see `.env`) |
| Prometheus | http://localhost:9090 |

### 3 — GitHub OAuth app setup

In your GitHub app settings:
- **Homepage URL:** `http://localhost`
- **Callback URL:** `http://localhost/api/auth/github/callback`

For production, replace `localhost` with your domain.

---

## Running tests

### Unit + integration tests (no Docker needed for OT tests)

```bash
cd server
npm install
node --test tests/ot.test.js          # OT convergence — no DB required
```

Full integration suite (requires running Postgres + Redis):

```bash
DATABASE_URL=postgresql://... REDIS_URL=redis://... JWT_SECRET=... \
  node --test tests/ot.test.js tests/auth.test.js tests/rooms.test.js tests/queue.test.js
```

### Load tests (k6)

```bash
# Install k6: brew install k6
NODE_ENV=test docker compose up -d
BASE_URL=http://localhost k6 run load-tests/k6-codesync.js
```

See [`load-tests/README.md`](load-tests/README.md) for full instructions.

---

## How it works

### Operational Transformation

Every keystroke becomes an `insert` or `delete` operation with a position and
the current document revision. When two clients edit simultaneously, the server
runs `transform(op1, op2)` to shift positions so both operations apply cleanly to
the same base document. The key invariant: **delete wins** — an insert that falls
inside a concurrent delete range becomes a no-op (`null`). This guarantees that
`transform(A, B)` and `transform(B, A)` always produce identical final documents,
regardless of network order. The algorithm lives in `server/src/ot/index.js` and
is covered by 12 convergence tests.

### Redis Pub/Sub for multi-instance scaling

Each Node.js instance maintains in-memory WebSocket connections. When a client
sends an operation, the local instance broadcasts to its own sockets and then
publishes a `room:event:{roomId}` message to Redis. Every other instance
subscribes to that channel and re-broadcasts to its own sockets. This means
adding a second (or third) backend instance requires no code changes — Nginx
uses cookie-based consistent hashing so WebSocket reconnects land on the same
instance, while HTTP requests are load-balanced with `least_conn`.

### Execution sandbox

Code execution is decoupled from the WebSocket path to prevent slow Judge0
responses from blocking OT processing. When a user runs code, the server pushes
a job to a Redis list (`execution:queue`). Three worker goroutines (using
`publisher.duplicate()` for isolated BLPOP connections) consume the queue,
submit to Judge0, and store the result in a Redis key with a 60-second TTL.
The original requester polls that key every 300 ms via `waitForResult()` and
pushes the result back to all room members over WebSocket.

---

## Roadmap

- [ ] **CRDT migration** — replace OT with Yjs for peer-to-peer sync and offline support
- [ ] **Monaco editor** — richer IntelliSense and multi-cursor support
- [ ] **AI code completion** — stream LLM suggestions as ghost text
- [ ] **Voice chat** — WebRTC audio channels per room
- [ ] **Export to Gist** — one-click GitHub Gist creation from a snapshot

---

## License

MIT © 2024 — see [LICENSE](LICENSE).
