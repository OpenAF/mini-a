# OpenAF mini-a

![/.github/version.svg](/.github/version.svg)

Mini-A is a minimalist autonomous agent that uses LLMs, shell commands and/or MCP stdio or http(s) servers to achieve user-defined goals. It is designed to be simple, flexible, and easy to use.

## Quick Start

Two steps to use:

1. Set OAF_MODEL environment variable to the model you want to use.
2. Run the agent with the `ojob` command.

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
| OpenAF | gpt-5-mini | ```(type: openai, model: gpt-5-mini, key: ..., timeout: 900000, temperature: 1)``` | |
| Google | gemini | ```(type: gemini, model: gemini-2.5-flash-lite, key: ..., timeout: 900000, temperature: 0)``` | |
| GitHub | gpt-5-nano | ```(type: openai, url: 'https://models.github.ai/inference', model: openai/gpt-5-nano, key: $(gh auth token), timeout: 900000, temperature: 1, apiVersion: '')``` | |
| AWS | nova-pro | ```(type: bedrock, timeout: 900000, options: (model: 'amazon.nova-pro-v1:0', temperature: 0))``` | After installing OpenAF's oPack "AWS" add to mini-a calls ```libs="aws.js"``` |
| Ollama | gemma3n | ```(type: ollama, model: 'gemma3', url: 'http://ollama.local', timeout: 900000)``` | |
| Ollama | mistral | ```(type: ollama, model: 'mistral', url: 'http://ollama.local', timeout: 900000)``` | |

> Note: `export OAF_MODEL="..."`

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

## Features

- **Multi-Model Support**: Works with OpenAI, Google Gemini, GitHub Models, AWS Bedrock, Ollama, and more
- **MCP Integration**: Seamless integration with Model Context Protocol servers (both local and external)
- **Shell Access**: Optional shell command execution with safety controls
- **Flexible Configuration**: Extensive configuration options for different use cases
- **Built-in MCPs**: Includes database, network, email, and data channel MCP servers
- **Safety Features**: Command filtering, confirmation prompts, and read-only modes
- **Conversation Persistence**: Save and resume conversations across sessions
- **Rate Limiting**: Built-in rate limiting for API usage control

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
- **`OAF_FLAGS="(MD_DARKMODE: 'auto')"**: For setting forced dark mode or automatic

### Command Line Options

All Mini-A options can be passed as command line arguments:

- `goal`: The objective for the agent to achieve
- `mcp`: MCP server configuration (single or array)
- `useshell`: Allow shell command execution
- `readwrite`: Allow file system modifications
- `maxsteps`: Maximum number of steps (default: 25)
- `rtm`: Rate limit in calls per minute
- `debug`: Enable debug mode
- `verbose`: Enable verbose logging
- `__format`: Output format (json, md, etc.)

For a complete list of options, see the [Usage Guide](USAGE.md).

## Security

Mini-A includes several security features:

- **Command Filtering**: Dangerous commands are blocked by default
- **Interactive Confirmation**: Use `checkall=true` for command approval
- **Read-Only Mode**: File system protection enabled by default
- **Shell Isolation**: Shell access disabled by default

See the [Usage Guide](USAGE.md#security-considerations) for detailed security information.

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
