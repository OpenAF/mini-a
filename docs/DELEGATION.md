# Delegation in Mini-A

## Overview

Mini-A supports **delegation** — the ability for a parent agent to spawn child Mini-A agents to handle sub-goals concurrently. This enables hierarchical problem decomposition, parallel execution, and distributed workloads across processes, containers, or hosts.

There are two delegation modes:

1. **Local Delegation** — A parent Mini-A instance spawns child agents in the same process using async threads (`$doV`)
2. **Remote Delegation via Worker API** — A headless HTTP API server (`mini-a-worker.yaml`) that accepts goal requests and returns results

---

## Part 1: Local Delegation

### When to Use

- You want the LLM to autonomously decide when to delegate sub-goals
- You need concurrent execution of independent subtasks within a single session
- You want to isolate child agent context from the parent (each child starts with a clean slate)

### Enabling Local Delegation

Set `usedelegation=true` when starting Mini-A:

```bash
mini-a usedelegation=true usetools=true goal="Coordinate multiple research tasks"
```

Or in the interactive console:

```bash
mini-a
/set usedelegation true
/set usetools true
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `usedelegation` | boolean | `false` | Enable subtask delegation |
| `workers` | string | (none) | Comma-separated list of worker URLs. If provided, delegation routes to remote workers instead of local child agents |
| `usea2a` | boolean | `false` | Use A2A HTTP+JSON/REST binding (`/message:send`, `/tasks`, `/tasks:cancel`) for remote worker transport |
| `workerreg` | number | (none) | Port to start worker registration HTTP server for dynamic worker discovery |
| `workerregtoken` | string | (none) | Bearer token required by `/worker-register`, `/worker-deregister`, and `/worker-list` |
| `workerevictionttl` | number | `60000` | Heartbeat TTL (ms) before dynamic workers are auto-evicted |
| `maxconcurrent` | number | `4` | Maximum concurrent child agents |
| `delegationmaxdepth` | number | `3` | Maximum delegation nesting depth |
| `delegationtimeout` | number | `300000` | Default subtask deadline (ms) |
| `delegationmaxretries` | number | `2` | Default retry count for failed subtasks |

When `workers` is set, Mini-A fetches each worker's `/.well-known/agent.json` (canonical A2A AgentCard, protocol 0.4.0+) at startup and routes delegated subtasks by matching A2A skills first. It scores workers using skill IDs, tags, names, and examples against the subtask goal. Worker `name` and `description` are secondary signals. If multiple workers share the same effective profile, Mini-A uses round-robin within that group. It falls back to the best compatible worker when no strong skill match exists.

Set `usea2a=true` to switch the parent-to-worker transport from the legacy `/task` + `/status` + `/result` endpoints to the A2A HTTP+JSON/REST flow (`POST /message:send`, `GET /tasks?id=...`, `POST /tasks:cancel`).

### How It Works

When `usedelegation=true` and `usetools=true`:

1. Mini-A registers two MCP tools: `delegate-subtask` and `subtask-status`
2. The LLM can call `delegate-subtask` to spawn a child agent for a sub-goal
3. Child agents run independently with their own step budget, conversation history, and context
4. Results are returned to the parent when the child completes

#### Tool: `delegate-subtask`

```json
{
  "goal": "Analyze the sales data for Q4",
  "maxsteps": 10,
  "timeout": 300,
  "waitForResult": true,
  "worker": "data-east",
  "skills": ["data-analysis"]
}
```

- `goal` (required): The sub-goal for the child agent
- `maxsteps` (optional): Maximum steps for the child (default: 10)
- `timeout` (optional): Deadline in seconds (default: 300)
- `waitForResult` (optional): Block until child completes (default: true)
- `worker` (optional): Partial name hint to prefer a specific remote worker (matched against name, description, URL)
- `skills` (optional): Array of required skill IDs or tags — only workers with **all** listed skills are considered (e.g. `["shell"]`, `["time"]`, `["network","tls"]`)

> **Shell tasks**: use `skills: ["shell"]` to route to a shell-capable worker. Shell capability is declared by the worker via the `shell` A2A skill (set `shellworker=true` when starting the worker).

The tool description is dynamic — when remote workers are registered their names and skill IDs are listed so the LLM can make informed routing decisions.

**Returns:**

```json
{
  "subtaskId": "a1b2c3d4e5f6g7h8",
  "status": "completed",
  "answer": "Q4 sales increased by 23%...",
  "error": null
}
```

#### Tool: `subtask-status`

```json
{
  "subtaskId": "a1b2c3d4e5f6g7h8"
}
```

**Returns:**

```json
{
  "subtaskId": "a1b2c3d4e5f6g7h8",
  "status": "running",
  "goal": "Analyze the sales data for Q4",
  "createdAt": 1707235200000,
  "startedAt": 1707235201000,
  "completedAt": null,
  "attempt": 1,
  "maxAttempts": 2
}
```

### Console Commands

When delegation is enabled, you can manually delegate tasks from the interactive console:

```bash
# Delegate a sub-goal
/delegate Summarize the README.md file

