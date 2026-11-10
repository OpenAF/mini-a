---
name: mini-a-visual-output
description: Author Chart.js charts, Mermaid diagrams, LaTeX math, and Leaflet maps in Mini-A responses; select SVG or console charts when appropriate.
requires:
  anyTools: [printChart]
  anyFlags: [usecharts, usediagrams, usemaps, usemath, useasciiviz, usesvg]
---
# Pick the right visual output

Use for responses with enabled renderers. The system prompt defines output formats; this skill does not enable capabilities or build standalone apps/documents.

1. Respect the requested output and enabled formats: numeric trends/comparisons -> chart; relationships/flows -> diagram; locations -> map; equations -> math. Combine formats for complementary insights.
2. Before authoring, read only the relevant reference with `skills operation=read name=mini-a-visual-output reference=references/<file>`:
   - `usecharts`: @references/chartjs.md
   - `usediagrams` (alias `usemermaid`): @references/mermaid.md; read its capability index first, then only the relevant examples below.
   - `usemath`: @references/latex-math.md
   - `usemaps`: @references/leaflet.md
3. Trace values/coordinates to supplied or retrieved evidence; never invent missing data. Use labelled illustrative data only when requested. Reference examples are synthetic.
4. Chart/map fences require strict JSON without code or callbacks; Mermaid uses diagram syntax; math uses `$...$`/`$$...$$` outside code fences. `usesvg` allows custom SVG illustrations; prefer supported charts/diagrams for standard data/structures.
   For Mermaid, use one diagram grammar per fence. Treemaps require numeric quantities for every leaf; use a mindmap or flowchart for an unweighted hierarchy. Never invent weights to force a treemap.
5. `useasciiviz` answer charts use `oafPrintChart` JSON fences. Interim `printChart` calls do not replace final charts. Console transcripts preserve browser visual source.
6. Check syntax, data, labels, and units; add a short caption. Claim rendering only after observing it. If unavailable or failed, retain useful source and provide a table, textual explanation, or readable formula.

Completion: answer the request with traceable data and enabled formats; report only checks actually performed.

## Mermaid examples on demand

These files are declared for progressive reads, not for loading together. Use the same `skills operation=read` call with the selected reference path. Stay within the shared context budget.

- Flowchart, sequence, Gantt: @references/mermaid-basics.md
- Class, state, ER, requirements, C4, use case, architecture: @references/mermaid-structure.md
- Journey, mindmap, Git, timeline, Kanban: @references/mermaid-planning.md
- Pie, quadrant, XY, Sankey, radar, treemap, packet, block: @references/mermaid-data.md
- Ishikawa, event modeling, Venn, TreeView, Wardley, Cynefin: @references/mermaid-analysis.md
- Railroad IR, EBNF, ABNF, PEG: @references/mermaid-grammars.md
