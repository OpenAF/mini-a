# Mini-A skill formats

## Local Markdown

Store `skills/<name>/SKILL.md` beneath a configured root. Use YAML frontmatter with `name` and `description`, followed by the prompt body. References such as `@references/checks.md` resolve relative to the skill directory. Keep needed files alongside the skill. Placeholders include `{{arg1}}` for positional arguments; validate with the shared renderer.

## Self-contained YAML or JSON

Use `schema: mini-a.skill/v1`, `name`, `summary`, and `body`. `meta` is optional metadata. Embed references in `refs`, mapping paths to text; optional `children` describe nested paths. JSON uses the equivalent object structure. Example:

```yaml
schema: mini-a.skill/v1
name: review-note
summary: Review a note for stated acceptance checks
body: |
  Review {{arg1}} using @checks.md.
refs:
  checks.md: |
    Identify unsupported claims and missing evidence.
```

Within a folder, template precedence is `SKILL.yaml`, `SKILL.yml`, `SKILL.json`, `SKILL.md`, then `skill.md`. Avoid leaving a stale higher-priority template beside a repaired Markdown file. Folders ending `.disabled` are excluded from discovery.

## Virtual wiki Markdown

Use a wiki page with frontmatter `type: skill`, `name`, and `description`. Optional `tags` and `intent` support discovery. Supply navigable headings such as When to use, Procedure, and Acceptance checks. Ordinary wiki pages are not automatically skills. Use managed wiki writes and regenerate indexes/reindex only when part of the authorized authoring work and supported by the backend. Verify `skillwiki` context/search/open/read/resolve against the selected source and access mode.

Local invocation: `$local:<name> "argument"`; virtual invocation uses the exact `wiki:` reference returned by discovery. Bare names can be ambiguous across providers. User/default, extra, and plugin roots precede bundled roots; first local root wins.

## Availability requirements

A local skill may declare `requires` frontmatter. A skill whose requirements are unmet is hidden from listing, search, `$name` matching, and automatic selection:

```yaml
requires:
  tools: [name, ...]     # all of these tools must be present
  anyTools: [name, ...]  # at least one tool present
  anyFlags: [usecharts]  # at least one Mini-A option is true
```

When both `anyTools` and `anyFlags` are given, either satisfies the skill. `shell` and `bash` count as present when `useshell=true`. Skills without `requires` are always available.
