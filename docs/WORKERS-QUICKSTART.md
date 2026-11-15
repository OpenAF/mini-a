# Mini-A Workers: Step-by-Step Guide

This guide shows how to run Mini-A **workers** (headless agents) as separate processes or containers that **register themselves** with a **main** Mini-A instance. The main instance then delegates sub-goals to them, preferring the worker whose advertised skills match each task.

For the full parameter and endpoint reference see [DELEGATION.md](DELEGATION.md) (Parts 2 and 3).

## How it fits together

```
                     ┌──────────────────────────── main Mini-A ───────────────────────────┐
 you ── goal ──────▶ │ usedelegation=true usetools=true                                    │
                     │ apitoken=<A>           ← token the main SENDS to workers            │
                     │ workerreg=12345        ← registration server port                   │
                     │ workerregtoken=<R>     ← token workers must send to register        │
                     └───────────▲───────────────────────────────┬─────────────────────────┘
       POST /worker-register     │ (every workerreginterval)     │ POST /task, /status, /result
       { workerUrl, agentCard }  │                               ▼ to the advertised workerUrl
                     ┌───────────┴───────────── worker Mini-A ───────────────────────────┐
                     │ workermode=true onport=8080                                         │
                     │ apitoken=<A>           ← token the worker REQUIRES                  │
                     │ workerregurl=http://main:12345  workerregtoken=<R>                  │
                     │ workerurl=http://worker-1:8080 ← address the main uses to reach it  │
                     │ workername / workerspecialties / workerskills ← what it is good at  │
                     └─────────────────────────────────────────────────────────────────────┘
```

Three things must line up:

| Concern | Main | Worker |
|---|---|---|
| Delegation calls (main → worker) | `apitoken=<A>` | `apitoken=<A>` (same value) |
| Registration calls (worker → main) | `workerreg=<port>` `workerregtoken=<R>` | `workerregurl=http://<main>:<port>` `workerregtoken=<R>` |
| Reachability (main → worker) | — | the advertised URL must be reachable from the main. It defaults to `http://<worker's own IP>:<onport>`; override with `workerurl=` |

`apitoken` and `workerregtoken` are separate secrets. You can use the same value for both, but they are checked independently.

## Prerequisites

- OpenAF with the `mini-a` oPack (`opack install mini-a`), or the `openaf/mini-a` Docker image.
- A model definition exported on every instance (each worker runs its own LLM calls):

```bash
export OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)"
export OAF_LC_MODEL="(type: openai, model: gpt-5-nano, key: '...', timeout: 900000)"   # optional
```

Workers can use different (for example cheaper or local) models from the main instance.

---

## Step 1: Run one worker and check it

```bash
mini-a workermode=true onport=8080 apitoken=secret \
  workername="calc-worker" workerdesc="Arithmetic and unit conversion" \
  workerspecialties="math,calculation"
```

(From a cloned repository, `ojob mini-a-worker.yaml onport=8080 apitoken=secret ...` does the same.)

In another terminal:

```bash
# Agent card (no auth needed): name, url and skills the main will see
curl -s http://localhost:8080/.well-known/agent.json

# Liveness
curl -s http://localhost:8080/healthz

# Submit a task directly (bearer token required)
curl -s -X POST http://localhost:8080/task \
  -H "Authorization: Bearer secret" -H "Content-Type: application/json" \
  -d '{ "goal": "What is 17*23?" }'
# → { "taskId": "...", "status": "queued", ... }

curl -s -X POST http://localhost:8080/result \
  -H "Authorization: Bearer secret" -H "Content-Type: application/json" \
  -d '{ "taskId": "<taskId from above>" }'
```

A `401` on `/task` means the bearer token doesn't match `apitoken`.

## Step 2: Point a main instance at it (static list)

Before adding registration, confirm delegation works with a fixed worker list:

```bash
mini-a usedelegation=true usetools=true apitoken=secret \
  workers="http://localhost:8080" \
  goal="Delegate to a remote worker: what is 17*23? Report the worker's answer."
```

The log should show `Delegation enabled in remote mode with 1 worker(s)` and `Routed to worker: http://localhost:8080`.

