# Plan: Implement mini-a Dreams Feature

## Context

Equivalent to Anthropic's managed-agents "dreams" feature. Given the same memory and wiki settings used for a running goal (`memorych=`, `memorysessionch=`, `memorysessionid=`, `usewiki=`, `wikiroot=`, etc.) and the corresponding `auditch=` (for memory dreaming) / wiki settings (for wiki dreaming), the dream pass:

- **Memory**: reads existing memory channels + audit records → LLM consolidates (merges duplicates, marks stale/superseded entries, surfaces new insights) → writes the reorganised store back to the same channels.
- **Wiki**: drives a rw-enabled MiniA agent that runs lint, merges near-duplicate pages, fixes all lint issues, and produces a clean wiki.

Implementation lives on a new `dreams` git branch.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `mini-a-dreams.js` | **CREATE** — `MiniADreams` class + standalone entry point |
| `mini-a-con.js` | **MODIFY** — add `/dream` slash command |
| `tests/dreams.yaml` | **CREATE** — test suite (ojob) |
| `tests/dreams.js` | **CREATE** — test implementations |

---

## New File: `mini-a-dreams.js`

### Loading order (mirrors `mini-a-memoryman.js`)
```
plugin("Console")
var args = isDef(global._args) ? global._args : processExpr(" ")
__initializeCon()
loadLib("mini-a-common.js")
loadLib("mini-a-memory.js")
loadLib("mini-a-wiki.js")
loadLib("mini-a.js")          // needed for wiki dream agent + $llm()
if (isDef(args.libs)) __miniALoadLibraries(args.libs, log, logErr)
```

### `MiniADreams` class

```javascript
var MiniADreams = function(args, logFn) {
  this._args = isMap(args) ? args : {}
  this._logFn = isFunction(logFn) ? logFn : log
}
```

Key methods:

#### `_createChannelFromDef(rawDef, fallbackName, fallbackType)`
- Parses JSSLON channel definition (same pattern as `ensureMemoryChannelFromDef` in `mini-a-con.js:530`)
- Creates the channel if it doesn't exist
- Returns `{ name, type, options }`

#### `_readAuditRecords(chName, maxRecords)`
- `$ch(chName).getKeys()` → iterate → `$ch(chName).get(key)`
- Sort by `ts`, take last `maxRecords` (default 200)
- Return array of `{ ts, id, e, m, meta }` records

#### `_buildLlm()`
- Parse `this._args.model` via `af.fromJSSLON()` → `$llm(modelConfig)`
- Returns the llm instance (used for memory dream LLM calls)

#### `dreamMemory(opts)`
Steps:
1. Parse `memorych` and (optionally) `memorysessionch` + `memorysessionid`
2. Create channels via `_createChannelFromDef`
3. Load global memory: `new MiniAMemoryManager({})` + `loadFromChannel(chName, "")`
4. Load session memory (if `memorysessionch` provided): separate manager + `loadFromChannel(chName, sessionId)`
5. If `auditch` provided: create channel + `_readAuditRecords(auditChName, maxAuditRecords)`
6. Build consolidation prompt (see below)
7. Call `llm.promptJSONWithStats(prompt)` — if `promptJSONWithStats` unavailable, fall back to `promptWithStats` + `jsonParse`
8. Validate response has `sections` with all 8 section keys
9. Unless `dryrun=true`: write back via `manager.init(consolidated)` → `manager.saveToChannel(chName, ns)`
10. Report: counts of entries per section before/after, number of stale-marked / dropped

**Consolidation prompt** (passed as user message after system context):
```
You are performing a memory dream pass. Analyse the memory store below and return a consolidated
JSON object with EXACTLY the same schema as the input (schemaVersion, createdAt, updatedAt,
revision, sections).

Rules:
- MERGE near-duplicate entries in the same section (keep the most informative value; preserve the
  earlier createdAt; bump revision).
- MARK entries as stale=true and set supersededBy=<id> when a newer entry in the same section
  contradicts or replaces it.
- SURFACE new cross-cutting insights as new entries in the "summaries" section.
- PRESERVE all entry IDs you retain unchanged. Assign new 16-char hex IDs to new entries.
- DROP entries that are stale AND already superseded (supersededBy is set AND the target entry
  exists in the consolidated output).

## Current Memory State
<JSON snapshot from manager.snapshot()>

## Recent Audit Events (for context)
<last N audit records as JSON array — omitted if auditch not provided>

Return ONLY the consolidated JSON object, no commentary.
```

#### `dreamWiki(opts)`
Steps:
1. Validate `usewiki=true` and wiki settings are present; ensure `wikiaccess=rw`.
2. Instantiate `MiniAWikiManager(config)` with `access:"rw"` — reuse pattern from `mini-a.js:8248-8282`.
3. Run `wm.lint()` to establish baseline issue count.
4. Build dream agent args — merge `this._args` then override:
   ```javascript
   dreamArgs.usewiki = "true"
   dreamArgs.wikiaccess = "rw"
   // pass memory settings as read-only reference if available
   dreamArgs.usememory = isDef(this._args.memorych) ? "true" : "false"
   dreamArgs.memoryscope = "global"
   dreamArgs.maxsteps = 60           // higher budget for consolidation
   dreamArgs.nosave = "true"         // don't persist conversation
   ```
5. Create a `MiniA` instance with `dreamArgs`.
6. Call `agent.run({ goal: WIKI_DREAM_GOAL })` where the goal is:
   ```
   Consolidate the wiki. Follow these steps in order:
   1. Use wiki op=lint to list all current issues.
   2. For each near_duplicate pair: read both pages, write the merged content to the primary
      page, delete the duplicate, fix any links pointing to the deleted page.
   3. For each broken_link: read the affected page and correct the link target.
   4. For each missing_frontmatter: read the page and add the missing fields (title, description,
      created, updated) using sensible inferred values.
   5. For each heading_hierarchy violation: read the page and fix heading levels.
   6. For each orphan page (excluding index.md): add a link from AGENTS.md or the most relevant
      existing page.
   7. Re-run lint and confirm zero errors and zero warnings remain.
   8. Finish with action=final summarising: pages_changed, pages_deleted, issues_fixed.
   ```
