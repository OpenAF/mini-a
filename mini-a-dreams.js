// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Mini-A Dreams — LLM-powered memory and wiki consolidation pass.
//   Given the same memorych/memorysessionch/auditch/wiki settings used for a goal,
//   produces a reorganised memory store (duplicates merged, stale entries replaced,
//   new insights surfaced) and/or a lint-clean wiki.

plugin("Console")

var args = isDef(global._args) ? global._args : processExpr(" ")

__initializeCon()
loadLib("mini-a-common.js")
loadLib("mini-a-memory.js")
loadLib("mini-a-wiki.js")
loadLib("mini-a.js")

if (isDef(args.libs) && String(args.libs).trim().length > 0) {
  __miniALoadLibraries(String(args.libs), log, logErr)
}

// ─────────────────────────────────────────────────────────────
// MiniADreams
// ─────────────────────────────────────────────────────────────

var MiniADreams = function(dreamArgs, logFn) {
  this._args  = isMap(dreamArgs) ? merge({}, dreamArgs) : {}
  try { __miniAApplyMemoryUserDefaults(this._args) } catch(ignoreMemoryUserDefaults) {}
  this._logFn = isFunction(logFn) ? logFn : log
  this._llm   = __   // injectable for tests
}

MiniADreams.prototype._log = function(msg) {
  var out = isDef(msg) ? String(msg) : ""
  if (out.indexOf("[dreams") >= 0) {
    if (out.indexOf("zzz ") === 0) out = "💤 " + out.substring(4).trim()
    if (out.indexOf("💤 ") !== 0) out = "💤 " + out
  }
  try { this._logFn(out) } catch(ignoreLogErr) {}
}

// Allow tests (and callers) to inject a stub LLM so no real API keys are needed.
MiniADreams.prototype._setLlm = function(llmInstance) {
  this._llm = llmInstance
}

// ── channel helpers ───────────────────────────────────────────

MiniADreams.prototype._createChannelFromDef = function(rawDef, fallbackName, fallbackType) {
  if (!isString(rawDef) || rawDef.trim().length === 0) return __
  var parsed = __
  try { parsed = af.fromJSSLON(rawDef) } catch(ignoreJSSLONParse) {}
  if (!isMap(parsed)) return __
  var cName = isString(parsed.name) && parsed.name.trim().length > 0 ? parsed.name.trim() : fallbackName
  var cType = isString(parsed.type) && parsed.type.trim().length > 0 ? parsed.type.trim() : (fallbackType || "simple")
  var cOpts = isMap(parsed.options) ? parsed.options : {}
  var exists = false
  try { exists = $ch().list().indexOf(cName) >= 0 } catch(ignoreList) {}
  if (!exists) {
    try { $ch(cName).create(cType, cOpts) } catch(ignoreCreate) {}
  }
  return { name: cName, type: cType, options: cOpts }
}

MiniADreams.prototype._getRecentAuditKeys = function(chName, maxRecords) {
  var max = isNumber(maxRecords) && maxRecords > 0 ? maxRecords : 200
  var keys = []
  try { keys = $ch(chName).getKeys() } catch(ignoreGetKeys) { return __ }
  if (!isArray(keys) || keys.length <= max) return keys

  var sortable = true
  for (var i = 0; i < keys.length; i++) {
    var key = String(keys[i])
    if (!/^\d+$/.test(key) && !/^\d{4}[-:]?\d{2}[-:]?\d{2}[T _-]?\d{2}[:.-]?\d{2}[:.-]?\d{2}(?:\.\d+)?(?:Z)?$/.test(key)) {
      sortable = false
      break
    }
  }
  if (!sortable) return __

  keys.sort(function(a, b) {
    var sa = String(a)
    var sb = String(b)
    if (/^\d+$/.test(sa) && /^\d+$/.test(sb)) {
      var na = Number(sa)
      var nb = Number(sb)
      if (na < nb) return -1
      if (na > nb) return 1
      return 0
    }
    if (sa < sb) return -1
    if (sa > sb) return 1
    return 0
  })

  return keys.slice(-max)
}

MiniADreams.prototype._readAuditRecords = function(chName, maxRecords) {
  var max = isNumber(maxRecords) && maxRecords > 0 ? maxRecords : 200
  var records = []
  var keys = this._getRecentAuditKeys(chName, max)

  if (isArray(keys)) {
    for (var i = 0; i < keys.length; i++) {
      try {
        var rec = $ch(chName).get(keys[i])
        if (isMap(rec)) records.push(rec)
      } catch(ignoreGetFast) {}
    }
  } else {
    keys = []
    try { keys = $ch(chName).getKeys() } catch(ignoreGetKeysFallback) { return [] }
    for (var j = 0; j < keys.length; j++) {
      try {
        var fallbackRec = $ch(chName).get(keys[j])
        if (isMap(fallbackRec)) records.push(fallbackRec)
      } catch(ignoreGetFallback) {}
    }
  }

  records.sort(function(a, b) {
    var ta = isNumber(a.ts) ? a.ts : 0
    var tb = isNumber(b.ts) ? b.ts : 0
    return ta - tb
  })
  return records.slice(-max)
}

