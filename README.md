# OpenAF mini-a

![/.github/version.svg](/.github/version.svg)

Mini-A is a minimalist autonomous agent that uses LLMs, shell commands and/or MCP stdio or http(s) servers to achieve user-defined goals. It is designed to be simple, flexible, and easy to use. Can be used as a library, command-line tool, or embedded interface in other applications.

![/.github/mini-a-web-screenshot1.jpg](/.github/mini-a-web-screenshot1.jpg)

## Quick Start

Two steps to use:

1. Set `OAF_MODEL` environment variable to the model you want to use.
2. Run the agent through one of the provided entry points:
   - **Shell wrapper:** `./mini-a.sh goal="your goal"` (convenient default that executes `mini-a.yaml`)
   - **oJob invocation:** `ojob mini-a.yaml goal="your goal"` (explicit oJob execution)
   - **Library usage:** `loadLib('mini-a.js'); (new MiniA()).start({ goal: '...' })`

These entry points share the same options, so you can switch between them without changing configuration flags.

Shell access is disabled by default for safety; add `useshell=true` when you explicitly want the agent to run commands.

If you prefer the browser UI, start `./mini-a-web.sh onport=8888` after exporting the model settings and open `http://localhost:8888`.

**Need to share supporting text?** Launch the web server with `useattach=true` to reveal the paperclip button beside the prompt box. You can attach multiple text-based files (up to 512 KB each) before submitting, review them as removable chips, and open the full contents from the conversation stream.

Common web toggles:

- `showexecs=true` to surface executed commands in the transcript
- `logpromptheaders=origin,referer` to emit selected HTTP headers for debugging
- `usediagrams=false` / `usecharts=false` to disable Mermaid diagrams or Chart.js rendering when the runtime lacks those assets
- `useattach=true` to enable the paperclip for uploading supporting text snippets

## Documentation

- **[Detailed Usage Guide](USAGE.md)** - Comprehensive guide covering all configuration options, examples, and best practices
- **[MCP Documentation](mcps/README.md)** - Catalog of available Model Context Protocol servers
- **[Creating MCPs](mcps/CREATING.md)** - Step-by-step guide for creating custom MCP servers
- **[External MCPs](EXTERNAL-MCPS.md)** - List of external MCP servers you can use with Mini-A
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute to the project
- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Community guidelines and standards

## Basic Usage

### Setting the model

Examples:

| Provider | Model | OAF_MODEL value | Observations |
|----------|-------|-----------------|--------------|
| OpenAI | gpt-5-mini | ```(type: openai, model: gpt-5-mini, key: ..., timeout: 900000, temperature: 1)``` | |
| Google | gemini | ```(type: gemini, model: gemini-2.5-flash-lite, key: ..., timeout: 900000, temperature: 0)``` | |
| GitHub | gpt-5-nano | ```(type: openai, url: 'https://models.github.ai/inference', model: openai/gpt-5-nano, key: $(gh auth token), timeout: 900000, temperature: 1, apiVersion: '')``` | |
| AWS Bedrock | nova-pro | ```(type: bedrock, timeout: 900000, options: (model: 'amazon.nova-pro-v1:0', temperature: 0))``` | After installing OpenAF's oPack "AWS" add to mini-a calls ```libs="aws.js"``` |
| AWS Bedrock | claude-sonnet-4.5 | ```(type: bedrock, timeout: 900000, options: (model: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', region: eu-west-1, temperature: 0, params:(max_tokens: 200000)))``` | After installing OpenAF's oPack "AWS" add to mini-a calls ```libs="aws.js"``` |
| Groq | gpt-oss-20b | ```(type: openai, model: 'openai/gpt-oss-20b', key: '...', url: 'https://api.groq.com/openai', timeout: 900000, temperature: 0)``` |
| Ollama | gemma3 | ```(type: ollama, model: 'gemma3', url: 'http://ollama.local', timeout: 900000)``` | |
| Ollama | mistral | ```(type: ollama, model: 'mistral', url: 'http://ollama.local', timeout: 900000)``` | |

> Note: `export OAF_MODEL="..."`

#### Recommended model tiers

