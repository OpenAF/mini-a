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
| `workers` | string | (none) | JSON/SLON array of worker URLs. If provided, delegation routes to remote workers instead of local child agents |
| `maxconcurrent` | number | `4` | Maximum concurrent child agents |
| `delegationmaxdepth` | number | `3` | Maximum delegation nesting depth |
| `delegationtimeout` | number | `300000` | Default subtask deadline (ms) |
| `delegationmaxretries` | number | `2` | Default retry count for failed subtasks |

When `workers` is set, Mini-A fetches each worker's `/info` at startup and routes delegated subtasks by matching required capabilities/limits first (for example `planning`, `useshell`, `maxSteps`, `maxTimeoutMs`). If multiple workers share the same effective profile, Mini-A uses round-robin within that group. If worker profiles are unavailable, it falls back to simple round-robin across all workers.

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
  "useshell": false,
  "timeout": 300,
  "waitForResult": true
}
```

- `goal` (required): The sub-goal for the child agent
- `maxsteps` (optional): Maximum steps for the child (default: 10)
- `useshell` (optional): Allow shell commands in the child
- `timeout` (optional): Deadline in seconds (default: 300)
- `waitForResult` (optional): Block until child completes (default: true)

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

Plus all standard Mini-A parameters: `model`, `mcp`, `rules`, `knowledge`, `useshell`, `readwrite`, `maxsteps`, etc.

### API Endpoints

#### `GET /info`

Returns server capabilities and configuration.

```bash
curl http://localhost:8080/info
```

**Response:**

```json
{
  "status": "ok",
  "name": "mini-a-worker",
  "version": "1.0.0",
  "capabilities": ["run-goal", "delegation", "planning"],
  "limits": {
    "maxConcurrent": 4,
    "defaultTimeoutMs": 300000,
    "maxSteps": 15,
    "useshell": false
  },
  "auth": "bearer"
}
```

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
- Multi-worker load balancing
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
