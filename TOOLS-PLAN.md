# Refactor Mini Utils OpenCode Alias Surface

## Summary

Add `usestdutils=` with default `true` for `useutils=true` sessions. When enabled, Mini-A exposes exact OpenCode tool names to the LLM while routing calls to existing Mini Utils behavior (plus new gap-fill implementations). `usestdutils=false` preserves the current Mini Utils MCP catalog unchanged.

`TOOLS.md` is treated as the source reference for OpenCode tool names and schemas and remains untracked.

## Pros / Cons

Pros:
- Exact OpenCode names (`read`, `glob`, `grep`, `bash`, etc.) match what LLMs trained on coding-agent conventions expect, reducing tool-selection mistakes.
- OpenCode-compatible schemas eliminate translation burden for agent profiles copied from OpenCode-style environments.
- Hiding legacy names by default lowers catalog noise while preserving full implementation coverage behind aliases.
- Alias-aware filters keep existing Mini-A CLI and agent definitions usable.

Cons:
- Some aliases require gap-fill implementations not yet in mini-a-utils (grep include, webfetch format, apply_patch parser).
- Models may assume full OpenCode behavior unless descriptions clearly state Mini-A-specific limits (apply_patch atomicity, webfetch markdown quality).
- Two naming layers increase maintenance cost for docs, filters, proxy routing, and error messages.
- Defaulting to `usestdutils=true` changes the visible tool catalog for existing `useutils=true` runs, even if legacy behavior remains available through `usestdutils=false`.

Recommendation:
- Implement it with full OpenCode semantics. This helps LLMs in coding-oriented Mini-A runs and the gap fills are well-scoped.

## Alias Table

Exact OpenCode names mapped to their mini-a backing. Every tool in this table must be exposed when `usestdutils=true`.

| OpenCode name | mini-a backing                              | Key parameters to map                                                   |
|---------------|---------------------------------------------|-------------------------------------------------------------------------|
| `read`        | `filesystemQuery operation=read/list`       | `filePath`→`path`, `limit`→`maxLines`, `offset`→`lineStart`            |
| `glob`        | `filesystemQuery operation=glob`            | `pattern`, `path` (already match)                                       |
| `grep`        | `filesystemQuery operation=search` + new `include` support | `pattern`, `include` (file glob filter, NEW), `path`   |
| `webfetch`    | `textUtilities operation=webfetch` + new `format` support  | `url`, `format` (NEW), `timeout` (seconds→ms conversion) |
| `question`    | new adapter over `userInput`                | `questions[].{header,question,options[],multiple}` → per-question choose/multiple |
| `skill`       | `skills operation=invoke`                   | `name`                                                                  |
| `todowrite`   | `todoList operation=write`                  | `todos[].{content,priority,status}` (id preserved if present)          |
| `apply_patch` | new `_applyPatch` helper + `filesystemModify` | `patchText` (full OpenCode patch grammar — see spec below)            |
| `bash`        | `shell` MCP tool (rename + extend)          | `command` (req), `description` (req in schema, logged only), `timeout` (s→ms), `workdir` (validated dir) |

**Not exposed:** `task` (no clean MCP bridge to SubtaskManager; delegation remains via JSON `action` mechanism), `multi_tool_use.parallel` (framework-level, not a callable tool).

## Key Changes

### Arguments

Add to `mini-a.yaml`, both Mini-A argument parsers, known-argument validation, README/USAGE docs:
- `usestdutils=true`: expose OpenCode-compatible aliases (default when `useutils=true`).
- `usestdutils=false`: expose current Mini Utils names and schemas unchanged.

### Centralized alias adapter

Add a centralized alias adapter module (or section in `mini-a-utils.js`) used by:
- MCP registration (which names appear in the LLM-facing catalog)
- Filter handling (`utilsallow`/`utilsdeny` translation)
- Prompt hints
- Proxy metadata
- Tool lookup

### Per-alias implementation detail

#### `read`
Alias only — no new code in `filesystemQuery`. Adapter maps:
- `filePath` → `path`
- `limit` → `maxLines`
- `offset` → `lineStart` (1-based)

Returns line-numbered output for files; directory listing for directories. Already implemented in `filesystemQuery`.

#### `glob`
Alias only — parameter names already match (`pattern`, `path`). Route directly to `filesystemQuery operation=glob`.