# List all subtasks
/subtasks

# Show subtask details
/subtask a1b2c3d4

# Show subtask result
/subtask result a1b2c3d4

# Cancel a running subtask
/subtask cancel a1b2c3d4
```

Set `showdelegate=true` to display child agent events as separate console lines instead of inline output.

### Key Behaviors

- **Clean Slate**: Children start with no parent conversation history or state
- **Config Inheritance**: Children inherit model config (`OAF_MODEL`, `OAF_LC_MODEL`) but can override specific parameters
- **Concurrency Control**: Limited by `maxconcurrent` (default 4)
- **Depth Tracking**: Maximum nesting depth enforced (default 3)
- **Automatic Retry**: Failed subtasks retry up to `maxAttempts` times with knowledge of previous failures
- **Deadline Enforcement**: Tasks exceeding `deadlineMs` are marked as `timeout`
- **Event Forwarding**: Child interaction events forwarded to parent with `[subtask:id]` prefix

### Example: Parallel Research

```javascript
// Parent goal: "Research and compare three cloud providers"
// The LLM might decide to delegate:

delegate-subtask({ goal: "Summarize AWS features and pricing" })
delegate-subtask({ goal: "Summarize Azure features and pricing" })
delegate-subtask({ goal: "Summarize GCP features and pricing" })

// All three run concurrently (up to maxconcurrent limit)
// Parent collects results and synthesizes comparison
```

---

## Part 2: Remote Delegation via Worker API

### When to Use

- You need to distribute agent workload across multiple processes/containers/hosts
- You want a headless API for programmatic agent invocation
- You need to scale horizontally with multiple worker instances
- You want isolation at the process/container level

### Starting the Worker API

```bash
# Start worker with bearer token authentication
mini-a workermode=true onport=8080 apitoken=your-secret-token

