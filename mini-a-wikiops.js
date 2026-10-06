// Shared, model-free operation catalogue for the wiki TUI and noninteractive job.
loadLib("mini-a-common.js")
loadLib("mini-a-wiki.js")

var MiniAWikiOps = function(args, logFn) {
  this.args = MiniAWikiOps.settings(args || {})
  this.log = logFn || function() {}
}

MiniAWikiOps.settings = function(args) {
  var out = {}
  Object.keys(args).forEach(function(k) {
    if (/^(wiki|dream|ingest|absorb)/.test(k) || ["usewiki", "usewikigraph", "s3artifactbundle", "model", "secpass", "libs", "maxcontext", "contextguard", "toolresultmaxinline", "readresultmaxmatches", "editor"].indexOf(k) >= 0) out[k] = args[k]
  })
  delete out.wikiman
  delete out.wikimanager
  out.usewiki = true
  out.wikiaccess = String(out.wikiaccess || "ro").toLowerCase()
  if (["ro", "rw"].indexOf(out.wikiaccess) < 0) throw new Error("wikiaccess must be ro or rw")
  ;["dreammaxsteps", "maxcontext", "toolresultmaxinline", "readresultmaxmatches"].forEach(function(k) {
    if (isDef(out[k])) {
      var value = Number(out[k])
      if (!isFinite(value) || value <= 0 || Math.floor(value) !== value) throw new Error("Expected positive integer setting: " + k)
      out[k] = value
    }
  })
  var backend = String(out.wikibackend || "fs")
  if (["fs", "s3fs"].indexOf(backend) >= 0 && isString(out.wikiroot) && out.wikiroot.trim()) out.wikiroot = MiniAWikiOps.absolute(out.wikiroot)
  if (isString(out.wikiindexdir) && out.wikiindexdir.trim()) out.wikiindexdir = MiniAWikiOps.absolute(out.wikiindexdir)
  if (isDef(out.wikimounts)) out.wikimounts = __miniAWikiPrimaryConfig({}, out.wikiroot, out.wikimounts).__primaryMounts.map(function(mount) {
    var m = clone(mount)
    if (["fs", "s3fs"].indexOf(String(m.backend || "fs")) >= 0 && m.root) m.root = MiniAWikiOps.absolute(m.root)
    if (m.indexdir) m.indexdir = MiniAWikiOps.absolute(m.indexdir)
    return m
  })
  return out
}

