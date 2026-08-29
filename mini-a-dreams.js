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
loadLib("mini-a-wiki-knowledge.js")
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

// Builds an onProgress callback for MiniAWikiGraph.buildSemantic() (threaded through
// MiniAWikiManager.graph("build", {onProgress}) unmodified). Only actual extractions are
// logged, not cache-hit skips, so output stays proportional to real (slow, per-page LLM) work.
MiniADreams.prototype._wikiGraphProgressFn = function() {
  var self = this
  return function(info) {
    if (!isMap(info) || info.status !== "processed") return
    self._log("[dreams:wiki] Graph: page " + info.index + "/" + info.total + " extracted (" + info.path + ")")
  }
}

// Allow tests (and callers) to inject a stub LLM so no real API keys are needed.
MiniADreams.prototype._setLlm = function(llmInstance) {
  this._llm = llmInstance
}

// Convert old append-only tool dumps into bounded reviewable observations before
// asking the dream model to consolidate them. It never discards the original ID.
MiniADreams.prototype._normalizeLegacyArtifacts = function(snapshot) {
  if (!isMap(snapshot) || !isMap(snapshot.sections) || !isArray(snapshot.sections.artifacts)) return snapshot
  snapshot.sections.artifacts = snapshot.sections.artifacts.map(function(entry) {
    if (!isMap(entry) || isString(entry.kind)) return entry
    var sourceTool = isString(entry.sourceTool) ? entry.sourceTool : (isMap(entry.provenance) ? entry.provenance.tool : "")
    if (!isString(sourceTool) || sourceTool.length === 0) return entry
    var raw = isString(entry.value) ? entry.value : String(entry.value || "")
    var key = "artifact:legacy:" + sourceTool + ":" + sha1(raw.substring(0, 512)).substring(0, 12)
    entry.kind = "artifact:legacy"
    entry.key = key
    entry.observedAt = isString(entry.updatedAt) ? entry.updatedAt : new Date().toISOString()
    entry.expiresAt = new Date(Date.now() + 86400000).toISOString()
    entry.taskScope = "general::" + sourceTool
    entry.value = "Legacy tool observation: " + sourceTool + " | " + raw.replace(/\s+/g, " ").substring(0, 320)
    entry.meta = merge(isMap(entry.meta) ? entry.meta : {}, { needsReview: true, legacyRawSize: raw.length })
    return entry
  })
  return snapshot
}

// ── channel helpers ───────────────────────────────────────────

