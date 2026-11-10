# Mermaid 12.0.0: work and history

Examples are illustrative. Load only when these families fit the request; preserve supplied facts and strict mode.

## User journey

Tasks have `label: score: actors`; sections group stages. Scores describe experience, not durations.

```mermaid
journey
  title Find a note
  section Search
    Enter query: 4: Reader
    Review results: 5: Reader
  section Use
    Open note: 5: Reader
```

## Mindmap

Indentation defines hierarchy. Shapes are optional; avoid icon classes that depend on unloaded fonts.

```mermaid
mindmap
  root((Notes))
    Capture
      Text
      Links
    Retrieve
      Search
      Browse
```

## Git graph

Use commit, branch, checkout and merge in executable order. Optional commit `id`, `tag` and `type` annotate history; do not merge a branch into itself.

```mermaid
gitGraph
  commit id: "Start"
  branch draft
  checkout draft
  commit id: "Write"
  checkout main
  merge draft
  commit tag: "v1"
```

## Timeline

Use `period : event` and sections for phases. Additional colon-prefixed events share the preceding period.

```mermaid
timeline
  title Illustrative release history
  section Prototype
    2025 : Local notes
  section Service
    2026 : Search
         : Shared reading
```

## Kanban

Indent cards under columns. Stable identifiers and quoted labels are useful; optional `@{ assigned: ..., priority: ..., ticket: ... }` metadata annotates cards. External ticket links depend on host settings.

```mermaid
kanban
  todo[To do]
    search[Improve search]
  active[In progress]
    docs[Write guide]@{ priority: 'High' }
  done[Done]
    tests[Check examples]
```
