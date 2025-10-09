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
| AWS | nova-pro | ```(type: bedrock, timeout: 900000, options: (model: 'amazon.nova-pro-v1:0', temperature: 0))``` | After installing OpenAF's oPack "AWS" add to mini-a calls ```libs="aws.js"``` |
| AWS | claude-sonnet-4.5 | ```(type: bedrock, timeout: 900000, options: (model: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', region: eu-west-1, temperature: 0, params:(max_tokens: 200000)))``` | After installing OpenAF's oPack "AWS" add to mini-a calls ```libs="aws.js"``` |
| Ollama | gemma3n | ```(type: ollama, model: 'gemma3', url: 'http://ollama.local', timeout: 900000)``` | |
| Ollama | mistral | ```(type: ollama, model: 'mistral', url: 'http://ollama.local', timeout: 900000)``` | |

> Note: `export OAF_MODEL="..."`

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

### Running the mini agent

#### Single MCP connection

```bash
mini-a.sh goal="list all nmaguiar/imgutils image tags" mcp="(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000)" rtm=20
mini-a.sh goal="..." mcp="(cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)" rtm=20 __format=md
```

#### Multiple MCP connections

```bash
mini-a.sh goal="get the latest top 20 tags used by the library/ubuntu, cross-check those tag names with the list of Ubuntu releases in Wikipedia, and produce a table with ubuntu release, tag name and latest push date" mcp="[(cmd: 'docker run --rm -i mcp/dockerhub', timeout: 5000), (cmd: 'docker run --rm -i mcp/wikipedia-mcp', timeout: 5000)]" rtm=20 __format=md
```

#### Local MCP servers

Using built-in MCP servers:

```bash
# Database operations
mini-a.sh goal="create a test table with European countries" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" rtm=20

# Network utilities

# Time and timezone utilities
mini-a.sh goal="what time is it in Sydney right now?" mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)" rtm=20

# SSH execution (mcp-ssh)
mini-a.sh goal="run 'uptime' on remote host via SSH MCP" mcp="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false', timeout: 5000)" rtm=20

mini-a.sh goal="check if port 80 is open on google.com" mcp="(cmd: 'ojob mcps/mcp-net.yaml', timeout: 5000)" rtm=20

# Email operations
mini-a.sh goal="send a test email" mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=test@example.com', timeout: 5000)" rtm=20
```

#### Shell operations

_Remove docker images older than 1 year:_

```bash
mini-a.sh goal="help me remove docker images that are older than 1 year" rtm=20 knowledge="give a final answer with a summary of changes in markdown" useshell=true
```

_Analyze project structure:_

```bash  
mini-a.sh goal="analyze the current directory structure and provide insights" useshell=true rtm=15 __format=md
```

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
- **Built-in MCPs**: Includes database, network, time/timezone, email, data channel, and SSH execution MCP servers
- **Multiple MCP Connections**: Connect to multiple MCPs at once and orchestrate across them
- **Simple Web UI**: Lightweight embedded chat interface for interactive use (screenshot above)
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
- `useshell` – Allow shell command execution (default `false`)
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
- `rtm` – Rate limit in LLM calls per minute
- `verbose`, `debug` – Enable progressively richer logging
- `raw` – Return the final response exactly as produced instead of formatted output
- `outfile` – Path to write the final answer (implies JSON output unless `__format` is provided)
- `__format` – Output format (e.g. `md`, `json`)

For a complete list of options, see the [Usage Guide](USAGE.md).

## Security

Mini-A includes several security features:

- **Command Filtering**: Dangerous commands are blocked by default
- **Customizable Shell Controls**: Use `shellallow`, `shellallowpipes`, and `shellbanextra` to fine-tune shell access
- **Interactive Confirmation**: Use `checkall=true` for command approval
- **Read-Only Mode**: File system protection enabled by default
- **Shell Isolation**: Shell access disabled by default

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