MiniADreams.prototype._createChannelFromDef = function(rawDef, fallbackName, fallbackType) {
  if (!isString(rawDef) || rawDef.trim().length === 0) return __
  var parsed = __
  try { parsed = af.fromJSSLON(__miniANormalizeChannelDef(rawDef)) } catch(ignoreJSSLONParse) {}
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

// _graphLlmExtract: the llmExtractFn MiniAWikiGraph.buildSemantic() calls per changed page when
// wikigraphsemantic is on. Mirrors the interactive agent's version (mini-a.js ~7525) but built
// around MiniADreams' own model/OAF_MODEL resolution (_buildLlm), since a dream pass has no live
// MiniA agent instance to borrow an LLM from. Same prompt/parse shape as dreamMemory's LLM call.
MiniADreams.prototype._graphLlmExtract = function(llm, payload) {
  var prompt = "Extract relationships from a wiki page and return ONLY a valid JSON object — no " +
    "commentary, no markdown fences — with keys: summary (string), relationships (array of " +
    "{from,to,type,provenance,confidence}).\nPage:\n" + stringify(payload, __, "  ")
  try {
    var resp = isFunction(llm.promptJSONWithStats) ? llm.promptJSONWithStats(prompt)
             : isFunction(llm.promptWithStats)     ? llm.promptWithStats(prompt)
             : { response: llm.prompt(prompt) }
    var raw = isMap(resp) && isDef(resp.response) ? resp.response : resp
    if (isString(raw)) {
      var cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
      var parsed = jsonParse(cleaned, __, __, true)
      return isMap(parsed) ? parsed : { relationships: [] }
    }
    return isMap(raw) ? raw : { relationships: [] }
  } catch(graphLlmErr) {
    this._log("[dreams:wiki:graph] LLM semantic extraction failed: " + __miniAErrMsg(graphLlmErr))
    return { relationships: [] }
  }
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

MiniADreams.prototype._backupMemoryToMarkdown = function(manager, backupRoot) {
  try {
    var snap = manager.snapshot()
    var tmpMgr = new MiniAMemoryManager({})
    tmpMgr.init(snap)
    return tmpMgr.saveToMarkdown(backupRoot)
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
  // memorymdroot replaces memorych for the global store only -- same "instead of" rule
  // as the regular agent run (mini-a.js _initWorkingMemory/_persistWorkingMemory).
  var mdRoot = isString(self._args.memorymdroot) && self._args.memorymdroot.trim().length > 0 ? self._args.memorymdroot.trim() : __
  var globalChDef = __
  if (isUnDef(mdRoot)) {
    globalChDef = self._createChannelFromDef(self._args.memorych, "_mini_a_memory_channel", "simple")
    if (!isMap(globalChDef)) {
      self._log("[dreams:memory] No global memory channel configured (memorych). Skipping.")
      return { ok: false, reason: "no-memorych" }
    }
  }

  var sessionChDef  = self._createChannelFromDef(self._args.memorysessionch, "_mini_a_session_memory_channel", "simple")
  var sessionId     = isString(self._args.memorysessionid) ? self._args.memorysessionid.trim() : ""
  var auditChDef    = self._createChannelFromDef(self._args.auditch, "_mini_a_audit_channel", "simple")

  // ── 2. Load memory ────────────────────────────────────────
  var globalMgr = new MiniAMemoryManager({})
  var globalLoaded = isString(mdRoot) ? globalMgr.loadFromMarkdown(mdRoot) : globalMgr.loadFromChannel(globalChDef.name, "")
  if (!globalLoaded) {
    self._log("[dreams:memory] Global memory " + (isString(mdRoot) ? "markdown root" : "channel") + " is empty or unreadable — nothing to consolidate.")
    return { ok: false, reason: "empty-source" }
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

  // Helper: consolidate one manager's memory via LLM. mdRootParam is only set for the
  // global pass when memorymdroot is configured; session memory always uses chName/ns.
  var consolidateOne = function(mgr, label, chName, ns, mdRootParam) {
    var tConsolidate = Date.now()
    var snap = self._normalizeLegacyArtifacts(mgr.snapshot())
    var beforeCounts = {}
    _MEMORY_SECTIONS.forEach(function(s) { beforeCounts[s] = isArray(snap.sections[s]) ? snap.sections[s].length : 0 })
    var totalBefore = _MEMORY_SECTIONS.reduce(function(sum, s) { return sum + beforeCounts[s] }, 0)
    self._log("[dreams:memory:" + label + "] " + totalBefore + " entries before consolidation. Consolidating via LLM...")

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

    self._log("[dreams:memory:" + label + "] Consolidated in " + ((Date.now() - tConsolidate) / 1000).toFixed(1) + "s: " + totalAfter + " entries (" +
      droppedCount + " dropped, " + addedCount + " added, " + staleCount + " stale-marked).")

    if (isDryRun) {
      self._log("[dreams:memory:" + label + "] Dry-run — skipping write.")
      return { ok: true, mode: "plan", dryRun: true, before: totalBefore, after: totalAfter, staleMarked: staleCount }
    }

    // Backup pre-dream state
    var backedUp
    if (isString(mdRootParam)) {
      var backupRoot = mdRootParam + "/.predream-" + new Date().toISOString().replace(/[:.]/g, "-")
      backedUp = self._backupMemoryToMarkdown(mgr, backupRoot)
      if (backedUp) {
        self._log("[dreams:memory:" + label + "] Pre-dream backup saved to '" + backupRoot + "'.")
      } else {
        self._log("[dreams:memory:" + label + "] WARNING: pre-dream backup failed — proceeding without backup.")
      }
    } else {
      var backupNs = (ns.length > 0 ? ns : "_global") + "::predream-" + new Date().toISOString().replace(/[:.]/g, "-")
      backedUp = self._backupMemoryToNamespace(mgr, chName, ns, backupNs)
      if (backedUp) {
        self._log("[dreams:memory:" + label + "] Pre-dream backup saved to namespace '" + backupNs + "'.")
      } else {
        self._log("[dreams:memory:" + label + "] WARNING: pre-dream backup failed — proceeding without backup.")
      }
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

    var saved
    if (isString(mdRootParam)) {
      saved = saveMgr.saveToMarkdown(mdRootParam)
      if (saved) {
        self._log("[dreams:memory:" + label + "] Written to markdown root '" + mdRootParam + "'.")
      } else {
        self._log("[dreams:memory:" + label + "] WARNING: saveToMarkdown returned false.")
      }
    } else {
      saved = saveMgr.saveToChannel(chName, ns)
      if (saved) {
        self._log("[dreams:memory:" + label + "] Written to channel '" + chName + "' (ns='" + ns + "').")
      } else {
        self._log("[dreams:memory:" + label + "] WARNING: saveToChannel returned false.")
      }
    }
    return { ok: saved, mode: "apply", before: totalBefore, after: totalAfter, staleMarked: staleCount }
  }

  var results = {}

  // Global memory
  results.global = consolidateOne(globalMgr, "global", isMap(globalChDef) ? globalChDef.name : __, "", mdRoot)
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
  "- Shell and filesystem tools are unavailable in this pass. Use only wiki operations and result_* tools.\n" +
  "- A wiki write replaces the whole page. For an existing page, use a bounded line/section edit; do not rewrite a page merely to fix a link or frontmatter.\n" +
  "- Lint results are paged. Filter by severity/type/page and inspect only the affected issue before changing a page.\n\n" +
  "Follow these steps in order:\n" +
  "1. Discovery: use wiki op=\"context\" for a compact overview, then op=\"lint\" for all issues, op=\"tree\" and op=\"browse\" for structure, op=\"backlinks\" for cross-references.\n" +
  "2. Plan: produce a short reorganisation plan in your context before writing. Folders with index.md are section sub-wikis. Keep existing paths valid unless you intentionally move them.\n" +
  "3. Apply only high-confidence changes. Use wiki op=\"move\" for relocations so links are repaired. Skip uncertain moves, record them as skipped_uncertain_moves.\n" +
  "4. For near_duplicate pairs: use wiki op=\"read\" on both, write a merged version to the primary, then delete or supersede the duplicate only when confidence is high.\n" +
  "5. For broken_link, missing_frontmatter, heading_hierarchy, and orphan issues: read the affected pages, make the minimal correction, write back.\n" +
  "6. Re-run wiki op=\"lint\" to confirm zero errors and no avoidable warnings remain. Info items are acceptable when deliberately skipped.\n" +
  "7. Finish with action=\"final\" and include a summary with keys: pages_moved, pages_changed, pages_deleted, issues_fixed, skipped_uncertain_moves."

// _wikiLintMemoryManager: the memory manager lint() needs to detect memory_conflict issues.
// Without it that check can never fire. Reuses the manager built by the memory dream when
// the two passes run together, otherwise loads one from memorych for a standalone wiki dream.
MiniADreams.prototype._wikiLintMemoryManager = function() {
  if (isObject(this._lintMemoryManager)) return this._lintMemoryManager
  var mdRoot = isString(this._args.memorymdroot) && this._args.memorymdroot.trim().length > 0 ? this._args.memorymdroot.trim() : __
  try {
    var mgr = new MiniAMemoryManager({})
    if (isString(mdRoot)) {
      if (mgr.loadFromMarkdown(mdRoot) !== true) return __
    } else {
      var chDef = this._createChannelFromDef(this._args.memorych, "_mini_a_global_memory_channel", "simple")
      if (!isMap(chDef)) return __
      if (mgr.loadFromChannel(chDef.name, "") !== true) return __
    }
    this._lintMemoryManager = mgr
    return mgr
  } catch(e) {
    this._log("[dreams:wiki] Could not load memory for lint conflicts: " + __miniAErrMsg(e))
    return __
  }
}

MiniADreams.prototype.dreamWiki = function(opts) {
  var self = this
  // Modes: plan (propose only) | apply (deterministic fixes) | reorg (full agent loop) |
  // repair (deterministic lint fixes only) | reindex (search index rebuild only) |
  // graph (knowledge graph rebuild only) | indexes (index.md regeneration only).
  // repair/reindex/graph/indexes are the isolated building blocks apply composes together.
  // 'lint' was dropped — it was 'plan' minus the proposal and duplicated /wiki lint.
  var wikiMode = isString(self._args.dreamwikimode) ? self._args.dreamwikimode.trim().toLowerCase() : ""
  if (wikiMode !== "plan" && wikiMode !== "apply" && wikiMode !== "reorg" && wikiMode !== "repair" &&
      wikiMode !== "reindex" && wikiMode !== "graph" && wikiMode !== "indexes") wikiMode = ""
  var effectiveMode = wikiMode.length > 0 ? wikiMode : "apply"
  // apply now runs by default; dreamwikidryrun is the opt-out
  var isDryRun = toBoolean(self._args.dryrun) === true || toBoolean(self._args.dreamwikidryrun) === true
  if (effectiveMode === "plan") isDryRun = true
  var lintMemMgr = self._wikiLintMemoryManager()

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
    repairs: { fixed: [], skipped: [], candidates: [] },
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

  // Bracket every lint() call (run up to 5x per apply) with a start log and an elapsed-time
  // result so a wiki-wide scan doesn't read as silence during a long dream run.
  var timedLint = function(wm) {
    self._log("[dreams:wiki] Linting wiki...")
    var t0 = Date.now()
    var result = wm.lint(lintMemMgr, { staleDays: staleDays })
    var s = lintSummary(result)
    self._log("[dreams:wiki] Lint complete in " + ((Date.now() - t0) / 1000).toFixed(1) + "s — " + s.errors + "E/" + s.warnings + "W")
    return result
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

  if (isDryRun) {
    self._log("💤 [dreams] Wiki dream dry-run: building proposal package...")
    try {
      var wmDry = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:plan] " + msg) })
      var lintBeforeDry = timedLint(wmDry)
      var proposal = buildProposal(wmDry, lintBeforeDry)
      defaultResult.mode = "plan"
      defaultResult.lint_before = lintSummary(lintBeforeDry)
      defaultResult.lint_after = lintSummary(lintBeforeDry)
      defaultResult.repairs = self._repairWikiLint(wmDry, lintBeforeDry, { dryRun: true })
      defaultResult.issues_fixed = defaultResult.repairs.fixed.map(function(issue) { return issue.type + ":" + issue.page })
      proposal.repairs = defaultResult.repairs
      // Preview-only graph build: same structural (+ semantic, if defaulted/enabled) pass apply
      // would run, but buildStructural/buildSemantic skip _persist() when preview:true so the
      // dry-run never touches graph.json.
      if (self._wikiGraphEnabled()) {
        try {
          // Plan/dry-run is intentionally model-free. It reports semantic work as an
          // estimate below instead of invoking the graph extractor.
          var wantSemantic = false
          proposal.graph_preview = { semantic: wantSemantic, result: wmDry.graph("build", { preview: true, semantic: wantSemantic }) }
        } catch(graphPreviewErr) {
          self._log("[dreams:wiki] Graph preview error: " + __miniAErrMsg(graphPreviewErr))
          proposal.graph_preview = { ok: false, error: __miniAErrMsg(graphPreviewErr) }
        }
      }
      defaultResult.proposal = proposal
      if (isFunction(wmDry.knowledgeDirtySet)) {
        var stateDry = wmDry.knowledgeLoadState()
        var changedDry = Object.keys(stateDry.chunks || {})
        defaultResult.dirty_set = wmDry.knowledgeDirtySet(changedDry, { maxAffected: self._args.dreamwikimaxaffected, maxDepth: self._args.dreamwikimaxdepth })
        defaultResult.estimated_llm_calls = changedDry.length
        defaultResult.estimated_input_tokens = changedDry.reduce(function(n, id) { var c = stateDry.chunks[id]; return n + (Number(c.estimatedTokens) || 0) }, 0)
      }
      wmDry.close()
      self._log("[dreams:wiki] Dry-run complete — proposal generated with " + proposal.indexes_to_create.length + " index creates and " + proposal.indexes_to_update.length + " index updates.")
      return defaultResult
    } catch(wikiDryErr) {
      self._log("[dreams:wiki] Lint/plan error: " + __miniAErrMsg(wikiDryErr))
      return { ok: false, reason: "lint-error", error: __miniAErrMsg(wikiDryErr) }
    }
  }

  // Guardrails for structural reorg mode
  // reorg spawns a full rw agent loop over the whole wiki, so it keeps its explicit gates.
  // apply is deterministic and bounded, so it no longer requires one.
  if (effectiveMode === "reorg") {
    if (toBoolean(self._args.dreamwikireorg) !== true) return { ok: false, reason: "reorg-not-enabled" }
    var approvalMode = isString(self._args.dreamwikiapproval) ? self._args.dreamwikiapproval.trim().toLowerCase() : "ask"
    if (approvalMode !== "auto" && approvalMode !== "ask" && approvalMode !== "never") approvalMode = "ask"
    if (approvalMode === "never") return { ok: false, reason: "approval-denied" }
    if (approvalMode === "ask") return { ok: false, reason: "approval-required" }
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

      var lintBefore = timedLint(wmApply)
      defaultResult.lint_before = lintSummary(lintBefore)

      var loopResult = self._runWikiRepairLoop(wmApply, lintBefore, function() {
        return timedLint(wmApply)
      }, 3, {})
      defaultResult.repairs = loopResult.repairs
      defaultResult.repair_passes = loopResult.passes
      defaultResult.pages_changed = loopResult.repairs.pages_changed
      defaultResult.repairs.fixed.forEach(function(issue) {
        defaultResult.issues_fixed.push(issue.type + ":" + issue.page)
        if (issue.type === "missing_index") defaultResult.indexes_created++
        else if (issue.type === "index_missing_links" || issue.type === "stale_index" || issue.type === "structural_orphan") defaultResult.indexes_updated++
      })

      // Always finalize, even when the deterministic fixes were skipped: a small wiki
      // still deserves a correct index, a fresh search index and a rebuilt graph.
      var fin = self._finalizeWiki(wmApply, defaultResult, { appendLog: false, mode: "apply" })
      defaultResult.finalize = fin

      var lintAfter = timedLint(wmApply)
      defaultResult.lint_after = lintSummary(lintAfter)
      wmApply.close()
      self._log("💤 [dreams] Wiki dream apply complete — " +
        defaultResult.indexes_created + " indexes created, " +
        defaultResult.indexes_updated + " updated, lint " +
        defaultResult.lint_before.errors + "E/" + defaultResult.lint_before.warnings + "W -> " +
        defaultResult.lint_after.errors + "E/" + defaultResult.lint_after.warnings + "W.")
      return defaultResult
    } catch(applyErr) {
      self._log("[dreams:wiki] Apply error: " + __miniAErrMsg(applyErr))
      return { ok: false, reason: "apply-error", error: __miniAErrMsg(applyErr) }
    }
  }

  // repair: just the deterministic fixer — no AGENTS.md upgrade, no index/search/graph
  // finalize. The fast, isolated way to run _repairWikiLint on its own (testing, or a quick
  // link-repair pass you don't want bundled with a full apply).
  if (effectiveMode === "repair") {
    self._log("💤 [dreams] Starting wiki dream repair pass...")
    try {
      var wmRepair = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:repair] " + msg) })
      var repairLintBefore = timedLint(wmRepair)
      defaultResult.lint_before = lintSummary(repairLintBefore)

      var repairLoopResult = self._runWikiRepairLoop(wmRepair, repairLintBefore, function() {
        return timedLint(wmRepair)
      }, 3, {})
      defaultResult.repairs = repairLoopResult.repairs
      defaultResult.repair_passes = repairLoopResult.passes
      defaultResult.pages_changed = repairLoopResult.repairs.pages_changed
      defaultResult.repairs.fixed.forEach(function(issue) {
        defaultResult.issues_fixed.push(issue.type + ":" + issue.page)
        if (issue.type === "missing_index") defaultResult.indexes_created++
        else if (issue.type === "index_missing_links" || issue.type === "stale_index" || issue.type === "structural_orphan") defaultResult.indexes_updated++
      })

      var repairLintAfter = timedLint(wmRepair)
      defaultResult.lint_after = lintSummary(repairLintAfter)
      wmRepair.close()
      self._log("💤 [dreams] Wiki dream repair complete — " + defaultResult.repairs.fixed.length + " issues fixed over " +
        defaultResult.repair_passes + " pass(es), lint " +
        defaultResult.lint_before.errors + "E/" + defaultResult.lint_before.warnings + "W -> " +
        defaultResult.lint_after.errors + "E/" + defaultResult.lint_after.warnings + "W.")
      return defaultResult
    } catch(repairErr) {
      self._log("[dreams:wiki] Repair error: " + __miniAErrMsg(repairErr))
      return { ok: false, reason: "repair-error", error: __miniAErrMsg(repairErr) }
    }
  }

  // reindex: just the search/lexical index rebuild (also rebuilds wm's internal graph-hint
  // index used for search hints) — no lint, no repair, no AGENTS.md upgrade.
  if (effectiveMode === "reindex") {
    self._log("💤 [dreams] Starting wiki dream reindex pass...")
    try {
      var wmReindex = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:reindex] " + msg) })
      var tReindex = Date.now()
      var reindexResult = wmReindex.reindex()
      wmReindex.close()
      if (!isMap(reindexResult) || reindexResult.ok !== true) {
        var reindexErr = isMap(reindexResult) && isString(reindexResult.error) ? reindexResult.error : "reindex failed"
        self._log("[dreams:wiki] Reindex failed: " + reindexErr)
        return { ok: false, reason: "reindex-failed", error: reindexErr }
      }
      self._log("💤 [dreams] Wiki dream reindex complete in " + ((Date.now() - tReindex) / 1000).toFixed(1) + "s.")
      return defaultResult
    } catch(reindexErr2) {
      self._log("[dreams:wiki] Reindex error: " + __miniAErrMsg(reindexErr2))
      return { ok: false, reason: "reindex-error", error: __miniAErrMsg(reindexErr2) }
    }
  }

  // graph: just the usewikigraph knowledge-graph rebuild — no lint, no repair, no search reindex.
  if (effectiveMode === "graph") {
    self._log("💤 [dreams] Starting wiki dream graph pass...")
    try {
      var wmGraph = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:graph] " + msg) })
      var tGraph = Date.now()
      var graphSemanticOn = self._effectiveWikiGraphSemantic("graph")
      var graphResult = wmGraph.graph("build", { semantic: graphSemanticOn, onProgress: graphSemanticOn ? self._wikiGraphProgressFn() : __ })
      wmGraph.close()
      if (!isMap(graphResult) || graphResult.ok !== true) {
        var graphErr = isMap(graphResult) && isString(graphResult.error) ? graphResult.error : "graph build failed"
        self._log("[dreams:wiki] Graph build failed: " + graphErr)
        return { ok: false, reason: "graph-failed", error: graphErr }
      }
      self._log("💤 [dreams] Wiki dream graph rebuild complete in " + ((Date.now() - tGraph) / 1000).toFixed(1) + "s.")
      defaultResult.graph = "rebuilt"
      return defaultResult
    } catch(graphErr2) {
      self._log("[dreams:wiki] Graph error: " + __miniAErrMsg(graphErr2))
      return { ok: false, reason: "graph-error", error: __miniAErrMsg(graphErr2) }
    }
  }

  // indexes: just the unconditional index.md regeneration pass — no lint, no repair, no
  // search/graph rebuild. Broader than repair's lint-driven missing_index/stale_index fixes:
  // this regenerates every directory's index unconditionally from current structure.
  if (effectiveMode === "indexes") {
    self._log("💤 [dreams] Starting wiki dream indexes pass...")
    try {
      var wmIdx = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:indexes] " + msg) })
      var tIdxMode = Date.now()
      var idxResult = wmIdx.regenerateIndexes()
      wmIdx.close()
      if (!isMap(idxResult) || idxResult.ok !== true) {
        var idxErr = isMap(idxResult) && isString(idxResult.error) ? idxResult.error : "regenerate indexes failed"
        self._log("[dreams:wiki] Regenerate indexes failed: " + idxErr)
        return { ok: false, reason: "indexes-failed", error: idxErr }
      }
      defaultResult.indexes_regenerated = idxResult.regenerated.length
      self._log("💤 [dreams] Wiki dream indexes complete — " + idxResult.regenerated.length + " page(s) regenerated in " +
        ((Date.now() - tIdxMode) / 1000).toFixed(1) + "s.")
      return defaultResult
    } catch(idxErr2) {
      self._log("[dreams:wiki] Indexes error: " + __miniAErrMsg(idxErr2))
      return { ok: false, reason: "indexes-error", error: __miniAErrMsg(idxErr2) }
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
  // A reorg should only be able to mutate the wiki through its constrained wiki
  // operations. In particular, do not let an agent bypass spill-result guards by
  // reading temporary files with `cat`, or alter the wiki root through shell tools.
  dreamArgs.useshell    = false
  dreamArgs.readwrite   = false
  // Structural edits are never delegated to the low-cost controller. It may be
  // configured for ordinary runs, but reorg decisions must stay on the main model.
  dreamArgs.modellock   = "main"
  // Some MCP catalogs expose a shell tool independently of Mini-A's top-level
  // shell action. Deny it explicitly for dreams as well.
  dreamArgs.mcpproxydeny = isString(dreamArgs.mcpproxydeny) && dreamArgs.mcpproxydeny.trim().length > 0
    ? dreamArgs.mcpproxydeny + ",bash" : "bash"
  dreamArgs.dreamwikisurgical = true
  dreamArgs.wikilintresultlimit = isNumber(self._args.dreamwikilintresultlimit) && self._args.dreamwikilintresultlimit > 0
    ? Math.round(self._args.dreamwikilintresultlimit) : 25
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
    var emittedModelStream = false
    agent.setInteractionFn(function(event, message) {
      if (self._logFn && self._logFn.markdownModelOutput === true && (event === "stream" || event === "planner_stream")) {
        emittedModelStream = true
        try {
          self._logFn({
            type: "dream-model-output",
            scope: "wiki",
            event: event,
            text: isString(message) ? message : String(message || "")
          })
        } catch(ignoreDreamModelOutputLog) {}
        return
      }
      agent.defaultInteractionFn(event, message, function(icon, text) {
        self._log("[dreams:wiki] " + (icon ? icon + " " : "") + text)
      })
    })
    agent.init(dreamArgs)
    var result = agent.start(dreamArgs)
    if (self._logFn && self._logFn.markdownModelOutput === true && emittedModelStream !== true) {
      try {
        self._logFn({
          type: "dream-model-output",
          scope: "wiki",
          event: "answer",
          text: isString(result) ? result : String(result || "")
        })
      } catch(ignoreDreamModelAnswerLog) {}
    }
    // The agent has just moved/merged/rewritten pages, which is exactly the kind of change
    // that breaks links and leaves frontmatter/heading drift — and it did so working from
    // its own judgment within a step budget, so it won't have caught everything. Run one
    // bounded deterministic repair pass to clean up what it left behind, same as apply mode,
    // before finalizing so the wiki is left reindexed, re-linked and with a rebuilt graph.
    var wmFinal = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[dreams:wiki:finalize] " + msg) })
    var reorgLintBefore = timedLint(wmFinal)
    defaultResult.lint_before = lintSummary(reorgLintBefore)
    var reorgLoopResult = self._runWikiRepairLoop(wmFinal, reorgLintBefore, function() {
      return timedLint(wmFinal)
    }, 1, {})
    defaultResult.repairs = reorgLoopResult.repairs
    defaultResult.repair_passes = reorgLoopResult.passes
    defaultResult.pages_changed += reorgLoopResult.repairs.pages_changed
    reorgLoopResult.repairs.fixed.forEach(function(issue) {
      defaultResult.issues_fixed.push(issue.type + ":" + issue.page)
      if (issue.type === "missing_index") defaultResult.indexes_created++
      else if (issue.type === "index_missing_links" || issue.type === "stale_index" || issue.type === "structural_orphan") defaultResult.indexes_updated++
    })

    var reorgFinalize = self._finalizeWiki(wmFinal, defaultResult, { mode: "reorg" })
    var reorgLint = lintSummary(timedLint(wmFinal))
    wmFinal.close()

    self._log("💤 [dreams] Wiki dream complete.")
    var unresolvedErrors = reorgLint.errors > 0
    var out = merge(defaultResult, {
      // Agent text is not proof that the pass completed. The fresh lint result is
      // authoritative and leaves the caller with a machine-readable partial state.
      ok: !unresolvedErrors,
      mode: "reorg",
      result: isString(result) ? result.substring(0, 500) : String(result || "").substring(0, 500)
    })
    if (unresolvedErrors) {
      out.partial = true
      out.reason = "lint-errors-remain"
    }
    out.finalize   = reorgFinalize
    out.lint_after = reorgLint
    return out
  } catch(wikiErr) {
    self._log("[dreams:wiki] Agent error: " + __miniAErrMsg(wikiErr))
    return { ok: false, reason: "agent-error", error: __miniAErrMsg(wikiErr) }
  }
}

// _repairWikiLint performs mechanical repairs only — structure, frontmatter, headings, and
// broken links/anchors resolved with certainty against the page catalogue. Findings that need
// semantic judgment (near_duplicate, orphan, memory_conflict, ambiguous link targets) are left
// for a human or reorg-mode LLM pass. In dry-run mode it returns the same candidates without
// touching the wiki.
MiniADreams.prototype._repairWikiLint = function(wm, lintResult, options) {
  var opts = isMap(options) ? options : {}
  var dryRun = opts.dryRun === true
  var result = { fixed: [], skipped: [], candidates: [], pages_changed: 0 }
  var issues = isMap(lintResult) && isArray(lintResult.issues) ? lintResult.issues : []
  var repairable = {
    missing_index: true, index_missing_links: true, stale_index: true,
    missing_frontmatter: true, missing_h1: true, multiple_h1: true,
    title_h1_mismatch: true, heading_hierarchy: true, broken_link: true,
    invalid_anchor: true, structural_orphan: true
  }
  var copyIssue = function(issue, extra) {
    var out = {}
    Object.keys(issue || {}).forEach(function(k) { if (k !== "severity") out[k] = issue[k] })
    if (isMap(extra)) Object.keys(extra).forEach(function(k) { out[k] = extra[k] })
    return out
  }
  issues.forEach(function(issue) {
    // description is never synthesized (would just be an invented, low-quality guess) — report
    // it as an honest, explicit skip distinct from "issue type never attempted" so callers can
    // tell "field we chose not to auto-fill" apart from "we didn't even try this issue type".
    if (issue.type === "missing_frontmatter" && issue.field === "description") {
      result.skipped.push(copyIssue(issue, { reason: "no-deterministic-value" }))
      return
    }
    if (repairable[issue.type]) result.candidates.push(copyIssue(issue))
    else result.skipped.push(copyIssue(issue, { reason: "requires-semantic-judgment" }))
  })
  if (issues.length > 0) {
    this._log("[dreams:wiki] " + issues.length + " issue(s) this pass — " +
      result.candidates.length + " repairable, " + result.skipped.length + " require semantic judgment")
  }
  if (dryRun) return result

  var changedPages = {}
  var markFixed = function(issue, extra) {
    result.fixed.push(copyIssue(issue, merge({ confidence: "certain", changed: true }, extra || {})))
    var physicalPage = isMap(extra) && isString(extra.physical_page) ? extra.physical_page : issue.page
    if (isString(physicalPage)) changedPages[physicalPage] = true
  }

  // Frontmatter and headings are deliberately coalesced into one physical write per page.
  var pageIssues = {}
  var renamedAnchors = {}
  issues.filter(function(i) {
    return (i.type === "missing_frontmatter" && i.field !== "description") || i.type === "missing_h1" || i.type === "multiple_h1" ||
      i.type === "title_h1_mismatch" || i.type === "heading_hierarchy"
  }).forEach(function(i) { if (!isArray(pageIssues[i.page])) pageIssues[i.page] = []; pageIssues[i.page].push(i) })
  Object.keys(pageIssues).sort().forEach(function(path) {
    if (path === "index.md" || path.endsWith("/index.md") || path === "AGENTS.md" || path === "log.md") return
    var page = wm.read(path)
    if (!isMap(page) || !isMap(page.meta) || !isString(page.body)) return
    var meta = clone(page.meta), body = page.body, changed = false
    var headings = wm._markdownHeadings(body), h1s = headings.filter(function(h) { return h.level === 1 })
    if (!isString(meta.title) || meta.title.trim().length === 0) {
      if (h1s.length === 1) meta.title = h1s[0].text
      else {
        var name = path.replace(/.*\//, "").replace(/\.md$/i, "").replace(/[-_]+/g, " ")
        meta.title = name.length > 0 ? name.substring(0, 1).toUpperCase() + name.substring(1) : "Untitled"
      }
      changed = true
    }
    if (!isString(meta.type) || meta.type.trim().length === 0) { meta.type = "concept"; changed = true }
    if (isUnDef(meta.created) || String(meta.created).trim().length === 0) {
      meta.created = isDef(meta.timestamp) && String(meta.timestamp).trim().length > 0 ? meta.timestamp : new Date().toISOString()
      changed = true
    }
    // wm.write() always unconditionally stamps meta.updated on every write, unlike created
    // (only set if missing) — so forcing a write here is sufficient, no explicit assignment needed.
    if (isUnDef(meta.updated) || String(meta.updated).trim().length === 0) { changed = true }
    var lines = body.split(/\r?\n/)
    headings = wm._markdownHeadings(body)
    h1s = headings.filter(function(h) { return h.level === 1 })
    var h1OldAnchor = h1s.length > 0 ? wm._headingAnchor(h1s[0].text) : null
    if (h1s.length === 0 && isString(meta.title) && meta.title.length > 0) {
      body = "# " + meta.title + (body.length > 0 ? "\n\n" + body.replace(/^\s+/, "") : "")
      changed = true
    } else if (h1s.length > 0) {
      var previous = 0, firstH1 = true
      headings.forEach(function(h) {
        var level = h.level
        if (level === 1) {
          if (firstH1) { level = 1; firstH1 = false }
          else level = previous > 1 ? previous : 2
        }
        if (previous > 0 && level > previous + 1) level = previous + 1
        var text = h.line === h1s[0].line ? meta.title : h.text
        var replacement = new Array(level + 1).join("#") + " " + text
        if (lines[h.line] !== replacement) { lines[h.line] = replacement; changed = true }
        previous = level
      })
      body = lines.join("\n")
    }
    if (changed) {
      var wr = wm.write(path, meta, body)
      if (isMap(wr) && wr.ok === true) {
        pageIssues[path].forEach(function(i) { markFixed(i, { reason: "frontmatter-heading-normalized" }) })
        if (h1s.length > 0) {
          var h1NewAnchor = wm._headingAnchor(meta.title)
          if (h1OldAnchor && h1NewAnchor && h1OldAnchor !== h1NewAnchor) renamedAnchors[path] = { oldAnchor: h1OldAnchor, newAnchor: h1NewAnchor }
        }
      }
      else pageIssues[path].forEach(function(i) { result.skipped.push(copyIssue(i, { reason: "page-not-updated" })) })
    }
  })

  // A retitled H1 changes its anchor slug, which would otherwise strand every inbound
  // [...](page.md#old-slug) link as a permanently-unfixable invalid_anchor (the anchor
  // check has no way to know the heading was renamed, not removed). Rewrite inbound
  // md-style anchors to the new slug in the same pass, before that can happen. Wiki-style
  // [[...]] links never carry anchor fragments through _wikiLinkTarget/lint today, so only
  // md-style links need handling here.
  if (Object.keys(renamedAnchors).length > 0) {
    var anchorScanPages = wm.list("").filter(function(p) { return /\.md$/i.test(p) && p !== "AGENTS.md" && p !== "log.md" })
    anchorScanPages.forEach(function(srcPage) {
      var pg = wm.read(srcPage)
      if (!isMap(pg) || !isString(pg.body)) return
      var rewrites = []
      var newBody = pg.body.replace(/\[([^\]]*)\]\(([^)]+)\)/g, function(all, label, target) {
        var trimmed = String(target).trim(), bits = trimmed.split("#")
        if (bits.length < 2) return all
        var linkPath = bits.shift(), anchorPart = bits.join("#")
        var resolvedTarget = linkPath.length === 0 ? srcPage : wm.resolveLink(srcPage, linkPath)
        var rn = isString(resolvedTarget) ? renamedAnchors[resolvedTarget] : null
        if (!rn || anchorPart.toLowerCase() !== rn.oldAnchor) return all
        rewrites.push({ target: trimmed, resolved: resolvedTarget, from: rn.oldAnchor, to: rn.newAnchor })
        return "[" + label + "](" + linkPath + "#" + rn.newAnchor + ")"
      })
      if (rewrites.length > 0 && newBody !== pg.body) {
        var wrAnchor = wm.write(srcPage, pg.meta, newBody)
        if (isMap(wrAnchor) && wrAnchor.ok === true) {
          rewrites.forEach(function(rw) {
            markFixed({ type: "inbound_anchor_rewrite", page: srcPage, target: rw.target },
              { resolved: rw.resolved, from: rw.from, to: rw.to, reason: "heading-renamed" })
          })
        }
      }
    })
  }

  // Build one catalogue for this pass. Resolution classes are tried in strength order;
  // a class is accepted only when it produces one candidate. This is a full read of every
  // page, so skip it entirely on passes that have no broken_link/invalid_anchor to resolve.
  var brokenIssues = issues.filter(function(i) { return i.type === "broken_link" || i.type === "invalid_anchor" })
  var catalogue = brokenIssues.length === 0 ? [] : wm.list("").filter(function(p) { return /\.md$/i.test(p) && p !== "AGENTS.md" && p !== "log.md" }).map(function(p) {
    var pg = wm.read(p), meta = isMap(pg) && isMap(pg.meta) ? pg.meta : {}
    return { path: p, lower: p.toLowerCase(), base: p.replace(/.*\//, ""), stem: p.replace(/.*\//, "").replace(/\.md$/i, ""),
      title: isString(meta.title) ? meta.title.trim() : "", aliases: isArray(meta.aliases) ? meta.aliases : [],
      anchors: isMap(pg) ? wm._markdownHeadings(pg.body).map(function(h) { return wm._headingAnchor(h.text) }) : [] }
  })
  var slug = function(v) { return String(v || "").toLowerCase().trim().replace(/[^a-z0-9\s_-]/g, "").replace(/[\s_]+/g, "-") }
  var unique = function(arr) { var seen = {}, out = []; arr.forEach(function(c) { if (!seen[c.path]) { seen[c.path] = true; out.push(c) } }); return out }
  var resolveBroken = function(issue) {
    if (String(issue.target || "").startsWith("@")) return { reason: "mounted-wiki-unresolved" }
    // Wiki-style [[...]] targets are always root-relative (per _wikiLinkTarget/lint), unlike
    // md-style (label)(target) links which resolveLink resolves relative to the source page's
    // directory — routing wiki-style targets through resolveLink would wrongly prefix them
    // with the source page's directory for any page not at wiki root.
    var isWikiStyle = issue.linkType === "wiki"
    var bits = String(issue.target || "").split("#"), rawPath = bits.shift(), anchor = bits.join("#")
    var resolved = rawPath.length === 0 ? issue.page : (isWikiStyle ? rawPath.replace(/^\/+/, "") : wm.resolveLink(issue.page, rawPath))
    var attempts = []
    if (isString(resolved)) {
      attempts.push({ name: "exact-resolved-path", matches: catalogue.filter(function(c) { return c.path === resolved }) })
      attempts.push({ name: "exact-md-path", matches: catalogue.filter(function(c) { return c.path === resolved + ".md" }) })
      attempts.push({ name: "directory-index", matches: catalogue.filter(function(c) { return c.path === resolved.replace(/\/$/, "") + "/index.md" }) })
    } else if (rawPath.length > 0) {
      resolved = isWikiStyle ? rawPath.replace(/^\/+/, "") + ".md" : wm.resolveLink(issue.page, rawPath + ".md")
      if (isString(resolved)) attempts.push({ name: "exact-md-path", matches: catalogue.filter(function(c) { return c.path === resolved }) })
      var dirResolved = isWikiStyle ? rawPath.replace(/^\/+/, "").replace(/\/$/, "") + "/index.md" : wm.resolveLink(issue.page, rawPath.replace(/\/$/, "") + "/index.md")
      if (isString(dirResolved)) attempts.push({ name: "directory-index", matches: catalogue.filter(function(c) { return c.path === dirResolved }) })
    }
    var needle = rawPath.replace(/\/$/, "").replace(/\.md$/i, ""), base = needle.replace(/.*\//, "")
    attempts.push({ name: "case-insensitive-path", matches: catalogue.filter(function(c) { return c.lower === (String(resolved || needle) + (/\.md$/i.test(String(resolved || needle)) ? "" : ".md")).toLowerCase() }) })
    attempts.push({ name: "unique-basename", ambiguous: "ambiguous-basename", matches: catalogue.filter(function(c) { return c.stem.toLowerCase() === base.toLowerCase() }) })
    attempts.push({ name: "unique-title-match", ambiguous: "ambiguous-title", matches: catalogue.filter(function(c) { return c.title.toLowerCase() === needle.toLowerCase() || c.title.toLowerCase() === base.toLowerCase() }) })
    attempts.push({ name: "unique-alias-match", ambiguous: "ambiguous-alias", matches: catalogue.filter(function(c) { return c.aliases.some(function(a) { return String(a).toLowerCase() === needle.toLowerCase() || String(a).toLowerCase() === base.toLowerCase() }) }) })
    attempts.push({ name: "unique-slug-title", ambiguous: "ambiguous-title", matches: catalogue.filter(function(c) { return slug(c.title) === slug(base) }) })
    for (var ai = 0; ai < attempts.length; ai++) {
      var matches = unique(attempts[ai].matches)
      if (matches.length > 1 && attempts[ai].ambiguous) {
        // Narrow to a same-directory candidate before giving up as ambiguous — a single,
        // easily-explainable rule (no recency/similarity scoring) for the common case of
        // same-named pages living in different sections.
        var sameDir = matches.filter(function(c) { return wm._pageDir(c.path) === wm._pageDir(issue.page) })
        if (sameDir.length === 1) matches = sameDir
      }
      if (matches.length > 1) return { reason: attempts[ai].ambiguous || "ambiguous-target" }
      if (matches.length === 1) {
        // Always write back the canonical (already-lowercase) slug, not the link's original
        // casing, whether it matched exact or only after normalization below.
        var resolvedAnchor = anchor.length > 0 ? anchor.toLowerCase() : anchor
        if (anchor.length > 0 && matches[0].anchors.indexOf(anchor.toLowerCase()) < 0) {
          // The exact-text check just failed — the same computation lint used to raise this
          // issue in the first place, so retrying it verbatim would always fail again. Widen
          // (not force) the match: normalize the link's own anchor text through the same
          // slugifier used to build heading anchors, so raw heading text, case, punctuation,
          // or %-encoding differences still resolve to the real heading's canonical slug.
          var decodedAnchor = anchor
          try { decodedAnchor = decodeURIComponent(anchor) } catch(eDecode) {}
          var normalizedAnchor = wm._headingAnchor(decodedAnchor)
          if (matches[0].anchors.indexOf(normalizedAnchor) < 0) return { reason: "invalid-anchor" }
          resolvedAnchor = normalizedAnchor
        }
        return { candidate: matches[0], strategy: attempts[ai].name, anchor: resolvedAnchor }
      }
    }
    return { reason: "no-candidate" }
  }
  brokenIssues.forEach(function(issue) {
    var found = resolveBroken(issue)
    if (!found.candidate) { result.skipped.push(copyIssue(issue, { reason: found.reason })); return }
    var page = wm.read(issue.page)
    if (!isMap(page) || !isString(page.body)) { result.skipped.push(copyIssue(issue, { reason: "page-not-readable" })); return }
    var oldTarget = String(issue.target), replacedCount = 0, body
    if (issue.linkType === "wiki") {
      // Wiki-style [[...]] targets are root-relative and anchor-stripped by _wikiLinkTarget
      // (see lint's link extraction), so the stored target matches the candidate path directly.
      // Rewrite every occurrence of this target in one write (not just the first) — lint dedups
      // link issues by raw target text per page, so a page with the same broken target 2+ times
      // only ever produces one issue; without this, reorg mode (1 repair pass) would never
      // converge such a page at all.
      body = page.body.replace(/\[\[([^\]]+)\]\]/g, function(all, inner) {
        if (wm._wikiLinkTarget(inner) !== oldTarget) return all
        replacedCount++
        var pipeAt = inner.indexOf("|")
        return "[[" + found.candidate.path + (pipeAt >= 0 ? inner.substring(pipeAt) : "") + "]]"
      })
    } else {
      var rel = found.candidate.path === issue.page && found.anchor.length > 0 ? "" : wm._relativePath(issue.page, found.candidate.path)
      var newTarget = rel + (found.anchor.length > 0 ? "#" + found.anchor : "")
      body = page.body.replace(/\[([^\]]*)\]\(([^)]+)\)/g, function(all, label, target) {
        if (String(target).trim() !== oldTarget) return all
        replacedCount++
        return "[" + label + "](" + newTarget + ")"
      })
    }
    if (replacedCount === 0 || body === page.body) { result.skipped.push(copyIssue(issue, { reason: "link-not-rewritable" })); return }
    var wr = wm.write(issue.page, page.meta, body)
    if (isMap(wr) && wr.ok === true) markFixed(issue, { resolved: found.candidate.path, strategy: found.strategy, reason: found.strategy })
  })

  // Index/orphan repairs use the established generator so there is only one index format.
  // Scoped to the affected index paths — regenerateIndexes() would otherwise rewrite every
  // index in the wiki on every pass, and _finalizeWiki already does the unfiltered pass once.
  var indexIssues = issues.filter(function(i) { return i.type === "missing_index" || i.type === "index_missing_links" || i.type === "stale_index" || i.type === "structural_orphan" })
  if (indexIssues.length > 0) {
    // Include every ancestor index up to root, not just the paths lint flagged this pass:
    // a brand-new nested section only reveals its parent's missing_index/index_missing_links
    // issue once the child index.md actually exists, so without the ancestor chain a deep
    // tree needs one repair pass per level to reach root. Adding ancestors here reaches root
    // in a single regenerateIndexes() call, same as the old unfiltered behavior.
    var indexPaths = {}
    indexIssues.forEach(function(issue) {
      var p = issue.type === "structural_orphan" ? issue.parent : issue.page
      indexPaths[p] = true
      var dir = p.replace(/[^\/]*$/, "")
      while (dir.length > 0) { dir = dir.replace(/[^\/]*\/$/, ""); indexPaths[dir + "index.md"] = true }
    })
    var reg = wm.regenerateIndexes({ paths: Object.keys(indexPaths) })
    indexIssues.forEach(function(issue) {
      var indexPath = issue.type === "structural_orphan" ? issue.parent : issue.page
      if (isMap(reg) && isArray(reg.regenerated) && reg.regenerated.indexOf(indexPath) >= 0) markFixed(issue, { reason: "index-regenerated", physical_page: indexPath })
      else result.skipped.push(copyIssue(issue, { reason: "index-unchanged" }))
    })
  }
  result.pages_changed = Object.keys(changedPages).length
  return result
}

