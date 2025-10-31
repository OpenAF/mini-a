# OpenAF mini-a

![/.github/version.svg](/.github/version.svg)

Mini-A is a minimalist autonomous agent that uses LLMs, shell commands and/or MCP servers to achieve user-defined goals. Simple, flexible, and easy to use as a library, CLI tool, or embedded interface.

![/.github/mini-a-web-screenshot1.jpg](/.github/mini-a-web-screenshot1.jpg)

## Quick Start

Two steps to use:

1. Set `OAF_MODEL` environment variable to the model you want to use:
   ```bash
   export OAF_MODEL="(type: openai, model: gpt-5-mini, key: '...', timeout: 900000, temperature: 1)"
   ```

2. Run the agent:
   ```bash
   ./mini-a.sh goal="your goal"
   ```

Shell access is disabled by default for safety; add `useshell=true` when you explicitly want the agent to run commands.

For browser UI, start `./mini-a-web.sh onport=8888` after exporting the model settings and open `http://localhost:8888`.

### Simple Examples

**List files:**
```bash
./mini-a.sh goal="list all JavaScript files in this directory" useshell=true
```

**Using MCP servers:**
```bash
./mini-a.sh goal="what time is it in Sydney?" mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)"
```

**Chatbot mode:**
```bash
./mini-a.sh goal="help me plan a vacation in Lisbon" chatbotmode=true
```

## Installation

1. Install OpenAF from [openaf.io](https://openaf.io)
2. Install oPack:
   ```bash
   opack install mini-a
   ```
3. Set your model configuration (see Quick Start above)
4. Start using Mini-A!

## Features

- **Multi-Model Support** - Works with OpenAI, Google Gemini, GitHub Models, AWS Bedrock, Ollama, and more
- **Dual-Model Cost Optimization** - Use a low-cost model for routine steps with smart escalation (see [USAGE.md](USAGE.md#dual-model-setup-cost-optimization))
- **MCP Integration** - Seamless integration with Model Context Protocol servers (STDIO & HTTP)
- **Built-in MCP Servers** - Database, file system, network, time/timezone, email, S3, RSS, Yahoo Finance, SSH, and more
- **Optional Shell Access** - Execute shell commands with safety controls and sandboxing
- **Web UI** - Lightweight embedded chat interface for interactive use
- **Planning Mode** - Generate and execute structured task plans for complex goals
- **Mode Presets** - Quick configuration bundles (shell, chatbot, web, etc.) - see [USAGE.md](USAGE.md#mode-presets)
- **Conversation Persistence** - Save and resume conversations across sessions
- **Rate Limiting** - Built-in rate limiting for API usage control
- **Metrics & Observability** - Comprehensive runtime metrics for monitoring and cost tracking

## Documentation

- **[Usage Guide](USAGE.md)** - Comprehensive guide covering all features
  - [Getting Started](USAGE.md#basic-usage)
  - [Model Configuration](USAGE.md#model-configuration)
  - [Mode Presets](USAGE.md#mode-presets)
  - [Advanced Features](USAGE.md#advanced-features)
  - [Planning Workflow](USAGE.md#planning-workflow)
  - [MCP Integration Deep Dive](USAGE.md#mcp-integration-deep-dive)
  - [Security Considerations](USAGE.md#security-considerations)
  - [Metrics and Observability](USAGE.md#metrics-and-observability)
- **[MCP Documentation](mcps/README.md)** - Built-in MCP servers catalog
- **[Creating MCPs](mcps/CREATING.md)** - Build custom MCP integrations
- **[External MCPs](EXTERNAL-MCPS.md)** - Community MCP servers
- **[Contributing Guide](CONTRIBUTING.md)** - Join the project
- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Community standards

## Project Components

Mini-A ships with complementary components:

- **`mini-a.yaml`** - Core oJob definition that implements the agent workflow
- **`mini-a.sh`** - Shell wrapper script for convenient execution
- **`mini-a.js`** - Reusable library for embedding in other OpenAF jobs
- **`mini-a-web.sh` / `mini-a-web.yaml`** - Lightweight HTTP server for browser UI
- **`mini-a-modes.yaml`** - Configuration presets for common use cases
- **`public/`** - Browser interface assets

## Common Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `goal` | Objective the agent should achieve | Required |
| `useshell` | Allow shell command execution | `false` |
| `readwrite` | Allow file system modifications | `false` |
| `mcp` | MCP server configuration (single or array) | - |
| `usetools` | Register MCP tools with the model | `false` |
| `chatbotmode` | Conversational assistant mode | `false` |
| `useplanning` | Enable task planning workflow | `false` |
| `mode` | Apply preset from `mini-a-modes.yaml` | - |
| `maxsteps` | Maximum steps before forcing final answer | `15` |
| `rpm` | Rate limit (requests per minute) | - |
| `verbose` / `debug` | Enable detailed logging | `false` |

For the complete list and detailed explanations, see the [Usage Guide](USAGE.md#configuration-options).

## Setting the Model

Examples for different providers:

**OpenAI:**
```bash
export OAF_MODEL="(type: openai, model: gpt-5-mini, key: ..., timeout: 900000, temperature: 1)"
```

**Google Gemini:**
```bash
export OAF_MODEL="(type: gemini, model: gemini-2.5-flash-lite, key: ..., timeout: 900000, temperature: 0)"
```

**GitHub Models:**
```bash
export OAF_MODEL="(type: openai, url: 'https://models.github.ai/inference', model: openai/gpt-5-nano, key: $(gh auth token), timeout: 900000, temperature: 1, apiVersion: '')"
```

**AWS Bedrock (requires OpenAF AWS oPack):**
```bash
export OAF_MODEL="(type: bedrock, timeout: 900000, options: (model: 'amazon.nova-pro-v1:0', temperature: 0))"
```

**Ollama (local):**
```bash
export OAF_MODEL="(type: ollama, model: 'gemma3', url: 'http://ollama.local', timeout: 900000)"
```

**Dual-model for cost optimization:**
```bash
# High-capability model for complex reasoning
export OAF_MODEL="(type: openai, model: gpt-4, key: '...')"
# Low-cost model for routine operations
export OAF_LC_MODEL="(type: openai, model: gpt-3.5-turbo, key: '...')"
```

For more model configurations and recommendations, see [USAGE.md](USAGE.md#model-configuration).

## Security

Mini-A includes built-in security features:

- **Command Filtering** - Dangerous commands blocked by default
- **Interactive Confirmation** - Optional approval for each command (`checkall=true`)
- **Read-Only Mode** - File system protection enabled by default
- **Shell Isolation** - Shell access disabled by default
- **Sandboxing Support** - Use `shell=...` prefix for Docker, Podman, or OS sandboxes

**Example with Docker sandbox:**
```bash
docker run -d --rm --name mini-a-sandbox -v "$PWD":/work -w /work ubuntu:24.04 sleep infinity
./mini-a.sh goal="analyze files" useshell=true shell="docker exec mini-a-sandbox"
```

See [USAGE.md](USAGE.md#security-considerations) for detailed security information and sandboxing strategies.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Code contribution process
- Development setup
- Pull request guidelines
- Community standards

### Running Tests

Run the test suite from the repository root:

```bash
ojob tests/autoTestAll.yaml
```

The run generates an `autoTestAll.results.json` file with detailed results—inspect it locally and delete it before your final commit.

## Community

- **Issues**: [GitHub Issues](https://github.com/openaf/mini-a/issues)
- **Discussions**: [GitHub Discussions](https://github.com/openaf/mini-a/discussions)
- **Email**: openaf@openaf.io

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