- **All uses (best)**: Claude Sonnet 4.5, OpenAI GPT-5, Google Gemini 2.5, OpenAI OSS 120B
- **Low cost (best)**: OpenAI GPT-5 mini, Amazon Nova Pro/Mini, OpenAI OSS 20B
- **Simple agent shell tool**: Gemma 3, Phi 4
- **Chatbot**: Mistral 7B, Llama 3.2 8B

### Dual-Model Configuration (Cost Optimization)

Mini-A supports a dual-model configuration for cost optimization. Set `OAF_LC_MODEL` to use a cheaper model for routine operations, while keeping a more capable model for complex scenarios.

```bash
# Main model (high-capability, used for complex reasoning and initial planning)
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"

# Low-cost model (used for routine operations like summarization and simple tasks)
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
```

**How it works:**
- **Step 0**: Always uses the main model for initial planning
- **Subsequent steps**: Uses the low-cost model by default
- **Smart escalation**: Automatically switches to the main model when:
  - Multiple consecutive errors occur
  - The agent gets stuck in thinking loops
  - Complex reasoning is needed

**Cost savings**: This can significantly reduce API costs by using cheaper models for routine tasks while ensuring quality for complex operations.

### Tool orchestration enhancements

Recent updates focus on performance and resiliency when working with MCP tools:

- **Parallel tool execution** – When the model responds with multiple independent tool calls in the same step, Mini-A executes them concurrently, reducing overall latency for long-running MCP operations.
- **Dynamic tool selection** – Pair `usetools=true` with `mcpdynamic=true` to let Mini-A narrow the registered tool set via keyword heuristics, then the low-cost LLM, and finally the primary model, falling back to the full catalog if none match.
- **Smart context caching** – System prompts and tool schema summaries are cached across sessions, minimizing repeated token overhead and keeping instructions consistent even as the tool roster grows.
- **Deterministic tool result caching** – Tools marked with `annotations.readOnlyHint`, `annotations.idempotentHint`, or explicit caching metadata reuse previous results for the same parameters. Configure the default cache window with `toolcachettl=<ms>` or override it per tool via metadata.
- **Lazy MCP initialization** – Pass `mcplazy=true` to defer establishing MCP connections until a tool is actually needed. This shortens startup times when many optional integrations are configured.

These improvements work out of the box and can be tuned per environment; see [USAGE.md](USAGE.md) for option details.

### Reliability & recovery upgrades

Mini-A now bounces back from flaky infrastructure faster and with richer diagnostics:

- **Exponential backoff on LLM and MCP calls** automatically spaces out retries to absorb transient rate limits, timeouts, and network hiccups before escalating failures.
- **Automatic checkpoints and restoration** capture the agent state at the end of each healthy step, allowing seamless recovery after transient errors without losing context or progress.
- **Error categorization** distinguishes between transient and permanent faults so the agent can retry, escalate, or halt with clear messaging instead of blindly reissuing requests.
- **Circuit breakers for MCP connections** temporarily pause repeatedly failing integrations, protecting the session from hammering unhealthy backends.
- **Preserved error context across summaries** keeps the latest recovery notes at the top of the conversation even when the working memory is compressed.

### Advanced planning upgrades

Enable `useplanning=true` to activate a richer planning workflow that now adapts to task complexity:

- **Goal-aware strategy selection** inspects the goal upfront and disables planning for trivial requests, keeps a short linear task list for moderate work, and creates a nested plan tree for complex missions.
- **Automatic decomposition & checkpoints** seeds `state.plan` with structured steps, intermediate checkpoints, and progress percentages so the LLM can track execution without handcrafting the scaffold from scratch.
- **Feasibility validation** pre-checks each step against available shell access and registered MCP tools, blocking impossible tasks and surfacing actionable warnings in the log.
- **Dynamic replanning hooks** mark the active step as `blocked` whenever the runtime raises an error, flagging `state.plan.meta.needsReplan=true` so the model knows to adjust its strategy.
- **Progress metrics & logging** record overall completion, checkpoint counts, and new counters (`plans_generated`, `plans_validated`, `plans_replanned`, etc.) that show up in `getMetrics()`.