# Or without shell wrapper
ojob mini-a-worker.yaml onport=8080 apitoken=your-secret-token
```

### Worker Configuration

| Parameter | Type | Default | Description |
|---|---|---|---|
| `onport` | number | `8080` | API server port |
| `apitoken` | string | (none) | Required bearer token for auth |
| `apiallow` | string | (none) | Comma-separated IP allowlist |
| `maxconcurrent` | number | `4` | Maximum concurrent tasks |
| `defaulttimeout` | number | `300000` | Default task deadline (ms) |
| `maxtimeout` | number | `600000` | Maximum allowed deadline (ms) |
| `taskretention` | number | `3600` | Seconds to keep completed results |
| `workername` | string | `"mini-a-worker"` | Worker name reported by `/info` |
| `workerdesc` | string | `"Mini-A worker API"` | Worker description reported by `/info` |
| `workerskills` | string | (none) | JSON/SLON array of A2A skill objects, or comma-delimited skill IDs (auto-expanded to minimal `{ id, name, tags }` objects) |
| `workertags` | string | (none) | Comma-separated tags appended to the default `run-goal` worker skill |
| `workerspecialties` | string | (none) | Comma-separated specialty tags also injected into `run-goal`. Shorthand alternative to full `workerskills` JSON |
| `shellworker` | boolean | `false` | Sets `useshell=true` and emits a `shell` A2A skill, enabling parent routing via `skills=["shell"]` |
| `workerregurl` | string | (none) | Comma-separated parent registration URL(s) to self-register with |
| `workerregtoken` | string | (none) | Bearer token used for registration endpoint authentication |
| `workerreginterval` | number | `30000` | Heartbeat interval (ms) used to refresh registration |

Plus all standard Mini-A parameters: `model`, `mcp`, `rules`, `knowledge`, `useshell`, `readwrite`, `maxsteps`, etc.

### API Endpoints

#### `GET /.well-known/agent.json`

The **canonical** A2A AgentCard (protocol 0.4.0+). Parent agents probe this endpoint first for worker discovery and skill-based routing.

```bash
curl http://localhost:8080/.well-known/agent.json
```

**Response:**

```json
{
  "protocolVersion": "0.4.0",
  "name": "network-east",
  "description": "Network diagnostics worker",
  "url": "http://10.0.0.2:8081",
  "preferredTransport": "HTTP+JSON",
  "capabilities": { "streaming": false, "pushNotifications": false, "stateTransitionHistory": true },
  "skills": [
    {
      "id": "network-latency",
      "name": "Network latency",
      "description": "Measure TCP and TLS latency for remote hosts",
      "tags": ["network", "latency", "tls", "port"],
      "examples": ["Measure latency to yahoo.co.jp:443"]
    }
  ]
}
```

#### `GET /info`

Legacy endpoint (protocol 0.3.x compatibility). Returns capabilities and skills. `limits.useshell` was removed in protocol 0.4.0 — shell capability is now declared via the `shell` A2A skill.

### Specializing Workers

Use A2A skills to make routing behave like tool selection. Workers advertise their skills; the parent's `delegate-subtask` tool lists them in its description so the LLM can route intelligently.

```bash
# Shell worker — use shellworker=true for automatic shell skill emission
mini-a workermode=true onport=8081 apitoken=secret \
  workername="shell-worker" workerdesc="Shell execution worker" \
  shellworker=true

# Network worker — comma shorthand for workerskills
mini-a workermode=true onport=8082 apitoken=secret \
  workername="network-east" workerdesc="Network diagnostics worker" \
  workerspecialties="network,latency,tls" \
  workerskills='[{ "id": "network-latency", "name": "Network latency", "description": "Measure TCP and TLS latency for remote hosts", "tags": ["network","latency","tls","port"], "examples": ["Measure latency to yahoo.co.jp:443"] }]'

# Time worker — plain comma shorthand (auto-expands to minimal skill objects)
mini-a workermode=true onport=8083 apitoken=secret \
  workername="time-worker" workerdesc="Timezone and current time worker" \
  workerspecialties="time,timezone,clock"
```

Mini-A also infers skills from enabled features: `mcp=...` entries, `useutils=true`, `useskills=true`, and `useshell=true` (emits `shell` skill). Explicit `workerskills` take precedence.

#### Protocol Version Compatibility

| Version | Profile endpoint | `limits.useshell` | Shell routing |
|---------|-----------------|-------------------|---------------|
| 0.3.x | `GET /info` (primary) | Present | `requiresShell` flag on caller |
| 0.4.0 | `GET /.well-known/agent.json` (primary, `/info` fallback) | Removed | `shell` A2A skill on worker |

Parents on 0.4.x probe `/.well-known/agent.json` first; if unavailable, fall back to `/info`. Workers on 0.3.x still interoperate — their `limits.useshell` field arrives but is ignored. The `shell` skill (absent on 0.3.x workers) will simply not match `skills=["shell"]` filter, which is correct: those workers haven't declared shell capability via the new protocol.

#### `POST /task`

Submit a new task.

```bash
curl -X POST http://localhost:8080/task \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Analyze data and produce summary",
    "args": {
      "maxsteps": 10,
      "useplanning": true,
      "format": "json"
    },
    "timeout": 300,
    "metadata": {
      "parentTaskId": "uuid-parent",
      "delegatedBy": "main-agent"
    }
  }'
