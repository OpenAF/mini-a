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

- `showExecs=true` to show executed commands in the interaction stream
- `logPromptHeaders="origin,referer"` to log selected incoming headers for debugging

Endpoints used by the UI (served by `mini-a-web.yaml`): `/prompt`, `/result`, `/clear`, and `/ping`.

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
- **`maxsteps`** (number, default: 25): Maximum number of steps the agent will take
- **`verbose`** (boolean, default: false): Enable verbose logging
- **`debug`** (boolean, default: false): Enable debug mode with detailed logs
- **`raw`** (boolean, default: false): Return raw string instead of formatted output

#### Shell and File System Access
- **`useshell`** (boolean, default: false): Allow shell command execution
- **`readwrite`** (boolean, default: false): Allow read/write operations on filesystem
- **`checkall`** (boolean, default: false): Ask for confirmation before executing any shell command
- **`shellallow`** (string): Comma-separated list of banned commands that should be explicitly allowed
- **`shellallowpipes`** (boolean, default: false): Allow pipes, redirection, and shell control operators in commands
- **`shellbanextra`** (string): Additional comma-separated commands to ban
- **`shellbatch`** (boolean, default: false): If true, runs in batch mode without prompting for command execution approval

#### MCP (Model Context Protocol) Integration
- **`mcp`** (string): MCP configuration in JSON format (single object or array for multiple connections)

```javascript
// Single MCP connection
mcp: "(cmd: 'docker run --rm -i mcp/dockerhub')"

// Multiple MCP connections
mcp: "[ (cmd: 'docker run --rm -i mcp/dockerhub') | (cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000) ]"
```

#### Knowledge and Context
- **`knowledge`** (string): Additional context or knowledge for the agent (can be text or file path)
- **`maxcontext`** (number): Maximum context size in bytes (triggers summarization when exceeded)
- **`maxcontent`** (number): Maximum number of characters Mini-A will read from a single file when inspecting the filesystem

#### Libraries and Extensions
- **`libs`** (string): Comma-separated list of additional OpenAF libraries to load

#### Conversation Management
- **`conversation`** (string): Path to file for loading/saving conversation history

#### Output Configuration
- **`outfile`** (string): Path to file where final answer will be written
- **`__format`** (string): Output format (e.g. "json", "md", ...)

#### Rate Limiting
- **`rtm`** (number): Rate limit in calls per minute

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
📝  Context summarized using low-cost model. Summary: 15 tokens generated
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
    maxcontext: 50000,  // Auto-summarize if context exceeds 50KB
    maxsteps: 50
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
3. **Set Appropriate Limits**: Use `maxsteps` to prevent runaway execution
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
5. **Goal not achieved**: Increase `maxsteps` or refine goal description

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

Example:

```javascript
var agent = new MiniA()
agent.start({ goal: "List files", useshell: true })
log(agent.getMetrics())
```
