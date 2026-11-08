# Mermaid 12.0.0: quantities and layout

Examples use illustrative values. Match labels to values; do not invent real measurements. Preserve strict mode and theme defaults.

## Pie

Quoted labels map to nonnegative values; `showData` displays values.

```mermaid
pie showData title Notes by topic
  "Work" : 6
  "Home" : 4
```

## Quadrant

Points use normalized coordinates in [0,1]. Set axis ends and quadrant labels; optional point styling uses this family's grammar.

```mermaid
quadrantChart
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Plan
  quadrant-2 Do
  quadrant-3 Defer
  quadrant-4 Reconsider
  Search: [0.3, 0.8]
```

## XY

Use aligned category/value arrays; `bar` and `line` can share axes. Use Chart.js for scatter/bubble plots when enabled.

```mermaid
xychart-beta
  title "Weekly notes"
  x-axis [Mon, Tue, Wed]
  y-axis "Count" 0 --> 10
  bar [3, 5, 8]
  line [2, 4, 6]
```

## Sankey

Rows are CSV source,target,value without a header. Use positive weights; quote names containing commas.

```mermaid
sankey-beta
Inbox,Work,6
Inbox,Home,4
Work,Archive,2
```

## Radar

Each curve has one value per axis, in axis order. Set min/max and optionally `graticule polygon`.

```mermaid
radar-beta
  title Search options
  axis s["Speed"], q["Quality"], c["Coverage"]
  curve a["Local"]{4, 3, 5}
  curve b["Remote"]{3, 5, 4}
  min 0
  max 5
```

## Treemap

Indent quoted groups and leaves; only leaves receive numeric values. The keyword is `treemap-beta`.

```mermaid
treemap-beta
"Notes"
  "Work"
    "Projects": 6
    "Meetings": 4
  "Home": 3
```

## Packet

Inclusive bit ranges label fields. Use explicit offsets or the renderer's relative-width syntax; these are bit lengths, not byte counts.

```mermaid
packet
  0-7: "Kind"
  8-15: "Flags"
  16-31: "Length"
```

## Block

Set column count, node spans (`:N`) and `space` explicitly. Nested blocks group layouts; arrows connect declared block ids.

```mermaid
block-beta
  columns 3
  reader["Reader"] api["API"] store[("Store")]
  reader --> api
  api --> store
```