```

**Request Fields:**

- `goal` (required): Goal for the agent (max 10K chars)
- `args` (optional): Agent configuration overrides (validated against allowlist)
- `timeout` (optional): Deadline in seconds (clamped to `maxtimeout`)
- `metadata` (optional): Custom metadata for tracking

**Allowed `args` keys:**

`goal`, `format`, `raw`, `chatbotmode`, `useplanning`, `updatefreq`, `updateinterval`, `forceupdates`, `planlog`, `planmode`, `planformat`, `convertplan`, `maxsteps`

**Response (202):**

```json
{
  "taskId": "uuid-task-123",
  "status": "queued",
  "createdAt": "2026-02-06T17:00:00.000Z"
}
```

#### `POST /status`

Poll task status.

```bash
curl -X POST http://localhost:8080/status \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "uuid-task-123" }'
```

**Response:**

```json
{
  "taskId": "uuid-task-123",
  "status": "running",
  "progress": {
    "step": 3,
    "maxSteps": 10
  },
  "startedAt": "2026-02-06T17:00:01.000Z",
  "elapsed": 15000,
  "events": [
    {
      "event": "💡",
      "message": "Analyzing data...",
      "ts": 1707235201000
    }
  ]
}
```

**Status values:** `queued`, `running`, `completed`, `failed`, `cancelled`, `timeout`

#### `POST /result`

Retrieve final result.

```bash
curl -X POST http://localhost:8080/result \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "uuid-task-123" }'
```

**Response:**

```json
{
  "taskId": "uuid-task-123",
  "status": "completed",
  "result": {
    "goal": "Analyze data and produce summary",
    "answer": "Summary: ...",
    "format": "json",
    "metrics": {},
    "state": {},
    "error": null
  },
  "completedAt": "2026-02-06T17:00:12.000Z",
  "duration": 12000
}
```

#### `POST /cancel`

Cancel a running task.

```bash
curl -X POST http://localhost:8080/cancel \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "uuid-task-123",
    "reason": "User cancelled"
  }'
```

**Response:**

```json
{
  "taskId": "uuid-task-123",
  "status": "cancelled"
}
```


### A2A HTTP+JSON/REST Endpoints (additional compatibility)

The worker also exposes A2A-style HTTP+JSON endpoints aligned with section 11 of the A2A protocol specification:

- `POST /message:send` — submits a task from `message.parts[].text`
- `GET /tasks` — lists known tasks
- `GET /tasks?id=<taskId>` — returns one task record (query parameter based lookup)
- `POST /tasks:cancel` — cancels a task using `{ "id": "..." }` or `{ "taskId": "..." }`
- `GET /.well-known/agent.json` — public Agent Card
- `GET /extendedAgentCard` — authenticated extended Agent Card

Example:

```bash
curl -X POST http://localhost:8080/message:send \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "contextId": "ctx-1",
    "message": {
      "messageId": "msg-1",
      "role": "ROLE_USER",
      "parts": [{ "text": "Summarize the release blockers" }]
    }
  }'

curl -H "Authorization: Bearer your-secret-token" \
  "http://localhost:8080/tasks?id=<taskId>"
