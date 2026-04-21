# Mini-A Quick Reference Cheatsheet

A comprehensive quick reference for all Mini-A parameters, modes, and common usage patterns.

**Website**: https://mini-a.ai | **Toolkit**: https://tk.mini-a.ai

## Table of Contents

- [Quick Start](#quick-start)
- [Core Parameters](#core-parameters)
- [Model Configuration](#model-configuration)
  - [Advisor Strategy Mode](#advisor-strategy-mode)
- [Shell & Execution](#shell--execution)
- [MCP Integration](#mcp-integration)
- [Planning Features](#planning-features)
- [Visual & Output](#visual--output)
- [Knowledge & Context](#knowledge--context)
- [Working Memory](#working-memory)
- [Wiki Knowledge Base](#wiki-knowledge-base)
- [Choosing Knowledge Features](#choosing-knowledge-features)
- [Mode Presets](#mode-presets)
- [Advanced Features](#advanced-features)
  - [Web UI Parameters](#web-ui-parameters)
- [Rate Limiting & Performance](#rate-limiting--performance)
- [Security & Safety](#security--safety)
- [Common Examples](#common-examples)
- [Agent Files](#agent-files)

---

## Quick Start

### Minimal Setup

```bash
# 1. Set your model
export OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000, temperature: 1)"

# 2. Run Mini-A
mini-a goal="list files in current directory" useshell=true
```

### With Low-Cost Model (Dual-Model)

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-key')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-key')"
mini-a goal="summarize this repository"
```

## Agent Files

- Use `agent=<path-or-inline-markdown>` to preload Mini-A parameters from YAML frontmatter metadata.
- Use `--agent` to print a starter agent markdown template.
- Use `--skill` to print a starter skill markdown template.
- Use `--command` to print a starter slash-command markdown template.
- Use `--hook` to print a starter hook YAML template.
- See [AGENT-CHEATSHEET.md](AGENT-CHEATSHEET.md) for the full key mapping and examples.

---

## Core Parameters

### Required

| Parameter | Description | Example |
|-----------|-------------|---------|
| `goal` | Objective for the agent to achieve | `goal="analyze code and suggest improvements"` |
| `exec` | Execute one custom slash command/skill template non-interactively (different from `goal`) | `exec="/my-command arg1 arg2"` |

### Essential Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxsteps` | number | `15` | Maximum consecutive steps without progress before forcing final answer |
| `earlystopthreshold` | number | `3` (5 with LC) | Identical consecutive errors before early stop (auto-adjusts for low-cost models) |
| `verbose` | boolean | `false` | Enable verbose logging |
| `debug` | boolean | `false` | Enable debug mode with detailed logs |
| `debugfile` | string | - | Redirect debug output to a file as NDJSON instead of screen (implies `debug=true`) |
| `debugch` | string | - | SLON/JSON debug channel for main LLM (requires `$llm.setDebugCh`) |
| `debuglcch` | string | - | SLON/JSON debug channel for low-cost LLM |
| `debugvalch` | string | - | SLON/JSON debug channel for validation LLM (used when `llmcomplexity=true`) |
| `raw` | boolean | `false` | Return raw string instead of formatted output |
| `outfile` | string | - | Path to save final answer (if not provided, prints to console) |

**Examples:**

```bash
# Basic goal with verbose logging
mini-a goal="summarize README.md" verbose=true

# Debug mode for troubleshooting
mini-a goal="find errors in logs" debug=true useshell=true

# Save output to file
mini-a goal="generate project report" outfile=report.md useshell=true
```

---

## Model Configuration

### Model Parameter

| Parameter | Description | Example |
|-----------|-------------|---------|
| `model` | Override OAF_MODEL for this session | `model="(type: openai, model: gpt-4, key: '...')"` |
| `modellc` | Override OAF_LC_MODEL for this session | `modellc="(type: openai, model: gpt-3.5-turbo, key: '...')"` |
| `modelval` | Override OAF_VAL_MODEL for this session | `modelval="(type: openai, model: gpt-4o-mini, key: '...')"` |
| `modelman` | Launch interactive model manager | `modelman=true` |
| `memoryman` | Launch interactive memory manager (global/session memory ops) | `memoryman=true usememory=true memoryuser=true` |
| `modellock` | Lock model tier: `"main"`, `"lc"`, or `"auto"` (default) | `modellock=lc` |
| `lcescalatedefer` | Defer escalation 1 step when LC confidence ≥ 0.7 (default: `true`) | `lcescalatedefer=false` |
| `lcbudget` | Max LC tokens before switching permanently to main model (0=unlimited) | `lcbudget=50000` |
| `llmcomplexity` | Use LC model to validate "medium" complexity heuristic (default: `false`) | `llmcomplexity=true` |
| `promptprofile` | System prompt verbosity profile: `minimal`, `balanced` (default), or `verbose` (auto when `debug=true`) | `promptprofile=minimal` |
| `systempromptbudget` | Maximum estimated token size for the system prompt. When exceeded, Mini-A drops lower-priority sections such as examples and detailed tool guidance | `systempromptbudget=4000` |

### Advisor Strategy Mode

When `modelstrategy=advisor`, the LC model stays as executor and the main model is consulted selectively for difficult steps — combining cost efficiency with main-model quality on hard decisions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `modelstrategy` | string | `default` | Model orchestration profile: `"default"` (LC-first with escalation) or `"advisor"` (LC executor + main model as advisor) |
| `advisormaxuses` | number | `2` | Maximum advisor consultations per run when `modelstrategy=advisor` |
| `advisorenable` | boolean | `true` | Master toggle for advisor consultations when `modelstrategy=advisor` |
| `advisoronrisk` | boolean | `true` | Allow advisor consults on risk signals |
| `advisoronambiguity` | boolean | `true` | Allow advisor consults on ambiguity signals |
| `advisoronharddecision` | boolean | `true` | Allow advisor consults for hard-decision checkpoints |
| `advisorcooldownsteps` | number | `2` | Minimum step distance between consecutive advisor consultations |
| `advisorbudgetratio` | number | `0.20` | Fraction of session token budget advisor calls may consume before low-value consults are declined |
| `emergencyreserve` | number | `0.10` | Portion of advisor budget reserved for high-risk / high-value consults |
| `harddecision` | string | `warn` | Hard-decision checkpoint mode: `"require"` (blocks action until advisor succeeds), `"warn"`, or `"off"` |
| `evidencegate` | boolean | `false` | Enable lightweight evidence gating for non-trivial actions and final claims |
| `evidencegatestrictness` | string | `medium` | Tuning level for evidence gate heuristics: `"low"`, `"medium"`, or `"high"` |

**Examples:**

```bash
# Advisor strategy: LC executes, main model advises on hard steps
# Requires OAF_MODEL (main) and OAF_LC_MODEL (executor)
mini-a goal="refactor authentication system" \
  modelstrategy=advisor useshell=true

# Limit to 3 advisor consultations per run
mini-a goal="complex analysis task" \
  modelstrategy=advisor advisormaxuses=3

# Require advisor approval for hard-decision actions
mini-a goal="deploy to production" \
  modelstrategy=advisor harddecision=require useshell=true

# Advisor with evidence gating for higher-confidence final answers
mini-a goal="research topic and summarize" \
  modelstrategy=advisor evidencegate=true evidencegatestrictness=high

# Increase budget fraction allowed for advisor calls
mini-a goal="long complex task" \
  modelstrategy=advisor advisorbudgetratio=0.35
```

### Provider Examples

| Provider   | Model                   | Example |
|------------|-------------------------|---------|
| Anthropic  | claude-haiku-4.5        | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-haiku-4-5-20251001, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Anthropic  | claude-opus-4.5         | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-opus-4-5-20251101, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Anthropic  | claude-sonnet-4.5       | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-sonnet-4-5-20250929, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Bedrock    | claude-haiku-4.5        | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Bedrock    | claude-sonnet-4.6       | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-sonnet-4-6', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Bedrock    | claude-opus-4.7         | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-opus-4-7', temperature: 1, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Bedrock    | minimax-m2.5            | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: minimax.minimax-m2.5, strictToolMsg: true, temperature: 0), timeout: 900000)"``` |
| Bedrock    | ministral-3-8b          | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: mistral.ministral-3-8b-instruct, temperature: 0), timeout: 900000)"``` |
| Bedrock    | nova-2-lite             | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.amazon.nova-2-lite-v1:0', temperature: 0), timeout: 900000)"``` |
| Bedrock    | nova-pro-v1             | ```export OAF_MODEL="(type: bedrock, timeout: 900000, options: (model: 'amazon.nova-pro-v1:0', temperature: 0))" ``` |
| Bedrock    | gpt-oss-120b | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'openai.gpt-oss-120b-1:0', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Bedrock    | opus-4.5                | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-opus-4-5-20251101-v1:0', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Cerebras   | gpt-oss-120b            | ```export OAF_MODEL="(type: openai, key: '...', url: 'https://api.cerebras.ai', model: gpt-oss-120b, timeout: 900000, temperature: 0, noSystem: false)``` |
| Cerebras   | zai-glm-4.7             | ```export OAF_MODEL="(type: openai, key: '...', url: 'https://api.cerebras.ai', model: zai-glm-4.7, timeout: 900000, temperature: 0, noSystem: false)``` |
| EuQuai     | euquai-fusion-v1 | ```export OAF_MODEL="(type: openai, key: '...', url: 'https://api.euqai.eu', model: euqai-fusion-v1, timeout: 900000, temperature: 0)"``` |
| Gemini     | gemini-2.5-flash   | ```export OAF_MODEL="(type: gemini, model: gemini-2.5-flash, key: 'your-key', timeout: 900000, temperature: 0)"``` |
| Gemini     | gemini-3-pro            | ```export OAF_MODEL="(type: gemini, key: your-google-ai-key, model: gemini-3-pro-preview, timeout: 900000, temperature: 0)"``` |
| GitHub     | gpt-5-nano              | ```export OAF_MODEL="(type: openai, url: 'https://models.github.ai/inference', model: openai/gpt-5-nano, key: $(gh auth token), timeout: 900000, temperature: 1, apiVersion: '')"``` |
| Grok       | grok-4-1-fast-reasoning | ```export OAF_MODEL="( type: openai, key: 'xai-...', url: 'https://api.x.ai', model: grok-4-1-fast-reasoning, timeout: 900000, temperature: 0, noSystem: false)"``` |
| Grok       | grok-4-1-fast-non-reasoning | ```export OAF_MODEL="( type: openai, key: 'xai-...', url: 'https://api.x.ai', model: grok-4-1-fast-non-reasoning, timeout: 900000, temperature: 0, noSystem: false)"``` | 
| Groq       | gpt-oss-120b     | ```export OAF_MODEL="(type: openai, key: 'your-grok-key', url: 'https://api.groq.com/openai', model: openai/gpt-oss-120b, timeout: 900000, temperature: 0)"``` |
| Groq       | gpt-oss-20b      | ```export OAF_MODEL="(type: openai, key: 'your-grok-key', url: 'https://api.groq.com/openai', model: openai/gpt-oss-20b, timeout: 900000, temperature: 0)"``` |
| Mistral    | magistral-medium-latest | ```export OAF_MODEL="(type: openai, model: 'magistral-medium-latest', url: 'https://api.mistral.ai', key: '...', timeout: 900000, temperature: 0, noSystem: false)"``` |
| Mistral    | magistral-small-latest | ```export OAF_MODEL="(type: openai, model: 'magistral-small-latest', url: 'https://api.mistral.ai', key: '...', timeout: 900000, temperature: 0, noSystem: false)"``` |
| Ollama     | gemma3                  | ```export OAF_MODEL="(type: ollama, model: 'gemma3', url: 'http://localhost:11434', timeout: 900000)"``` |
| Ollama     | devstral-2:123b-cloud   | ```export OAF_MODEL="(type: ollama, model: 'devstral-2:123b-cloud', url: 'http://localhost:11434', timeout: 900000)"``` |
| Ollama     | deepseek-r1:8b          | ```export OAF_MODEL="(type: ollama, model: 'deepseek-r1:8b', url: 'http://localhost:11434', timeout: 900000)"``` |
| Ollama     | qwen3-coder:480b-cloud  | ```export OAF_MODEL="(type: ollama, model: 'qwen3-coder:480b-cloud', url: 'http://localhost:11434', timeout: 900000)"``` |
| Ollama     | ministral-3:14b-cloud   | ```export OAF_MODEL="(type: ollama, model: 'ministral-3:14b-cloud', url: 'http://localhost:11434', timeout: 900000)"``` |
| OpenAI     | gpt-5-mini              | ```export OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'sk-...', timeout: 900000, temperature: 1)"``` |
| OpenAI     | gpt-5.2                 | ```export OAF_MODEL="(type: openai, key: 'sk-...', model: gpt-5.2, timeout: 900000, temperature: 1)"``` |
| Scaleway   | gpt-oss-120b            | ```export OAF_MODEL="(type: openai, url: 'https://api.scaleway.ai', key: '123-abc-xyz', model: gpt-oss-120b)"``` |

**Dual-Model (Cost Optimization):**
```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: '...')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: '...')"
```

---

## Shell & Execution

### Shell Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `useshell` | boolean | `false` | Allow shell command execution |
| `shell` | string | - | Prefix applied to every shell command (e.g., `docker exec container`) |
| `usesandbox` | string | `off` | Built-in shell sandbox preset (`off`, `auto`, `linux`, `macos`, `windows`) |
| `sandboxprofile` | string | - | Optional macOS `sandbox-exec` profile path used with `usesandbox=macos` |
| `sandboxnonetwork` | boolean | `false` | Disable network inside built-in sandbox when supported (Windows is best-effort) |
| `shellprefix` | string | - | Override shell prefix for stored plans |
| `shelltimeout` | number | - | Maximum shell command runtime in milliseconds before timeout |
| `readwrite` | boolean | `false` | Allow read-write operations without confirmation |
| `checkall` | boolean | `false` | Ask for confirmation before executing any shell command |
| `shellbatch` | boolean | `false` | Run in batch mode without prompting for command approval |
| `shellmaxbytes` | number | - | Cap shell output size in chars; oversized output is shown as head/tail with a truncation banner |
| `shellallow` | string | - | Comma-separated list of banned commands to explicitly allow |
| `shellbanextra` | string | - | Additional comma-separated commands to ban |
| `shellallowpipes` | boolean | `false` | Allow pipes, redirection, and shell control operators |

**Examples:**

```bash
# Basic shell access (read-only)
mini-a goal="list log files" useshell=true

# Shell with write permissions
mini-a goal="create backup of configs" useshell=true readwrite=true

# Allow specific banned commands
mini-a goal="download file" useshell=true shellallow=curl,wget

# Run in Docker container
docker run -d --rm --name sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
mini-a goal="analyze files" useshell=true shell="docker exec sandbox"

# Allow pipes and redirection
mini-a goal="find large files" useshell=true shellallowpipes=true

# Cap shell output to avoid context blowups
mini-a goal="inspect large logs safely" useshell=true shellmaxbytes=12000
```

---

## MCP Integration

### MCP Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mcp` | string | - | MCP connection object (single or array) in SLON/JSON format |
| `usetools` | boolean | `false` | Register MCP tools directly on the model instead of in prompt |
| `usetoolslc` | boolean | `false` | Register MCP tools directly only on the low-cost model; the main model stays in prompt/action mode unless `usetools=true` |
| `usejsontool` | boolean | `false` | Register compatibility `json` tool when `usetools=true` |
| `toolfallback` | boolean | `false` | When `usetools=true`, automatically fall back to action-based mode for the current run if the model emits malformed pseudo tool-call JSON instead of real tool calls |
| `mcpdynamic` | boolean | `false` | Analyze goal and only register relevant MCP tools |
| `mcplazy` | boolean | `false` | Defer MCP connection initialization until first use |
| `mcpproxy` | boolean | `false` | Aggregate all MCP connections (including Mini Utils Tool) behind a single `proxy-dispatch` tool to reduce context usage |
| `mcpproxythreshold` | number | `0` | Global byte threshold for proxy auto-spill to temporary files (`0` disables). When the serialized result exceeds this size the result is written to a temp file and a reference is returned instead |
| `mcpproxytoon` | boolean | `false` | Serialize proxy-spilled object/array results as TOON text when `mcpproxythreshold>0` |
| `mcpprogcall` | boolean | `false` | Start a per-session localhost HTTP bridge so scripts can list/search/call MCP tools programmatically (requires `useshell=true` for script execution) |
| `mcpprogcallport` | number | `0` | Port for programmatic tool-calling bridge (`0` auto-selects a free port) |
| `mcpprogcallmaxbytes` | number | `4096` | Max inline JSON size before spilling oversized results to `/result/{id}` |
| `mcpprogcallresultttl` | number | `600` | TTL in seconds for spilled results available via `/result/{id}` |
| `mcpprogcalltools` | string | `""` | Optional comma-separated allowlist of tool names exposed by the bridge |
| `mcpprogcallbatchmax` | number | `10` | Maximum calls accepted by `/call-tools-batch` |
| `toolcachettl` | number | `600000` | Default cache TTL in milliseconds for MCP tool results |
| `useutils` | boolean | `false` | Auto-register Mini Utils Tool utilities as MCP connection. Tool names for `utilsallow`/`utilsdeny`: `init`, `filesystemQuery`, `filesystemModify`, `mathematics`, `timeUtilities`, `textUtilities`, `pathUtilities`, `filesystemBatch`, `validationUtilities`, `systemInfo`, `memoryStore`, `todoList`, `markdownFiles`, plus conditional `skills` (`useskills=true`) and console-only `userInput`, `showMessage` (`mini-a-con`) |
| `utilsallow` | string | - | Comma-separated allowlist of Mini Utils Tool names to expose when `useutils=true` |
| `utilsdeny` | string | - | Comma-separated denylist of Mini Utils Tool names to hide when `useutils=true`; applied after `utilsallow` |
| `utilsroot` | string | - | Root path exposed to Mini Utils Tool file/document helpers (e.g. `markdownFiles`, `filesystemQuery`) |
| `useskills` | boolean | `false` | Expose the `skills` utility tool within Mini Utils MCP (only effective when `useutils=true`) |
| `mini-a-docs` | boolean | `false` | If `true` and `utilsroot` is not set, uses the Mini-A opack path as `utilsroot`; the `markdownFiles` tool description includes the resolved docs root so the LLM can navigate documentation directly |
| `miniadocs` | boolean | `false` | Alias for `mini-a-docs` |
| `nosetmcpwd` | boolean | `false` | Prevent setting `__flags.JSONRPC.cmd.defaultDir` to mini-a oPack location |

**Single MCP:**
```bash
mini-a goal="check weather in Sydney" \
  mcp="(cmd: 'ojob mcps/mcp-weather.yaml', timeout: 5000)"
```

**Multiple MCPs:**
```bash
mini-a goal="compare Docker tags with Wikipedia releases" \
  mcp="[(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000), (cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)]" \
  rpm=20
```

**HTTP Remote MCP:**
```bash
# Start MCP server
ojob mcps/mcp-ssh.yaml onport=8888 ssh=ssh://user@host

# Connect to it
mini-a goal="check server uptime" \
  mcp="(type: remote, url: 'http://localhost:8888/mcp')"
```

**With Dynamic Tool Selection:**
```bash
mini-a goal="query database" \
  mcp="[(cmd: 'ojob mcps/mcp-db.yaml ...'), (cmd: 'ojob mcps/mcp-net.yaml ...')]" \
  usetools=true mcpdynamic=true
```

**Tool Calling Only On The Low-Cost Model:**
```bash
mini-a goal="scan docs, then escalate only if needed" \
  modellc="(type: openai, model: gpt-5-mini, key: '...')" \
  mcp="(cmd: 'ojob mcps/mcp-files.yaml', timeout: 5000)" \
  usetoolslc=true
```
Use this when you want the low-cost model to call MCP tools directly, while escalations to the main model continue using prompt/action-based tool guidance.

**Opt-in Tool Fallback:**
```bash
mini-a goal="what is the current time" \
  usetools=true toolfallback=true
```
Use this when a model/provider sometimes describes tool usage as JSON text instead of emitting real tool calls. Mini-A will retry the current run in action-based mode only when that malformed tool-call pattern is detected.

**Lazy Initialization:**
```bash
mini-a goal="analyze local files" \
  mcp="[(cmd: 'ojob mcps/mcp-db.yaml...'), (cmd: 'ojob mcps/mcp-net.yaml...')]" \
  mcplazy=true usetools=true
```

**Read Mini-A documentation with utils tools:**
```bash
mini-a goal="list markdown docs in the Mini-A package and summarize CHEATSHEET.md" \
  useutils=true mini-a-docs=true
```

**Limit bundled utils exposure:**
```bash
mini-a goal="inspect docs only" \
  useutils=true utilsallow=filesystemQuery,markdownFiles utilsdeny=filesystemModify
```

**Enable real-time progress messages in console sessions:**
```bash
# Agent can call showMessage to display progress updates as it works
mini-a goal="analyze and report on the project" useutils=true
# Restrict to only progress messages and file reads:
mini-a goal="analyze project" useutils=true utilsallow=filesystemQuery,showMessage
```

**Proxy Aggregation (single tool exposed):**
```bash
mini-a goal="compare S3 usage with database stats" \
  mcp="[(cmd: 'ojob mcps/mcp-s3.yaml bucket=my-bucket'), (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data')]" \
  usetools=true mcpproxy=true useutils=true
```
See [docs/MCPPROXY-FEATURE.md](docs/MCPPROXY-FEATURE.md) for full workflows and the `proxy-dispatch` action set.

**Programmatic Tool Calling Bridge (script-driven MCP calls):**
```bash
mini-a goal="run MCP tool calls from a script and summarize output" \
  useshell=true usetools=true mcpprogcall=true \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml'), (cmd: 'ojob mcps/mcp-weather.yaml')]"

# Inside generated shell scripts use:
# MINI_A_PTC_PORT, MINI_A_PTC_TOKEN, MINI_A_PTC_DIR
```

### Built-in MCPs

| MCP | Purpose | Example |
|-----|---------|---------|
| `mcp-db` | Database access | `mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa')"` |
| `mcp-time` | Time/timezone utilities | `mcp="(cmd: 'ojob mcps/mcp-time.yaml')"` |
| `mcp-net` | Network utilities | `mcp="(cmd: 'ojob mcps/mcp-net.yaml')"` |
| `mcp-telco` | Telecommunications utilities | `mcp="(cmd: 'ojob mcps/mcp-telco.yaml')"` |
| `mcp-ssh` | SSH execution | `mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22')"` |
| `mcp-s3` | S3 operations | `mcp="(cmd: 'ojob mcps/mcp-s3.yaml bucket=my-bucket prefix=files/')"` |
| `mcp-rss` | RSS feeds | `mcp="(cmd: 'ojob mcps/mcp-rss.yaml')"` |
| `mcp-fin` | Market data | `mcp="(cmd: 'ojob mcps/mcp-fin.yaml')"` |
| `mcp-email` | Email sending (text, HTML, or Markdown via `markdown=true markdowntheme=default`) | `mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=bot@example.com')"` |
| `mcp-shell` | Local shell | `mcp="(cmd: 'ojob mcps/mcp-shell.yaml shellallow=df,du')"` |
| `mcp-file` | File operations | `mcp="(cmd: 'ojob mcps/mcp-file.yaml root=./data readwrite=true')"` |
| `mcp-web` | Web search/fetch | `mcp="(cmd: 'ojob mcps/mcp-web.yaml')"` |
| `mcp-weather` | Weather info | `mcp="(cmd: 'ojob mcps/mcp-weather.yaml')"` |
| `mcp-kube` | Kubernetes (pods, deployments, HPAs, generic objects, and more) | `mcp="(cmd: 'ojob mcps/mcp-kube.yaml')"` |
| `mcp-random` | Random data | `mcp="(cmd: 'ojob mcps/mcp-random.yaml')"` |
| `mcp-math` | Math operations | `mcp="(cmd: 'ojob mcps/mcp-math.yaml')"` |
| `mcp-mini-a` | Run Mini-A | `mcp="(cmd: 'ojob mcps/mcp-mini-a.yaml')"` |

---

## Planning Features

### Planning Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `useplanning` | boolean | `false` | Enable task planning workflow (agent mode only) |
| `planmode` | boolean | `false` | Run in plan-only mode (generate plan without executing) |
| `validateplan` | boolean | `false` | Validate plan using LLM critique without executing |
| `resumefailed` | boolean | `false` | Resume from last failed task on startup |
| `convertplan` | boolean | `false` | Convert plan format and exit |
| `forceplanning` | boolean | `false` | Force planning even when heuristics would skip it |
| `planstyle` | string | `simple` | Plan style: `simple` (flat sequential) or `legacy` (phase-based) |
| `planfile` | string | - | Path to load or save plan file (`.md`, `.json`, `.yaml`) |
| `planformat` | string | - | Plan format override (`markdown`, `json`, `yaml`) |
| `plancontent` | string | - | Inline plan definition (Markdown or JSON content) |
| `updatefreq` | string | `auto` | Plan update frequency (`auto`, `always`, `checkpoints`, `never`) |
| `updateinterval` | number | `3` | Steps between automatic plan updates when `updatefreq=auto` |
| `forceupdates` | boolean | `false` | Force plan updates even when actions fail |
| `planlog` | string | - | Optional file path to append plan update logs |
| `saveplannotes` | boolean | `false` | Persist execution notes within plan file structure |

**Examples:**

```bash
# Generate plan only (no execution)
mini-a goal="audit repository and prepare upgrade notes" \
  planmode=true useshell=true planfile=plan.md

# Execute with planning
mini-a goal="refactor project scaffold" \
  useplanning=true useshell=true planfile=plan.md

# Validate existing plan
mini-a goal="deploy application" \
  planfile=plan.md validateplan=true useshell=true

# Generate and validate plan
mini-a goal="complex migration task" \
  planmode=true validateplan=true useshell=true planfile=plan.md

# Resume failed execution
mini-a goal="complete deployment" \
  planfile=plan.md resumefailed=true useshell=true

# Convert plan format
mini-a planfile=plan.md outputfile=plan.json convertplan=true planformat=json

# Force planning for simple goal
mini-a goal="simple task" forceplanning=true planfile=plan.md

# Use legacy phase-based planning style
mini-a goal="complex multi-phase project" \
  useplanning=true planstyle=legacy useshell=true planfile=plan.md
```

---

## Deep Research Mode

Set `OAF_VAL_MODEL` or `modelval=...` to use a dedicated validation model; otherwise the main model is used.

### Deep Research Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `deepresearch` | boolean | `false` | Enable iterative research with validation cycles |
| `maxcycles` | number | `3` | Maximum number of research cycles to attempt |
| `validationgoal` | string | - | Quality criteria for validating research outcomes (string or file path; implies `deepresearch=true`, defaults `maxcycles=3`) |
| `valgoal` | string | - | Alias for `validationgoal` |
| `validationthreshold` | string | `PASS` | Validation threshold (`PASS` or score-based like `score>=0.7`) |
| `persistlearnings` | boolean | `true` | Carry forward learnings between cycles |

`validationgoal` (or `valgoal`) accepts inline text or a single-line file path; when a file path is provided, Mini-A loads the file contents.

**Examples:**

```bash
# Basic deep research with quality validation
mini-a goal="Research quantum computing applications in drug discovery" \
  deepresearch=true \
  maxcycles=5 \
  validationgoal="Validate: covers at least 3 specific applications with real-world examples and citations"

# Academic research with score threshold
mini-a goal="Survey recent advances in transformer architectures for NLP" \
  deepresearch=true \
  maxcycles=4 \
  validationgoal="Rate 1-10: coverage of papers (2023-2024), technical depth, citation quality" \
  validationthreshold="score>=0.8"

# Market analysis with comprehensive criteria
mini-a goal="Competitive analysis of project management SaaS tools" \
  deepresearch=true \
  maxcycles=3 \
  validationgoal="Validate: covers top 5 tools, includes pricing, features comparison, customer reviews" \
  useplanning=true

# Alias usage
mini-a goal="Research database indexing strategies" \
  deepresearch=true \
  maxcycles=3 \
  valgoal="Validate: compares B-tree vs LSM, includes benchmarks, recommends scenarios"

# Technical documentation with specific requirements
mini-a goal="Document migration strategy from Python 2 to Python 3" \
  deepresearch=true \
  maxcycles=5 \
  validationgoal="Ensure: step-by-step process, common pitfalls, testing strategy, rollback plan" \
  useshell=true

# With MCP tools for comprehensive data gathering
mini-a goal="Comprehensive analysis of renewable energy trends 2024" \
  deepresearch=true \
  maxcycles=3 \
  validationgoal="Validate: includes statistical data, covers solar/wind/hydro, has trend projections" \
  mcp="(cmd: 'docker run --rm -i mcp/wikipedia-mcp')"
```

---

## Visual & Output

### Visual Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usediagrams` | boolean | `false` | Encourage Mermaid diagrams in output |
| `usemermaid` | boolean | `false` | Alias for `usediagrams` |
| `usecharts` | boolean | `false` | Encourage Chart.js charts in output; when combined with `usesvg`/`usevectors`, prefer chart configs for supported charts and reserve SVG for unsupported chart forms or custom illustrations |
| `useascii` | boolean | `false` | Encourage enhanced UTF-8/ANSI visual output with colors and emojis |
| `usemaps` | boolean | `false` | Encourage Leaflet JSON blocks for interactive maps (renders in console transcript and web UI) |
| `usesvg` | boolean | `false` | Encourage raw SVG blocks rendered securely as image data URIs in the web UI |
| `usevectors` | boolean | `false` | Enable vector guidance bundle (`usesvg=true` + `usediagrams=true`), preferring Mermaid for structural diagrams and SVG for infographics/custom visuals |
| `format` | string | `md` | Output format (`md`, `json`, `yaml`, `toon` or `slon`) |
| `usemath` | boolean | `false` | Encourage LaTeX math output (`$...$` / `$$...$$`) for KaTeX rendering |
| `usestream` | boolean | `false` | Stream LLM tokens to the console in real-time as they arrive |
| `showexecs` | boolean | `false` | Show shell/exec events as separate lines in the interaction stream |
| `showseparator` | boolean | `true` | Show a subtle separator line between interaction events (disable for a more compact view) |
| `outputfile` | string | - | Alternative key for `outfile`, used mainly during plan conversions |

**Examples:**

```bash
# Generate with Mermaid diagrams
mini-a goal="document workflow" usediagrams=true

# Generate with Chart.js visualizations
mini-a goal="analyze sales data" usecharts=true useshell=true

# Enhanced terminal output with colors and emojis
mini-a goal="system status report" useascii=true useshell=true

# JSON output
mini-a goal="extract data" format=json useshell=true

# Combine visual features
mini-a goal="create comprehensive report" \
  usediagrams=true usecharts=true useascii=true

# Interactive map guidance
mini-a goal="show meetup locations on a map" \
  usemaps=true usecharts=true
```

---

## Knowledge & Context

### Knowledge Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `knowledge` | string | - | Additional context or knowledge (text or file path) |
| `youare` | string | - | Override opening "You are..." persona sentence (text or `@file` path) |
| `chatyouare` | string | - | Override chatbot persona sentence when `chatbotmode=true` (text or `@file` path) |
| `rules` | string | - | Custom rules array in JSON/SLON format (text or file path) |
| `state` | string/object | - | Initial state data as structured JSON/SLON |
| `conversation` | string | - | Conversation history file to load/save |
| `maxcontext` | number | `0` | Maximum context size in tokens (auto-summarize when exceeded) |
| `compressgoal` | boolean | `false` | Automatically compress oversized goal text before execution |
| `compressgoaltokens` | number | `250` | Estimated token threshold before goal compression is considered |
| `compressgoalchars` | number | `1000` | Character threshold before goal compression is considered |
| `maxcontent` | number | `0` | Alias for `maxcontext` |
| `libs` | string | - | Comma-separated list of additional OJob libraries to load |
| `goalprefix` | string | - | Optional prefix automatically prepended to every goal before the agent sees it |
| `secpass` | string | - | Password for opening OpenAF sBucket model secrets |

**Examples:**

```bash
# Add knowledge context
mini-a goal="review SQL queries" \
  knowledge="Database is PostgreSQL 15, use modern syntax"

# Load knowledge from file
mini-a goal="implement feature" \
  knowledge=@requirements.txt

# Load knowledge using command substitution
mini-a goal="implement feature following project guidelines" \
  knowledge="$(cat KNOWLEDGE.md)"

# Load rules from file using command substitution
mini-a goal="review code" \
  rules="$(cat RULES.md)"

# Load both knowledge and rules from files
mini-a goal="refactor project following standards" \
  knowledge="$(cat project-context.md)" \
  rules="$(cat coding-standards.md)" \
  useshell=true

# Custom persona
mini-a goal="analyze firmware" \
  youare="You are a senior firmware analyst focused on reverse engineering embedded devices."

# Custom chatbot persona
mini-a goal="help plan vacation" \
  chatbotmode=true \
  chatyouare="You are an enthusiastic travel concierge specialized in eco-friendly trips."

# Custom rules (inline)
mini-a goal="query database" \
  rules='["Never run destructive DDL statements", "Use markdown tables for summaries"]'

# With initial state
mini-a goal="track remediation tasks" \
  state='{"backlog": [], "completed": []}' \
  useshell=true

# Load conversation history
mini-a goal="continue previous discussion" \
  conversation=chat-history.json

# Resume directly from latest saved conversation turn (mini-a-con)
mini-a conversation=chat-history.json resume=true

# Context management
mini-a goal="analyze large codebase" \
  maxcontext=8000 maxsteps=50 useshell=true

# Load additional libraries
mini-a goal="process AWS data" \
  libs="@AWS/aws.js,custom.js"
```

---

## Working Memory

Mini-A maintains a structured **working memory** during each run — a scoped, deduplicated store that the agent appends facts, evidence, decisions, risks, open questions, hypotheses, artifacts, and summaries to automatically as it executes.  Memory is organized into two independent managers: a **session** store (scoped to the current conversation/session ID) and a **global** store (shared across sessions). Both can optionally persist to an OpenAF channel between runs.

### Working Memory Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usememory` | boolean | `false` | Enable the working memory subsystem. Set `false` to disable all memory tracking. |
| `memoryscope` | string | `both` | Which store the agent reads from and defaults writes to: `session`, `global`, or `both` (reads both; writes default to session when no channel, or global when `memorych` is set). |
| `memorych` | string | - | SLON/JSON definition of an OpenAF channel used to **persist the global memory** store. Reloaded at startup and flushed on every significant event. |
| `memorysessionch` | string | - | SLON/JSON definition of a dedicated OpenAF channel for the **session memory** store. Falls back to `memorych` when omitted. |
| `memoryuser` | boolean | `false` | Convenience shorthand: enables `usememory`, ensures `~/.openaf-mini-a/` exists, sets `memorych` + `memorysessionch` to file channels, and defaults `memorypromote=facts,decisions,summaries` + `memorystaledays=30`. |
| `memoryusersession` | boolean | `false` | Convenience shorthand: enables `usememory`, ensures `~/.openaf-mini-a/` exists, defaults `memoryscope=session`, and sets `memorysessionch` to a file channel. |
| `memorysessionid` | string | `<agent-id>` | Session key used to namespace session memory in the channel (defaults to `conversation` arg if set, otherwise the internal agent ID). |
| `memorymaxpersection` | number | `80` | Maximum entries kept per section before compaction drops stale/old ones. |
| `memorymaxentries` | number | `500` | Hard cap on total entries across all sections (priority-ordered: decisions > evidence > risks > facts > summaries > hypotheses > openQuestions > artifacts). |
| `memorycompactevery` | number | `8` | How many `append` calls trigger an automatic compaction pass. |
| `memorydedup` | boolean | `true` | Suppress near-duplicate entries (85% word-overlap fingerprint). |
| `memorypromote` | string | `""` | Comma-separated list of sections to auto-promote from session → global at session end. `memoryuser=true` sets this to `facts,decisions,summaries`. Empty string disables auto-promotion. |
| `memorystaledays` | number | `0` | Days without re-confirmation before a global entry is marked `stale`. `0` disables the sweep. `memoryuser=true` sets this to `30`. Stale entries are removed by compaction when a section overflows `memorymaxpersection`. |
| `memoryinject` | string | `summary` | Controls how much memory is embedded in each step's context: `summary` (default) injects only section entry counts and enables the `memory_search` action; `full` injects the entire compact memory snapshot (old behaviour). |
| `memorysessionheader` | string | - | HTTP request header name used to derive the memory session ID in web mode (e.g. `X-User-Id`) |

### Memory Sections

| Section | What the agent stores |
|---------|-----------------------|
| `facts` | Stable, confirmed pieces of information |
| `evidence` | Tool outputs and observations |
| `decisions` | Choices made (plan verdict, final answer, etc.) |
| `risks` | Tool failures, subtask errors, validation issues |
| `openQuestions` | Unresolved questions or pending follow-ups |
| `hypotheses` | Candidate explanations or approaches under consideration |
| `artifacts` | Short excerpts of generated content (first 500 chars) |
| `summaries` | Narrative overviews of completed phases |

### Context Injection Modes (`memoryinject`)

By default (`memoryinject=summary`), the step context contains only a compact section-count map — e.g. `workingMemory:{facts:12,decisions:3}` — instead of all entry content. This reduces per-step memory overhead by ~95%. The agent can retrieve entries on demand using the `memory_search` action:

```json
{
  "thought": "I need to recall what decisions were made",
  "action": "memory_search",
  "params": { "query": "authentication decision", "section": "decisions", "limit": 5 }
}
```

`memory_search` params:
- `query` (required) — keyword string to match against entry values
- `section` (optional) — restrict to one section (`facts`, `decisions`, `evidence`, `openQuestions`, `hypotheses`, `artifacts`, `risks`, `summaries`)
- `limit` (optional, default `10`) — max results per section

Use `memoryinject=full` to restore the previous behaviour (all entries in every step context).

### Examples

```bash
# Default: working memory off
mini-a goal="analyze repo and suggest improvements" useshell=true

# Disable working memory entirely
mini-a goal="quick lookup" usememory=false

# Enable memory with default summary injection (memory_search action available)
mini-a goal="iterative research task" usememory=true

# Restore legacy full-inject mode (all memory entries in every step)
mini-a goal="iterative research task" usememory=true memoryinject=full

# Persist global memory to a file channel across runs
mini-a goal="iterative research task" \
  memorych="(name: mini_a_global_mem, type: file, options: (file: '/tmp/mini-a-memory.json'))"

# Separate channels for session vs global memory
mini-a goal="long research" \
  memorych="(name: global_mem, type: file, options: (file: '/tmp/mini-a-global.json'))" \
  memorysessionch="(name: session_mem, type: file, options: (file: '/tmp/mini-a-session.json'))" \
  memorysessionid="research-2024"

# Session-only scope (no global writes)
mini-a goal="short task" memoryscope=session

# Tune compaction limits for large tasks
mini-a goal="analyze all source files" useshell=true \
  memorymaxpersection=200 memorymaxentries=1000 memorycompactevery=20

# Reuse persisted global memory from a previous run (automatic on restart)
mini-a goal="continue from where we left off" \
  memorych="(name: mini_a_global_mem, type: file, options: (file: '/tmp/mini-a-memory.json'))"

# User-local persistent memory shorthand (home-dir file channels, auto-creates directory)
# Also enables auto-promotion (facts,decisions,summaries) and 30-day staleness sweep
mini-a goal="iterative research task" memoryuser=true

# Custom promotion sections and staleness window
mini-a goal="long research" memoryuser=true memorypromote=facts,decisions memorystaledays=14

# Disable auto-promotion but keep staleness sweep
mini-a goal="..." memoryuser=true memorypromote=""

# Disable staleness sweep entirely
mini-a goal="..." memoryuser=true memorystaledays=0
```

### Memory Manager TUI Cheatsheet (`memoryman=true`)

```bash
# Open memory manager with default user-local channels
mini-a memoryman=true usememory=true memoryuser=true

# Open memory manager against explicit channels + session namespace
mini-a memoryman=true usememory=true \
  memorych="(name: global_mem, type: file, options: (file: '/tmp/mini-a-global.json'))" \
  memorysessionch="(name: session_mem, type: file, options: (file: '/tmp/mini-a-session.json'))" \
  memorysessionid="demo-session"
```

Common actions inside the TUI:
- `📊 Summary` — totals, stale/unresolved counts, per-section table.
- `📃 List entries` — filter by section and stale/unresolved flags.
- `🔎 Inspect entry` — print full payload for a selected `section/id`.
- `🧽 Delete by id` — selective removal of one entry.
- `⏳ Delete older than...` — prune by relative age (`30d`, `12h`, `90m`) or absolute timestamp (ISO/epoch).
- `🔍 Search entries` — keyword search across ids/values/tags.
- `🧰 Maintenance` — run compaction, stale sweep, or full store clear.
- `💾 Export snapshot` — print JSON snapshot for backup/audit.

### Programmatic API (embedding use)

```javascript
var agent = new MiniA()
agent.start({ goal: "...", usememory: true })

// Promote specific session entries to the global store (manual, selective)
agent.promoteSessionMemory("decisions", ["entry-id-1"])

// Auto-promote configured sections (refresh-or-append) + run staleness sweep
// Called automatically at session end when memorypromote is set
agent._autoPromoteSessionToGlobal()

// Find a near-duplicate entry in a section (returns entry or undefined)
var match = agent._globalMemoryManager.findNearDuplicate("facts", "some fact text")

// Refresh an entry's confirmedAt + confirmCount (clears stale flag)
agent._globalMemoryManager.refresh("facts", match.id)

// Mark global entries older than N days as stale (returns count marked)
var marked = agent._globalMemoryManager.sweepStale(30)

// Clear the session memory for a given session
agent.clearSessionMemory("my-session-id")
```

---

## Wiki Knowledge Base

Mini-A can read from and write to a persistent Markdown wiki following Andrej Karpathy's LLM Wiki pattern: the agent distils knowledge from each session into structured pages, then retrieves that knowledge in future sessions.  The wiki is stored in a shared filesystem folder or S3 prefix — any agent with the same `wikiroot` (or `wikibucket`) sees the same pages.

When a brand-new wiki is opened with `wikiaccess=rw`, Mini-A bootstraps two starter pages:
- `AGENTS.md` for contribution rules and ingestion workflow
- `index.md` for the main entrypoint and top-level table of contents

### Wiki Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usewiki` | boolean | `false` | Enable the wiki knowledge base |
| `wikiaccess` | string | `ro` | Access mode: `ro` (read-only) or `rw` (read-write) |
| `wikibackend` | string | `fs` | Backend: `fs` (filesystem) or `s3` |
| `wikiroot` | string | `.` | Root directory for the `fs` backend |
| `wikibucket` | string | - | S3 bucket name (`s3` backend) |
| `wikiprefix` | string | - | S3 key prefix (`s3` backend) |
| `wikiurl` | string | - | S3-compatible endpoint URL (`s3` backend) |
| `wikiaccesskey` | string | - | S3 access key (`s3` backend) |
| `wikisecret` | string | - | S3 secret key (`s3` backend) |
| `wikiregion` | string | - | S3 region (`s3` backend) |
| `wikiuseversion1` | boolean | `false` | Use S3 path-style (v1) signing (`s3` backend) |
| `wikiignorecertcheck` | boolean | `false` | Skip TLS certificate validation (`s3` backend) |
| `wikilintstaleddays` | number | `90` | Days before a page without an `updated` update is marked stale in lint |

### Wiki Actions (agent)

The agent uses the `wiki` action:
```json
{ "action": "wiki", "params": { "op": "list|read|search|lint|write", "path": "page.md", "query": "...", "content": "..." } }
```

| Op | Description |
|----|-------------|
| `list` | List all pages; optional `path` prefix filters results |
| `read` | Return full content + front-matter of `path` |
| `search` | Full-text search; returns ranked hits for `query` |
| `lint` | Validate wiki health: broken links, orphans, stale pages, near-duplicates |
| `write` | Write or update `path` with `content` (requires `wikiaccess=rw`) |

### Console Commands

| Command | Description |
|---------|-------------|
| `/wiki list [prefix]` | List all pages (optionally filtered by prefix) |
| `/wiki read <page.md>` | Print a page's front-matter and body |
| `/wiki search <query>` | Full-text search across all pages |
| `/wiki lint` | Run the lint check and print a report |
| `/stats wiki` | Show wiki operation statistics for the current session |

### Examples

```bash
# Read-only wiki from a shared folder (agents can read, not write)
mini-a goal="summarize our architecture decisions" \
  usewiki=true wikiroot=/shared/wiki

# Read-write wiki — agent can contribute new pages
mini-a goal="research topic X and document findings in the wiki" \
  usewiki=true wikiaccess=rw wikiroot=/shared/wiki

# S3-backed wiki (shared across machines or containers)
mini-a goal="analyze and wiki" \
  usewiki=true wikiaccess=rw wikibackend=s3 \
  wikibucket=my-wiki-bucket wikiprefix=knowledge/ \
  wikiurl=https://s3.amazonaws.com wikiaccesskey=AKI... wikisecret=xxx wikiregion=us-east-1

# Wiki + memory for maximum knowledge retention
mini-a goal="deep research with persistent knowledge" \
  usewiki=true wikiaccess=rw wikiroot=/shared/wiki \
  usememory=true memoryuser=true

# Lint the wiki from the console
mini-a ➤ /wiki lint
```

---

## Choosing Knowledge Features

Mini-A has two complementary knowledge persistence mechanisms.  Choose based on the scope, structure, and lifetime of the knowledge.

| Dimension | `usememory=true` | `usewiki=true` |
|-----------|-----------------|----------------|
| **Scope** | Single agent session (session store) or personal across sessions (global store) | Shared across all agents and users pointing to the same root/bucket |
| **Structure** | Typed sections: facts, decisions, evidence, risks, hypotheses, artifacts, summaries | Free-form Markdown pages with YAML front-matter |
| **Granularity** | Short entries (one fact / decision per entry) | Full articles (one concept per page) |
| **Retrieval** | Keyword search via `memory_search` action | Full-text search + list + direct read via `wiki` action |
| **Lifetime** | Session ends when conversation ends; global persists via channel | Persists as files/objects; survives agent restarts and machine changes |
| **Authorship** | Fully automated (agent appends automatically) | Semi-automated (agent writes on demand; you control when) |
| **Lint / QA** | Compaction + dedup | `/wiki lint` validates links, orphans, staleness, near-duplicates |
| **Best for** | Tracking in-flight reasoning, decisions, and evidence during a task | Encyclopaedic knowledge that should outlive sessions and be shared |

### Decision Guide

**Use `usememory=true` when:**
- The agent needs to track its own reasoning across many steps (hypotheses, evidence, risks).
- You want automatic deduplication and compaction without managing files.
- Knowledge is personal to one agent instance or one session.
- You need the agent to recall decisions made earlier in the same run.

**Use `usewiki=true` when:**
- Knowledge must survive across agent restarts and be accessible to other agents or users.
- You are building a shared team knowledge base (architecture decisions, runbooks, API docs).
- Content is encyclopaedic — one well-named page per concept, with links between pages.
- You want human-readable, versionable Markdown files.

**Use both together when:**
- The agent researches and reasons (memory tracks in-flight state), then distils durable findings into wiki pages at the end.
- Multiple agents collaborate: each tracks its own working state in memory, but contributes shared conclusions to the wiki.

```bash
# Recommended combined setup for knowledge-building agents
mini-a goal="research and document X" \
  usememory=true memoryuser=true \
  usewiki=true wikiaccess=rw wikiroot=/shared/wiki
```

---

## Mode Presets

Quick configuration bundles for common use cases.

Modes can inherit from other modes using `include` (string, comma-separated string, or array). Included mode params are merged first, then local params override them.

| Mode | Description | Equivalent Parameters |
|------|-------------|----------------------|
| `shell` | Read-only shell access | `useshell=true` |
| `shellrw` | Shell with write access | `useshell=true readwrite=true` |
| `shellutils` | Shell + Mini Utils Tool | `useshell=true useutils=true mini-a-docs=true usetools=true` |
| `chatbot` | Conversational mode | `chatbotmode=true` |
| `internet` | Internet-focused MCP mode | `usetools=true mini-a-docs=true mcp=...` |
| `web` | Browser UI optimized | `usetools=true mini-a-docs=true` |
| `webfull` | Full-featured web UI | `usetools=true useutils=true usestream=true mcpproxy=true mini-a-docs=true usediagrams=true usecharts=true useascii=true usehistory=true useattach=true historykeep=true useplanning=true` |

**Examples:**

```bash
# Use shell mode preset
mini-a mode=shell goal="list files"

# Use chatbot mode
mini-a mode=chatbot goal="help me plan a trip"

# Use web mode
./mini-a-web.sh mode=web onport=8888

# Custom preset (in ~/.openaf-mini-a/modes.yaml)
modes:
  mybase:
    params:
      useshell: true
      maxsteps: 30
  mypreset:
    include: mybase
    params:
      readwrite: true
      knowledge: "Always use concise responses"

# Use custom preset
mini-a mode=mypreset goal="your goal here"
```

---

## Delegation

### Delegation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usedelegation` | boolean | `false` | Enable subtask delegation (requires `usetools=true`) |
| `workers` | string | - | Comma-separated list of worker URLs for remote delegation (e.g., `workers="http://host:8080"`) |
| `workerreg` | number | - | Port for worker registration HTTP server |
| `workerregtoken` | string | - | Bearer token for registration endpoints |
| `workerevictionttl` | number | `60000` | TTL (ms) before evicting unresponsive dynamic workers |
| `workerregurl` | string | - | Registration URL(s) for worker self-registration (comma-separated) |
| `workerreginterval` | number | `30000` | Heartbeat interval (ms) for re-registration |
| `maxconcurrent` | number | `4` | Maximum concurrent child agents |
| `delegationmaxdepth` | number | `3` | Maximum delegation nesting depth |
| `delegationtimeout` | number | `300000` | Default subtask deadline (ms) |
| `delegationmaxretries` | number | `2` | Default retry count for failed subtasks |
| `showdelegate` | boolean | `false` | Show delegate events as separate console lines |
| `workermode` | boolean | `false` | Launch the Worker API server instead of the console |
| `shellworker` | boolean | `false` | Convenience flag: sets `useshell=true` and advertises the `shell` A2A skill automatically |
| `workerskills` | string | - | Comma-separated skill IDs (or JSON array) advertised by this worker in its AgentCard |
| `workerspecialties` | string | - | Comma-separated specialty tags injected into the `run-goal` A2A skill |
| `workertags` | string | - | Comma-separated tags appended to the default workermode skill in the AgentCard |
| `usea2a` | boolean | `false` | Use A2A HTTP+JSON/REST endpoints for remote worker delegation instead of the default Mini-A protocol |
| `apitoken` | string | - | Bearer token required to authenticate requests to the worker API server (set on both worker and main) |
| `extracommands` | string | | Comma-separated extra directories for custom slash commands |
| `extraskills` | string | | Comma-separated extra directories for custom skills |
| `extrahooks` | string | | Comma-separated extra directories for custom hooks |

**Examples:**

```bash
# Local delegation (child agents in same process)
mini-a usedelegation=true usetools=true goal="Coordinate multiple research tasks"

# Remote delegation with worker URLs
mini-a usedelegation=true usetools=true \
  workers="http://worker1:8080,http://worker2:8080" \
  apitoken=secret goal="Distribute analysis across workers"

# Start a worker API server
mini-a workermode=true onport=8080 apitoken=secret maxconcurrent=8

# Start main with registration server
mini-a usedelegation=true usetools=true workerreg=12345 workerregtoken=secret

# Start worker that self-registers
mini-a workermode=true onport=8080 apitoken=secret \
  workerregurl="http://main-host:12345" workerregtoken=secret

# Shell-capable worker (auto-advertises "shell" A2A skill)
mini-a workermode=true onport=8081 apitoken=secret shellworker=true

# Route subtask only to shell-capable workers (LLM uses skills: ["shell"])
# When the delegate-subtask tool call includes useshell=true, the routing
# enforces that the selected worker must have declared shell capability.
mini-a usedelegation=true usetools=true \
  workers="http://worker1:8080,http://worker2:8081" \
  apitoken=secret goal="Run shell commands and analyze output"
```

### Console Commands

| Command | Description |
|---------|-------------|
| `/delegate <goal>` | Manually delegate a sub-goal to a child agent |
| `/subtasks` | List all subtasks with status |
| `/subtask <id>` | Show subtask details |
| `/subtask result <id>` | Show subtask result |
| `/subtask cancel <id>` | Cancel a running subtask |

### Worker API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/info` | GET | No | Server capabilities and limits |
| `/task` | POST | Yes | Submit a new task |
| `/status` | POST | Yes | Poll task status |
| `/result` | POST | Yes | Get final result |
| `/cancel` | POST | Yes | Cancel running task |
| `/worker-register` | POST | Yes | Register a worker dynamically (on registration port) |
| `/worker-deregister` | POST | Yes | Deregister a worker (on registration port) |
| `/worker-list` | GET | Yes | List all workers with status (on registration port) |
| `/healthz` | GET | No | Health check |
| `/metrics` | GET | No | Task/delegation metrics |

See **[Delegation Guide](docs/DELEGATION.md)** for full documentation.

---

## Advanced Features

### Chatbot Mode

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `chatbotmode` | boolean | `false` | Run as conversational chatbot instead of goal-oriented agent |

```bash
mini-a chatbotmode=true goal="draft a friendly release note"
```

### Audit Logging

| Parameter | Description |
|-----------|-------------|
| `auditch` | SLON/JSON definition of audit channel to record agent activity |
| `toollog` | SLON/JSON definition of tool-log channel to record MCP tool call arguments/results |
| `metricsch` | SLON/JSON definition of a metrics channel to collect per-run performance counters |
| `showthinking` | Surface XML-tagged `<thinking>...</thinking>` blocks as thought logs |

```bash
mini-a goal="perform audit" \
  auditch="(type: file, options: (file: '/tmp/mini-a-audit.log'))"
```

### MCP Working Directory

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `nosetmcpwd` | boolean | `false` | Prevent setting `__flags.JSONRPC.cmd.defaultDir` to mini-a oPack location |

```bash
# Use system default working directory for MCP commands
mini-a goal="run command" nosetmcpwd=true
```

### Browser Context

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `browsercontext` | string/boolean | - | Browser context configuration (SLON/JSON) or `true` to auto-enable when needed. Used by MCP tools that control a browser session |

### Web UI Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `onport` | number | - | Start the Mini-A web UI on the provided port |
| `maxpromptchars` | number | `120000` | Maximum accepted prompt size in characters for web mode |
| `ssequeuetimeout` | number | `120` | Web SSE queue timeout in seconds |
| `logpromptheaders` | string | - | Comma-separated HTTP request header names to log alongside incoming web prompts |
| `usehistory` | boolean | `false` | Enable conversation history persistence in web mode |
| `historykeep` | boolean | `false` | Keep (persist) finished conversations instead of discarding them |
| `historypath` | string | - | Directory path used to store web conversation history files |
| `historyretention` | number | `600` | Web history retention window in seconds |
| `historykeepperiod` | number | - | Delete kept conversation files older than this many minutes |
| `historykeepcount` | number | - | Keep only the newest N kept conversation files |
| `historys3bucket` | string | - | S3 bucket used to mirror history files |
| `historys3prefix` | string | - | S3 key prefix for mirrored history files |
| `historys3url` | string | - | S3 endpoint URL for history mirroring |
| `historys3accesskey` | string | - | S3 access key for history mirroring |
| `historys3secret` | string | - | S3 secret key for history mirroring |
| `historys3region` | string | - | S3 region for history mirroring |
| `historys3useversion1` | boolean | `false` | Use S3 path-style (v1) signing for history mirroring |
| `historys3ignorecertcheck` | boolean | `false` | Disable TLS certificate checks for history S3 access |
| `useattach` | boolean | `false` | Enable file attachment support in web mode |

```bash
# Web UI with history and file attachment support
./mini-a-web.sh onport=8888 usehistory=true historykeep=true useattach=true

# Limit prompt size and log User header
./mini-a-web.sh onport=8888 maxpromptchars=40000 logpromptheaders=X-User-Id

# Persist history to S3
./mini-a-web.sh onport=8888 usehistory=true historykeep=true \
  historys3bucket=my-hist-bucket historys3prefix=mini-a/ \
  historys3url=https://s3.amazonaws.com historys3region=us-east-1
```

### Adaptive Tool Routing

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `adaptiverouting` | boolean | `false` | Enable rule-based route selection (`mini-a-router.js`) — chooses between direct/proxy/shell/utility/delegation based on intent, payload size, latency, and route history |
| `routerorder` | string | - | Comma-separated preferred route order (e.g. `mcp_direct_call,mcp_proxy_path,shell_execution`) |
| `routerallow` | string | - | Comma-separated allowlist of route types the router may use |
| `routerdeny` | string | - | Comma-separated denylist of route types the router must not use |
| `routerproxythreshold` | number | - | Payload size in bytes where proxy-style handling is preferred (falls back to `mcpproxythreshold` when unset) |

Supported route types: `direct_local_tool`, `mcp_direct_call`, `mcp_proxy_path`, `shell_execution`, `utility_wrapper`, `delegated_subtask`.

Route decisions are logged as `[ROUTE ...]` records in context when `debug=true`.

```bash
# Enable adaptive routing
mini-a goal="query remote API" adaptiverouting=true mcp="..." usetools=true

# Prefer direct MCP calls, fall back to proxy
mini-a goal="fetch data" adaptiverouting=true routerorder="mcp_direct_call,mcp_proxy_path"

# Allow only safe non-shell routes
mini-a goal="read data" adaptiverouting=true routerdeny="shell_execution"

# Debug route decisions
mini-a goal="investigate" adaptiverouting=true debug=true
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OAF_MODEL` | Primary LLM model configuration |
| `OAF_LC_MODEL` | Low-cost model for dual-model optimization |
| `OAF_VAL_MODEL` | Dedicated validation model for deep research scoring |
| `OAF_MINI_A_CON_HIST_SIZE` | Console history size (default: JLine default) |
| `OAF_MINI_A_LIBS` | Comma-separated libraries to load automatically |
| `OAF_MINI_A_NOJSONPROMPT` | Disable promptJSONWithStats for main model, force promptWithStats (default: false). Gemini main models auto-enable this behavior when unset |
| `OAF_MINI_A_LCNOJSONPROMPT` | Disable promptJSONWithStats for low-cost model, force promptWithStats (default: false). Required for Gemini low-cost models |

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: '...')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: '...')"
export OAF_VAL_MODEL="(type: openai, model: gpt-4o-mini, key: '...')"
export OAF_MINI_A_CON_HIST_SIZE=1000
export OAF_MINI_A_LIBS="@AWS/aws.js,custom.js"
export OAF_MINI_A_NOJSONPROMPT=true  # Optional override (Gemini main auto-enables when unset)
export OAF_MINI_A_LCNOJSONPROMPT=true  # Required for Gemini low-cost model
```

---

## Rate Limiting & Performance

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `rpm` | number | - | Maximum requests per minute |
| `rtm` | number | - | Legacy alias for `rpm` |
| `tpm` | number | - | Maximum tokens per minute (prompt + completion) |

---

## Deep Research Output Files

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outfile` | string | - | Save final answer to file |
| `outfileall` | string | - | Deep research mode: save complete cycle output (history, verdicts, learnings) |

**Examples:**

```bash
# Limit to 20 requests per minute
mini-a goal="process API requests" rpm=20

# Limit tokens per minute
mini-a goal="analyze large dataset" rpm=20 tpm=80000

# Use with MCP
mini-a goal="query multiple sources" \
  mcp="[(cmd: 'docker run --rm -i mcp/dockerhub'), (cmd: 'docker run --rm -i mcp/wikipedia-mcp')]" \
  rpm=20 tpm=80000
```

---

## Security & Safety

### Command Filtering

**Banned by default:**
- File system: `rm`, `mv`, `cp`, `chmod`, `chown`
- Network: `curl`, `wget`, `ssh`, `scp`
- System: `sudo`, `shutdown`, `reboot`
- Package managers: `apt`, `yum`, `brew`, `npm`, `pip`
- Containers: `docker`, `podman`, `kubectl`

**Examples:**

```bash
# Explicitly allow banned commands
mini-a goal="download file" useshell=true shellallow=curl,wget

# Ban additional commands
mini-a goal="safe operations" useshell=true shellbanextra=lsblk,ifconfig

# Require confirmation for all commands
mini-a goal="modify files" useshell=true readwrite=true checkall=true
```

### Sandboxing

**Docker Sandbox:**
```bash
docker run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
mini-a goal="analyze files" useshell=true shell="docker exec mini-a-sandbox"
```

**Podman Sandbox:**
```bash
podman run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work fedora:latest sleep infinity
mini-a goal="process data" useshell=true shell="podman exec mini-a-sandbox"
```

**macOS sandbox-exec:**
```bash
mini-a goal="catalog files" useshell=true shell="sandbox-exec -f /usr/share/sandbox/default.sb"
```

---

## Docker Usage

Mini-A can run inside Docker containers for isolated execution and portability.

**Recommended:** Use the `openaf/mini-a` image for the simplest approach.

### CLI Console in Docker

```bash
# Basic console
docker run --rm -ti \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  openaf/mini-a

# Console with MCP and custom rules
docker run --rm -ti \
  -e OAF_MODEL=$OAF_MODEL -e OAF_LC_MODEL=$OAF_LC_MODEL \
  openaf/mini-a \
  mcp="(cmd: 'ojob mcps/mcp-time.yaml')" \
  rules="- the default time zone is Asia/Tokyo"

# Console with file access
docker run --rm -ti \
  -v $(pwd):/work -w /work \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  openaf/mini-a useshell=true
```

### Web Interface in Docker

```bash
# Basic web UI
docker run -d --rm \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  -p 12345:12345 \
  openaf/mini-a onport=12345

# Full-featured web UI with multiple MCPs
docker run -d --rm \
  -e OAF_MODEL="(type: openai, key: '...', model: gpt-5-mini, timeout: 900000)" \
  -p 12345:12345 \
  openaf/mini-a \
  mcp="[(cmd: 'ojob mcps/mcp-web.yaml'), (cmd: 'ojob mcps/mcp-time.yaml')]" \
  onport=12345 usecharts=true usediagrams=true usetools=true mcpproxy=true
```

### Goal-Based Execution in Docker

```bash
# Simple goal
docker run --rm \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  openaf/mini-a \
  goal="your goal here" useshell=true

# Goal with file output
docker run --rm \
  -v $(pwd):/work -w /work \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  openaf/mini-a \
  goal="analyze code and create report" useshell=true outfile=/work/report.md

# Goal with MCPs and planning
docker run --rm \
  -v $(pwd):/work -w /work \
  -e OAF_MODEL="(type: openai, model: gpt-4, key: '...', timeout: 900000)" \
  openaf/mini-a \
  goal="research and report on topic" \
  mcp="[(cmd: 'ojob mcps/mcp-web.yaml')]" \
  useplanning=true planfile=/work/plan.md outfile=/work/report.md
```

**Advanced:** For custom oPack combinations, use `openaf/oaf:edge` with `OPACKS=mini-a` and `OPACK_EXEC=mini-a`.

See [USAGE.md](USAGE.md#running-mini-a-in-docker) for comprehensive Docker examples.

---

## Common Examples

### File Analysis

```bash
mini-a goal="analyze JavaScript files and suggest improvements" \
  useshell=true maxsteps=30
```

### Database Query

```bash
mini-a goal="create table with European countries" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa')" \
  knowledge="generate H2 compatible SQL"
```

### Web Search with Wikipedia

```bash
mini-a goal="research quantum computing and summarize" \
  mcp="(cmd: 'docker run --rm -i mcp/wikipedia-mcp')" \
  rpm=20 knowledge="give final answer in markdown"
```

### Multi-MCP Orchestration

```bash
mini-a goal="get latest ubuntu tags from Docker Hub and cross-check with Wikipedia releases" \
  mcp="[(cmd: 'docker run --rm -i mcp/dockerhub'), (cmd: 'docker run --rm -i mcp/wikipedia-mcp')]" \
  rpm=20 format=md
```

### Generate Documentation with Diagrams

```bash
mini-a goal="document system architecture" \
  useshell=true usediagrams=true usecharts=true \
  outfile=architecture.md
```

### Generate Changelog

```bash
mini-a goal="generate CHANGELOG.md from git history" \
  useshell=true shellbatch=true shellallowpipes=true \
  outfile=CHANGELOG.md
```

### Cost-Optimized Complex Task

```bash
# Requires OAF_MODEL and OAF_LC_MODEL set
mini-a goal="analyze codebase and prepare comprehensive report" \
  useshell=true useplanning=true \
  planfile=analysis-plan.md \
  maxsteps=50 maxcontext=10000
```

### Interactive Planning Workflow

```bash
# 1. Generate plan
mini-a goal="migrate database to new schema" \
  planmode=true planfile=migration-plan.md useshell=true

# 2. Validate plan
mini-a goal="migrate database to new schema" \
  planfile=migration-plan.md validateplan=true useshell=true

# 3. Execute plan
mini-a goal="migrate database to new schema" \
  planfile=migration-plan.md useplanning=true useshell=true \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=...')"

# 4. Resume if failed
mini-a goal="migrate database to new schema" \
  planfile=migration-plan.md resumefailed=true useshell=true
```

### Web UI with History

```bash
./mini-a-web.sh onport=8888 \
  usehistory=true historykeep=true \
  useattach=true usediagrams=true usecharts=true

# Restrict accepted prompt size (default is 120000 chars)
./mini-a-web.sh onport=8888 maxpromptchars=40000
```

### SSH Remote Execution

```bash
mini-a goal="check disk usage on remote server" \
  mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user@host:22')"
```

### S3 Operations

```bash
mini-a goal="list latest files in S3 bucket" \
  mcp="(cmd: 'ojob mcps/mcp-s3.yaml bucket=my-bucket prefix=data/')"
```

### Email Notification

```bash
mini-a goal="send status report email" \
  mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=bot@example.com user=bot pass=xxx')"
```

---

## Console Commands

When using the interactive console (`mini-a` or `opack exec mini-a`):

| Command | Description |
|---------|-------------|
| `/show` | Display all current parameters |
| `/show <prefix>` | Display parameters starting with prefix (e.g., `/show plan`) |
| `/context` | Show visual token usage breakdown (using internal estimates or API stats) |
| `/context llm` or `/context analyze` | Analyze conversation tokens using LLM (prefers low-cost model if configured) |
| `/stats memory` | Show working-memory statistics and per-section counts for the active session |
| `/stats detailed memory` | Show full metrics plus the focused memory view (`out=file.json` also supported) |
| `/stats wiki` | Show wiki operation statistics (list/read/search/write/lint counts and errors) |
| `/compact [n]` | Summarize older messages, keep last n exchanges (default: 6) |
| `/summarize [n]` | Generate full narrative summary, keep last n messages (default: 6) |
| `/last [md]` | Reprint the previous final answer (`md` emits raw Markdown) |
| `/save <path>` | Save the last final answer to the provided file path |
| `/cls` | Clear the console screen |
| `/<name> [args...]` | Execute slash template from `~/.openaf-mini-a/commands/<name>.md`, `~/.openaf-mini-a/skills/<name>.md`, or `~/.openaf-mini-a/skills/<name>/SKILL.md` |
| `/help` | Show help information |
| `/quit` or `/exit` | Exit console |

**Custom Slash Commands (`~/.openaf-mini-a/commands/*.md`):**

- Command file: `~/.openaf-mini-a/commands/my-command.md` is invoked as `/my-command ...args...`
- Placeholders: `{{args}}`, `{{argv}}`, `{{argc}}`, `{{arg1}}`, `{{arg2}}`, ...
- Built-in commands always take precedence (`/help`, `/show`, etc. cannot be overridden)
- Missing or unreadable command templates fail with an explicit hard error
- Use `extracommands=<path1>,<path2>` to load commands from additional directories (default dir wins on name conflicts)

**Skill Slash Templates (`~/.openaf-mini-a/skills/`):**

- Same placeholder support as command templates (`{{args}}`, `{{argv}}`, `{{argc}}`, `{{argN}}`)
- Invoked with the same `/<name> ...args...` syntax
- Supported layouts:
  - `~/.openaf-mini-a/skills/<name>/SKILL.md` (Claude Code-style folder skill)
  - `~/.openaf-mini-a/skills/<name>.md` (legacy file skill)
- Folders ending in `.disabled` are ignored during skill discovery
- If both folders define the same name, `commands` takes precedence and the `skills` entry is ignored
- Skills downloaded from sites like `skillsmp.com` can be copied as folders under `~/.openaf-mini-a/skills/` when each folder includes `SKILL.md` (or `skill.md`)
- Use `extraskills=<path1>,<path2>` to load skills from additional directories (default dir wins on name conflicts)

**Console Hooks (`~/.openaf-mini-a/hooks/*.{yaml,yml,json}`):**

- Supported events: `before_goal`, `after_goal`, `before_tool`, `after_tool`, `before_shell`, `after_shell`
- Key fields: `event`, `command`, optional `toolFilter`, `injectOutput`, `timeout`, `failBlocks`, `env`
- Hook runtime env vars include `MINI_A_GOAL`, `MINI_A_RESULT`, `MINI_A_TOOL`, `MINI_A_TOOL_PARAMS`, `MINI_A_TOOL_RESULT`, `MINI_A_SHELL_COMMAND`, `MINI_A_SHELL_OUTPUT`
- `failBlocks=true` can stop the associated goal/tool/shell action when a hook fails
- Use `extrahooks=<path1>,<path2>` to load hooks from additional directories (additive — hooks from all dirs are merged)

Example template:

```markdown
Follow these instructions:
Target: {{arg1}}
All args: {{args}}
Parsed args: {{argv}}
```

Run it:

```bash
mini-a ➤ /my-command repo-a --fast "include docs"
```

**File Attachments in Console:**

> **Tip:** Slash commands that accept file paths (like `/save`) include filesystem tab-completion, and discovered command/skill slash templates also appear in command completion via <kbd>Tab</kbd>.

```bash
# Single file
mini-a ➤ Review the code in @src/main.js

# Multiple files
mini-a ➤ Compare @config/dev.json with @config/prod.json

# Files in natural language
mini-a ➤ Follow these instructions @docs/guide.md and apply rules from @policies/standards.md
```

---

## Quick Tips

1. **Start simple** - Begin with basic goals and add complexity gradually
2. **Use knowledge** - Provide context to improve results
3. **Enable safety** - Use `checkall=true` for file operations
4. **Save conversations** - Use `conversation=` for multi-step tasks
5. **Rate limit** - Use `rpm=` when working with API-limited services
6. **Dual-model optimization** - Set `OAF_LC_MODEL` for cost savings
7. **Planning for complex goals** - Use `useplanning=true` for multi-step tasks
8. **Validate before executing** - Use `validateplan=true` to check plans
9. **Sandbox for safety** - Use `shell=` prefix for isolated execution
10. **Monitor with metrics** - Call `agent.getMetrics()` in library mode

---

## Getting Help

- **Website**: https://mini-a.ai
- **Toolkit**: https://tk.mini-a.ai
- **Full Documentation**: [USAGE.md](USAGE.md)
- **MCP Catalog**: [mcps/README.md](mcps/README.md)
- **Creating MCPs**: [mcps/CREATING.md](mcps/CREATING.md)
- **External MCPs**: [EXTERNAL-MCPS.md](mcps/EXTERNAL-MCPS.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Issues**: https://github.com/openaf/mini-a/issues
- **Email**: openaf@openaf.io