The new planning helpers live entirely in `state.plan`, so existing prompts and transcripts remain compatible while gaining richer telemetry.

### Recent MCP additions

Last week's release expanded the built-in MCP catalog so you can cover more workflows without pulling in external servers:

- **S3 object storage (`mcps/mcp-s3.yaml`)** – Browse buckets, inspect objects, generate pre-signed URLs, and (optionally) enable read/write operations through a hardened MCP interface.
- **Local shell tooling (`mcps/mcp-shell.yaml`)** – Execute vetted shell commands or batches through the MCP safety layer, reusing the same allow/deny lists that protect direct shell access.
- **Yahoo Finance data (`mcps/mcp-fin.yaml`)** – Pull price series and company fundamentals straight from Yahoo Finance via deterministic, cache-friendly tools.
- **RSS discovery and retrieval (`mcps/mcp-rss.yaml`)** – Look up curated feed endpoints and normalize RSS/Atom content for summarization or monitoring flows.

See [mcps/README.md](mcps/README.md) for full tool descriptions and parameter details.

### Running the mini agent

#### Single MCP connection

```bash
mini-a.sh goal="list all nmaguiar/imgutils image tags" mcp="(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000)" rpm=20
mini-a.sh goal="..." mcp="(cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)" rpm=20 __format=md
```
`rpm` caps model requests per minute; add `tpm=<tokens>` to limit combined prompt and completion tokens when needed.

#### Multiple MCP connections

```bash
mini-a.sh goal="get the latest top 20 tags used by the library/ubuntu, cross-check those tag names with the list of Ubuntu releases in Wikipedia, and produce a table with ubuntu release, tag name and latest push date" mcp="[(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000), (cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)]" rpm=20 tpm=80000 __format=md
```

#### Local MCP servers

Using built-in MCP servers:

```bash
# Database operations (preload optional helpers via libs=... if needed)
mini-a.sh goal="create a test table with European countries" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa libs=db/helpers.js', timeout: 5000)" rpm=20

# Network utilities

# Time and timezone utilities
mini-a.sh goal="what time is it in Sydney right now?" mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)" rpm=20

# SSH execution (mcp-ssh)
mini-a.sh goal="run 'uptime' on remote host via SSH MCP" mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false', timeout: 5000)" rpm=20

mini-a.sh goal="check if port 80 is open on google.com" mcp="(cmd: 'ojob mcps/mcp-net.yaml', timeout: 5000)" rpm=20

# Email operations
mini-a.sh goal="send a test email" mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=test@example.com', timeout: 5000)" rpm=20

# S3 inventory (read-only by default; add readwrite=true to enable writes)
mini-a.sh goal="list the latest invoices in our S3 bucket" \
  mcp="(cmd: 'ojob mcps/mcp-s3.yaml bucket=finance-archive prefix=invoices/', timeout: 5000)" rpm=20

# RSS monitoring
mini-a.sh goal="summarize the last five posts from the OpenAI blog" \
  mcp="(cmd: 'ojob mcps/mcp-rss.yaml', timeout: 5000)" knowledge="- prefer bullet lists" rpm=20

# Market data lookups
mini-a.sh goal="compare AAPL and MSFT revenue trends" \
  mcp="(cmd: 'ojob mcps/mcp-fin.yaml', timeout: 5000)" rpm=20

# Local shell MCP (inherits the command allow/deny list)
mini-a.sh goal="collect disk usage stats" \
  mcp="(cmd: 'ojob mcps/mcp-shell.yaml timeout=3000 shellallow=df,du', timeout: 5000)" rpm=20
```

#### Shell operations

_Remove docker images older than 1 year:_

```bash
mini-a.sh goal="help me remove docker images that are older than 1 year" rpm=20 knowledge="give a final answer with a summary of changes in markdown" useshell=true
```

_Analyze project structure:_

```bash
mini-a.sh goal="analyze the current directory structure and provide insights" useshell=true rpm=15 __format=md
```

### Chatbot-style conversations

