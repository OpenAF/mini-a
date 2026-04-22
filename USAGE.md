# Mini-A Usage Guide

Mini-A (Mini Agent) is a goal-oriented autonomous agent that uses Large Language Models (LLMs) and various tools to achieve specified goals. It can execute shell commands, interact with Model Context Protocol (MCP) servers, and work step-by-step towards completing objectives.

> **💡 New to Mini-A?** Check out [docs/OPTIMIZATIONS.md](docs/OPTIMIZATIONS.md) to learn about built-in performance features that automatically reduce token usage by 40-60% and costs by 50-70%.

## Prerequisites

- **OpenAF**: Mini-A is built for the OpenAF platform
- **OAF_MODEL Environment Variable**: Must be set to your desired LLM model configuration
- **OAF_LC_MODEL Environment Variable** (optional): Low-cost model for cost optimization
- **OAF_VAL_MODEL Environment Variable** (optional): Dedicated model for deep research validation
- **OAF_MINI_A_CON_HIST_SIZE Environment Variable** (optional): Set the maximum console history size (default is JLine's default)
- **OAF_MINI_A_LIBS Environment Variable** (optional): Comma-separated list of libraries to load automatically
- **OAF_MINI_A_NOJSONPROMPT Environment Variable** (optional): Disable promptJSONWithStats and force promptWithStats for the main model (default: false). For Gemini main models, Mini-A now auto-enables this behavior when the variable is unset.
- **OAF_MINI_A_LCNOJSONPROMPT Environment Variable** (optional): Disable promptJSONWithStats and force promptWithStats for the low-cost model (default: false). Required for Gemini low-cost models. Allows different settings for main and low-cost models (e.g., Gemini low-cost with Claude main)

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
# Optional: Set a low-cost model for routine operations
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: 'your-api-key')"
# Optional: Set a dedicated validation model for deep research scoring
export OAF_VAL_MODEL="(type: openai, model: gpt-4o-mini, key: 'your-api-key')"
# Optional: Set console history size
export OAF_MINI_A_CON_HIST_SIZE=1000
# Optional: Set libraries to load automatically
export OAF_MINI_A_LIBS="@AWS/aws.js,custom.js"
# Optional: Disable JSON prompt methods (Gemini main models auto-enable this when unset)
export OAF_MINI_A_NOJSONPROMPT=true
# Optional: Disable JSON prompt methods for low-cost model (required for Gemini low-cost model)
export OAF_MINI_A_LCNOJSONPROMPT=true
```

## Command-Line Execution

Mini-A now ships with an interactive console so you can start the agent directly from the installed oPack:

- `opack exec mini-a` — launches the console; append arguments such as `goal="summarize the logs" useshell=true`, or type the goal at the prompt.
- `mini-a goal="summarize the logs" useshell=true` — same console when you add the optional alias printed after installation.
- `mini-a exec="/my-command repo-a --fast"` — executes one custom slash command/skill template non-interactively and exits (different from `goal=...`).
- `./mini-a.sh goal="summarize the logs" useshell=true` — wrapper script when running from a cloned repository.
- `ojob mini-a.yaml goal="summarize the logs" useshell=true` — direct invocation of the oJob definition.
- `ojob mini-a-web.yaml onport=8888` — launches the HTTP server that powers the browser UI found in `public/`.

All command-line flags documented below work with the console (`opack exec mini-a` / `mini-a`) as well as `mini-a.sh` and `mini-a.yaml`.

Need a quick reference of every option? Run `mini-a -h` (or `mini-a --help`) to print the colorized console help followed by a table of shared Mini-A arguments sourced directly from `mini-a.js`. That listing mirrors the parameter catalog below, so it is always up to date with the agent’s runtime defaults.

Need starter files quickly? Use the built-in template printers:

- `mini-a --agent` — print a starter agent profile markdown file
- `mini-a --skill` — print a starter skill markdown template
- `mini-a --skills` — print a starter self-contained skill YAML template
- `mini-a --command` — print a starter slash-command markdown template
- `mini-a --hook` — print a starter hook YAML template

Inside the console, use slash commands for quick configuration checks. `/show` prints every parameter, and `/show plan` (for example) narrows the list to options whose names start with `plan`. Use `/skills [prefix]` to list discovered skills and optionally filter by skill name prefix.

Custom slash commands are supported through markdown templates in `~/.openaf-mini-a/commands/`. Typing `/<name> ...args...` looks for `~/.openaf-mini-a/commands/<name>.md`, renders placeholders, and submits the result as the goal text.

To print a starter command template instead of writing one from scratch, run:

```bash
mini-a --command
```

To load commands from additional directories, pass `extracommands=<path1>,<path2>`. Commands in the default directory always win on name conflicts; among extra directories, earlier entries take precedence:

```bash
mini-a extracommands=/path/to/team-commands,/path/to/project-commands
```

Skill slash templates support both formats in `~/.openaf-mini-a/skills/`:
- Claude Code-style folder skills: `~/.openaf-mini-a/skills/<name>/SKILL.md`
- Legacy single-file skills: `~/.openaf-mini-a/skills/<name>.md`
- Folders whose names end with `.disabled` are ignored during skill discovery

To print a starter skill template, run:

```bash
mini-a --skill          # markdown format (SKILL.md)
mini-a --skills         # self-contained YAML format (SKILL.yaml)
```

For a full guide to the YAML skill format including schema reference, `refs` styles, `@`-reference resolution, and migration from `SKILL.md`, see **[docs/SKILLS-YAML-FORMAT.md](docs/SKILLS-YAML-FORMAT.md)**.

Both are invoked with `/<name> ...args...`, and skills also support `$<name> ...args...`. If both directories define the same slash name, the skill template in `~/.openaf-mini-a/skills/` takes precedence over `~/.openaf-mini-a/commands/`.

To load skills from additional directories, pass `extraskills=<path1>,<path2>`. The default skills directory wins on name conflicts. When `useutils=true useskills=true`, the extra paths are also forwarded to the MiniUtilsTool skills operation:

```bash
mini-a extraskills=/path/to/shared-skills,/path/to/project-skills
```

To invoke one template directly from the command line (without entering the console), use `exec=`:

```bash
mini-a exec="/my-command repo-a --fast \"include docs\""
```

`exec=` is not the same as `goal=`:
- `goal=` sends your text directly as the user goal.
- `exec=` resolves and renders a slash command/skill template first, then runs the rendered goal with normal hook integration.

Supported placeholders inside each template:
- `{{args}}` → raw argument string
- `{{argv}}` → parsed argument array as JSON
- `{{argc}}` → argument count
- `{{arg1}}`, `{{arg2}}`, ... → positional arguments

Example template file `~/.openaf-mini-a/commands/my-command.md`:

```markdown
Follow these instructions exactly.