// ── LLM helper ───────────────────────────────────────────────

MiniADreams.prototype._parseModelConfig = function(rawValue, source, isOptional) {
  if (isUnDef(rawValue)) return __
  var parsed = rawValue
  if (isString(parsed)) {
    parsed = parsed.trim()
    if (parsed.length === 0) return __
    try {
      parsed = af.fromJSSLON(parsed)
    } catch(ignoreModelParse) {
      parsed = rawValue.trim()
    }
  }

  if (!isMap(parsed) && isString(parsed)) {
    if (isDef(_sec)) {
      try {
        var secObj = _sec.get(parsed, "models")
        if (isDef(secObj) && isMap(secObj)) return secObj
      } catch(ignoreSecLookup) {}
    }
    if (isOptional) return __
    throw new Error("Invalid " + source + " model configuration: '" + parsed + "' is not a valid model definition or reference.")
  }

  if (!isMap(parsed)) {
    if (isOptional) return __
    throw new Error("Invalid " + source + " model configuration: expected a map/object.")
  }
  return parsed
}

MiniADreams.prototype._getEnv = function(name) {
  return getEnv(name)
}

MiniADreams.prototype._buildLlm = function() {
  if (isObject(this._llm)) return this._llm
  var modelCfg = this._parseModelConfig(this._args.model, "model parameter", true)
  if (!isMap(modelCfg)) modelCfg = this._parseModelConfig(this._getEnv("OAF_MODEL"), "OAF_MODEL environment variable", true)
  if (!isMap(modelCfg)) return __
  try { return $llm(modelCfg) } catch(ignoreLlmCreate) { return __ }
}

// ── schema validation ─────────────────────────────────────────

var _MEMORY_SECTIONS = ["facts", "evidence", "openQuestions", "hypotheses", "decisions", "artifacts", "risks", "summaries"]

MiniADreams.prototype._validateMemorySchema = function(obj) {
  if (!isMap(obj)) return "response is not an object"
  if (!isMap(obj.sections)) return "missing 'sections' key"
  for (var i = 0; i < _MEMORY_SECTIONS.length; i++) {
    var sec = _MEMORY_SECTIONS[i]
    if (!isArray(obj.sections[sec])) return "sections." + sec + " is not an array"
    for (var j = 0; j < obj.sections[sec].length; j++) {
      var e = obj.sections[sec][j]
      if (!isMap(e)) return "sections." + sec + "[" + j + "] is not an object"
      if (!isString(e.id) || e.id.trim().length === 0) return "sections." + sec + "[" + j + "].id missing"
      if (!isString(e.value)) return "sections." + sec + "[" + j + "].value missing"
      if (!isString(e.status)) return "sections." + sec + "[" + j + "].status missing"
    }
  }
  return __   // no error = valid
}

// ── backup helpers ────────────────────────────────────────────

MiniADreams.prototype._backupMemoryToNamespace = function(manager, chName, ns, backupNs) {
  try {
    var snap = manager.snapshot()
    var tmpMgr = new MiniAMemoryManager({})
    tmpMgr.init(snap)
    var ok = tmpMgr.saveToChannel(chName, backupNs)
    return ok
  } catch(ignoreBackup) { return false }
}

// ── memory dream ──────────────────────────────────────────────