#### `grep` — **gap fill: add `include` file-glob filter**
Current `searchContent` / `filesystemQuery search` searches all files with no file-type filter. New behavior:
- Accept `include` parameter (string, optional): file glob pattern, e.g. `"*.js"`, `"*.{ts,tsx}"`.
- When `include` is set, filter the result of `_collectFiles` by matching each file's name/path against the glob pattern before scanning content.
- Use `ow.format.toFilenameFilter(include)` or equivalent glob matching available in OpenAF; fall back to a simple regex-from-glob conversion if not available.
- Add `include` to the `filesystemQuery` schema for the `search` operation and to `searchContent` params.
- No change to behavior when `include` is absent.

#### `webfetch` — **gap fill: add `format` parameter and JSoup-based conversion**
Current `textUtilities operation=webfetch` returns the raw response body. New behavior:
- Accept `format` parameter (string, optional, default `"markdown"`): `"markdown"`, `"text"`, or `"html"`.
- `format=html`: return raw response body as-is.
- `format=text`: extract plain text using JSoup if available:
  ```javascript
  // Check availability: getOPackPath("Jsoup") !== undefined
  loadExternalJars(getOPackPath("Jsoup"))
  var doc = Packages.org.jsoup.Jsoup.parse(body)
  var plainText = String(doc.body().text())
  ```
  Fallback when JSoup unavailable: regex strip `/<[^>]+>/g` then unescape basic HTML entities.
- `format=markdown`: use JSoup structural extraction — convert headings (`h1`–`h6`) to `#`–`######`, links to `[text](url)`, `strong`/`b` to `**text**`, `em`/`i` to `_text_`, `ul`/`ol` items to `-` / `N.` list markers, `code`/`pre` to backtick blocks, then fall back to plain text for unrecognized elements. Document in schema description: "quality is best-effort structural conversion, not a full HTML renderer". Same regex fallback applies when JSoup unavailable.
- `timeout`: OpenCode passes seconds (integer); multiply by 1000 before passing to `textUtilities` (which uses milliseconds).
- JSoup is an optional opack dependency. Check `getOPackPath("Jsoup")` at call time; use fallback when absent. No hard `loadLib` at module load.

#### `question` — **gap fill: new adapter**
OpenCode shape does not map to `userInput struct`. Adapter implementation:
- Input: `{ questions: [ { header, question, options: [{label, description}], multiple? }, ... ] }`
- For each question in the array:
  - Build options list from `options[].label` values.
  - If `multiple === true` → call `userInput({ operation:"multiple", prompt: q.question, options: labels })`.
  - Otherwise → call `userInput({ operation:"choose", prompt: q.question, options: labels })`.
- Aggregate: return `{ answers: { [header]: selectedLabel_or_array, ... } }` keyed by each question's `header`.
- If `userInput` returns an error string, propagate it immediately.

#### `skill`
Alias only. Route `{ name }` → `skills({ operation:"invoke", name })`.

#### `todowrite`
Route `{ todos }` → `todoList({ operation:"write", items: todos })`. Verify `todoList write` accepts `{content, priority, status}` items; if internal format differs (e.g. field name mismatch), normalize in the adapter. The optional `id` field from OpenCode is preserved if present.

#### `apply_patch` — **full OpenCode patch grammar implementation**

No existing mini-a or OpenAF opack provides this. Implement as a self-contained `_applyPatch(patchText, tool)` helper in `mini-a-utils.js`. Requires `readwrite=true`; return `[ERROR] readwrite=true required for apply_patch` otherwise.

**Patch grammar (OpenCode format):**
```
*** Begin Patch
*** Add File: path/to/new/file
<file content lines>
*** Update File: path/to/existing/file
@@ ... @@
 context line
-removed line
+added line
 context line
*** Move File: old/path -> new/path
*** Delete File: path/to/delete
*** End Patch
```

**Implementation requirements (all required, no partial implementation):**

1. **Multi-operation patches**: one `patchText` can contain any number of operations (`Add File`, `Update File`, `Delete File`, `Move File`) between `*** Begin Patch` and `*** End Patch`. Parse and execute them all in sequence.

2. **Context-based hunk location**: for `Update File`, locate the hunk insertion point by matching the context lines (lines prefixed with a single space ` `) against the target file content. The `@@` line numbers are hints only — do not require exact line number match.

3. **Fuzzy context fallback**: if exact context match fails (character-for-character), retry with whitespace-normalized comparison: strip leading/trailing whitespace from each context line and file line before comparing. Return `[ERROR] apply_patch: could not locate hunk context in <path> (operation N)` only if fuzzy match also fails.