When you just need an assistant-style exchange without the agent workflow, pass `chatbotmode=true`. Mini-A will swap in a lighter system prompt geared for natural dialogue, skip tool descriptions in the instructions, and stream replies just like a regular chat bot. You can combine this with the web UI or CLI entry points:

```bash
./mini-a.sh goal="help me plan a vacation in Lisbon" chatbotmode=true
```

From code you can opt into the same behavior:

```javascript
var mini = new MiniA()
mini.start({ goal: "Summarize today's standup", chatbotmode: true })
```

All other flags (MCP connections, attachments, shell access, etc.) continue to work—you simply choose between the agent-style prompt or a conversational one based on the task.

### Task planning updates (agent mode, opt-in)

Set `useplanning=true` (and keep `chatbotmode=false`) to have the agent maintain a lightweight task plan inside the state (`plan` array). Each item includes a short title and a status (`pending`, `in_progress`, `done`, or `blocked`). Leave `useplanning` unset/false and Mini-A will skip the planning instructions entirely.

- **CLI / oJob output**: Planning updates appear with the 🗺️ icon, alongside thought (`💭`) messages.
- **Web UI**: When an active plan exists the transcript keeps the 🗺️ entries and the interface surfaces an expandable progress card that summarizes completed vs. total steps and renders the plan as a numbered checklist with completed items struck through.
- **Custom integrations**: The current plan continues to flow through the state payload passed back on each step, enabling downstream automation.

The agent revises the plan whenever progress changes, so the summary always reflects the latest approach. When no plan is active the web UI hides 🗺️ updates and the progress card stays collapsed.

## Project Components

Mini-A ships with three complementary components:

- **`mini-a.yaml`** – Core oJob definition that implements the agent workflow.
- **`mini-a.sh`** – Shell wrapper that locates the repository directory and runs `mini-a.yaml` with all provided arguments.
- **`mini-a.js`** – Reusable library so you can embed the agent in other OpenAF jobs or automation scripts.
- **`mini-a-web.sh` / `mini-a-web.yaml`** – Lightweight HTTP server that serves the browser UI found in `public/`.

## Features

