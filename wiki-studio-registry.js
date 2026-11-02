loadLib("wiki-studio-common.js")
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
  WikiStudio.assert(WikiStudio.canonical(w.root) === w.root && WikiStudio.identity(w.root) === w.identity, 409, "root_changed", "Wiki root identity changed; register it again after review")
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
WikiStudioRegistry.prototype.add = function(body) {
  WikiStudio.fields(body, ["id", "name", "root", "access", "create", "backend"])
  WikiStudio.name(body.id)
  WikiStudio.assert(!body.backend || body.backend === "fs", 501, "backend_unavailable", "Only filesystem registration is available")
  WikiStudio.assert(isString(body.name) && body.name.length > 0 && body.name.length <= 120, 400, "invalid_name", "Display name is required")
  WikiStudio.assert(["rw", "ro"].indexOf(body.access) >= 0 && isString(body.root) && body.root.charAt(0) === "/", 400, "invalid_root", "Choose an absolute allowlisted root and ro/rw access")
  WikiStudio.noLinks(body.root)
  var root = WikiStudio.canonical(body.root), self = this
  WikiStudio.assert(!/(?:^|\/)\.[^/]+/.test(root)&&!/^\/(?:dev|proc|sys)(?:\/|$)/.test(root),403,"sensitive_root","Hidden and system directories cannot be registered as wiki roots")
  WikiStudio.assert(this.config.roots.some(function(r) { return root !== r && WikiStudio.inside(root, r) }), 403, "root_not_allowed", "Root must be beneath an operator-configured studioallowroots directory")
  WikiStudio.assert(!WikiStudio.inside(root, this.config.home) && !WikiStudio.inside(this.config.home, root), 403, "state_overlap", "Wiki and Studio home cannot overlap")
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
      loadLib("mini-a-wikiops.js")
      var ops = new MiniAWikiOps({ wikiroot: root, wikiaccess: "rw", usewikigraph: false })
      var result = ops.execute(ops.spec("wiki.init", {}), { confirm: true })
      WikiStudio.assert(result.ok !== false, 422, "init_failed", "Wiki initialization failed")
    }
    wikis.push(w); WikiStudio.atomic(self.path, { version: 1, wikis: wikis }); return w
  })
}
WikiStudioRegistry.prototype.update = function(id, body, remove) {
  WikiStudio.fields(body, ["name", "access", "graph"])
  if (isDef(body.name)) WikiStudio.assert(isString(body.name) && body.name.length > 0 && body.name.length <= 120, 400, "invalid_name", "Invalid display name")
  if (isDef(body.access)) WikiStudio.assert(["ro", "rw"].indexOf(body.access) >= 0, 400, "invalid_access", "Use ro or rw")
  if (isDef(body.graph)) { WikiStudio.fields(body.graph, ["enabled"]); WikiStudio.assert(isBoolean(body.graph.enabled), 400, "invalid_graph", "Expected enabled boolean") }
  var self = this
  return WikiStudio.lock(this.config.home, "registry", function() {
    var w = self.get(id), wikis = self.list()
    if (!remove) Object.keys(body).forEach(function(k) { w[k] = body[k] })
    wikis = wikis.filter(function(x) { return x.id !== id }); if (!remove) wikis.push(w)
    WikiStudio.atomic(self.path, { version: 1, wikis: wikis }); return { ok: true, wiki: remove ? null : w }
  })
}
