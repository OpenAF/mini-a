# Leaflet response maps

The web UI targets **Leaflet 1.9.4**, the latest stable release when reviewed. Leaflet 2 is still beta and changes the JavaScript API; its examples do not apply to this wrapper. CSS, JavaScript and default icon URLs share the 1.9.4 pin.

Use `usemaps=true` and a `leaflet` fence containing strict JSON. This is Mini-A's map configuration, not an arbitrary Leaflet program. No JavaScript, callbacks, geocoding, external data fetches, or custom tile URLs in the config. Map tiles themselves use the UI's OpenStreetMap layer and require network access.

## Markers, line, and coverage circle

This is an illustrative map with supplied sample coordinates, not a verified route or service area. Replace these coordinates with user-provided or retrieved locations.

```leaflet
{"center":[51.505,-0.09],"zoom":13,"markers":[{"lat":51.5,"lon":-0.09,"popup":"Sample A","icon":"blue"},{"lat":51.51,"lon":-0.1,"popup":"Sample B","icon":"orange"}],"layers":[{"type":"polyline","points":[[51.5,-0.09],[51.51,-0.1]],"color":"#3388ff","weight":3},{"type":"circle","center":[51.5,-0.09],"radius":500,"color":"#3388ff","fillOpacity":0.2}],"options":{"scrollWheelZoom":false}}
```

## Supported configuration

- Required `center`: `[latitude, longitude]`. Optional `zoom`: typically 1–18; omitted means 13. The current renderer treats zero as the default, so do not use zero to request a world view.
- Optional `markers`: `{lat, lon, popup?, icon?}` objects. Icons: default, red, green, blue, orange, yellow, violet, grey, black. Unknown/omitted icons use blue. Prefer plain-text popup labels.
- Optional `layers`: `circle` with center/radius (meters); `polyline` or `polygon` with points; `rectangle` with two bounds corners. Use only the color/fill/weight options described by the system prompt.
- Optional `options`: only `scrollWheelZoom` and `dragging` are applied; `false` disables that interaction. GeoJSON and arbitrary Leaflet options are not supported by this wrapper.

## Checks and fallback

Check strict JSON, finite coordinates, latitude in [-90,90], longitude in [-180,180], and latitude-first order in every location. Circle radius must be positive. Keep marker labels meaningful and use a caption; colors should supplement labels. A straight polyline is not a road-routing result, and a circle is not proof of geographic coverage.

Never invent coordinates for a real address. If location evidence or rendering is unavailable, provide a location table/text and explain the missing evidence or asset. Config validation, map initialization, and visible tile loading are separate checks; report only what was observed.