// _runWikiRepairLoop: repeatedly calls _repairWikiLint, re-linting only when a pass actually
// changed pages, up to maxPasses. Shared by apply mode, reorg's post-agent cleanup, and the
// standalone repair mode so the convergence/aggregation logic exists in one place. lintFn is
// called to get a fresh lint result between passes — never on the last permitted pass, since
// that result would just be discarded when the loop ends.
MiniADreams.prototype._runWikiRepairLoop = function(wm, initialLint, lintFn, maxPasses, repairOpts) {
  var self = this
  var passesBound = isNumber(maxPasses) && maxPasses > 0 ? Math.round(maxPasses) : 1
  var allRepairs = { fixed: [], skipped: [], candidates: [], pages_changed: 0 }
  var changedPageSet = {}, passes = 0, currentLint = initialLint
  for (var i = 0; i < passesBound; i++) {
    var issueCount = isMap(currentLint) && isArray(currentLint.issues) ? currentLint.issues.length : 0
    self._log("[dreams:wiki] Repair pass " + (i + 1) + "/" + passesBound + " — " + issueCount + " issue(s) to consider")
    var passRepairs = self._repairWikiLint(wm, currentLint, repairOpts || {})
    passes++
    allRepairs.fixed = allRepairs.fixed.concat(passRepairs.fixed)
    allRepairs.skipped = allRepairs.skipped.concat(passRepairs.skipped)
    allRepairs.candidates = allRepairs.candidates.concat(passRepairs.candidates)
    passRepairs.fixed.forEach(function(issue) { if (isString(issue.page)) changedPageSet[issue.page] = true })
    self._log("[dreams:wiki] Repair pass " + (i + 1) + "/" + passesBound + " complete — " +
      passRepairs.fixed.length + " fixed, " + passRepairs.skipped.length + " skipped, " +
      passRepairs.pages_changed + " page(s) changed")
    if (passRepairs.pages_changed === 0 || i === passesBound - 1) break
    currentLint = lintFn()
  }
  allRepairs.pages_changed = Object.keys(changedPageSet).length
  // A persistently-unresolvable issue (e.g. a genuinely broken anchor, or a page still
  // ambiguous) is re-emitted on every pass that re-lints it, once per pass — dedup by full
  // issue identity (not just type+page+target, which would wrongly collapse e.g. distinct
  // missing_frontmatter fields on the same page into one entry) so a caller's count reflects
  // distinct issues, not repeated re-detections of the same one. Keeps the last (most
  // informative) occurrence of each key.
  var dedupKey = function(i) {
    return [i.type, i.page || "", i.target || "", i.field || "", i.line || "", i.parent || ""].join("|")
  }
  var dedupList = function(arr) {
    var seen = {}, out = []
    arr.forEach(function(i) {
      var k = dedupKey(i), idx = seen[k]
      if (isUnDef(idx)) { seen[k] = out.length; out.push(i) }
      else out[idx] = i
    })
    return out
  }
  allRepairs.fixed = dedupList(allRepairs.fixed)
  allRepairs.skipped = dedupList(allRepairs.skipped)
  allRepairs.candidates = dedupList(allRepairs.candidates)
  return { repairs: allRepairs, passes: passes }
}

