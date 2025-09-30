# MCPs

## Catalog

| Name       | Description                     | Type             | oPack      | Location                           |
|------------|---------------------------------|------------------|------------|------------------------------------|
| mcp-db     | Database access MCP             | STDIO/HTTP       | (included) | [mcp-db.yaml](mcp-db.yaml)         |
| mcp-email  | Email sending MCP               | STDIO/HTTP       | (included) | [mcp-email.yaml](mcp-email.yaml)   |
| mcp-notify | Notification MCP (Pushover)     | STDIO/HTTP       | ```opack install notifications``` | Provided by the `notifications` oPack (see its documentation) |
| mcp-net    | Network utility MCP             | STDIO/HTTP       | (included) | [mcp-net.yaml](mcp-net.yaml)       |
| mcp-ch     | Data channel MCP (STDIO/HTTP)   | STDIO/HTTP       | (included) | [mcp-ch.yaml](mcp-ch.yaml)         |
| mcp-ssh    | SSH execution MCP (secure exec) | STDIO/HTTP       | (included) | [mcp-ssh.yaml](mcp-ssh.yaml)       |
| mcp-oaf    | OpenAF / oJob / oAFp documentation MCP | STDIO/HTTP | (included) | [mcp-oaf.yaml](mcp-oaf.yaml)       |

See [CREATING.md](CREATING.md) for instructions on creating new MCPs and contribution guidelines.

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
ojob mini-a.yaml goal="send a notification saying 'Hello World from OpenAF MCP!'" \
    mcp="(cmd: 'ojob notifications/mcp-notify.yaml pushoverkey=<your_pushover_key> userid=<your_user_id>', timeout: 5000)"
```

#### mcp-net

```bash
ojob mini-a.yaml goal="get the public IP address of this machine" mcp="(cmd: 'ojob mcps/mcp-net.yaml', timeout: 5000)"
```

#### mcp-ch

This MCP exposes OpenAF data channels over STDIO or as an HTTP remote server. It accepts the following arguments:

- `onport` (optional): start an HTTP MCP server on the specified port.
- `chs` (optional): a JSON/SLON array or map describing channels. Each channel object may include `_name`, `_type`, `_rw` (boolean read/write) and type-specific options (for example `file: my-data.json`). Example: `( _name: my-data, _type: file, _rw: true, file: my-data.json )` or as an array.

Available tools (functions) exposed by `mcp-ch`:

- `ch-size`     : Returns the size of a data channel (input: `dataCh`).
- `ch-keys`     : Returns keys of a data channel (input: `dataCh`, optional `extra`).
- `ch-values`   : Returns all values of a data channel (input: `dataCh`, optional `extra`).
- `ch-get`      : Get a value from a data channel (input: `dataCh`, `key`, optional `value`).
- `ch-set`      : Set a value in a data channel (input: `dataCh`, `key`, `value`). Requires channel to be writable.
- `ch-unset`    : Unset a value in a data channel (input: `dataCh`, `key`). Requires channel to be writable.
- `ch-set-all`  : Set multiple values using `keyFieldsList` and `valuesList` (requires writable channel).
- `ch-unset-all`: Unset multiple values using `keyFieldsList` and `valuesList` (requires writable channel).

Example: start as HTTP remote server on port 12345 with two channels (one simple read-only and one file-backed writable):

```bash
ojob mcps/mcp-ch.yaml onport=12345 chs="[( _name: readonly, _type: simple, _rw: false ), ( _name: my-data, _type: file, _rw: true, file: my-data.json )]"
```

Call `ch-get` via STDIO MCP (example using `oafp` to call a tool):

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-ch.yaml', tool: ch-get, params: (dataCh: 'my-data', key: (id: 1)))"
```

Call `ch-keys` remotely against an HTTP MCP server:

```bash
oafp in=mcp data="(type: remote, url: 'http://localhost:12345/mcp', tool: ch-keys, params: (dataCh: 'my-data'))"
```
 
#### mcp-ssh

This MCP provides a secure SSH-based executor. It exposes two main tools:

- `shell-exec`: execute a single shell command over SSH and receive stdout, stderr and exit code.
- `shell-batch`: execute a batch of commands over SSH and receive an array of results for each command.

Important notes:

- The `ssh` argument is mandatory and must be an OpenAF SSH URL (for example: `ssh://user:pass@host:22/identKey?timeout=12345`).
- By default the MCP is read-only; set `readwrite=true` to allow commands that are normally blocked by the security policy.
- Fine-tune command filtering with `shellallow` (allow specific commands), `shellbanextra` (add more banned commands), and `shellallowpipes` (permit pipes/redirection).

Example — run a single command via STDIO MCP:

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-ssh.yaml ssh=ssh://user:pass@host:22/ident readwrite=false', tool: shell-exec, params: (command: 'uptime'))"
```

Example — start `mcp-ssh` as a remote HTTP MCP server on port 8888:

```bash
ojob mcps/mcp-ssh.yaml onport=8888 ssh=ssh://user:pass@host:22/ident readwrite=false
```

Example — call `shell-batch` remotely:

```bash
oafp in=mcp data="(type: remote, url: 'http://localhost:8888/mcp', tool: shell-batch, params: (commands: ['echo hello','date']))"
```

#### mcp-oaf

This MCP serves OpenAF, oJob and oAFp documentation and cli utilities over STDIO or as an HTTP remote server. It exposes tools such as:

- `openaf-doc`     : search and return OpenAF help entries or the full help (cli mode returns oaf -h output)
- `ojob-doc`       : return oJob help or reference documentation
- `openaf-version` : return OpenAF version and distribution
- `oafp-doc`       : return aOFp help/readme topics

Example — run locally and list OpenAF help (stdio mode):

```bash
ojob mcps/mcp-oaf.yaml
```

Example — request OpenAF help remotely (HTTP mode on port 8888):

```bash
oafp in=mcp data="(type: remote, url: 'http://localhost:8888/mcp', tool: openaf-doc, params: (search: 'help'))"
```

Small excerpt from `mcp-oaf.yaml` showing purpose and tools (truncated):

```yaml
# Author: Nuno Aguiar
help:
	text: A STDIO/HTTP MCP OpenAF tools documentation server
	expects:
		- name: onport
			desc: If defined starts a MCP server on the provided port

jobs:
- name: OpenAF documentation
	exec: | #js
		if (args.cli) {
			return "```" + $sh(getOpenAFPath() + "oaf -h").get(0).stderr + "```"
		} else {
			if (isUnDef(args.search)) {
				return global.oaf_docs
			} else {
				return searchHelp(args.search)
			}
		}
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

Remember to adjust hostnames, ports, and authentication parameters to match the MCP instance you are testing against.
