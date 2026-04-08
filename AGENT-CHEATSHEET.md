# Agent File Cheatsheet

Quick reference for Mini-A `agent=` files.

## Use
- File path: `mini-a agent=examples/summary.agent.md goal="..."`
- Inline markdown: `mini-a agent="---\nname: quick\n...\n---" goal="..."`
- Print starter template: `mini-a --agent`

## Supported frontmatter keys

| Key | Type | Maps to |
|---|---|---|
| `name` | string | Metadata only (for your own labeling) |
| `description` | string | Metadata only |
| `model` | string/object | `model=` |
| `capabilities` | array/string | `useshell`, `readwrite`, `useutils`, `usetools` |
| `tools` | array | Merged into `mcp` |
| `constraints` | array/string | Appended to `rules` as bullet list |
| `rules` | array/string | `rules=` (used when not already provided) |
| `knowledge` | array/string | `knowledge=` |
| `youare` | array/string | `youare=` |
| `mini-a` | map | Direct Mini-A arg overrides from the agent file |

## Tools entries

```yaml
tools:
  - type: ojob
    options:
      job: mcps/mcp-time.yaml
  - type: stdio
    cmd: npx -y @modelcontextprotocol/server-filesystem /tmp
  - type: remote
    url: http://localhost:9090/mcp
  - type: sse
    url: http://localhost:9090/mcp
```

## Minimal template

```markdown
---
name: my-agent
description: What this agent does
model: "(type: openai, model: gpt-5-mini, key: '...')"
capabilities:
  - useutils
  - usetools
mini-a:
  useplanning: true
  usestream: true
constraints:
  - Prefer tool-grounded answers.
knowledge: |
  Add context here.
youare: |
  You are a specialized AI agent for <domain>.
---
```

## Notes
- `agent=` is the primary parameter.
- `agentfile=` still works as a backward-compatible alias.
- `mini-a:` overrides values set before agent parsing (for example mode defaults).
- Explicit CLI flags still take precedence over agent file values.
- Relative file references inside file-backed agent profiles are resolved from the profile's own directory.