// _finalizeWiki: the deterministic post-pass every write-mode wiki dream ends with, so a
// dreamt wiki is always left reorganized, reindexed and re-linked:
//   1. regenerate root + section index.md from live page metadata
//   2. rebuild the metadata shards and the full-text index
//   3. rebuild the knowledge graph
// Returns a report; never throws (a finalize failure must not lose the apply results).
MiniADreams.prototype._finalizeWiki = function(wm, result, options) {
  var self = this
  var opts = isMap(options) ? options : {}
  var report = { ok: true, indexes_regenerated: 0, reindexed: false, graph: "skipped", errors: [] }
  if (!isObject(wm)) return { ok: false, errors: ["no wiki manager"] }

  self._log("[dreams:wiki] Finalizing wiki (indexes, search, graph)...")

  try {
    var tIdx = Date.now()
    var reg = wm.regenerateIndexes()
    if (isMap(reg) && isArray(reg.regenerated)) {
      report.indexes_regenerated = reg.regenerated.length
      if (isMap(result)) result.indexes_updated += reg.regenerated.length
      self._log("[dreams:wiki] Regenerated " + reg.regenerated.length + " index pages in " + ((Date.now() - tIdx) / 1000).toFixed(1) + "s.")
    } else if (isMap(reg) && isString(reg.error)) {
      report.errors.push("indexes: " + reg.error)
    }
  } catch(eIdx) {
    report.errors.push("indexes: " + __miniAErrMsg(eIdx))
  }

  try {
    var tRe = Date.now()
    var ri = wm.reindex()
    report.reindexed = isMap(ri) && ri.ok === true
    if (!report.reindexed && isMap(ri) && isString(ri.error)) report.errors.push("reindex: " + ri.error)
    else self._log("[dreams:wiki] Search index rebuilt in " + ((Date.now() - tRe) / 1000).toFixed(1) + "s.")
  } catch(eRe) {
    report.errors.push("reindex: " + __miniAErrMsg(eRe))
  }

  if (self._wikiGraphEnabled()) {
    try {
      var tG = Date.now()
      var semanticOn = self._effectiveWikiGraphSemantic(opts.mode)
      var gr = wm.graph("build", { semantic: semanticOn, onProgress: semanticOn ? self._wikiGraphProgressFn() : __ })
      report.graph = isMap(gr) && gr.ok === false ? ("failed: " + gr.error) : "rebuilt"
      if (report.graph === "rebuilt") self._log("[dreams:wiki] Knowledge graph rebuilt in " + ((Date.now() - tG) / 1000).toFixed(1) + "s.")
    } catch(eG) {
      report.graph = "failed"
      report.errors.push("graph: " + __miniAErrMsg(eG))
    }
  }

  if (opts.appendLog !== false) {
    try {
      wm.appendLog("dream", "finalize", report.indexes_regenerated + " indexes regenerated, reindex=" + report.reindexed + ", graph=" + report.graph)
    } catch(eL) {}
  }

  report.ok = report.errors.length === 0
  return report
}

