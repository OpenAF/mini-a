# Decision-assisted selection and complexity

`modeldec` (per run/session) or `OAF_DECIDE_MODEL` (environment fallback) configures a dedicated, stateless OpenAF decision model. Mini-A automatically uses it for semantic selection when `mcpdynamic=true` or `capabilityselection=true`, and for ambiguous (`medium`) goal complexity at the escalation-threshold check. The environment variable alone does not enable dynamic selection. This requires an OpenAF runtime exposing `$llm().getCapabilities()` and `decideWithStats()`.

```bash
# Choose a model supported by your installed OpenAF decision adapter.
export OAF_DECIDE_MODEL="(type: gemini, model: gemini-2.5-flash-lite, key: '...', timeout: 30000)"
ojob mini-a.yaml goal="Find the duplicate payment in Ada's ledger" capabilityselection=true nosetmcpwd=true \
  mcp="(cmd: 'ojob evals/fixtures/decision-catalog.yaml')"
```

The examples use isolated fixture data from this checkout. Run Mini-A with your existing `OAF_MODEL` and, for example:

```bash
ojob mini-a.yaml goal="Find the duplicate payment in Ada's ledger" mcpdynamic=true nosetmcpwd=true \
  mcp="(cmd: 'ojob evals/fixtures/decision-catalog.yaml')"
```

Automatic skill activation uses a bounded selector with decide, low-cost, then main fallback. It defaults on only with `usedecide=true` and a configured `modeldec` or `OAF_DECIDE_MODEL`; explicit `skillsautosearch` overrides win. Decision ranking of skill entries in the capability registry does not itself activate skills.

`usedecide=false` disables both internal decision integrations and the decision utility. `llmcomplexity=false` disables the automatic complexity check; `llmcomplexity=true` also enables the previous low-cost complexity check as a fallback when an LC model is configured. Omitted complexity configuration retains the heuristic when no decision model is present. Console, web, CLI, and worker sessions accept these switches. Remote worker tasks may opt out but cannot override an operator's explicit opt-out.

Selection asks one ordinal relevance question per candidate: irrelevant, potentially useful, directly relevant. Positive results are ordered by relevance with stable ties. Capability selection retains `capabilitylimit` and policy filtering. Worker/skill entries in the existing registry can be ranked, but selection does not activate them or grant execution permissions. The initial implementation falls back to the original selector for empty results, errors, more than 64 candidates, or requests above a conservative 48 KiB UTF-8 budget. It does not silently truncate the catalog.

A decision failure uses the existing Mini-A path. It does not retry the decision or switch to another decision model. The previous dynamic selector may still make its usual LC/main calls. Planning/orchestration complexity heuristics and hard execution limits retain their existing behavior.

Decision requests use a fresh bare client, sharing neither tools nor conversational history. `getCapabilities()` describes adapter support without making a provider request; unknown availability still permits an attempt. Native probabilities are provider information, not calibrated correctness. Structured decisions have null probability fields. Internal selection uses ordinal answers and does not require probabilities.

## Verdict gates

With an explicit `usedecide=true` and a configured decision model, selected internal verdicts consult the decision model first. A gate may only **skip an expensive call**; it never replaces output that other code consumes. Whenever the decision is unavailable, fails, returns an invalid answer, exceeds the 48 KiB / 32-question budget, or does not give a confident "all clear", the original code path runs unchanged. Each fallback is counted in the decision metrics (`fallbacks`, `reasons`) and traced as `decision_fallback`. A configuration or runtime-support error disables further gate attempts for the rest of the run.

| Site | Decision question | Decide skips the call when | Otherwise |
|------|-------------------|----------------------------|-----------|
| Plan critique (`_critiquePlanWithLLM`) | Is the plan immediately executable? | Verdict is `pass`: a `PASS` critique tagged `raw.source: "decide"` is recorded in the usual shape | The validator model runs and produces issues/missing work for replanning |
| Research validation (`_validateResearchOutcome`) | Does the output fully meet the criteria? | Verdict `pass` **and** top quality level (score 1, meeting any `PASS`/`score>=` threshold) | The validator model runs, so the next cycle still receives issues and suggestions. Never consulted when `valtools=true` |
| LC escalation deferral (`_decideLcDeferral`) | Is the latest low-cost response making real progress despite the escalation signal? | Not a skip: replaces the heuristic `_scoreLCResponse >= 0.7` deferral rule with `progressing`/`stuck` | The heuristic confidence score decides exactly as before |

Gates use `_decisionGate(operation, args, state, questions, validate)` in `mini-a-decision.js`, which never throws. It is separate from the existing selection and complexity paths, which keep their own defaults.

## Decision utility

With a valid `OAF_DECIDE_MODEL` configuration, `useutils=true usedecide=true`
exposes a model-callable `decide` tool. Both flags must explicitly be true;
the environment variable alone does not expose it. It is available with
`usestdutils=true` and respects `utilsallow`/`utilsdeny`.

```bash
ojob mini-a.yaml goal="Classify these incident reports against the supplied severity criteria" \
  useutils=true usedecide=true utilsallow=decide
```

The tool accepts only `state` and `questions`, using the same choice, boolean
and ordinal score types as the MCP below. Batch related questions into one
call. For example:

```json
{
  "state": {"ticket": "The customer was charged twice."},
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Choose the responsible team.",
      "criteria": {"billing": "Payments and refunds", "technical": "Software failures"}
    },
    "urgent": {"type": "boolean", "instructions": "Does this require immediate attention?"}
  }
}
```

