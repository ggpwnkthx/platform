# Capacity

The gateway's capacity targets and what one reference machine measured. The measurements are a lower bound:
gateway and upstream share one process, with no ingress, TLS or network in between.

`scripts/ops/load.ts` measures capacity, including against a gateway that is already running:

```bash
bun run load -- --requests 20000 --concurrency 100
bun run load -- --websockets 1000
bun run load -- --url http://localhost:8080 --host api.example.com
```

It also reports the process's **resident memory**, which is what you size the pod with.

## Targets

| What | Target | Why |
| --- | --- | --- |
| Route requests | 1000 req/s per replica, p99 below 100 ms | Platform calls are small and mostly internal. |
| Global limit | Deployment limits are the configured limits, not per replica | The limiter is shared through Redis. |
| WebSockets | 1000 open connections per replica, 500 opened/s | Editor connections. |
| Memory | Below 512 MiB per replica with 1000 open WebSockets | The pod limit is 1 GiB. |
| Errors | Below 0.1 % of requests | A gateway error is an outage of the application behind it. |
| Drain | Connections close within `GATEWAY_SHUTDOWN_TIMEOUT_MS` | The orchestrator waits for the pod to go away. |

The ingress (how many connections it opens), upstream limits and route budgets also bound a deployment;
they are not process capacity.

## Measurements

Reference environment: AMD Ryzen 7 5800X (8 cores, 16 threads), 31 GiB memory, Linux 7.2, Bun 1.4.3.
Gateway and upstream run in one process; traffic is plain http over loopback.

| Run | Result |
| --- | --- |
| 3000 requests, 50 in flight | 7541 req/s, p50 6.4 ms, p90 7.7 ms, p99 8.8 ms, 0 errors |
| 20000 requests, 100 in flight | 7683 req/s, p50 13.5 ms, p90 16.7 ms, p99 19.3 ms, max 21.6 ms, 0 errors |
| 500 WebSockets | 415 connections/s, handshake p99 193 ms, 0 errors |

- About **7600 req/s** per core-set of the reference machine with an in-process upstream. A real upstream
  lowers this, and the ingress limits a deployment anyway.
- Latency grows with requests in flight (p50 6.4 ms at 50, 13.5 ms at 100): the runtime queue is the
  bottleneck, not the gateway.
- A WebSocket handshake costs the gateway about 2 ms; the connection limit is configuration, not runtime.

### Memory

With the target's 1000 connections open on the reference environment:

| Run | Resident memory | Notes |
| --- | --- | --- |
| Before connections | 71 MiB | Gateway and the run's upstream in one process. |
| 1000 open WebSockets | **110 MiB** | 642 connections/s, handshake p99 540 ms, 0 errors. |
| 20000 requests, 100 in flight | 150 MiB | Run peak, including exchange buffers. |

The 1000 connections cost about 40 MiB, and the whole process (gateway, upstream and runtime) uses about a
tenth of the pod, far below the target.

### Machine load

The numbers above come from an **idle** machine. On the same machine under other load, the same script
measured about **4400 req/s** at 100 in flight (p50 23 ms) instead of 7600 (p50 13.5 ms), with identical
code and traffic. Measure on your deployment's own machines; the script exists for that.

## Shared-state backends

Shared state lives in a **Redis** or **Postgres** server. They are interchangeable, and
`scripts/ops/benchmark.ts` compares them:

```bash
bun run benchmark -- --redis redis://127.0.0.1:6399/0 \
                     --postgres postgres://127.0.0.1:5432/gateway
```

Each scenario is a request path with a different number of shared-state round trips:

| Scenario | Pays for |
| --- | --- |
| `no-state` | Nothing: state is in the process. The baseline. |
| `limits` | Three limiter checks: deployment, caller and route. |
| `session` | The limits plus the caller's session read. |
| `full` | The limits, the session and the cached access decision. |

Last run: 20 000 requests at 50 in flight, two rounds, on the reference environment, with gateway,
upstream, Redis and Postgres on one machine over loopback. An earlier run of the same script differed by a
few percent; a benchmark is a measurement, not a specification.

| Scenario | Backend | req/s | p50 | p99 |
| --- | --- | --- | --- | --- |
| `no-state` | in process | 7244 | 6.9 ms | 11.7 ms |
| `limits` | in process | 6834 | 7.2 ms | 11.7 ms |
| `limits` | Redis | 5884 | 8.4 ms | 12.9 ms |
| `limits` | Postgres | 3811 | 13.0 ms | 18.4 ms |
| `session` | in process | 6226 | 7.8 ms | 13.5 ms |
| `session` | Redis | 4144 | 11.7 ms | 26.4 ms |
| `session` | Postgres | 2747 | 18.0 ms | 25.3 ms |
| `full` | in process | 5610 | 8.4 ms | 14.2 ms |
| `full` | Redis | 3680 | 13.4 ms | 20.1 ms |
| `full` | Postgres | 2414 | 20.6 ms | 27.9 ms |

Findings:

- **Redis costs about a tenth** of baseline throughput on the limiter path and about a third on the full
  path.
- **Postgres costs about half** on the same paths, with about twice Redis's p50.
- The gap grows with round trips; a database transaction is a round trip that waits for the server.
- The cost is **not** the disk. With `GATEWAY_POSTGRES_SYNCHRONOUS_COMMIT=off` (the default), a limiter
  transaction takes about 0.2 ms instead of about 1.8 ms. With `on`, Postgres `limits` drops to about
  420 req/s with a p50 of 120 ms, because the deployment scope serializes every request of the deployment
  and each waits for the disk.
- **Pool size is not the lever.** Forty connections per replica measured *slower* than ten (about
  3 600 vs 4 100 req/s on `limits`): the bottleneck is the deployment scope's serialization, so a bigger
  pool only adds server contention. Keep the default of ten and put a pooler in front for many replicas.

Limits of these numbers:

- Everything ran on **one machine**. A database on its own host, or reached over a network, adds network
  latency to every round trip.
- **Managed** Redis and Postgres have different latency; measure against your deployment's servers.
- Pool size is a deployment decision: ten per replica by default, and a server with a low connection limit
  needs a pooler.

The gateway does not choose the backend; the benchmark lets you choose with data.

## Soak

`bun test test/load` runs traffic, WebSockets and configuration reloads, then checks that in-flight
requests, WebSocket connections and process memory settle. The last run (5 rounds of 50 requests, a
WebSocket and a reload) settled in 1.1 s with heap growth below 64 MiB.

The soak is part of the release gate because a leak shows up as an out-of-memory at the worst moment:
memory, descriptors, connections and timers must settle once traffic stops.

## Not measured

| What | Why |
| --- | --- |
| Capacity behind an ingress | No ingress in the build environment; the relevant settings are in [Operations](operations.md#ingress). |
| Capacity with TLS | The gateway does not terminate TLS; that cost belongs to the ingress. |
| Shared state on another host | Servers ran on the same machine; a remote server adds network latency per round trip. |
| Several replicas | Shared-state tests prove the counters are exact; deployment capacity is the sum of its replicas. |
