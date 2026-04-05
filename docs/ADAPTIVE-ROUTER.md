# Adaptive Tool Router

Mini-A now includes a small rule-based routing layer for tool/action execution.

## Architecture

- `mini-a-router.js` contains the isolated router implementation (`MiniAToolRouter`).
- `mini-a.js` builds an action intent before tool execution and asks the router to choose:
  - selected route
  - rationale
  - fallback chain
  - normalized route metadata
- Tool execution emits a normalized result envelope with:
  - `routeUsed`
  - `rawResult`
  - `normalizedContent`
  - `timing`
  - `error`
  - `errorTrail`
  - `evidence`

## Supported route types

- `direct_local_tool`
- `mcp_direct_call`
- `mcp_proxy_path`
- `shell_execution`
- `utility_wrapper`
- `delegated_subtask`

## Rule-based selection

Router decisions are explainable and based on intent/context hints:

- read vs write intent
- payload size
- latency sensitivity
- determinism preference
- risk level
- structured output preference
- historical route success/failure (`_routeHistory`)

No model prompt logic is embedded in the router.

## Fallback behavior

- Routes are attempted in selected + fallback order.
- Duplicate retry routes are skipped (loop/thrashing guard).
- Each failed attempt is appended to `errorTrail`.
- Successful route attempt is recorded in route history for future decisions.

## Configuration

New arguments:

- `adaptiverouting=true|false` (default: false)
- `routerorder="route1,route2,..."`
- `routerallow="route1,route2,..."`
- `routerdeny="route1,route2,..."`
- `routerproxythreshold=<bytes>` (fallbacks to `mcpproxythreshold` when omitted)

When adaptive routing is off, Mini-A preserves legacy behavior.

## Debug/Audit traces

When `debug=true` (or `verbose/audit`), route traces are appended to context with `[ROUTE ...]` records, including selection details and fallback errors.

## Extension points

Future scoring-based routing can be added by extending:

- `MiniAToolRouter.select(...)`
- intent builders in `MiniA.prototype._buildRoutingIntent`
- outcome tracking in `_recordRouteOutcome`
