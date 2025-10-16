# OpenAF mini-a

![/.github/version.svg](/.github/version.svg)

Mini-A is a minimalist autonomous agent that uses LLMs, shell commands and/or MCP stdio or http(s) servers to achieve user-defined goals. It is designed to be simple, flexible, and easy to use. Can be used as a library, command-line tool, or embedded interface in other applications.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Overview](#configuration-overview)
  - [Essential environment variables](#essential-environment-variables)
  - [Recommended model tiers](#recommended-model-tiers)
  - [Dual-model configuration (cost optimization)](#dual-model-configuration-cost-optimization)
  - [Common CLI parameters](#common-cli-parameters)
- [Running the agent](#running-the-agent)
- [Documentation](#documentation)
- [Model Compatibility & Tests](#model-compatibility--tests)

## Installation

1. [Install OpenAF](https://openaf.io/) (Mini-A runs as an OpenAF job).
2. Clone the repository and switch into it:

   ```bash
   git clone https://github.com/openaf/mini-a.git
   cd mini-a
   ```

   Prefer installing the packaged oPack instead? Run `opack install mini-a` from any OpenAF shell to fetch the latest release.

3. Ensure the shell helpers are executable if required by your platform:

   ```bash
   chmod +x mini-a.sh mini-a-web.sh
   ```

4. Export the `OAF_MODEL` environment variable with the model configuration you plan to use. The [Configuration Overview](#configuration-overview) section highlights common values and points to the full parameter reference.

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

## Configuration Overview

Consult [USAGE.md](USAGE.md) for the comprehensive configuration and flag reference. The subsections below surface the most common environment variables and runtime parameters so you can move from installation to a working configuration quickly.

### Essential environment variables

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

Optional environment tweaks:

- `OAF_FLAGS="(MD_DARKMODE: 'auto')"` – toggle the Markdown renderer theme when using the web UI

### Recommended model tiers

- **All uses (best)**: Claude Sonnet 4.5, OpenAI GPT-5, Google Gemini 2.5, OpenAI OSS 120B
- **Low cost (best)**: OpenAI GPT-5 mini, Amazon Nova Pro/Mini, OpenAI OSS 20B
- **Simple agent shell tool**: Gemma 3, Phi 4
- **Chatbot**: Mistral 7B, Llama 3.2 8B

### Dual-model configuration (cost optimization)

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

### Common CLI parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| `goal` | Natural-language instruction that the agent will satisfy. | `goal="summarize the error logs"` |
| `useshell` | Enables shell execution (disabled by default for safety). | `useshell=true` |
| `mcp` | Connects MCP servers. Accepts a single descriptor or an array. | `mcp="(cmd: 'ojob mcps/mcp-net.yaml')"` |
| `rpm` / `tpm` | Rate-limit requests per minute or total tokens processed. | `rpm=20 tpm=80000` |
| `__format` | Controls the output format requested from the model. | `__format=md` |
| `usetools` | Forces the agent to call a tool even if the model hesitates. | `usetools=true` |
| `chatbotmode` | Switches to a lighter prompt for conversational use. | `chatbotmode=true` |
| `useplanning` | Maintains a lightweight plan across steps in agent mode. | `useplanning=true` |

## Running the agent

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
# Database operations
mini-a.sh goal="create a test table with European countries" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" rpm=20

# Network utilities

# Time and timezone utilities
mini-a.sh goal="what time is it in Sydney right now?" mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)" rpm=20

# SSH execution (mcp-ssh)
mini-a.sh goal="run 'uptime' on remote host via SSH MCP" mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false', timeout: 5000)" rpm=20

mini-a.sh goal="check if port 80 is open on google.com" mcp="(cmd: 'ojob mcps/mcp-net.yaml', timeout: 5000)" rpm=20

# Email operations
mini-a.sh goal="send a test email" mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=test@example.com', timeout: 5000)" rpm=20
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

## Documentation

- **[Detailed Usage Guide](USAGE.md)** – Comprehensive guide covering all configuration options, examples, and best practices
- **[MCP Documentation](mcps/README.md)** – Catalog of available Model Context Protocol servers
- **[Creating MCPs](mcps/CREATING.md)** – Step-by-step guide for creating custom MCP servers
- **[External MCPs](EXTERNAL-MCPS.md)** – List of external MCP servers you can use with Mini-A
- **[Model tests and compatibility matrix](TESTS_MODELS.md)** – Baseline scenarios that highlight how different LLMs perform with Mini-A
- **[Contributing Guide](CONTRIBUTING.md)** – How to contribute to the project
- **[Code of Conduct](CODE_OF_CONDUCT.md)** – Community guidelines and standards

## Model Compatibility & Tests

Mini-A exercises shell access, MCP integrations, and chatbot mode differently depending on the language model. The [TESTS_MODELS.md](TESTS_MODELS.md) document walks through the repeatable scenarios we run—file inspection and network-tool flows—and records how popular models behave. In general, larger or more recent models have the reasoning ability and tool-handling reliability needed to pass every test, while smaller models may fail to follow multi-step instructions or produce valid tool payloads. Consult the matrix before adopting a new model so you can anticipate feature gaps and adjust expectations.

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
- **Built-in MCPs**: Includes database, network, time/timezone, email, data channel, and SSH execution MCP servers
- **Multiple MCP Connections**: Connect to multiple MCPs at once and orchestrate across them
- **Simple Web UI**: Lightweight embedded chat interface for interactive use (screenshot above)
- **Text Attachments in the Web UI**: When started with `useattach=true`, upload and review text files alongside your prompt with collapsible previews in the conversation log
- **Chatbot Mode**: Toggle `chatbotmode=true` to strip agent-style instructions and chat with the model in a lightweight assistant mode
- **Safety Features**: Command filtering, confirmation prompts, and read-only modes
- **Conversation Persistence**: Save and resume conversations across sessions
- **Automatic Context Summarization**: Keeps context within limits with auto-summarize when it grows
- **Rate Limiting**: Built-in rate limiting for API usage control
- **Metrics & Observability**: Built-in counters surfaced via `MiniA.getMetrics()` and OpenAF's `ow.metrics` registry for dashboards.

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

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Code contribution process
- Development setup
- Pull request guidelines
- Community standards

## Community

- **Issues**: [GitHub Issues](https://github.com/openaf/mini-a/issues)
- **Discussions**: [GitHub Discussions](https://github.com/openaf/mini-a/discussions)
- **Email**: openaf@openaf.io

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
