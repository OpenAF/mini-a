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

## Local plugin management (development)

The local manager supports Agent Plugins and vendor manifests in
`.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`.

```sh
mini-a pluginop=inspect pluginsource=/path/to/plugin
mini-a pluginop=convert pluginsource=/path/to/plugin pluginout=/path/to/output
mini-a pluginop=install pluginsource=/path/to/plugin.zip
mini-a pluginop=list
mini-a pluginop=enable pluginid=my-plugin
mini-a pluginop=disable pluginid=my-plugin
mini-a pluginop=remove pluginid=my-plugin
mini-a pluginman=true
```

Installations start disabled under `<home>/.openaf-mini-a/managed-plugins`.
Activation changes apply to new sessions. Removal retains package files for active
sessions and retains plugin data. Reinstalling a retained identity currently requires
manual cleanup after all sessions have ended.

`/plugins` lists installations; `/plugins {op: "enable", id: "my-plugin"}`
accepts the same management operations. The advanced web console has a Plugins
screen for server-side folders and ZIP paths. The screen also accepts browser ZIP uploads and downloads converted ZIP packages.
All web management operations require the trusted Advanced API authentication.

Compatible Markdown commands appear as `/plugin-name:command`; `$ARGUMENTS`
represents the raw arguments. Commands requiring positional substitutions,
embedded execution, or host-specific permission/model overrides are skipped.
The initial command-hook adapter handles prompt submission and tool events,
including stdin JSON and basic blocking/context output, and requires `useshell=true`.
The supported subset supplies a stable session identifier, prompt/tool JSON,
plugin root/data variables and shell events matched as `Bash`. Unsupported control
output blocks pre-action execution and is reported for post-action hooks.
Async, HTTP, prompt and agent handlers, session lifecycle events and tool-input
rewriting are outside this subset. Post-action hooks cannot undo completed actions.
Broader vendor-protocol coverage remains outstanding.
Visual verification in Chrome covered the Plugins layout, inventory listing,
server-folder inspection, browser ZIP inspection and completed conversion download.
Activation controls were covered by automated lifecycle tests, not this visual check.
Agent profiles and host-specific app integrations remain unsupported.

ZIP imports reject links, path traversal and duplicate paths. Limits are 25 MiB
compressed, 100 MiB expanded and 10,000 entries. Only a single plugin root is accepted.

Development checks:

```sh
openaf -f tests/pluginManager.js
ojob tests/agentPlugins.yaml
node tests/modulePaths.cjs
python3 tests/modulePaths.py
```

Registry lifecycle writes use a cross-process file lock and atomic state replacement.
The automated manager suite exercises ZIP transfer round trips, traversal rejection,
activation snapshots and command-hook stdin/blocking behavior.

## Creation and destination exports

The manager now accepts `create`, `inventory`, and `export`, through `pluginop`,
`pluginman`, `/plugins`, and the Advanced Plugins screen. Existing `convert`
continues to produce a Mini-A directory; `export` writes a ZIP.

```sh
mini-a pluginop=create pluginspec=plugin-spec.json pluginout=/tmp/my-plugin
mini-a pluginop=inspect pluginsource=/path/to/opencode-project
mini-a pluginop=convert pluginsource=/path/to/copilot-plugin pluginout=/tmp/converted
mini-a pluginop=export pluginsource=/tmp/my-plugin plugintarget=all pluginout=/tmp/targets.zip
mini-a pluginop=convert pluginsource=/path/to/source pluginout=/tmp/converted plugindryrun=true
```

Targets are `minia`, `claude`, `chatgpt`, `opencode`, `copilot`, `universal`, and
`all`. `all` produces a distribution ZIP containing five destination ZIPs.
`universal` includes a portable root and an OpenCode configuration fragment.
Extract the archive before installation and merge OpenCode `mcp.servers` into
existing configuration. Exports do not modify destination configuration.

Creation specifications use this shape:

```json
{
  "metadata": { "name": "my-plugin", "version": "0.1.0", "description": "My workflow" },
  "template": "combined",
  "components": [
    { "kind": "skills", "name": "review", "source": "/path/to/review" },
    { "kind": "scripts", "name": "helper.py", "source": "/path/to/helper.py" }
  ],
  "mcp": {},
  "hooks": {}
}
```

Component kinds are `skills`, `commands`, `hooks`, `scripts`, `assets`,
`references`, and `templates`. Templates are `skills`, `mcp`, and `combined`.
The console prompts for metadata and component paths; the web screen provides metadata, template, component, remote MCP and hook fields,
with an editable JSON specification under collapsed Advanced controls. `/plugins` accepts the same specification as
an object in `spec` and uses `target`, `format`, `exclude`, and `dryRun` fields.
`inventory` reports managed installations and configured skill/command roots.

OpenCode V2 project bundles with `opencode.json` or `opencode.jsonc` support
skills, Markdown commands, and declarative `mcp.servers` conversion. JSONC is
parsed without evaluating code. Copilot Agent Plugins support portable skills,
MCP definitions, and namespaced Markdown commands. `install` converts these
sources automatically and leaves installations disabled. `pluginformat` can
supply an explicit source-format override. `pluginid` selects an installed
package instead of `pluginsource`.

Inspection returns stable component IDs and blockers. Use `pluginexclude` with
a comma-separated list of IDs (or `exclude` array in API requests) to explicitly
omit unsupported components. Executable OpenCode plugins, agent profiles and
unverified hook protocol mappings are blocked. General VS Code `.vsix`
extensions cannot be converted. Copilot version 1 synchronous command hooks for `userPromptSubmitted`,
`preToolUse` and `postToolUse` can be imported into Mini-A. Cross-platform `command`
handlers support matchers and timeouts. Platform-specific commands, cwd/environment
overrides and input rewriting remain unsupported. Copilot prompt/post-hook JSON
control output is ignored, and Mini-A fails closed on pre-action execution errors,
including timeouts. The compatibility report identifies this stricter behavior.

OpenCode exports can include a generated V2 `PreToolUse` adapter. It supports
synchronous command hooks and fail-closed denial, without context injection,
input rewriting or persistent plugin-data placeholders. Mini-A imports this adapter
only when its code matches the generator exactly and its descriptor validates;
arbitrary executable OpenCode code still requires explicit exclusion. Local tests
execute the adapter with the OpenCode registration API stubbed. Actual OpenCode,
Copilot and other vendor runtime verification remains outstanding. Supporting resources outside conventional directories
must be included explicitly during assembly.

Additional validation: `openaf -f tests/pluginTargets.js`.

Guided web form validation: `node tests/webPluginCreation.cjs`. Chrome verification on 2026-11-14 covered the guided creation layout, collapsed Advanced settings, successful plugin creation, OpenCode conversion, completed all-target download, and explicit hook exclusion blocking/recovery. The downloaded archive was checked for all five destination ZIPs, and the excluded hook was confirmed absent from output. Vendor runtime execution remains unverified.
