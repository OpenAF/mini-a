# Mini-A Usage Guide

Mini-A (Mini Agent) is a goal-oriented autonomous agent that uses Large Language Models (LLMs) and various tools to achieve specified goals. It can execute shell commands, interact with Model Context Protocol (MCP) servers, and work step-by-step towards completing objectives.

## Prerequisites

- **OpenAF**: Mini-A is built for the OpenAF platform
- **OAF_MODEL Environment Variable**: Must be set to your desired LLM model configuration
- **OAF_LC_MODEL Environment Variable** (optional): Low-cost model for cost optimization

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
# Optional: Set a low-cost model for routine operations
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
```

## Command-Line Execution

Mini-A can be started from the shell in three equivalent ways:

- `./mini-a.sh goal="summarize the logs" useshell=true` — wrapper script that resolves the repository path automatically.
- `ojob mini-a.yaml goal="summarize the logs" useshell=true` — direct invocation of the oJob definition.
- `ojob mini-a-web.yaml onport=8888` — launches the HTTP server that powers the browser UI found in `public/`.

All command-line flags documented below work with either `mini-a.sh` or `ojob mini-a.yaml`.

## Model Configuration

### Single Model Setup

For basic usage, only set the main model:

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
```

### Dual-Model Setup (Cost Optimization)

Mini-A supports intelligent dual-model usage to optimize costs while maintaining quality:

```bash
# High-capability model for complex reasoning and initial planning
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"

# Low-cost model for routine operations
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
```

**Benefits:**
- **Cost Savings**: Use cheaper models for routine tasks (summarization, simple actions)
- **Quality Assurance**: Automatic escalation to the main model for complex scenarios
- **Transparency**: Clear logging shows which model is being used for each operation

**When Mini-A uses each model:**

| Operation | Model Used | Reason |
|-----------|------------|--------|
| Initial planning (Step 0) | Main Model | Critical first step requires best reasoning |
| Routine operations | Low-Cost Model | Cost-effective for simple tasks |
| Context summarization | Low-Cost Model | Simple text condensation task |
| Error recovery | Main Model | After 2+ consecutive errors |
| Complex reasoning | Main Model | When thinking loops or stuck patterns detected |
| Invalid JSON fallback | Main Model | When low-cost model produces invalid responses |

**Smart Escalation Triggers:**
- 2+ consecutive errors
- 3+ consecutive thoughts without action
- 5+ total thoughts (thinking loop detection)
- 4+ steps without meaningful progress
- Repeating similar thoughts detected

## Reliability features

Mini-A now includes resilience primitives so long-running sessions can absorb transient failures without manual babysitting:

- **Exponential backoff on every LLM and MCP call** smooths over throttling and flaky network hops by spacing retries with an increasing delay.
- **Automatic checkpoints** snapshot the agent state after each successful step; if a transient error strikes, Mini-A restores the last checkpoint and keeps working instead of abandoning the goal.
- **Error categorization** separates transient hiccups (network, rate limits, timeouts) from permanent problems (invalid tool payloads, unsupported actions) so retries are only attempted when they make sense.
- **MCP circuit breakers** pause connections that repeatedly fail and log a warning, preventing noisy integrations from derailing the rest of the plan. Mini-A will automatically retry after the cooldown expires.
- **Persistent error summaries** prepend the latest recovery notes to the context whenever it is summarized, keeping operators informed about what went wrong and how it was resolved.

All of these behaviors are enabled by default. Use verbose or debug logging (`verbose=true` or `debug=true`) to watch the retry, recovery, and circuit-breaker messages in real time.

## Web UI quick start

Mini‑A includes a simple web UI you can use from your browser. The static page lives in `public/index.md` and is served by a small HTTP server defined in `mini-a-web.yaml`.

Quick steps:

