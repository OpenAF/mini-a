# MCPs

## How to unit test a MCP

### STDIO based

List tools: 

```bash
oafp in=mcp data="(cmd: 'docker run --rm -i mcp/wikipedia-mcp')" inmcptoolslist=true
```

Call a tool:

```bash
oafp in=mcp data="(cmd: 'docker run --rm -i mcp/wikipedia-mcp', tool: extract_key_facts, params: (title: 'Portugal'))"
```

### Remote based

List tools:

```bash
oafp in=mcp data="(type: remote, url: 'http://wikipedia.mcps.local:1234/mcp')" inmcptoolslist=true
```

Call a tool:

```bash
oafp in=mcp data="(type: remote, url: 'http://wikipedia.mcps.local:1234/mcp', tool: extract_key_facts, params: (title: 'Portugal'))"
``` 