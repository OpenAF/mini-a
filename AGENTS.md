# Repository Guidelines

## Project Structure & Module Organization
Mini-A runs on OpenAF jobs. The core agent logic lives in `mini-a.js`, while `mini-a.yaml` orchestrates CLI sessions and `mini-a-web.yaml` powers the HTTP UI. Shell wrappers (`mini-a.sh`, `mini-a-web.sh`) simply invoke those jobs. Supporting assets sit in `public/` (Markdown UI template plus vendored `showdown.min.js`). Use `mcps/` for built-in Model Context Protocol job descriptors and reference docs; each `.yaml` under that folder can be invoked through the `mcp=` parameter. Additional guidance and examples are in `USAGE.md` and `README.md`.

## Build, Test, and Development Commands
- `./mini-a.sh goal="draft release notes" useshell=false`: start the agent via oJob with the CLI wrapper.
- `ojob mini-a.yaml goal="..." debug=true`: run directly to see verbose logs for troubleshooting.
- `./mini-a-web.sh onport=8888`: launch the web interface and visit `http://localhost:8888`.
- `ojob mcps/mcp-db.yaml jdbc="..."`: exercise individual MCP descriptors during development.
Always export `OAF_MODEL="(type: ..., model: ..., key: ...)"` (and optionally `OAF_LC_MODEL`) before running.

## Coding Style & Naming Conventions
JavaScript executes inside OpenAF; keep two-space indentation and prefer `var` with camelCase names to match the existing code. Class-like helpers use PascalCase (e.g., `MiniA`), internal state uses `_` prefixes, and metrics keys stay snake_case. YAML files follow two-space indents with lower-case keys. Avoid introducing external dependencies without coordination—runtime expects the OpenAF standard library.

## Testing Guidelines
No automated test harness exists. Validate new behavior by scripting representative goals (see `USAGE.md`) and capture the agent transcript with `debug=true`. When adding MCP integrations, run the corresponding `mcp-*.yaml` job standalone before wiring it into Mini-A. Document manual verification steps in the PR description, and note any scenarios not exercised.

## Commit & Pull Request Guidelines
The Git history shows short imperative subjects (`Add usetools option`, `Update package`). Follow that style, keep subjects under ~70 characters, and include focused commits per concern. For pull requests, provide: concise summary of the change, rationale linking to any issue, reproduction or verification commands, and screenshots/terminal captures for UI or interaction updates. Flag configuration impacts (e.g., new environment variables) and call out any follow-up work needed.

## Security & Configuration Notes
Shell access is disabled by default—require contributors to opt in with `useshell=true` and justify commands touching the filesystem. Never commit secrets; rely on `OAF_MODEL` and related environment variables. When shipping MCP definitions, review default timeouts and permissions (`readwrite`, `shellallow`) to keep the agent constrained by default.
