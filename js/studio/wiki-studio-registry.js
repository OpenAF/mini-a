// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
var WikiStudioRegistry = function(config) { this.config = config; this.path = config.home + "/registry.json" }
WikiStudioRegistry.prototype.list = function() {
  var r = WikiStudio.json(this.path, { version: 1, wikis: [] })
  WikiStudio.assert(r.version === 1 && isArray(r.wikis), 503, "invalid_registry", "Unsupported registry")
  return r.wikis.sort(function(a, b) { return a.id.localeCompare(b.id) })
}
WikiStudioRegistry.prototype.get = function(id) {
  WikiStudio.name(id)
  var w = this.list().filter(function(w) { return w.id === id })[0]
  WikiStudio.assert(w && w.enabled, 404, "wiki_not_found", "Wiki not found")
  return w
}
WikiStudioRegistry.prototype.verify = function(w) {
  WikiStudio.assert(w.backend === "fs", 501, "backend_unavailable", "This Studio build supports local filesystem wikis only")
  WikiStudio.noLinks(w.root)
  WikiStudio.assert(new java.io.File(w.root).isDirectory(), 409, "root_missing", "Wiki root folder is missing; use Change root on the dashboard to point it at the moved folder")
  WikiStudio.assert(WikiStudio.canonical(w.root) === w.root && WikiStudio.identity(w.root) === w.identity, 409, "root_changed", "Wiki root identity changed; review it and use Change root on the dashboard to accept the folder")
  return w
}
WikiStudioRegistry.capabilities = function(w) {
  var local = w.backend === "fs", rw = local && w.access === "rw", out = {}
  ;["Browse", "Search", "GraphHtml"].forEach(function(k) { out["can" + k] = local })
  ;["Edit", "Hydrate", "Dream", "GraphBuild", "Absorb", "Compact", "Restore"].forEach(function(k) { out["can" + k] = rw })
  out.canGraphBuild=rw&&w.graph.enabled===true
  out.reasons = { readOnly: rw ? "" : "Requires a writable local filesystem wiki", remote: "Remote, archive and mounted backends are not connected by this Studio build; use the existing CLI/MCP readers." }
  return out
}
// Explain why a canonical path cannot become a wiki root (null when it can); shared by add() and browse().
WikiStudioRegistry.prototype.rootProblem = function(root, wikis, excludeId) {
  var home = this.config.home
  if (/(?:^|\/)\.[^/]+/.test(root) || /^\/(?:dev|proc|sys)(?:\/|$)/.test(root)) return { status: 403, code: "sensitive_root", message: "Hidden and system directories cannot be registered as wiki roots" }
  if (this.config.roots.indexOf(root) >= 0) return { status: 403, code: "root_not_allowed", message: "An allowed parent directory cannot itself be a wiki; choose or create a folder inside it" }
  if (!this.config.roots.some(function(r) { return root !== r && WikiStudio.inside(root, r) })) return { status: 403, code: "root_not_allowed", message: "Root must be beneath an operator-configured studioallowroots directory" }
  if (WikiStudio.inside(root, home) || WikiStudio.inside(home, root)) return { status: 403, code: "state_overlap", message: "Wiki and Studio home cannot overlap" }
  if (isArray(wikis)) {
    // A wiki being re-pointed never clashes with its own current root.
    var clash = wikis.filter(function(w) { return w.id !== excludeId && (WikiStudio.inside(root, w.root) || WikiStudio.inside(w.root, root)) })[0]
    if (clash) return { status: 409, code: "duplicate_wiki", message: clash.root === root ? "Already registered as wiki " + clash.id : "Overlaps registered wiki " + clash.id }
  }
  return null
}

// Summarize what an existing folder already holds (bounded walk, names only, no file contents).
WikiStudioRegistry.contents = function(path) {
  var out = { markdownFiles: 0, folders: 0, hasIndex: false, hasAgents: false, hasSearchIndex: false, hasGraph: false, truncated: false }
  var top = new java.io.File(path)
  out.hasIndex = new java.io.File(top, "index.md").isFile()
  out.hasAgents = new java.io.File(top, "AGENTS.md").isFile()
  out.hasSearchIndex = new java.io.File(top, ".mini-a-wiki-serving/current.json").isFile()
  out.hasGraph = new java.io.File(top, ".mini-a-wiki-graph/graph.json").isFile()
  var queue = [top], visited = 0, limit = 5000
  while (queue.length > 0) {
    var children = queue.shift().listFiles() || []
    for (var i = 0; i < children.length; i++) {
      var child = children[i], name = String(child.getName())
      if (++visited > limit) { out.truncated = true; return out }
      // Hidden folders hold indexes and state, not pages; links are never followed.
      if (name.charAt(0) === "." || java.nio.file.Files.isSymbolicLink(child.toPath())) continue
      if (child.isDirectory()) { out.folders++; queue.push(child) }
      else if (/\.md$/i.test(name) && !/^AGENTS\.md$/i.test(name)) out.markdownFiles++
    }
  }
  return out
}

