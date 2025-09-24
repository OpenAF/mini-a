# OpenAF mini-a

Mini-A is a minimalist autonomous agent that uses LLMs, shell commands and/or MCP stdio or http(s) servers to achieve user-defined goals. It is designed to be simple, flexible, and easy to use.

## Usage

Two steps to use:

1. Set OAF_MODEL environment variable to the model you want to use.
2. Run the agent with the `ojob` command.

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

#### Other examples

_Remove docker images older than 1 year:_

```bash
mini-a.sh goal="help me remove docker images that are older than 1 year" rtm=20 knowledge="give a final answer with a summary of changes in markdown" useshell=true
```