1) Export your model config

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
# Optional: use a cheaper model for routine steps
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
```

2) Start the Mini‑A web server

Recommended:

```bash
./mini-a-web.sh onport=8888
```

Alternative:

```bash
ojob mini-a-web.yaml onport=8888
```

3) Open the UI in your browser

```text
http://localhost:8888/
```

Optional flags when starting the server:

- `showexecs=true` to show executed commands in the interaction stream
- `logpromptheaders=origin,referer` to log selected incoming headers for debugging
- `usediagrams=false` / `usecharts=false` to disable Mermaid or Chart.js rendering when running headless
- `usehistory=true` to expose the history side panel and persist conversations on disk
- `historypath=/tmp/mini-a-history` / `historyretention=600` / `historykeep=true` to manage history storage (see comments in `mini-a-web.yaml`)
- `historys3bucket=my-bucket historys3prefix=sessions/` to mirror history JSON files to S3 (supports `historys3url`, `historys3accesskey`, `historys3secret`, `historys3region`, `historys3useversion1`, `historys3ignorecertcheck`)
- `useattach=true` to enable the file attachment button in the browser UI (disabled by default)

Endpoints used by the UI (served by `mini-a-web.yaml`): `/prompt`, `/result`, `/clear`, and `/ping`.

### Web UI via Docker

Run the Mini‑A browser UI inside a container by passing the proper `OAF_MODEL` configuration for your LLM provider and exposing port `12345`. The following examples mount a `history/` directory from the host so conversation transcripts persist across runs.

> **Tip:** Replace secrets like API keys or session tokens with values from your shell environment or a secure secret manager. The `OPACKS` and `libs` flags load the provider- and Mini‑A-specific OpenAF packs and helper scripts.

#### AWS Bedrock (Mistral 7B Instruct)

```bash
docker run --rm -ti \
  -e OPACKS=aws,mini-a \
  -e OAF_MODEL="(type: bedrock, timeout: 900000, options: (model: 'mistral.mistral-7b-instruct-v0:2', region: eu-west-1, temperature: 0.7, params: ('top_p': 0.9, 'max_tokens': 8192)))" \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
  -v $(pwd)/history:/tmp/history \
  -e OJOB=mini-a/mini-a-web.yaml \
  -p 12345:12345 \
  openaf/oaf:edge \
  onport=12345 chatbotmode=true \
  usehistory=true historykeep=true historypath=/tmp/history \
  useattach=true \
  libs="@AWS/aws.js"
```

#### OpenAI (GPT‑5 Mini)

```bash
docker run --rm -ti \
  -e OPACKS=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-openai-key', temperature: 1, timeout: 900000)" \
  -v $(pwd)/history:/tmp/history \
  -e OJOB=mini-a/mini-a-web.yaml \
  -p 12345:12345 \
  openaf/oaf:edge \
  onport=12345 chatbotmode=true \
  usehistory=true historykeep=true historypath=/tmp/history \
  useattach=true
```

#### Custom Providers

Adapt the examples above by changing the `OAF_MODEL` tuple to match your provider (e.g., Anthropic, Azure OpenAI, Together). If the provider requires extra SDKs or credentials, extend the `OPACKS` list, add new `libs`, and export the relevant environment variables as `-e` flags.

### Attaching files in the browser UI

> **Prerequisite:** start the web server with `useattach=true` to display the paperclip control.

- Click the paperclip button to the left of the prompt to choose one or more text-based files (Markdown, source code, CSV, JSON, etc.). Each file can be up to **512 KB**.
- Every attachment appears above the prompt as a rounded chip showing the file name; remove any file before sending by selecting the **✕** icon.
- When you submit the prompt, Mini-A automatically appends the file name and contents as Markdown code blocks. In the conversation stream the files show up as collapsible buttons—click one to open a preview modal with syntax highlighting.
- Non-text files or oversized attachments are skipped with a warning so you always know what was sent.

## Basic Usage

### Creating and Starting a Mini-A Agent

```javascript
// Create a new Mini-A instance
var agent = new MiniA()

// Start the agent with a goal
var result = agent.start({
    goal: "Find all JavaScript files in the current directory and count the lines of code"
})

