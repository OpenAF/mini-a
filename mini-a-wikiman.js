// Guided wiki operations UI. No model is initialized to open these menus.
loadLib("mini-a-wikiops.js")

var MiniAWikiMan = function(args, ui) {
  this.args = MiniAWikiOps.settings(args || {})
  this.history = []
  this.tempFiles = []
  this.ui = ui || {
    choose: function(prompt, choices) { return __miniANormalizeChoiceIndex(askChoose(prompt, choices, Math.min(12, choices.length)), choices.length) },
    ask: function(prompt) { return ask(prompt) },
    print: function(value) { print(isString(value) ? value : printTree(value, __, { tableArrays: false, wordWrap: false })) }
  }
}
// Decorate labels only: operation IDs, category matching and menu indices stay stable.
MiniAWikiMan.menuLabel = function(label) {
  var names = {
    "Inspect": "🔎", "Pages & structure": "📝", "Indexes & storage": "🗂️", "Graph": "🕸️",
    "Dream": "💤", "Ingestion & absorption": "📥", "Session": "⚙️", "Exit": "👋", "Back": "🔙",
    "Advanced options: off": "⚙️", "Advanced options: on": "⚙️", "Show last result details": "📋", "No": "❌", "Yes": "✅", "fs": "📁", "s3": "☁️", "s3fs": "☁️", "es": "🔎", "http": "🌐",
    "Configured primary / federation overview": "📚", "Set up another primary": "✨",
    "Import content file": "📥", "Open configured external editor": "✏️",
    "Existing file or JSON/SLON": "📄", "Build a source selection": "🛠️",
    "Switch wiki": "📚", "Adjust session settings": "⚙️", "Attach read-only mount": "🔗",
    "Detach mount": "🔓", "Run history / export": "🕒"
  }
  var actions = {
    context: "ℹ️", indexstats: "📊", list: "📋", tree: "🌳", browse: "📂", read: "📖",
    search: "🔎", backlinks: "🔗", lint: "🩺", mounts: "📚", init: "✨", write: "✏️",
    move: "📦", delete: "🗑️", indexes: "🗂️", upgrade: "⬆️", reindex: "🔄", compact: "🗜️",
    stats: "📊", filestats: "🗄️", query: "🔎", retrieve: "📖", answer: "💬", neighbors: "🔗",
    path: "🧭", communities: "👥", surprise: "✨", cross: "🌐", export: "📤", build: "🛠️",
    report: "📋", falkor: "🗄️", html: "🌐", plan: "📝", apply: "✅", repair: "🔧",
    graph: "🕸️", reorg: "🧩", run: "📥", recovery: "🛟", resume: "▶️", discard: "🗑️",
    status: "📊", show: "📖", cancel: "❌"
  }
  var title = String(label).replace(/ \[(unavailable|last used)\]$/, "").split(" [unavailable:")[0], icon = names[title]
  if (!icon) {
    var op = MiniAWikiOps.catalog.filter(function(entry) { return entry.title === title })[0]
    icon = op ? actions[op.id.split(".")[1]] : /^\d{4}-/.test(title) ? "🕒" : "📚"
  }
  return (icon || "⚙️") + " " + label
}
MiniAWikiMan.prototype.choose = function(prompt, choices) {
  return this.ui.choose(prompt, choices.map(MiniAWikiMan.menuLabel))
}
MiniAWikiMan.consoleWidth = function() {
  try {
    var width = Number(__con.getTerminal().getWidth())
    if (isFinite(width) && width > 0) return Math.floor(width)
  } catch(ignore) {}
  return 80
}
MiniAWikiMan.prototype.separator = function() { this.ui.print(ansiColor("FG(240)", repeat(MiniAWikiMan.consoleWidth(), "╌"))) }
MiniAWikiMan.prototype.show = function(value) { this.ui.print(MiniAWikiOps.sanitize(value, this.args)) }
MiniAWikiMan.prototype.yes = function(prompt) { return this.choose(prompt, ["No", "Yes"]) === 1 }
MiniAWikiMan.prototype.input = function(prompt, fallback) {
  var value = this.ui.ask(prompt + (isDef(fallback) ? " [" + fallback + "]" : "") + " (/back cancels): ")
  if (value === null || isUnDef(value) || value === "/back") throw new Error("cancelled")
  if (!String(value).length && isDef(fallback)) return fallback
  return String(value)
}
MiniAWikiMan.prototype.runner = function() {
  var self = this
  return new MiniAWikiOps(this.args, function(msg) { self.show(msg) })
}
MiniAWikiMan.prototype.mounts = function() {
  return __miniAWikiPrimaryConfig({}, this.args.wikiroot, this.args.wikimounts).__primaryMounts
}
MiniAWikiMan.prototype.setup = function() {
  var backend = this.choose("Backend", ["fs", "s3", "s3fs", "es", "http", "Back"])
  if (backend < 0 || backend === 5) return
  var next = { usewiki: true, wikiaccess: "ro", wikibackend: ["fs", "s3", "s3fs", "es", "http"][backend] }
  if (backend === 0 || backend === 2) next.wikiroot = this.input("Wiki root")
  if (backend === 1 || backend === 2) {
    next.wikibucket = this.input("Bucket")
    next.wikiprefix = this.input("Prefix", "wiki/")
  }
  if (backend === 3 || backend === 4) next.wikiurl = this.input("Backend URL")
  if (backend === 3) next.wikiprefix = this.input("Index name", "mini_a_wiki")
  if (backend !== 4 && this.yes("Open this primary with write access?")) next.wikiaccess = "rw"
  next.usewikigraph = this.yes("Enable wiki graph operations?")
  // Keep model settings, but do not carry another connection's credentials or caches.
  ;["model", "secpass", "libs", "editor"].forEach(function(k) { if (isDef(this.args[k])) next[k] = this.args[k] }, this)
  var extra = this.input("Additional connection settings as JSON/SLON (use existing credential mechanisms)", "{}")
  next = MiniAWikiOps.settings(merge(next, MiniAWikiOps.parse(extra)))
  new MiniAWikiOps(next).config()
  this.args = next
}
MiniAWikiMan.prototype.selectTarget = function() {
  var mounts = this.mounts(), choices = ["Configured primary / federation overview"].concat(mounts.map(function(m) { return "@" + m.name + " (read-only mount)" }), ["Set up another primary", "Back"])
  var selected = this.choose("Select wiki", choices)
  if (selected === 0) delete this.args.wikitarget
  else if (selected > 0 && selected <= mounts.length) this.args.wikitarget = mounts[selected - 1].name
  else if (selected === mounts.length + 1) this.setup()
}
MiniAWikiMan.prototype.editPage = function(params) {
  var choice = this.choose("Page content", ["Import content file", "Open configured external editor", "Back"])
  if (choice < 0 || choice === 2) throw new Error("cancelled")
  var source
  if (choice === 0) source = this.input("Content file")
  else {
    var editor = this.args.editor || getEnv("EDITOR") || "vi", argv = MiniAWikiMan.editorArgs(String(editor))
    if (!argv.length) throw new Error("Invalid editor command")
    var runner = this.runner(), cfg = runner.targetConfig(), wm
    cfg.access = "ro"
    var raw = ""
    try {
      wm = new MiniAWikiManager(cfg)
      var page = wm.read(params.path)
      if (page) raw = isString(page.raw) ? page.raw : wm._backend.read(params.path) || ""
    } finally { if (wm) wm.close() }
    source = String(io.createTempFile("mini-a-wikiman-edit-", ".md"))
    this.tempFiles.push(source)
    io.writeFileString(source, raw)
    var command = new java.util.ArrayList()
    argv.forEach(function(arg) { command.add(arg) }); command.add(source)
    var child = new java.lang.ProcessBuilder(command).inheritIO().start()
    if (child.waitFor() !== 0) throw new Error("Editor failed; wiki page was not saved")
  }
  // Snapshot even imported files so replay within this session uses the reviewed content.
  var snapshot = String(io.createTempFile("mini-a-wikiman-content-", ".md"))
  this.tempFiles.push(snapshot)
  var content = io.readFileString(source)
  io.writeFileString(snapshot, content)
  params.contentfile = snapshot
  this.show({ page: params.path, content: content })
}
MiniAWikiMan.editorArgs = function(command) {
  var out = [], token = "", quote = "", escaped = false
  for (var i = 0; i < command.length; i++) {
    var c = command.charAt(i)
    if (escaped) { token += c; escaped = false }
    else if (c === "\\" && quote !== "'") escaped = true
    else if (quote) { if (c === quote) quote = ""; else token += c }
    else if (c === '"' || c === "'") quote = c
    else if (/\s/.test(c)) { if (token) { out.push(token); token = "" } }
    else token += c
  }
  if (quote || escaped) throw new Error("Unbalanced editor command")
  if (token) out.push(token)
  return out
}
MiniAWikiMan.prototype.absorbSpec = function() {
  var mode = this.choose("Absorption specification", ["Existing file or JSON/SLON", "Build a source selection", "Back"])
  if (mode < 0 || mode === 2) throw new Error("cancelled")
  if (mode === 0) return this.input("Specification file or JSON/SLON")
  var sources = []
  do {
    var source = { id: this.input("Unique source ID"), root: this.input("Source wiki folder") }
    var paths = this.input("Relative paths as a JSON array (empty selects all eligible pages)", "[]")
    source.paths = af.fromJSSLON(paths)
    if (!isArray(source.paths)) throw new Error("paths must be an array")
    if (!source.paths.length) source.all = true
    sources.push(source)
  } while (this.yes("Add another source?"))
  return { sources: sources }
}
// Bound the preview only; history retains the full sanitized result.
MiniAWikiMan.summary = function(value, depth) {
  depth = depth || 0
  if (isString(value)) return value.length > 320 ? value.substring(0, 320) + "… [see full details]" : value
  if (isArray(value)) return { count: value.length, preview: value.slice(0, 3).map(function(v) { return depth >= 1 ? "[see full details]" : MiniAWikiMan.summary(v, depth + 1) }) }
  if (isMap(value)) {
    if (depth >= 2) return "[see full details]"
    var out = {}, keys = Object.keys(value), important = ["ok", "error", "message", "warnings", "partial", "stopReasons", "nextAction"]
    keys.sort(function(a, b) { return (important.indexOf(a) < 0 ? 1 : 0) - (important.indexOf(b) < 0 ? 1 : 0) })
    keys.slice(0, 8).forEach(function(k) { out[k] = MiniAWikiMan.summary(value[k], depth + 1) })
    if (keys.length > 8) out.more = (keys.length - 8) + " more fields; see full details"
    return out
  }
  return value
}
MiniAWikiMan.prototype.category = function(group) {
  var self = this, last, advanced = false
  while (true) {
    var ops = MiniAWikiOps.catalog.filter(function(op) { return op.group === group }), runner = this.runner()
    // OpenAF's chooser starts at zero; keep the last operation there for quick repeats.
    if (last) ops.sort(function(a, b) { return a.id === last ? -1 : b.id === last ? 1 : 0 })
    var labels = ops.map(function(op) {
      return op.title + (runner.unavailable({operation: op.id, params: op.defaults}) ? " [unavailable]" : op.id === last ? " [last used]" : "")
    })
    var extras = ["Advanced options: " + (advanced ? "on" : "off"), "Show last result details", "Back"]
    var selected = this.choose(group, labels.concat(extras))
    if (selected < 0 || selected === ops.length + 2) return
    if (selected === ops.length) { advanced = !advanced; continue }
    if (selected === ops.length + 1) {
      if (this.history.length) this.show(this.history[this.history.length - 1].result)
      else this.show("No operations have run yet.")
      continue
    }
    if (selected >= ops.length) continue
    var op = ops[selected], reason = runner.unavailable({operation: op.id, params: op.defaults})
    if (reason) { this.ui.print(ansiColor("FG(249)", "Unavailable: " + reason)); continue }
    last = op.id
    try { this.runOperation(op.id, advanced) }
    catch(e) { if (String(e.message || e) !== "cancelled") this.ui.print(ansiColor("FG(196)", "❌ Operation failed: " + MiniAWikiOps.sanitize(String(e.message || e), this.args))) }
    this.showCurrentWiki()
  }
}
MiniAWikiMan.prototype.record = function(runner, spec, gates) {
  var replay = runner.command(spec, gates)
  this.separator()
  this.ui.print(MiniAWikiOps.formatReplay(replay))
  if (MiniAWikiOps.mutates(spec)) this.ui.print("Re-running this command authorizes the operation again. Failed/interrupted writes may be partial; use supported recovery actions.")
  this.separator()
  this.ui.print(ansiColor("FG(41),BOLD", "▶ Running: " + spec.operation))
  var started = Date.now(), result = runner.execute(spec, gates)
  var record = { time: new Date(started).toISOString(), elapsed_ms: Date.now() - started, operation: spec.operation,
    target: runner.args.wikitarget || runner.args.wikiroot || runner.args.wikiurl || runner.args.wikibucket,
    params: spec.params, result: result, command: replay.command, prerequisites: replay.prerequisites }
  record = MiniAWikiOps.sanitize(record, runner.args)
  // Keep the exact safe command: it already references credentials via environment variables.
  record.command = replay.command
  this.history.push(record)
  this.ui.print(ansiColor(result && result.ok === false ? "FG(196),BOLD" : "FG(41),BOLD",
    (result && result.ok === false ? "❌ Failed: " : "✅ Completed: ") + spec.operation))
  this.ui.print(ansiColor("FG(249),ITALIC", "⏱ " + record.elapsed_ms + " ms"))
  this.show(spec.operation === "wiki.compact" ? record.result : MiniAWikiMan.summary(record.result))
  this.ui.print(ansiColor("FG(249)", "Full output: Show last result details, or Session → Run history / export."))
  return result
}
MiniAWikiMan.prototype.runOperation = function(id, advanced) {
  var op = MiniAWikiOps.operation(id), runner = this.runner(), params = merge({}, op.defaults), self = this
  op.fields.forEach(function(field) {
    if (id === "wiki.write" && field[0] === "contentfile") return
    if (id === "absorb.plan" && field[0] === "spec") { params.spec = self.absorbSpec(); return }
    params[field[0]] = field[3] === "boolean" ? self.yes(field[1] + "?") : self.input(field[1], field[2])
  })
  if (id === "wiki.write") this.editPage(params)
  if (id === "ingest.run") params.dryrun = !this.yes("Apply ingestion instead of previewing?")
  if (advanced === true) {
    this.show({ parameters: params })
    params = merge(params, MiniAWikiOps.parse(this.input("Parameter overrides as JSON/SLON", "{}")))
    if (id.indexOf("dream.") === 0 || id.indexOf("ingest.") === 0 || id.indexOf("absorb.") === 0 || id === "graph.build") {
      var tuning = MiniAWikiOps.parse(this.input("Model / limits overrides (model, dreammaxsteps, maxcontext, contextguard, toolresultmaxinline, readresultmaxmatches, ingest..., absorb...)", "{}"))
      Object.keys(tuning).forEach(function(k) {
        if (!["model", "dreammaxsteps", "maxcontext", "contextguard", "toolresultmaxinline", "readresultmaxmatches"].includes(k) && !/^(ingest|absorb)/.test(k)) throw new Error("Unsupported tuning argument: " + k)
      })
      runner = new MiniAWikiOps(merge(clone(this.args), tuning), runner.log)
    }
  }
  if ((id === "dream.reorg" || id === "absorb.plan" || id === "graph.build" && params.semantic === true) && !runner.args.model && !getEnv("OAF_MODEL")) {
    runner.args.model = this.input("Configured model alias (or set OAF_MODEL before starting)")
  }
  if (id === "dream.reorg") {
    // Materialize the existing defaults so the review and replay show actual limits.
    var defaults = { dreammaxsteps: 40, maxcontext: 24000, contextguard: true, toolresultmaxinline: 4096, readresultmaxmatches: 20 }
    Object.keys(defaults).forEach(function(k) { if (isUnDef(runner.args[k])) runner.args[k] = defaults[k] })
    this.show("Default objective: inspect policy and lint, make surgical structural repairs, regenerate indexes and graph, then verify lint. Additional guidance is appended; existing tool restrictions remain.")
  }
  var spec = runner.spec(id, params), gates = {}, reason = runner.unavailable(spec)
  if (reason) throw new Error(reason)
  if (op.note) this.show(op.note)
  if (id === "wiki.compact") {
    var preview = runner.spec(id, merge(clone(params), { dryRun: true, offline: false }))
    var result = this.record(runner, preview, {})
    if (result && result.ok === false || !this.yes("Apply this compaction preview?")) return
    if (!this.yes("Have all other readers and writers of this wiki stopped?")) return
    spec.params.dryRun = false; spec.params.offline = true; gates.confirm = true
  } else if (MiniAWikiOps.mutates(spec)) {
    this.show({ operation: id, target: runner.args.wikitarget || runner.args.wikiroot || runner.args.wikiurl || runner.args.wikibucket,
      access: runner.args.wikiaccess, params: spec.params, settings: runner.args })
    if (!this.yes(id === "dream.reorg" ? "Run reorg on this wiki with this objective and limits?" : "Execute this operation?")) return
    gates.confirm = true
    if (id === "dream.reorg") {
      if (!this.yes("A backup/recovery point exists, and I authorize live changes to this wiki. Continue?")) return
      gates.backupconfirmed = true
      runner.args.dreamwikireorg = true; runner.args.dreamwikiapproval = "auto"
    }
  }
  this.record(runner, spec, gates)
}
MiniAWikiMan.prototype.exportRecord = function(index, output) {
  if (io.fileExists(output)) throw new Error("Export destination exists; choose a new filename")
  var record = clone(this.history[index])
  if (!record.operation) throw new Error("Select a run record")
  // Export the reviewed content alongside the command, not a dangling temp path.
  if (record.operation === "wiki.write") {
    var source = this.tempFiles.filter(function(f) { return record.command.indexOf(f) >= 0 })[0]
    if (source) {
      var contentPath = String(new java.io.File(output + ".content.md").getCanonicalPath())
      if (io.fileExists(contentPath)) throw new Error("Content export already exists")
      io.writeFileString(contentPath, io.readFileString(source))
      var oldParams = MiniAWikiOps.quote("params=" + JSON.stringify(record.params))
      record.params.contentfile = contentPath
      record.command = record.command.split(oldParams).join(MiniAWikiOps.quote("params=" + JSON.stringify(record.params)))
      record.prerequisites = ["Keep the exported content file: " + contentPath]
    }
  }
  io.writeFileString(output, JSON.stringify(record, null, 2))
  this.show("Exported " + output)
}
MiniAWikiMan.prototype.session = function() {
  var choice = this.choose("Session", ["Switch wiki", "Adjust session settings", "Attach read-only mount", "Detach mount", "Run history / export", "Back"])
  if (choice === 0) this.selectTarget()
  if (choice === 1) {
    this.show(this.args)
    var next = MiniAWikiOps.settings(merge(clone(this.args), MiniAWikiOps.parse(this.input("Settings overrides as JSON/SLON", "{}"))))
    new MiniAWikiOps(next).config(); this.args = next
  }
  if (choice === 2) {
    var mount = MiniAWikiOps.parse(this.input('Mount configuration, for example {name:"docs",backend:"fs",root:"/path"}'))
    mount.access = "ro"
    var mounts = this.mounts().filter(function(m) { return m.name !== mount.name }); mounts.push(mount)
    __miniAWikiPrimaryConfig({}, this.args.wikiroot, mounts)
    this.args.wikimounts = mounts
    var runner = this.runner(); this.record(runner, runner.spec("wiki.mounts", {}), {})
  }
  if (choice === 3) {
    var list = this.mounts(), selected = this.choose("Detach mount", list.map(function(m) { return m.name }).concat(["Back"]))
    if (selected >= 0 && selected < list.length) {
      if (this.args.wikitarget === list[selected].name) delete this.args.wikitarget
      list.splice(selected, 1); this.args.wikimounts = list
      var detachedRunner = this.runner(); this.record(detachedRunner, detachedRunner.spec("wiki.mounts", {}), {})
    }
  }
  if (choice === 4) {
    var index = this.choose("Run history", this.history.map(function(r) { return r.time + " " + r.operation }).concat(["Back"]))
    if (index >= 0 && index < this.history.length) {
      this.ui.print(this.history[index])
      if (this.yes("Export this record?")) this.exportRecord(index, this.input("New output JSON file"))
    }
  }
}
MiniAWikiMan.prototype.showCurrentWiki = function() {
  var header = { wiki: this.args.wikitarget ? "@" + this.args.wikitarget : "primary" }
  try {
    var selectedConfig = this.runner().targetConfig()
    header.root = selectedConfig.root || selectedConfig.url || selectedConfig.esurl || selectedConfig.bucket || "federation"
    header.backend = selectedConfig.__catalog ? "catalog" : selectedConfig.backend || "fs"
    header.access = selectedConfig.__catalog || /^(http|https)$/.test(header.backend) || /\.(zip|okt)$/i.test(String(selectedConfig.root || "")) ? "ro" : selectedConfig.access
    header.graph = toBoolean(selectedConfig.usegraph) === true
  } catch(headerError) { header.status = String(headerError.message || headerError) }
  this.separator()
  ow.loadFormat()
  // Use a uniform text palette so CSLON resets cannot interrupt the pale background.
  //var summary = af.toCSLON(MiniAWikiOps.sanitize(header, this.args)).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  var summary = af.toCSLON(MiniAWikiOps.sanitize(header, this.args))
  this.ui.print(ow.format.withSideLine(summary, MiniAWikiMan.consoleWidth(), "FG(220)", "RESET", ow.format.withSideLineThemes().doubleLineBothSides))
}
MiniAWikiMan.prototype.run = function() {
  this.ui.print(ansiColor("BOLD", " ._ _ " + ansiColor("FG(41)", "o") + "._ " + ansiColor("FG(41)", "o") + "   _\n | | ||| ||~~(_|") + ansiColor("FG(218)", " Wiki operations manager"))
  var self = this, groups = ["Inspect", "Pages & structure", "Indexes & storage", "Graph", "Dream", "Ingestion & absorption", "Session", "Exit"]
  try {
    try { this.runner().targetConfig(); if (!this.args.wikitarget && this.mounts().length > 0) this.selectTarget() } catch(e) { this.show(String(e.message || e)); this.setup() }
    while (true) {
      this.showCurrentWiki()
      var selected = this.choose("Wiki operations", groups)
      if (selected < 0 || selected === 7) break
      try {
        if (selected === 6) { this.session(); continue }
        this.category(groups[selected])
      } catch(e) { if (String(e.message || e) !== "cancelled") this.ui.print(ansiColor("FG(196)", "❌ Operation failed: " + MiniAWikiOps.sanitize(String(e.message || e), this.args))) }
    }
  } finally {
    this.tempFiles.forEach(function(file) { try { io.rm(file) } catch(ignore) {} })
  }
}

if (!toBoolean(global.__mini_a_wikiman_lib_mode)) {
  plugin("Console")
  __initializeCon()
  var wikiManArgs = isDef(global._args) ? global._args : processExpr(" ")
  if (wikiManArgs.libs) __miniALoadLibraries(wikiManArgs.libs, log, logErr)
  new MiniAWikiMan(wikiManArgs).run()
}