> **Gotcha:** if the main instance has no `apitoken` (or a different one), it can still read the agent card, but each delegated task fails with `Remote outcome unknown: Remote worker error: HTTP request failed`. The main falls back to answering by itself, so the failure is easy to miss.

## Step 3: Specialize workers

Workers advertise A2A skills. The main lists them in its `delegate-subtask` tool, so the LLM can choose by worker name or by skill.

```bash
# Shell worker (enables useshell=true and advertises a "shell" skill)
mini-a workermode=true onport=8081 apitoken=secret \
  workername="shell-worker" workerdesc="Runs shell commands on this host" shellworker=true

# Network worker with a full skill definition
mini-a workermode=true onport=8082 apitoken=secret \
  workername="network-worker" workerdesc="Network diagnostics" \
  workerskills='[{ "id": "network-latency", "name": "Network latency", "description": "Measure TCP/TLS latency to hosts", "tags": ["network","latency","tls"], "examples": ["Measure latency to example.com:443"] }]'

# Worker with its own MCP tools
mini-a workermode=true onport=8083 apitoken=secret \
  workername="time-worker" workerspecialties="time,timezone" \
  mcp="(cmd: 'ojob mcps/mcp-time.yaml')"
```

Any standard Mini-A option (`mcp`, `rules`, `knowledge`, `useshell`, `readwrite`, `maxsteps`, `model`, ...) applies to the tasks that worker runs. Give a worker only the tools and permissions its role needs.

## Step 4: Dynamic registration (processes)

Start the main instance as a long-running session with a registration server:

```bash
# Interactive console
mini-a usedelegation=true usetools=true apitoken=secret \
  workerreg=12345 workerregtoken=regsecret workerevictionttl=90000

# ...or the web UI
mini-a onport=8888 usedelegation=true usetools=true apitoken=secret \
  workerreg=12345 workerregtoken=regsecret workerevictionttl=90000
```

Start any number of workers, on this host or others:

```bash
mini-a workermode=true onport=8081 apitoken=secret \
  workername="calc-worker" workerspecialties="math" \
  workerregurl="http://main-host:12345" workerregtoken=regsecret workerreginterval=30000
```

The worker logs `[worker-reg] Registered with http://main-host:12345 as http://<address>:8081`, and keeps sending heartbeats every `workerreginterval` ms. Check what the main knows:

```bash
curl -s -H "Authorization: Bearer regsecret" http://main-host:12345/worker-list
```

Lifecycle:
- **Start:** the worker registers and sends its agent card inline, so the main doesn't have to fetch it.
- **Running:** each heartbeat refreshes the registration. A worker with changed skills is re-profiled.
- **Clean stop** (Ctrl+C, SIGTERM): the worker calls `/worker-deregister`.
- **Crash:** the main evicts the worker once no heartbeat arrives within `workerevictionttl` ms. Keep `workerevictionttl` at about 2–3× `workerreginterval`.
- A worker can register with several mains: `workerregurl="http://main1:12345,http://main2:12345"`.
- Static `workers=` entries can be combined with dynamic ones. Static entries are never evicted.

### When to set `workerurl`

The worker advertises `http://<its own IP>:<onport>` unless you set `workerurl`. Set it whenever the main can't reach that address:

| Situation | Example |
|---|---|
| Multi-homed host picks the wrong interface | `workerurl="http://10.0.0.12:8081"` |
| Docker with published ports (`-p 9001:8080`) | `workerurl="http://docker-host:9001"` |
| Docker Compose or a user-defined network (stable names) | `workerurl="http://calc-worker:8080"` |
| Kubernetes Service / StatefulSet DNS | `workerurl="http://calc-worker-0.calc-worker:8080"` |
| Behind a TLS reverse proxy | `workerurl="https://workers.example.com/calc"` |

`workerurl` must start with `http://` or `https://`; trailing slashes are removed. The same value is used for registration and for the `url` field of `/.well-known/agent.json`. It only changes what the worker *advertises*. The worker still listens on `onport`.

## Step 5: Workers in Docker

