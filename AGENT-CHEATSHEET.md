# Agent File Cheatsheet

Quick reference for Mini-A `agent=` files.

**Website**: https://mini-a.ai | **Toolkit**: https://tk.mini-a.ai

## Use
- File path: `mini-a agent=examples/summary.agent.md goal="..."`
- Inline markdown: `mini-a agent="---\nname: quick\n...\n---" goal="..."`
- Print starter template: `mini-a --agent`
- Related starter templates: `mini-a --skill`, `mini-a --command`, `mini-a --hook`

## Supported frontmatter keys

| Key | Type | Maps to |
|---|---|---|
| `name` | string | Metadata only (for your own labeling) |
| `description` | string | Metadata only |
| `model` | string/object | `model=` |
| `capabilities` | array/string | `useshell`, `readwrite`, `useutils`, `usetools`, `usetoolslc` |
| `tools` | array | Merged into `mcp` |
| `constraints` | array/string | Appended to `rules` as bullet list |
| `rules` | array/string | `rules=` (used when not already provided) |
| `knowledge` | array/string | `knowledge=` |
| `youare` | array/string | `youare=` |
| `mini-a` | map | Direct Mini-A arg overrides from the agent file — supports all params including `usewiki`, `wikiaccess`, `wikibackend`, `wikiroot`, `wikibucket`, `usememory`, `memoryuser`, etc. |

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
- `mini-a:` overrides values that were **not explicitly set** on the CLI — including mode defaults and parameter defaults. Explicit CLI flags always take precedence.
- Relative file references inside file-backed agent profiles are resolved from the profile's own directory.

## Resources

- **Website**: https://mini-a.ai
- **Toolkit**: https://tk.mini-a.ai
- **Full Cheatsheet**: [CHEATSHEET.md](CHEATSHEET.md)
- **Usage Guide**: [USAGE.md](USAGE.md)
- **Issues**: https://github.com/openaf/mini-a/issues