// _wikiGraphEnabled: mirrors the runtime check in mini-a.js — usewikigraph, or a configured
// FalkorDB host, turns the knowledge graph on.
MiniADreams.prototype._wikiGraphEnabled = function() {
  var a = this._args
  return toBoolean(a.usewikigraph) === true ||
         (isString(a.wikigraphfalkorhost) && a.wikigraphfalkorhost.trim().length > 0)
}

// _effectiveWikiGraphSemantic: wikigraphsemantic is opt-in everywhere except for the
// deterministic apply/plan passes, where it defaults to true once usewikigraph is on
// (an explicit wikigraphsemantic=false still overrides). apply/plan already spend the I/O
// to walk every page for structural graph work, so folding in the LLM-driven semantic pass
// there is cheap incremental value; reorg/graph stay opt-in since they're already
// LLM-driven (reorg) or meant as a cheap structural-only rebuild (graph).
MiniADreams.prototype._effectiveWikiGraphSemantic = function(mode) {
  if (isDef(this._args.wikigraphsemantic)) return toBoolean(this._args.wikigraphsemantic) === true
  return (mode === "apply" || mode === "plan") && this._wikiGraphEnabled()
}

// _argStr: string args may arrive as java.lang.String (e.g. from getCanonicalPath()), for
// which isString() is false. Coercing here stops wikiroot from silently defaulting to "."
// and dreaming the current working directory.
MiniADreams.prototype._argStr = function(value) {
  if (isUnDef(value) || value === null) return ""
  if (isString(value)) return value.trim()
  if (isJavaObject(value) || isDef(value.getClass)) return String(value).trim()
  return ""
}