MiniADreams.prototype.dreamMemory = function(opts) {
  var self = this
  var memoryMode = isString(self._args.dreammemorymode) ? self._args.dreammemorymode.trim().toLowerCase() : "apply"
  if (memoryMode !== "plan" && memoryMode !== "apply") memoryMode = "apply"
  var isDryRun = toBoolean(self._args.dryrun) === true || memoryMode === "plan"
  var maxAudit = isNumber(self._args.maxauditrecords) ? Number(self._args.maxauditrecords) : 200

  self._log("💤 [dreams] Starting memory dream pass" + (isDryRun ? " (dry-run)" : "") + "...")

  // ── 1. Set up channels ────────────────────────────────────
  var globalChDef = self._createChannelFromDef(self._args.memorych, "_mini_a_memory_channel", "simple")
  if (!isMap(globalChDef)) {
    self._log("[dreams:memory] No global memory channel configured (memorych). Skipping.")
    return { ok: false, reason: "no-memorych" }
  }

  var sessionChDef  = self._createChannelFromDef(self._args.memorysessionch, "_mini_a_session_memory_channel", "simple")
  var sessionId     = isString(self._args.memorysessionid) ? self._args.memorysessionid.trim() : ""
  var auditChDef    = self._createChannelFromDef(self._args.auditch, "_mini_a_audit_channel", "simple")

  // ── 2. Load memory ────────────────────────────────────────
  var globalMgr = new MiniAMemoryManager({})
  var globalLoaded = globalMgr.loadFromChannel(globalChDef.name, "")
  if (!globalLoaded) {
    self._log("[dreams:memory] Global memory channel is empty or unreadable — nothing to consolidate.")
    return { ok: false, reason: "empty-channel" }
  }

  var sessionMgr = __
  if (isMap(sessionChDef) && sessionId.length > 0) {
    sessionMgr = new MiniAMemoryManager({})
    var sessionLoaded = sessionMgr.loadFromChannel(sessionChDef.name, sessionId)
    if (!sessionLoaded) {
      self._log("[dreams:memory] Session memory channel empty for id '" + sessionId + "' — skipping session dream.")
      sessionMgr = __
    }
  }

  // ── 3. Load audit records ─────────────────────────────────
  var auditRecords = []
  if (isMap(auditChDef)) {
    auditRecords = self._readAuditRecords(auditChDef.name, maxAudit)
    self._log("[dreams:memory] Loaded " + auditRecords.length + " audit records.")
  }

  // ── 4. Build LLM ─────────────────────────────────────────
  var llm = self._buildLlm()
  if (!isObject(llm)) {
    self._log("[dreams:memory] No LLM configured (set OAF_MODEL or pass model=). Aborting.")
    return { ok: false, reason: "no-llm" }
  }

  // Helper: consolidate one manager's memory via LLM
  var consolidateOne = function(mgr, label, chName, ns) {
    var snap = mgr.snapshot()
    var beforeCounts = {}
    _MEMORY_SECTIONS.forEach(function(s) { beforeCounts[s] = isArray(snap.sections[s]) ? snap.sections[s].length : 0 })
    var totalBefore = _MEMORY_SECTIONS.reduce(function(sum, s) { return sum + beforeCounts[s] }, 0)
    self._log("[dreams:memory:" + label + "] " + totalBefore + " entries before consolidation.")

    var systemPrompt = "You are performing a memory dream pass for a Mini-A agent.\n" +
      "Return ONLY a valid JSON object — no commentary, no markdown fences.\n" +
      "The JSON must match exactly the MiniAMemoryManager snapshot schema:\n" +
      "{ schemaVersion, createdAt, updatedAt, revision, sections: { facts:[], evidence:[], openQuestions:[], hypotheses:[], decisions:[], artifacts:[], risks:[], summaries:[] } }\n\n" +
      "Rules:\n" +
      "- MERGE near-duplicate entries in the same section (keep the most informative value; preserve the earlier createdAt).\n" +
      "- MARK superseded entries with stale=true and supersededBy=<id-of-replacement>.\n" +
      "- DROP entries that are both stale=true AND have a supersededBy that exists in the output.\n" +
      "- SURFACE new cross-cutting insights as new entries in the 'summaries' section.\n" +
      "- PRESERVE all IDs of entries you retain unchanged. New entries get new 16-char hex IDs.\n" +
      "- Keep updatedAt as current ISO timestamp; increment revision by 1."

    var promptBase = systemPrompt +
      "\n\n## Current Memory State\n" +
      stringify(snap, __, "")

    var auditSection = ""
    if (auditRecords.length > 0) {
      var auditLimit = 200
      if (isDef(maxAudit) && Number(maxAudit) > 0) {
        auditLimit = Math.floor(Number(maxAudit))
      } else if (isDef(args.maxauditrecords) && Number(args.maxauditrecords) > 0) {
        auditLimit = Math.floor(Number(args.maxauditrecords))
      }

      var auditCount = Math.min(auditRecords.length, auditLimit)
      var auditStr = ""
      while (auditCount > 0) {
        auditStr = stringify(auditRecords.slice(-auditCount), __, "")
        // Stay under ~100K chars (~25K tokens) to leave room for the response
        if ((promptBase + auditStr).length <= 100000) {
          auditSection = "\n\n## Recent Audit Events (for context — do not include in output)\n" + auditStr
          if (auditCount < Math.min(auditRecords.length, auditLimit)) {
            self._log("[dreams:memory:" + label + "] Audit section truncated to " + auditCount + " records to stay under 100K chars.")
          }
          break
        }
        auditCount--
      }

      if (auditCount === 0) {
        self._log("[dreams:memory:" + label + "] Audit section dropped: prompt would exceed 100K chars.")
      }
    }
    var prompt = promptBase + auditSection
    if (prompt.length > 120000) {
      self._log("[dreams:memory:" + label + "] WARNING: prompt is very large (" + prompt.length + " chars); LLM may truncate or refuse.")
    }

    var consolidated = __
    try {
      var resp = isFunction(llm.promptJSONWithStats) ? llm.promptJSONWithStats(prompt)
               : isFunction(llm.promptWithStats)     ? llm.promptWithStats(prompt)
               : { response: llm.prompt(prompt), stats: {} }
      var raw = isMap(resp) && isDef(resp.response) ? resp.response : resp
      if (isString(raw)) {
        var cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
        consolidated = jsonParse(cleaned, __, __, true)
      } else if (isMap(raw)) {
        consolidated = raw
      }
    } catch(llmErr) {
      self._log("[dreams:memory:" + label + "] LLM call failed: " + __miniAErrMsg(llmErr))
      return { ok: false, reason: "llm-error", error: __miniAErrMsg(llmErr) }
    }

    var validationErr = self._validateMemorySchema(consolidated)
    if (isString(validationErr)) {
      self._log("[dreams:memory:" + label + "] LLM returned invalid schema: " + validationErr + " — aborting write.")
      return { ok: false, reason: "invalid-schema", error: validationErr }
    }

    var afterCounts = {}
    _MEMORY_SECTIONS.forEach(function(s) {
      afterCounts[s] = isArray(consolidated.sections[s]) ? consolidated.sections[s].length : 0
    })
    var totalAfter = _MEMORY_SECTIONS.reduce(function(sum, s) { return sum + afterCounts[s] }, 0)
    var staleCount = 0
    _MEMORY_SECTIONS.forEach(function(s) {
      if (!isArray(consolidated.sections[s])) return
      consolidated.sections[s].forEach(function(e) { if (e.stale === true) staleCount++ })
    })
    var droppedCount = Math.max(totalBefore - totalAfter, 0)
    var addedCount = Math.max(totalAfter - totalBefore, 0)

    self._log("[dreams:memory:" + label + "] Consolidated: " + totalAfter + " entries (" +
      droppedCount + " dropped, " + addedCount + " added, " + staleCount + " stale-marked).")

    if (isDryRun) {
      self._log("[dreams:memory:" + label + "] Dry-run — skipping write.")
      return { ok: true, mode: "plan", dryRun: true, before: totalBefore, after: totalAfter, staleMarked: staleCount }
    }

    // Backup pre-dream state to a sibling namespace
    var backupNs = (ns.length > 0 ? ns : "_global") + "::predream-" + new Date().toISOString().replace(/[:.]/g, "-")
    var backedUp = self._backupMemoryToNamespace(mgr, chName, ns, backupNs)
    if (backedUp) {
      self._log("[dreams:memory:" + label + "] Pre-dream backup saved to namespace '" + backupNs + "'.")
    } else {
      self._log("[dreams:memory:" + label + "] WARNING: pre-dream backup failed — proceeding without backup.")
    }

    // Rebuild the consolidated state through a fresh memory manager so entries are
    // normalized/coerced before persistence, while still keeping dedup/compaction
    // disabled to avoid re-processing the LLM's already-consolidated output.
    consolidated.updatedAt = new Date().toISOString()
    consolidated.revision  = isNumber(snap.revision) ? snap.revision + 1 : 1

    var normalizedSnapshot = jsonParse(stringify(consolidated, __, ""), __, __, true)
    var saveMgr = new MiniAMemoryManager({ dedup: false, compact: false })
    saveMgr.init(normalizedSnapshot)
    if (isDef(saveMgr._memory)) {
      if (isString(normalizedSnapshot.createdAt) && normalizedSnapshot.createdAt.length > 0) saveMgr._memory.createdAt = normalizedSnapshot.createdAt
      saveMgr._memory.updatedAt = normalizedSnapshot.updatedAt
      saveMgr._memory.revision  = normalizedSnapshot.revision
    }

    var saved = saveMgr.saveToChannel(chName, ns)
    if (saved) {
      self._log("[dreams:memory:" + label + "] Written to channel '" + chName + "' (ns='" + ns + "').")
    } else {
      self._log("[dreams:memory:" + label + "] WARNING: saveToChannel returned false.")
    }
    return { ok: saved, mode: "apply", before: totalBefore, after: totalAfter, staleMarked: staleCount }
  }

  var results = {}

  // Global memory
  results.global = consolidateOne(globalMgr, "global", globalChDef.name, "")
  if (!isObject(results.global) || results.global.ok !== true) {
    self._log("💤 [dreams] Memory dream complete with errors.")
    return { ok: false, results: results }
  }

  // Session memory (independent — global has already been committed above)
  if (isObject(sessionMgr)) {
    results.session = consolidateOne(sessionMgr, "session:" + sessionId, sessionChDef.name, sessionId)
    if (!isObject(results.session) || results.session.ok !== true) {
      self._log("💤 [dreams] Memory dream complete with partial errors (global committed, session failed).")
      return { ok: true, partial: true, results: results }
    }
  }

  self._log("💤 [dreams] Memory dream complete.")
  return { ok: true, mode: memoryMode, results: results }
}

