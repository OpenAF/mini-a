# MCPs

## Catalog

| Name       | Description                     | Type        | Location                         |
|------------|---------------------------------|-------------|----------------------------------|
| mcp-db     | Database access MCP             | STDIO       | [mcp-db.yaml](mcp-db.yaml)       |

### Examples

#### mcp-db

```bash
ojob mini-a.yaml goal="create a 'test' table with all union european countries and cities" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" knowledge="- give final answer in markdown\n- generate H2 compatible SQL"
```

```bash
ojob mini-a.yaml goal="build a markdown table with the contents of the 'test' table" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" knowledge="- give final answer in markdown\n- generate H2 compatible SQL" debug=true
```

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