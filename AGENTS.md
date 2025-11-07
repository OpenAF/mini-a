# Repository Guidelines

## Project Structure & Module Organization
Mini-A runs on OpenAF jobs. The core agent logic lives in `mini-a.js`, while `mini-a.yaml` orchestrates CLI sessions and `mini-a-web.yaml` powers the HTTP UI. The interactive console (`mini-a-con.js`) is exposed through `opack exec mini-a` (or the optional `mini-a` alias). Shell wrappers (`mini-a.sh`, `mini-a-web.sh`) invoke the same jobs when working from a cloned repository. Supporting assets sit in `public/` (Markdown UI template plus vendored `showdown.min.js`). Use `mcps/` for built-in Model Context Protocol job descriptors and reference docs; each `.yaml` under that folder can be invoked through the `mcp=` parameter. Additional guidance and examples are in `USAGE.md` and `README.md`.

## Build, Test, and Development Commands
- `mini-a goal="draft release notes" useshell=false`: start the agent from the installed console (alias shown after install). Use `opack exec mini-a ...` if you skipped the alias.
- `ojob mini-a.yaml goal="..." debug=true`: run directly to see verbose logs for troubleshooting.
- `./mini-a-web.sh onport=8888`: launch the web interface and visit `http://localhost:8888`.
- `ojob mcps/mcp-db.yaml jdbc="..."`: exercise individual MCP descriptors during development.
Always export `OAF_MODEL="(type: ..., model: ..., key: ...)"` (and optionally `OAF_LC_MODEL`) before running.

## Coding Style & Naming Conventions
JavaScript executes inside OpenAF; keep two-space indentation and prefer `var` with camelCase names to match the existing code. Class-like helpers use PascalCase (e.g., `MiniA`), internal state uses `_` prefixes, and metrics keys stay snake_case. YAML files follow two-space indents with lower-case keys. Avoid introducing external dependencies without coordination—runtime expects the OpenAF standard library.

## Testing Guidelines
Automated tests exist for utility modules under `tests/`. Run the mini-a-utils test suite with `ojob tests/miniAUtils.yaml` to verify file operations, mathematical operations, and time operations. When adding new functionality to `mini-a-utils.js`, extend the corresponding test file (`tests/miniAUtils.js`) and update the job configuration (`tests/miniAUtils.yaml`) with new test cases.

For core agent behavior, validate by scripting representative goals (see `USAGE.md`) and capture the agent transcript with `debug=true`. When adding MCP integrations, run the corresponding `mcp-*.yaml` job standalone before wiring it into Mini-A. Document manual verification steps in the PR description, and note any scenarios not exercised.

Current test coverage includes:
- **File Operations**: init, readFile, writeFile, listDirectory, searchContent, getFileInfo, deleteFile, filesystemQuery, filesystemModify, path security
- **Mathematical Operations**: calculate (add, subtract, multiply, divide, power, sqrt, abs, round), statistics (mean, median, min, max, sum, count), unit conversions, random generation (integer, sequence, choice, boolean, hex)
- **Time Operations**: current time with timezone/format options, timezone conversions, sleep functionality
- **Advanced Parameters**: UTF-8 encoding, createMissingDirs, contentLength reporting, append flags

## Commit & Pull Request Guidelines
The Git history shows short imperative subjects (`Add usetools option`, `Update package`). Follow that style, keep subjects under ~70 characters, and include focused commits per concern. For pull requests, provide: concise summary of the change, rationale linking to any issue, reproduction or verification commands, and screenshots/terminal captures for UI or interaction updates. Flag configuration impacts (e.g., new environment variables) and call out any follow-up work needed.

## Security & Configuration Notes
Shell access is disabled by default—require contributors to opt in with `useshell=true` and justify commands touching the filesystem. Never commit secrets; rely on `OAF_MODEL` and related environment variables. When shipping MCP definitions, review default timeouts and permissions (`readwrite`, `shellallow`) to keep the agent constrained by default.