// ── wiki dream ────────────────────────────────────────────────

var _WIKI_DREAM_GOAL =
  "You are running a wiki dream consolidation pass. Your task is to produce a clean, well-organised wiki.\n\n" +
  "IMPORTANT CONSTRAINTS:\n" +
  "- Do NOT edit AGENTS.md, index.md, or log.md. These are regenerated deterministically by the apply pass.\n" +
  "- Do NOT write to mounted wikis (@name/... paths). They are read-only.\n\n" +
  "Follow these steps in order:\n" +
  "1. Discovery: use wiki op=\"context\" for a compact overview, then op=\"lint\" for all issues, op=\"tree\" and op=\"browse\" for structure, op=\"backlinks\" for cross-references.\n" +
  "2. Plan: produce a short reorganisation plan in your context before writing. Folders with index.md are section sub-wikis. Keep existing paths valid unless you intentionally move them.\n" +
  "3. Apply only high-confidence changes. Use wiki op=\"move\" for relocations so links are repaired. Skip uncertain moves, record them as skipped_uncertain_moves.\n" +
  "4. For near_duplicate pairs: use wiki op=\"read\" on both, write a merged version to the primary, then delete or supersede the duplicate only when confidence is high.\n" +
  "5. For broken_link, missing_frontmatter, heading_hierarchy, and orphan issues: read the affected pages, make the minimal correction, write back.\n" +
  "6. Re-run wiki op=\"lint\" to confirm zero errors and no avoidable warnings remain. Info items are acceptable when deliberately skipped.\n" +
  "7. Finish with action=\"final\" and include a summary with keys: pages_moved, pages_changed, pages_deleted, issues_fixed, skipped_uncertain_moves."

