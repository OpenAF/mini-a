# Skills Alternative Format (YAML/JSON) — Implementation Plan

## Goal

Add an optional, self-contained skills format (`SKILL.yaml` / `SKILL.json`) that can represent:

- Current `SKILL.md` metadata (front-matter) + body markdown
- Additional markdown/reference files normally stored as sibling files
- Nested sub-folders and sub-files as structured map/array entries

This format should keep existing markdown skills working unchanged, while enabling easier authoring and portability for skill packs.

## Why this is needed

Current folder skills rely on filesystem layout (`SKILL.md` + relative files). This has friction for:

- Packaging a complete skill as one artifact
- Sharing across systems where folder structure is inconvenient
- Rewriting metadata duplicated in front-matter + content files
- Resolving `@ref.md` safely and consistently in different runtimes

## Scope and compatibility

- **No breaking changes**: existing `SKILL.md` and `<name>.md` keep working.
- Add support for `SKILL.yaml`, `SKILL.yml`, and `SKILL.json` in skill folders.
- If multiple formats exist in one folder, use deterministic precedence:
  1. `SKILL.yaml`
  2. `SKILL.yml`
  3. `SKILL.json`
  4. `SKILL.md`
  5. `skill.md`
- Keep command/skill naming rules unchanged.

## Proposed schema (human-first YAML)

YAML should be the primary authoring target. JSON remains machine-friendly parity.

```yaml
schema: mini-a.skill/v1
name: release-notes
summary: Draft release notes from commits and changelog context

body: |
  Produce release notes for version {{arg1}}.
  Use @voice.md and @template.md.

meta:
  tags: [docs, changelog]
  version: 1
  author: team-docs

refs:
  voice.md: |
    Keep language concise and user-focused.
  voices/female/voice.md: |
    Keep tone warm and concise.
  voice:
    refs:
      female:
        refs:
          voice.md: |
            Keep wording empathetic and direct.
  template.md: |
    ## Highlights
    ## Fixes

children:
  - path: checks
    refs:
      checks/quality.md: |
        Validate date formatting and bullet consistency.
    children:
      - path: checks/security
        refs:
          checks/security/redflags.md: |
            Flag any secrets or internal tokens.
```

### Schema notes

- `body` contains what is currently markdown body in `SKILL.md`.
- `meta` maps front-matter-like metadata.
- `refs` supports multiple human-friendly styles:
  - flat path keys (e.g., `voice.md: ...`, `voices/female/voice.md: ...`)
  - nested refs maps (e.g., `voice: { refs: { female: { refs: { voice.md: ... }}}}`)
- `children` models sub-folders recursively to satisfy the requested sub-array structure.
- Internally flatten `children` + `refs` into a normalized `virtualFiles` map for lookup.
- When the same virtual path is defined multiple ways, last-write-wins with a warning (for deterministic behavior).

## Parser/runtime design

### 1) Discovery layer changes

Update shared resolver to accept alternate skill files in folders.

- `mini-a-common.js`: extend `__miniAResolveSkillTemplateFromFolder` candidate list.
- Reuse same resolver in:
  - `mini-a-con.js` (slash skill discovery)
  - `mini-a-utils.js` (`skills` operations)

### 2) Unified skill document loader

Add helper(s) in shared/common path to parse by extension:

- Markdown: existing behavior (`front-matter` + body)
- YAML/JSON: parse to internal normalized object:
  - `format`, `name`, `description/summary`, `bodyTemplate`, `virtualFiles`

### 3) Render pipeline

When invoking/rendering skills:

- Apply existing placeholder expansion (`{{args}}`, `{{arg1}}`, etc.) to `bodyTemplate`.
- For markdown skills: keep current behavior.
- For YAML/JSON skills:
  - Resolve `@relative/path.md` against `virtualFiles` first.
  - If not found in `virtualFiles`, optionally fall back to filesystem (same folder) for backward compatibility.

### 4) `@` reference resolution in self-contained mode

Enhancement for `preprocessSkillTemplateReferences` in `mini-a-con.js`:

