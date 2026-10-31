// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Shared helpers for utils/wikiHydrate.yaml and utils/wikiDream.yaml.
//   Both jobs need only a wiki root (plus a source folder for hydration); everything else
//   comes from a mode preset (default poweruser), environment defaults or explicit args.
//   Libraries are loaded from the repository/opack that contains this file, so running
//   `ojob /path/to/mini-a/utils/wikiDream.yaml ...` from any directory uses that copy.

var __wikiJobsRoot = String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent())

var WIKI_JOBS_DEFAULT_LEXICAL = "(language: english, ngrams: true, shingles: true, queryExpansion: true, pseudoRelevanceFeedback: true)"
// Dream modes that can change pages and therefore get a pre-run backup.
var WIKI_JOBS_MUTATING_DREAMS = { reorg: true, apply: true, repair: true, auto: true }
var WIKI_JOBS_DREAM_MODES = ["auto", "plan", "apply", "reorg", "repair", "reindex", "graph", "indexes"]
// Job-level controls translated into Mini-A args; never forwarded verbatim.
var WIKI_JOBS_CONTROL_KEYS = { source: true, semantic: true, dreamsemantic: true, prune: true, dryrun: true, compact: true,
  backup: true, dream: true, organize: true, instructions: true, mode: true, objid: true, execid: true, init: true }

// Java strings (e.g. from getCanonicalPath()) fail isString(); see mini-a-dreams.js _argStr.
var wikiJobsStr = function(value) {
  if (isUnDef(value) || value === null) return ""
  if (isString(value)) return value.trim()
  if (isNumber(value) || isBoolean(value)) return String(value)
  if (isJavaObject(value) || isDef(value.getClass)) return String(value).trim()
  return ""
}

// Load mini-a libraries from this copy and register them under the bare names other
// libraries use with loadLib(), so those calls do not pick up another installed copy.
var wikiJobsLoadLibs = function(names) {
  names.forEach(function(name) {
    var key = name.toLowerCase()
    if (isDef(__loadedLibs[key]) && __loadedLibs[key] != 0) return
    load(__wikiJobsRoot + "/" + name)
    __loadedLibs[key] = true
  })
}

// Timestamped output through OpenAF's log functions. Ingest/dream progress arrives as strings;
// dream model output arrives as maps, where per-token stream chunks are dropped (one
// timestamped line per token would be unreadable) and complete answers are logged.
var wikiJobsLog = function(msg) {
  if (isMap(msg)) {
    if (msg.type !== "dream-model-output" || msg.event === "stream" || msg.event === "planner_stream") return
    var text = isString(msg.text) ? msg.text.trim() : ""
    if (text.length > 0) log(text)
    return
  }
  var line = isDef(msg) && msg !== null ? String(msg) : ""
  if (/^\s*(⚠️|WARNING)/.test(line)) logWarn(line); else log(line)
}

var wikiJobsBool = function(value, dflt) {
  var s = wikiJobsStr(value)
  if (s.length === 0) return dflt
  return toBoolean(s) === true
}

var wikiJobsEnv = function(name) {
  try { return String(getEnv(name) || "").trim() } catch(e) { return "" }
}

var wikiJobsCanonical = function(path) {
  return String(new java.io.File(path).getCanonicalPath())
}

