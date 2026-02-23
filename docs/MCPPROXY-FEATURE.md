# MCP Proxy Feature

## Overview

The `mcpproxy=true` option enables aggregation of multiple MCP (Model Context Protocol) connections through a single proxy interface. This feature reduces the total context spent by exposing only one tool (`proxy-dispatch`) to the LLM instead of presenting all tools from all connections individually.

```mermaid
flowchart LR
  subgraph Upstream LLM
    LLM[LLM]
  end
  subgraph Mini-A Proxy Layer
    Proxy[proxy-dispatch]
  end
  subgraph Downstream Connections
    Utils[Mini Utils Tool]
    Time[MCP: Time]
    Fin[MCP: Finance]
    Custom[MCP: Custom Server]
  end
  LLM -->|Single tool registration| Proxy
  Proxy -->|List/Search/Call| Utils
  Proxy --> Time
  Proxy --> Fin
  Proxy --> Custom
  Utils -->|Results| Proxy
  Time -->|Time data| Proxy
  Fin -->|Rates| Proxy
  Custom -->|Domain output| Proxy
  Proxy -->|Aggregated response| LLM
  classDef layer fill:#14b8a6,stroke:#0f766e,color:#083344,stroke-width:2px
  classDef downstream fill:#ccfbf1,stroke:#0f766e,color:#0f172a
  class Proxy layer
  class Utils,Time,Fin,Custom downstream
```

## Benefits

1. **Reduced Context Usage**: Instead of registering dozens of tools from multiple MCP servers, only a single `proxy-dispatch` tool is exposed to the LLM
2. **Simplified Tool Management**: The LLM can discover and use tools through a unified interface
3. **Better Scalability**: Add more MCP connections without overwhelming the model's context window
4. **Flexible Tool Discovery**: The `proxy-dispatch` tool supports listing, searching, and calling tools across all downstream connections
5. **Large Payload Handoff**: For large tool inputs/outputs, `proxy-dispatch` can use temporary JSON files (`argumentsFile`, `resultToFile`) to avoid inflating LLM context

## Usage

### Basic Example

```shell
mini-a goal="Your goal here" \
  usetools=true \
  mcpproxy=true \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml'), (cmd: 'ojob mcps/mcp-db.yaml')]" \
  useutils=true
```

### How It Works

When `mcpproxy=true` is set:

1. All MCP connections specified via `mcp="..."` parameter are collected
2. Connections from `useutils=true` are also included
3. All connections are initialized internally by the proxy
4. A single `proxy-dispatch` tool is registered with the LLM
5. The LLM can interact with all downstream tools through this proxy

## CLI Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mcpproxy` | boolean | `false` | Enable MCP proxy mode — aggregates all downstream MCP connections under a single `proxy-dispatch` tool |
| `mcplazy` | boolean | `false` | Defer MCP connection setup until first tool use |
| `mcpproxythreshold` | number (bytes) | `0` | Global auto-spill threshold. When > 0, any `call` result whose serialized size exceeds this value is automatically written to a temporary file instead of being returned inline. `0` = disabled |
| `mcpproxytoon` | boolean | `false` | When `mcpproxythreshold > 0`, serialize object/array results with `af.toTOON(...)` before size checks/spill previews, improving readability and searchability for partial reads |

## The proxy-dispatch Tool

The `proxy-dispatch` tool provides three actions:

### 1. List Connections and Tools

Lists all available MCP connections and their tools.

```javascript
{
  "action": "list",
  "connection": "c1",  // optional: specific connection alias
  "includeTools": true,
  "includeInputSchema": false,
  "includeAnnotations": true
}
```

### 2. Search Tools

Searches for tools by name, description, or annotations.

```javascript
{
  "action": "search",
  "query": "time",
  "connection": "c1",  // optional: limit search to specific connection
  "limit": 10
}
```

### 3. Call Tools

Calls a specific tool on a downstream MCP connection.

```javascript
{
  "action": "call",
  "tool": "get_current_time",
  "connection": "c1",  // optional: specify connection (auto-detected if unique)
  "arguments": {
    // tool-specific parameters
  }
}
```

### 4. Large Input/Output with Temporary JSON Files

Use these options when payloads are large:

- `argumentsFile` (string): load the downstream tool arguments from a JSON file path; when used, the `arguments` field in the response is replaced with `{ _fromFile: "<path>" }` to avoid echoing large args back
- `resultToFile` (boolean): write downstream result JSON into a temporary file and return `resultFile` path instead of embedding the full payload in model context
- `resultSizeThreshold` (integer, bytes): per-call auto-spill threshold — if the serialized result exceeds this size, it is automatically written to a temp file (overrides global `mcpproxythreshold`; 0 = disabled)

```javascript
{
  "action": "call",
  "tool": "filesystemModify",
  "argumentsFile": "/tmp/mini-a-proxy-args-123.json",
  "resultToFile": true
}
```

File-mode response (abridged):

```javascript
{
  "action": "call",
  "tool": "filesystemModify",
  "arguments": { "_fromFile": "/tmp/mini-a-proxy-args-123.json" },
  "resultFile": "/tmp/mini-a-proxy-result-xyz.json",
  "autoSpilled": true,
  "content": [{
    "type": "text",
    "text": "Result auto-spilled to temporary JSON file (exceeded 51200 bytes): /tmp/mini-a-proxy-result-xyz.json (auto-deleted at shutdown).\nSize: 83421 bytes (~20855 tokens).\nTop-level keys: [files, metadata, summary]\nPreview: {\"files\":[{\"name\":\"foo.txt\",\"size\":123}..."
  }]
}
```

Inline result response includes `estimatedTokens` for calibration. The result data is carried exclusively in `content[0].text` (no separate `result` field — avoids double-counting in context metrics):

```javascript
{
  "action": "call",
  "tool": "get_current_time",
  "estimatedTokens": 12,
  "content": [{"type":"text","text":"{\"time\":\"2026-02-18T10:00:00Z\"}"}]
}
```

Temporary files are marked for auto-delete on process shutdown and cleaned by Mini-A shutdown hooks.

### 5. Reading Back a Spilled Result

Use `action='readresult'` with the `resultFile` path to inspect or retrieve a spilled result. This action **bypasses auto-spill entirely** — all sub-operations always return inline.

**Important:** do NOT use a downstream tool (e.g. `filesystemQuery operation:read`) to read spilled proxy result files. That call's result will itself exceed the threshold and trigger another auto-spill, creating an infinite regress. Always use `action='readresult'` for this purpose.

| `op` | Description | Key params |
|------|-------------|------------|
| `stat` **(default)** | Returns byte size, line count, and estimated tokens — no content; always start here | — |
| `head` | First N lines | `lines` (default 50) |
| `tail` | Last N lines | `lines` (default 50) |
| `slice` | Lines fromLine..toLine (1-based, inclusive) | `fromLine`, `toLine` |
| `grep` | Case-insensitive regex search, matching lines with optional context | `pattern`, `context` |
| `read` | Full content inline — only use after `stat` confirms size is manageable | `maxBytes` (0 = unlimited; set e.g. 50000 to truncate safely) |

```javascript
// Step 1: check size before committing to a full read
{"action":"readresult","resultFile":"/tmp/mini-a-proxy-result-abc.json","op":"stat"}
// → { byteSize: 83421, lineCount: 1204, estimatedTokens: 20855 }

// Step 2a: grep for specific content
{"action":"readresult","resultFile":"/tmp/mini-a-proxy-result-abc.json","op":"grep","pattern":"foo\\.txt","context":2}

// Step 2b: or read a known range
{"action":"readresult","resultFile":"/tmp/mini-a-proxy-result-abc.json","op":"slice","fromLine":1,"toLine":100}

// Step 2c: or full read when size is manageable
{"action":"readresult","resultFile":"/tmp/mini-a-proxy-result-abc.json","op":"read"}
```

### 6. Chain Pattern: resultFile → argumentsFile

Pass the `resultFile` path from one call directly as `argumentsFile` to the next:

```javascript
// Step 1: get large dataset, spill to file
{"action":"call","tool":"filesystemQuery","arguments":{"path":"/data"},"resultToFile":true}
// → resultFile: "/tmp/mini-a-proxy-result-abc.json"

// Step 2: pass that file as arguments to next tool
{"action":"call","tool":"dataTransform","argumentsFile":"/tmp/mini-a-proxy-result-abc.json"}
```

### Global Auto-Spill

Set `mcpproxythreshold=<bytes>` at startup to automatically spill any result exceeding that size:

```shell
mini-a goal="..." usetools=true mcpproxy=true mcpproxythreshold=51200 \
  mcp="[...]" useutils=true
```