- **Multi-Model Support**: Works with OpenAI, Google Gemini, GitHub Models, AWS Bedrock, Ollama, and more
- **Dual-Model Cost Optimization**: Use a low-cost model for routine steps via `OAF_LC_MODEL` with smart escalation to the main model when needed (see [details](#dual-model-configuration-cost-optimization))
- **MCP Integration**: Seamless integration with Model Context Protocol servers (both local and external)
- **STDIO or HTTP MCPs**: Use MCPs over STDIO or start them as remote HTTP servers with `onport` (see [MCP docs](mcps/README.md))
- **Shell Access**: Optional shell command execution with safety controls
- **Flexible Configuration**: Extensive configuration options for different use cases
- **Dynamic Planning View**: Opt into `useplanning=true` to keep a live plan (🗺️) of the current task, complete with web UI progress tracking
- **Dynamic MCP Tool Selection**: Combine `usetools=true` with `mcpdynamic=true` to have the agent register only the tools it considers relevant to the current goal, falling back gracefully when needed
- **Built-in MCPs**: Includes database, file system, network, time/timezone, email, data channel, RSS, S3, Yahoo Finance, SSH execution, and local shell MCP servers
- **Multiple MCP Connections**: Connect to multiple MCPs at once and orchestrate across them
- **Simple Web UI**: Lightweight embedded chat interface for interactive use (screenshot above)
- **Text Attachments in the Web UI**: When started with `useattach=true`, upload and review text files alongside your prompt with collapsible previews in the conversation log
- **Utility MCP Helpers**: Add `useutils=true` to bundle the Mini File Tool utilities as an on-demand MCP you can call from the agent
- **Chatbot Mode**: Toggle `chatbotmode=true` to strip agent-style instructions and chat with the model in a lightweight assistant mode
- **Safety Features**: Command filtering, confirmation prompts, and read-only modes
- **Conversation Persistence**: Save and resume conversations across sessions
- **Automatic Context Summarization**: Keeps context within limits with auto-summarize when it grows
- **Rate Limiting**: Built-in rate limiting for API usage control
- **Metrics & Observability**: Built-in counters surfaced via `MiniA.getMetrics()` and OpenAF's `ow.metrics` registry for dashboards.

## Installation

Mini-A is built on the OpenAF platform. To get started:

1. **Install OpenAF** - Download from [openaf.io](https://openaf.io)
2. **Install oPack**:
   ```bash
   opack install mini-a
   ```
3. **Set your model configuration** (see [model examples](#setting-the-model) below)
4. **Start using Mini-A**!

## Configuration

### Environment Variables

- **`OAF_MODEL`** (required): LLM model configuration
- **`OAF_LC_MODEL`** (optional): Low-cost LLM model configuration for cost optimization
- **`OAF_FLAGS="(MD_DARKMODE: 'auto')"`**: For setting forced dark mode or automatic

### Command Line Options

All Mini-A options can be passed as command line arguments:

- `goal` – Objective the agent should achieve (required for `MiniA.start` / `mini-a.yaml`)
- `mcp` – MCP server configuration (single object or array, in JSON/SLON)
- `usetools` – Register MCP tools directly with the model instead of expanding the prompt with tool schemas
- `mcpdynamic` – When combined with `usetools=true`, analyze the goal and register only the MCP tools that look relevant
- `useutils` – Mount the Mini File Tool helpers as an auxiliary MCP connection (default `false`)
- `useshell` – Allow shell command execution (default `false`)
- `shell` – Prefix every shell command (requires `useshell=true`; ideal for sandboxing with `sandbox-exec`, `container exec`, `docker exec`, etc.)
- `readwrite` – Allow file system modifications without confirmation prompts (default `false`)
- `checkall` – Prompt before running every shell command (default `false`)
- `shellallow`, `shellbanextra` – Override the default banned command lists
- `shellallowpipes` – Permit pipes/redirection/control operators when executing shell commands (default `false`)
- `shellbatch` – Skip interactive confirmations when `checkall` is active (default `false`)
- `knowledge` – Extra instructions or the path to a text file to append to the system prompt
- `rules` – Additional numbered rules (JSON/SLON array) injected into the system prompt
- `state` – Initial agent state payload (JSON/SLON string or object) preserved between steps
- `conversation` – Path to a conversation JSON file to load/save chat history
- `libs` – Comma-separated list of extra OpenAF libraries to load before starting
- `maxsteps` – Maximum number of agent steps (default `25`)
- `maxcontext` – Approximate token budget for context before auto-summarization kicks in (default disabled)
- `rpm` – Maximum LLM requests per minute (waits automatically)
- `tpm` – Maximum combined prompt/completion tokens per minute
- `verbose`, `debug` – Enable progressively richer logging
- `raw` – Return the final response exactly as produced instead of formatted output
- `outfile` – Path to write the final answer (implies JSON output unless `__format` is provided)
- `__format` – Output format (e.g. `md`, `json`)
- `chatbotmode` – Skip the agent workflow and respond like a regular chat assistant (default `false`)
- `useplanning` – Keep a live task plan in agent mode; Mini-A disables it automatically for trivial goals

For a complete list of options, see the [Usage Guide](USAGE.md).

## Security

Mini-A includes several security features:

- **Command Filtering**: Dangerous commands are blocked by default
- **Customizable Shell Controls**: Use `shellallow`, `shellallowpipes`, and `shellbanextra` to fine-tune shell access
- **Interactive Confirmation**: Use `checkall=true` for command approval
- **Read-Only Mode**: File system protection enabled by default
- **Shell Isolation**: Shell access disabled by default

### Shell Prefix Examples

Combine `useshell=true` with the new `shell=...` option to route every command through an OS sandbox or container runtime. The prefix is prepended to the command before execution (the safety filters still inspect the original command text).

- **macOS (sandbox-exec)** – Constrain the agent with a sandbox profile:
  ```bash
  ./mini-a.sh goal="catalog ~/Projects" useshell=true \
    shell="sandbox-exec -f /usr/share/sandbox/default.sb"
  ```
- **macOS Sequoia (container)** – Use Apple's `container` CLI after starting an instance:
  ```bash
  container run --detach --name mini-a --image docker.io/library/ubuntu:24.04 sleep infinity
  ./mini-a.sh goal="inspect /work" useshell=true shell="container exec mini-a"
  ```
- **Linux / macOS / Windows WSL (Docker)** – Exec into an existing sandbox container:
  ```bash
  docker run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
  ./mini-a.sh goal="summarize git status" useshell=true shell="docker exec mini-a-sandbox"
  ```
- **Linux / macOS / Windows WSL (Podman)** – Same pattern with Podman:
  ```bash
  podman run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work docker.io/library/fedora:latest sleep infinity
  ./mini-a.sh goal="list source files" useshell=true shell="podman exec mini-a-sandbox"
  ```

See the [Usage Guide](USAGE.md#shell-prefix-strategies-by-operating-system) for trade-offs and when to choose shell prefixes versus the built-in restriction flags.

See the [Usage Guide](USAGE.md#security-considerations) for detailed security information.

## Monitoring & Metrics

Mini-A tracks detailed runtime metrics (LLM calls, shell approvals, escalation counters, summarization activity, and more). You can access them in two ways:

- From code, call [`MiniA.getMetrics()`](USAGE.md#metrics-and-observability) to obtain a snapshot of counters for the current process.
- Through OpenAF's metrics registry (`ow.metrics.add('mini-a', ...)`), which exposes the same information to external scrapers or dashboards.

These metrics are useful for tracking costs, diagnosing stuck runs, and creating operational dashboards for long-lived agents.

### Metric categories returned by `getMetrics()`

| Category | Keys | What they represent |
|----------|------|--------------------|
| `llm_calls` | `normal`, `low_cost`, `total`, `fallback_to_main` | How many requests were routed to the primary or low-cost model and the number of times Mini-A escalated back to the main model. |
| `goals` | `achieved`, `failed`, `stopped` | Goal-level outcomes for the current run. |
| `actions` | `thoughts_made`, `thinks_made`, `finals_made`, `mcp_actions_executed`, `mcp_actions_failed`, `shell_commands_executed`, `shell_commands_blocked`, `shell_commands_approved`, `shell_commands_denied`, `unknown_actions` | Volume and success of high-level agent actions, including MCP calls and shell approvals. |
| `planning` | `disabled_simple_goal`, `plans_generated`, `plans_validated`, `plans_validation_failed`, `plans_replanned` | Planning workflow activity: when planning was skipped, generated, validated, or rebuilt during a session. |
| `performance` | `steps_taken`, `total_session_time_ms`, `avg_step_time_ms`, `max_context_tokens`, `llm_estimated_tokens`, `llm_actual_tokens`, `llm_normal_tokens`, `llm_lc_tokens` | Execution pacing, wall-clock timings, and token consumption. |
| `behavior_patterns` | `escalations`, `retries`, `consecutive_errors`, `consecutive_thoughts`, `json_parse_failures`, `action_loops_detected`, `thinking_loops_detected`, `similar_thoughts_detected` | Signals that help detect unhealthy loops or parser issues. |
| `summarization` | `summaries_made`, `summaries_skipped`, `summaries_forced`, `context_summarizations`, `summaries_tokens_reduced`, `summaries_original_tokens`, `summaries_final_tokens` | Automatic summarization decisions and token savings. |

Use these counters to plot dashboards, set alerts (for example, when `consecutive_errors` keeps climbing), or estimate LLM spend based on token metrics.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Code contribution process
- Development setup
- Pull request guidelines
- Community standards

### Running tests

Run the test suite from the repository root using oJob:

```
ojob tests/autoTestAll.yaml
```

Be sure to execute this in the main repo folder so relative paths used by the tests resolve correctly. You need OpenAF installed so the `ojob` command is available.

The run generates an `autoTestAll.results.json` file with detailed results—inspect it locally and delete it before your final commit.

## Community

- **Issues**: [GitHub Issues](https://github.com/openaf/mini-a/issues)
- **Discussions**: [GitHub Discussions](https://github.com/openaf/mini-a/discussions)
- **Email**: openaf@openaf.io

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