4. **Multi-hunk per file**: a single `Update File` block can contain multiple `@@` sections. Apply them in order, tracking the cumulative line offset after each applied hunk (added lines increase offset, removed lines decrease it).

5. **`...` ellipsis skip marker**: a context line containing only `...` means "skip unchanged lines" — scan forward through the file until the next context line in the hunk matches. This is used when the patch omits middle sections of a large file.

6. **`Add File`**: create the file with the given content lines. Return `[ERROR] apply_patch: file already exists: <path>` if it already exists (unless the content is empty, in which case treat as touch/overwrite-empty). Delegate to `filesystemModify operation=write`.

7. **`Delete File`**: remove the file. Return `[ERROR] apply_patch: file not found: <path>` if it does not exist. Delegate to `filesystemModify operation=delete`.

8. **`Move File`**: parse `old/path -> new/path` syntax. Copy content to new path, delete old path. Return error if source does not exist or destination already exists.

9. **Atomicity best-effort**: validate all operations (file existence, path resolution, context matching) before writing any file. If validation of any operation fails, write nothing and return the error message identifying the failing operation by its 1-based index and type: `[ERROR] apply_patch: operation 2 (Update File: foo.js): could not locate hunk context`.

10. **`\\ No newline at end of file` marker**: when this marker appears after the last line of a `+` or ` ` section, omit the trailing newline from the constructed file content.

#### `bash` — **rename and extend existing `shell` MCP tool**
The existing `_createShellMcpConfig` in `mini-a.js` already registers a `shell` MCP tool when `useshell=true`. When `usestdutils=true`:
- Register the tool as `bash` instead of `shell`.
- Add to schema (all optional at runtime; `description` required in schema for OpenCode compat):
  - `description` (string, required in schema): logged for audit; otherwise ignored.
  - `workdir` (string, optional): validate as an existing directory before executing; return `[ERROR] bash: workdir not found: <path>` if invalid. Pass to shell runner as working directory.
  - `timeout` (integer, optional): seconds; multiply by 1000 and pass as `shelltimeout`.
- Keep all existing safety checks, allowlists, sandbox support, and `command` (required) unchanged.
- When `usestdutils=false`, the tool name remains `shell` with its original schema.

## Compatibility Rules

### Existing functionality
- All Mini Utils functions remain implemented and callable when `usestdutils=false`; no current utility functionality is removed.

### Existing agent definitions
- `capabilities.useutils: true` continues to work. With `usestdutils=true` (default), it receives the OpenCode alias surface.
- Agent-level `mini-a.usestdutils: false` opts that agent back into the legacy Mini Utils names.
- Agent `tools` entries for external MCP servers are not renamed.
- Agent or CLI filters using legacy Mini Utils names are translated to OpenCode aliases with warnings (see table below).

### `utilsallow`/`utilsdeny` old→new name translation

When `usestdutils=true`, allow/deny lists accept both old and new names. Old names are translated per this table before filtering:

| Old name (legacy)  | Translates to (new aliases)           | Notes |
|--------------------|---------------------------------------|-------|
| `filesystemQuery`  | `read`, `glob`, `grep`               | Covers all three sub-operations |
| `userInput`        | `question`                           |       |
| `skills`           | `skill`                              |       |
| `todoList`         | `todowrite`                          |       |
| `textUtilities`    | `webfetch`                           | Only the webfetch alias; `textUtilities` itself remains available |
| `init`             | `init`                               | Pass-through, no alias |
| `filesystemModify` | `filesystemModify`                   | Pass-through, no alias |
| `mathematics`      | `mathematics`                        | Pass-through, no alias |
| `timeUtilities`    | `timeUtilities`                      | Pass-through, no alias |
| `pathUtilities`    | `pathUtilities`                      | Pass-through, no alias |
| `filesystemBatch`  | `filesystemBatch`                    | Pass-through, no alias |
| `validationUtilities` | `validationUtilities`             | Pass-through, no alias |
| `systemInfo`       | `systemInfo`                         | Pass-through, no alias |
| `memoryStore`      | `memoryStore`                        | Pass-through, no alias |
| `showMessage`      | `showMessage`                        | Pass-through, no alias |
| `markdownFiles`    | `markdownFiles`                      | Pass-through, no alias |
| `wiki`             | `wiki`                               | Pass-through, no alias |

- Unknown or non-matching names are not silently exposed; log a warning and skip.
- Apply the same alias normalization to proxy allow/deny and programmatic-call allowlists.
- When `usestdutils=true`, the old names (`filesystemQuery`, `userInput`, `skills`, `todoList`) are hidden from the LLM-facing catalog but remain callable internally and via filters.