```


#### `GET /healthz`

Health check endpoint (no auth required).

```bash
curl http://localhost:8080/healthz
```

**Response:**

```json
{
  "status": "ok",
  "uptime": 123456
}
```

#### `GET /metrics`

Task and delegation metrics (no auth required).

```bash
curl http://localhost:8080/metrics
```

**Response:**

```json
{
  "tasks": {
    "total": 10,
    "queued": 1,
    "running": 2,
    "completed": 6,
    "failed": 0,
    "cancelled": 1
  },
  "delegation": {
    "total": 10,
    "running": 2,
    "completed": 6,
    "failed": 0,
    "cancelled": 1,
    "timedout": 0,
    "retried": 1
  }
}
```

---

## Part 3: Dynamic Worker Registration

Dynamic registration allows worker pods to self-register to a parent Mini-A instance at startup and deregister on shutdown. Static `workers=` and dynamic workers coexist in the same pool.

### Parent-Side Parameters

- `workerreg=<port>` starts a dedicated registration HTTP server.
- `workerregtoken=<token>` enables bearer authentication for registration endpoints.
- `workerevictionttl=<ms>` evicts dynamic workers that miss heartbeats beyond TTL.

### Worker-Side Parameters

- `workerregurl="<url1,url2>"` enables self-registration against one or more parents.
- `workerregtoken=<token>` sends `Authorization: Bearer <token>`.
- `workerreginterval=<ms>` controls heartbeat frequency.

### Registration Endpoints (Parent `workerreg` Port)

- `POST /worker-register` registers or refreshes a worker.
- `POST /worker-deregister` removes a dynamic worker.
- `GET /worker-list` returns worker list plus registration metrics.
- `GET /healthz` simple liveness response.

### Auto-Eviction and Coexistence Rules

- Dynamic workers get a heartbeat timestamp on registration.
- The watchdog checks heartbeats and auto-evicts stale dynamic workers.
- Static workers from `workers=` are never removed by deregistration or TTL eviction.

### Example: Dynamic Registration with Kubernetes HPA

```bash
# Main
mini-a usedelegation=true usetools=true \
  workerreg=12345 workerregtoken=secret workerevictionttl=90000

# Worker pod/container
mini-a workermode=true onport=8080 apitoken=secret \
  workerregurl="http://mini-a-main-reg:12345" \
  workerregtoken=secret workerreginterval=30000
```

---

## Examples

### Example 1: Single Delegation

```bash
# Start Mini-A with delegation
mini-a usedelegation=true usetools=true

# Goal that triggers delegation
Goal: "Fetch the weather for London, then summarize it"
```

The LLM might use:

```json
{
  "thought": "I'll delegate the weather fetch to a child agent",
  "action": "delegate-subtask",
  "params": {
    "goal": "Get current weather for London using an API",
    "maxsteps": 5,
    "useshell": false,
    "waitForResult": true
  }
}
```

### Example 2: Parallel Delegation

```bash
# Goal: "Compare performance of sorting algorithms"
```

The LLM might spawn multiple children in parallel:

```json
// Child 1: Benchmark bubble sort
delegate-subtask({ goal: "Benchmark bubble sort on 10K elements" })

// Child 2: Benchmark quicksort
delegate-subtask({ goal: "Benchmark quicksort on 10K elements" })

// Child 3: Benchmark merge sort
delegate-subtask({ goal: "Benchmark merge sort on 10K elements" })
```

All run concurrently (up to `maxconcurrent`), then parent collects and compares results.

### Example 3: Multi-Level Delegation

```bash
# Depth 0 (Parent): "Plan and execute a multi-phase project"
# Depth 1 (Child):  "Research phase - gather requirements"
# Depth 2 (Child):  "Summarize academic papers on topic X"
```

Each level can delegate to the next, up to `delegationmaxdepth`.

### Example 4: Using the Worker API

```bash
# Terminal 1: Start worker
mini-a workermode=true onport=8080 apitoken=my-secret maxconcurrent=8

# Terminal 2: Submit task
curl -X POST http://localhost:8080/task \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Generate a technical report on quantum computing",
    "args": { "maxsteps": 20, "format": "md" },
    "timeout": 600
  }'

# Returns: { "taskId": "abc123...", "status": "queued", ... }

# Poll for status
curl -X POST http://localhost:8080/status \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "abc123..." }'

# Get result when complete
curl -X POST http://localhost:8080/result \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "abc123..." }'
```

### Example 5: Dynamic Worker Registration with Kubernetes HPA

```bash
# Parent instance with registration server
mini-a usedelegation=true usetools=true \
  workerreg=12345 workerregtoken=secret workerevictionttl=90000

