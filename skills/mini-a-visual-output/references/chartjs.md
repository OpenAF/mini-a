# Chart.js response charts

Use `usecharts=true` and a `chart` fence (`chartjs` and `chart.js` are aliases). Supply a complete static JSON configuration with a top-level `type` and `data.datasets`. No JavaScript, callbacks, `new Chart`, HTML canvas, Date objects, or fetching. Examples below use illustrative data; replace it with supplied or retrieved values.

## Common patterns

Category comparisons use labels aligned with each dataset. Start bar axes at zero unless a different baseline is clearly justified.

```chart
{"type":"bar","data":{"labels":["North","South"],"datasets":[{"label":"Orders","backgroundColor":"#3388ff","data":[12,18]}]},"options":{"scales":{"y":{"beginAtZero":true,"title":{"display":true,"text":"Orders"}}}}}
```

Time series use ISO strings or numeric timestamps with the loaded date adapter. Keep dates ordered and avoid ambiguous local dates. Point objects do not require `data.labels`.

```chart
{"type":"line","data":{"datasets":[{"label":"Temperature (°C)","borderColor":"#3388ff","data":[{"x":"2026-01-01T00:00:00Z","y":12},{"x":"2026-01-02T00:00:00Z","y":15}]}]},"options":{"scales":{"x":{"type":"time"},"y":{"title":{"display":true,"text":"°C"}}}}}
```

Scatter charts use numeric `{x,y}` points, with axis labels and units.

```chart
{"type":"scatter","data":{"datasets":[{"label":"Samples","backgroundColor":"#3388ff","data":[{"x":1,"y":3},{"x":2,"y":5}]}]},"options":{"scales":{"x":{"title":{"display":true,"text":"Time (h)"}},"y":{"title":{"display":true,"text":"Distance (km)"}}}}}
```

Mixed charts keep a supported top-level type and override individual datasets; `mixed` is not a chart type.

```chart
{"type":"bar","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Actual (units)","backgroundColor":"#3388ff","data":[12,18]},{"type":"line","label":"Target (units)","borderColor":"#e79f00","data":[15,15]}]},"options":{"scales":{"y":{"beginAtZero":true}}}}
```

## Compatibility and checks

Core types are bar, line, scatter, bubble, pie, doughnut, polarArea, and radar. The web loader also requests boxplot/violin, treemap, sankey, matrix, graph, and geo plugins plus the time adapter. Those depend on successful asset loading; financial, wordcloud, and sunburst plugins are not bundled by this UI.

Check JSON parsing, finite numeric values, matching category/data lengths, and required point fields (`r` for bubbles). Represent missing observations as `null`, not invented zeroes. Keep titles, dataset labels, units, and a short caption; optional `canvas: {"width":640,"height":360}` controls size. Avoid relying on color alone.

If assets or rendering are unavailable, give the values as a table and preserve the config when useful. JSON validity alone does not prove a chart rendered. Use SVG only for unsupported custom visuals when enabled.