### Prompt/tool guidance
Update system prompt hints so they reference `question` instead of `userInput`, and OpenCode names instead of original Mini Utils names, when `usestdutils=true`.

## Tests

Extend `tests/miniAUtils.js` and `tests/miniAUtils.yaml`:

### Alias schema and routing
- `read` schema has `filePath`, `limit`, `offset`; call with `filePath` routes correctly.
- `glob` schema has `pattern`, `path`; routes to filesystemQuery glob.
- `grep` schema has `pattern`, `include`, `path`; routes to filesystemQuery search.
- `webfetch` schema has `url`, `format`, `timeout`; routes to textUtilities webfetch.
- `question` schema has `questions` array; adapter routes each question.
- `skill` schema has `name`; routes to skills invoke.
- `todowrite` schema has `todos` array with `{content,priority,status}`.
- `bash` appears when `useshell=true usestdutils=true`, name is `bash` not `shell`.

### `grep` include filter
- `grep` with `include="*.js"` returns only matches from `.js` files.
- `grep` with `include="*.{ts,tsx}"` returns only matches from TS/TSX files.
- `grep` without `include` behaves as before (all files).

### `webfetch` format
- `format=text` strips HTML tags from a response containing HTML.
- `format=markdown` returns structural markdown (at minimum: headings become `#`, links become `[text](url)`).
- `format=html` returns raw body unchanged.
- `timeout=5` is passed to backend as `5000` ms.

### `question` adapter
- Single question, `multiple=false`: returns single selected label under the question's `header` key.
- Single question, `multiple=true`: returns array of selected labels.
- Multiple questions: all answers keyed by their respective `header` values.

### `bash` params
- `workdir` set to a non-existent path returns `[ERROR] bash: workdir not found: ...`.
- `description` is accepted without error (not executed, not required at runtime).
- `timeout=5` is passed to shell runner as `5000` ms.

### `apply_patch`
- `Add File`: creates a new file with correct content.
- `Delete File`: removes an existing file.
- `Move File`: renames file, content is preserved, old path removed.
- `Update File`: context-matched hunk applied correctly (lines added/removed at right location).
- `Update File`: fuzzy match succeeds when context lines have minor leading/trailing whitespace differences.
- `Update File`: multiple `@@` hunks in one block applied in correct order with offset tracking.
- `Update File`: `...` ellipsis skip marker advances past unchanged lines to find next context match.
- Multi-operation patch (Add + Update in one `patchText`): both operations applied.
- Atomicity: if second operation fails validation, no files are written (first operation also rolled back).
- Unrecognized hunk type returns `[ERROR]` identifying the bad directive.
- `readwrite=false`: returns `[ERROR] readwrite=true required for apply_patch`.

### `todowrite`
- Round-trips `todos` array of `{content, priority, status}` items; can be read back via `todoList read`.

### Backward compat filters
- `utilsallow=filesystemQuery` with `usestdutils=true` translates to `read,glob,grep` (warns, exposes only those three).
- `utilsallow=userInput` with `usestdutils=true` translates to `question`.
- `utilsdeny=grep` with `usestdutils=true` removes the `grep` alias from the catalog.
- `usestdutils=false` returns the existing metadata names unchanged.
- Agent definitions with `capabilities.useutils` and `mini-a.usestdutils` preserve expected tool exposure.

### Run
- `ojob tests/miniAUtils.yaml`
- Focused dry-run/list-tools check for `useutils=true usestdutils=true`
- Focused legacy check for `useutils=true usestdutils=false`

## Assumptions

- `usestdutils` controls the Mini Utils and shell-alias surface only; unrelated MCP tools keep their existing names.
- `TOOLS.md` remains untracked and is not required at runtime.
- OpenCode-compatible aliases prioritize correct semantic compatibility over perfect feature parity where mini-a has no exact match.
- JSoup opack (`getOPackPath("Jsoup")`) is an optional runtime dependency for `webfetch format` conversion. When absent, a regex fallback is used. No hard load-time dependency.
- `usestdutils` defaults to `true` when `useutils=true`. Revisit this default if agent breakage is observed in testing.
- `task` is not exposed: mini-a delegation is driven by JSON `action` fields in LLM responses, not by MCP tools, and there is no clean bridge from an MCP tool call to the SubtaskManager.
- `multi_tool_use.parallel` is not exposed: it is a framework-level construct used by the LLM to batch tool calls, not a tool mini-a registers.