MiniADreams.prototype.dreamWiki = function(opts) {
  var self = this
  var wikiMode = isString(self._args.dreamwikimode) ? self._args.dreamwikimode.trim().toLowerCase() : ""
  if (wikiMode !== "lint" && wikiMode !== "plan" && wikiMode !== "apply" && wikiMode !== "reorg") wikiMode = ""
  var effectiveMode = wikiMode.length > 0 ? wikiMode : "apply"
  var isDryRun = toBoolean(self._args.dryrun) === true
  if (effectiveMode === "plan") isDryRun = true
  if (effectiveMode === "lint") isDryRun = true

  if (!toBoolean(self._args.usewiki)) {
    self._log("[dreams:wiki] usewiki is not set. Skipping wiki dream.")
    return { ok: false, reason: "usewiki-not-set" }
  }

  var defaultResult = {
    ok: true,
    mode: effectiveMode,
    pages_moved: 0,
    pages_changed: 0,
    pages_deleted: 0,
    indexes_created: 0,
    indexes_updated: 0,
    redirects_created: 0,
    issues_fixed: [],
    skipped_uncertain_moves: [],
    lint_before: { errors: 0, warnings: 0, info: 0 },
    lint_after: { errors: 0, warnings: 0, info: 0 }
  }

  var staleDays = isNumber(self._args.wikilintstaleddays) ? self._args.wikilintstaleddays : Number(self._args.wikilintstaleddays)
  if (isNaN(staleDays)) staleDays = 90

  var wikiCfg = self._buildWikiConfig()
  if (!isMap(wikiCfg)) {
    self._log("[dreams:wiki] Cannot build wiki config. Skipping.")
    return { ok: false, reason: "no-wiki-config" }
  }

  var lintSummary = function(lintResult) {
    var s = isMap(lintResult) && isMap(lintResult.summary) ? lintResult.summary : {}
    return {
      errors: isNumber(s.errors) ? s.errors : 0,
      warnings: isNumber(s.warnings) ? s.warnings : 0,
      info: isNumber(s.info) ? s.info : 0
    }
  }

  var _unique = function(arr) {
    var out = []
    var seen = {}
    ;(isArray(arr) ? arr : []).forEach(function(v) {
      var k = String(v)
      if (seen[k]) return
      seen[k] = true
      out.push(v)
    })
    return out
  }

  var buildProposal = function(wm, lintResult) {
    var missingIndexIssues = lintResult.issues.filter(function(iss) { return iss.type === "missing_index" })
    var indexMissingLinks = lintResult.issues.filter(function(iss) { return iss.type === "index_missing_links" })
    var staleIndexes = lintResult.issues.filter(function(iss) { return iss.type === "stale_index" })
    return {
      new_tree: wm.tree("", isNumber(self._args.dreamwikimaxdepth) ? self._args.dreamwikimaxdepth : Number(self._args.dreamwikimaxdepth) || 3),
      move_table: [],
      indexes_to_create: _unique(missingIndexIssues.map(function(iss) { return iss.page })),
      indexes_to_update: _unique(indexMissingLinks.concat(staleIndexes).map(function(iss) { return iss.page })),
      protected_pages: ["AGENTS.md", "log.md", "index.md", ".mini-a-wiki-lucene.lock"],
      skipped_uncertain_moves: [],
      lint_before: lintSummary(lintResult),
      expected_lint_after: lintSummary(lintResult)
    }
  }

  var updateIndexLinks = function(wm, indexPath, targets) {
    var page = wm.read(indexPath)
    if (!isMap(page) || !isMap(page.meta) || !isString(page.body)) return false
    var body = page.body
    var changed = false
    ;(isArray(targets) ? targets : []).forEach(function(target) {
      var rel = wm._relativePath(indexPath, target)
      var label = target.replace(/\/index\.md$/i, "").replace(/\.md$/i, "").replace(/.*\//, "").replace(/[-_]/g, " ")
      var link = "[" + label + "](" + rel + ")"
      if (body.indexOf("(" + rel + ")") < 0 && body.indexOf("[" + label + "]") < 0) {
        body += "\n- " + link
        changed = true
      }
    })
    if (!changed) return false
    var wr = wm.write(indexPath, page.meta, body)
    return isMap(wr) && wr.ok === true
  }

  if (isDryRun) {
    self._log("💤 [dreams] Wiki dream dry-run: building proposal package...")
    try {
      var wmDry = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:plan] " + msg) })
      var lintBeforeDry = wmDry.lint(__, { staleDays: staleDays })
      var proposal = buildProposal(wmDry, lintBeforeDry)
      defaultResult.mode = effectiveMode === "lint" ? "lint" : "plan"
      defaultResult.lint_before = lintSummary(lintBeforeDry)
      defaultResult.lint_after = lintSummary(lintBeforeDry)
      defaultResult.proposal = proposal
      self._log("[dreams:wiki] Dry-run complete — proposal generated with " + proposal.indexes_to_create.length + " index creates and " + proposal.indexes_to_update.length + " index updates.")
      return defaultResult
    } catch(wikiDryErr) {
      self._log("[dreams:wiki] Lint/plan error: " + __miniAErrMsg(wikiDryErr))
      return { ok: false, reason: "lint-error", error: __miniAErrMsg(wikiDryErr) }
    }
  }

  // Guardrails for structural reorg mode
  if (effectiveMode === "reorg") {
    if (toBoolean(self._args.dreamwikireorg) !== true) return { ok: false, reason: "reorg-not-enabled" }
    if (toBoolean(self._args.dreamwikiapply) !== true) return { ok: false, reason: "apply-gate-closed" }
    var approvalMode = isString(self._args.dreamwikiapproval) ? self._args.dreamwikiapproval.trim().toLowerCase() : "ask"
    if (approvalMode !== "auto" && approvalMode !== "ask" && approvalMode !== "never") approvalMode = "ask"
    if (approvalMode === "never") return { ok: false, reason: "approval-denied" }
    if (approvalMode === "ask") return { ok: false, reason: "approval-required" }
  }

  if (effectiveMode === "apply") {
    if (toBoolean(self._args.dreamwikiapply) !== true) return { ok: false, reason: "apply-gate-closed" }
  }

  if (effectiveMode === "apply") {
    self._log("💤 [dreams] Starting wiki dream apply pass...")
    try {
      var wmApply = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:apply] " + msg) })
      // Upgrade AGENTS.md to current template version (deterministic, preserves user customizations)
      try {
        var upgradeResult = wmApply.upgradeAgents()
        if (isMap(upgradeResult) && upgradeResult.action && upgradeResult.action !== "noop") {
          self._log("[dreams:wiki] AGENTS.md " + upgradeResult.action + " to v" + upgradeResult.agentsVersion)
          defaultResult.issues_fixed.push("agents_upgraded:" + upgradeResult.action)
        }
      } catch(upgradeErr) {
        self._log("[dreams:wiki] AGENTS.md upgrade error (non-fatal): " + __miniAErrMsg(upgradeErr))
      }

      var lintBefore = wmApply.lint(__, { staleDays: staleDays })
      defaultResult.lint_before = lintSummary(lintBefore)

      var issues = isArray(lintBefore.issues) ? lintBefore.issues : []
      var missingIndexes = issues.filter(function(iss) { return iss.type === "missing_index" })
      var missingLinks = issues.filter(function(iss) { return iss.type === "index_missing_links" })
      var staleIdx = issues.filter(function(iss) { return iss.type === "stale_index" })
      var pageCount = isArray(wmApply.list("")) ? wmApply.list("").length : 0
      var minPages = isNumber(self._args.dreamwikiminpages) ? self._args.dreamwikiminpages : Number(self._args.dreamwikiminpages)
      if (isNaN(minPages)) minPages = 5
      if (pageCount < minPages) {
        defaultResult.skipped_uncertain_moves.push("apply skipped: page count " + pageCount + " is below dreamwikiminpages " + minPages)
      } else {
        missingIndexes.forEach(function(iss) {
          var r = wmApply.init(iss.section)
          if (isMap(r) && r.ok === true && isArray(r.created) && r.created.length > 0) {
            defaultResult.indexes_created += r.created.length
            defaultResult.issues_fixed.push("missing_index:" + iss.page)
          }
        })

        var targetsByIndex = {}
        missingLinks.forEach(function(iss) {
          if (!isString(iss.page) || !isString(iss.target)) return
          if (!isArray(targetsByIndex[iss.page])) targetsByIndex[iss.page] = []
          targetsByIndex[iss.page].push(iss.target)
        })
        Object.keys(targetsByIndex).forEach(function(indexPath) {
          if (updateIndexLinks(wmApply, indexPath, targetsByIndex[indexPath])) {
            defaultResult.indexes_updated++
            defaultResult.pages_changed++
            defaultResult.issues_fixed.push("index_missing_links:" + indexPath)
          }
        })

        _unique(staleIdx.map(function(iss) { return iss.page })).forEach(function(indexPath) {
          var page = wmApply.read(indexPath)
          if (!isMap(page) || !isMap(page.meta) || !isString(page.body)) return
          var wr = wmApply.write(indexPath, page.meta, page.body)
          if (isMap(wr) && wr.ok === true) {
            defaultResult.indexes_updated++
            defaultResult.pages_changed++
            defaultResult.issues_fixed.push("stale_index:" + indexPath)
          }
        })
      }

      var lintAfter = wmApply.lint(__, { staleDays: staleDays })
      defaultResult.lint_after = lintSummary(lintAfter)
      self._log("💤 [dreams] Wiki dream apply complete.")
      return defaultResult
    } catch(applyErr) {
      self._log("[dreams:wiki] Apply error: " + __miniAErrMsg(applyErr))
      return { ok: false, reason: "apply-error", error: __miniAErrMsg(applyErr) }
    }
  }

  self._log("💤 [dreams] Starting wiki dream pass...")

  // Build dream agent args — start from a clean copy, strip conversation
  var dreamArgs = {}
  var stripKeys = { conversation: true, goal: true, dryrun: true, __interaction_source: true, __explicitargkeys: true, __format: true }
  Object.keys(self._args).forEach(function(k) {
    if (stripKeys[k]) return
    dreamArgs[k] = self._args[k]
  })
  dreamArgs.usewiki     = "true"
  dreamArgs.wikiaccess  = "rw"
  dreamArgs.usememory   = (isDef(self._args.memorych) && String(self._args.memorych).trim().length > 0) ? "true" : "false"
  dreamArgs.memoryscope = "global"
  dreamArgs.maxsteps    = isNumber(self._args.dreammaxsteps) && self._args.dreammaxsteps > 0 ? Math.round(self._args.dreammaxsteps) : 60
  dreamArgs.goal        = _WIKI_DREAM_GOAL

  try {
    // Safety gate: reorg mode requires AGENTS.md to be loaded first.
    if (effectiveMode === "reorg") {
      var wmCheck = new MiniAWikiManager(wikiCfg, function() {})
      wmCheck.read("AGENTS.md")
    }
    var agent = new MiniA()
    agent.setInteractionFn(function(event, message) {
      agent.defaultInteractionFn(event, message, function(icon, text) {
        self._log("[dreams:wiki] " + (icon ? icon + " " : "") + text)
      })
    })
    agent.init(dreamArgs)
    var result = agent.start(dreamArgs)
    self._log("💤 [dreams] Wiki dream complete.")
    var out = merge(defaultResult, {
      ok: true,
      mode: "reorg",
      result: isString(result) ? result.substring(0, 500) : String(result || "").substring(0, 500)
    })
    return out
  } catch(wikiErr) {
    self._log("[dreams:wiki] Agent error: " + __miniAErrMsg(wikiErr))
    return { ok: false, reason: "agent-error", error: __miniAErrMsg(wikiErr) }
  }
}

