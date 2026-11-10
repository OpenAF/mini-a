# Mermaid 12.0.0: flow, interactions and schedules

Read this file only for these families. Examples are illustrative; use supplied facts and dates for real work. Use `mermaid` fences and preserve strict mode.

## Flowchart

Use stable identifiers and double-quoted labels. Inner quotes use `#quot;`; traditional labels use `<br>` for line breaks. `@{ shape: ..., label: ... }` selects expanded shapes. Group related steps with subgraphs; use LR/RL/TB/BT for direction. Avoid unquoted lowercase `end` as a node label.

```mermaid
flowchart LR
  A["Receive request"] --> B{"Valid?"}
  subgraph processing ["Processing"]
    B -->|Yes| C@{ shape: docs, label: "Reply #quot;accepted#quot;" }
  end
  B -->|No| D["Explain error"]
```

## Sequence

Declare participants or actors. Use `alt/else/end`, `opt`, `loop`, `par/and/end`, notes and activation for interactions. Flowchart quoting rules do not apply to participant aliases or messages.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as Agent
  U->>+A: Request a summary
  alt Evidence available
    A-->>U: Return summary
  else Evidence missing
    A-->>U: Ask for context
  end
  deactivate A
```

## Gantt

Set `dateFormat`; give tasks identifiers and use `after <id>` for dependencies. `section`, `milestone`, `crit`, `active`, `done` and `excludes` describe schedules. Use actual dates/durations for real plans.

```mermaid
gantt
  title Illustrative delivery schedule
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  tickInterval 1day
  section Delivery
  Draft :draft, 2026-01-01, 2d
  Review :after draft, 1d
```
