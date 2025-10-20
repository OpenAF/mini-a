# MCPs

## Catalog

| Name       | Description                     | Type             | oPack      | Location                           |
|------------|---------------------------------|------------------|------------|------------------------------------|
| mcp-db     | Database access MCP             | STDIO/HTTP       | (included) | [mcp-db.yaml](mcp-db.yaml)         |
| mcp-email  | Email sending MCP               | STDIO/HTTP       | (included) | [mcp-email.yaml](mcp-email.yaml)   |
| mcp-notify | Notification MCP (Pushover)     | STDIO/HTTP       | ```opack install notifications``` | Provided by the `notifications` oPack (see its documentation) |
| mcp-net    | Network utility MCP             | STDIO/HTTP       | (included) | [mcp-net.yaml](mcp-net.yaml)       |
| mcp-kube   | Kubernetes management MCP       | STDIO/HTTP       | (included) | [mcp-kube.yaml](mcp-kube.yaml)     |
| mcp-time   | Time and timezone utility MCP   | STDIO/HTTP       | (included) | [mcp-time.yaml](mcp-time.yaml)     |
| mcp-random | Random data generation MCP      | STDIO/HTTP       | (included) | [mcp-random.yaml](mcp-random.yaml) |
| mcp-ch     | Data channel MCP (STDIO/HTTP)   | STDIO/HTTP       | (included) | [mcp-ch.yaml](mcp-ch.yaml)         |
| mcp-ssh    | SSH execution MCP (secure exec) | STDIO/HTTP       | (included) | [mcp-ssh.yaml](mcp-ssh.yaml)       |
| mcp-oaf    | OpenAF / oJob / oAFp documentation MCP | STDIO/HTTP | (included) | [mcp-oaf.yaml](mcp-oaf.yaml)       |
| mcp-oafp   | OpenAF processor (oafp) runner & docs MCP | STDIO/HTTP | (included) | [mcp-oafp.yaml](mcp-oafp.yaml)   |
| mcp-weather| Weather information MCP (wttr.in)         | STDIO/HTTP | (included) | [mcp-weather.yaml](mcp-weather.yaml) |

See [CREATING.md](CREATING.md) for instructions on creating new MCPs and contribution guidelines.

### Examples

#### mcp-db

`mcp-db` provides JDBC-backed database access over STDIO or HTTP. Configure it with the following arguments:

- `jdbc` (required): JDBC connection string.
- `user` / `pass` (optional): credentials to authenticate with the database.
- `rw` (optional): set to `true` to allow write operations; defaults to read-only.
- `libs` (optional): comma-separated libraries or `@oPack/library.js` references to preload before creating the connection (useful for helper functions or vendor drivers already available on disk).
- `onport` (optional): start an HTTP MCP server on the specified port.

```bash
ojob mini-a.yaml goal="create a 'test' table with all union european countries and cities" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa libs=db/helpers.js', timeout: 5000)" \
  knowledge="- generate H2 compatible SQL"
```

```bash
ojob mini-a.yaml goal="build a markdown table with the contents of the 'test' table" \
  mcp="(cmd: 'ojob mcps/mcp-db.yaml jdbc=jdbc:h2:./data user=sa pass=sa libs=db/helpers.js', timeout: 5000)" \
  knowledge="- generate H2 compatible SQL" debug=true
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

#### mcp-time

```bash
ojob mini-a.yaml goal="tell me the current time in Tokyo and convert it to New York time" mcp="(cmd: 'ojob mcps/mcp-time.yaml', timeout: 5000)" knowledge="- prefer ISO 8601 timestamps"
```

Key tools exposed by `mcp-time` include:

- `current-time`: Provides detailed information about the current moment for an optional timezone.
- `convert-time`: Converts a supplied date/time into a different timezone and format.
- `timezone-difference`: Calculates the offset difference between two timezones at a given moment.
- `list-timezones`: Lists available timezone identifiers (with optional filtering).

#### mcp-random

`mcp-random` offers a collection of reproducible-friendly random data helpers covering integers, sequences, fractions, selections and Gaussian sampling. All tools accept an optional numeric `seed` to generate deterministic output when desired.

Key tools include:

- `random-integer`: Returns a random integer within an inclusive range.
- `random-sequence`: Produces a shuffled range of integers, optionally truncated to a requested length.
- `random-integer-set`: Generates a sorted set of unique integers drawn from a range.
- `gaussian-sample`: Creates normally distributed samples using `java.util.Random#nextGaussian` with configurable mean and standard deviation.
- `random-fraction`: Emits fractions between 0 and 1 rounded to configurable decimal places.
- `random-choice`: Picks one or more elements from a provided array, with optional uniqueness guarantees.
- `random-boolean`: Generates booleans with an optional bias probability for `true`.
- `random-hex`: Builds hexadecimal strings of a specific length.