// Build the Mini-A args for a job. Layers, lowest to highest precedence:
//   mode preset params < job defaults < explicit CLI args < enforced settings.
// opts: { kind: "hydrate"|"dream", log: fn, createRoot: boolean, homeDir: preset home override }
var wikiJobsPrepare = function(args, opts) {
  opts = opts || {}
  var logFn = isFunction(opts.log) ? opts.log : wikiJobsLog
  if (!isMap(args)) args = {}

  var root = wikiJobsStr(args.wikiroot)
  if (root.length === 0) throw "wikiroot is mandatory"
  var rootFile = new java.io.File(root)
  if (!rootFile.exists()) {
    if (opts.createRoot !== true) throw "Wiki directory not found: " + root + ". Hydrate it first."
    io.mkdir(root)
  }
  if (!rootFile.isDirectory()) throw "Wiki root is not a directory: " + root
  root = wikiJobsCanonical(root)

  var a = {}
  var modeName = isDef(args.mode) ? wikiJobsStr(args.mode) : "poweruser"
  if (modeName.length > 0 && modeName.toLowerCase() !== "none") {
    if (typeof __miniAResolveModePreset === "undefined") wikiJobsLoadLibs(["mini-a-common.js"])
    var preset = __miniAResolveModePreset(modeName, { basePath: __wikiJobsRoot, homeDir: opts.homeDir })
    preset.warnings.forEach(function(w) { logFn("⚠️  " + w) })
    Object.keys(preset.params).forEach(function(k) {
      var v = preset.params[k]
      a[k] = (isObject(v) || isArray(v)) ? af.toSLON(v) : v
    })
    a.mode = preset.key
    logFn("🎛️  Mode '" + preset.key + "'" + (preset.description.length > 0 ? ": " + preset.description : ""))
  }

  var lexical = wikiJobsEnv("OAF_MINI_A_WIKI_LEXICAL")
  var retrievalConfig = wikiJobsEnv("OAF_MINI_A_WIKI_RETRIEVAL_CONFIG")
  a.usewikigraph = true
  a.wikiretrievalv2 = true
  a.wikitelemetry = true
  a.wikilexical = lexical.length > 0 ? lexical : WIKI_JOBS_DEFAULT_LEXICAL
  if (retrievalConfig.length > 0) a.wikiretrievalconfig = retrievalConfig

  Object.keys(args).forEach(function(k) {
    if (WIKI_JOBS_CONTROL_KEYS[k] || k.indexOf("__") === 0 || isUnDef(args[k])) return
    a[k] = isJavaObject(args[k]) ? String(args[k]) : args[k]
  })

  // Semantic graph evaluation is strictly opt-in: always pass an explicit boolean, because
  // MiniADreams turns it on for apply/plan when wikigraphsemantic is left undefined.
  var semantic = wikiJobsBool(isDef(args.semantic) ? args.semantic : args.wikigraphsemantic, false)
  a.wikigraphsemantic = semantic
  a.usewiki = true
  a.wikibackend = "fs"
  a.wikiaccess = "rw"
  a.wikiroot = root
  if (isDef(a.mode)) a.__modeApplied = true

  return {
    args: a,
    root: root,
    semantic: semantic,
    dryrun: wikiJobsBool(args.dryrun, false),
    compact: wikiJobsBool(args.compact, true),
    backup: wikiJobsBool(args.backup, true)
  }
}

// Ingestion args on top of the prepared ones.
var wikiJobsIngestArgs = function(prepared, args) {
  var source = wikiJobsStr(args.source)
  if (source.length === 0) source = wikiJobsStr(args.ingestsource)
  if (source.length === 0) throw "source (the folder to ingest) is mandatory"
  var remote = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || /^[^@\s]+@[^:\s]+:/.test(source)
  if (!remote) {
    var f = new java.io.File(source)
    if (!f.isDirectory()) throw "Source directory not found: " + source
    source = wikiJobsCanonical(source)
    if (source === prepared.root || prepared.root.indexOf(source + java.io.File.separator) === 0 || source.indexOf(prepared.root + java.io.File.separator) === 0)
      throw "The source folder and the wiki root must not contain each other"
  }
  var a = merge({}, prepared.args)
  a.ingestsource = source
  if (isUnDef(a.ingestmode)) a.ingestmode = "auto"
  if (isUnDef(a.ingestlayout)) a.ingestlayout = "source"
  if (isUnDef(a.wikimaxprompttokens)) a.wikimaxprompttokens = 200000
  if (isDef(args.prune)) a.ingestprune = wikiJobsBool(args.prune, false)
  if (prepared.dryrun) a.ingestdryrun = true
  return a
}

// Dream args on top of the prepared ones.
var wikiJobsDreamArgs = function(prepared, args, defaultSemantic) {
  var a = merge({}, prepared.args)
  var mode = wikiJobsStr(a.dreamwikimode).toLowerCase()
  if (mode.length === 0) mode = "reorg"
  if (WIKI_JOBS_DREAM_MODES.indexOf(mode) < 0) throw "Unknown dreamwikimode '" + mode + "' (expected one of " + WIKI_JOBS_DREAM_MODES.join(", ") + ")"
  a.dream = true
  a.dreammode = "wiki"
  a.dreamwikimode = mode
  if (mode === "reorg") {
    a.dreamwikireorg = true
    if (isUnDef(args.dreamwikiapproval)) a.dreamwikiapproval = "auto"
  }
  if (isDef(args.organize)) a.dreamwikiorganize = wikiJobsStr(args.organize)
  if (isDef(args.instructions)) a.dreamwikiinstructions = wikiJobsStr(args.instructions)
  if (prepared.dryrun) a.dreamwikidryrun = true
  var semantic = isDef(args.dreamsemantic) ? wikiJobsBool(args.dreamsemantic, false) : (isBoolean(defaultSemantic) ? defaultSemantic : prepared.semantic)
  a.wikigraphsemantic = semantic
  return a
}

