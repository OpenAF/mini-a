# Mermaid version and capability index

Use `usediagrams=true` (alias `usemermaid=true`) and a `mermaid` fence containing diagram syntax. The compatibility baseline and web CDN fallback are **Mermaid 12.0.0**. Installed oPacks may differ; use a known deployed version when available, otherwise keep to this baseline. This is documentation, not automatic version detection.

The following files contain small illustrative examples for the diagram families on the official all-examples page. Read only the file needed with `skills operation=read name=mini-a-visual-output reference=references/<file>`. Each file fits a default read; loading the whole catalogue can exceed the shared budget.

| Need | Reference | Keywords |
| --- | --- | --- |
| Flow, interactions, schedule | mermaid-basics.md | flowchart, sequenceDiagram, gantt |
| Software structures | mermaid-structure.md | classDiagram, stateDiagram-v2, erDiagram, requirementDiagram, C4Context/C4Container, usecase-beta, architecture-beta |
| Work and history | mermaid-planning.md | journey, mindmap, gitGraph, timeline, kanban |
| Quantities and layout | mermaid-data.md | pie, quadrantChart, xychart-beta, sankey-beta, radar-beta, treemap-beta, packet, block-beta |
| Analysis and trees | mermaid-analysis.md | ishikawa-beta, eventmodeling, venn-beta, treeView-beta, wardley-beta, cynefin-beta |
| Grammar rules | mermaid-grammars.md | railroad-beta, railroad-ebnf-beta, railroad-abnf-beta, railroad-peg-beta |

This catalogue is a starting point, not an allowlist. Additional types, aliases or newer constructs are usable when the deployed renderer supports them. Do not infer support from the latest website alone: https://mermaid.js.org/syntax/all-examples.html is rolling documentation (12.3.0 when reviewed). Check the matching release and validate unfamiliar syntax.

Keep strict security mode. ZenUML needs external registration; custom icon packs also need host registration. Prefer built-in icons, theme defaults and concise labels. Never weaken security or invent a diagram keyword to force a render.

Choose one diagram grammar per fence, identified by its opening keyword. Use only constructs supported by that family: do not transplant node shapes, edges, subgraphs, title declarations or label rules from another family. Changing a header does not convert the body; rewrite the entire diagram in the selected grammar. Put separate diagrams in separate fences.

Treemaps encode quantities as rectangle areas: every leaf needs an explicit numeric value. Use a mindmap or flowchart for an unweighted hierarchy. Never invent measurements or assign arbitrary equal weights to force a treemap. If a treemap is specifically required but values are missing, ask for the quantities. Read the selected family's reference before authoring unfamiliar syntax.

Check identifiers, brackets and diagram-specific rules. Use the loaded library to parse/render when available; parsing alone does not prove visible rendering. If support is uncertain or rendering fails, simplify to flowchart/sequence syntax or explain the relationships in text. Claim rendering only after observing it.