MiniADreams.prototype._buildWikiConfig = function() {
  var a = this._args
  if (!toBoolean(a.usewiki)) return __
  var backend = isString(a.wikibackend) ? a.wikibackend.toLowerCase() : "fs"
  var cfg = { access: "rw", backend: backend }
  if (backend === "fs") {
    cfg.root = isString(a.wikiroot) && a.wikiroot.trim().length > 0 ? a.wikiroot.trim() : "."
  } else if (backend === "s3" || backend === "s3fs") {
    cfg.bucket     = a.wikibucket
    cfg.prefix     = isString(a.wikiprefix) && a.wikiprefix.trim().length > 0 ? a.wikiprefix.trim() : "wiki/"
    cfg.url        = isString(a.wikiurl) && a.wikiurl.trim().length > 0 ? a.wikiurl.trim() : "https://s3.amazonaws.com"
    cfg.accessKey  = a.wikiaccesskey
    cfg.secret     = a.wikisecret
    cfg.region     = a.wikiregion
    cfg.useVersion1 = toBoolean(a.wikiuseversion1) === true
    cfg.ignoreCertCheck = toBoolean(a.wikiignorecertcheck) === true
  } else if (backend === "es") {
    cfg.esurl   = isString(a.wikiurl) && a.wikiurl.trim().length > 0 ? a.wikiurl.trim() : "http://localhost:9200"
    cfg.esindex = isString(a.wikiprefix) && a.wikiprefix.trim().length > 0 ? a.wikiprefix.trim() : "mini_a_wiki"
    cfg.esuser  = a.wikiaccesskey
    cfg.espass  = a.wikisecret
  }
  return cfg
}