7. Parse the final answer for the change summary and report it.

#### `run()`
- If `memorych` is provided → call `dreamMemory()`
- If `toBoolean(args.usewiki)` → call `dreamWiki()`
- If neither, print usage and exit 1

---

## Modify: `mini-a-con.js`

### 1. `slashCommands` array (line ~420)
Add `"dream"` to the array.

### 2. `printDream(subcmdRaw)` function (insert after `printWiki` ending ~line 5455)
```javascript
function printDream(subcmdRaw) {
  var parts = isString(subcmdRaw) ? subcmdRaw.trim().split(/\s+/) : []
  var mode  = parts.length > 0 ? parts[0].toLowerCase() : ""
  var dryrun = parts.indexOf("dryrun") >= 0

  var hasMemory = isString(sessionOptions.memorych) && sessionOptions.memorych.trim().length > 0
  var hasWiki   = toBoolean(sessionOptions.usewiki) === true && isObject(getConsoleWikiManager())

  if (mode === "memory" && !hasMemory) {
    print(colorifyText("No memory channel configured. Start with memorych=...", errorColor)); return
  }
  if (mode === "wiki" && !hasWiki) {
    print(colorifyText("Wiki not enabled. Start with usewiki=true and wikiroot=...", errorColor)); return
  }
  if (mode === "" && !hasMemory && !hasWiki) {
    print(colorifyText("Nothing to dream: no memory channel and no wiki configured.", hintColor)); return
  }

  loadLib("mini-a-dreams.js")
  var dreamArgs = merge({}, sessionOptions)
  dreamArgs.dryrun = dryrun ? "true" : "false"

  var runner = new MiniADreams(dreamArgs, function(msg) { print(colorifyText(msg, hintColor)) })

  try {
    if ((mode === "" || mode === "memory") && hasMemory) runner.dreamMemory()
    if ((mode === "" || mode === "wiki")   && hasWiki)   runner.dreamWiki()
  } catch (dreamErr) {
    printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Dream error: " + dreamErr, errorColor))
  }
}
```

### 3. Command handler (insert after wiki handler ~line 5805)
```javascript
if (commandLower === "dream" || commandLower.indexOf("dream ") === 0) {
  printDream(commandLower.length > 5 ? command.substring(6) : "")
  continue
}
```

### 4. Help text (in helpCommands push block)
```javascript
helpCommands.push({ command: "/dream [memory|wiki] [dryrun]", description: "Consolidate memory and/or wiki (dream pass)" })
```

---

## New Files: `tests/dreams.yaml` + `tests/dreams.js`

Tests (no real LLM calls — uses a mock channel and stub LLM):
1. `testDreamMemoryMergesDuplicates` — two identical facts → one after dream
2. `testDreamMemoryMarksStale` — contradicted entry marked stale + supersededBy set
3. `testDreamMemoryPreservesIds` — retained entries keep original IDs
4. `testDreamMemoryDryRunDoesNotWrite` — channel unchanged after dry-run
5. `testDreamRunRoutesCorrectly` — `run()` calls dreamMemory when memorych set, dreamWiki when usewiki=true

---

## Accepted Args Summary

| Arg | Purpose |
|-----|---------|
| `memorych` | JSSLON global memory channel (required for memory dream) |
| `memorysessionch` | JSSLON session memory channel |
| `memorysessionid` | Session namespace string |
| `auditch` | JSSLON audit channel (optional, surfaces insights) |
| `usewiki=true` | Enable wiki dream |
| `wikiroot`, `wikibackend`, `wikibucket`, etc. | Wiki backend settings (same as agent) |
| `wikiaccess` | Overridden to `rw` inside dreams; must not be explicitly `ro` |
| `model` | JSSLON model config (same as agent) |
| `modellc` | Low-cost model (optional) |
| `dryrun=true` | Show plan without writing back |
| `maxauditrecords` | Max audit entries included in prompt (default 200) |
| `libs` | Extra comma-separated libraries to load |

---

## Reused Utilities

- `__miniAErrMsg(e)` — `mini-a-common.js`
- `__miniALoadLibraries(...)` — `mini-a-common.js`
- `MiniAMemoryManager.loadFromChannel / saveToChannel` — `mini-a-memory.js:407-454`
- `MiniAMemoryManager.listChannelNamespaces` — `mini-a-memory.js:470`
- `MiniAWikiManager` — `mini-a-wiki.js:5-10`
- `ensureMemoryChannelFromDef` pattern — `mini-a-con.js:530`
- `MiniA._llmRetryOptions` — for LLM call retry in dreams
- `$llm(modelConfig)` — via `_createBareLlmInstance` pattern at `mini-a.js:2178`

---

## Verification

```bash
# 1. Create branch
git checkout -b dreams

# 2. Smoke-test standalone script (dry-run, memory only)
ojob mini-a-dreams.js memorych='{"name":"test_dream_ch","type":"simple"}' model='{"type":"anthropic","model":"claude-sonnet-4-6"}' dryrun=true

# 3. Wiki dream (requires rw wiki)
ojob mini-a-dreams.js usewiki=true wikiroot=/tmp/test-wiki wikibackend=fs model='{"type":"anthropic","model":"claude-sonnet-4-6"}'

# 4. Run unit tests (no LLM required)
ojob tests/dreams.yaml
```