// Describe one candidate directory for the root picker; contents are summarized only on request.
WikiStudioRegistry.prototype.describeRoot = function(path, wikis, excludeId, withContents) {
  var file = new java.io.File(path), exists = file.isDirectory(), problem = this.rootProblem(path, wikis, excludeId)
  var registered = wikis.filter(function(w) { return w.root === path && w.id !== excludeId })[0]
  var own = wikis.filter(function(w) { return w.root === path && w.id === excludeId })[0]
  return {
    currentRoot: isDef(own),
    contents: exists && withContents === true ? WikiStudioRegistry.contents(path) : null,
    name: String(file.getName()),
    path: path,
    exists: exists,
    looksLikeWiki: exists && new java.io.File(path + "/index.md").isFile(),
    registeredAs: registered ? registered.id : null,
    selectable: problem === null,
    reason: problem ? problem.message : null,
    code: problem ? problem.code : null
  }
}

// List allowroots (no path) or the visible child directories of a path beneath one; paths may not exist yet.
WikiStudioRegistry.prototype.browse = function(query) {
  var self = this, q = query || {}, wikis = this.list()
  var excludeId = isString(q.for) && q.for.length > 0 ? WikiStudio.name(q.for) : __
  if (isDef(excludeId)) WikiStudio.assert(wikis.some(function(w) { return w.id === excludeId }), 404, "wiki_not_found", "Wiki not found")
  var allowRoots = this.config.roots.map(function(r) {
    var entry = self.describeRoot(r, wikis, excludeId)
    entry.allowRoot = true
    return entry
  })
  if (isUnDef(q.path) || String(q.path) === "") return { path: null, parent: null, allowRoots: allowRoots, current: null, items: [], truncated: false }
  var requested = String(q.path)
  WikiStudio.assert(requested.length <= 4096 && requested.charAt(0) === "/" && !/[\x00-\x1f\x7f]/.test(requested), 400, "invalid_root", "Provide an absolute directory path")
  WikiStudio.assert(requested.split("/").every(function(s) { return s !== ".." && s !== "." }), 400, "invalid_root", "Traversal segments are not allowed")
  // Report "outside the allowlist" before link checks so paths like macOS /etc get a clear reason.
  WikiStudio.assert(this.config.roots.some(function(r) { return WikiStudio.inside(requested.replace(/\/+$/, "") || "/", r) }), 403, "root_not_allowed", "Browse is limited to operator-configured studioallowroots directories")
  WikiStudio.noLinks(requested)
  var path = WikiStudio.canonical(requested)
  var base = this.config.roots.filter(function(r) { return WikiStudio.inside(path, r) })[0]
  WikiStudio.assert(isDef(base), 403, "root_not_allowed", "Browse is limited to operator-configured studioallowroots directories")
  var current = this.describeRoot(path, wikis, excludeId, true), items = [], truncated = false, limit = 500
  if (current.exists) {
    var children = new java.io.File(path).listFiles() || []
    for (var i = 0; i < children.length; i++) {
      var child = children[i], name = String(child.getName())
      // Hidden, linked and non-directory entries can never be roots, so the picker does not show them.
      if (name.charAt(0) === "." || java.nio.file.Files.isSymbolicLink(child.toPath()) || !child.isDirectory()) continue
      if (items.length >= limit) { truncated = true; break }
      items.push(this.describeRoot(path + "/" + name, wikis, excludeId))
    }
    items.sort(function(a, b) { return a.name.localeCompare(b.name) })
  }
  return {
    path: path,
    parent: path === base ? null : String(new java.io.File(path).getParent()),
    allowRoot: base,
    allowRoots: allowRoots,
    current: current,
    items: items,
    truncated: truncated
  }
}