log(result)
```

## Configuration Options

The `start()` method accepts various configuration options:

### Required Parameters

- **`goal`** (string): The objective the agent should achieve

### Optional Parameters

#### Basic Configuration
- **`maxsteps`** (number, default: 15): Maximum consecutive steps without a successful action before the agent forces a final answer
- **`verbose`** (boolean, default: false): Enable verbose logging
- **`debug`** (boolean, default: false): Enable debug mode with detailed logs
- **`raw`** (boolean, default: false): Return raw string instead of formatted output
- **`chatbotmode`** (boolean, default: false): Replace the agent workflow with a lightweight conversational assistant prompt
- **`useplanning`** (boolean, default: false): Load (or maintain) a persistent task plan in agent mode. When no pre-generated plan is available Mini-A falls back to the adaptive in-session planner and disables the feature for trivial goals.
- **`mode`** (string): Apply a preset from [`mini-a-modes.yaml`](mini-a-modes.yaml) to prefill a bundle of related flags

#### Planning Controls
- **`planmode`** (boolean, default: false): Switch to planning-only mode. Mini-A studies the goal/knowledge, generates a structured Markdown/JSON plan, and exits without executing any tasks. Mutually exclusive with `chatbotmode`.
- **`planfile`** (string): When planning, write the generated plan to this path. In execution mode, load an existing plan from this path (Markdown `.md` or JSON `.json`) and keep it in sync as tasks complete.
- **`planformat`** (string): Override the plan output format during `planmode` (`markdown` or `json`). Defaults to the detected extension of `planfile`, or Markdown when unspecified.
- **`resumefailed`** (boolean, default: false): Resume execution from the last failed task when re-running Mini-A against a partially completed plan file.
- **`convertplan`** (boolean, default: false): Perform a one-off format conversion instead of running the agent. Requires `planfile=` (input) and `outputfile=` (target path) and preserves notes/execution history across Markdown/JSON.

#### Shell and File System Access
- **`useshell`** (boolean, default: false): Allow shell command execution
- **`shell`** (string): Prefix applied to every shell command (use with `useshell=true`)
- **`readwrite`** (boolean, default: false): Allow read/write operations on filesystem
- **`checkall`** (boolean, default: false): Ask for confirmation before executing any shell command
- **`shellallow`** (string): Comma-separated list of banned commands that should be explicitly allowed
- **`shellallowpipes`** (boolean, default: false): Allow pipes, redirection, and shell control operators in commands
- **`shellbanextra`** (string): Additional comma-separated commands to ban
- **`shellbatch`** (boolean, default: false): If true, runs in batch mode without prompting for command execution approval

#### MCP (Model Context Protocol) Integration
- **`mcp`** (string): MCP configuration in JSON format (single object or array for multiple connections)
- **`usetools`** (boolean, default: false): Register MCP tools directly on the model instead of expanding the system prompt with tool schemas
- **`mcpdynamic`** (boolean, default: false): When `usetools=true`, analyze the goal and only register the MCP tools that appear relevant, falling back to all tools if no clear match is found
- **`mcplazy`** (boolean, default: false): Defer MCP connection initialization until a tool is first executed; useful when configuring many optional integrations
- **`toolcachettl`** (number, optional): Override the default cache duration (milliseconds) for deterministic tool results when no per-tool metadata is provided

```javascript
// Single MCP connection
mcp: "(cmd: 'docker run --rm -i mcp/dockerhub')"