MiniAWikiOps.absolute = function(path) { return String(new java.io.File(String(path)).getCanonicalPath()) }
MiniAWikiOps.basePath = function() {
  return String(new java.io.File(io.fileExists("mini-a-wikiops.js") ? "." : getOPackPath("mini-a")).getCanonicalPath())
}
MiniAWikiOps.parse = function(value) {
  if (isUnDef(value) || value === "") return {}
  var result = isString(value) ? af.fromJSSLON(value) : value
  if (!isMap(result)) throw new Error("Expected a JSON/SLON object")
  return result
}
MiniAWikiOps.quote = function(value) { return "'" + String(value).replace(/'/g, "'\"'\"'") + "'" }
MiniAWikiOps.secretKey = function(key) { return /secret|password|credential|authorization|accesskey|apikey|api_key|(^|_)token$|^key$|^pass$|secpass|falkorpass|espass/i.test(key) }
MiniAWikiOps.sensitive = function(key, value) {
  if (MiniAWikiOps.secretKey(key)) return true
  if (key === "model" && (isMap(value) || /^[({]/.test(String(value)))) return true
  if (isObject(value)) return Object.keys(value).some(function(k) { return MiniAWikiOps.sensitive(k, value[k]) })
  return isString(value) && (/:\/\/[^/\s]+@/.test(value) || /(?:[?&]|["'\s({,])(?:[^\s=]*token|secret|password|accesskey|key)["']?\s*[:=]/i.test(value))
}
MiniAWikiOps.sanitize = function(value, settings) {
  var secrets = []
  function collect(v, key) {
    if (isObject(v)) Object.keys(v).forEach(function(k) { collect(v[k], k) })
    else if (isString(v) && v.length) {
      if (MiniAWikiOps.sensitive(key || "", v)) secrets.push(v)
      if (/^[({]/.test(v.trim())) {
        try { var parsed = af.fromJSSLON(v); if (isObject(parsed)) collect(parsed, key) } catch(ignore) {}
      }
    }
  }
  collect(settings || {}, "")
  function clean(v, key) {
    if (MiniAWikiOps.secretKey(key || "") || !isObject(v) && MiniAWikiOps.sensitive(key || "", v)) return "[redacted]"
    if (isArray(v)) return v.map(function(x) { return clean(x, "") })
    if (isMap(v)) { var out = {}; Object.keys(v).forEach(function(k) { out[k] = clean(v[k], k) }); return out }
    if (isString(v)) secrets.forEach(function(s) { v = v.split(s).join("[redacted]") })
    return v
  }
  return clean(value, "")
}

// Fields: name, prompt, default, type. Undefined defaults mean required input.
MiniAWikiOps.catalog = (function() {
  var ops = []
  function add(id, group, title, writes, fields, defaults, note) {
    ops.push({ id: id, group: group, title: title, writes: writes, fields: fields || [], defaults: defaults || {}, note: note || "" })
  }
  var path = ["path", "Wiki path", "", "string"]
  add("wiki.context", "Inspect", "Context and statistics", false)
  add("wiki.indexstats", "Inspect", "On-disk index statistics", false, [], { top: 10 })
  add("wiki.list", "Inspect", "List pages", false, [path], { limit: 100, offset: 0, withMeta: true })
  add("wiki.tree", "Inspect", "Tree", false, [path], { maxDepth: 3 })
  add("wiki.browse", "Inspect", "Browse a section", false, [path])
  add("wiki.read", "Inspect", "Read a page (bounded)", false, [["path", "Page path"]], { startLine: 1, maxLines: 100 })
  add("wiki.search", "Inspect", "Search", false, [["query", "Search query"]], { limit: 20 })
  add("wiki.backlinks", "Inspect", "Backlinks", false, [["path", "Page path"]])
  add("wiki.lint", "Inspect", "Lint", false, [], { limit: 50 })
  add("wiki.mounts", "Inspect", "Federation / mounts", false)
  add("wiki.init", "Pages & structure", "Initialize wiki or sub-wiki", true, [path])
  add("wiki.write", "Pages & structure", "Create / edit a page", true, [["path", "Page path"], ["contentfile", "Content file"]])
  add("wiki.move", "Pages & structure", "Move a page or section", true, [["from", "Source wiki path"], ["to", "Destination wiki path"]])
  add("wiki.delete", "Pages & structure", "Delete a page", true, [["path", "Page path"]])
  add("wiki.indexes", "Pages & structure", "Regenerate directory indexes", true)
  add("wiki.upgrade", "Pages & structure", "Upgrade wiki instructions", true)
  add("wiki.reindex", "Indexes & storage", "Rebuild search index", true)
  add("wiki.compact", "Indexes & storage", "Preview / apply compaction", true, [], { dryRun: true, offline: false }, "Apply requires all other readers and writers to be stopped.")
  ;["stats", "query", "retrieve", "answer", "neighbors", "path", "communities", "surprise", "cross", "export"].forEach(function(op) {
    var fields = []
    if (op === "query" || op === "retrieve" || op === "answer") fields = [["query", "Query"]]
    if (op === "neighbors") fields = [["node", "Node ID (for example doc:index.md)"]]
    if (op === "path") fields = [["from", "Starting node ID"], ["to", "Ending node ID"]]
    if (op === "cross") fields = [["path", "Local page path"]]
    if (op === "export") fields = [["format", "Format (json, mermaid, graphml)", "mermaid"]]
    add("graph." + op, "Graph", op === "stats" ? "Graph statistics (/graph stats)" : op, false, fields)
  })
  add("graph.filestats", "Graph", "Stored graph file diagnostics (advanced)", false, [], { top: 10 })
  add("graph.build", "Graph", "Build structural / semantic graph", true, [["semantic", "Semantic extraction", false, "boolean"]])
  add("graph.report", "Graph", "Write graph report", true)
  add("graph.falkor", "Graph", "FalkorDB query / sync (advanced)", true, [["query", "Query (blank synchronizes)", ""]], {}, "Arbitrary queries are treated as writes; database permissions still apply.")
  add("graph.html", "Graph", "Export offline HTML constellation", true, [["output", "Output HTML file"], ["title", "Title", "Wiki constellation"]])
  add("dream.auto", "Dream", "auto (preview by default)", true, [], { dryrun: true }, "Diagnose and repair identified issues, with recoverable backups and fresh-reader verification.")
  ;["plan", "apply", "repair", "reindex", "graph", "indexes", "reorg"].forEach(function(op) {
    add("dream." + op, "Dream", op, op !== "plan", op === "reorg" ? [["instructions", "Additional reorg guidance (optional)", ""]] : [], {}, op === "reorg" ? "Live agent changes; no automatic rollback. A rerun may produce different edits." : "")
  })
  add("ingest.run", "Ingestion & absorption", "Ingest sources (preview by default)", true, [["source", "Folder, repository URL or page URL"], ["section", "Destination section", ""]], { dryrun: true })
  add("ingest.recovery", "Ingestion & absorption", "List ingestion recovery", false)
  add("ingest.resume", "Ingestion & absorption", "Resume ingestion", true, [["id", "Recovery ID"]])
  add("ingest.discard", "Ingestion & absorption", "Discard ingestion recovery", true, [["id", "Recovery ID"]], {}, "Archives recovery; already-written pages are retained. This is not rollback.")
  add("absorb.plan", "Ingestion & absorption", "Plan absorption", true, [["spec", "Specification file or JSON/SLON"]], {}, "Saves a plan; does not apply page edits.")
  add("absorb.status", "Ingestion & absorption", "Absorption status", false)
  ;["show", "apply", "resume", "delete", "cancel"].forEach(function(op) {
    add("absorb." + op, "Ingestion & absorption", "Absorption: " + op, op !== "show", [["id", "Plan ID"]], {}, op === "delete" || op === "cancel" ? "Deletes the plan, not previously written pages. Pending recovery plans cannot be deleted." : "")
  })
  return ops
})()
MiniAWikiOps.operation = function(id) {
  var op = MiniAWikiOps.catalog.filter(function(o) { return o.id === id })[0]
  if (!op) throw new Error("Unknown wiki operation: " + id)
  return op
}
MiniAWikiOps.prototype.spec = function(id, params) {
  var op = MiniAWikiOps.operation(id), p = merge(clone(op.defaults), MiniAWikiOps.parse(params))
  if (id === "graph.build" && isUnDef(p.semantic)) p.semantic = toBoolean(this.args.wikigraphsemantic) === true
  op.fields.forEach(function(f) {
    if (isUnDef(p[f[0]]) && isDef(f[2])) p[f[0]] = f[2]
    if (isUnDef(p[f[0]]) || (isUnDef(f[2]) && String(p[f[0]]).trim() === "")) throw new Error("Required parameter: " + f[0])
  })
  // Parameters are operation data, never a second route to connection/access/gate overrides.
  Object.keys(p).forEach(function(k) {
    if (/^(wiki|dream|ingest|absorb|__)/.test(k) || ["confirm", "backupconfirmed", "model", "libs", "usewiki", "usewikigraph"].indexOf(k) >= 0) throw new Error("Use configuration arguments, not params, for " + k)
  })
  ;["dryRun", "dryrun", "offline", "semantic", "withMeta", "force", "prune", "allowemptyprune", "independent"].forEach(function(k) {
    if (isDef(p[k])) {
      if ([true, false, "true", "false"].indexOf(p[k]) < 0) throw new Error("Expected boolean parameter: " + k)
      p[k] = toBoolean(p[k]) === true
    }
  })
  ;["maxDepth", "maxLines", "maxChars", "startLine", "endLine", "limit", "offset"].forEach(function(k) {
    if (isDef(p[k])) {
      var n = Number(p[k])
      if (!isFinite(n) || Math.floor(n) !== n || n < (k === "offset" ? 0 : 1)) throw new Error("Expected positive integer: " + k)
      p[k] = n
    }
  })
  ;["contentfile", "output"].forEach(function(k) { if (isString(p[k]) && p[k]) p[k] = MiniAWikiOps.absolute(p[k]) })
  if (id === "ingest.run" && isString(p.source) && !/^[a-z]+:\/\/|^[^@]+@[^:]+:/i.test(p.source)) p.source = MiniAWikiOps.absolute(p.source)
  if (id === "absorb.plan" && isString(p.spec) && io.fileExists(p.spec)) p.spec = MiniAWikiOps.absolute(p.spec)
  if (id === "absorb.plan" && isMap(p.spec) && isArray(p.spec.sources)) p.spec.sources.forEach(function(source) { if (source.root) source.root = MiniAWikiOps.absolute(source.root) })
  return { operation: id, params: p }
}
MiniAWikiOps.mutates = function(spec) {
  if (spec.operation === "wiki.compact") return toBoolean(spec.params.dryRun) !== true
  if (spec.operation === "ingest.run" || spec.operation === "dream.auto") return toBoolean(spec.params.dryrun) !== true
  return MiniAWikiOps.operation(spec.operation).writes
}
MiniAWikiOps.prototype.config = function() {
  var a = this.args, backend = String(a.wikibackend || "fs").toLowerCase()
  if (["fs", "s3fs", "s3", "es", "http", "https"].indexOf(backend) < 0) throw new Error("Unsupported wiki backend: " + backend)
  var cfg = __miniAWikiPrimaryConfig(__miniAWikiConfigFromArgs(a), a.wikiroot, a.wikimounts)
  if ((backend === "fs" || backend === "s3fs") && !cfg.__catalog && !(isString(a.wikiroot) && a.wikiroot.trim())) throw new Error("Choose an explicit wikiroot; the current directory is not selected automatically")
  return cfg
}
MiniAWikiOps.prototype.targetConfig = function() {
  var cfg = this.config(), name = String(this.args.wikitarget || "").replace(/^@/, "")
  if (!name) return cfg
  var mount = cfg.__primaryMounts.filter(function(m) { return m.name === name })[0]
  if (!mount) throw new Error("Unknown mounted wiki: " + name)
  var selected = merge({}, mount)
  ;["usegraph", "wikilexical", "wikiretrievalv2", "wikiretrievalconfig"].forEach(function(k) { if (isUnDef(selected[k])) selected[k] = cfg[k] })
  Object.keys(cfg).forEach(function(k) { if (k.indexOf("wikigraph") === 0 && isUnDef(selected[k])) selected[k] = cfg[k] })
  selected.access = "ro"
  if (!(selected.backend && selected.backend !== "fs") && !selected.root) throw new Error("Mounted filesystem wiki needs a root")
  return selected
}
MiniAWikiOps.prototype.unavailable = function(spec) {
  var cfg
  try { cfg = this.targetConfig() } catch(e) { return String(e.message || e) }
  var id = spec.operation, backend = String(cfg.backend || "fs"), archive = /\.(zip|okt)$/i.test(String(cfg.root || ""))
  var writable = cfg.access === "rw" && !cfg.__catalog && backend !== "http" && backend !== "https" && !archive
  if ((MiniAWikiOps.mutates(spec) || id === "wiki.compact") && id !== "graph.html" && !(id === "absorb.plan" && this.args.absorboutput) && !writable) return "Requires a writable primary wiki; mounts, archives and HTTP wikis are read-only"
  if ((id === "wiki.compact" || id === "wiki.indexstats" || id === "graph.filestats" || id === "graph.html" || id.indexOf("absorb.") === 0) && (backend !== "fs" || archive || cfg.__catalog)) return "Requires a local filesystem wiki"
  if (id === "dream.auto" && (backend !== "fs" || archive || cfg.__catalog || this.args.wikitarget)) return "Auto requires a local primary filesystem wiki"
  if (id === "wiki.compact" && toBoolean(cfg.wikiretrievalv2) === false) return "Compaction requires Retrieval V2"
  if (id.indexOf("graph.") === 0 && id !== "graph.html" && id !== "graph.filestats" && toBoolean(cfg.usegraph) !== true) return "Enable usewikigraph=true in session settings"
  if (cfg.__catalog && (id.indexOf("dream.") === 0 || id.indexOf("ingest.") === 0 || id.indexOf("graph.") === 0 && id !== "graph.stats")) return "Select a concrete wiki target"
  return ""
}
MiniAWikiOps.prototype.command = function(spec, gates) {
  var values = merge(clone(this.args), { operation: spec.operation, params: spec.params }), required = [], self = this
  delete values.editor
  if (MiniAWikiOps.mutates(spec)) values.confirm = gates && toBoolean(gates.confirm) === true
  if (spec.operation === "dream.reorg") {
    values.backupconfirmed = gates && toBoolean(gates.backupconfirmed) === true
  }
  var parts = ["ojob", MiniAWikiOps.quote(MiniAWikiOps.basePath() + "/utils/wikiOps.yaml")]
  Object.keys(values).sort().forEach(function(k) {
    var v = values[k]
    if (isUnDef(v)) return
    var raw = isObject(v) ? JSON.stringify(v) : String(v)
    if (MiniAWikiOps.sensitive(k, v)) {
      var env = "MINIA_WIKIOPS_" + k.toUpperCase()
      required.push(env + " must contain the original " + k + " value (JSON for objects)")
      parts.push(k + '=\"${' + env + ':?Set ' + env + '}\"')
    } else parts.push(MiniAWikiOps.quote(k + "=" + raw))
  })
  if (spec.operation === "wiki.write") required.push("Keep the contentfile available; export this record to preserve edited content")
  return {
    command: "cd " + MiniAWikiOps.quote(MiniAWikiOps.basePath()) + " && " + parts.join(" "),
    displayCommand: "cd " + MiniAWikiOps.quote(MiniAWikiOps.basePath()) + " &&\n" + parts.slice(0, 2).join(" ") + " \\\n    " + parts.slice(2).join(" \\\n    "),
    prerequisites: required
  }
}
// Keep shell continuations at argument boundaries, never wrap inside quoted values.
MiniAWikiOps.formatReplay = function(replay) {
  var style = "FG(242),ITALIC"
  var out = "💻 Run the same operation from the command line:" + "\n" +
    ansiColor(style, replay.displayCommand || replay.command)
  if ((replay.prerequisites || []).length) out += "\n" + ansiColor(style, replay.prerequisites.map(function(note) { return "Prerequisite: " + note }).join("\n"))
  return out
}

MiniAWikiOps.prototype._execute = function(spec, gates) {
  var self = this, id = spec.operation, p = spec.params, op = MiniAWikiOps.operation(id), wm
  try {
    spec = this.spec(spec.operation, spec.params)
    p = spec.params
    var reason = this.unavailable(spec)
    if (reason) throw new Error(reason)
    if (MiniAWikiOps.mutates(spec) && !(gates && toBoolean(gates.confirm) === true)) throw new Error("Mutation requires confirm=true")
    if (id === "dream.reorg" && (!(gates && toBoolean(gates.backupconfirmed) === true) || toBoolean(this.args.dreamwikireorg) !== true || this.args.dreamwikiapproval !== "auto")) throw new Error("Reorg requires backupconfirmed=true, dreamwikireorg=true and dreamwikiapproval=auto")
    if (id === "wiki.compact" && MiniAWikiOps.mutates(spec) && toBoolean(p.offline) !== true) throw new Error("Compaction requires params.offline=true after stopping other readers and writers")
    var a = merge({}, this.args), cfg = this.targetConfig(), group = id.split(".")[0], action = id.split(".")[1]
    if (id === "graph.build") cfg.wikigraphsemantic = p.semantic
    delete a.wikiman; delete a.wikitarget
    if (this.args.wikitarget) {
      // Services that accept CLI arguments must receive the selected mount, never the primary.
      var mapping = { root: "wikiroot", backend: "wikibackend", access: "wikiaccess", indexdir: "wikiindexdir", bucket: "wikibucket", prefix: "wikiprefix", url: "wikiurl", accessKey: "wikiaccesskey", secret: "wikisecret", region: "wikiregion", esurl: "wikiurl", esindex: "wikiprefix", esuser: "wikiaccesskey", espass: "wikisecret", usegraph: "usewikigraph" }
      Object.keys(mapping).forEach(function(k) { delete a[mapping[k]] })
      Object.keys(cfg).forEach(function(k) { if (mapping[k]) a[mapping[k]] = cfg[k]; else if (k.indexOf("wiki") === 0) a[k] = cfg[k] })
      a.wikibackend = cfg.backend || "fs"; a.wikiaccess = "ro"; delete a.wikimounts
    }
    if (a.libs) __miniALoadLibraries(a.libs, this.log, this.log)
    if (id === "graph.html") {
      if (io.fileExists(p.output)) throw new Error("Output already exists; choose a new HTML filename")
      return this.utility("wikiGraph", { dir: cfg.root, output: p.output, title: p.title })
    }
    if (id === "wiki.indexstats") {
      if (!new java.io.File(String(cfg.indexdir || cfg.root)).isDirectory()) throw new Error("Index directory does not exist")
      return this.utility("indexStats", { dir: cfg.indexdir || cfg.root, top: p.top })
    }
    if (id === "graph.filestats") {
      var graphFile = String(cfg.indexdir || cfg.root) + "/.mini-a-wiki-graph/graph.json"
      if (!io.fileExists(graphFile)) throw new Error("No persisted graph at " + graphFile)
      return this.utility("graphStats", { file: graphFile, top: p.top })
    }
    if (group === "dream") {
      global.__mini_a_dreams_lib_mode = true
      loadLib("mini-a-dreams.js")
      // Only mounted plan is read-only; carry its exact configuration into Dream.
      var dream = new MiniADreams(a, this.log)
      var originalConfig = dream._buildWikiConfig
      dream._buildWikiConfig = function() {
        if (self.args.wikitarget) return cfg
        return merge(originalConfig.call(dream), { access: cfg.access })
      }
      dream._args.dreamwikimode = action; dream._args.dreammode = "wiki"
      dream._args.dreamwikidryrun = action === "plan" || action === "auto" && p.dryrun === true
      if (action === "reorg") dream._args.dreamwikiinstructions = String(p.instructions || a.dreamwikiinstructions || "")
      return dream.dreamWiki()
    }
    if (group === "absorb") {
      loadLib("mini-a-absorb.js")
      a.absorbop = action; a.absorbplan = p.id; a.absorbspec = p.spec
      return new MiniAAbsorb(a, this.log).run()
    }
    if (group === "ingest") {
      global.__mini_a_ingest_lib_mode = true
      loadLib("mini-a-ingest.js")
      if (action === "run") {
        a.ingestsource = p.source; a.ingestsection = p.section; a.ingestdryrun = toBoolean(p.dryrun) === true
        Object.keys(p).forEach(function(k) { if (["source", "section", "dryrun"].indexOf(k) < 0) a["ingest" + k] = p[k] })
      }
      var ingest = new MiniAIngest(a, this.log)
      // A V2 manager references its engine and cannot be deep-merged into Dream args.
      // Preview/recovery borrow only the reader; resolve configuration independently.
      ingest._buildWikiConfig = function() { return cfg }
      if (action === "run" && !a.ingestdryrun) return ingest.run()
      if (action === "resume" || action === "discard") return ingest.manageRecovery(action, p.id, true)
      cfg.access = "ro"
      wm = __miniAWikiCreatePrimary(cfg, function(level, msg) { self.log(msg) })
      ingest._args.wikimanager = wm
      return action === "run" ? ingest.run() : ingest.manageRecovery(action === "recovery" ? "list" : action, p.id, true)
    }
    // Stats follows the console manager lifecycle, including an empty writable graph.
    // Other inspection operations use readers; mounted configs remain read-only.
    if (!MiniAWikiOps.mutates(spec) && id !== "wiki.compact" && id !== "graph.stats") cfg.access = "ro"
    wm = __miniAWikiCreatePrimary(cfg, function(level, msg) { self.log(msg) })
    if (MiniAWikiOps.mutates(spec) && wm._access !== "rw") throw new Error("Selected backend is read-only")
    if (group === "graph") {
      if (action === "build" && p.semantic === true) {
        global.__mini_a_dreams_lib_mode = true
        loadLib("mini-a-dreams.js")
        var graphDream = new MiniADreams(a, this.log), graphConfig = graphDream._buildWikiConfig()
        if (isFunction(graphConfig.llmExtractFn)) wm._graph._llmExtractFn = graphConfig.llmExtractFn
        p.onProgress = graphDream._wikiGraphProgressFn()
      }
      if (action === "falkor" && !String(p.query || "").trim()) delete p.query
      return wm.graph(action, p)
    }
    if (action === "context") return wm.context(p)
    if (action === "mounts") return { mounts: wm.mounts(), graph: toBoolean(cfg.usegraph) === true ? wm.graph("stats") : { enabled: false } }
    if (action === "list") return wm.list(p.path || "", p)
    if (action === "tree") return wm.tree(p.path || "", p.maxDepth)
    if (action === "browse") return wm.browse(p.path || "")
    if (action === "read") {
      var page = wm.agenticRead(p.path, p)
      if (!page) return { ok: false, error: "Page not found: " + p.path }
      if (page.error) page.ok = false
      return page
    }
    if (action === "search") {
      var hits = wm.search(p.query, p)
      if (!isArray(hits)) return hits
      var search = { ok: true, results: hits }
      ;["sources", "outcome", "budget", "stopReasons", "truncated", "effectiveMode"].forEach(function(k) { if (isDef(hits[k])) search[k] = hits[k] })
      if (hits.outcome === "partial" || hits.truncated === true) search.warning = "Search coverage is incomplete; absence is not established."
      return search
    }
    if (action === "backlinks") return wm.backlinks(p.path)
    if (action === "lint") {
      var lint = wm.lint(__, p), offset = p.offset || 0, limit = p.limit || 50
      lint.total_issues = lint.issues.length
      lint.issues = lint.issues.slice(offset, offset + limit)
      lint.truncated = offset + lint.issues.length < lint.total_issues
      if (lint.truncated) lint.next = { offset: offset + lint.issues.length, limit: limit }
      return lint
    }
    if (action === "write") return wm.write(p.path, io.readFileString(p.contentfile))
    if (action === "move") return wm.move(p.from, p.to, p)
    if (action === "init") return wm.init(p.path || "")
    if (action === "delete") return wm.delete(p.path)
    if (action === "indexes") return wm.regenerateIndexes(p)
    if (action === "upgrade") return wm.upgradeAgents()
    if (action === "reindex") return wm.reindex()
    if (action === "compact") return wm.compact(p)
    throw new Error("No dispatcher for " + id)
  } catch(e) { return { ok: false, error: String(e.message || e), operation: id } }
  finally { if (wm) wm.close() }
}

// Utility jobs run in a child so their standalone exit/error handlers cannot end the TUI.
MiniAWikiOps.prototype.utility = function(name, args) {
  var command = new java.util.ArrayList(), child
  command.add(String(getOpenAFPath()) + "/ojob")
  command.add(MiniAWikiOps.basePath() + "/utils/" + name + ".yaml")
  Object.keys(args).forEach(function(k) { if (isDef(args[k])) command.add(k + "=" + String(args[k])) })
  try {
    child = new java.lang.ProcessBuilder(command).redirectErrorStream(true).start()
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(child.getInputStream(), "UTF-8")), line, output = "", truncated = false
    try {
      while ((line = reader.readLine()) !== null) {
        var text = String(line)
        this.log(text)
        if (output.length < 262144) output += text.substring(0, 262144 - output.length) + "\n"
        else truncated = true
      }
    } finally { reader.close() }
    var code = child.waitFor()
    return { ok: code === 0, exit_code: code, output: output, truncated: truncated }
  } finally { if (child && child.isAlive()) child.destroy() }
}
MiniAWikiOps.prototype.execute = function(spec, gates) {
  var result
  try { result = this._execute(spec, gates) } catch(e) { return { ok: false, error: String(e.message || e), operation: spec.operation } }
  if (isUnDef(result)) return { ok: false, error: "Operation returned no result", operation: spec.operation }
  if (isMap(result) && result.error && isUnDef(result.ok)) result.ok = false
  return result
}
