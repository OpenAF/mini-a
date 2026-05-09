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
  try { this._logFn(msg) } catch(ignoreLogErr) {}
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

MiniADreams.prototype._readAuditRecords = function(chName, maxRecords) {
  var max = isNumber(maxRecords) && maxRecords > 0 ? maxRecords : 200
  var keys = []
  try { keys = $ch(chName).getKeys() } catch(ignoreGetKeys) { return [] }
  var records = []
  for (var i = 0; i < keys.length; i++) {
    try {
      var rec = $ch(chName).get(keys[i])
      if (isMap(rec)) records.push(rec)
    } catch(ignoreGet) {}
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
  var isDryRun = toBoolean(self._args.dryrun) === true
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
      return { ok: true, dryRun: true, before: totalBefore, after: totalAfter, staleMarked: staleCount }
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

    if (isFunction(saveMgr.restoreSnapshot)) {
      saveMgr.restoreSnapshot(normalizedSnapshot)
    } else if (isFunction(saveMgr.loadSnapshot)) {
      saveMgr.loadSnapshot(normalizedSnapshot)
    } else if (isFunction(saveMgr.importSnapshot)) {
      saveMgr.importSnapshot(normalizedSnapshot)
    } else {
      saveMgr._memory = {
        entries   : [],
        updatedAt : normalizedSnapshot.updatedAt,
        revision  : normalizedSnapshot.revision
      }

      var entries = isArray(normalizedSnapshot.entries) ? normalizedSnapshot.entries : []
      entries.forEach(function(entry) {
        if (isFunction(saveMgr.setEntries)) {
          saveMgr.setEntries([ entry ])
        } else if (isFunction(saveMgr.addMemory)) {
          saveMgr.addMemory(entry)
        } else if (isFunction(saveMgr.remember)) {
          saveMgr.remember(entry)
        } else if (isFunction(saveMgr.upsert)) {
          saveMgr.upsert(entry)
        } else {
          throw "MiniAMemoryManager does not expose a supported snapshot/entry import API for normalized persistence."
        }
      })

      if (isDef(saveMgr._memory)) {
        saveMgr._memory.updatedAt = normalizedSnapshot.updatedAt
        saveMgr._memory.revision  = normalizedSnapshot.revision
      }
    }

    var saved = saveMgr.saveToChannel(chName, ns)
    if (saved) {
      self._log("[dreams:memory:" + label + "] Written to channel '" + chName + "' (ns='" + ns + "').")
    } else {
      self._log("[dreams:memory:" + label + "] WARNING: saveToChannel returned false.")
    }
    return { ok: saved, before: totalBefore, after: totalAfter, staleMarked: staleCount }
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
  return { ok: true, results: results }
}

// ── wiki dream ────────────────────────────────────────────────

var _WIKI_DREAM_GOAL =
  "You are running a wiki dream consolidation pass. Your task is to produce a clean, well-organised wiki.\n\n" +
  "Follow these steps in order:\n" +
  "1. Use wiki action with op=\"lint\" to get all current issues.\n" +
  "2. For each near_duplicate pair: use wiki op=\"read\" on both pages, write a merged version to the primary page (keeping the richer content), then delete the duplicate. Fix any links in other pages that pointed to the deleted page.\n" +
  "3. For each broken_link issue: use wiki op=\"read\" on the affected page, correct or remove the broken link target, use wiki op=\"write\" to save.\n" +
  "4. For each missing_frontmatter issue: use wiki op=\"read\" on the page, add the missing field(s) (title, description, created, updated) with sensible inferred values, then write the page.\n" +
  "5. For each heading_hierarchy violation: use wiki op=\"read\", fix the heading levels so they follow h1→h2→h3 order, write back.\n" +
  "6. For each orphan page (excluding index.md and AGENTS.md): link it from AGENTS.md or the most related existing page.\n" +
  "7. Re-run wiki op=\"lint\" to confirm zero errors and zero warnings remain. Info items are acceptable.\n" +
  "8. Finish with action=\"final\" and include in your answer a summary with keys: pages_changed, pages_deleted, issues_fixed."

MiniADreams.prototype.dreamWiki = function(opts) {
  var self = this
  var isDryRun = toBoolean(self._args.dryrun) === true

  if (!toBoolean(self._args.usewiki)) {
    self._log("[dreams:wiki] usewiki is not set. Skipping wiki dream.")
    return { ok: false, reason: "usewiki-not-set" }
  }

  if (isDryRun) {
    // For wiki dry-run, just run lint and report what would be fixed — no writes.
    self._log("💤 [dreams] Wiki dream dry-run: running lint only...")
    var wikiCfg = self._buildWikiConfig()
    if (!isMap(wikiCfg)) {
      self._log("[dreams:wiki] Cannot build wiki config. Skipping.")
      return { ok: false, reason: "no-wiki-config" }
    }
    try {
      var wm = new MiniAWikiManager(wikiCfg, function(level, msg) {
        self._log("[dreams:wiki:lint] " + msg)
      })
      var staleDays = isNumber(self._args.wikilintstaleddays) ? self._args.wikilintstaleddays : Number(self._args.wikilintstaleddays)
      if (isNaN(staleDays)) staleDays = 90
      var lintResult = wm.lint(__, { staleDays: staleDays })
      self._log("[dreams:wiki] Lint baseline: " + lintResult.summary.pages + " pages, " +
        lintResult.summary.errors + " errors, " + lintResult.summary.warnings + " warnings, " +
        lintResult.summary.info + " info.")
      lintResult.issues.forEach(function(iss) {
        self._log("  [" + iss.severity.toUpperCase() + "] " + iss.type + " — " + iss.page)
      })
      self._log("[dreams:wiki] Dry-run complete — no changes applied.")
      return { ok: true, dryRun: true, lint: lintResult.summary }
    } catch(wikiDryErr) {
      self._log("[dreams:wiki] Lint error: " + __miniAErrMsg(wikiDryErr))
      return { ok: false, reason: "lint-error", error: __miniAErrMsg(wikiDryErr) }
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
    var agent = new MiniA()
    agent.setInteractionFn(function(event, message) {
      agent.defaultInteractionFn(event, message, function(icon, text) {
        self._log("[dreams:wiki] " + (icon ? icon + " " : "") + text)
      })
    })
    agent.init(dreamArgs)
    var result = agent.start(dreamArgs)
    self._log("💤 [dreams] Wiki dream complete.")
    return { ok: true, result: isString(result) ? result.substring(0, 500) : String(result || "").substring(0, 500) }
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
  var hasMemory = isString(self._args.memorych) && self._args.memorych.trim().length > 0
  var hasWiki   = toBoolean(self._args.usewiki) === true

  if (!hasMemory && !hasWiki) {
    self._log("Usage: mini-a dream=true [memorych=<JSSLON>] [auditch=<JSSLON>] [usewiki=true wikiroot=<path>] [model=<JSSLON>] [dryrun=true]")
    self._log("  memorych=       JSSLON global memory channel definition (required for memory dream)")
    self._log("  memorysessionch=JSSLON session memory channel")
    self._log("  memorysessionid=Session namespace string")
    self._log("  auditch=        JSSLON audit channel (optional, surfaces insights)")
    self._log("  usewiki=true    Enable wiki dream")
    self._log("  wikiroot=       Wiki filesystem root path")
    self._log("  model=          JSSLON model config e.g. '{\"type\":\"anthropic\",\"model\":\"claude-sonnet-4-6\"}'")
    self._log("  dryrun=true     Report what would change without writing")
    self._log("  dreammaxsteps=  Maximum agent steps for wiki dream pass (default: 60)")
    java.lang.System.exit(1)
    return
  }

  var overall = { ok: true }
  if (hasMemory) {
    var memResult = self.dreamMemory()
    overall.memory = memResult
    if (!memResult.ok) overall.ok = false
    if (memResult.partial === true) overall.partial = true
  }
  if (hasWiki) {
    var wikiResult = self.dreamWiki()
    overall.wiki = wikiResult
    if (!wikiResult.ok) overall.ok = false
    if (wikiResult.partial === true) overall.partial = true
  }
  return overall
}

// ─────────────────────────────────────────────────────────────
// Standalone entry point — skipped when loaded as a library
// (set global.__mini_a_dreams_lib_mode = true before loadLib to suppress)
// ─────────────────────────────────────────────────────────────

if (!toBoolean(global.__mini_a_dreams_lib_mode)) {
  var _dreams = new MiniADreams(args, log)
  _dreams.run()
}