// Multiple MCP connections
mcp: "[ (cmd: 'docker run --rm -i mcp/dockerhub') | (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000) ]"
```

Tools advertise determinism via MCP metadata (e.g., `annotations.readOnlyHint`, `annotations.idempotentHint`, or explicit cache settings). When detected, Mini-A caches results keyed by tool name and parameters for the configured TTL, reusing outputs on subsequent steps to avoid redundant calls.

##### Dynamic MCP tool selection

Set `usetools=true mcpdynamic=true` when you want Mini-A to narrow the registered MCP tools to only those that look useful for the current goal. The agent evaluates the candidate list in stages:

1. **Keyword heuristics**: quick matching on tool names, descriptions, and goal keywords.
2. **Low-cost model inference**: if `OAF_LC_MODEL` is configured, the cheaper model proposes a shortlist.
3. **Primary model inference**: the main model performs the same selection when the low-cost tier does not return results.

If every stage returns an empty list (or errors), Mini-A logs the issue and falls back to registering the full tool catalog so nothing is accidentally hidden. Selection happens per MCP connection, and you will see `mcp` log entries showing which tools were registered. Leave `mcpdynamic` false when you prefer the traditional “register everything” behaviour or when your model lacks tool-calling support.

#### Knowledge and Context
- **`knowledge`** (string): Additional context or knowledge for the agent (can be text or file path)
- **`maxcontext`** (number): Approximate context budget in tokens; Mini-A auto-summarizes older history when the limit is exceeded
- **`rules`** (string): JSON/SLON array of additional numbered rules to append to the system prompt

#### Libraries and Extensions
- **`libs`** (string): Comma-separated list of additional OpenAF libraries to load
- **`useutils`** (boolean, default: false): Auto-register the Mini File Tool utilities as a dummy MCP server for quick file operations

#### Conversation Management
- **`conversation`** (string): Path to file for loading/saving conversation history
- **`state`** (object|string): Initial structured state (JSON/SLON) injected before the first step and persisted across turns

#### Mode Presets
- **`mode`** (string): Shortcut for loading a preset argument bundle from [`mini-a-modes.yaml`](mini-a-modes.yaml). Presets are merged before explicit flags, so command-line overrides always win. Bundled configurations include:
  - `shell` – Enables read-only shell access.
  - `shellrw` – Enables shell access with write permissions (`readwrite=true`).
  - `shellutils` – Adds the Mini File Tool helpers as an MCP (`useutils=true usetools=true`).
  - `chatbot` – Switches to conversational mode (`chatbotmode=true`).
  - `web` – Optimizes for the browser UI with MCP tools registered (`usetools=true`).
  - `webfull` – Turns on diagrams, charts, attachments, history retention, and planning for the web UI (`usetools=true usediagrams=true usecharts=true usehistory=true useattach=true historykeep=true useplanning=true`).

Extend or override these presets by editing the YAML file—Mini-A reloads it on each run.

#### Output Configuration
- **`outfile`** (string): Path to file where final answer will be written
- **`outputfile`** (string): When `convertplan=true`, path for the converted plan artifact (format inferred from extension)
- **`__format`** (string): Output format (e.g. "json", "md", ...)

#### Audit Logging
- **`auditch`** (string): JSSLON definition for the OpenAF channel that stores Mini-A interaction events. When supplied, each call to `fnI` is persisted under the `_mini_a_audit_channel` key. Example for a file-backed log: `auditch="(type: 'file', options: (file: 'audit.json'))"`. Channel types and options follow the OpenAF channel conventions documented in `github.com/openaf/docs/openaf.md` and `github.com/openaf/docs/llm-guide.md`; keep the structure compatible with `$ch().create(type, options)`.

#### Rate Limiting
- **`rtm`** (number): Rate limit in calls per minute

## Chatbot Mode

Set `chatbotmode=true` when you want Mini-A to behave like a straightforward conversational assistant instead of a structured agent. In this mode the runtime swaps in the dedicated chatbot system prompt, omits the agent-style tool instructions, and keeps responses aligned with natural dialogue while still allowing MCP tools, shell access, and other options you enable.

CLI example:

```bash
ojob mini-a.yaml goal="brainstorm three lunch ideas" chatbotmode=true
```

Library example:

```javascript
var mini = new MiniA()
mini.start({ goal: "Draft a friendly release note", chatbotmode: true })
```

Switching back to the default agent mode is as simple as omitting the flag (or setting it to `false`).

## Planning Workflow

Enable `useplanning=true` (while keeping `chatbotmode=false`) whenever you want Mini-A to surface a live task plan that evolves with the session. The agent classifies the goal up front—trivial and easy goals automatically disable planning, moderate goals receive a short linear checklist, and complex goals trigger a nested “tree” plan with checkpoints. Provide `planfile=plan.md` (or `.json`) to reuse a pre-generated plan; Mini-A keeps task checkboxes in sync as execution progresses.

Use `planmode=true` when you only need Mini-A to design the plan. The runtime gathers context using the low-cost model (when available), asks the primary model for the final structured plan, writes the result to `planfile` (if supplied), prints it, and exits.

### What the plan contains

- **Structured steps**: Each entry includes a human-readable title, status (`pending`, `in_progress`, `done`, `blocked`, etc.), and progress percentage. Complex goals nest subtasks under parent steps.
- **Checkpoints**: Selected steps are stamped as checkpoints so Mini-A can call out major milestones and roll them into the progress bar.
- **Feasibility annotations**: Steps that require shell access or MCP tools are pre-marked; if the required capability is disabled, the status flips to `blocked` with an explanatory note.
- **State integration**: The entire plan lives under `state.plan`, making it available to downstream automation or custom UI extensions. Metadata like `state.plan.meta.needsReplan` and `state.plan.meta.validation` highlight when the model should adjust the plan.

### Runtime behaviour

- **Logging & UI**: Every time the plan changes, Mini-A emits a 🗺️ log entry summarizing the checklist and overall progress. The web UI mirrors this with an expandable plan card.
- **External plan syncing**: When executing an imported plan (`planfile=`), Mini-A updates the source file in place—`- [ ]` becomes `- [x]` in Markdown and `"completed": true` in JSON—so follow-up runs or other agents can continue where the last session stopped. Notes and execution history persist at the bottom of the file.
- **Resume support**: Run again with `resumefailed=true` to focus on the last failed task instead of replaying earlier steps. This is especially useful when the previous run halted mid-phase.
- **Automatic replanning**: When a step fails repeatedly, the runtime marks it as `blocked`, increments planning metrics, and sets `needsReplan=true` so the model knows to rethink the approach.
- **Metrics**: Counters such as `plans_generated`, `plans_validated`, and `plans_replanned` surface via `MiniA.getMetrics()` to help monitor how often plans are created or adjusted.

### Examples

```bash
ojob mini-a.yaml goal="Audit the repo and prepare upgrade notes" useshell=true useplanning=true
```

```javascript
var agent = new MiniA()
agent.start({
    goal       : "Refactor the project scaffold and document the steps",
    useshell   : true,
    useplanning: true
})
```

## Examples

### 1. Basic File Analysis

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Analyze the current directory structure and provide a summary",
    useshell: true
})
```