Primary target: {{arg1}}
Extra flags: {{args}}
Parsed list: {{argv}}
```

Then run:

```bash
mini-a ➤ /my-command repo-a --fast "include docs"
```

Notes:
- Built-in commands take precedence, so custom files cannot override `/help`, `/show`, etc.
- If a referenced command file is missing or unreadable, Mini-A reports a hard error and does not execute a goal.
- Discovered command and skill templates appear in `/help` and Tab completion.
- Skill packs downloaded from catalogs such as `skillsmp.com` can be copied directly as folders under `~/.openaf-mini-a/skills/` as long as each skill folder contains `SKILL.md` (or `skill.md`).
- Append `.disabled` to a skill folder name to keep it installed but excluded from discovery (for example `reviewer.disabled/`).
- Alternative self-contained skill formats are supported via `SKILL.yaml|yml|json` (metadata, `body` markdown, and embedded refs/children), alongside existing markdown skill templates.
- Skill templates resolve relative `@file.md` attachment paths against the skill folder, and relative markdown links to `.md` files are auto-inlined as additional reference content.

### Console Hooks (`~/.openaf-mini-a/hooks`)

The console can run local hooks before/after goals, tool calls, and shell commands. Hook definitions are loaded from `~/.openaf-mini-a/hooks/*.yaml`, `*.yml`, or `*.json`.

To print a starter hook definition, run:

```bash
mini-a --hook
```

To load hooks from additional directories, pass `extrahooks=<path1>,<path2>`. Hooks from all directories are merged additively — every matching hook fires regardless of which directory it came from:

```bash
mini-a extrahooks=/path/to/team-hooks,/path/to/project-hooks
```

Supported `event` values:
- `before_goal`
- `after_goal`
- `before_tool`
- `after_tool`
- `before_shell`
- `after_shell`

Hook fields:
- `event` (required): Hook event name.
- `command` (required): Local shell command to execute.
- `toolFilter` (optional): Comma-separated tool names (applies only to tool events).
- `injectOutput` (optional, default `false`): Include hook `stdout` in agent context (currently consumed by `before_goal` and `before_tool`).
- `timeout` (optional, default `5000`): Hook command timeout in milliseconds.
- `failBlocks` (optional, default `false`): Block the associated action when the hook exits non-zero or fails.
- `env` (optional): Static environment variables merged with runtime hook variables.

Runtime variables exposed to hooks include:
- `MINI_A_HOOK_NAME`, `MINI_A_HOOK_EVENT`
- `MINI_A_GOAL`, `MINI_A_RESULT`
- `MINI_A_TOOL`, `MINI_A_TOOL_PARAMS`, `MINI_A_TOOL_RESULT`
- `MINI_A_SHELL_COMMAND`, `MINI_A_SHELL_OUTPUT`

Example `~/.openaf-mini-a/hooks/block-dangerous-shell.yaml`:

```yaml
event: before_shell
command: "echo \"$MINI_A_SHELL_COMMAND\" | grep -E '(rm -rf|mkfs|dd if=)' >/dev/null && exit 1 || exit 0"
timeout: 1500
failBlocks: true
```

Example `kubectl-readonly.yaml` — restricts the agent to read-only `kubectl` subcommands only:

```yaml
name: kubectl-readonly
event: before_shell
failBlocks: true
injectOutput: false
timeout: 3000
command: |
  bash -c '
    cmd="$MINI_A_SHELL_COMMAND"
    if ! echo "$cmd" | grep -qE "(^|[|;&[:space:]])kubectl([[:space:]]|$)"; then
      exit 0
    fi
    subcmd=$(echo "$cmd" | grep -oP "kubectl\s+\K\S+")
    readonly_cmds="get describe logs explain top version api-resources api-versions cluster-info diff"
    for allowed in $readonly_cmds; do
      [ "$subcmd" = "$allowed" ] && exit 0
    done
    echo "BLOCKED: kubectl \"$subcmd\" is not a read-only command" >&2
    exit 1
  '
```

This hook fires on every shell command. It exits 0 (allow) if `kubectl` is not present, or if the subcommand is in the read-only allowlist (`get`, `describe`, `logs`, `explain`, `top`, `version`, `api-resources`, `api-versions`, `cluster-info`, `diff`). Any other subcommand (`apply`, `delete`, `exec`, `rollout`, etc.) causes it to exit 1 and block execution.

To use this hook from a custom directory without placing it in `~/.openaf-mini-a/hooks/`, launch mini-a with `extrahooks`:

```bash
mini-a extrahooks=/path/to/my-hooks
```

Or combine with other hook directories:

```bash
mini-a extrahooks=/path/to/my-hooks,/path/to/team-hooks
```

Where `/path/to/my-hooks/kubectl-readonly.yaml` contains the definition above. Hooks from all directories are merged — the kubectl guard fires alongside any other hooks already loaded from `~/.openaf-mini-a/hooks/`.

For conversation management, two history compaction commands mirror the behavior implemented in [`mini-a-con.js`](mini-a-con.js):

- `/compact [n]` — Summarizes older user/assistant messages into a single "Context summary" entry while preserving up to the last `n` exchanges (defaults to 6). System and developer instructions stay untouched. When enough history exists, Mini-A always leaves at least one older entry eligible for summarization. Use this when you want to reclaim tokens but keep the high-level context available to the agent.
- `/summarize [n]` — Requires an active agent session. It asks the model for a detailed recap of the earlier conversation, replaces that portion of the history with the generated summary, prints confirmation in the console, and then keeps up to the most recent `n` messages appended to the summary (also defaults to 6). When enough history exists, Mini-A always leaves at least one older entry eligible for summarization. Choose this when you want a human-readable digest before moving on.

To view conversation token usage:

- `/context` — Displays a visual breakdown of token usage across different message types (System, User, Assistant, Tool, Other) using internal token estimation or actual API statistics when available.
- `/context llm` or `/context analyze` — Requires an active agent session. Asks the LLM (preferring the low-cost model if configured) to analyze the conversation and provide accurate token counts by category. This provides more precise token breakdowns than internal estimates, especially useful for understanding actual model token consumption.
- `/stats memory` — Displays working-memory statistics for the current console session when `usememory=true`, including resolved/session/global entry totals, activity counters, and per-section counts across `facts`, `evidence`, `openQuestions`, `hypotheses`, `decisions`, `artifacts`, `risks`, and `summaries`.
- `/stats detailed memory` — Prints the regular detailed metrics tree plus the focused memory tables. Add `out=<file.json>` to save the exported data.

Need to revisit or store the most recent response? `/last [md]` reprints the previous final answer so you can copy it (add `md` to emit the raw Markdown instead of the formatted view), and `/save <path>` writes that answer straight to a file. When providing a path, press <kbd>Tab</kbd> to leverage the console's new filesystem auto-completion for slash commands.

Need to inspect available skills quickly? `/skills` prints all discovered skills (name, type, description, and source file), and `/skills <prefix>` filters the list.

### Attaching Files in the Console

The console supports inline file attachments using the `@path/to/file` syntax. When you include file references in your goal, Mini-A automatically reads and includes the file contents as part of the submitted goal.

**Features:**
- Attach multiple files in a single goal: `@file1.md @file2.json`
- Embed file references within sentences: `Follow these instructions @docs/guide.md and also check @config/settings.json`
- Files are wrapped with clear delimiters showing the file path
- Non-existent or unreadable files produce error messages without blocking the goal
- Escape literal mentions with `\@token` when you do not want Mini-A to treat them as attachments
- Escape leading skill-like tokens with `\$token` when you want literal text instead of `$skill` invocation

**Examples:**

```bash
# Single file attachment
mini-a ➤ Review the code in @src/main.js and suggest improvements

# Multiple files
mini-a ➤ Compare @config/dev.json with @config/prod.json

# Files embedded in natural language
mini-a ➤ I need you to follow these instructions @docs/guidelines.md and then apply the rules from @policies/standards.md to create a new feature
```

Each attached file is displayed with a `📎 Attached: <filepath>` confirmation message, and the file contents are formatted as:

```
--- Content from <filepath> ---
<file contents>
--- End of <filepath> ---
```

## Model Configuration

### Single Model Setup

For basic usage, only set the main model:

```bash
export OAF_MODEL="(type: openai, model: gpt-4, key: 'your-api-key')"
```

### Recommended Model Tiers

- **All uses (best)**: Claude Sonnet 4.5, OpenAI GPT-5, Google Gemini 2.5, OpenAI OSS 120B
- **Low cost (best)**: OpenAI GPT-5 mini, Amazon Nova Pro/Mini, OpenAI OSS 20B
- **Simple agent shell tool**: Gemma 3, Phi 4
- **Chatbot**: Mistral 7B, Llama 3.2 8B

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
| Initial planning (Step 0, simple goals) | Low-Cost Model | Simple goals don't require heavy reasoning on step 0 |
| Initial planning (Step 0, medium/complex goals) | Main Model | Complex goals need best reasoning from the start |
| Routine operations | Low-Cost Model | Cost-effective for simple tasks |
| Context summarization | Low-Cost Model | Simple text condensation task |
| Error recovery | Main Model | After 2+ consecutive errors |
| Complex reasoning | Main Model | When thinking loops or stuck patterns detected |
| Invalid JSON fallback | Main Model | When low-cost model produces invalid responses |
| Context window overflow | Main Model | When context exceeds `lccontextlimit` (if set) |
| After sustained recovery | Low-Cost Model | De-escalates automatically after `deescalate` clean steps |

**Smart Escalation Triggers:**
- Context token count ≥ `lccontextlimit` (when set via `lccontextlimit=N`)
- 2+ consecutive errors
- 3+ consecutive thoughts without action
- 5+ total thoughts (thinking loop detection)
- 4+ steps without meaningful progress
- Repeating similar thoughts detected

**Automatic De-escalation:**
After escalating to the main model, Mini-A tracks successful steps. Once `deescalate` consecutive clean steps are completed (default: 3), it automatically reverts to the low-cost model. Override with `deescalate=N`.

### Managing Model Definitions Interactively

Use the built-in model manager whenever you want to securely store multiple
LLM definitions and load them on demand:

```bash
mini-a modelman=true
```

Key capabilities:

- **Encrypted storage** — Definitions are saved under the `mini-a/models`
  secure store, optionally protected with a password.
- **Provider-aware prompts** — The manager understands the specific fields
  required by OpenAI, Gemini, Anthropic, Ollama, and Bedrock and guides you
  through the setup.
- **Reusable exports** — After selecting a saved definition, the manager
  prints ready-to-copy `export OAF_MODEL="..."` and `export OAF_LC_MODEL="..."`
  commands.
- **Quick sharing** — Use the dedicated **Export definition** action to print
  the encrypted definition's SLON/JSON payload for backup or transfer.
- **Import/rename/delete** — Quickly migrate existing definitions, update
  their names, or prune unused entries.

The flag works with `opack exec mini-a`, the optional `mini-a` alias, and all
oJob wrappers (for example `ojob mini-a.yaml modelman=true`).

### Managing Working Memory Interactively

Use the memory manager TUI to inspect and maintain session/global memory
stores configured with `usememory`, `memorych`, and `memorysessionch`:

```bash
mini-a memoryman=true usememory=true memoryuser=true
```

You can also point directly to existing channels:

```bash
mini-a memoryman=true usememory=true \
  memorych=\"{type:'file',options:{file:'/tmp/mini-a-global.json'}}\" \
  memorysessionch=\"{type:'file',options:{file:'/tmp/mini-a-session.json'}}\" \
  memorysessionid=\"demo-session\"
```

Key capabilities:

- **Dual-scope visibility** — inspect both `global` and `session` stores with
  per-section counts, stale totals, unresolved totals, and revision metadata.
- **List + inspect workflow** — filter by section/stale/unresolved, then open
  full entry payloads (including provenance/meta/evidence refs).
- **Selective delete** — remove individual entries by `section/id`.
- **Age-based pruning** — delete entries older than a relative time (`30d`,
  `12h`, `90m`) or absolute timestamp (ISO date/epoch).
- **Operational helpers** — keyword search, compaction, stale sweep, full
  snapshot export, and optional full-store clear with confirmation.

## Mode Presets

Mini-A ships with reusable argument bundles so you can switch behaviors without remembering every flag. Pass `mode=<name>` with `opack exec mini-a`, `mini-a`, `mini-a.sh`, `mini-a.yaml`, or `mini-a-main.yaml` and the runtime will merge the corresponding preset from [`mini-a-modes.yaml`](mini-a-modes.yaml) and optionally from `~/.openaf-mini-a_modes.yaml` and `~/.openaf-mini-a/modes.yaml` (custom modes override built-in ones, and `~/.openaf-mini-a/modes.yaml` overrides the legacy file when both exist) before applying any explicit flags you provide on the command line.

Set `OAF_MINI_A_MODE=<name>` to pick a default preset when you do not supply `mode=` on the command line (helpful when using the `mini-a` alias). Explicit `mode=` arguments continue to take precedence over the environment variable.

Modes can now inherit from other modes using `include`. Use `include: <mode>` (or an array / comma-separated list) to merge one or more base presets first, then override only the settings you need in the current mode.

### Built-in Presets

- **`shell`** – Read-only shell access (`useshell=true`).
- **`shellrw`** – Shell with write access enabled (`useshell=true readwrite=true`).
- **`shellutils`** – Shell plus the Mini Utils Tool MCP utilities with docs-aware defaults (`useutils=true mini-a-docs=true usetools=true`).
- **`chatbot`** – Lightweight conversational mode (`chatbotmode=true`).
- **`internet`** – Tool mode with web-access MCP presets plus docs-aware utils (`usetools=true mini-a-docs=true mcp=...`).
- **`web`** – Browser UI with tool registration and docs-aware utils (`usetools=true mini-a-docs=true`).
- **`webfull`** – Web UI with history, attachments, diagrams, charts, ASCII sketches, and docs-aware utils enabled (`usetools=true useutils=true usestream=true mcpproxy=true mini-a-docs=true usediagrams=true usecharts=true useascii=true usemath=true usehistory=true useattach=true historykeep=true useplanning=true`). Add `usemaps=true` if you also want interactive map guidance in this preset.

### Creating Custom Presets

Create your own presets by creating either a `~/.openaf-mini-a_modes.yaml` file or a `~/.openaf-mini-a/modes.yaml` file in your home directory. Custom modes are automatically merged with the built-in presets from `mini-a-modes.yaml`, with custom definitions taking precedence. If both custom files exist, `~/.openaf-mini-a/modes.yaml` overrides the legacy file. The agent loads these YAML files on each run, so custom additions and overrides are immediately available.

**Example custom preset:**

```yaml
# In ~/.openaf-mini-a/modes.yaml
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
```

**Usage:**

```bash
mini-a mode=mypreset goal="your goal here"
```

## Reliability features

Mini-A now includes resilience primitives so long-running sessions can absorb transient failures without manual babysitting:

- **Exponential backoff on every LLM and MCP call** smooths over throttling and flaky network hops by spacing retries with an increasing delay.
- **Automatic checkpoints** snapshot the agent state after each successful step; if a transient error strikes, Mini-A restores the last checkpoint and keeps working instead of abandoning the goal.
- **Error categorization** separates transient hiccups (network, rate limits, timeouts) from permanent problems (invalid tool payloads, unsupported actions) so retries are only attempted when they make sense.
- **MCP circuit breakers** pause connections that repeatedly fail and log a warning, preventing noisy integrations from derailing the rest of the plan. Mini-A will automatically retry after the cooldown expires.
- **Early stop mechanism** detects repeated failure patterns and gracefully halts execution before exhausting retry budgets. The threshold dynamically adjusts based on model tier: the default is 3 identical consecutive errors, but automatically increases to 5 when using low-cost models before escalation (giving them more recovery opportunities). Use `earlystopthreshold=N` to override this behavior. When triggered, the system sets `runtime.earlyStopTriggered=true` and records the reason (e.g., "repeated failures") in `runtime.earlyStopReason`. Execution notes are automatically extracted and included in the final response to document what was attempted and why the agent stopped.
- **Persistent error summaries** prepend the latest recovery notes to the context whenever it is summarized, keeping operators informed about what went wrong and how it was resolved. The `_extractExecutionNotes()` method collects recent errors, early stop signals, and other runtime events to provide comprehensive troubleshooting context.

All of these behaviors are enabled by default. Use verbose or debug logging (`verbose=true` or `debug=true`) to watch the retry, recovery, circuit-breaker, and early stop messages in real time.

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
- `usediagrams=false` / `usecharts=false` / `useascii=false` / `usemaps=false` / `usemath=false` to disable Mermaid, Chart.js, ASCII sketch, Leaflet map, or math-rendering guidance when running headless
- `usestream=true` to enable real-time token streaming via Server-Sent Events (SSE) for live response display
- `usehistory=true` to expose the history side panel and persist conversations on disk
- `historypath=/tmp/mini-a-history` / `historyretention=600` / `historykeep=true` to manage history storage (see comments in `mini-a-web.yaml`)
- `historys3bucket=my-bucket historys3prefix=sessions/` to mirror history JSON files to S3 (supports `historys3url`, `historys3accesskey`, `historys3secret`, `historys3region`, `historys3useversion1`, `historys3ignorecertcheck`). History is uploaded at optimized checkpoints: immediately after user prompts and when final answers are provided, rather than on every interaction event
- `useattach=true` to enable the file attachment button in the browser UI (disabled by default)
- `maxpromptchars=120000` to set the maximum accepted prompt size in characters (default: 120,000). Applies to the user-supplied `prompt` field in each `/prompt` request body. Requests whose prompt field exceeds this limit are rejected with an error before any LLM call is made. Reduces risk from very large or malformed inputs.

Endpoints used by the UI (served by `mini-a-web.yaml`): `/prompt`, `/result`, `/clear`, and `/ping`.

## Running Mini-A in Docker

Mini-A can run inside a Docker container for isolated execution, portability, and consistent deployment across environments. The container supports three main usage patterns: CLI console, web interface, and goal-based execution.

### Simple Docker Usage (Recommended)

For most use cases, the `openaf/mini-a` image provides the simplest way to run Mini-A as it comes with Mini-A pre-installed:

**Basic CLI console:**
```bash
docker run --rm -ti \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/mini-a
```

**Console with MCP servers and custom rules:**
```bash
docker run --rm -ti \
  -e OAF_MODEL=$OAF_MODEL \
  -e OAF_LC_MODEL=$OAF_LC_MODEL \
  openaf/mini-a \
  mcp="(cmd: 'ojob mcps/mcp-time.yaml')" \
  rules="- the default time zone is Asia/Tokyo"
```

**Console with knowledge and rules loaded from files:**
```bash
docker run --rm -ti \
  -e OAF_MODEL=$OAF_MODEL \
  -v $(pwd):/work -w /work \
  openaf/mini-a \
  knowledge="$(cat KNOWLEDGE.md)" \
  rules="$(cat RULES.md)"
```

**Web interface:**
```bash
docker run -d --rm \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  -p 12345:12345 \
  openaf/mini-a onport=12345
```

**Goal execution:**
```bash
docker run --rm \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/mini-a \
  goal="your goal here" useshell=true
```

**With volume mounts for file access:**
```bash
docker run --rm -ti \
  -v $(pwd):/work \
  -w /work \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/mini-a \
  goal="analyze all JavaScript files" useshell=true
```

**Multiple MCP servers with proxy aggregation:**
```bash
docker run --rm -ti \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/mini-a \
  goal="compare time zones and financial data" \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml'), (cmd: 'ojob mcps/mcp-fin.yaml')]" \
  usetools=true mcpproxy=true
```

### Advanced Docker Usage (Custom oPack Combinations)

For advanced scenarios requiring custom OpenAF installations or specific oPack combinations beyond mini-a, use the `openaf/oaf:edge` base image with the `OPACKS` environment variable.

#### Docker Container Usage Patterns

#### Pattern 1: CLI Console Mode

Run Mini-A as an interactive console inside a container. This is useful for quick experimentation or when you want the console interface without installing OpenAF locally.

**Basic console:**
```bash
docker run --rm -ti \
  -e OPACKS=mini-a \
  -e OPACK_EXEC=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000, temperature: 1)" \
  openaf/oaf:edge
```

**Console with shell access and volume mount:**
```bash
docker run --rm -ti \
  -v $(pwd):/work \
  -w /work \
  -e OPACKS=mini-a \
  -e OPACK_EXEC=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/oaf:edge \
  useshell=true
```

**Console with AWS Bedrock:**
```bash
docker run --rm -ti \
  -v $(pwd):/work \
  -e OPACKS=aws,mini-a \
  -e OPACK_EXEC=mini-a \
  -e OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'openai.gpt-oss-20b-1:0', temperature: 0), timeout: 900000)" \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
  openaf/oaf:edge \
  useshell=true libs="@AWS/aws.js"
```

#### Pattern 2: Web Interface Mode

Start Mini-A as a web server for browser-based interaction. This provides a rich UI with support for diagrams, charts, file attachments, and conversation history.

**Basic web interface:**
```bash
docker run -d --rm \
  -e OPACKS=mini-a \
  -e OPACK_EXEC=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  -p 12345:12345 \
  openaf/oaf:edge \
  onport=12345
```

**Web interface with multiple MCPs and full features:**
```bash
docker run -d --rm \
  -e OPACKS="Mermaid,mini-a" \
  -e OPACK_EXEC="mini-a" \
  -e mcp="[(type:ojob,options:(job:mcps/mcp-web.yaml))|(type:ojob,options:(job:mcps/mcp-weather.yaml))|(type:ojob,options:(job:mcps/mcp-fin.yaml))|(type:ojob,options:(job:mcps/mcp-math.yaml))|(type:ojob,options:(job:mcps/mcp-net.yaml))|(type:ojob,options:(job:mcps/mcp-time.yaml))]" \
  -e OAF_FLAGS="(MD_DARKMODE: 'auto')" \
  -e OAF_MODEL="(type: openai, key: '...', url: 'https://api.groq.com/openai', model: openai/gpt-oss-20b, timeout: 900000, temperature: 0)" \
  -p 12345:12345 \
  openaf/oaf:edge \
  onport=12345 usecharts=true usediagrams=true usemaps=true usetools=true mcpproxy=true
```

**Web interface with history and attachments:**
```bash
docker run -d --rm \
  -v $(pwd)/history:/tmp/history \
  -e OPACKS=mini-a \
  -e OPACK_EXEC=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  -p 12345:12345 \
  openaf/oaf:edge \
  onport=12345 chatbotmode=true \
  usehistory=true historykeep=true historypath=/tmp/history \
  useattach=true usediagrams=true usecharts=true usemaps=true
```

#### Pattern 3: Goal-Based Execution

Run Mini-A to achieve a specific goal and exit. This is ideal for automation, CI/CD pipelines, or scheduled tasks.

**Simple goal execution:**
```bash
docker run --rm \
  -e OPACKS=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/oaf:edge \
  ojob mini-a/mini-a.yaml \
  goal="generate a report of system metrics" \
  useshell=true
```

**Goal with file access:**
```bash
docker run --rm \
  -v $(pwd):/work \
  -w /work \
  -e OPACKS=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/oaf:edge \
  ojob mini-a/mini-a.yaml \
  goal="analyze all JavaScript files and create a summary" \
  useshell=true outfile=/work/summary.md
```

**Goal with MCP integration:**
```bash
docker run --rm \
  -e OPACKS=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: 'your-key', timeout: 900000)" \
  openaf/oaf:edge \
  ojob mini-a/mini-a.yaml \
  goal="what time is it in Sydney and Tokyo?" \
  mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)"
```

**Goal with planning and multiple MCPs:**
```bash
docker run --rm \
  -v $(pwd):/work \
  -w /work \
  -e OPACKS=mini-a \
  -e OAF_MODEL="(type: openai, model: gpt-4, key: 'your-key', timeout: 900000)" \
  openaf/oaf:edge \
  ojob mini-a/mini-a.yaml \
  goal="research latest tech trends and create a comprehensive report" \
  mcp="[(cmd: 'ojob mcps/mcp-web.yaml'), (cmd: 'ojob mcps/mcp-time.yaml')]" \
  useplanning=true planfile=/work/plan.md \
  outfile=/work/report.md usetools=true mcpproxy=true
```

`mcp-web` now exposes both `get-url` (jsoup processing) and `http-request` (direct HTTP verbs).  
`http-request` supports `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`; mutating verbs require starting `mcp-web` with `readwrite=true`.

Example (`HEAD`, read-only):
```bash
mini-a goal="check response headers for rust-lang.org" \
  mcp="(cmd: 'ojob mcps/mcp-web.yaml', timeout: 5000)"
```

Example (`PATCH`, read-write enabled):
```bash
mini-a goal="call http-request PATCH on my API endpoint" \
  mcp="(cmd: 'ojob mcps/mcp-web.yaml readwrite=true', timeout: 5000)"
```

### Web UI via Docker (Provider-Specific Examples)

Run the Mini‑A browser UI inside a container by passing the proper `OAF_MODEL` configuration for your LLM provider and exposing port `12345`. The following examples mount a `history/` directory from the host so conversation transcripts persist across runs.

> **Tip:** Replace secrets like API keys or session tokens with values from your shell environment or a secure secret manager. The `OPACKS` and `libs` flags load the provider- and Mini‑A-specific OpenAF packs and helper scripts. When you always need the same helpers (for example `@AWS/aws.js` for Bedrock), set `OAF_MINI_A_LIBS` so Mini‑A picks them up automatically without having to pass `libs="..."` every time.

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
  libs="@AWS/aws.js"  # optional if OAF_MINI_A_LIBS is set
```

#### AWS Bedrock (OpenAI OSS 20B)

```bash
docker run --rm -ti \
  -e OPACKS=aws,mini-a \
  -e OAF_MODEL="(type: bedrock, options: (region: eu-west-1, model: 'openai.gpt-oss-20b-1:0', temperature: 0), timeout: 900000)" \
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
  libs="@AWS/aws.js"  # optional if OAF_MINI_A_LIBS is set
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

### Stopping a Mini-A Agent

```javascript
// Stop an in-flight agent run (optionally with a reason)
agent.stop("User requested cancellation")
```

Call `stop()` to halt execution and transition the agent to the `stop` state. If the agent already completed successfully, the stop call logs the request without counting it as a stopped goal.

## Configuration Options

The `start()` method accepts various configuration options:

### Required Parameters

- **`goal`** (string): The objective the agent should achieve

### Optional Parameters

#### Basic Configuration
- **`maxsteps`** (number, default: 15): Maximum consecutive steps without a successful action before the agent forces a final answer
- **`earlystopthreshold`** (number, default: 3, auto-adjusts to 5 with low-cost models): Number of identical consecutive errors before the early stop guard activates. The system automatically increases this threshold when using low-cost models before escalation to give them more recovery opportunities. Set explicitly to override automatic behavior.
- **`youare`** (string): Override the opening "You are ..." sentence in the agent prompt (inline text or an `@file` path); Mini-A always appends the default "Work step-by-step..." directive, and adds the "No user interaction..." remark for non-interactive surfaces (including `mini-a-web`, and `mini-a-con` unless the console-only `userInput` utils tool is available)
- **`chatyouare`** (string): Override the opening chatbot persona sentence when `chatbotmode=true` (inline text or an `@file` path) without touching the rest of the conversational instructions
- **`verbose`** (boolean, default: false): Enable verbose logging
- **`debug`** (boolean, default: false): Enable debug mode with detailed logs
- **`debugfile`** (string, optional): Redirect all debug output to a file as NDJSON instead of printing colored blocks on screen. Implies `debug=true`. Each line is a JSON object with a `ts` (ISO timestamp) and either `type:"event"` (with `event` and `message` fields, one per agent event) or `type:"block"` (with `label` and `content` fields, for raw LLM prompt/response payloads). Use `$from(io.readFileNDJSON("debug.log")).equals("label","STEP_PROMPT").select()` to filter specific block types.
- **`debugch`** (string, optional): SLON/JSON definition of a debug channel for main LLM debugging (requires `$llm.setDebugCh` support). Example: `"(type: file, options: (file: '/tmp/mini-a-llm-debug.log'))"`.
- **`debuglcch`** (string, optional): SLON/JSON definition of a debug channel for low-cost LLM debugging. Same format as `debugch`.
- **`debugvalch`** (string, optional): SLON/JSON definition of a debug channel for the validation LLM (used when `llmcomplexity=true`). Same format as `debugch`. Example: `"(type: file, options: (file: '/tmp/mini-a-val-llm-debug.log'))"`. Logs a warning if the validation LLM is not configured.
- **`raw`** (boolean, default: false): Return raw string instead of formatted output
- **`showthinking`** (boolean, default: false): Use raw prompt calls to surface XML-tagged thinking blocks (for example `<thinking>...</thinking>`) as thought logs
- **`chatbotmode`** (boolean, default: false): Replace the agent workflow with a lightweight conversational assistant prompt
- **`promptprofile`** (string, default: `balanced`): Control system prompt verbosity. Use `minimal` to minimize context usage, `balanced` for the default reduced prompt, or `verbose` to keep richer guidance and examples. When `debug=true`, Mini-A defaults to `verbose` unless you override it.
- **`systempromptbudget`** (number, optional): Maximum estimated system-prompt token budget. When the rendered prompt exceeds it, Mini-A automatically drops lower-priority sections in this order: examples, skill descriptions, detailed tool reference, extended planning guidance, then excess skill entries.
- **`useplanning`** (boolean, default: false): Load (or maintain) a persistent task plan in agent mode. When no pre-generated plan is available Mini-A falls back to the adaptive in-session planner and disables the feature for trivial goals.
- **`usememory`** (boolean, default: false): Enable Mini-A structured working memory during execution. Memory schema sections are: `facts`, `evidence`, `openQuestions`, `hypotheses`, `decisions`, `artifacts`, `risks`, and `summaries`.
- **`memoryscope`** (string, default: `both`): Select memory lookup scope: `session`, `global`, or `both` (session first, global fallback).
- **`memorysessionid`** (string, optional): Session id for ephemeral memory isolation. Defaults to `conversation` when provided, otherwise the current runtime id.
- **`memorych`** (string, optional): JSSLON definition for an OpenAF channel used to persist and reload global working memory across runs. Supports any channel type (e.g. `file`, `remote`, `mvs`, `simple`). Example: `memorych="{type:'file',options:{file:'/tmp/memory.json'}}"`. When combined with `memoryscope=both`, Mini-A now defaults runtime writes to the global store so they survive reloads; use `memoryScope: "session"` for ephemeral per-session entries. When omitted, memory is in-process only and not persisted between runs.
- **`metricsch`** (string, optional): JSSLON definition for an OpenAF channel used to record periodic Mini-A metrics snapshots. Supports any channel type accepted by `$ch().create(...)`. Example: `metricsch="{name:'mini-a-metrics',type:'mvs',options:{file:'/tmp/mini-a-metrics.db'}}"`. By default Mini-A collects only the `mini-a` metric every `1000` ms; optional `period`, `some`, and `noDate` fields map directly to `ow.metrics.startCollecting(ch, period, some, noDate)`.
- **`memoryuser`** (boolean, default: false): Convenience shorthand that activates `usememory`, pre-configures `memorych` and `memorysessionch` as file-backed channels under `~/.openaf-mini-a/`, and sets `memorypromote=facts,decisions,summaries` + `memorystaledays=30`. Only sets channels not already explicitly defined. The directory is auto-created if absent.
- **`memoryusersession`** (boolean, default: false): Convenience shorthand that activates `usememory`, defaults `memoryscope=session`, and pre-configures `memorysessionch` as a file-backed channel under `~/.openaf-mini-a/`. Only sets the session channel when it is not already explicitly defined. The directory is auto-created if absent.
- **`memorysessionch`** (string, optional): JSSLON definition for an OpenAF channel used to persist and reload session-scoped working memory. When both `memorych` and `memorysessionch` are set, default writes under `memoryscope=both` go to the session store; knowledge is promoted to global automatically at session end via `memorypromote`. Same format as `memorych`.
- **`memorymaxpersection`** (number, default: 80): Max entries retained per memory section before compaction.
- **`memorymaxentries`** (number, default: 500): Global cap across all sections; compaction preserves decisions/evidence preferentially.
- **`memorycompactevery`** (number, default: 8): Trigger compaction every N memory mutations.
- **`memorydedup`** (boolean, default: true): Deduplicate near-identical entries during append.
- **`memorypromote`** (string, default: `""`): Comma-separated list of memory sections to auto-promote from the session store to the global store at session end. Uses a refresh-or-append strategy: near-duplicate global entries have their `confirmedAt` and `confirmCount` updated rather than duplicated; entirely new entries are appended. `memoryuser=true` sets this to `facts,decisions,summaries`. Set to `""` to disable promotion.
- **`memorystaledays`** (number, default: `0`): Number of days after which a global memory entry that has not been re-confirmed by any session is marked `stale=true`. The sweep runs automatically after each auto-promotion pass. Stale entries are not deleted immediately — they are evicted by compaction when a section overflows `memorymaxpersection`, giving recently confirmed entries priority. Set to `0` to disable staleness tracking. `memoryuser=true` sets this to `30`.
- **`memoryinject`** (string, one of `"summary"` or `"full"`, default: `"summary"`): Controls how working memory is embedded in the step context. `summary` (default) injects only section entry counts (e.g. `{facts:12,decisions:3}`) and enables the `memory_search` action for on-demand retrieval — reducing per-step memory token cost by ~95%. `full` restores the previous behaviour of embedding all compact entries in every step prompt.
- **`mode`** (string): Apply a preset from [`mini-a-modes.yaml`](mini-a-modes.yaml), `~/.openaf-mini-a_modes.yaml`, or `~/.openaf-mini-a/modes.yaml` to prefill a bundle of related flags
- **`agent`** (string): Path to a markdown agent profile (or inline markdown text) with YAML frontmatter metadata. Supported keys include `model`, `capabilities` (`useshell`, `readwrite`, `useutils`, `usetools`), `tools` (MCP entries such as `type: ojob`, `type: stdio` + `cmd`, `type: remote`, or `type: sse`), `constraints` (appended to `rules`), `knowledge`, `youare`, and `mini-a` (map of direct Mini-A arg overrides). When the profile uses Markdown front matter, any text after the closing `---` is used as the default `goal=` input unless you pass `goal=` explicitly. (`agentfile` remains a backward-compatible alias.)

#### Dual-Model Controls
- **`modellc`** (string): Override the low-cost model configuration at runtime (same format as `OAF_LC_MODEL`). Useful for quick per-run model selection without changing environment variables.
- **`modelval`** (string): Override the validation model configuration at runtime (same format as `OAF_VAL_MODEL`). Useful when you want a dedicated validation model for one run without changing environment variables.
- **`deescalate`** (number, default: 3): Number of consecutive successful steps required after an escalation before Mini-A automatically reverts to the low-cost model. Set to a higher value for more conservative de-escalation or `0` to disable de-escalation entirely.
- **`lccontextlimit`** (number, default: 0 = disabled): Maximum context token count before escalating to the main model. When the estimated context size reaches this threshold, Mini-A switches to the main model for that step. Useful when the low-cost model has a smaller context window than the main model. Set to `0` to disable context-based escalation.
- **`modellock`** (string, one of `"main"`, `"lc"`, or `"auto"` = default): Force Mini-A to always use a specific model tier for every step, bypassing all dynamic escalation and de-escalation logic. Use `modellock=main` to always use the main model (`OAF_MODEL`), `modellock=lc` to always use the low-cost model (`OAF_LC_MODEL`), or leave unset/`auto` for the default adaptive behaviour. A one-time info message is logged at startup when a lock is active.
- **`modelstrategy`** (string, one of `"default"` or `"advisor"`, default: `"default"`): Select the model orchestration profile. `default` keeps current LC-first behavior with escalation. `advisor` keeps LC as the executor and selectively calls the main model as an internal advisor for difficult steps.
- **`advisormaxuses`** (number, default: `2`): Maximum advisor consultations per run when `modelstrategy=advisor`.
- **`advisorenable`** (boolean, default: `true`): Master toggle for advisor consultations inside `modelstrategy=advisor` runs.
- **`advisoronrisk`** (boolean, default: `true`): Allow advisor consults on risk signals.
- **`advisoronambiguity`** (boolean, default: `true`): Allow advisor consults on ambiguity signals.
- **`advisoronharddecision`** (boolean, default: `true`): Allow advisor consults for hard-decision checkpoints.
- **`advisorcooldownsteps`** (number, default: `2`): Minimum step distance between advisor consultations when `modelstrategy=advisor`.
- **`advisorbudgetratio`** (number, default: `0.20`): Fraction of session token budget that advisor calls can consume before low-value consults are declined.
- **`emergencyreserve`** (number, default: `0.10`): Portion of advisor budget reserved for higher-value/high-risk consults.
- **`harddecision`** (string, one of `"require"`, `"warn"`, `"off"`, default: `"warn"`): Controls hard-decision checkpoints for high-impact actions. `require` blocks hard actions unless advisor consultation succeeds.
- **`evidencegate`** (boolean, default: `false`): Enable lightweight evidence gating for non-trivial actions and final claims.
- **`evidencegatestrictness`** (string, one of `"low"`, `"medium"`, `"high"`, default: `"medium"`): Tuning level for evidence gate heuristics.
- **`lcescalatedefer`** (boolean, default: `true`): When enabled, if an escalation trigger fires but the current LC model response has a confidence score ≥ 0.7 (based on JSON validity, completeness, and action specificity), Mini-A defers the escalation by one additional step. If the next step also triggers escalation, it escalates immediately. Set to `false` to disable deferral and escalate as soon as the trigger fires.
- **`lcbudget`** (number, default: `0` = unlimited): Maximum total LC model token usage for the session. When the cumulative LC token count reaches this threshold, Mini-A permanently locks to the main model for the remainder of the session, logging a warning. Set to `0` to disable the budget cap.
- **`llmcomplexity`** (boolean, default: `false`): When enabled, if the static heuristic assessment returns `"medium"` complexity, Mini-A fires a single short LC model call to validate the result before selecting escalation thresholds. This adds a small upfront cost but may improve threshold accuracy for ambiguous goals.
- **`secpass`** (string): Password used to unlock OpenAF sBucket model secrets when loading saved model definitions (for example, encrypted entries managed through `modelman=true`).
- **`memoryman`** (boolean, default: false): Launch the interactive working-memory manager TUI (`mini-a-memoryman.js`) instead of the normal console. Designed for operators using `usememory=true` with `memorych`/`memorysessionch`.

Advisor mode contract (internal-only, never user-facing):
- Advisor responses must be strict JSON that must include: `assessment` (string), `recommended_next_step` (string), `risk_flags` (array), `escalate_to_main` (boolean), `confidence` (number), `stop_or_continue` (`"stop"` or `"continue"`).
- Responses that include execution intent (`tool`, `tool_calls`, `function_call`, or textual "run tool"/"invoke tool") are rejected.
- Invalid advisor payloads are ignored safely, counted in telemetry, and executor flow continues with stricter guardrails.

Default behavior note:
- If you keep `modelstrategy=default` (the default), runtime behavior remains unchanged. New advisor/evidence/hard-decision controls only apply when explicitly enabled or when advisor strategy is selected.

#### Planning Controls
- **`planmode`** (boolean, default: false): Switch to planning-only mode. Mini-A studies the goal/knowledge, generates a structured Markdown/JSON/YAML plan, and exits without executing any tasks. Mutually exclusive with `chatbotmode`.
- **`planfile`** (string): When planning, write the generated plan to this path. In execution mode, load an existing plan from this path (Markdown `.md`, JSON `.json`, or YAML `.yaml`/`.yml`) and keep it in sync as tasks complete.
- **`planformat`** (string): Override the plan output format during `planmode` (`markdown`, `json`, or `yaml`). Defaults to the detected extension of `planfile`, or Markdown when unspecified.
- **`plancontent`** (string): Provide plan content directly as a string instead of loading from a file. Useful for programmatic plan injection.
- **`validateplan`** (boolean, default: false): Validate a plan using LLM-based critique and structure validation without executing it. Can be combined with `planmode=true` to generate and validate in one step, or used with `planfile=` to validate an existing plan. The validation checks for structural issues, missing work, quality risks, and provides an overall PASS/NEEDS_REVISION verdict.
- **`resumefailed`** (boolean, default: false): Resume execution from the last failed task when re-running Mini-A against a partially completed plan file.
- **`convertplan`** (boolean, default: false): Perform a one-off format conversion instead of running the agent. Requires `planfile=` (input) and `outputfile=` (target path) and preserves notes/execution history across Markdown/JSON/YAML.
- **`forceplanning`** (boolean, default: false): Force planning to be enabled even if the complexity assessment suggests it's not needed. Overrides the automatic planning strategy selection.
- **`planstyle`** (string, default: `simple`): Controls the plan structure style. Use `simple` for flat sequential task lists (recommended for better model compliance) or `legacy` for phase-based hierarchical plans with nested tasks. The simple style generates numbered steps that models can follow more reliably.
- **`saveplannotes`** (boolean, default: false): When enabled, persist execution notes, critique results, and dynamic adjustments within the plan file structure. Useful for maintaining a complete audit trail of plan evolution.
- **`updatefreq`** (string, default: `auto`): Controls how often Mini-A writes progress to `planfile`. Accepted values are `auto` (every `updateinterval` steps), `always` (after every qualifying action), `checkpoints` (25/50/75/100% of `maxsteps`), or `never`.
- **`updateinterval`** (number, default: `3`): Step interval used when `updatefreq=auto`. Mini-A updates the plan after this many steps without a recorded update.
- **`forceupdates`** (boolean, default: false): When true, Mini-A records plan updates even when actions fail so the plan reflects obstacles and retry instructions.
- **`planlog`** (string, optional): Append every plan update to the specified log file for auditing and debugging.

#### Shell and File System Access
- **`useshell`** (boolean, default: false): Allow shell command execution
- **`shell`** (string): Prefix applied to every shell command (use with `useshell=true`)
- **`usesandbox`** (string, default: `off`): Apply built-in OS sandbox presets for shell commands (`off`,`auto`,`linux`,`macos`,`windows`). Mini-A warns when the requested backend is unavailable or only best-effort.
- **`sandboxprofile`** (string): Optional macOS profile path for `sandbox-exec`; if omitted, Mini-A auto-generates a restrictive temporary `.sb` profile
- **`sandboxnonetwork`** (boolean, default: `false`): Disable network inside the built-in sandbox when supported. Linux/macOS enforce it through the sandbox backend; Windows applies best-effort proxy/network clamps only.
- **`shellprefix`** (string): Override the shell prefix embedded inside stored plans or MCP executions so converted tasks run against the right environment
- **`shelltimeout`** (number): Maximum shell command runtime in milliseconds before timeout
- **`shellmaxbytes`** (number, optional): Cap shell output size in characters. When exceeded, Mini-A keeps a head/tail excerpt and inserts a truncation banner. Defaults to `8000` when unset.
- **`readwrite`** (boolean, default: false): Allow read/write operations on filesystem
- **`checkall`** (boolean, default: false): Ask for confirmation before executing any shell command
- **`shellallow`** (string): Comma-separated list of banned commands that should be explicitly allowed
- **`shellallowpipes`** (boolean, default: false): Allow pipes, redirection, and shell control operators in commands
- **`shellbanextra`** (string): Additional comma-separated commands to ban
- **`shellbatch`** (boolean, default: false): If true, runs in batch mode without prompting for command execution approval

#### MCP (Model Context Protocol) Integration
- **`mcp`** (string): MCP configuration in JSON format (single object or array for multiple connections)
- **`usetools`** (boolean, default: false): Register MCP tools directly on the model instead of expanding the system prompt with tool schemas
- **`usetoolslc`** (boolean, default: false): Register MCP tools directly only on the low-cost model (`OAF_LC_MODEL` / `modellc`). Useful when you want native tool calling on the cheaper tier without enabling it on the main model.
- **`usejsontool`** (boolean, default: false): When `usetools=true`, registers an optional compatibility `json` tool. Useful for models that intermittently emit `json` tool calls instead of returning a plain JSON action object.
- **`mcpdynamic`** (boolean, default: false): When `usetools=true`, analyze the goal and only register the MCP tools that appear relevant, consulting the available LLMs to pick a promising connection when heuristics fail and only falling back to all tools if no confident choice is produced
- **`mcplazy`** (boolean, default: false): Defer MCP connection initialization until a tool is first executed; useful when configuring many optional integrations
- **`mcpproxy`** (boolean, default: false): Aggregate all MCP connections (including `mcp="..."` and `useutils=true`) through a single proxy interface that exposes a `proxy-dispatch` tool. This reduces context usage by presenting only one tool to the LLM instead of exposing all tools from all connections individually. The LLM can use `proxy-dispatch` to list, search, and call tools across all downstream MCP connections. For large payloads, `proxy-dispatch` also supports `argumentsFile` (load arguments from JSON file) and `resultToFile=true` (store result in temporary JSON `resultFile`). Prefer this for large input/output when `useutils=true` (recommended) or `useshell=true readwrite=true`. See [docs/MCPPROXY-FEATURE.md](docs/MCPPROXY-FEATURE.md) for flow diagrams and advanced usage notes.
- **`adaptiverouting`** (boolean, default: false): Enable the adaptive route layer (`mini-a-router.js`) that chooses execution pathways (direct MCP/proxy/shell/utility/delegation) from rule-based intent analysis and execution history while preserving existing policy controls.
- **`routerorder`** (string, optional): Comma-separated preferred route order (for example `mcp_direct_call,mcp_proxy_path,shell_execution`).
- **`routerallow`** (string, optional): Comma-separated allowlist of route types the adaptive router may use.
- **`routerdeny`** (string, optional): Comma-separated denylist of route types the adaptive router must not use.
- **`routerproxythreshold`** (number, optional): Payload threshold in bytes where proxy-style handling is preferred (falls back to `mcpproxythreshold` when unset).
- **`mcpproxytoon`** (boolean, default: false): When `mcpproxythreshold>0`, serialize proxy-spilled object/array results using `af.toTOON(...)` before size checks and previews. This makes `readresult` slices/grep easier to scan and can reduce token usage for partial reads.
- **`mcpprogcall`** (boolean, default: false): Start a per-session localhost HTTP bridge that lets generated scripts (bash/Python/JS) list/search/call MCP tools programmatically. The bridge prompt snippet is injected automatically. Requires `useshell=true` if you expect scripts to run.
- **`mcpprogcallport`** (number, default: `0`): Port for the bridge server (`0` auto-selects a free local port).
- **`mcpprogcallmaxbytes`** (number, default: `4096`): Max inline JSON response size. Larger results are stored and returned via `resultId`.
- **`mcpprogcallresultttl`** (number, default: `600`): TTL in seconds for stored oversized results retrievable through `/result/{id}`.
- **`mcpprogcalltools`** (string, default: empty): Optional comma-separated allowlist of tool names exposed by the bridge.
- **`mcpprogcallbatchmax`** (number, default: `10`): Maximum calls accepted in one `/call-tools-batch` request.
- **`toolcachettl`** (number, optional): Override the default cache duration (milliseconds) for deterministic tool results when no per-tool metadata is provided

```javascript
// Single MCP connection
mcp: "(cmd: 'docker run --rm -i mcp/dockerhub')"

// Multiple MCP connections
mcp: "[ (cmd: 'docker run --rm -i mcp/dockerhub') | (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000) ]"

// Using MCP proxy to reduce context usage
// All connections are aggregated through a single proxy-dispatch tool
mcpproxy: true
usetools: true
mcp: "[ (cmd: 'docker run --rm -i mcp/dockerhub') | (cmd: 'ojob mcps/mcp-time.yaml') ]"
useutils: true

// Optional compatibility mode (helpful for some gpt-oss-120b runs)
usejsontool: true
```

##### Programmatic MCP tool calling (HTTP bridge)

When `mcpprogcall=true`, Mini-A starts a local HTTP server bound to `127.0.0.1` and exposes MCP tools through REST endpoints so scripts can call tools in loops, batches, and conditional workflows.

At runtime, Mini-A injects these environment variables into shell subprocesses:
- `MINI_A_PTC_PORT` — bound localhost port
- `MINI_A_PTC_TOKEN` — bearer token required by every request (`X-Mini-A-Token` header)
- `MINI_A_PTC_DIR` — per-session writable temp directory (removed on cleanup)

Available endpoints:
- `GET /list-tools` (append `?schema=1` to include input schemas)
- `GET /search-tools?q=...`
- `POST /call-tool` with `{ "name": "...", "params": { ... } }`
- `POST /call-tools-batch` with `{ "calls": [{ "id": "...", "name": "...", "params": { ... } }] }`
- `GET /result/{id}` (retrieve oversized stored result)
- `GET /result/{id}?offset=N&limit=M` (paginate large stored result payloads)

Example:

```bash
mini-a goal="query time + weather tools in one script and summarize" \
  useshell=true usetools=true mcpprogcall=true \
  mcp="[(cmd: 'ojob mcps/mcp-time.yaml'), (cmd: 'ojob mcps/mcp-weather.yaml')]"
```

Example script call:

```bash
curl -s -X POST "http://127.0.0.1:$MINI_A_PTC_PORT/call-tool" \
  -H "X-Mini-A-Token: $MINI_A_PTC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"time-current","params":{"timezone":"UTC"}}'
```

Use `mcpprogcalltools=toolA,toolB` to limit exposed tools when tighter boundaries are required.

Tools advertise determinism via MCP metadata (e.g., `annotations.readOnlyHint`, `annotations.idempotentHint`, or explicit cache settings). When detected, Mini-A caches results keyed by tool name and parameters for the configured TTL, reusing outputs on subsequent steps to avoid redundant calls.

##### Dynamic MCP tool selection

Set `usetools=true mcpdynamic=true` when you want Mini-A to narrow the registered MCP tools to only those that look useful for the current goal. The agent evaluates the candidate list in stages:

1. **Keyword heuristics**: advanced matching on tool names, descriptions, and goal keywords using stemming (word root extraction), synonym matching (semantic equivalents), n-gram extraction (multi-word phrases), and fuzzy matching (typo tolerance via Levenshtein distance).
2. **Low-cost model inference**: if `OAF_LC_MODEL` is configured, the cheaper model proposes a shortlist.
3. **Primary model inference**: the main model performs the same selection when the low-cost tier does not return results.
4. **Connection chooser fallback**: when no tools are selected, Mini-A asks the low-cost model (then the primary model if needed) to pick the single most helpful MCP connection and its tools before falling back further.

Only when every stage returns an empty list (or errors) does Mini-A log the issue and register the full tool catalog so nothing is accidentally hidden. Selection happens per MCP connection, and you will see `mcp` log entries showing which tools were registered. The new `tool_selection` metrics track which selection method was used (keyword, llm_lc, llm_main, connection_chooser, or fallback_all). Leave `mcpdynamic` false when you prefer the traditional "register everything" behaviour or when your model lacks tool-calling support.

#### Knowledge and Context
- **`knowledge`** (string): Additional context or knowledge for the agent (can be text or file path)
- **`maxcontext`** (number): Approximate context budget in tokens; Mini-A auto-summarizes older history when the limit is exceeded
- **`compressgoal`** (boolean, default: false): Compress oversized rendered goal text before execution; when disabled, Mini-A preserves the original goal verbatim
- **`compressgoaltokens`** (number, default: 250): Estimated token threshold above which goal compression is considered when `compressgoal=true`
- **`compressgoalchars`** (number, default: 1000): Character threshold above which goal compression is considered when `compressgoal=true`
- **`maxcontent`** (number): Alias for `maxcontext`
- **`rules`** (string): JSON/SLON array of additional numbered rules to append to the system prompt (can be text or file path)

#### Visual Guidance
- **`usediagrams`** (boolean, default: false): Ask the model to produce Mermaid diagrams when sketching workflows or structures
- **`usemermaid`** (boolean, default: false): Alias for `usediagrams`
- **`usecharts`** (boolean, default: false): Hint the model to provide Chart.js snippets for data visualization tasks. When combined with `usesvg=true` or `usevectors=true`, supported charts should still be emitted as chart configs instead of being drawn manually as SVG/vector art; SVG remains the fallback for unsupported chart forms or custom illustrations.
- **`usesvg`** (boolean, default: false): Prime the model to emit raw `svg` fenced blocks for infographics, annotated summaries, custom artwork, and other self-contained illustrations. Standard structural diagrams should still prefer Mermaid when supported.
- **`usevectors`** (boolean, default: false): Enable the combined vector bundle (`usesvg=true` + `usediagrams=true`). In practice this should prefer Mermaid for structural diagrams and SVG for infographics or custom visuals.
- **`useascii`** (boolean, default: false): Encourage enhanced UTF-8/ANSI visual output for rich terminal displays. When enabled, Mini-A guides the model to use:
  - **Full UTF-8 characters**: Box-drawing (┌─┐│└┘├┤┬┴┼╔═╗║╚╝╠╣╦╩╬), arrows (→←↑↓⇒⇐⇑⇓➔➜➡), bullets (•●○◦◉◎◘◙), shapes (▪▫▬▭▮▯■□▲△▼▽◆◇), and mathematical symbols (∞≈≠≤≥±×÷√∑∏∫∂∇)
  - **Strategic emoji**: Status indicators (✅❌⚠️🔴🟢🟡), workflow symbols (🔄🔁⏸️▶️⏹️), category icons (📁📂📄🔧⚙️🔑🔒), and semantic markers (💡🎯🚀⭐🏆)
  - **ANSI color codes**: Semantic highlighting for errors (red), success (green), warnings (yellow), info (blue/cyan), with support for bold, underline, backgrounds, and combined styles. Colors are applied outside markdown code blocks for proper terminal rendering
  - **Markdown tables**: Preferred format for tabular data with colored cell content for enhanced readability
  - **Progress indicators**: Block characters (█▓▒░), fractions (▏▎▍▌▋▊▉), spinners (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏), and percentage displays with color gradients
- **`usemaps`** (boolean, default: false): Prime the model to emit ```leaflet``` blocks that describe interactive maps (center coordinates, zoom, markers, layers). The console transcript preserves the fenced JSON, and the web UI auto-renders the configuration with Leaflet tiles, themed popups, and transparent markers.
- **`usemath`** (boolean, default: false): Prime the model to emit LaTeX formulas using inline `$...$` or display `$$...$$` syntax. When enabled in the web server, the UI loads KaTeX + showdown-katex so math expressions render as formatted equations.
- **`usestream`** (boolean, default: false): Enable real-time token streaming where LLM responses are displayed incrementally as they arrive. When enabled:
  - **Console mode**: Tokens are formatted with markdown and displayed immediately with smooth rendering
  - **Web UI mode**: Uses Server-Sent Events (SSE) to push tokens to the browser for real-time display
  - **Intelligent buffering**: Buffers code blocks, tables, and other markdown elements until complete before rendering to prevent visual artifacts
  - **Escape handling**: Properly processes escape sequences and closing quotes in streamed JSON responses
  - **Performance**: Reduces perceived latency by showing progress before the full response completes
  - **Compatibility**: Not compatible with `showthinking=true` mode (falls back to non-streaming)
  - **SSE event types** (web UI): The SSE stream emits `stream` events for regular LLM token output and `planner_stream` events for tokens generated during the planning phase. Clients can use the event type to visually distinguish planner output from regular answer output. The console renders `planner_stream` tokens in a distinct color for the same reason.

#### Libraries and Extensions
- **`libs`** (string): Comma-separated list of additional OpenAF libraries to load
- **`useutils`** (boolean, default: false): Auto-register the Mini File Tool utilities as a dummy MCP server for quick file operations
  - Exposes `init` (configure the working root and permissions), `filesystemQuery` (read/list/search/info via the `operation` field), `filesystemModify` (write/append/delete with `operation` plus required `content` or `confirm` flags), and `markdownFiles` (list, search, or read `*.md` files within the root)
  - When running through `mini-a-con.js`, also exposes `userInput`, an interactive helper backed by OpenAF `ask*` functions (`ask`, `askEncrypt`, `ask1`, `askChoose`, `askChooseMultiple`, `askStruct`) so the model can request clarification directly from the console user
  - `filesystemQuery` read supports byte ranges (`byteStart`, `byteEnd`, `byteLength`), line windows (`lineStart`, `lineEnd`, `maxLines`, `lineSeparator`), and `countLines=true` for total line count
  - `markdownFiles` uses `operation='list'` to enumerate all `.md` files, `operation='read'` to fetch one by relative path, and `operation='search'` to grep across all docs
- **`utilsroot`** (string, default: `.`): Root directory for Mini Utils Tool file operations (only when `useutils=true`)
- **`utilsallow`** (string, optional): Comma-separated allowlist of Mini Utils Tool names to expose when `useutils=true`
- **`utilsdeny`** (string, optional): Comma-separated denylist of Mini Utils Tool names to hide when `useutils=true`; applied after `utilsallow`
- **`mini-a-docs`** (boolean, default: false): When true (and `utilsroot` is not provided), automatically sets `utilsroot` to `getOPackPath("mini-a")` so the LLM can inspect Mini-A documentation files; the `markdownFiles` tool description will include the resolved documentation root path so the LLM can navigate docs directly
- **`miniadocs`** (boolean, default: false): Alias for `mini-a-docs`

#### Conversation Management
- **`conversation`** (string): Path to file for loading/saving conversation history
- **`resume`** (boolean, default: false, `mini-a-con`): Resume a previous console conversation. When `conversation` is omitted and `usehistory=true`, the console lists `~/.openaf-mini-a/history/*.json` and lets you choose which thread to continue.
- **`usehistory`** (boolean, default: false, `mini-a-con`): Enable console history discovery from `~/.openaf-mini-a/history/`.
- **`historykeep`** (boolean, default: false, `mini-a-con`): Store console conversation files in `~/.openaf-mini-a/history/` using `conversation-yyyyMMdd-HHmmss.json` style names.
- **`historykeepperiod`** (number, `mini-a-con`): Automatically delete kept conversation files older than the provided number of minutes.
- **`historykeepcount`** (number, `mini-a-con`): Automatically delete kept conversation files beyond the newest N entries.
  - When both `historykeepperiod` and `historykeepcount` are set, either rule can prune a saved conversation file.
- **`state`** (object|string): Initial structured state (JSON/SLON) injected before the first step and persisted across turns

#### Mode Presets
- **`mode`** (string): Shortcut for loading a preset argument bundle from [`mini-a-modes.yaml`](mini-a-modes.yaml), `~/.openaf-mini-a_modes.yaml`, or `~/.openaf-mini-a/modes.yaml` (custom modes override built-in ones, and the new path overrides the legacy one when both exist). Presets are merged before explicit flags, so command-line overrides always win. Bundled configurations include:
  - `shell` – Enables read-only shell access.
  - `shellrw` – Enables shell access with write permissions (`readwrite=true`).
  - `shellutils` – Adds the Mini File Tool helpers as an MCP (`useutils=true mini-a-docs=true usetools=true`) exposing `init`, `filesystemQuery`, `filesystemModify`, `markdownFiles`, and console-only `userInput` when launched through `mini-a-con`.
  - `chatbot` – Switches to conversational mode (`chatbotmode=true`).
  - `internet` – Registers internet-focused MCP presets with docs-aware utils (`usetools=true mini-a-docs=true mcp=...`).
  - `web` – Optimizes for the browser UI with MCP tools registered and docs-aware utils (`usetools=true mini-a-docs=true`).
  - `webfull` – Turns on diagrams, charts, ASCII sketches, attachments, history retention, planning, MCP proxying, streaming, and docs-aware utils for the web UI (`usetools=true useutils=true usestream=true mcpproxy=true mini-a-docs=true usediagrams=true usecharts=true useascii=true usemath=true usehistory=true useattach=true historykeep=true useplanning=true`). Add `usemaps=true` when you also want interactive maps baked into this preset.
  - Modes may use `include` to inherit another preset (or multiple presets) and then override values locally.

Extend or override these presets by editing the YAML file—Mini-A reloads it on each run.

#### Output Configuration
- **`outfile`** (string): Path to file where final answer will be written
- **`outfileall`** (string): Deep-research-only path where Mini-A writes the full cycle output (verdicts, notes, and learnings). When omitted, full results are printed to console.
- **`outputfile`** (string): When `convertplan=true`, path for the converted plan artifact (format inferred from extension)
- **`__format`** (string): Output format (e.g. "json", "md", ...)

#### Audit Logging
- **`auditch`** (string): JSSLON definition for the OpenAF channel that stores Mini-A interaction events. When supplied, each call to `fnI` is persisted under the `_mini_a_audit_channel` key. Example for a file-backed log: `auditch="(type: 'file', options: (file: 'audit.json'))"`. Channel types and options follow the OpenAF channel conventions documented in `github.com/openaf/docs/openaf.md` and `github.com/openaf/docs/llm-guide.md`; keep the structure compatible with `$ch().create(type, options)`.
- **`toollog`** (string): JSSLON definition for a dedicated tool-log channel. When supplied, every MCP tool usage is captured under `_mini_a_toollog_channel` including tool name, input arguments (`params`) and returned answer payload (`answer`) across both streaming and non-streaming runs.
- **`metricsch`** (string): JSSLON definition for a metrics channel. When supplied, Mini-A starts `ow.metrics.startCollecting(...)` and writes periodic snapshots to the configured channel, defaulting to only the `mini-a` metric namespace.

#### MCP Working Directory
- **`nosetmcpwd`** (boolean, default: false): By default, Mini-A sets `__flags.JSONRPC.cmd.defaultDir` to the mini-a oPack installation location, providing a consistent working directory for MCP commands. Set `nosetmcpwd=true` to prevent this automatic configuration and use the system's default working directory instead.

#### Rate Limiting
- **`rpm`** (number): Rate limit in calls per minute
- **`tpm`** (number): Maximum tokens per minute across prompt and completion
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

Enable `useplanning=true` (while keeping `chatbotmode=false`) whenever you want Mini-A to surface a live task plan that evolves with the session. The agent classifies the goal up front—trivial and easy goals automatically disable planning, moderate goals receive a short linear checklist, and complex goals trigger a nested "tree" plan with checkpoints. Provide `planfile=plan.md` (or `.json`) to reuse a pre-generated plan; Mini-A keeps task checkboxes in sync as execution progresses.

Use `planmode=true` when you only need Mini-A to design the plan. The runtime gathers context using the low-cost model (when available), asks the primary model for the final structured plan, writes the result to `planfile` (if supplied), prints it, and exits.

### Plan Styles

Mini-A supports two plan styles controlled by the `planstyle` parameter:

#### Simple Style (Default)

The **simple** style (`planstyle=simple`) generates flat, sequential task lists that models follow more reliably:

```
1. Read existing API code structure
2. Create user routes in src/routes/users.js
3. Add input validation middleware
4. Write unit tests for user endpoints
5. Run tests and verify all pass
```

Each step:
- Is a single, concrete action completable in 1-3 tool calls
- Starts with an action verb (Read, Create, Update, Run, Verify)
- Is self-contained without referencing other steps
- Has a clear completion criteria

The agent receives explicit "you are on step X of Y" directives and must complete each step before advancing. This reduces plan drift and improves cross-model reliability.

**Example usage:**
```bash
ojob mini-a.yaml goal="Build a REST API with user endpoints" useplanning=true useshell=true
```

#### Legacy Style

The **legacy** style (`planstyle=legacy`) preserves the original phase-based hierarchical structure:

```markdown
## Phase 1: Setup
- [ ] Plan approach for: Setup environment
- [ ] Execute: Install dependencies
- [ ] Validate results for: Setup complete

## Phase 2: Implementation
- [ ] Plan approach for: Create API routes
- [ ] Execute: Implement user endpoints
- [ ] Validate results for: Routes working
```

Each phase contains nested plan/execute/validate triplets with checkpoints. Use this style when you need:
- Complex multi-phase projects with clear milestones
- Compatibility with existing phase-based plan files
- Detailed dependency tracking between phases

**Example usage:**
```bash
ojob mini-a.yaml goal="Build a REST API" useplanning=true planstyle=legacy useshell=true
```

### Plan Validation

Use `validateplan=true` to validate a plan without executing it. This feature performs both LLM-based critique and structure validation to ensure your plan is ready for execution.

**Validate an existing plan:**
```bash
ojob mini-a.yaml goal="Your goal" planfile=plan.md validateplan=true useshell=true
```

**Generate and validate a plan in one step:**
```bash
ojob mini-a.yaml goal="Audit repository and prepare upgrade notes" planmode=true validateplan=true useshell=true
```

The validation process checks for:
- **Structure validation**: Verifies the plan has the required structure and checks each step against available capabilities (shell access, MCP tools)
- **LLM critique**: Evaluates the plan for missing work, unclear tasks, quality risks, and provides actionable feedback
- **Overall verdict**: Returns either PASS (ready for execution) or NEEDS_REVISION (requires improvements)

Validation results include:
- Issues found in the plan structure
- Missing work that should be added
- Quality risks that could affect execution
- Specific suggestions for improvement

This is particularly useful for:
- Reviewing plans before committing to execution
- Validating externally created plans
- Iterating on plan quality before starting work
- Ensuring all required tools and permissions are available

### Advanced Planning Features

Mini-A includes sophisticated planning capabilities that adapt to task complexity:

- **Goal-aware strategy selection** – Inspects the goal upfront and disables planning for trivial requests, keeps a short linear task list for moderate work, and creates a nested plan tree for complex missions. The `_shouldEnablePlanning()` method centralizes all planning enablement logic, considering chatbot mode, user preferences, complexity assessment, and explicit plan overrides.
- **Automatic decomposition & checkpoints** – Seeds `state.plan` with structured steps, intermediate checkpoints, and progress percentages so the LLM can track execution without handcrafting the scaffold from scratch.
- **Feasibility validation** – Pre-checks each step against available shell access and registered MCP tools, blocking impossible tasks and surfacing actionable warnings in the log.
- **LLM-based plan critique** – Before executing any plan, Mini-A validates it using the `_critiquePlanWithLLM()` method. The LLM evaluates the plan structure, identifies missing work, quality risks, and unclear phases, returning a verdict of `PASS` or `REVISE`. Failed critiques set `state.plan.meta.needsReplan=true` and increment the `plans_validation_failed` metric. This critique runs for both generated plans and externally loaded plans, ensuring all execution starts with validated task structures.
- **Phase verification tasks** – Mini-A automatically adds verification tasks to each phase via `_ensurePhaseVerificationTasks()`. If a phase lacks an explicit verification step, the system injects one titled "Verify that [Phase Name] outcomes satisfy the phase goals." These tasks are marked with `verification: true` and ensure each phase is properly validated before proceeding.
- **Dynamic replanning** – When obstacles occur during execution, the `_applyDynamicReplanAdjustments()` method dynamically injects mitigation tasks into the plan without requiring full replanning. Blocked nodes receive child tasks that address the specific obstacle, and the system tracks adjustments via `state.plan.meta.dynamicAdjustments` to avoid duplicate mitigations. This allows the agent to adapt to failures while preserving the overall plan structure.
- **External plan management** – When loading plans via `planfile=` or `plancontent=`, Mini-A sets the `_hasExternalPlan` flag to prevent reinitializing planning state. External plans go through the same critique and verification enhancement process as generated plans, and notes/execution history are preserved during format conversions.
- **Progress metrics & logging** – Records overall completion, checkpoint counts, and new counters (`plans_generated`, `plans_validated`, `plans_validation_failed`, `plans_replanned`, etc.) that show up in `getMetrics()`.
- **Planning mode & conversion utilities** – Generate reusable Markdown/JSON/YAML plans via `planmode=true`, sync them with `planfile=...` during execution, resume failed runs (`resumefailed=true`), and convert formats on demand (`convertplan=true`). Use `saveplannotes=true` to persist execution notes within the plan file.

### Automatic Plan Updates

When you provide both `useplanning=true` and `planfile=...`, Mini-A now keeps the plan document in sync with each session:

- After meaningful actions (shell commands, reasoning steps, final answers), the agent appends a block like:

  ```
  ---
  ## Progress Update - 2024-05-01T12:34:56Z

  ### Completed Task
  - **Task:** Executed shell command: ls -1 src
  - **Status:** SUCCESS
  - **Result:** ...

  ### Knowledge for Next Execution
  - src/components now contains the generated scaffolding
  ```

  Entries are stored under `## Execution History`, while new insights land in `## Knowledge Base` for future runs.
- If several steps pass without an update (controlled by `updatefreq` and `updateinterval`), the system inserts reminders into the LLM prompt so progress is recorded before continuing.
- Approaching the `maxsteps` limit automatically triggers a progress snapshot that summarises remaining work for the next execution.
- Set `forceupdates=true` to log updates even when commands fail—useful for documenting obstacles and retry instructions.
- Provide `planlog=/path/to/log` to capture every update in a separate append-only log file for auditing.

Plan files created or updated by Mini-A now include the imported knowledge section, so re-running with the same `planfile` resumes with context, outstanding tasks, and accumulated learnings intact.

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

## Deep Research Mode

Enable `deepresearch=true` to run iterative research cycles where Mini-A refines its research through multiple attempts, each validated against specific quality criteria. This mode is ideal for comprehensive research tasks that benefit from progressive refinement.

You can set `OAF_VAL_MODEL` or pass `modelval=...` to route the validation step to a dedicated model; otherwise the main model is used.

### How It Works

Deep research mode runs a loop of research-validate-learn cycles:

1. **Research**: Mini-A executes your goal using standard agent capabilities
2. **Validate**: The output is evaluated against your validation criteria using LLM-based assessment
3. **Learn**: If validation fails, learnings are extracted and fed into the next cycle
4. **Iterate**: The process repeats until validation passes or max cycles is reached

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `deepresearch` | boolean | `false` | Enable deep research mode with iterative validation |
| `maxcycles` | number | `3` | Maximum number of research cycles to attempt |
| `validationgoal` | string | - | Validation criteria for evaluating research quality (string or file path; implies `deepresearch=true`, defaults `maxcycles=3`) |
| `valgoal` | string | - | Alias for `validationgoal` |
| `validationthreshold` | string | `"PASS"` | Required validation verdict (`"PASS"` or score-based like `"score>=0.7"`) |
| `persistlearnings` | boolean | `true` | Whether to carry learnings from previous cycles forward |

## Sub-Goal Delegation

Mini-A supports **delegation** — the ability to spawn child Mini-A agents to handle sub-goals. This enables hierarchical problem decomposition, parallel execution, and distributed workloads.

### Delegation Modes

1. **Local Delegation** — Parent spawns child agents in the same process (async threads)
2. **Remote Delegation** — Headless HTTP API worker for distributed execution

### Delegation Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usedelegation` | boolean | `false` | Enable subtask delegation |
| `workers` | string | (none) | Comma-separated list of worker URLs; delegation runs remotely and prefers workers whose A2A skills match the subtask |
| `usea2a` | boolean | `false` | Use A2A HTTP+JSON/REST transport (`/message:send`, `/tasks`, `/tasks:cancel`) when delegating to remote workers |
| `workerreg` | number | (none) | Port for dynamic worker registration server on the parent |
| `workerregtoken` | string | (none) | Bearer token for registration endpoints |
| `workerevictionttl` | number | `60000` | Heartbeat TTL (ms) before dynamic worker eviction |
| `workerregurl` | string | (none) | Comma-separated parent registration URLs for worker self-registration |
| `workerreginterval` | number | `30000` | Worker heartbeat interval (ms) |
| `maxconcurrent` | number | `4` | Maximum concurrent child agents |
| `delegationmaxdepth` | number | `3` | Maximum delegation nesting depth |
| `delegationtimeout` | number | `300000` | Default subtask deadline (ms) |
| `delegationmaxretries` | number | `2` | Default retry count for failed subtasks |

**Worker startup parameters** (used when starting a worker with `workermode=true`):

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `workerskills` | string | (none) | JSON/SLON array of A2A skill objects, or comma-delimited skill IDs (e.g. `"shell,python"`). Comma form auto-expands each ID to a minimal `{ id, name, tags }` skill entry |
| `workertags` | string | (none) | Comma-delimited tags added to the default `run-goal` skill for routing |
| `workerspecialties` | string | (none) | Comma-delimited specialty tags also injected into `run-goal`. Shorthand when you don't need full skill descriptors (e.g. `"finance,python"`) |
| `shellworker` | boolean | `false` | Convenience alias: sets `useshell=true` and automatically emits a `shell` A2A skill so the parent can route shell tasks here via `skills=["shell"]` |

### Enabling Local Delegation

```bash
# Enable delegation with tool registration
mini-a usedelegation=true usetools=true goal="Coordinate multiple research tasks"

# Or in the interactive console
mini-a
/set usedelegation true
/set usetools true
```

When enabled, two MCP tools become available:
- **`delegate-subtask`** — Spawn a child agent for a sub-goal. Parameters: `goal` (required), `maxsteps`, `timeout`, `waitForResult`, `worker` (optional name hint), `skills` (optional required skill IDs, e.g. `["shell"]`, `["time"]`, `["network"]`)
- **`subtask-status`** — Check status/result of a delegated subtask

The tool description is dynamic — when remote workers are registered, it lists available workers and their advertised A2A skills so the LLM can route intelligently. Use `worker` to prefer a worker by name and `skills` to require specific capabilities. Shell tasks should use `skills=["shell"]` rather than a flag — the parent will route to a worker that declared the `shell` skill.

### Console Commands

```bash
# Manually delegate a sub-goal
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

### Remote Delegation (Worker API)

Start a headless worker API for programmatic delegation:

```bash
# Start a general worker
mini-a workermode=true onport=8080 apitoken=your-secret-token workername="research-east" workerdesc="US-East research worker"

# Start a shell-capable worker using the shellworker convenience arg
# (sets useshell=true and emits a 'shell' A2A skill automatically)
mini-a workermode=true onport=8081 apitoken=your-secret-token \
  workername="shell-worker" workerdesc="Shell execution worker" \
  shellworker=true

# Start a network-specialized worker using A2A skills and specialty tags
mini-a workermode=true onport=8082 apitoken=your-secret-token \
  workername="network-east" workerdesc="Network diagnostics worker" \
  workerspecialties="network,latency,tls" \
  workerskills='[{ "id": "network-latency", "name": "Network latency", "description": "Measure TCP and TLS latency for remote hosts", "tags": ["network","latency","tls","port"], "examples": ["Measure latency to yahoo.co.jp:443"] }]'

# Start a time worker — comma-delimited shorthand for workerskills
mini-a workermode=true onport=8083 apitoken=your-secret-token \
  workername="time-worker" workerdesc="Timezone and current time worker" \
  workerspecialties="time,timezone,clock"

# Parent agent using remote workers for delegation
mini-a usedelegation=true workers="http://localhost:8080" apitoken=your-secret-token usetools=true goal="Coordinate parallel subtasks"

# Parent agent using A2A HTTP+JSON/REST transport to remote workers
mini-a usedelegation=true usea2a=true workers="http://localhost:8080" apitoken=your-secret-token usetools=true goal="Coordinate parallel subtasks"

# Submit a task via HTTP
curl -X POST http://localhost:8080/task \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Analyze data and produce summary",
    "args": { "maxsteps": 10, "format": "json" },
    "timeout": 300
  }'

# Poll for status
curl -X POST http://localhost:8080/status \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "..." }'

# Get result
curl -X POST http://localhost:8080/result \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "..." }'
```

**Worker API Endpoints:**
- `GET /.well-known/agent.json` — **Canonical A2A AgentCard** (protocol 0.4.0+). Primary profile source used by parent agents for worker discovery and skill-based routing
- `GET /info` — Server capabilities and skills (mirrors the AgentCard; retained for compatibility)
- `POST /task` — Submit new task (Mini-A native API)
- `POST /status` — Poll task status (Mini-A native API)
- `POST /result` — Get final result (Mini-A native API)
- `POST /cancel` — Cancel running task (Mini-A native API)
- `POST /message:send` — A2A HTTP+JSON/REST send message endpoint
- `GET /tasks` — A2A HTTP+JSON/REST list tasks (`?id=<taskId>` to fetch one task)
- `POST /tasks:cancel` — A2A HTTP+JSON/REST cancel task (`{ "id": "..." }`)
- `GET /.well-known/agent.json` — Public A2A agent card
- `GET /extendedAgentCard` — Authenticated extended A2A agent card
- `GET /healthz` — Health check
- `GET /metrics` — Task/delegation metrics


A2A HTTP+JSON/REST quick example:

```bash
# Send A2A message
curl -X POST http://localhost:8080/message:send \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "messageId": "msg-1",
      "role": "ROLE_USER",
      "parts": [{ "text": "Summarize deployment risks for this week" }]
    },
    "contextId": "ctx-1"
  }'

# List A2A tasks (or query one with ?id=<taskId>)
curl -H "Authorization: Bearer your-secret-token" \
  http://localhost:8080/tasks
```

Worker specialization metadata stays A2A-compatible. `/.well-known/agent.json` is the canonical agent card, and `/info` mirrors the same `skills` payload so Mini-A can route delegated subtasks without inventing a second schema.

For comprehensive delegation documentation, see **[docs/DELEGATION.md](docs/DELEGATION.md)**.

### Dynamic Worker Registration

Dynamic worker registration lets workers announce themselves at startup and refresh registration with heartbeats, instead of relying only on a static `workers=` list.

```bash
# Parent instance: start registration server
mini-a usedelegation=true usetools=true \
  workerreg=12345 workerregtoken=secret workerevictionttl=90000

# Worker: self-register and heartbeat
mini-a workermode=true onport=8080 apitoken=secret \
  workerregurl="http://main-host:12345" \
  workerregtoken=secret workerreginterval=30000
```

Registration endpoints on the parent `workerreg` port:
- `POST /worker-register`
- `POST /worker-deregister`
- `GET /worker-list`
- `GET /healthz`

Kubernetes HPA flow:
- Scale up: new worker pod starts and registers itself.
- Runtime: worker sends heartbeats at `workerreginterval`.
- Scale down (graceful): worker sends deregistration on shutdown.
- Crash/OOM: parent auto-evicts stale dynamic workers after `workerevictionttl`.

### Basic Usage

```bash
# Research with quality validation
mini-a goal="Research quantum computing applications in drug discovery" \
  deepresearch=true \
  maxcycles=5 \
  validationgoal="Validate: covers at least 3 specific applications with real-world examples and citations"

# With MCP tools for comprehensive research
mini-a goal="Comprehensive analysis of renewable energy trends 2024" \
  deepresearch=true \
  maxcycles=3 \
  validationgoal="Validate: includes statistical data, covers solar/wind/hydro, has trend projections" \
  mcp="(cmd: 'docker run --rm -i mcp/wikipedia-mcp')"

# Alias usage
mini-a goal="Research database indexing strategies" \
  deepresearch=true \
  maxcycles=3 \
  valgoal="Validate: compares B-tree vs LSM, includes benchmarks, recommends scenarios"

# Score-based validation threshold
mini-a goal="Technical comparison of cloud providers" \
  deepresearch=true \
  maxcycles=4 \
  validationgoal="Rate 1-10 on: completeness, accuracy, actionability" \
  validationthreshold="score>=0.7"
```

### Validation Goals

The `validationgoal` parameter (alias: `valgoal`) defines your quality criteria. It can be:

- **Checklist-based**: "Validate: includes X, Y, and Z"
- **Coverage-based**: "Ensure all major topics are covered with citations"
- **Score-based**: "Rate 1-10 on: accuracy, depth, clarity"
- **Specific requirements**: "Must include at least 5 real-world examples with dates"

`validationgoal` (or `valgoal`) accepts either inline text or a file path (single-line path); when a file path is provided, Mini-A loads the file contents.

Examples:
```bash
# Checklist validation
validationgoal="Validate: covers benefits, limitations, cost analysis, and security considerations"

# Coverage validation
validationgoal="Ensure comprehensive coverage of all major JavaScript frameworks with pros/cons"

# Quality validation
validationgoal="Rate on scale 1-10: technical accuracy, practical examples, citation quality"
```

### Validation Thresholds

Control when a research cycle is considered successful:

- **`"PASS"`** (default): Simple pass/fail based on LLM verdict
- **`"score>=0.7"`**: Requires validation score of 0.7 or higher (0-1 scale)
- **`">=7"`**: Requires score of 7 or higher (automatically normalized to 0-1 scale)

### Cycle Behavior

Each cycle:
1. Receives accumulated learnings from previous attempts
2. Executes the full research goal with enhanced context
3. Gets validated against the validation criteria
4. Extracts specific issues, feedback, and suggestions for improvement

If validation **passes**:
- Research stops immediately (even if under `maxcycles`)
- Final output includes cycle metadata showing early success

If validation **fails**:
- Learnings are extracted and accumulated
- Next cycle receives enhanced knowledge with previous feedback
- Process continues until validation passes or `maxcycles` is reached

### Output Format

Deep research results include:

```markdown
# Deep Research Results

**Cycles Completed:** 3/5
**Final Verdict:** PASS

## Research Output
[Your final research content]

## Cycle History
### Cycle 1
- **Verdict:** REVISE
- **Score:** 0.6
- **Feedback:** Missing specific citations and real-world examples

### Cycle 2
- **Verdict:** REVISE
- **Score:** 0.75
- **Feedback:** Good improvement but needs more depth on cost analysis

### Cycle 3
- **Verdict:** PASS
- **Score:** 0.9
- **Feedback:** Comprehensive coverage with strong citations

## Key Learnings
- Issue: Needed more specific citations from peer-reviewed sources
- Suggestion: Include quantitative data with dates
- Feedback: Add real-world case studies with outcomes
```

### Metrics

Deep research mode tracks several metrics accessible via `getMetrics().deep_research`:

| Counter | Description |
|---------|-------------|
| `sessions` | Total deep research sessions started |
| `cycles` | Total research-and-validate cycles run across all sessions |
| `validations_passed` | Cycles whose LLM validation returned a passing verdict |
| `validations_failed` | Cycles whose LLM validation returned a failing verdict |
| `early_success` | Sessions that passed validation before exhausting the cycle limit |
| `max_cycles_reached` | Sessions that hit the cycle limit without a passing verdict |

See the [Metric breakdown](#metric-breakdown) table for the full counter reference.

### Best Practices

1. **Clear validation criteria**: Make your `validationgoal` specific and measurable
2. **Reasonable cycle limits**: Start with 3-5 cycles; more isn't always better
3. **Combine with planning**: Use `useplanning=true` to track progress within each cycle
4. **Use MCP tools**: Enable relevant research tools for comprehensive data gathering
5. **Score thresholds**: Use score-based thresholds when you need graduated quality levels

### Advanced Examples

**Academic Research:**
```bash
mini-a goal="Survey recent advances in transformer architectures for NLP" \
  deepresearch=true \
  maxcycles=4 \
  validationgoal="Rate 1-10: coverage of papers (2023-2024), technical depth, citation quality" \
  validationthreshold="score>=0.8" \
  mcp="(cmd: 'docker run --rm -i mcp/arxiv-mcp')"
```

**Market Analysis:**
```bash
mini-a goal="Competitive analysis of project management SaaS tools" \
  deepresearch=true \
  maxcycles=3 \
  validationgoal="Validate: covers top 5 tools, includes pricing, features comparison, customer reviews" \
  useplanning=true
```

**Technical Documentation:**
```bash
mini-a goal="Document migration strategy from Python 2 to Python 3" \
  deepresearch=true \
  maxcycles=5 \
  validationgoal="Ensure: step-by-step process, common pitfalls, testing strategy, rollback plan" \
  validationthreshold="PASS" \
  useshell=true
```

## Advanced Features

Mini-A includes several advanced capabilities to optimize performance and resource usage when working with MCP tools and large-scale operations.

### Real-Time Token Streaming

Enable `usestream=true` to display LLM responses as they are generated, providing immediate feedback and reducing perceived latency.

**How it works:**
- Tokens are streamed from the LLM as they arrive
- Markdown elements are buffered intelligently to prevent visual artifacts
- Code blocks and tables are displayed only when complete
- Escape sequences in JSON responses are properly handled

**Console mode:**
```bash
mini-a goal="explain quantum computing" usestream=true
```

Tokens appear incrementally with markdown formatting applied in real-time.

**Web UI mode:**
```bash
./mini-a-web.sh onport=8888 usestream=true
```

The browser receives tokens via Server-Sent Events (SSE) and renders them progressively with debounced updates (80ms) for smooth display.

**Benefits:**
- Immediate visual feedback shows the agent is working
- Faster perceived response time for long answers
- Better user experience during complex reasoning
- Reduced waiting time before seeing results

**Limitations:**
- Not compatible with `showthinking=true` mode
- Falls back to non-streaming for raw prompt methods
- Requires model support for streaming APIs

**Technical details:**
- Uses `promptStreamWithStats` and `promptStreamJSONWithStats` methods
- Implements markdown-aware buffering for code blocks (``` delimiters) and tables (lines starting with |)
- Detects and properly handles escape sequences (\n, \t, \r, \b, \f, \/, \", \\) in streamed JSON, plus optional `\uXXXX` unicode decoding when `useascii=true`
- Adds initial newline before first output for clean formatting
- Flushes remaining buffers when streaming completes

### Parallel Tool Execution

When the model responds with multiple independent tool calls in the same step, Mini-A executes them concurrently, reducing overall latency for long-running MCP operations. This is particularly beneficial when:

- Fetching data from multiple external APIs simultaneously
- Running independent file operations in parallel
- Querying multiple databases or services at once

**How it works:**
- The agent analyzes tool calls within a single response
- Independent operations are identified and executed in parallel
- Results are collected and presented to the model together
- Sequential operations continue to run in order when dependencies exist

### Dynamic Tool Selection

Pair `usetools=true` with `mcpdynamic=true` to let Mini-A narrow the registered tool set via intelligent filtering. This feature is especially useful when working with large MCP catalogs where registering all tools would overwhelm the context window.

**Selection strategy (multi-stage):**
1. **Keyword heuristics** – Advanced matching on tool names, descriptions, and goal keywords using:
   - **Stemming** – Reduces words to root forms (search/searching/searched → search)
   - **Synonym matching** – Recognizes semantic equivalents (find=search, file=document, etc.)
   - **N-gram extraction** – Captures multi-word phrases like "file system" or "database query"
   - **Fuzzy matching** – Tolerates typos using Levenshtein distance (≤2 character changes)
2. **Low-cost LLM inference** – If `OAF_LC_MODEL` is configured, the cheaper model proposes a shortlist
3. **Primary model inference** – The main model performs selection when the low-cost tier doesn't return results
4. **Connection chooser fallback** – When no tools match, asks LLM to choose the most relevant MCP connection
5. **Fallback to full catalog** – If all stages return empty, Mini-A registers everything to ensure no tools are hidden

**Benefits:**
- Reduced context window usage through intelligent filtering
- Faster tool registration with multi-stage selection
- Lower token costs for large tool catalogs
- Semantic understanding beyond exact keyword matches
- Graceful degradation when filtering fails
- Detailed metrics tracking selection method effectiveness

### Tool Caching & Optimization

Mini-A implements smart caching for deterministic and read-only tools to avoid redundant operations.

**Caching criteria:**
- Tools marked with `annotations.readOnlyHint`
- Tools marked with `annotations.idempotentHint`
- Tools with explicit caching metadata

**Configuration:**
- Use `toolcachettl=<ms>` to set the default cache window
- Override per-tool via metadata
- Results are keyed by tool name and parameters
- Cache is maintained within a single session

**Smart context caching:**
- System prompts are cached across sessions
- Tool schema summaries are reused
- Consistent instructions even as tool rosters grow
- Minimizes repeated token overhead

### Lazy MCP Initialization

Pass `mcplazy=true` to defer establishing MCP connections until a tool is actually needed. This optimization significantly shortens startup times when working with many optional integrations.

**When to use:**
- Multiple MCP servers configured but not all needed for every goal
- Slow-starting MCP servers
- Network-based MCP connections with high latency
- Development environments with optional tools

**Benefits:**
- Faster agent startup
- Reduced resource consumption
- Connections only established when needed
- Failed connections don't block startup

**Example:**

```bash
mini-a goal="analyze local files" \
  mcp="[(cmd: 'ojob mcps/mcp-db.yaml...'), (cmd: 'ojob mcps/mcp-net.yaml...')]" \
  mcplazy=true \
  usetools=true
```

## MCP Integration Deep Dive

Mini-A provides comprehensive support for Model Context Protocol (MCP) servers, enabling integration with databases, APIs, file systems, and custom tools.

### Understanding MCP Server Types

Mini-A supports two MCP server communication modes:

#### STDIO MCP Servers

**How they work:**
- Process spawned locally with command specified in `mcp.cmd`
- Communication via standard input/output streams
- Server lifecycle managed by Mini-A
- Automatic cleanup on session end

**When to use:**
- Local tool integrations
- Database connections
- File system operations
- Quick prototyping

**Example:**
```bash
mini-a goal="query database" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa')"
```

#### HTTP(S) MCP Servers

**How they work:**
- MCP server runs as independent HTTP service
- Mini-A connects via `mcp.url`
- Server lifecycle independent of Mini-A
- Can be shared across multiple agents

**When to use:**
- Shared services across teams
- Remote integrations
- Production deployments
- Load balancing scenarios

**Example:**
```bash
# Start MCP server separately
ojob mcps/mcp-ssh.yaml onport=8888 ssh=ssh://user@host

# Connect Mini-A to HTTP MCP
mini-a goal="check remote server" \
  mcp="(type: remote, url: 'http://localhost:8888/mcp')"
```

### Multiple MCP Orchestration

Mini-A can coordinate multiple MCP servers simultaneously, enabling complex cross-system workflows.

#### Example: Docker Hub + Wikipedia Cross-Reference

```bash
mini-a \
  goal="get the latest top 20 tags used by library/ubuntu, cross-check those tag names with the list of Ubuntu releases in Wikipedia, and produce a table with ubuntu release, tag name and latest push date" \
  mcp="[(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000), (cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)]" \
  rpm=20 \
  tpm=80000 \
  __format=md
```

#### Example: Database + S3 + Email Integration

```bash
mini-a \
  goal="query invoices from database, archive to S3, and email summary" \
  mcp="[
    (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:postgresql://localhost/billing', timeout: 5000),
    (cmd: 'ojob mcps/mcp-s3.yaml bucket=invoices-archive', timeout: 5000),
    (cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=billing@example.com', timeout: 5000)
  ]" \
  rpm=15
```

#### Example: Multi-Database Federation

```bash
mini-a \
  goal="compare customer data between production and warehouse databases" \
  mcp="[
    (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:postgresql://prod-db/customers', timeout: 5000),
    (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:mysql://warehouse-db/analytics', timeout: 5000)
  ]" \
  usetools=true
```

### Built-in MCP Servers

Mini-A includes several production-ready MCP servers in the `mcps/` directory:

#### Mini-A Agent Runner (mcp-mini-a)
```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-mini-a.yaml', tool: run-goal, params: (goal: 'draft release notes for vNext', format: 'md', useplanning: true))"
```

This MCP lets other automations trigger Mini-A itself. Provide the `goal` alongside optional formatting or planning flags (`format`, `raw`, `chatbotmode`, `useplanning`, `planmode`, `planformat`, `convertplan`). Sensitive toggles—including knowledge packs or custom rules—must be set when you launch the server and are not exposed to remote callers. Pass them as `knowledge=` or `rules=` arguments when starting `ojob mcps/mcp-mini-a.yaml`. The response includes the final answer, execution status, and metric counters.

The server identity and the `run-goal` tool description are **templatable** at launch time, making it easy to run purpose-specific instances without duplicating the YAML:

| Parameter | What it controls | Default |
|---|---|---|
| `servername` | `serverInfo.name` advertised to MCP clients | `mini-a-agent` |
| `servertitle` | Human-readable server title | `OpenAF mini-a MCP agent runner server` |
| `tooldesc` | Description of the `run-goal` tool shown to the model | *(built-in)* |
| `toolprefix` | Prefix prepended to every exposed tool name | *(none)* |

```bash
# Coding assistant persona on port 9000
ojob mcps/mcp-mini-a.yaml \
  servername="coder-agent" \
  servertitle="Mini-A Coding Assistant" \
  tooldesc="Ask the coding agent to write, review, or fix code" \
  knowledge="You are an expert software engineer." \
  mode=code onport=9000

# Tool appears as devops-run-goal to the caller
ojob mcps/mcp-mini-a.yaml toolprefix="devops-" rules="[no-shell]" onport=9001
```

#### A2A Agent Bridge (mcp-a2a)
```bash
# Expose two external A2A-compliant agents as MCP tools
ojob mcps/mcp-a2a.yaml agents="http://agent1:9000,http://agent2:9000" onport=8888

# Use inside Mini-A to delegate tasks to an external A2A agent
mini-a goal="summarize last quarter's sales using the analyst agent" \
  mcp="(cmd: 'ojob mcps/mcp-a2a.yaml agents=http://analyst:9000')" \
  usetools=true
```

`mcp-a2a` bridges any **Google A2A-protocol** agent into Mini-A as MCP tools. At startup it fetches each agent's `/.well-known/agent.json` Agent Card, registers its skills, and exposes two tools: `a2a-agents` (list/discover agents and skills) and `a2a-task` (send a task via JSON-RPC 2.0 and wait for the result). This enables Mini-A to interoperate with agents built on LangGraph, Vertex AI ADK, CrewAI, or any other A2A-compatible framework.

#### Database Operations (mcp-db)
```bash
mini-a goal="create a test table with European countries" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)"
```

#### Time & Timezone Utilities (mcp-time)
```bash
mini-a goal="what time is it in Sydney right now?" \
  mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)"
```

#### Network Utilities (mcp-net)
```bash
mini-a goal="check if port 80 is open on google.com" \
  mcp="(cmd: 'ojob mcps/mcp-net.yaml', timeout: 5000)"
```

#### SSH Execution (mcp-ssh)
```bash
mini-a goal="run 'uptime' on remote host via SSH MCP" \
  mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false', timeout: 5000)"
```

#### S3 Operations (mcp-s3)
```bash
# Read-only by default; add readwrite=true to enable writes
mini-a goal="list the latest invoices in our S3 bucket" \
  mcp="(cmd: 'ojob mcps/mcp-s3.yaml bucket=finance-archive prefix=invoices/', timeout: 5000)"
```

#### Office Documents (mcp-office)
```bash
# Read XLSX/DOCX content; add readwrite=true to enable write operations
mini-a goal="pull the first 10 rows from the Finance sheet" \
  mcp="(cmd: 'ojob mcps/mcp-office.yaml root=./data', timeout: 5000)" \
  knowledge="- prefer xlsx-read-table with sheet='Finance' startColumn='A' startRow=1 maxRows=10"
```

#### RSS Monitoring (mcp-rss)
```bash
mini-a goal="summarize the last five posts from the OpenAI blog" \
  mcp="(cmd: 'ojob mcps/mcp-rss.yaml', timeout: 5000)" \
  knowledge="- prefer bullet lists"
```

#### Market Data (mcp-fin)
```bash
mini-a goal="compare AAPL and MSFT revenue trends" \
  mcp="(cmd: 'ojob mcps/mcp-fin.yaml', timeout: 5000)"
```

#### Email Operations (mcp-email)
```bash
mini-a goal="send a test email" \
  mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=test@example.com', timeout: 5000)"
```

#### Local Shell MCP (mcp-shell)
```bash
# Inherits the command allow/deny list
mini-a goal="collect disk usage stats" \
  mcp="(cmd: 'ojob mcps/mcp-shell.yaml timeout=3000 shellallow=df,du', timeout: 5000)"
```

### MCP Configuration Patterns

#### Pattern 1: Development vs Production

```javascript
// Development: Local STDIO
var devAgent = new MiniA()
devAgent.start({
    goal: "test feature",
    mcp: "(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./test-db')"
})

// Production: HTTP MCP with load balancing
var prodAgent = new MiniA()
prodAgent.start({
    goal: "process requests",
    mcp: "(type: remote, url: 'https://mcp-lb.example.com/mcp')"
})
```

#### Pattern 2: Conditional MCP Loading

```javascript
var mcpConfig = []
if (needsDatabase) {
    mcpConfig.push("(cmd: 'ojob mcps/mcp-db.yaml ...')")
}
if (needsS3) {
    mcpConfig.push("(cmd: 'ojob mcps/mcp-s3.yaml ...')")
}

var agent = new MiniA()
agent.start({
    goal: "process data",
    mcp: "[" + mcpConfig.join(",") + "]",
    mcplazy: true  // Don't connect until needed
})
```

#### Pattern 3: MCP with Fallbacks

# Try primary MCP, fall back to backup
mini-a goal="fetch data" \
  mcp="[(type: remote, url: 'https://primary-mcp.example.com/mcp'), (type: remote, url: 'https://backup-mcp.example.com/mcp')]" \
  usetools=true
```

### Best Practices for MCP Integration

1. **Security First**
   - Use `readwrite=false` by default for MCP servers
   - Apply `shellallow`/`shellbanextra` filters to shell-based MCPs
   - Validate MCP server authentication
   - Use HTTPS for remote MCP connections

2. **Performance Optimization**
   - Enable `mcplazy=true` when using multiple optional MCPs
   - Use `mcpdynamic=true` with large tool catalogs
   - Set appropriate `timeout` values per MCP
   - Consider HTTP MCPs for high-latency operations

3. **Error Handling**
   - Configure circuit breakers for flaky MCPs
   - Use exponential backoff for transient failures
   - Monitor MCP connection health
   - Implement graceful degradation

4. **Resource Management**
   - Close unused MCP connections
   - Set reasonable timeout values
   - Monitor memory usage with multiple MCPs
   - Use connection pooling for HTTP MCPs

5. **Development Workflow**
   - Start with single MCP and add incrementally
   - Test MCPs independently before orchestration
   - Use verbose logging during development
   - Document MCP dependencies in your goals

For more information on creating custom MCP servers, see [Creating MCPs](mcps/CREATING.md).

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
export OAF_MODEL="(type: gemini, model: gemini-2.5-pro, key: 'your-gemini-key')"
export OAF_LC_MODEL="(type: gemini, model: gemini-2.5-flash, key: 'your-gemini-key')"
# Both main and low-cost Gemini models auto-enable no-JSON prompt behavior when these are unset.
# No manual override needed; set explicitly only to force the opposite behavior:
# export OAF_MINI_A_NOJSONPROMPT=false
# export OAF_MINI_A_LCNOJSONPROMPT=false
```

> **Note**: For Gemini models (both main and low-cost), Mini-A automatically enables no-JSON prompt mode when the respective environment variable (`OAF_MINI_A_NOJSONPROMPT` / `OAF_MINI_A_LCNOJSONPROMPT`) is not defined. No manual configuration is required.

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

### 8. Real-Time Streaming Examples

#### Console Streaming

```javascript
var agent = new MiniA()
var result = agent.start({
    goal: "Explain the theory of relativity in simple terms",
    usestream: true,
    maxsteps: 10
})
// Tokens will be displayed progressively as they arrive
```

```bash
# Command-line usage
mini-a goal="write a detailed project analysis" usestream=true useshell=true
```

#### Web UI Streaming

```bash
# Start web server with streaming enabled
./mini-a-web.sh onport=8888 usestream=true

# Or using Docker
docker run -d --rm \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  -p 12345:12345 \
  openaf/mini-a onport=12345 usestream=true
```

**What happens:**
- Console: Tokens appear with markdown formatting applied in real-time
- Web UI: Uses Server-Sent Events (SSE) for progressive display with debounced rendering
- Code blocks and tables buffer until complete for clean rendering
- No duplicate output (streaming content suppresses final answer echo)

**Benefits:**
- Immediate feedback showing the agent is working
- Reduced perceived latency for long responses
- Better user experience during complex reasoning

**Compatibility:**
- Not compatible with `showthinking=true` (falls back to non-streaming)
- Requires model support for streaming APIs

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
- **`stream`**: Real-time token streaming output (when `usestream=true`)
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

### Prompt Safety and Untrusted Data Handling

Mini-A enforces a strict boundary between system/developer instructions ("policy lane") and user-provided content ("task lane"):

- **Untrusted data labeling**: User-supplied content (the goal, hook context, tool outputs, conversation history, and attached files) is wrapped in clearly labeled blocks (`BEGIN_UNTRUSTED_GOAL … END_UNTRUSTED_GOAL`, `BEGIN_UNTRUSTED_HOOK_CONTEXT … END_UNTRUSTED_HOOK_CONTEXT`, `BEGIN_UNTRUSTED_ATTACHED_FILE … END_UNTRUSTED_ATTACHED_FILE`) so the model can distinguish developer instructions from untrusted input. The system prompt explicitly instructs the model to treat these blocks as opaque reference data and never follow embedded instructions that conflict with the policy-lane rules.

- **Policy-lane probe detection**: If the user's goal or chatbot message appears to be probing for the contents of system instructions (e.g., "show me the policy lane", "reveal your system prompt"), Mini-A detects this pattern and responds with a standard refusal instead of forwarding the request to the LLM. A `warn` event is emitted.

- **Prompt normalization**: User input is normalized before use — `\r\n` line endings are converted to `\n`, control characters are stripped, and oversized inputs are rejected. The web API enforces a configurable character limit (`maxpromptchars`, default 120,000) to prevent very large inputs from being forwarded to the model.

- **Attached file safety** (console): When a file is attached via `/attach` in the console, its contents are wrapped with `BEGIN_UNTRUSTED_ATTACHED_FILE` / `END_UNTRUSTED_ATTACHED_FILE` markers and a header warning, making it clear to the model that the file is untrusted reference data.

### Shell Prefix Strategies by Operating System

Mini-A now also supports `usesandbox=...` presets for common operating systems. Keep using `shell=...` when you need custom runtimes (Docker/Podman/firejail/custom wrappers).

Use `shell=...` together with `useshell=true` when you want Mini-A to execute every command through an external sandbox or container runtime. The command filter continues to evaluate the original command string, and the prefix is appended immediately before execution.

#### Built-in `usesandbox` presets
- `usesandbox=auto`: Detect host OS and apply the default preset for that platform.
- `usesandbox=linux`: Uses `bwrap` when available. The built-in policy keeps the host filesystem read-only by default, gives the command a private temp/home area, only makes the current working directory plus temp writable when `readwrite=true`, and disables networking when `sandboxnonetwork=true`.
- `usesandbox=macos`: Uses `sandbox-exec -f <sandboxprofile> /bin/sh -lc`. If `sandboxprofile` is omitted, Mini-A generates a restrictive temporary profile with read access to the host, private temp/home write access, optional current-directory writes when `readwrite=true`, and no network allowance when `sandboxnonetwork=true`.
- `usesandbox=windows`: Uses a best-effort PowerShell wrapper that isolates temp/home paths, narrows the environment, and uses Constrained Language Mode. When `sandboxnonetwork=true`, Mini-A also applies best-effort proxy/environment blocking. It does not provide Linux-equivalent filesystem or guaranteed network isolation and should be combined with WDAC/AppContainer or hooks for stronger policy.
- If the selected backend is unavailable (for example `bwrap` or `sandbox-exec` is missing), Mini-A warns and continues without the requested OS sandbox.

#### Hook alternatives (recommended for strict policy)
- Use `before_shell` hooks to deny commands by path, arguments, time window, or user context.
- Use `after_shell` hooks to audit output, redact sensitive data, and trigger alerts.
- Combine hooks with `usesandbox`/`shell=` so both policy checks and OS-level sandboxing or wrappers are active.

#### macOS (sandbox-exec)
- **Use the built-in restriction flags when:** you only need to block specific binaries (e.g. combine `shellallow`, `shellbanextra`, `shellallowpipes`, and `checkall=true`). This keeps commands on the host without additional tooling.
- **Use built-in `usesandbox=macos` when:** you want Mini-A to generate a restrictive host sandbox automatically, with `readwrite=true` widening writes only to the current working directory and temp paths.
- **Use `shell=` when:** you want a custom `.sb` profile or a stronger container/runtime boundary than the built-in host profile.
- **Pros:** native host restrictions, no additional daemons required, works on Intel and Apple Silicon.
- **Cons:** `sandbox-exec` availability varies by macOS version; profiles can still need tuning for some developer tools.
- **Generated profile behavior:** read access to the host is allowed, writes go to the private sandbox temp/home by default, and `readwrite=true` adds current-directory writes.
- **Network control:** set `sandboxnonetwork=true` to omit `network*` from the generated profile.
- **Example:**
  ```bash
  mini-a goal="catalog ~/Projects" useshell=true usesandbox=macos
  ```

#### Linux (bubblewrap)
- **Use built-in `usesandbox=linux` when:** `bwrap` is installed and you want read-only host access by default with a private temp/home area.
- **Use `shell=` when:** you need a containerized runtime, custom namespace/network policy, or a guaranteed writable environment beyond Mini-A's `readwrite=true` handling.
- **Pros:** strongest built-in isolation, namespace separation, clear writable scope when enabled.
- **Cons:** depends on `bwrap`; if unavailable Mini-A warns and falls back to unsandboxed execution.
- **Behavior:** host filesystem is read-only by default, `readwrite=true` adds writes to the current working directory and temp paths only.
- **Network control:** set `sandboxnonetwork=true` to add `--unshare-net`.

#### Windows (best effort PowerShell)
- **Use built-in `usesandbox=windows` when:** you want safer defaults around temp/home isolation and a reduced PowerShell environment without adding extra tooling.
- **Use `shell=` or platform tooling when:** you need enforceable OS policy such as WDAC, AppContainer, Windows Sandbox, or another external isolation boundary.
- **Pros:** no extra dependency, clearer warnings, isolated temp/home paths for command execution.
- **Cons:** best-effort only; no Linux-equivalent namespace or filesystem enforcement.
- **Behavior:** PowerShell runs with `ConstrainedLanguage`, isolated temp/home paths, and explicit warnings about the weaker protection level.
- **Network control:** `sandboxnonetwork=true` only applies best-effort proxy/environment blocking; use WDAC/AppContainer/Windows Sandbox if you need enforceable network isolation.

#### macOS Sequoia (container CLI)
- **Use the restriction flags when:** you trust the host environment and just need confirmation prompts or per-command allowlists.
- **Use `shell=` when:** you prefer to run the agent inside an isolated macOS container started with Apple's `container` CLI.
- **Pros:** lightweight sandbox with full POSIX tooling, easy to reuse across sessions (`container exec`).
- **Cons:** requires macOS 15+ and the Container feature, container lifecycle must be managed separately.
- **Example:**
  ```bash
  container run --detach --name mini-a --image docker.io/library/ubuntu:24.04 sleep infinity
  mini-a goal="inspect /work" useshell=true shell="container exec mini-a"
  ```

#### Linux / macOS / Windows WSL (Docker)
- **Use the restriction flags when:** you are confident with host-level execution but still want Mini-A to stop on risky commands.
- **Use `shell=` when:** you want every command to run inside a long-lived Docker container (ideal for destructive or dependency-heavy workloads).
- **Pros:** mature isolation, bind mounts for controlled file access, easy to snapshot/destroy containers.
- **Cons:** Docker daemon required; manage image updates separately; host files must be mounted explicitly.
- **Example:**
  ```bash
  docker run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
  mini-a goal="summarize git status" useshell=true shell="docker exec mini-a-sandbox"
  ```

#### Linux / macOS / Windows WSL (Podman)
- **Use the restriction flags when:** rootless execution plus Mini-A's confirmation prompts are sufficient.
- **Use `shell=` when:** you prefer Podman's daemonless containers or want rootless isolation without Docker.
- **Pros:** rootless-friendly, integrates with systemd socket activation, shares the Docker CLI syntax.
- **Cons:** rootless volumes may need additional SELinux/AppArmor policy; ensure the container stays running.
- **Example:**
  ```bash
  podman run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work docker.io/library/fedora:latest sleep infinity
  mini-a goal="list source files" useshell=true shell="podman exec mini-a-sandbox"
  ```

> **Tip:** Mix and match strategies. `shellallow`, `shellbanextra`, `shellallowpipes`, `checkall`, and `before_shell`/`after_shell` hooks remain separate policy layers even when `usesandbox` or `shell=` is active.

## Advanced Usage Patterns

### Conversation Persistence

```javascript
var agent = new MiniA()
agent.start({
    goal: "Continue our previous discussion about code optimization",
    conversation: "chat-history.json"
})
```

Resume the last conversation directly from the interactive console:

```bash
mini-a conversation=chat-history.json resume=true
```

Or keep console sessions in the default history folder and choose one interactively when resuming:

```bash
mini-a usehistory=true historykeep=true resume=true
```

Console history payloads now keep both `created_at` and `updated_at` timestamps in addition to the conversation entries, which makes retention and manual inspection easier.

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

Provide extra numbered rules to the system prompt using the `rules` parameter. Supply them as a JSON or SLON array so they are injected verbatim, or specify a file path to load the rules from.

```javascript
// Inline rules
var agent = new MiniA()
agent.start({
    goal: "Review generated SQL queries",
    rules: "[ 'Never run destructive DDL statements', 'Use markdown tables for final summaries' ]"
})

// Or load rules from a file
agent.start({
    goal: "Review generated SQL queries",
    rules: "path/to/custom-rules.md"
})
```

### Loading Knowledge and Rules from Files

When using the CLI or Docker, you can load knowledge and rules from files using shell command substitution:

**Load knowledge from file:**
```bash
mini-a goal="implement authentication feature" \
  knowledge="$(cat KNOWLEDGE.md)" \
  useshell=true
```

**Load rules from file:**
```bash
mini-a goal="review SQL queries" \
  rules="$(cat RULES.md)" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data')"
```

**Load both knowledge and rules:**
```bash
mini-a goal="refactor codebase following standards" \
  knowledge="$(cat project-context.md)" \
  rules="$(cat coding-standards.md)" \
  useshell=true readwrite=true
```

**In Docker with file loading:**
```bash
docker run --rm -ti \
  -v $(pwd):/work -w /work \
  -e OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000)" \
  openaf/mini-a \
  goal="implement feature following guidelines" \
  knowledge="$(cat /work/KNOWLEDGE.md)" \
  rules="$(cat /work/RULES.md)" \
  useshell=true
```

This approach is useful when:
- Knowledge or rules are too large to pass inline
- You want to version control your knowledge/rules separately
- You need to share the same context across multiple Mini-A invocations
- You're automating Mini-A execution in scripts or CI/CD pipelines

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

- Call `agent.getMetrics()` to obtain a snapshot grouped by LLM usage, outcomes, shell approvals/denials, context management, summarization activity, system prompt budgeting, context compression, and per-tool call statistics.
- Console history flows also update `history` metrics so you can track started/resumed sessions plus kept/deleted conversation files when using `mini-a-con`, including separate counters for age-based and count-based pruning.
- OpenAF automatically registers these counters under the `mini-a` namespace via `ow.metrics.add('mini-a', ...)`, so collectors that understand OpenAF metrics can scrape them.
- Metrics are updated live as the agent progresses, making them ideal for dashboards or alerting when an agent gets stuck.

### Metric breakdown

`MiniA.getMetrics()` returns a nested object. Each top-level key contains the counters listed below.

| Path | Counters | Description |
|------|----------|-------------|
| `llm_calls` | `normal`, `low_cost`, `total`, `fallback_to_main` | Request volume per model tier and how often the session escalated back to the main model after low-cost failures. |
| `goals` | `achieved`, `failed`, `stopped` | High-level result of the current run. |
| `actions` | `thoughts_made`, `thinks_made`, `finals_made`, `mcp_actions_executed`, `mcp_actions_failed`, `shell_commands_executed`, `shell_commands_blocked`, `shell_commands_approved`, `shell_commands_denied`, `unknown_actions` | Operational footprint: mental steps, final responses, MCP usage, and shell gatekeeping outcomes. |
| `user_interaction` | `requests`, `completed`, `failed` | Interactive console prompt metrics for the `userInput` Mini Utils tool. Only increments when `useutils=true` and the session is running through `mini-a-con`. |
| `planning` | `disabled_simple_goal`, `plans_generated`, `plans_validated`, `plans_validation_failed`, `plans_replanned` | Visibility into the planning engine—when it was bypassed, generated plans, LLM critique validation passes/failures, and replans triggered by runtime feedback. The `plans_validated` counter tracks all LLM critiques run, while `plans_validation_failed` counts verdicts of `REVISE`. Dynamic replanning adjustments are logged separately in plan metadata. |
| `performance` | `steps_taken`, `total_session_time_ms`, `avg_step_time_ms`, `max_context_tokens`, `llm_estimated_tokens`, `llm_actual_tokens`, `llm_normal_tokens`, `llm_lc_tokens` | Execution pacing and token consumption for cost analysis. |
| `behavior_patterns` | `escalations`, `escalation_consecutive_errors`, `escalation_consecutive_thoughts`, `escalation_thought_loop`, `escalation_steps_without_action`, `escalation_similar_thoughts`, `escalation_context_window`, `retries`, `consecutive_errors`, `consecutive_thoughts`, `json_parse_failures`, `action_loops_detected`, `thinking_loops_detected`, `similar_thoughts_detected` | Signals that highlight unhealthy loops or parser problems. Per-reason escalation counters show which trigger fires most frequently. |
| `summarization` | `summaries_made`, `summaries_skipped`, `summaries_forced`, `context_summarizations`, `summaries_tokens_reduced`, `summaries_original_tokens`, `summaries_final_tokens` | Auto-summarization activity and token savings. |
| `tool_selection` | `dynamic_used`, `keyword`, `llm_lc`, `llm_main`, `connection_chooser_lc`, `connection_chooser_main`, `fallback_all` | Dynamic tool selection metrics tracking how tools are selected when `mcpdynamic=true`. Shows usage of keyword matching, LLM-based selection (low-cost and main models), connection-level chooser fallbacks, and full catalog fallback. Includes stemming, synonym matching, n-grams, and fuzzy matching capabilities. |
| `tool_cache` | `hits`, `misses`, `total_requests`, `hit_rate` | Tool result caching metrics for deterministic and read-only MCP tools. Tracks cache effectiveness and provides hit rate percentage. |
| `mcp_resilience` | `circuit_breaker_trips`, `circuit_breaker_resets`, `lazy_init_success`, `lazy_init_failed` | MCP resilience and optimization metrics. Circuit breaker trips/resets track connection health management. Lazy initialization metrics show deferred MCP connection establishment when `mcplazy=true`. |
| `context_compression` | `prompt_context_selections`, `prompt_context_compressed`, `prompt_context_tokens_saved`, `goal_block_compressed`, `goal_block_tokens_saved`, `hook_context_compressed`, `hook_context_tokens_saved` | Automatic context compression activity. `prompt_context_selections` counts how many times compressed context was offered to the model; `*_compressed` counters increment when compression achieved >30% token reduction on the respective block; `*_tokens_saved` accumulate the tokens removed by compression across the session. |
| `system_prompt` | `system_prompt_builds`, `system_prompt_tokens_total`, `system_prompt_tokens_last`, `system_prompt_tokens_avg`, `system_prompt_budget_applied`, `system_prompt_budget_tokens_saved`, `system_prompt_examples_dropped`, `system_prompt_skill_descriptions_dropped`, `system_prompt_tool_details_dropped`, `system_prompt_planning_details_dropped`, `system_prompt_skills_trimmed`, `system_prompt_last_meta` | System prompt construction and budget trimming. `system_prompt_builds` counts total builds; `*_tokens_*` track token cost (total, last, computed average). When the prompt exceeds `systempromptbudget`, `system_prompt_budget_applied` increments and `system_prompt_budget_tokens_saved` records savings. Each `*_dropped` counter records how many times that section was omitted (priority order: examples → skill descriptions → tool details → planning details). `system_prompt_skills_trimmed` counts trims of individual skill bodies. `system_prompt_last_meta` is the raw metadata object from the most recent build (useful for debugging budget decisions). |
| `per_tool_usage` | `<toolName>.calls`, `<toolName>.successes`, `<toolName>.failures` | Per-tool call statistics. Keys are tool names; each entry tracks total invocations, successful completions, and failures. Useful for identifying flaky or heavily-used tools. Only tools that have been invoked at least once appear in this map. |
| `delegation` | `total`, `running`, `completed`, `failed`, `cancelled`, `timedout`, `retried`, `worker_hint_used`, `worker_hint_matched`, `worker_hint_fallthrough`, `workers_total`, `workers_static`, `workers_dynamic`, `workers_healthy` | Subtask delegation metrics (when `usedelegation=true`). Tracks child agent lifecycle and retries. `worker_hint_used` counts subtasks where a `workerHint` was specified; `worker_hint_matched` counts those where the hint resolved to a specific worker; `worker_hint_fallthrough` counts hints that found no match and fell back to default selection. Worker pool counters reflect current composition and health. For per-subtask average duration and max nesting depth, call `agent._subtaskManager.getMetrics()` directly. |
| `deep_research` | `sessions`, `cycles`, `validations_passed`, `validations_failed`, `early_success`, `max_cycles_reached` | Deep research mode metrics (when `deepresearch=true`). `sessions` counts research sessions started; `cycles` accumulates all research-and-validate cycles run across sessions. `validations_passed`/`validations_failed` split LLM validation verdicts. `early_success` counts sessions that passed validation before exhausting cycles; `max_cycles_reached` counts those that hit the cycle limit without passing. |
| `history` | `sessions_started`, `sessions_resumed`, `files_kept`, `files_deleted`, `files_deleted_by_period`, `files_deleted_by_count` | Console conversation history metrics. Tracks new vs resumed console sessions, how many history files were kept, and how many were pruned overall, by age rule, or by count rule. |

These counters mirror what is exported via `ow.metrics.add('mini-a', ...)`, so the same structure appears in Prometheus/Grafana when scraped through OpenAF.

Example:

```javascript
var agent = new MiniA()
agent.start({ goal: "List files", useshell: true })
log(agent.getMetrics())
```

To poll the OpenAF registry directly, use `ow.metrics.get("mini-a")` from another job or expose it through your usual monitoring bridge.

### Per-Session Cost Statistics

`MiniA.getCostStats()` returns a per-run cost breakdown separated by model tier. Unlike the global counters in `getMetrics()`, this snapshot resets at the start of each `start()` call, making it suitable for billing or budgeting per individual goal:

```javascript
var agent = new MiniA()
agent.start({ goal: "Analyze logs", lcbudget: 50000 })
log(agent.getCostStats())
// Example output:
// {
//   lc  : { calls: 12, totalTokens: 38200, estimatedUSD: 0 },
//   main: { calls: 2,  totalTokens: 4800,  estimatedUSD: 0 }
// }
```

The `estimatedUSD` field is reserved for future cost estimation integration and is currently always `0`.

## Related Documentation

- **[Quick Reference Cheatsheet](CHEATSHEET.md)** - Fast lookup for all parameters and common patterns
- **[Performance Optimizations](docs/OPTIMIZATIONS.md)** - Built-in optimizations for token reduction and cost savings
- **[Delegation Guide](docs/DELEGATION.md)** - Hierarchical task decomposition with local and remote delegation
- **[What's New](docs/WHATS-NEW.md)** - Latest performance improvements and migration guide
- **[MCP Documentation](mcps/README.md)** - Built-in MCP servers catalog
- **[Creating MCPs](mcps/CREATING.md)** - Build custom MCP integrations
- **[External MCPs](mcps/EXTERNAL-MCPS.md)** - Community MCP servers
- **[Contributing Guide](CONTRIBUTING.md)** - Join the project

## Working Memory (Structured Runtime State)

Mini-A now maintains a managed memory model backed by `MiniAMemoryManager`:
- `state.workingMemorySession` (session-local memory; persisted via `memorysessionch` or namespaced key in `memorych`),
- `state.workingMemoryGlobal` (durable memory loaded/saved via `memorych`),
- `state.workingMemory` (resolved view used by runtime prompts).

### Schema

```json
{
  "schemaVersion": 1,
  "sections": {
    "facts": [],
    "evidence": [],
    "openQuestions": [],
    "hypotheses": [],
    "decisions": [],
    "artifacts": [],
    "risks": [],
    "summaries": []
  }
}
```

Each entry carries metadata (`id`, `value`, timestamps, `status`, optional `provenance`, optional `evidenceRefs`, and stale/unresolved flags).

### Lifecycle Hooks

When `usememory=true`, Mini-A initializes memory stores at run start and resolves reads using:
- `memoryscope=session`: read session memory only,
- `memoryscope=global`: read global memory only,
- `memoryscope=both`: read session first, then global fallback (session entries win on conflicts).

**Write routing under `memoryscope=both`**: when a dedicated `memorysessionch` is configured, default runtime writes go to the session store. When only `memorych` is set (no dedicated session channel), writes go to the global store for backward compatibility. Use `_memoryAppend(..., { memoryScope: "session" })` or `{ memoryScope: "global" }` to force a specific target regardless of routing rules.

**Session persistence**: if `memorysessionch` is set it is used as a dedicated channel (option A); otherwise, if `memorych` is set, session memory is persisted to the same channel under key `session::<sessionId>` (option B).

**Auto-promotion and staleness**: at session end (after final answer synthesis), Mini-A runs `_autoPromoteSessionToGlobal()` when `memorypromote` is non-empty. For each configured section it uses a **refresh-or-append** strategy — near-duplicate global entries have their `confirmedAt` timestamp and `confirmCount` incremented rather than duplicated; new entries are appended. After promotion, if `memorystaledays > 0`, a sweep marks all global entries whose `confirmedAt` (or `createdAt` for legacy entries) exceeds the threshold as `stale=true`. Stale entries remain in the store and visible to the LLM but are deprioritized and evicted first when compaction runs.

Mini-A then updates memory incrementally after:
- planning generation/critique,
- tool calls,
- shell execution,
- validation cycles,
- delegated subtask completion,
- final answer synthesis.

### Context Injection and `memory_search`

By default (`memoryinject=summary`), the step context contains only a compact section-count map — e.g. `workingMemory:{facts:12,decisions:3}` — instead of all entry content. This reduces per-step memory token overhead by ~95% while letting the model fetch entries on demand using the built-in `memory_search` action:

```json
{
  "thought": "I need to recall what decisions were made about authentication",
  "action": "memory_search",
  "params": { "query": "authentication decision", "section": "decisions", "limit": 5 }
}
```

`memory_search` params:
- `query` (required) — keyword string matched against entry values
- `section` (optional) — restrict to one section (`facts`, `decisions`, `evidence`, `openQuestions`, `hypotheses`, `artifacts`, `risks`, `summaries`)
- `limit` (optional, default `10`) — max results per section

Results are keyword-scored (word overlap) and returned as TOON text in the step context. Use `memoryinject=full` to restore the previous behaviour of embedding all compact entries in every step prompt.

### Extension Points

Runtime helpers available in code:
- `_memoryAppend(section, value, meta)`
- `_memoryUpdate(section, id, patch)`
- `_memoryRemove(section, id)`
- `_memoryAttachEvidence(section, id, evidenceId)`
- `_memoryMarkStatus(section, id, status, supersededBy)`
- `_memorySearch(query, { section, maxPerSection })` — keyword search across all active managers; returns `{ sectionName: [compactEntries] }`
- `promoteSessionMemory(section, ids)` (explicit session → global promotion)
- `clearSessionMemory(sessionId)` (session cleanup hook)

These wrappers keep state sync/persistence centralized (instead of ad-hoc direct writes).