// ── main entry ────────────────────────────────────────────────

MiniADreams.prototype.run = function() {
  var self = this
  var dreamMode = isString(self._args.dreammode) ? self._args.dreammode.trim().toLowerCase() : ""
  if (dreamMode !== "memory" && dreamMode !== "wiki" && dreamMode !== "both") dreamMode = ""
  var forceWiki = toBoolean(self._args.dreamwiki) === true
  var hasMemory = isString(self._args.memorych) && self._args.memorych.trim().length > 0
  var hasWiki   = toBoolean(self._args.usewiki) === true
  var runMemory = hasMemory && (dreamMode === "" || dreamMode === "memory" || dreamMode === "both")
  var runWiki   = hasWiki && (
    dreamMode === "wiki" ||
    dreamMode === "both" ||
    forceWiki === true ||
    (dreamMode === "" && !hasMemory)
  )

  if (!runMemory && !runWiki) {
    self._log("Usage: mini-a dream=true [memorych=<JSSLON>] [auditch=<JSSLON>] [usewiki=true wikiroot=<path>] [model=<JSSLON>] [dryrun=true] [dreammode=memory|wiki|both] [dreamwiki=true]")
    self._log("  memorych=       JSSLON global memory channel definition (required for memory dream)")
    self._log("  memorysessionch=JSSLON session memory channel")
    self._log("  memorysessionid=Session namespace string")
    self._log("  auditch=        JSSLON audit channel (optional, surfaces insights)")
    self._log("  usewiki=true    Enable wiki dream configuration")
    self._log("  wikiroot=       Wiki filesystem root path")
    self._log("  model=          JSSLON model config e.g. '{\"type\":\"anthropic\",\"model\":\"claude-sonnet-4-6\"}'")
    self._log("  dryrun=true     Report what would change without writing")
    self._log("  dreammaxsteps=  Maximum agent steps for wiki dream pass (default: 60)")
    self._log("  dreammode=      Explicit run mode: memory, wiki or both")
    self._log("  dreamwiki=true  Force wiki dream when memorych is also configured")
    self._log("  dreamwikimode=  Wiki mode: lint, plan, apply, reorg")
    self._log("  dreammemorymode=Memory mode: plan, apply")
    self._log("  dreamwikiapply= Write gate for apply/reorg (true/false)")
    self._log("  dreamwikiapproval= Approval mode for reorg: auto, ask, never")
    self._log("  dreamreport=    Write JSON run report to a file path")
    return { ok: false, reason: "no-mode" }
  }

  var overall = { ok: true }
  if (runMemory) {
    var memResult = self.dreamMemory()
    overall.memory = memResult
    if (!memResult.ok) overall.ok = false
    if (memResult.partial === true) overall.partial = true
  }
  if (runWiki) {
    var wikiResult = self.dreamWiki()
    overall.wiki = wikiResult
    if (!wikiResult.ok) overall.ok = false
    if (wikiResult.partial === true) overall.partial = true
  }
  if (isString(self._args.dreamreport) && self._args.dreamreport.trim().length > 0) {
    try {
      io.writeFileString(self._args.dreamreport.trim(), stringify(overall, __, ""))
    } catch(reportErr) {
      overall.report_error = __miniAErrMsg(reportErr)
      overall.ok = false
    }
  }
  return overall
}

// ─────────────────────────────────────────────────────────────
// Standalone entry point — skipped when loaded as a library
// (set global.__mini_a_dreams_lib_mode = true before loadLib to suppress)
// ─────────────────────────────────────────────────────────────

if (!toBoolean(global.__mini_a_dreams_lib_mode)) {
  var _dreams = new MiniADreams(args, log)
  var _dreamsResult = _dreams.run()
  if (isMap(_dreamsResult) && _dreamsResult.ok === false && _dreamsResult.reason === "no-mode") java.lang.System.exit(1)
}
