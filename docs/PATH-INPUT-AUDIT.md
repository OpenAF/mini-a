# File-path spaces audit — 2026-09-24

The review traced console command operands and completion, inline attachments,
skill-template references, startup/session configuration, ingestion, filesystem
tools/MCP descriptors, browser uploads, and shell wrappers. Internal spaces,
including repeated spaces, are supported by the corrected entry points below.

| Entry point | Finding and result | Evidence |
|---|---|---|
| `/ingest <source> [section]` and `sourceid=` | Replaced whitespace splitting with quoted/escaped operands; reject extra operands instead of silently ignoring them. | Console handler tests; filesystem ingestion/recovery test with a spaced directory and filename. |
| `/wiki write`, `move`/`mv`, `attach root=` | Parse individual quoted paths; preserve inline write content verbatim after the operand separator. | Console handler tests. |
| `/wiki list`, `tree`, `browse`, `read`, `backlinks`, `delete` aliases, `init` | Decode whole quoted paths; retain unquoted single-path support and repeated internal spaces. | Source review; read-handler regression; wiki suite. |
| `/graph path`, `neighbors`, `cross` | Decode quoted node/page references; validate exactly two path endpoints. | Source review; path-handler regression. |
| `/skills open`, `read`, `related` | Decode quoted references without splitting a reference at its spaces. | Source review of handlers and shared path parser. |
| `/save` | Strip syntactic quotes before filesystem writes; preserve unquoted filenames with spaces. | Actual save branch tested with a mocked writer. |
| `/stats out=`, `file=`, `save=`, `json=`; custom slash/skill arguments | Existing quote-aware argument parsing supports spaces. Completion now retains quoted filename boundaries for stats. | Source review; production completion callback regression. |
| `@file` goal attachments | Support `@"my file.md"`, `@'my file.md'`, and escaped spaces. | Production attachment handler reads real temporary files. |
| Skill-template references | Console and utility preprocessing support quoted `@` references and angle-bracket Markdown destinations; resolved references remain quoted. | Utility tests with physical and virtual files; console source review. |
| File-path completion | Quote candidates containing spaces; retain partial quoted operands for attachments, ingest, save, stats and wiki paths, including a move's second path. | Production callback tests with simulated JLine candidates; no live terminal Tab test. |
| `/set` and startup options | Values are retained as strings. Shell callers must quote the argument; JSON/YAML callers must supply string values without embedded syntactic quotes. Includes conversation/history, roots, wiki/index/archive roots, skill/hook/command directories, debug/eval files and ingestion ledger/source settings. | Source review of console setters, jobs and filesystem consumers. |
| Comma-separated directory/include/exclude options | Split on commas, not spaces. Spaces within each entry survive. | Source review. Commas inside a path remain a separate syntax limitation. |
| Structured file, document, wiki and skill tools; `mcps/mcp-file.yaml` | File paths are string properties passed to filesystem/path APIs rather than whitespace-tokenized command lines. | Source review; utility and wiki suites. No live MCP transport test in this audit. |
| Browser attachments | Use browser File objects, `file.text()` and filename strings; internal spaces are retained. | Source review of `public/index.md`; no browser upload test. |
| `mini-a.sh`, `mini-a-web.sh`; ingestion git subprocesses | Wrappers forward `"$@"`; git uses ProcessBuilder argument arrays. | Source review; no live remote clone test. |

This does not change existing trimming of surrounding whitespace in configuration
values and wiki path segments, reserved ingestion flag words, URL encoding rules,
or filename restrictions imposed by a backend. Quote each operand separately for
commands that take multiple paths. Use `./force` for a source named `force`.

## Recovery diagnostics and choices

Recovery uses the same normalized section identity as a new ingestion plan.
Bare `/ingest` and `/ingest recovery` now list pending scopes and offer resume,
explicitly confirmed discard, independent ingestion, or cancel. Each entry has
an executable `/ingest recovery resume <id>` command. Legacy journals without
original source metadata say so instead of guessing; saved operations still
support explicit resume by ID. Discard archives the journal without undoing pages.

Independent ingestion stores a separate scope journal, preserves existing journal
bytes, and rejects overlapping page writes/removals. A resumed manifest uses a
three-way merge of whole records, preserving unrelated completed ingestion state
and rejecting conflicts before page writes. Legacy baselines are retained in
separate files only when provable. Retrieval and derivative guards inspect every
pending journal. All mutations retain the local writer lock, write-access checks,
and dry-run restrictions; `force` does not bypass these protections.

## Validation

- `node tests/consolePaths.cjs`: console handlers, attachments, completion callbacks and interactive recovery choices pass.
- `ojob tests/wikiIngest.yaml`: 64 passed, 0 failed.
- `ojob tests/miniAUtils.yaml`: 47 passed, 0 failed.
- `ojob tests/wiki.yaml`: 219 passed, 0 failed.
- JavaScript syntax checks and `git diff --check`: pass.

All ingestion fixtures used temporary directories. This audit did not mutate a
live wiki, install the checkout, or exercise a live model/provider.