MiniADreams.prototype._buildWikiConfig = function() {
  var a = this._args
  if (!toBoolean(a.usewiki)) return __
  var backend = this._argStr(a.wikibackend).length > 0 ? this._argStr(a.wikibackend).toLowerCase() : "fs"
  if (backend === "https") backend = "http"
  var cfg = { access: "rw", backend: backend, indexdir: a.wikiindexdir, s3artifactprefix: a.wikis3artifactprefix, s3artifactbundle: toBoolean(a.s3artifactbundle) === true, wikihttpindexurl: a.wikihttpindexurl, wikihttptimeout: a.wikihttptimeout, wikiartifactrefreshsecs: a.wikiartifactrefreshsecs, wikilexical: a.wikilexical }
  // carry graph settings so _finalizeWiki can rebuild the knowledge graph.
  // The user-facing arg is usewikigraph (usegraph is the wiki-manager config key).
  if (this._wikiGraphEnabled()) {
    cfg.usegraph = true
    // Wire a real LLM extractor when a model is configured (model= or OAF_MODEL), so
    // wikigraphsemantic=true does genuine LLM-based relationship extraction here too, not just
    // in an interactive agent session. Left unset (MiniAWikiGraph's own deterministic
    // heuristic fallback applies) when no model is available — semantic build then still runs,
    // just without an LLM, same as before this was wired up.
    var graphLlm = this._buildLlm()
    if (isObject(graphLlm)) {
      var self = this
      cfg.llmExtractFn = function(payload) { return self._graphLlmExtract(graphLlm, payload) }
    }
    if (isString(a.wikigraphcommunity)) cfg.wikigraphcommunity = a.wikigraphcommunity
    if (isString(a.wikigraphautosave))  cfg.wikigraphautosave  = a.wikigraphautosave
    if (isString(a.wikigraphfalkorhost) && a.wikigraphfalkorhost.trim().length > 0) {
      cfg.wikigraphfalkor = {
        host : a.wikigraphfalkorhost,
        port : a.wikigraphfalkorport,
        graph: a.wikigraphfalkorgraph,
        user : a.wikigraphfalkoruser,
        pass : a.wikigraphfalkorpass
      }
    }
  }
  if (backend === "fs") {
    cfg.root = this._argStr(a.wikiroot).length > 0 ? this._argStr(a.wikiroot) : "."
    // apply mode writes; make an implicit "dream the current directory" impossible to miss
    if (cfg.root === ".") this._log("[dreams:wiki] No wikiroot given — using the current directory as the wiki root.")
  } else if (backend === "s3" || backend === "s3fs") {
    cfg.bucket     = a.wikibucket
    cfg.prefix     = this._argStr(a.wikiprefix).length > 0 ? this._argStr(a.wikiprefix) : "wiki/"
    cfg.url        = this._argStr(a.wikiurl).length > 0 ? this._argStr(a.wikiurl) : "https://s3.amazonaws.com"
    cfg.accessKey  = a.wikiaccesskey
    cfg.secret     = a.wikisecret
    cfg.region     = a.wikiregion
    cfg.useVersion1 = toBoolean(a.wikiuseversion1) === true
    cfg.ignoreCertCheck = toBoolean(a.wikiignorecertcheck) === true
  } else if (backend === "es") {
    cfg.esurl   = this._argStr(a.wikiurl).length > 0 ? this._argStr(a.wikiurl) : "http://localhost:9200"
    cfg.esindex = this._argStr(a.wikiprefix).length > 0 ? this._argStr(a.wikiprefix) : "mini_a_wiki"
    cfg.esuser  = a.wikiaccesskey
    cfg.espass  = a.wikisecret
  } else if (backend === "http") {
    cfg.url       = this._argStr(a.wikiurl)
    cfg.accessKey = a.wikiaccesskey
    cfg.secret    = a.wikisecret
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
    self._log("  dreamwikimode=  Wiki mode: plan, apply (default), reorg, repair, reindex, graph, indexes")
    self._log("  dreammemorymode=Memory mode: plan, apply")
    self._log("  dreamwikidryrun=true  Propose without writing (opt-out of apply)")
    self._log("  dreamwikireorg= Enable the agent-driven structural reorg mode (true/false)")
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
