---
name: mini-a-visual-output
description: Choose and use Mini-A chart, diagram, map, and ASCII renderers for the right kind of data.
requires:
  anyTools: [printChart]
  anyFlags: [usecharts, usediagrams, usemaps, useasciiviz, usesvg]
---
# Pick the right visual output

Applies only to renderers enabled for this run (`usecharts`, `usediagrams`, `usemaps`, `useasciiviz`, `usesvg`). The system prompt defines exact fence formats; this adds selection guidance.

1. Numeric series, comparisons, distributions, progress: chart. Relationships, flows, sequences: diagram. Locations: map. Pick one visual per question.
2. Use only real values from tool results; never invent data points to fill a chart.
3. `printChart` calls give live interim output while working. They do not replace an answer chart the user asked for; include that in the final answer in the required fence.
4. Fences contain strict JSON only (no comments or code). If rendering fails, say so and give the data as a table.

Completion: every plotted value traces to retrieved data.
