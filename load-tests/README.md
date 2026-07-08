# CodeSync Load Tests

k6-based load tests covering three concurrency profiles.  
Results are written to `load-tests/results/summary.json` after each run.

---

## Install k6

**macOS**
```bash
brew install k6
```

**Linux (Debian/Ubuntu)**
```bash
sudo gpg -k
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Docker**
```bash
docker run --rm -i grafana/k6 version
```

Minimum version: **k6 ≥ 0.46**

---

## Prerequisites

1. The full stack must be running with `NODE_ENV=test` so the dev-auth
   backdoor endpoint (`POST /api/auth/dev`) is active:

   ```bash
   NODE_ENV=test docker compose up -d
   ```

2. The stack must be reachable at `http://localhost` (default) or at
   the URL you pass via `BASE_URL`.

---

## Run all three scenarios

```bash
BASE_URL=http://localhost k6 run load-tests/k6-codesync.js
```

The scenarios execute in sequence with automatic `startTime` offsets:

| # | Name       | VUs       | Duration         | Start offset |
|---|------------|-----------|------------------|-------------|
| 1 | baseline   | 10 (flat) | 30 s             | 0 s         |
| 2 | concurrent | 0 → 50    | 20 s ramp + 40 s | 35 s        |
| 3 | stress     | 100 (flat)| 30 s             | 100 s       |

Total wall-clock time: ~130 s.

---

## Run a single scenario

Set `K6_SCENARIO` to `baseline`, `concurrent`, or `stress` and override
the scenarios object to run only that one:

```bash
# Baseline only
BASE_URL=http://localhost k6 run \
  --env K6_SCENARIO=baseline \
  --duration 30s --vus 10 \
  load-tests/k6-codesync.js

# Stress only (requires STRESS_ROOM_ID from a prior setup run)
BASE_URL=http://localhost \
STRESS_ROOM_ID=<uuid> \
k6 run --env K6_SCENARIO=stress \
  --duration 30s --vus 100 \
  load-tests/k6-codesync.js
```

---

## Thresholds (CI pass/fail)

| Scenario   | Metric                   | Threshold     |
|------------|--------------------------|---------------|
| baseline   | `http_req_duration` p95  | < 200 ms      |
| baseline   | `http_errors` count      | < 5           |
| concurrent | `http_req_duration` p95  | < 300 ms      |
| concurrent | `http_errors` rate       | < 1 %         |
| stress     | `ws_messages_received`   | > 0           |

k6 exits with code 99 if any threshold is breached — CI will catch this.

---

## Understanding the output

After the run, k6 prints a table similar to:

```
✓ http_req_duration.........: avg=42ms  min=12ms  med=38ms  max=310ms p(90)=88ms p(95)=112ms
✓ ws_connect_time_ms........: avg=6ms   min=2ms   med=5ms   max=41ms
✓ ws_messages_received......: 4 820
✗ http_errors...............: 7        (threshold: count<5)
```

The compact JSON summary is printed to stdout and also saved to
`load-tests/results/summary.json`.

### Numbers to record (resume / post-mortem)

Copy these from the terminal output after a successful run on your
production or staging server:

| Metric                        | Where to find it                          |
|-------------------------------|-------------------------------------------|
| HTTP p95 latency (baseline)   | `http_req_duration{scenario:baseline}` p95|
| HTTP p95 latency (concurrent) | `http_req_duration{scenario:concurrent}` p95|
| WS connect time p95           | `ws_connect_time_ms` p95                  |
| Total WS messages (stress)    | `ws_messages_received` count              |
| Peak VUs sustained            | `vus_max` value                           |
| Error rate                    | `http_errors` rate                        |

**Target numbers for a healthy deployment on a single server:**

- baseline HTTP p95 ≤ 100 ms
- concurrent HTTP p95 ≤ 200 ms  
- stress WS connect p95 ≤ 50 ms
- error rate < 0.1 %

---

## Streaming results to Grafana

Start a local InfluxDB + Grafana stack and pass the output DSN:

```bash
k6 run \
  --out influxdb=http://localhost:8086/k6 \
  load-tests/k6-codesync.js
```

Or use the built-in Grafana Cloud streaming (k6 Cloud):

```bash
k6 cloud load-tests/k6-codesync.js
```

---

## Adding more scenarios

1. Export a new function from `k6-codesync.js` (e.g. `export function spikeScenario(data) {...}`)
2. Add an entry under `options.scenarios` with `exec: 'spikeScenario'` and a `startTime` after the last scenario
3. Add a threshold entry under `options.thresholds`