#### mcp-ch

This MCP exposes OpenAF data channels over STDIO or as an HTTP remote server. It accepts the following arguments:

- `onport` (optional): start an HTTP MCP server on the specified port.
- `chs` (optional): a JSON/SLON array or map describing channels. Each channel object may include `_name`, `_type`, `_rw` (boolean read/write) and type-specific options (for example `file: my-data.json`). Example: `( _name: my-data, _type: file, _rw: true, file: my-data.json )` or as an array.
- `libs` (optional): comma-separated libraries or `@oPack/library.js` references to preload before channel initialization; use it to bring additional helpers into scope.

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
ojob mcps/mcp-ch.yaml onport=12345 libs="@mini-a/utils.js" \
  chs="[( _name: readonly, _type: simple, _rw: false ), ( _name: my-data, _type: file, _rw: true, file: my-data.json )]"
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

#### mcp-kube

`mcp-kube` exposes selected Kubernetes management operations powered by the [`Kube` oPack](https://github.com/OpenAF/openaf-opacks/tree/master/Kube). It works either as a STDIO MCP or as an HTTP remote MCP. Configure connection credentials to your cluster through the startup arguments (`url`, `user`, `pass`, `token`, `namespace`, etc.). Set `readwrite=true` to enable operations that modify cluster resources. Use `kubelib` when you need to point at a specific `kube.js` location.

Available tools include:

- `list-namespaces`  : List all namespaces in the cluster.
- `get-resource`     : Retrieve Kubernetes objects or metrics via a single tool. Supported `resource` values include `pods`, `deployments`, `statefulsets`, `clusterroles`, `clusterrolebindings`, `roles`, `rolebindings`, `ingresses`, `networkpolicies`, `resourcequotas`, `storageclasses`, `services`, `service-accounts`, `secrets`, `replicasets`, `persistent-volume-claims`, `persistent-volumes`, `nodes`, `configmaps`, `jobs`, `daemonsets`, `cronjobs`, `endpoints`, `pod`, `events`, `pods-metrics`, `nodes-metrics`, and `node-metrics` (with optional `namespace`, `full`, and `name`/`node` parameters as applicable).
- `get-log`          : Retrieve logs from a pod (optionally container/stream specific).
- `apply-manifest`   : Apply a manifest (requires `readwrite=true`).
- `delete-manifest`  : Delete resources described by a manifest (requires `readwrite=true`).
- `scale-resource`   : Scale a workload resource (requires `readwrite=true`).

Example — list pods in the default namespace using STDIO MCP:

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-kube.yaml url=https://k8s.example.com:6443 token=<bearer_token> namespace=default', \
  tool: get-resource, params: (resource: pods, namespace: default, full: false))"
```

Example — run as an HTTP MCP server on port 9000 and fetch node metrics remotely:

```bash
ojob mcps/mcp-kube.yaml onport=9000 url=~/.kube/config readwrite=false

oafp in=mcp data="(type: remote, url: 'http://localhost:9000/mcp', tool: get-resource, params: (resource: nodes-metrics))"
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

#### mcp-oafp

`mcp-oafp` wraps the OpenAF processor (oafp) so that you can both execute transformations and inspect the embedded documentation. Key tools include:

- `run-oafp`: invoke the `oafp` function directly with arbitrary parameters and optional inline data.
- `list-commands`: parse the usage table into structured option metadata (supports filtering).
- `get-doc`: retrieve the usage, filters, template helper or examples markdown.
- `search-doc`: perform keyword searches across all documentation sections.
- `discover-capabilities`: expose the dynamic inputs/transforms/outputs list (respecting optional `libs`).

Example — call oafp to convert CSV into JSON:

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-oafp.yaml', tool: run-oafp, params: (params: (in: csv, out: json), data: 'name\\nage\\nJohn,42'))"
```

Example — search for filters documentation mentioning SQL:

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-oafp.yaml', tool: search-doc, params: (query: 'sql'))"
```

#### mcp-weather

`mcp-weather` fronts [wttr.in](https://wttr.in) to provide structured weather data (or ANSI forecasts when desired).

Available tool:

- `get-weather`: request weather data for a location with optional `ansi`, `oneline`, `format`, or `options` tweaks.

Example — retrieve the JSON forecast for Lisbon:

```bash
oafp in=mcp data="(cmd: 'ojob mcps/mcp-weather.yaml', tool: get-weather, params: (location: 'Lisbon, Portugal'))"
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

## Repository tests

To execute the full Mini‑A test suite, run the following from the main repository folder:

```
ojob tests/autoTestAll.yaml
```

This uses oJob to orchestrate all tests; running from the repo root ensures relative paths resolve correctly.

The test run will produce an `autoTestAll.results.json` file in the repository. Review it for outcomes and remove it before your final commit.
