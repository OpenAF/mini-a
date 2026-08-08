# Agent Plugins support

Mini-A can consume plugins that follow the [Agent Plugins](https://agent-plugins.org) 1.0.0 standard — a vendor-neutral directory format for packaging `skills/` and `mcp.json` MCP servers together. Mini-A acts as a **client** of this standard: it discovers plugin directories, adds their `skills/` folders to the existing skills machinery, and converts their `mcp.json` servers into ordinary MCP connections. There is no separate "plugin" concept beyond that — a loaded plugin's skills show up exactly like any other skill, and its MCP servers show up exactly like any other MCP connection.

---

## Directory layout

A plugin is a directory containing a `plugin.json` manifest, plus optionally a `skills/` folder and/or an `mcp.json` file:

```
my-plugin/
├── plugin.json
├── skills/
│   └── my-skill/
│       └── SKILL.md
└── mcp.json
```

`plugin.json` requires `$schema` and `name`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does"
}
```

`mcp.json` declares one or more named MCP servers:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "./server.sh",
      "args": ["${PLUGIN_ROOT}/data"],
      "env": { "MODE": "prod" },
      "cwd": "${PLUGIN_DATA}"
    }
  }
}
```

Supported `mcpServers` transports: `stdio`, `streamable-http`, and the deprecated `sse`.

---

## Loading plugins

- `plugins=<dir1,dir2,...>` — explicit plugin directories, each containing its own `plugin.json`.
- `pluginsroot=<dir>` / `pluginsroots=<dir1,dir2,...>` — directories that each contain many plugin subfolders (one level deep). Default: `.openaf-mini-a/plugins` under the home directory.

Both compose with (don't replace) `extraskills=` and `mcp=` — a plugin's skills are simply additional skill directories, and its MCP servers are simply additional MCP connections, aggregated the same way. `homedir=` affects the default `pluginsroot` and the `PLUGIN_DATA` base exactly like it does for skills.

On a name collision, a plugin's skill never shadows a user or default skill — plugin skill directories are always appended last.

---

## The `PLUGIN_ROOT` / `PLUGIN_DATA` contract

Every stdio MCP server launched from a plugin receives two environment variables:

- `PLUGIN_ROOT` — the absolute, canonical path to the plugin's own directory.
- `PLUGIN_DATA` — an absolute, canonical, per-plugin persistent data directory Mini-A creates and manages: `<home>/.openaf-mini-a/plugin-data/<plugin-name>/`.

`${PLUGIN_ROOT}` and `${PLUGIN_DATA}` placeholders are expanded (non-recursively — any other `${...}` token is left untouched) inside `args`, `env` values, and `cwd`. A `cwd` value must start with `./`, `${PLUGIN_ROOT}`, or `${PLUGIN_DATA}`, and is contained against the matching base — it can never resolve outside the plugin's own root or data directory. A `command` must be a single executable token: either a bare name (resolved via `PATH` at spawn time) or a `./`-relative path, which is always resolved against the plugin root regardless of the configured `cwd`.

**Minimum OpenAF version**: full `cwd`/`env` fidelity for plugin stdio servers requires an OpenAF build with native `pwd`/`envs` support in `$mcp`/`$jsonrpc` (added alongside this feature). On older builds, plugin stdio servers still start, but the `cwd`/declared `env` vars are silently ignored (the process falls back to Mini-A's own working directory and environment) rather than failing.

---

## Limitations

- **Headers on `streamable-http`/`sse` servers**: only a single `Authorization: Bearer <token>` header can be passed through today (converted to Mini-A's native `auth:(type:bearer, ...)` form). Any other declared header is dropped, with a warning — there is no generic header passthrough in the underlying MCP client yet.
- **Windows**: stdio plugin servers use native array-exec (no shell involved), which works cross-platform for ordinary executables, but a bare command that Windows would normally resolve through a `.cmd`/`.bat` shim (e.g. some `npx`-style installs) has not been verified there.

---

## Resilience

A plugin's problems are contained to that plugin, and a plugin's MCP problems are contained to its MCP surface:

| Situation | Result |
|---|---|
| `plugin.json` missing, malformed, or missing `name` | that plugin is skipped; other plugins still load |
| `plugin.json` has an unrecognized top-level field | ignored — the plugin still loads (forward-compat with future Agent Plugins versions) |
| `mcp.json` missing | no-op — the plugin's skills (if any) still load |
| `mcp.json` targets an unsupported schema version | the plugin's MCP servers are skipped; its skills still load |
| One `mcpServers` entry is malformed or names an unsupported transport | only that entry is skipped; sibling entries and skills still load |

Every skip is logged as a warning when an agent runs.

---

## Worked example

```bash
mkdir -p ~/plugins/hello/skills/hello
cat > ~/plugins/hello/plugin.json <<'EOF'
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "hello"
}
EOF
cat > ~/plugins/hello/skills/hello/SKILL.md <<'EOF'
---
name: hello
description: Says hello
---
Say hello to the user.
EOF

mini-a goal="..." plugins=~/plugins/hello
```

The `hello` skill is now listable/invokable exactly like any other skill.