# Worker instances self-register and heartbeat
mini-a workermode=true onport=8080 apitoken=secret \
  workerregurl="http://mini-a-main-reg:12345" \
  workerregtoken=secret workerreginterval=30000
```

---

## Security Considerations

### Authentication

- **Worker API**: Always set `apitoken=` in production
- Bearer token sent via `Authorization: Bearer <token>` header
- No OAuth or mTLS in v1

### IP Allowlist

- Set `apiallow=` to restrict access by IP:

```bash
mini-a workermode=true apitoken=secret apiallow="127.0.0.1,192.168.1.0/24"
```

### Parameter Allowlist

The worker API only accepts a whitelist of remote parameters (`goal`, `format`, `maxsteps`, etc.). Server-side config (like `useshell`, `readwrite`, `mcp`) cannot be overridden by clients.

### Shell Access

- Children inherit `useshell` from parent unless overridden
- Worker API disables shell by default; enable with `useshell=true` at server startup

### Depth Limits

Maximum delegation depth prevents infinite recursion and resource exhaustion.

---

## Monitoring and Metrics

### Delegation Metrics

Delegation metrics are included in `agent.getMetrics()`:

```javascript
{
  delegation: {
    total: 10,
    running: 2,
    completed: 6,
    failed: 1,
    cancelled: 1,
    timedout: 0,
    retried: 2,
    workers_total: 5,
    workers_static: 1,
    workers_dynamic: 4,
    workers_healthy: 4,
    avgDurationMs: 12500,
    maxDepthUsed: 2
  }
}
```

### Console Stats

```bash
/stats
```

Shows delegation metrics alongside other agent stats.

### Worker Metrics

```bash
curl http://localhost:8080/metrics
```

Returns task counts and delegation stats from the worker API.

---

## Troubleshooting

### "Delegation is not enabled"

Ensure `usedelegation=true` when starting Mini-A.

### "Maximum delegation depth exceeded"

Increase `delegationmaxdepth=` or reduce nesting levels.

### "Task timeout"

Increase `delegationtimeout=` or `timeout` parameter in task submission.

### "Unauthorized" from Worker API

Check that `Authorization: Bearer <token>` header matches server's `apitoken=`.

### Child agents not starting

Check `maxconcurrent=` setting and ensure parent has available slots.

---

## Limitations (v1)

- **No webhooks/callbacks**: Polling only for status/result
- **No Docker isolation**: Future phase
- **Result size limits**: Not enforced in v1 (may cause memory issues for very large results)
- **No streaming**: Entire result returned when task completes
- **In-memory task queue**: Task state does not survive worker restarts

---

## Relationship to `mcp-mini-a.yaml`

- **`mcp-mini-a.yaml`**: Exposes Mini-A as an MCP server (STDIO/HTTP) for integration with other MCP clients
- **`mini-a-worker.yaml`**: Headless REST API for programmatic goal execution

They are **complementary**:

- Use `mcp-mini-a.yaml` when you want Mini-A to be discoverable as an MCP tool
- Use `mini-a-worker.yaml` when you want a pure HTTP API for task submission

Both can run simultaneously if needed.

---

## Future Enhancements

- Webhook/callback support for async notifications
- Docker container isolation for child agents
- Streaming results via SSE
- Persistent task queue (survives worker restart)
- Result size limits and compression

---

## Summary

Mini-A delegation enables:

✅ **Hierarchical problem decomposition** — Break complex goals into manageable subtasks  
✅ **Parallel execution** — Run independent subtasks concurrently  
✅ **Context isolation** — Each child starts with a clean slate  
✅ **Distributed workloads** — Scale across processes/containers/hosts via Worker API  
✅ **Autonomous delegation** — LLM decides when to delegate  
✅ **Manual delegation** — Use console commands for interactive control

Combine local and remote delegation to build sophisticated multi-agent workflows!
