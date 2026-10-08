# Runtime diagnostic boundaries

- `useskills=false` is the default. `useskills=true` exposes local skills, including the bundle, but does not grant tools or writes.
- Explicit `$local:name` invocation works with automatic selection disabled. `skillsautosearch` retains explicit overrides; its conditional default requires `usedecide=true` and decision-model configuration. Do not enable it merely to hide an explicit-loading fault.
- Decision-assisted selection routes through the configured decision model, low-cost model, and main model according to the existing fallback contract. Record which tier was actually called; configuration alone does not establish provider availability or latency.
- `fileallow` constrains covered built-in reads, including bundled instructions/references. `utilsroot` controls utilities' working root and does not choose the bundle. Tool filters, shell opt-in, read/write mode, and MCP permissions remain independent constraints.
- Skill activity distinguishes discovery, selection, loading, activation, blocking, and completion. Completion does not certify instruction compliance. Inspect the concrete retrieval/tool results for the claimed action.
- Checkout launch: `ojob mini-a.yaml goal="..." debug=true`. Installed launch: `opack exec mini-a goal="..." debug=true`. Web launch from a checkout: `./mini-a-web.sh onport=8888`. Avoid using a second live server as proof that an existing process reloaded.
- Inspect model environment presence and effective routing without printing `OAF_MODEL`, `OAF_LC_MODEL`, or other values containing credentials. Use redacted configuration in reports.

Static tests prove the tested contracts. Provider, live browser, MCP, and service behavior require separate live evidence. Preserve logs or transcripts only in an authorized location and report which scenarios remain unexercised.
