# Repository Guidelines

## Project Structure & Module Organization
Mini-A runs on OpenAF jobs. The public library entry point is `mini-a.js`; core agent logic lives in `js/core/mini-a.js`, while `mini-a.yaml` orchestrates CLI sessions and `mini-a-web.yaml` powers the HTTP UI. The interactive console (`mini-a-con.js`) is exposed through `opack exec mini-a` (or the optional `mini-a` alias). Delegation and sub-goal management is handled by `js/core/mini-a-subtask.js` (the `SubtaskManager` class for local and remote delegation) and `mini-a-worker.yaml` (headless HTTP API for distributed agent workloads). Shell wrappers (`mini-a.sh`, `mini-a-web.sh`) invoke the same jobs when working from a cloned repository. Supporting assets sit in `public/` (Markdown UI template plus vendored `showdown.min.js`). Use `mcps/` for built-in Model Context Protocol job descriptors and reference docs; each `.yaml` under that folder can be invoked through the `mcp=` parameter. Additional guidance and examples are in `USAGE.md` and `README.md`.

Internal JavaScript is grouped under `js/core`, `js/session`, `js/web`, `js/memory`, `js/skills`, `js/wiki`, and `js/studio`. Root JavaScript files are public entry-point facades. Use package-relative `loadLib` paths through `js/mini-a-paths.js` for internal dependencies, preserving explicit reloads for executable managers and core prototype mixins.

## Build, Test, and Development Commands
- `mini-a goal="draft release notes" useshell=false`: start the agent from the installed console (alias shown after install). Use `opack exec mini-a ...` if you skipped the alias.
- `ojob mini-a.yaml goal="..." debug=true`: run directly to see verbose logs for troubleshooting.
- `./mini-a-web.sh onport=8888`: launch the web interface and visit `http://localhost:8888`.
- `ojob mcps/mcp-db.yaml jdbc="..."`: exercise individual MCP descriptors during development.
Always export `OAF_MODEL="(type: ..., model: ..., key: ...)"` (and optionally `OAF_LC_MODEL`) before running.

## Coding Style & Naming Conventions
JavaScript executes inside OpenAF; keep two-space indentation and prefer `var` with camelCase names to match the existing code. Class-like helpers use PascalCase (e.g., `MiniA`), internal state uses `_` prefixes, and metrics keys stay snake_case. Follow the layout of OpenAF's own `js/openaf.js` (keeping two-space indentation instead of its tabs) for new and edited code, including browser code under `public/`:
- One statement per line; no semicolons at line ends; spaces around operators, after commas and keywords (`if (x) {`), and inside object literals (`{ a: 1 }`). Do not pack several statements onto one line; reformat dense code you touch.
- Use `var` and `function` declarations; keep arrow functions for short inline callbacks (`map`, `filter`, `forEach`).
- Break long call chains one call per line, aligned under the first call, as in `_wikiPathFor` in `js/wiki/mini-a-ingest.js`.
- Use `isDef`/`isUnDef`/`isString`-style checks (explicit `typeof`/`length` checks in browser code) rather than truthiness when a value can be `""` or `0`.
- Put a short `//` comment above each function or logical block saying what it does or why (not how); separate blocks with a blank line. Public library functions may carry `<odoc>` blocks like `js/openaf.js`. YAML files follow two-space indents with lower-case keys. Avoid introducing external dependencies without coordination—runtime expects the OpenAF standard library.

## Testing Guidelines
Automated tests exist for utility modules under `tests/`. Run the mini-a-utils test suite with `ojob tests/miniAUtils.yaml` to verify file operations, mathematical operations, and time operations. When adding new functionality to `js/core/mini-a-utils.js`, extend the corresponding test file (`tests/miniAUtils.js`) and update the job configuration (`tests/miniAUtils.yaml`) with new test cases.

For module layout and loading changes, run `node tests/modulePaths.cjs` and `python3 tests/modulePaths.py`; these cover path precedence, unrelated working directories, copied packages, reloads, and repeated command entry points.

For core agent behavior, validate by scripting representative goals (see `USAGE.md`) and capture the agent transcript with `debug=true`. When adding MCP integrations, run the corresponding `mcp-*.yaml` job standalone before wiring it into Mini-A. Document manual verification steps in the PR description, and note any scenarios not exercised.

For wiki behavior, run `ojob tests/wiki.yaml`. Hierarchical wiki changes should preserve flat `.md` path compatibility while treating folders with `index.md` as browsable sub-wikis; validate `tree`, `browse`, `backlinks`, `move`, lint checks, and `mcps/mcp-wiki.yaml` metadata together.

Current test coverage includes:
- **File Operations**: init, readFile, writeFile, listDirectory, searchContent, getFileInfo, deleteFile, filesystemQuery, filesystemModify, path security
- **Mathematical Operations**: calculate (add, subtract, multiply, divide, power, sqrt, abs, round), statistics (mean, median, min, max, sum, count), unit conversions, random generation (integer, sequence, choice, boolean, hex)
- **Time Operations**: current time with timezone/format options, timezone conversions, sleep functionality
- **Advanced Parameters**: UTF-8 encoding, createMissingDirs, contentLength reporting, append flags

## Commit & Pull Request Guidelines
The Git history shows short imperative subjects (`Add usetools option`, `Update package`). Follow that style, keep subjects under ~70 characters, and include focused commits per concern. For pull requests, provide: concise summary of the change, rationale linking to any issue, reproduction or verification commands, and screenshots/terminal captures for UI or interaction updates. Flag configuration impacts (e.g., new environment variables) and call out any follow-up work needed.

## Security & Configuration Notes
Shell access is disabled by default—require contributors to opt in with `useshell=true` and justify commands touching the filesystem. Never commit secrets; rely on `OAF_MODEL` and related environment variables. When shipping MCP definitions, review default timeouts and permissions (`readwrite`, `shellallow`) to keep the agent constrained by default.

## Consistent Web and Console/TUI UX
- Keep standalone console managers (`modelman=true`, `wikiman=true`, `pluginman=true`, and future managers) visually consistent: reuse the Mini-A banner and accent palette, emoji action labels, terminal-width separators, compact CSLON results, and framed current-resource summaries where appropriate. Keep operation IDs separate from display labels and preserve adapter-aware structured output, Back/Cancel, and activation-scope explanations.
- Treat web advanced view, console, and TUI as presentations of the same workflows. Reuse management services and adapter-aware `ask`/`askChoose` prompts; keep explicit CLI/request forms available for automation.
- Match neighboring screens: include a currentColor SVG for every advanced navigation entry, shared themed cards/action rows, persistent field labels, responsive spacing, and keyboard-visible focus. Use existing components and theme variables.
- Start with the common task and reveal operation-specific fields as needed. Keep advanced JSON and uncommon options collapsed. Distinguish browser uploads/downloads from server paths.
- Provide loading, empty, success, and actionable error states; prevent duplicate submissions and stale results after navigation/session changes. Preserve entered values after errors.
- Console/TUI menus must support Back/Cancel, normalize choice results, identify selected resources clearly, and avoid submitting partial requests. Explain activation scope and confirm destructive selections consistently across surfaces.
- Verify changed workflows with focused behavioral tests, a running browser in light/dark and narrow layouts, and an interactive terminal where available. Report any visual or runtime checks not exercised; static tests alone do not establish visual correctness.
