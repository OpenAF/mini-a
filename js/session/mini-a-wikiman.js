// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

// Guided wiki operations UI. No model is initialized to open these menus.
loadLib(__miniAPath("js/wiki/mini-a-wikiops.js"))

var MiniAWikiMan = function(args, ui) {
  this.args = MiniAWikiOps.settings(args || {})
  this._fileallow = this.args.fileallow
  this._fileAccess = new MiniAFileAccess(this._fileallow)
  this._reviewedContent = {}
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
    "Inspect": "🔎", "Browse & organize": "📂", "Pages & structure": "📝", "Indexes & storage": "🗂️", "Graph": "🕸️",
    "Dream": "💤", "Ingestion & absorption": "📥", "Session": "⚙️", "Exit": "👋", "Back": "🔙",
    "Advanced options: off": "⚙️", "Advanced options: on": "⚙️", "Show last result details": "📋", "Show last command line": "💻", "No": "❌", "Yes": "✅", "fs": "📁", "s3": "☁️", "s3fs": "☁️", "es": "🔎", "http": "🌐",
    "Configured primary / federation overview": "📚", "Set up another primary": "✨",
    "Import content file": "📥", "Open configured external editor": "✏️",
    "Existing file or JSON/SLON": "📄", "Build a source selection": "🛠️",
    "Switch wiki": "📚", "Adjust session settings": "⚙️", "Attach read-only mount": "🔗",
    "Detach mount": "🔓", "Run history / export": "🕒"
  }
  var actions = {
    context: "ℹ️", indexstats: "📊", list: "📋", tree: "🌳", browse: "📂", read: "📖",
    search: "🔎", backlinks: "🔗", lint: "🩺", mounts: "📚", init: "✨", write: "✏️",
    move: "📦", folderCreate: "📁", selectionPreview: "📋", selectionMove: "📦", selectionDelete: "🗑️", delete: "🗑️", indexes: "🗂️", upgrade: "⬆️", reindex: "🔄", compact: "🗜️",
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
  this.args.fileallow = this._fileallow
  var runner = new MiniAWikiOps(this.args, function(msg) { self.show(msg) })
  runner.onGraphProgress = function(p) { self.ui.print(ansiColor("FG(249)", p.stage + " · " + p.processed + " processed · " + p.cached + " cached · " + p.pending + " pending · " + p.failed + " failed · " + p.calls + "/" + p.effective.maxCalls + " calls · " + p.estimatedTokens + "/" + p.effective.maxTokens + " estimated tokens · " + ((p.elapsedMs || 0) / 60000).toFixed(2) + "/" + p.effective.maxMinutes + " minutes" + (p.resumable ? " · resume pending work explicitly" : ""))) }
  runner._reviewedContent = this._reviewedContent
  return runner
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
  next.fileallow = this._fileallow
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
  if (choice === 0) this._fileAccess.assert(source)
  var content = io.readFileString(source)
  io.writeFileString(snapshot, content)
  params.contentfile = snapshot
  this._reviewedContent[MiniAWikiOps.absolute(snapshot)] = content
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
    var extras = ["Advanced options: " + (advanced ? "on" : "off"), "Show last result details", "Show last command line", "Back"]
    var selected = this.choose(group, labels.concat(extras))
    if (selected < 0 || selected === ops.length + 3) return
    if (selected === ops.length) { advanced = !advanced; continue }
    if (selected === ops.length + 1) {
      if (this.history.length) this.show(this.history[this.history.length - 1].result)
      else this.show("No operations have run yet.")
      continue
    }
    if (selected === ops.length + 2) { this.showLastCommand(); continue }
    if (selected >= ops.length) continue
    var op = ops[selected], reason = runner.unavailable({operation: op.id, params: op.defaults})
    if (reason) { this.ui.print(ansiColor("FG(249)", "Unavailable: " + reason)); continue }
    last = op.id
    try { this.runOperation(op.id, advanced) }
    catch(e) { if (String(e.message || e) !== "cancelled") this.ui.print(ansiColor("FG(196)", "❌ Operation failed: " + MiniAWikiOps.sanitize(String(e.message || e), this.args))) }
    this.showCurrentWiki()
  }
}
MiniAWikiMan.prototype.showLastCommand = function() {
  if (!this._lastReplay) { this.show("No operations have run yet."); return }
  this.separator()
  this.ui.print(MiniAWikiOps.formatReplay(this._lastReplay.replay))
  if (this._lastReplay.mutates) this.ui.print("Re-running this command authorizes the operation again. Failed/interrupted writes may be partial; use supported recovery actions.")
  this.separator()
}
MiniAWikiMan.prototype.record = function(runner, spec, gates) {
  var replay = runner.command(spec, gates)
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
  this._lastReplay = { replay: replay, mutates: MiniAWikiOps.mutates(spec) }
  this.ui.print(ansiColor(result && result.ok === false ? "FG(196),BOLD" : "FG(41),BOLD",
    (result && result.ok === false ? "❌ Failed: " : "✅ Completed: ") + spec.operation))
  this.ui.print(ansiColor("FG(249),ITALIC", "⏱ " + record.elapsed_ms + " ms"))
  this.show((spec.operation === "wiki.compact" || spec.operation === "dream.auto") ? record.result : MiniAWikiMan.summary(record.result))
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
  if (id === "graph.build" || id === "graph.defaults") params = this.graphBuildControls(runner, id === "graph.defaults")
  if (id === "wiki.write") this.editPage(params)
  if (id === "dream.auto") params.dryrun = !this.yes("Run automatic repairs instead of previewing?")
  if (id === "ingest.run") params.dryrun = !this.yes("Apply ingestion instead of previewing?")
  if (advanced === true) {
    this.show({ parameters: params })
    params = merge(params, MiniAWikiOps.parse(this.input("Parameter overrides as JSON/SLON", "{}")))
    if (id.indexOf("dream.") === 0 || id.indexOf("ingest.") === 0 || id.indexOf("absorb.") === 0 || id === "graph.build") {
      var tuning = MiniAWikiOps.parse(this.input("Model / limits overrides (model, modelvisual, debugvisualch, modeldec, usedecide, dreamwikillm, dreammaxsteps, maxcontext, contextguard, toolresultmaxinline, readresultmaxmatches, ingest..., absorb...)", "{}"))
      Object.keys(tuning).forEach(function(k) {
        if (!["model", "modelvisual", "debugvisualch", "modeldec", "usedecide", "dreamwikillm", "dreammaxsteps", "maxcontext", "contextguard", "toolresultmaxinline", "readresultmaxmatches"].includes(k) && !/^(ingest|absorb)/.test(k)) throw new Error("Unsupported tuning argument: " + k)
      })
      runner = new MiniAWikiOps(merge(clone(this.args), tuning), runner.log)
    }
  }
  if ((id === "dream.reorg" || id === "absorb.plan") && !runner.args.model && !getEnv("OAF_MODEL")) {
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
  } else if (id === "wiki.folderMove" || id === "wiki.folderDelete") {
    var folderPreview = runner.execute(runner.spec("wiki.folderPreview", {from:params.from,to:params.to || ""}))
    this.show(folderPreview)
    if (!folderPreview.ok) return
    if (!this.yes("Apply this recursive operation after creating a verified recovery snapshot?")) return
    spec.params.expectedRevision = folderPreview.revision
    if (id === "wiki.folderDelete") {
      spec.params.confirmation = this.input("Type the exact source folder path to delete")
      if (spec.params.confirmation !== params.from) { this.show("Confirmation did not match; nothing changed."); return }
    }
    gates.confirm = true
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
  this._fileAccess.assert(output)
  if (io.fileExists(output)) throw new Error("Export destination exists; choose a new filename")
  var record = clone(this.history[index])
  if (!record.operation) throw new Error("Select a run record")
  // Export the reviewed content alongside the command, not a dangling temp path.
  if (record.operation === "wiki.write") {
    var source = this.tempFiles.filter(function(f) { return record.command.indexOf(f) >= 0 })[0]
    if (source) {
      var contentPath = String(new java.io.File(output + ".content.md").getCanonicalPath())
      if (io.fileExists(contentPath)) throw new Error("Content export already exists")
      this._fileAccess.assert(contentPath)
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
    next.fileallow = this._fileallow
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
// Interactive file-manager style browser: walk folders, mark pages/folders, then move, delete or create
// folders. Marks survive navigation, so "mark here, walk there, Move marked here" works like cut and paste.
MiniAWikiMan.prototype.organize = function() {
  var self = this, runner = self.runner(), path = "", offset = 0, size = 30, marked = [], kinds = {}
  var strip = function(p) { return String(p || "").replace(/\/+$/, "") }
  var base = function(p) { return p.substring(p.lastIndexOf("/") + 1) }
  var join = function(dir, name) { return (dir ? dir + "/" : "") + name }
  var parentOf = function(p) { return p.indexOf("/") < 0 ? "" : p.substring(0, p.lastIndexOf("/")) }
  var call = function(id, params) {
    var spec = runner.spec(id, params), reason = runner.unavailable(spec)
    if (reason) throw new Error(reason)
    return runner.execute(spec, {})
  }
  var reasonFor = function(id, params) { return runner.unavailable(runner.spec(id, params)) }
  var writeReason = reasonFor("wiki.folderCreate", { path: "x" }), selectionReason = reasonFor("wiki.selectionMove", { items: ["x"], to: "" })
  var effective = function() { return marked.filter(function(m) { return !marked.some(function(o) { return o !== m && m.indexOf(o + "/") === 0 }) }) }
  var toggle = function(p, kind) { var i = marked.indexOf(p); if (i >= 0) marked.splice(i, 1); else { marked.push(p); kinds[p] = kind } }
  var mutate = function(id, params, gates) {
    var spec = runner.spec(id, params)
    self.show({ operation: id, target: runner.args.wikitarget || runner.args.wikiroot || runner.args.wikiurl || runner.args.wikibucket, access: runner.args.wikiaccess, params: spec.params })
    if (!self.yes("Execute this operation?")) return null
    return self.record(runner, spec, merge({ confirm: true }, gates || {}))
  }
  // One page uses the page operations; several items or any folder use one previewed, snapshotted transaction.
  var transfer = function(items, destination) {
    var deleting = destination === null, single = items.length === 1 && kinds[items[0]] !== "folder"
    if (single) return deleting ? mutate("wiki.delete", { path: items[0] }) : mutate("wiki.move", { from: items[0], to: join(destination, base(items[0])) })
    if (selectionReason) throw new Error(selectionReason)
    var preview = call("wiki.selectionPreview", { items: items, to: deleting ? "" : destination, "delete": deleting })
    self.show(preview)
    if (!preview.ok) return null
    if (!self.yes((deleting ? "Delete" : "Move") + " these " + items.length + " items after creating a verified recovery snapshot?")) return null
    var params = { items: items, expectedRevision: preview.revision }
    if (deleting) {
      params.confirmation = self.input('Type "' + preview.confirmation + '" to delete')
      if (params.confirmation !== preview.confirmation) { self.show("Confirmation did not match; nothing changed."); return null }
    } else params.to = destination
    return self.record(runner, runner.spec(deleting ? "wiki.selectionDelete" : "wiki.selectionMove", params), { confirm: true })
  }
  var done = function(result, items) { if (result && result.ok !== false) items.forEach(function(p) { var i = marked.indexOf(p); if (i >= 0) marked.splice(i, 1) }) }
  if (writeReason) self.show("Browsing only: " + writeReason)
  while (true) {
    var listing = call("wiki.browse", { path: path })
    if (listing && listing.ok === false) throw new Error(listing.error || "Cannot browse " + (path || "the wiki root"))
    var sections = (listing.child_sections || []).filter(function(c) { return c.name && c.name.charAt(0) !== "@" && String(c.path).charAt(0) !== "@" })
    var pages = (listing.direct_pages || []).filter(function(c) { return !/(^|\/)index\.md$/i.test(c.path) })
    var mark = function(p) { return marked.indexOf(p) >= 0 || marked.some(function(o) { return p.indexOf(o + "/") === 0 }) ? "[x] " : "[ ] " }
    var rows = []
    if (path) rows.push({ label: "⬆️  ..  (" + (parentOf(path) || "wiki root") + ")", run: function() { path = parentOf(path); offset = 0 } })
    sections.forEach(function(c) {
      var folder = strip(c.path)
      rows.push({ label: mark(folder) + "📁 " + c.name + "/  (" + c.page_count + " pages)", run: function() { path = folder; offset = 0 } })
    })
    pages.forEach(function(c) {
      rows.push({ label: mark(c.path) + "📄 " + base(c.path), run: function() { toggle(c.path, "file") } })
    })
    var navigation = rows.slice(0, path ? 1 : 0), content = rows.slice(path ? 1 : 0), shown = content.slice(offset, offset + size)
    var choices = navigation.concat(shown)
    if (offset > 0) choices.push({ label: "◀ Previous " + size, run: function() { offset = Math.max(0, offset - size) } })
    if (offset + size < content.length) choices.push({ label: "▶ Next " + size + " (" + (content.length - offset - size) + " more)", run: function() { offset += size } })
    var chosen = effective()
    if (!writeReason) {
      choices.push({ label: "➕ New folder here", run: function() {
        var name = self.input("New folder name inside " + (path || "the wiki root")), made = mutate("wiki.folderCreate", { path: join(path, name.replace(/^\/+|\/+$/g, "")) })
        if (made && made.ok !== false) offset = 0
      } })
    }
    if (path) choices.push({ label: (marked.indexOf(path) >= 0 ? "☐ Unmark" : "☑ Mark") + " this folder", run: function() { toggle(path, "folder") } })
    if (sections.length) choices.push({ label: "☑ Mark/unmark a subfolder…", run: function() {
      var pick = self.ui.choose("Subfolder", sections.map(function(c) { return mark(strip(c.path)) + "📁 " + c.name }).concat(["🔙 Back"]))
      if (pick >= 0 && pick < sections.length) toggle(strip(sections[pick].path), "folder")
    } })
    if (pages.length) choices.push({ label: "☑ Mark all pages here", run: function() { pages.forEach(function(c) { if (marked.indexOf(c.path) < 0) { marked.push(c.path); kinds[c.path] = "file" } }) } })
    if (chosen.length && !writeReason) {
      var heavy = chosen.length > 1 || chosen.some(function(m) { return kinds[m] === "folder" }), gate = heavy && selectionReason ? " [unavailable: requires a local filesystem wiki]" : ""
      choices.push({ label: "📦 Move " + chosen.length + " marked here (" + (path || "wiki root") + ")" + gate, run: function() { done(transfer(chosen.slice(), path), chosen) } })
      choices.push({ label: "🗑️  Delete " + chosen.length + " marked" + gate, run: function() { done(transfer(chosen.slice(), null), chosen) } })
    }
    if (chosen.length === 1 && kinds[chosen[0]] !== "folder" && !writeReason) {
      choices.push({ label: "✏️  Rename marked page", run: function() {
        var to = self.input("New path for " + chosen[0], chosen[0]); if (to === chosen[0]) return
        done(mutate("wiki.move", { from: chosen[0], to: to }), chosen)
      } })
    }
    if (chosen.length) choices.push({ label: "✖ Clear " + marked.length + " mark(s)", run: function() { marked = [] } })
    choices.push({ label: "🔙 Back", run: null })
    self.separator()
    self.ui.print(ansiColor("BOLD", "📂 /" + path) + (marked.length ? ansiColor("FG(41)", "   " + marked.length + " marked: " + marked.slice(0, 3).join(", ") + (marked.length > 3 ? ", …" : "")) : ""))
    var pick = self.ui.choose("Browse & organize", choices.map(function(c) { return c.label }))
    if (pick < 0 || pick >= choices.length || !choices[pick].run) return
    try { choices[pick].run() }
    catch(e) { if (String(e.message || e) !== "cancelled") self.ui.print(ansiColor("FG(196)", "❌ Operation failed: " + MiniAWikiOps.sanitize(String(e.message || e), self.args))) }
  }
}
MiniAWikiMan.prototype.run = function() {
  this.ui.print(ansiColor("BOLD", " ._ _ " + ansiColor("FG(41)", "o") + "._ " + ansiColor("FG(41)", "o") + "   _\n | | ||| ||~~(_|") + ansiColor("FG(218)", " Wiki operations manager"))
  var self = this, groups = ["Inspect", "Browse & organize", "Pages & structure", "Indexes & storage", "Graph", "Dream", "Ingestion & absorption", "Session", "Exit"]
  try {
    try { this.runner().targetConfig(); if (!this.args.wikitarget && this.mounts().length > 0) this.selectTarget() } catch(e) { this.show(String(e.message || e)); this.setup() }
    while (true) {
      this.showCurrentWiki()
      var selected = this.choose("Wiki operations", groups)
      if (selected < 0 || groups[selected] === "Exit") break
      try {
        if (groups[selected] === "Session") { this.session(); continue }
        if (groups[selected] === "Browse & organize") { this.organize(); continue }
        this.category(groups[selected])
      } catch(e) { if (String(e.message || e) !== "cancelled") this.ui.print(ansiColor("FG(196)", "❌ Operation failed: " + MiniAWikiOps.sanitize(String(e.message || e), this.args))) }
    }
  } finally {
    this.tempFiles.forEach(function(file) { try { io.rm(file) } catch(ignore) {} })
  }
}

// Both interfaces edit the same contract; force and resume never enter saved defaults.
MiniAWikiMan.prototype.graphBuildControls = function(runner, saveOnly) {
  var settings = runner.execute(runner.spec("graph.settings", {}), {}), self = this
  if (settings.ok === false) throw new Error(settings.error)
  var current = settings.result || settings
  while (current.result && !current.effective) current = current.result
  var base = current.effective || MiniAGraphBuild.defaults
  var extraction = this.choose("Extraction", ["Structural", "Semantic"])
  var options = merge(clone(base), { extraction: extraction === 1 ? "semantic" : "structural" })
  options.modelHelp = options.extraction === "semantic" && this.choose("Model assistance", ["Off", "Automatic"]) === 1 ? "auto" : "off"
  options.strategy = saveOnly ? "incremental" : ["incremental", "full", "resume"][this.choose("Build strategy", ["Incremental", "Full rebuild", "Resume pending work"])]
  var preset = ["small", "moderate", "large", "custom", "reset"][this.choose("Budgets", ["Small", "Moderate", "Large", "Custom", "Reset to built-in defaults"])]
  if (preset === "reset") options = clone(MiniAGraphBuild.defaults)
  else if (MiniAGraphBuild.presets[preset]) options = merge(options, MiniAGraphBuild.presets[preset])
  else ["maxCalls", "maxTokens", "maxMinutes"].forEach(function(k) { options[k] = Number(self.input(k, options[k])) })
  options.force = !saveOnly && options.extraction === "semantic" && options.strategy !== "resume" && this.yes("Force extraction, ignoring semantic caches?")
  options = MiniAGraphBuild.resolve(options)
  this.show({ effective: options, models: current.models || MiniAGraphBuild.availability(), fallback: current.fallback })
  if (!saveOnly && this.yes("Save extraction, model assistance and budgets as defaults for this wiki?")) {
    var saved = runner.execute(runner.spec("graph.defaults", MiniAGraphBuild.preferences(options)), { confirm: true })
    if (saved.ok === false) throw new Error(saved.error)
  }
  return saveOnly ? MiniAGraphBuild.preferences(options) : options
}

if (!toBoolean(global.__mini_a_wikiman_lib_mode)) {
  plugin("Console")
  __initializeCon()
  var wikiManArgs = isDef(global._args) ? global._args : processExpr(" ")
  if (wikiManArgs.libs) __miniALoadLibraries(wikiManArgs.libs, log, logErr)
  new MiniAWikiMan(wikiManArgs).run()
}