Optionally add `mcpproxytoon=true` to serialize large object/array results as TOON text (`af.toTOON(...)`) before spill sizing and previews:

```shell
mini-a goal="..." usetools=true mcpproxy=true mcpproxythreshold=51200 mcpproxytoon=true \
  mcp="[...]" useutils=true
```

When auto-spill fires, the response includes `"autoSpilled": true` and the same preview metadata as explicit `resultToFile=true`.

## Implementation Details

### Key Components

1. **`_createMcpProxyConfig(mcpConfigs, args)`**: Creates a dummy MCP configuration that wraps all downstream connections
2. **Proxy State Management**: Uses `global.__mcpProxyState__` to track all connections, tools, and aliases
3. **Helper Functions**: Includes utilities for deep cloning, sanitizing sensitive data, resolving connection IDs, and rebuilding tool indexes

### Connection Tracking

Each MCP connection is assigned:
- A unique ID (MD5 hash of the configuration)
- An alias (e.g., "c1", "c2", "c3")
- Tool catalog with full metadata
- Server information and last refresh timestamp

### Integration Points

The proxy integrates seamlessly with existing mini-a features:
- Works with `usetools=true` for native model tool registration
- Compatible with `useutils=true` to include file utilities
- Supports all MCP connection types (stdio, remote, dummy, etc.)

## Example Scenarios

### Scenario 1: Multiple MCP Servers

```bash
mini-a goal="Get the current time and query the database" \
  usetools=true \
  mcpproxy=true \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml'), (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data')]"
```

The LLM sees only `proxy-dispatch` and learns to:
1. List available tools: `{"action":"list"}`
2. Search for time-related tools: `{"action":"search","query":"time"}`
3. Call the tool: `{"action":"call","tool":"get_current_time","arguments":{}}`

### Scenario 2: With File Utilities

```bash
mini-a goal="Read a file and get the current time" \
  usetools=true \
  mcpproxy=true \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml')]" \
  useutils=true
```

Both the time MCP and file utilities are aggregated through the proxy.

## Comparison: With vs Without Proxy

### Without mcpproxy

```
Tools registered with LLM:
- get_current_time
- get_timezone
- format_datetime
- init (from useutils)
- filesystemQuery (from useutils)
- filesystemModify (from useutils)
Total: 6 tools + their schemas = Large context
```

### With mcpproxy=true

```
Tools registered with LLM:
- proxy-dispatch
Total: 1 tool + its schema = Minimal context
```

## Context Savings Guidance

Using temporary JSON handoff can materially reduce context usage when tool payloads are large. A rough estimate is **~4 characters per token** for JSON-heavy content.

- 20 KB JSON inline payload ≈ 5,000 tokens
- 100 KB JSON inline payload ≈ 25,000 tokens
- 500 KB JSON inline payload ≈ 125,000 tokens

When `resultToFile=true`, the model receives only a short status string + file path (typically a few dozen tokens) instead of the full JSON blob.

### When this is most helpful

- Large `filesystemQuery`/`filesystemModify` results (especially with many files or rich metadata)
- SQL/API MCP tools that return large arrays
- Multi-step pipelines where one tool output becomes another tool input
- Summarization/extraction flows where only a small subset of fields is needed

### Recommended usage incentives

Prefer this pattern when all of the following are true:

1. Payload is expected to be large (hundreds of lines / tens of KB+)
2. You have a safe way to inspect/extract from files: 
   - `useutils=true` (recommended), or
   - `useshell=true readwrite=true`
3. The next step only needs selected fields rather than the full raw payload in context

For small payloads, inline `arguments` and inline `result` are simpler and usually better.

## Technical Notes

1. **Global State**: The proxy maintains global state in `global.__mcpProxyState__` and `global.__mcpProxyHelpers__`
2. **Lazy Initialization**: Compatible with `mcplazy=true` for deferred connection setup
3. **Error Handling**: Each connection tracks errors independently; failures don't break the entire proxy
4. **Tool Caching**: Works with existing tool caching mechanisms (when `toolcachettl` is set)
5. **Security**: Sensitive credentials in connection descriptors are sanitized before being returned

## Based On

This implementation is based on the standalone `mcps/mcp-proxy.yaml` oJob file, which provides the same proxy functionality as a standalone MCP server. The integration into mini-a.js makes this capability available natively without requiring external processes.