Run each instance from the `openaf/mini-a` image. Arguments after the image name are passed to `mini-a`.

```bash
docker network create mini-a-net

# Main (interactive console)
docker run --rm -ti --name mini-a-main --network mini-a-net \
  -e OAF_MODEL="$OAF_MODEL" \
  openaf/mini-a usedelegation=true usetools=true apitoken=secret \
  workerreg=12345 workerregtoken=regsecret workerevictionttl=90000

# Worker (detached)
docker run -d --rm --name calc-worker --network mini-a-net \
  -e OAF_MODEL="$OAF_MODEL" \
  openaf/mini-a workermode=true onport=8080 apitoken=secret \
  workername="calc-worker" workerspecialties="math" \
  workerregurl="http://mini-a-main:12345" workerregtoken=regsecret \
  workerurl="http://calc-worker:8080"
```

On a shared network the container IP would also work, but `workerurl` with the container name stays valid if the container is recreated with a new IP.

If the main runs outside Docker (on the host), publish the worker port and advertise the host address:

```bash
docker run -d --rm --name calc-worker -p 9001:8080 \
  -e OAF_MODEL="$OAF_MODEL" \
  openaf/mini-a workermode=true onport=8080 apitoken=secret \
  workerregurl="http://host.docker.internal:12345" workerregtoken=regsecret \
  workerurl="http://localhost:9001"
```

> If `OAF_MODEL` points to a model server on `localhost` (for example Ollama), containers can't reach it there; use `host.docker.internal` (Docker Desktop) or the host's address.

## Step 6: Docker Compose

`docker-compose.yaml`:

```yaml
services:
  main:
    image: openaf/mini-a
    environment:
      OAF_MODEL: ${OAF_MODEL}
    ports:
    - "8888:8888"                      # web UI
    command: >
      onport=8888 usedelegation=true usetools=true
      apitoken=${MINIA_API_TOKEN} workerreg=12345
      workerregtoken=${MINIA_REG_TOKEN} workerevictionttl=90000

  calc-worker:
    image: openaf/mini-a
    environment:
      OAF_MODEL: ${OAF_MODEL}
    command: >
      workermode=true onport=8080 apitoken=${MINIA_API_TOKEN}
      workername=calc-worker workerspecialties=math,calculation
      workerregurl=http://main:12345 workerregtoken=${MINIA_REG_TOKEN}
      workerurl=http://calc-worker:8080
    depends_on: [main]

  time-worker:
    image: openaf/mini-a
    environment:
      OAF_MODEL: ${OAF_MODEL}
    command: >
      workermode=true onport=8080 apitoken=${MINIA_API_TOKEN}
      workername=time-worker workerspecialties=time,timezone
      mcp="(cmd: 'ojob mcps/mcp-time.yaml')"
      workerregurl=http://main:12345 workerregtoken=${MINIA_REG_TOKEN}
      workerurl=http://time-worker:8080
    depends_on: [main]
```

```bash
export MINIA_API_TOKEN=$(openssl rand -hex 16) MINIA_REG_TOKEN=$(openssl rand -hex 16)
docker compose up -d
docker compose logs -f calc-worker | grep worker-reg     # wait for "Registered with http://main:12345"
open http://localhost:8888                               # ask a question that needs a worker
```

Workers retry every heartbeat, so a worker that starts before the main simply registers on a later heartbeat.

To run several identical replicas, leave out `workerurl` and `container_name`, then scale with `docker compose up -d --scale calc-worker=3`. Each replica advertises its own container IP, which is reachable on the Compose network.

## Step 7: Kubernetes (with autoscaling)

On Kubernetes, pod IPs are routable from other pods, so a scaled `Deployment` can rely on the default advertised address, or set it explicitly from the downward API.

