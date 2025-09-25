# MCPs

## Catalog

| Name       | Description                     | Type        | Location                           |
|------------|---------------------------------|-------------|------------------------------------|
| mcp-db     | Database access MCP             | STDIO       | [mcp-db.yaml](mcp-db.yaml)         |
| mcp-email  | Email sending MCP               | STDIO       | [mcp-email.yaml](mcp-email.yaml)   |
| mcp-notify | Notification MCP (Pushover)     | STDIO       | [mcp-notify.yaml](mcp-notify.yaml) |
| mcp-net    | Network utility MCP             | STDIO       | [mcp-net.yaml](mcp-net.yaml)       |

### Examples

#### mcp-db

```bash
ojob mini-a.yaml goal="create a 'test' table with all union european countries and cities" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" knowledge="- generate H2 compatible SQL"
```

```bash
ojob mini-a.yaml goal="build a markdown table with the contents of the 'test' table" mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa', timeout: 5000)" knowledge="- generate H2 compatible SQL" debug=true
```

#### mcp-email

```bash
ojob mini-a.yaml goal="send an email reminding the team about today's standup" mcp="(cmd: 'ojob mcps/mcp-email.yaml smtpserver=smtp.example.com from=bot@example.com user=bot@example.com pass=<app_password> tls=true html=false', timeout: 5000)"
```

#### mcp-notify

```bash
ojob mini-a.yaml goal="send a notification saying 'Hello World from OpenAF MCP!'" mcp="(cmd: 'ojob mcps/mcp-notify.yaml pushoverkey=<your_pushover_key> userid=<your_user_id>', timeout: 5000)"
```

#### mcp-net

```bash
ojob mini-a.yaml goal="get the public IP address of this machine" mcp="(cmd: 'ojob mcps/mcp-net.yaml tool=public_ip', timeout: 5000)"
```
## Using MCPs as STDIO or HTTP Remote Server

All MCPs in this catalog can be used in two modes:

- **STDIO mode**: The MCP is executed directly and communicates via standard input/output.
- **HTTP remote server mode**: By providing the `onport` argument, the MCP will start an HTTP server on the specified port, allowing remote calls.

### Example: Running as HTTP remote server

```bash
ojob mcps/mcp-db.yaml onport=12345
```

This will start the MCP on port 12345. You can then interact with it remotely using HTTP requests or by configuring tools to use the remote MCP endpoint.

You can use the same approach for any MCP in the catalog (e.g., `mcp-email.yaml`, `mcp-notify.yaml`, `mcp-net.yaml`).

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