Each request is limited to 32 questions and 48 KiB of serialized UTF-8 data.
The tool permits at most 32 consultation attempts per `start()` run, shared
across rebuilt tool registrations and concurrent calls. New runs reset that
quota. Oversized requests return `MINI_A_DECISION_REQUEST_BUDGET`; exhausted
runs return `MINI_A_DECISION_TOOL_LIMIT`. It accepts no provider options,
credentials, model overrides or file/image paths.

Successful calls return `{response, stats}` through the usual utility response
envelope. Calls use the existing decision metrics and the run rate limiter.
Provider failures return sanitized errors without retries, model fallback or
tool-result caching. The tool consults the decision model; it does not execute
actions, grant permissions, verify source facts, or change skill selection.
Standalone `MiniUtilsTool` instances do not implicitly create a decision client.

## Generic MCP

The server works without `OAF_MODEL` or a full Mini-A agent. Configure `OAF_DECIDE_MODEL` on the server, then launch:

```bash
ojob mcps/mcp-decide.yaml                 # STDIO
ojob mcps/mcp-decide.yaml onport=8888     # HTTP /mcp
```

A conventional STDIO client configuration is:

```json
{
  "mcpServers": {
    "decide": {
      "command": "ojob",
      "args": ["/path/to/mini-a/mcps/mcp-decide.yaml"]
    }
  }
}
```

Ensure that the client process inherits `OAF_DECIDE_MODEL`, or configure that environment variable through the client's environment settings. HTTP uses the standard `httpdMCP` shortcut, including optional bearer authentication (`OJOB_MCP_AUTH_TOKEN`) and audit logging described in [the MCP guide](../mcps/README.md#authenticating-http-mcp-servers). STDIO uses OpenAF's direct MCP callbacks to preserve typed error messages.

Tools:

- `get-capabilities`: returns `{configured, capabilities?, error?}` without a provider call. Configuration values, credentials and endpoint URLs are excluded.
- `decide`: accepts `{state, questions, options?}` and returns OpenAF's `{response, stats}` wrapper. One request evaluates every named question against the same state. No tools or Mini-A run are executed.

Example tool arguments:

```json
{
  "state": {"ticket": "The customer was charged twice."},
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Choose the responsible team.",
      "criteria": {"billing": "Payments and refunds", "technical": "Software failures"}
    },
    "urgent": {"type": "boolean", "instructions": "Does this require immediate attention?"},
    "priority": {
      "type": "score",
      "instructions": "Assess urgency.",
      "criteria": ["Routine", "Soon", "Urgent"]
    }
  },
  "options": {"strategy": "auto"}
}
```

`state` accepts nonempty text or a JSON object/array. Score levels are zero-based. The supported options are `strategy`, `model`, `requireProbabilities`, `providerOptions`, and `images`; OpenAF enforces provider-specific allowlists and validation. A model override stays within the configured provider and endpoint. Clients cannot supply model credentials or provider URLs.

Images are inline only: Ollama native decisions accept raw base64 strings; OpenAI native decisions accept base64 image data URLs. Paths, external URLs, and structured image decisions are rejected. Actual vision support depends on the configured model. `requireProbabilities=true` requires eligible native support and cannot be met by structured output or generated confidence values.

The MCP returns typed failures without retries or model fallback. OpenAF error codes include `LLM_DECISION_INVALID_REQUEST`, `LLM_DECISION_UNSUPPORTED`, `LLM_DECISION_CONTRACT_UNVERIFIED`, `LLM_DECISION_PROVIDER_ERROR`, and `LLM_DECISION_INVALID_RESPONSE`. Configuration/runtime errors use `MINI_A_DECISION_NOT_CONFIGURED`, `MINI_A_DECISION_INVALID_CONFIG`, and `MINI_A_DECISION_RUNTIME_UNSUPPORTED`. HTTP errors include the sanitized code and available status; STDIO error text includes the code. Provider response bodies are excluded.

## Verification and evaluation

```bash
ojob tests/decision.yaml
ojob tests/decisionUtils.yaml
ojob tests/capabilityPolicy.yaml
ojob tests/eval.yaml
python3 tests/decisionMcp.py
# Optional: two bounded calls to the configured decision provider
oaf -f tests/decisionLive.js
```

The MCP integration test starts a synthetic loopback Ollama provider and actual STDIO/HTTP MCP processes. It exercises transport wiring, validation, images, authentication, concurrency, usage and errors; it does not establish live model quality or real image inference.

For a live comparison, configure both model variables and run the paired evaluation suite from the checkout:

```bash
ojob mini-a.yaml eval=true evalfile=evals/decide.yaml evalout=/tmp/mini-a-decide-eval.json
```

`evals/decide.yaml` includes enabled/disabled variants for ambiguous phrasing, overlapping tools, an irrelevant catalog, and complexity-driven escalation. It uses an isolated, read-only fixture MCP. Review task success, tool failures, selection traces, total latency/tokens, and decision fallback rates. Keep evaluation judgments independent of the model under evaluation. Fixture passes establish contract behavior; claiming a quality improvement requires held-out task-success evidence with no regression. Cost is not inferred when provider pricing or usage is unavailable.

### Per-run decision model

`modeldec` accepts a SLON/JSON model configuration and overrides `OAF_DECIDE_MODEL` for the run or session. Configure it with `/model dec` or `/set modeldec` in the console and the advanced web Models screen. `/models` shows its effective source. `usedecide=false` still disables decision calls. Decision stats and metrics include the model, provider, source, call counts, timing, and token usage without credentials. The standalone decision MCP continues to use its server environment.

```sh
mini-a modeldec="(type: openai, model: gpt-5-mini, key: '...')" usedecide=true goal="Review the available tools"
```