// Zip the whole wiki (hidden index/graph directories included, symlinks skipped) to a
// sibling <root>.predream-<timestamp>.zip. Returns the zip path; throws on failure.
var wikiJobsBackup = function(root, logFn) {
  logFn = isFunction(logFn) ? logFn : wikiJobsLog
  var stamp = new Date().toISOString().replace(/[:.]/g, "-")
  var zipPath = root + ".predream-" + stamp + ".zip"
  var rootPath = java.nio.file.Paths.get(root)
  var out = new java.util.zip.ZipOutputStream(new java.io.BufferedOutputStream(new java.io.FileOutputStream(zipPath)))
  var count = 0
  try {
    var walk = function(dir) {
      var entries = dir.listFiles()
      if (entries === null) return
      var list = []
      for (var i = 0; i < entries.length; i++) list.push(entries[i])
      list.sort(function(x, y) { return String(x.getName()).localeCompare(String(y.getName())) })
      list.forEach(function(f) {
        if (java.nio.file.Files.isSymbolicLink(f.toPath())) return
        var rel = String(rootPath.relativize(f.toPath())).replace(/\\/g, "/")
        if (f.isDirectory()) {
          out.putNextEntry(new java.util.zip.ZipEntry(rel + "/"))
          out.closeEntry()
          walk(f)
          return
        }
        out.putNextEntry(new java.util.zip.ZipEntry(rel))
        java.nio.file.Files.copy(f.toPath(), out)
        out.closeEntry()
        count++
      })
    }
    walk(new java.io.File(root))
    out.close()
  } catch(e) {
    try { out.close() } catch(ignoreClose) {}
    try { io.rm(zipPath) } catch(ignoreRm) {}
    throw "Pre-dream backup failed (dream not started): " + e
  }
  logFn("🗄️  Backup of " + count + " file(s) written to " + zipPath)
  return zipPath
}

var wikiJobsRunIngest = function(ingestArgs, logFn) {
  global.__mini_a_ingest_lib_mode = true
  global.__mini_a_dreams_lib_mode = true
  wikiJobsLoadLibs(["mini-a-common.js", "mini-a-ingest.js"])
  var res = new MiniAIngest(ingestArgs, logFn).run()
  return isMap(res) ? res : { ok: false, error: "ingestion returned no result" }
}

var wikiJobsRunDream = function(dreamArgs, logFn) {
  global.__mini_a_dreams_lib_mode = true
  wikiJobsLoadLibs(["mini-a-common.js", "mini-a-dreams.js"])
  var res = new MiniADreams(dreamArgs, logFn).run()
  return isMap(res) ? res : { ok: false, error: "dream returned no result" }
}

var wikiJobsCompact = function(root, a, logFn) {
  wikiJobsLoadLibs(["mini-a-common.js", "mini-a-wiki.js"])
  var wm = new MiniAWikiManager({ backend: "fs", root: root, access: "rw", wikiretrievalv2: true, wikilexical: a.wikilexical, wikiretrievalconfig: a.wikiretrievalconfig })
  try {
    return wm.compact({ dryRun: false, offline: true })
  } finally {
    wm.close()
  }
}

// Run an optional backup, the dream and report. Returns the dream result.
var wikiJobsDreamStage = function(prepared, dreamArgs, logFn) {
  var mode = dreamArgs.dreamwikimode
  if (prepared.backup && !prepared.dryrun && WIKI_JOBS_MUTATING_DREAMS[mode] === true) {
    dreamArgs.__backup = wikiJobsBackup(prepared.root, logFn)
  }
  logFn("💤 Dreaming (" + mode + (dreamArgs.wikigraphsemantic ? ", semantic graph" : "") + (prepared.dryrun ? ", dry-run" : "") + "): " + prepared.root)
  var backupPath = dreamArgs.__backup
  delete dreamArgs.__backup
  var res = wikiJobsRunDream(dreamArgs, logFn)
  if (isDef(backupPath)) res.backup = backupPath
  if (res.partial === true) logFn("⚠️  Dream finished partially; check the output above.")
  return res
}

var wikiJobsCompactStage = function(prepared, logFn) {
  if (!prepared.compact || prepared.dryrun) return __
  logFn("🧹 Compacting the wiki serving index (offline)...")
  var res = wikiJobsCompact(prepared.root, prepared.args, logFn)
  if (!isMap(res) || res.ok !== true) throw { stage: "compact", result: res }
  return res
}

var wikiJobsReaderHint = function(prepared, logFn) {
  logFn("📖 Readers need wikiretrievalv2=true and wikilexical=" + prepared.args.wikilexical)
}

// Print a stage failure and exit 1.
var wikiJobsFail = function(stage, detail, backup) {
  logErr("❌ " + stage + " failed" + (isDef(detail) ? ": " + (isString(detail) ? detail : stringify(detail, __, "")) : ""))
  if (isDef(backup)) logWarn("🗄️  Pre-dream backup: " + backup)
  exit(1)
}
