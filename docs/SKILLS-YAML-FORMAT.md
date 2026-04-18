# Self-Contained Skill Format (YAML/JSON)

Mini-A supports an optional self-contained skill format that bundles the prompt body, metadata, and all referenced files into a single `SKILL.yaml` (or `SKILL.yml` / `SKILL.json`) file.

This format is an alternative to the standard `SKILL.md` approach and is designed for skill portability — you can share or deploy a complete skill as one file without copying a folder of supporting markdown files alongside it.

Existing `SKILL.md` skills continue to work unchanged.

Skill discovery ignores folders whose names end with `.disabled`, which lets you keep a skill installed without exposing it.

---

## When to use YAML vs Markdown

| | `SKILL.md` | `SKILL.yaml` |
|---|---|---|
| Simple, standalone prompts | preferred | works |
| Multiple supporting `@ref.md` files | requires folder layout | embed all in one file |
| Sharing or packaging a skill | zip/copy a folder | single file |
| Nested sub-folder structure | filesystem | `children` list |
| Machine generation or templating | awkward | natural |

---

## File precedence

When a skill folder contains multiple formats, Mini-A loads the first match in this order:

1. `SKILL.yaml`
2. `SKILL.yml`
3. `SKILL.json`
4. `SKILL.md`
5. `skill.md`

---

## Starter template

Run the following to print an annotated starter template:

```bash
mini-a --skills
```

Redirect it directly to a new skill file:

```bash
mkdir -p ~/.openaf-mini-a/skills/my-skill
mini-a --skills > ~/.openaf-mini-a/skills/my-skill/SKILL.yaml
```

---

## Schema

```yaml
schema: mini-a.skill/v1   # required; identifies the format version
name: my-skill             # required; used for /my-skill invocation
summary: Short description shown by /skills and help listings

body: |
  Main prompt template.  Placeholders and @-references are supported here.

meta:                      # optional metadata (mirrors SKILL.md front-matter)
  tags: [example]
  version: 1
  author: your-name

refs:                      # optional embedded reference files
  context.md: |
    Content injected when body contains @context.md.
  prompts/style.md: |
    Content for nested-path refs.

children:                  # optional nested sub-folder definitions
  - path: checks
    refs:
      checks/quality.md: |
        Content for this sub-folder ref.
    children:
      - path: checks/security
        refs:
          checks/security/redflags.md: |
            Content for deeply nested ref.
```

### Required fields

| Field | Description |
|-------|-------------|
| `schema` | Must be `mini-a.skill/v1`. Used to detect format version. |
| `name` | Skill name, used as the slash command (e.g. `name: review` → `/review`). |

### Optional fields

| Field | Description |
|-------|-------------|
| `summary` | Short description shown by `/skills` and help. Equivalent to `description` in `SKILL.md` front-matter. |
| `body` | Main prompt template. Supports placeholders and `@`-references. Use YAML block scalar `\|` for multi-line text. |
| `meta` | Arbitrary metadata map (tags, version, author, etc.). |
| `refs` | Map of virtual file paths to their text content (see below). |
| `children` | List of sub-folder definitions, each with a `path`, optional `refs`, and optional nested `children`. |

---

## Placeholders

The same placeholders supported in `SKILL.md` work in `body` and in embedded `refs` content:

| Placeholder | Expands to |
|-------------|------------|
| `{{args}}` | Raw argument string |
| `{{argv}}` | Parsed argument array as JSON |
| `{{argc}}` | Argument count |
| `{{arg1}}`, `{{arg2}}`, … | Positional arguments |

---

## `@`-reference resolution

When the rendered `body` contains `@context.md`, Mini-A resolves it in this order:

1. **Embedded refs** — looks up the path in the `refs` map (and flattened `children` refs).
2. **Filesystem fallback** — if not found in embedded refs, reads the file from the skill folder (same as the existing `SKILL.md` behavior).

Use `\@token` to prevent a token from being treated as a reference.

---

## `refs` map styles

### Flat paths (preferred)

```yaml
refs:
  context.md: |
    Direct context text.
  prompts/style.md: |
    Style guidance in a nested virtual path.
```

### Nested maps

For deeply nested paths you can express the same structure as a tree:

```yaml
refs:
  prompts:
    refs:
      style.md: |
        Style guidance.
```

Both styles are equivalent after internal flattening. Flat paths are easier to read.

---

## `children` list

`children` models sub-folders for cases where a skill logically contains sub-sections with their own reference files:

```yaml
children:
  - path: checks
    refs:
      checks/quality.md: |
        Quality checks.
    children:
      - path: checks/security
        refs:
          checks/security/redflags.md: |
            Security red flags.
```

Internally, `children` entries are flattened into the same `virtualFiles` map as top-level `refs`. The `path` prefix in each child entry is for organisation only; all paths in that child's `refs` should be fully qualified (i.e. include the `path` prefix).

---

## Full example

```yaml
schema: mini-a.skill/v1
name: release-notes
summary: Draft release notes from commits and changelog context

body: |
  Produce release notes for version {{arg1}}.

  Use the voice defined in @voice.md and the template in @template.md.

  Commits to summarise:
  {{args}}

meta:
  tags: [docs, changelog]
  version: 1
  author: team-docs

refs:
  voice.md: |
    Keep language concise and user-focused.
    Avoid internal jargon.
  template.md: |
    ## Highlights
    - …

    ## Bug Fixes
    - …

children:
  - path: checks
    refs:
      checks/quality.md: |
        Validate date formatting and bullet consistency before finalising.
    children:
      - path: checks/security
        refs:
          checks/security/redflags.md: |
            Flag any secrets or internal tokens found in the commit log.
```

Invoke it with:

```bash
/release-notes v2.4.0 "fix(auth): token refresh, feat(ui): dark mode"
```

---

## Invocation

YAML skills are invoked identically to markdown skills:

```bash
# Console
/my-skill arg1 arg2

# Dollar-prefix alias
$my-skill arg1

# Non-interactive
mini-a exec="/my-skill arg1 arg2"
```

---

## Migration from SKILL.md

To convert an existing folder skill:

1. Run `mini-a --skills` to get the starter template.
2. Copy the body from your `SKILL.md` into the `body:` field.
3. Copy front-matter keys (`name`, `description`, tags) into `name:`, `summary:`, and `meta:`.
4. For each sibling `.md` file referenced via `@`, add a matching entry under `refs:` and paste its content.
5. Save the result as `SKILL.yaml` in the same folder (or remove the old `SKILL.md`).

The old `SKILL.md` takes lower precedence than `SKILL.yaml` in the same folder, so you can keep both during migration without conflict.

---

## Related

- `mini-a --skill` — print the equivalent markdown skill starter template
- `mini-a --skills` — print this YAML skill starter template
- [USAGE.md](../USAGE.md) — full parameter catalog and command reference
- [docs/SKILLS-ALT-FORMAT-PLAN.md](SKILLS-ALT-FORMAT-PLAN.md) — design and implementation notes