### 2. Code Analysis with Knowledge

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Review the JavaScript code in this project and suggest improvements",
    knowledge: "This is a Node.js project that processes data files",
    useshell: true,
    maxsteps: 30
})
```

### 3. Using MCP Tools

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Get the current weather for New York City",
    mcp: "(cmd: 'ojob weather-mcp-server.yaml')",
    maxsteps: 10
})
```

### 3.1 Using the mcp-ssh MCP

The `mcp-ssh` MCP exposes SSH execution tools (`shell-exec` and `shell-batch`) that Mini-A can use as an MCP connection. Example usage:

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Run 'uptime' on a remote host and return output",
    mcp: "(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false')",
    maxsteps: 5
})

log(result)
```

When using a remote HTTP MCP server (hosted by `mcp-ssh`), point the `mcp` config to the remote URL, for example:

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Run multiple simple commands on a remote host",
    mcp: "(type: remote, url: 'http://localhost:8888/mcp')",
    maxsteps: 10
})
```

Be aware of the security defaults: `mcp-ssh` is read-only by default and enforces a banned-commands policy. Use `readwrite=true` cautiously and adjust filtering with `shellallow`, `shellbanextra`, or `shellallowpipes` only when you understand the risks.

### 3.2 Registering MCP tools on the model

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Pull the latest Docker image metadata",
    mcp: "(cmd: 'docker run --rm -i mcp/dockerhub')",
    usetools: true,   // Ask the LLM to invoke MCP tools directly via the tool interface
    maxsteps: 8
})
```

Setting `usetools: true` registers the MCP tool schemas directly with the model so the prompt stays compact. Leave it `false` when a model lacks tool support or you'd rather expose schemas via the system prompt.

### 4. File System Operations

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Create a backup of all .js files in the src directory",
    useshell: true,
    readwrite: true,
    checkall: true  // Ask before each command
})
```

### 5. Saving Results to File

```javascript
var agent = new MiniA()
agent.start({
    goal: "Generate a project documentation outline",
    outfile: "project-outline.md",
    maxsteps: 20
})
```

### 6. Loading Additional Libraries

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Process CSV data and generate statistics",
    libs: "custom.js,aws.js",
    useshell: true
})
```

### 6.1 Seeding Agent State

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Track the status of remediation tasks",
    state: { backlog: [], completed: [] },
    useshell: true
})
```

The `state` object (or JSON string) is cloned into the agent before the first step and persists across every iteration, so you can pre-populate checklists, counters, or in-memory caches that the agent should maintain.

### 7. Dual-Model Configuration Examples

#### Cost-Optimized Setup with OpenAI Models

