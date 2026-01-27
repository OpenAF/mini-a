# Mini-A Quick Reference Cheatsheet

A comprehensive quick reference for all Mini-A parameters, modes, and common usage patterns.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Parameters](#core-parameters)
- [Model Configuration](#model-configuration)
- [Shell & Execution](#shell--execution)
- [MCP Integration](#mcp-integration)
- [Planning Features](#planning-features)
- [Visual & Output](#visual--output)
- [Knowledge & Context](#knowledge--context)
- [Mode Presets](#mode-presets)
- [Advanced Features](#advanced-features)
- [Rate Limiting & Performance](#rate-limiting--performance)
- [Security & Safety](#security--safety)
- [Common Examples](#common-examples)

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
```

---

## Core Parameters

### Required

| Parameter | Description | Example |
|-----------|-------------|---------|
| `goal` | Objective for the agent to achieve | `goal="analyze code and suggest improvements"` |

### Essential Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxsteps` | number | `15` | Maximum consecutive steps without progress before forcing final answer |
| `earlystopthreshold` | number | `3` (5 with LC) | Identical consecutive errors before early stop (auto-adjusts for low-cost models) |
| `verbose` | boolean | `false` | Enable verbose logging |
| `debug` | boolean | `false` | Enable debug mode with detailed logs |
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
| `modelman` | Launch interactive model manager | `modelman=true` |

### Provider Examples

| Provider   | Model                   | Example |
|------------|-------------------------|---------|
| Anthropic  | claude-haiku-4.5        | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-haiku-4-5-20251001, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Anthropic  | claude-opus-4.5         | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-opus-4-5-20251101, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Anthropic  | claude-sonnet-4.5       | ```export OAF_MODEL="(type: anthropic, key: '...', model: claude-sonnet-4-5-20250929, timeout: 900000, temperature: 0, params: (max_tokens: 64000))" ``` |
| Bedrock    | claude-haiku-4.5        | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
| Bedrock    | claude-sonnet-4.5       | ```export OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', temperature: 0, params: (max_tokens: 65535)), timeout: 900000)"``` |
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
| `shellprefix` | string | - | Override shell prefix for stored plans |
| `readwrite` | boolean | `false` | Allow read-write operations without confirmation |
| `checkall` | boolean | `false` | Ask for confirmation before executing any shell command |
| `shellbatch` | boolean | `false` | Run in batch mode without prompting for command approval |
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
```

---

## MCP Integration

### MCP Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mcp` | string | - | MCP connection object (single or array) in SLON/JSON format |
| `usetools` | boolean | `false` | Register MCP tools directly on the model instead of in prompt |
| `mcpdynamic` | boolean | `false` | Analyze goal and only register relevant MCP tools |
| `mcplazy` | boolean | `false` | Defer MCP connection initialization until first use |
| `mcpproxy` | boolean | `false` | Aggregate all MCP connections (including Mini Utils Tool) behind a single `proxy-dispatch` tool to reduce context usage |
| `toolcachettl` | number | `600000` | Default cache TTL in milliseconds for MCP tool results |
| `useutils` | boolean | `false` | Auto-register Mini Utils Tool utilities as MCP connection |
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

**Lazy Initialization:**
```bash
mini-a goal="analyze local files" \
  mcp="[(cmd: 'ojob mcps/mcp-db.yaml...'), (cmd: 'ojob mcps/mcp-net.yaml...')]" \
  mcplazy=true usetools=true
```

**Proxy Aggregation (single tool exposed):**
```bash
mini-a goal="compare S3 usage with database stats" \
  mcp="[(cmd: 'ojob mcps/mcp-s3.yaml bucket=my-bucket'), (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data')]" \
  usetools=true mcpproxy=true useutils=true
```
See [docs/MCPPROXY-FEATURE.md](docs/MCPPROXY-FEATURE.md) for full workflows and the `proxy-dispatch` action set.

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
| `mcp-email` | Email sending | `mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=bot@example.com')"` |
| `mcp-shell` | Local shell | `mcp="(cmd: 'ojob mcps/mcp-shell.yaml shellallow=df,du')"` |
| `mcp-file` | File operations | `mcp="(cmd: 'ojob mcps/mcp-file.yaml root=./data readwrite=true')"` |
| `mcp-web` | Web search/fetch | `mcp="(cmd: 'ojob mcps/mcp-web.yaml')"` |
| `mcp-weather` | Weather info | `mcp="(cmd: 'ojob mcps/mcp-weather.yaml')"` |
| `mcp-kube` | Kubernetes | `mcp="(cmd: 'ojob mcps/mcp-kube.yaml')"` |
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

## Visual & Output

### Visual Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usediagrams` | boolean | `false` | Encourage Mermaid diagrams in output |
| `usemermaid` | boolean | `false` | Alias for `usediagrams` |
| `usecharts` | boolean | `false` | Encourage Chart.js charts in output |
| `useplotly` | boolean | `false` | Encourage Plotly.js charts in output |
| `useascii` | boolean | `false` | Encourage enhanced UTF-8/ANSI visual output with colors and emojis |
| `usemaps` | boolean | `false` | Encourage Leaflet JSON blocks for interactive maps (renders in console transcript and web UI) |
| `format` | string | `md` | Output format (`md` or `json`) |
| `outputfile` | string | - | Alternative key for `outfile`, used mainly during plan conversions |

**Examples:**

```bash
# Generate with Mermaid diagrams
mini-a goal="document workflow" usediagrams=true

# Generate with Chart.js visualizations
mini-a goal="analyze sales data" usecharts=true useshell=true

# Generate with Plotly charts
mini-a goal="visualize forecast spread" useplotly=true

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
| `libs` | string | - | Comma-separated list of additional OJob libraries to load |

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

# Context management
mini-a goal="analyze large codebase" \
  maxcontext=8000 maxsteps=50 useshell=true

# Load additional libraries
mini-a goal="process AWS data" \
  libs="@AWS/aws.js,custom.js"
```

---

## Mode Presets

Quick configuration bundles for common use cases.

| Mode | Description | Equivalent Parameters |
|------|-------------|----------------------|
| `shell` | Read-only shell access | `useshell=true` |
| `shellrw` | Shell with write access | `useshell=true readwrite=true` |
| `shellutils` | Shell + Mini Utils Tool | `useshell=true useutils=true usetools=true` |
| `chatbot` | Conversational mode | `chatbotmode=true` |
| `web` | Browser UI optimized | `usetools=true` |
| `webfull` | Full-featured web UI | `usetools=true usediagrams=true usecharts=true useascii=true usehistory=true useattach=true historykeep=true useplanning=true` |

**Examples:**

```bash
# Use shell mode preset
mini-a mode=shell goal="list files"

# Use chatbot mode
mini-a mode=chatbot goal="help me plan a trip"

# Use web mode
./mini-a-web.sh mode=web onport=8888

# Custom preset (in ~/.openaf-mini-a_modes.yaml)
modes:
  mypreset:
    useshell: true
    readwrite: true
    maxsteps: 30
    knowledge: "Always use concise responses"

# Use custom preset
mini-a mode=mypreset goal="your goal here"
```

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

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OAF_MODEL` | Primary LLM model configuration |
| `OAF_LC_MODEL` | Low-cost model for dual-model optimization |
| `OAF_MINI_A_CON_HIST_SIZE` | Console history size (default: JLine default) |
| `OAF_MINI_A_LIBS` | Comma-separated libraries to load automatically |
| `OAF_MINI_A_NOJSONPROMPT` | Disable promptJSONWithStats for main model, force promptWithStats (default: false). Required for Gemini models due to API restrictions |
| `OAF_MINI_A_LCNOJSONPROMPT` | Disable promptJSONWithStats for low-cost model, force promptWithStats (default: false). Required for Gemini low-cost models |

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: '...')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: '...')"
export OAF_MINI_A_CON_HIST_SIZE=1000
export OAF_MINI_A_LIBS="@AWS/aws.js,custom.js"
export OAF_MINI_A_NOJSONPROMPT=true  # Required for Gemini main model
export OAF_MINI_A_LCNOJSONPROMPT=true  # Required for Gemini low-cost model
```

---

## Rate Limiting & Performance

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `rpm` | number | - | Maximum requests per minute |
| `rtm` | number | - | Legacy alias for `rpm` |
| `tpm` | number | - | Maximum tokens per minute (prompt + completion) |

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
| `/compact [n]` | Summarize older messages, keep last n exchanges (default: 6) |
| `/summarize [n]` | Generate full narrative summary, keep last n messages (default: 6) |
| `/last [md]` | Reprint the previous final answer (`md` emits raw Markdown) |
| `/save <path>` | Save the last final answer to the provided file path |
| `/help` | Show help information |
| `/quit` or `/exit` | Exit console |

**File Attachments in Console:**

> **Tip:** Slash commands that accept file paths (like `/save`) now include filesystem tab-completion, so you can press <kbd>Tab</kbd> to auto-complete directories and filenames.

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

- **Full Documentation**: [USAGE.md](USAGE.md)
- **MCP Catalog**: [mcps/README.md](mcps/README.md)
- **Creating MCPs**: [mcps/CREATING.md](mcps/CREATING.md)
- **External MCPs**: [EXTERNAL-MCPS.md](mcps/EXTERNAL-MCPS.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Issues**: https://github.com/openaf/mini-a/issues
- **Email**: openaf@openaf.io