- Add virtual resolver API: `resolveSkillRef(path, templateDef)`
- Lookup order:
  1. virtualFiles map (YAML/JSON embedded refs)
  2. actual files in skill folder (existing behavior)
- For matched virtual refs, inject content directly (same way linked markdown is currently inlined).
- Preserve escaping rules (`\@token` remains literal).

### 5) `skills` utility tool updates

`mini-a-utils.js` should return format-aware metadata in `list/read/render/invoke`:

- `sourceType`: `folder` / `file`
- `skillFormat`: `markdown` / `yaml` / `json`
- `templatePath` remains for traceability

## Practical YAML authoring guidance

To keep YAML easy for humans:

- Prefer `body: |` block for main markdown.
- Keep metadata in `meta` map (no front-matter required).
- Use short `refs` keys with folder-like paths (`refs/foo.md`).
- Keep large docs in `refs` entries, not escaped single-line strings.
- Provide `mini-a --skill --format=yaml` starter template generator (future enhancement).

## Significant improvements to include in this plan

1. **Format auto-migration tool**
   - Add a helper command to convert existing `SKILL.md` + local `.md` references into `SKILL.yaml`.
   - Lowers adoption cost and avoids manual rewrite errors.

2. **Schema validation + actionable errors**
   - Validate required keys (`schema`, `body`) and path safety.
   - Return clear messages with exact key paths (e.g., `children[1].refs["a.md"]`).

3. **Deterministic virtual path security**
   - Reject `..`, absolute paths, and URL-like refs inside `refs` keys.
   - Prevent traversal semantics from entering runtime resolution.

4. **Round-trip compatibility tests**
   - Ensure markdown and YAML skill render identical output for equivalent content.
   - Add fixtures for nested `children` and escaped `@` cases.

5. **Indexing/perf cache**
   - Cache parsed YAML/JSON skill docs by mtime to avoid repeated parse overhead in interactive sessions.

6. **Optional packaging support**
   - Future: single-file skill bundles or signed catalogs can directly store `SKILL.yaml` entries.

## Implementation phases

### Phase 1 — Core parsing and discovery

- Extend skill template candidate resolution.
- Add normalized skill document loader.
- Preserve existing markdown behavior.

### Phase 2 — Render/reference engine

- Add virtual ref lookup for `@` in skill templates.
- Keep fallback to local files.
- Add debug logs for reference source (virtual vs file).

### Phase 3 — Tooling and docs

- Update `/skills` display and skills tool payloads with `skillFormat`.
- Add starter examples for YAML and JSON skill definitions.
- Document migration path and compatibility.

### Phase 4 — Hardening

- Add tests for parsing, resolution, and invocation parity.
- Add schema validation and path safety checks.
- Add cache invalidation by mtime.

## Documentation update plan

Update docs in this repository to include:

1. `USAGE.md`
   - New section: "Alternative self-contained skill format (YAML/JSON)"
   - Examples for `SKILL.yaml` and `SKILL.json`
   - `@` resolution behavior and precedence

2. `README.md`
   - Extend skills path list to include `SKILL.yaml|yml|json`
   - Add short compatibility note and link to usage details

3. `CHEATSHEET.md` / `AGENT-CHEATSHEET.md` (optional concise note)
   - Mention quick structure and best-practice YAML blocks

4. `docs/WHATS-NEW.md`
   - Changelog entry when feature ships

## Acceptance criteria

- Existing markdown skills continue to work unchanged.
- Skill listing shows both markdown and YAML/JSON skills.
- YAML/JSON skill invocation renders correctly with placeholders.
- `@ref.md` in YAML/JSON body resolves from embedded `refs` first.
- Relative markdown links in YAML/JSON refs are inline-capable with existing safeguards.
- Documentation clearly explains both formats and migration path.

## Open decisions (recommendations)

- **Default authoring format**: recommend YAML.
- **`children` requirement**: keep optional; flatten internally.
- **Fallback behavior**: keep filesystem fallback ON initially for compatibility, with future strict mode.
- **Schema versioning**: require `schema: mini-a.skill/v1` to allow future evolution.