```bash
# Terminal setup
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
```

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Analyze this codebase and suggest improvements",
    useshell: true,
    maxsteps: 30
})
// Will use gpt-4 for initial analysis, gpt-3.5-turbo for routine operations
```

#### Mixed Provider Setup

```bash
# High-end model for main reasoning
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-openai-key')"
# Local model for cost-effective operations  
export OAF_LC_MODEL="(type: ollama, model: 'llama3', url: 'http://localhost:11434')"
```

#### Google Gemini Dual Setup

```bash
export OAF_MODEL="(type: gemini, model: gemini-1.5-pro, key: 'your-gemini-key')"
export OAF_LC_MODEL="(type: gemini, model: gemini-1.5-flash, key: 'your-gemini-key')"
```

**Log Output Examples:**

When using dual-model configuration, you'll see clear indicators of which model is being used:

```
ℹ️  Using model: gpt-4 (openai)
🌀  Context summarized using low-cost model. Summary: 15 tokens generated
⚠️  Escalating to main model: 2 consecutive errors
ℹ️  Interacting with main model (context ~1250 tokens)...
ℹ️  Main model responded. Usage: 1250 tokens prompted, 45 tokens generated
ℹ️  Interacting with low-cost model (context ~890 tokens)...
ℹ️  Low-cost model responded. Usage: 890 tokens prompted, 23 tokens generated
⚠️  Low-cost model produced invalid JSON, retrying with main model...
```

## Event Handling

Mini-A provides events during execution that you can handle with a custom interaction function:

```javascript
var agent = new MiniA()

// Set custom event handler
agent.setInteractionFn(function(event, message) {
    log(`[${event.toUpperCase()}] ${message}`)
})