WikiStudioRegistry.prototype.add = function(body) {
  WikiStudio.fields(body, ["id", "name", "root", "access", "create", "backend"])
  WikiStudio.name(body.id)
  WikiStudio.assert(!body.backend || body.backend === "fs", 501, "backend_unavailable", "Only filesystem registration is available")
  WikiStudio.assert(isString(body.name) && body.name.length > 0 && body.name.length <= 120, 400, "invalid_name", "Display name is required")
  WikiStudio.assert(["rw", "ro"].indexOf(body.access) >= 0 && isString(body.root) && body.root.charAt(0) === "/", 400, "invalid_root", "Choose an absolute allowlisted root and ro/rw access")
  WikiStudio.noLinks(body.root)
  var root = WikiStudio.canonical(body.root), self = this
  var problem = this.rootProblem(root)
  if (problem) WikiStudio.fail(problem.status, problem.code, problem.message)
  return WikiStudio.lock(this.config.home, "registry", function() {
    var wikis = self.list()
    WikiStudio.assert(!wikis.some(function(w) { return w.id === body.id || WikiStudio.inside(root, w.root) || WikiStudio.inside(w.root, root) }), 409, "duplicate_wiki", "Wiki ID or root overlaps a registered wiki")
    var file = new java.io.File(root)
    if (body.create === true) {
      WikiStudio.assert(!file.exists(), 409, "root_exists", "Create requires a new directory")
      WikiStudio.assert(body.access === "rw", 400, "read_only", "Create needs rw access")
      WikiStudio.privateDir(root)
    }
    WikiStudio.assert(file.isDirectory(), 400, "invalid_root", "Wiki root must be an existing directory")
    var w = { id: body.id, name: body.name, root: root, identity: WikiStudio.identity(root), backend: "fs", access: body.access, enabled: true, graph: { enabled: true, semanticDefault: false }, retrieval: { v2: true }, sources: [], createdAt: WikiStudio.now() }
    if (body.create === true) {
      loadLib(__miniAPath("js/wiki/mini-a-wikiops.js"))
      var ops = new MiniAWikiOps({ wikiroot: root, wikiaccess: "rw", usewikigraph: false })
      var result = ops.execute(ops.spec("wiki.init", {}), { confirm: true })
      WikiStudio.assert(result.ok !== false, 422, "init_failed", "Wiki initialization failed")
    }
    wikis.push(w); WikiStudio.atomic(self.path, { version: 1, wikis: wikis }); return w
  })
}
// Classify a registered root for the dashboard: ok, missing (moved/deleted) or changed (replaced).
WikiStudioRegistry.prototype.rootState = function(w) {
  try {
    this.verify(w)
    return "ok"
  } catch(e) {
    if (e.code === "backend_unavailable") return "unavailable"
    return new java.io.File(w.root).isDirectory() ? "changed" : "missing"
  }
}

WikiStudioRegistry.prototype.update = function(id, body, remove) {
  WikiStudio.fields(body, ["name", "access", "graph", "root"])
  var newRoot
  if (isDef(body.root) && !remove) {
    WikiStudio.assert(isString(body.root) && body.root.charAt(0) === "/", 400, "invalid_root", "Choose an absolute directory")
    WikiStudio.noLinks(body.root)
    newRoot = WikiStudio.canonical(body.root)
    WikiStudio.assert(new java.io.File(newRoot).isDirectory(), 400, "invalid_root", "The new root must be an existing directory; create and populate it first")
  }
  if (isDef(body.name)) WikiStudio.assert(isString(body.name) && body.name.length > 0 && body.name.length <= 120, 400, "invalid_name", "Invalid display name")
  if (isDef(body.access)) WikiStudio.assert(["ro", "rw"].indexOf(body.access) >= 0, 400, "invalid_access", "Use ro or rw")
  if (isDef(body.graph)) { WikiStudio.fields(body.graph, ["enabled"]); WikiStudio.assert(isBoolean(body.graph.enabled), 400, "invalid_graph", "Expected enabled boolean") }
  var self = this
  return WikiStudio.lock(this.config.home, "registry", function() {
    var w = self.get(id), wikis = self.list()
    if (isDef(newRoot)) {
      var problem = self.rootProblem(newRoot, wikis, id)
      if (problem) WikiStudio.fail(problem.status, problem.code, problem.message)
    }
    if (!remove) Object.keys(body).forEach(function(k) { if (k !== "root") w[k] = body[k] })
    // Re-pointing records the new canonical path and its filesystem identity so verify() accepts it.
    if (isDef(newRoot)) {
      w.previousRoot = w.root
      w.root = newRoot
      w.identity = WikiStudio.identity(newRoot)
      w.rootChangedAt = WikiStudio.now()
    }
    wikis = wikis.filter(function(x) { return x.id !== id }); if (!remove) wikis.push(w)
    WikiStudio.atomic(self.path, { version: 1, wikis: wikis }); return { ok: true, wiki: remove ? null : w }
  })
}