```yaml
apiVersion: v1
kind: Secret
metadata: { name: mini-a-tokens }
stringData:
  api: "change-me-api-token"
  reg: "change-me-reg-token"
  model: "(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)"
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: mini-a-main }
spec:
  replicas: 1
  selector: { matchLabels: { app: mini-a-main } }
  template:
    metadata: { labels: { app: mini-a-main } }
    spec:
      containers:
      - name: main
        image: openaf/mini-a
        env:
        - { name: OAF_MODEL, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: model } } }
        - { name: API_TOKEN, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: api } } }
        - { name: REG_TOKEN, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: reg } } }
        args: ["onport=8888", "usedelegation=true", "usetools=true",
               "apitoken=$(API_TOKEN)", "workerreg=12345",
               "workerregtoken=$(REG_TOKEN)", "workerevictionttl=90000"]
        ports: [{ containerPort: 8888 }, { containerPort: 12345 }]
---
apiVersion: v1
kind: Service
metadata: { name: mini-a-main-reg }
spec:
  selector: { app: mini-a-main }
  ports: [{ name: reg, port: 12345, targetPort: 12345 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: calc-worker }
spec:
  replicas: 2
  selector: { matchLabels: { app: calc-worker } }
  template:
    metadata: { labels: { app: calc-worker } }
    spec:
      terminationGracePeriodSeconds: 30     # lets the worker deregister on SIGTERM
      containers:
      - name: worker
        image: openaf/mini-a
        env:
        - { name: OAF_MODEL, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: model } } }
        - { name: API_TOKEN, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: api } } }
        - { name: REG_TOKEN, valueFrom: { secretKeyRef: { name: mini-a-tokens, key: reg } } }
        - { name: POD_IP, valueFrom: { fieldRef: { fieldPath: status.podIP } } }
        args: ["workermode=true", "onport=8080", "apitoken=$(API_TOKEN)",
               "workername=calc-worker", "workerspecialties=math,calculation",
               "workerregurl=http://mini-a-main-reg:12345",
               "workerregtoken=$(REG_TOKEN)", "workerreginterval=30000",
               "workerurl=http://$(POD_IP):8080"]
        ports: [{ containerPort: 8080 }]
        readinessProbe: { httpGet: { path: /healthz, port: 8080 } }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: calc-worker }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: calc-worker }
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

Notes:
- The main runs as a single replica: the worker pool lives in its memory. To use several mains, list them all in each worker's `workerregurl`.
- Don't advertise a worker `Service` name for scaled replicas: a task's `/status` and `/result` calls must reach the pod that accepted it. Use a pod address, or StatefulSet per-pod DNS (`workerurl=http://$(POD_NAME).calc-worker:8080` with a headless Service).
- Scale-down sends SIGTERM, and the worker deregisters. Pods that die without deregistering are evicted after `workerevictionttl`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Worker logs `Failed to register with ...` | Main isn't running yet, wrong host/port in `workerregurl`, or a firewall. It retries on every heartbeat. |
| Registration returns `401` | `workerregtoken` differs between main and worker. |
| Registered, but delegation says `Remote worker error: HTTP request failed` | Main has no `apitoken` or a different one, **or** the advertised URL isn't reachable from the main. Check `/worker-list`, then `curl` that URL from the main's host or container. Set `workerurl` if needed. |
| `/worker-list` shows the container's internal IP and the main is outside Docker | Set `workerurl` to the published host:port. |
| Worker exits with `Invalid workerurl ...` | Value must be `http(s)://host[:port][/path]`. |
| Tasks go to the wrong worker | Give workers distinct `workername`s and clear `workerdesc`/skills. Mention the worker or skill in the goal to steer routing. |
| Worker disappears from the pool | It missed heartbeats beyond `workerevictionttl`; raise the TTL or lower `workerreginterval`. |

## Security checklist

- Always set `apitoken` on workers. Without it, worker authentication is disabled and a warning is logged.
- Always set `workerregtoken` on the main. Otherwise anyone who can reach the registration port can add a worker, and the main will then send tasks to it.
- Restrict who can call a worker with `apiallow="10.0.0.0/8"` and network policies. Expose only the main's UI port publicly, never the registration port or worker ports.
- Traffic is plain HTTP by default. Across untrusted networks, put workers behind TLS (and advertise `workerurl=https://...`).
- Give `shellworker=true`, `useshell=true`, or `readwrite=true` only to workers whose role needs it, and preferably inside a container.