agent.start({
    goal: "Your goal here"
})
```

### Event Types

- **`user`**: User input or goal
- **`exec`**: Action execution
- **`shell`**: Shell command execution
- **`think`**: Agent thinking/reasoning
- **`final`**: Final answer provided
- **`input`**: Input to LLM
- **`output`**: Output from LLM
- **`thought`**: Agent's thought process
- **`size`**: Context size information
- **`rate`**: Rate limiting information
- **`mcp`**: MCP-related events
- **`done`**: Task completion
- **`error`**: Error occurred
- **`libs`**: Library loading
- **`info`**: General information
- **`load`**: File loading
- **`warn`**: Warning messages
- **`stop`**: Agent stopped
- **`summarize`**: Context summarization

## Security Considerations

Mini-A includes built-in security measures:

### Banned Commands
The following commands are restricted by default:
- File system: `rm`, `mv`, `cp`, `chmod`, `chown`
- Network: `curl`, `wget`, `ssh`, `scp`
- System: `sudo`, `shutdown`, `reboot`
- Package managers: `apt`, `yum`, `brew`, `npm`, `pip`
- Containers: `docker`, `podman`, `kubectl`

You can adjust this policy using the shell safety options:

- Use **`shellallow`** to explicitly allow specific commands even if banned by default
- Use **`shellbanextra`** to add additional commands to the banned list
- Use **`shellallowpipes`** to permit pipes, redirection, and other shell control operators

### Safety Features
- Interactive confirmation for potentially dangerous commands
- Read-only mode by default
- Shell access disabled by default
- Command validation and filtering

### Shell Prefix Strategies by Operating System

Use `shell=...` together with `useshell=true` when you want Mini-A to execute every command through an external sandbox or container runtime. The command filter continues to evaluate the original command string, and the prefix is appended immediately before execution.

#### macOS (sandbox-exec)
- **Use the built-in restriction flags when:** you only need to block specific binaries (e.g. combine `shellallow`, `shellbanextra`, `shellallowpipes`, and `checkall=true`). This keeps commands on the host without additional tooling.
- **Use `shell=` when:** you want the macOS sandbox to enforce file/network rules defined in a `.sb` profile.
- **Pros:** native isolation, no additional daemons required, works on Intel and Apple Silicon.
- **Cons:** sandbox profiles can be verbose; access to developer tools may require profile tweaks.
- **Example:**
  ```bash
  ./mini-a.sh goal="catalog ~/Projects" useshell=true \
    shell="sandbox-exec -f /usr/share/sandbox/default.sb"
  ```

#### macOS Sequoia (container CLI)
- **Use the restriction flags when:** you trust the host environment and just need confirmation prompts or per-command allowlists.
- **Use `shell=` when:** you prefer to run the agent inside an isolated macOS container started with Apple's `container` CLI.
- **Pros:** lightweight sandbox with full POSIX tooling, easy to reuse across sessions (`container exec`).
- **Cons:** requires macOS 15+ and the Container feature, container lifecycle must be managed separately.
- **Example:**
  ```bash
  container run --detach --name mini-a --image docker.io/library/ubuntu:24.04 sleep infinity
  ./mini-a.sh goal="inspect /work" useshell=true shell="container exec mini-a"
  ```

#### Linux / macOS / Windows WSL (Docker)
- **Use the restriction flags when:** you are confident with host-level execution but still want Mini-A to stop on risky commands.
- **Use `shell=` when:** you want every command to run inside a long-lived Docker container (ideal for destructive or dependency-heavy workloads).
- **Pros:** mature isolation, bind mounts for controlled file access, easy to snapshot/destroy containers.
- **Cons:** Docker daemon required; manage image updates separately; host files must be mounted explicitly.
- **Example:**
  ```bash
  docker run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
  ./mini-a.sh goal="summarize git status" useshell=true shell="docker exec mini-a-sandbox"
  ```

#### Linux / macOS / Windows WSL (Podman)
- **Use the restriction flags when:** rootless execution plus Mini-A's confirmation prompts are sufficient.
- **Use `shell=` when:** you prefer Podman's daemonless containers or want rootless isolation without Docker.
- **Pros:** rootless-friendly, integrates with systemd socket activation, shares the Docker CLI syntax.
- **Cons:** rootless volumes may need additional SELinux/AppArmor policy; ensure the container stays running.
- **Example:**
  ```bash
  podman run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work docker.io/library/fedora:latest sleep infinity
  ./mini-a.sh goal="list source files" useshell=true shell="podman exec mini-a-sandbox"
  ```

> **Tip:** Mix and match strategies. You can still require confirmations (`checkall=true`) or tweak allowlists (`shellallow=...`) even when commands are routed through Docker, Podman, or sandbox-exec.

## Advanced Features

### Conversation Persistence

```javascript
var agent = new MiniA()
agent.start({
    goal: "Continue our previous discussion about code optimization",
    conversation: "chat-history.json"
})
```

### Context Management

```javascript
var agent = new MiniA()
agent.start({
    goal: "Analyze large codebase",
    maxcontext: 8000,  // Auto-summarize when the working context exceeds ~8k tokens
    maxsteps: 50
})
```

### Custom Rules and Guardrails

Provide extra numbered rules to the system prompt using the `rules` parameter. Supply them as a JSON or SLON array so they are injected verbatim.

```javascript
var agent = new MiniA()
agent.start({
    goal: "Review generated SQL queries",
    rules: "[ 'Never run destructive DDL statements', 'Use markdown tables for final summaries' ]"
})
```

### Rate Limited Usage

```javascript
var agent = new MiniA()
agent.start({
    goal: "Process multiple API requests",
    rtm: 30,  // Limit to 30 LLM calls per minute
    mcp: "(cmd: 'ojob api-server.yaml')"
})
```

## Return Values

Mini-A returns different types of values based on configuration:

- **Default**: Formatted markdown output
- **`raw: true`**: Raw string response
- **`__format: "json"`**: Parsed JSON object (if response is valid JSON)
- **`outfile` specified**: Writes to file and returns nothing

## Error Handling

Mini-A includes robust error handling:

- Invalid JSON responses from LLM are logged and skipped
- Missing required fields trigger error observations
- Command execution failures are captured and reported
- MCP connection failures are caught and logged

## Best Practices

1. **Start Simple**: Begin with basic goals and gradually add complexity
2. **Use Knowledge**: Provide relevant context to improve results
3. **Set Appropriate Limits**: Use `maxsteps` to cap consecutive no-progress iterations
4. **Enable Safety**: Use `checkall: true` for file system operations
5. **Monitor Progress**: Use custom interaction functions for better visibility
6. **Save Conversations**: Use conversation persistence for complex multi-step tasks
7. **Rate Limit**: Use `rtm` parameter when working with API-limited LLM services

### Dual-Model Best Practices

8. **Choose Complementary Models**: Use a high-capability model (e.g., GPT-4) as main and a fast, cost-effective model (e.g., GPT-3.5-turbo) as low-cost
9. **Monitor Escalations**: Watch for frequent escalations which may indicate the low-cost model is under-powered for your tasks
10. **Test Both Models**: Verify both models work independently before using dual-mode
11. **Provider Consistency**: Consider using the same provider for both models to avoid authentication complexity
12. **Cost Tracking**: Monitor actual cost savings by reviewing which model handles each operation

## Troubleshooting

### Common Issues

1. **OAF_MODEL not set**: Ensure environment variable is properly configured
2. **MCP connection fails**: Verify MCP server is running and accessible
3. **Commands blocked**: Check if commands are in banned list or enable `readwrite`
4. **Context too large**: Use `maxcontext` parameter to enable auto-summarization
5. **Goal not achieved**: Increase `maxsteps` if the agent stops after repeated no-progress steps, or refine the goal description

### Dual-Model Specific Issues

6. **OAF_LC_MODEL format error**: Ensure low-cost model configuration uses same format as OAF_MODEL
7. **Frequent escalations**: If main model is used too often, check low-cost model capabilities
8. **Invalid JSON from low-cost model**: This triggers automatic fallback - consider using a more capable low-cost model
9. **Cost not optimized**: Verify OAF_LC_MODEL is set and both models are properly configured

**Example of properly formatted dual-model setup:**
```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'sk-...')"
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'sk-...')"
```

### Debug Mode

Enable debug mode to see detailed interaction:

```javascript
agent.start({
    goal: "Your goal",
    debug: true,
    verbose: true
})
```

This will show:
- System prompts
- Model inputs/outputs
- Step-by-step execution
- Tool responses
- Context management decisions (including automatic summarization)

## Metrics and Observability

Mini-A records extensive counters that help track behaviour and costs:

- Call `agent.getMetrics()` to obtain a snapshot grouped by LLM usage, outcomes, shell approvals/denials, context management, and summarization activity.
- OpenAF automatically registers these counters under the `mini-a` namespace via `ow.metrics.add('mini-a', ...)`, so collectors that understand OpenAF metrics can scrape them.
- Metrics are updated live as the agent progresses, making them ideal for dashboards or alerting when an agent gets stuck.

### Metric breakdown

`MiniA.getMetrics()` returns a nested object. Each top-level key contains the counters listed below.

| Path | Counters | Description |
|------|----------|-------------|
| `llm_calls` | `normal`, `low_cost`, `total`, `fallback_to_main` | Request volume per model tier and how often the session escalated back to the main model after low-cost failures. |
| `goals` | `achieved`, `failed`, `stopped` | High-level result of the current run. |
| `actions` | `thoughts_made`, `thinks_made`, `finals_made`, `mcp_actions_executed`, `mcp_actions_failed`, `shell_commands_executed`, `shell_commands_blocked`, `shell_commands_approved`, `shell_commands_denied`, `unknown_actions` | Operational footprint: mental steps, final responses, MCP usage, and shell gatekeeping outcomes. |
| `planning` | `disabled_simple_goal`, `plans_generated`, `plans_validated`, `plans_validation_failed`, `plans_replanned` | Visibility into the planning engine—when it was bypassed, generated plans, validation passes/failures, and replans triggered by runtime feedback. |
| `performance` | `steps_taken`, `total_session_time_ms`, `avg_step_time_ms`, `max_context_tokens`, `llm_estimated_tokens`, `llm_actual_tokens`, `llm_normal_tokens`, `llm_lc_tokens` | Execution pacing and token consumption for cost analysis. |
| `behavior_patterns` | `escalations`, `retries`, `consecutive_errors`, `consecutive_thoughts`, `json_parse_failures`, `action_loops_detected`, `thinking_loops_detected`, `similar_thoughts_detected` | Signals that highlight unhealthy loops or parser problems. |
| `summarization` | `summaries_made`, `summaries_skipped`, `summaries_forced`, `context_summarizations`, `summaries_tokens_reduced`, `summaries_original_tokens`, `summaries_final_tokens` | Auto-summarization activity and token savings. |

These counters mirror what is exported via `ow.metrics.add('mini-a', ...)`, so the same structure appears in Prometheus/Grafana when scraped through OpenAF.

Example:

```javascript
var agent = new MiniA()
agent.start({ goal: "List files", useshell: true })
log(agent.getMetrics())
```

To poll the OpenAF registry directly, use `ow.metrics.get("mini-a")` from another job or expose it through your usual monitoring bridge.
