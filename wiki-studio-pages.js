loadLib("mini-a-wikiops.js")
WikiStudioServer.prototype.manager = function(w, write, fn) {
  this.registry.verify(w)
  // Scan before giving a manager permission to write other pages (logs, backlinks,
  // indexes); do not let hidden symlinks or aliases redirect engine writes.
  WikiStudio.scan(w.root, true)
  var wm = new MiniAWikiManager({ backend: "fs", root: w.root, access: write ? "rw" : "ro", usegraph: w.graph.enabled === true, wikigraphsemantic: false, wikiretrievalv2: w.retrieval.v2 !== false })
  try { return fn(wm) } finally { wm.close() }
}
WikiStudioServer.prototype.checkPage = function(w, path) {
  var file = WikiStudio.safeFile(w.root, path)
  WikiStudio.assert(new java.io.File(file).isFile(), 404, "page_not_found", "Page not found")
  WikiStudio.assert(new java.io.File(file).length() <= this.config.maxPageBytes, 413, "page_too_large", "Page exceeds the complete editor read limit; no partial content was returned")
  return file
}
WikiStudioServer.prototype.readPage = function(w, path) {
  var file = this.checkPage(w, path), self = this
  return this.manager(w, false, function(wm) {
    var bytes = java.nio.file.Files.readAllBytes(WikiStudio.path(file)), page = wm.read(path)
    WikiStudio.assert(page && isString(page.raw), 404, "page_not_found", "Page not found")
    var raw = String(new java.lang.String(bytes, "UTF-8"))
    WikiStudio.assert(page.raw === raw, 409, "external_change", "Page changed during read; reload")
    var meta = page.meta || {}, sourceIds = []
    Object.keys(meta).forEach(function(k) { if (/source.?id/i.test(k) && isString(meta[k])) sourceIds.push(meta[k]) })
    return { path: path, content: raw, revision: WikiStudio.hash(bytes), modifiedAt: new Date(Number(new java.io.File(file).lastModified())).toISOString(), metadata: meta, links: page.links || [], sourceManaged: sourceIds.length > 0 || !!meta.source, sourceIds: sourceIds, permissions: { canEdit: w.access === "rw" }, warnings: ["External CLI writers are outside Studio locks. Stop them before editing or maintenance."] }
  })
}
WikiStudioServer.prototype.revision = function(w, path, expected, creating) {
  var file = WikiStudio.safeFile(w.root, path), exists = new java.io.File(file).isFile()
  var actual = exists ? WikiStudio.hash(java.nio.file.Files.readAllBytes(WikiStudio.path(this.checkPage(w, path)))) : null
  WikiStudio.assert(creating ? !exists && expected === null : exists && isString(expected) && actual === expected, 409, "revision_conflict", "The page changed or the expected revision is missing; reload and merge", { path: path, currentRevision: actual })
}
WikiStudioServer.prototype.validateMarkdown = function(content) {
  WikiStudio.assert(isString(content) && WikiStudio.bytes(content).length <= this.config.maxPageBytes && content.indexOf("\u0000") < 0, 413, "page_limit", "Content must be UTF-8 text within the page byte limit")
  var front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (/^---\r?\n/.test(content)) {
    WikiStudio.assert(front, 422, "invalid_frontmatter", "Frontmatter must have a closing delimiter")
    try { var parsed = af.fromYAML(front[1]); WikiStudio.assert(isMap(parsed), 422, "invalid_frontmatter", "Frontmatter must be a YAML map") } catch(e) { WikiStudio.fail(422, "invalid_frontmatter", "Invalid YAML frontmatter") }
  }
}
WikiStudioServer.prototype.wikiRoute = function(req, w, parts, role) {
  var self = this, q = req.query || {}, body = req.body || {}, route = parts.join("/"), read = req.method === "GET"
  if (this.jobWikiRoute && ["dreams", "ingestions", "absorptions", "graph/rebuild", "backups", "changes", "maintenance", "sources"].indexOf(route) >= 0 || this.jobWikiRoute && /^backups\//.test(route)) return this.jobWikiRoute(req, w, parts, role)
  return WikiStudio.lock(this.config.home, w.id, function() {
    self.registry.verify(w)
    if (self.assertIdle) self.assertIdle(w.id)
    if (route === "page" && read) return self.readPage(w, q.path)
    if (route === "graph/html" && read && self.graphHtml) return self.graphHtml(w)
    if (["page", "pages", "pages/move"].indexOf(route) >= 0 && !read) {
      WikiStudio.authorize(role, "editor", w)
      WikiStudio.fields(body, route === "pages/move" ? ["source", "destination", "expectedRevision"] : ["path", "content", "expectedRevision", "confirmation"])
      var path = route === "pages/move" ? body.source : q.path || body.path
      WikiStudio.pagePath(path)
      if (route === "pages/move") { WikiStudio.safeFile(w.root, body.destination); WikiStudio.assert(!io.fileExists(w.root + "/" + body.destination), 409, "destination_exists", "Destination exists") }
      var creating = route === "pages" && req.method === "POST"
      self.revision(w, path, body.expectedRevision, creating)
      if (req.method === "DELETE") WikiStudio.assert(body.confirmation === path, 400, "confirmation_required", "Confirm deletion by exact path")
      if (req.method === "PUT" || creating) self.validateMarkdown(body.content)
      WikiStudio.assert(["PUT", "POST", "DELETE"].indexOf(req.method) >= 0, 405, "method_not_allowed", "Method not allowed")
      WikiStudio.scan(w.root, true)
      // Opening a rw manager can bootstrap missing core pages. Verify once more
      // immediately before the supported manager operation.
      var result = self.manager(w, true, function(wm) {
        self.revision(w, path, body.expectedRevision, creating)
        if (route === "pages/move" && req.method === "POST") return wm.move(path, body.destination)
        if (route === "page" && req.method === "DELETE") return wm.delete(path)
        if ((route === "page" && req.method === "PUT") || creating) return wm.write(path, body.content, __, { preserveRaw: true })
        WikiStudio.fail(405, "method_not_allowed", "Method not allowed")
      })
      WikiStudio.assert(result && result.ok !== false, 422, "engine_error", "Page operation failed; inspect wiki health", result)
      return req.method === "DELETE" ? result : self.readPage(w, route === "pages/move" ? body.destination : path)
    }
    if (read) {
      var operations = { overview: "wiki.context", tree: "wiki.tree", pages: "wiki.list", search: "wiki.search", backlinks: "wiki.backlinks", lint: "wiki.lint", "graph/stats": "graph.stats", "graph/related": "graph.neighbors" }, op = operations[route]
      WikiStudio.assert(op, 404, "not_found", "Route not found")
      var params = {}, paging = WikiStudioServer.paginate([], q)
      if (q.path) WikiStudio.pagePath(q.path, route === "backlinks")
      if (["tree", "pages"].indexOf(route) >= 0) params = { path: q.path || "", limit: paging.limit, offset: paging.offset }
      if (route === "tree") params = { path: q.path || "", maxDepth: 12 }
      if (route === "search") { WikiStudio.assert(isString(q.q) && q.q.length <= 1000, 400, "invalid_query", "Search query required (max 1000 characters)"); params = { query: q.q, limit: paging.limit, offset: paging.offset } }
      if (route === "backlinks") params = { path: WikiStudio.pagePath(q.path) }
      if (route === "lint") params = { limit: paging.limit, offset: paging.offset }
      if (route === "graph/related") { WikiStudio.assert(isString(q.node) && q.node.length <= 600, 400, "invalid_node", "Node ID required"); params = { node: q.node } }
      WikiStudio.scan(w.root, true)
      var ops = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "ro", usewikigraph: w.graph.enabled, wikigraphsemantic: false, wikiretrievalv2: w.retrieval.v2 !== false }), res = ops.execute(ops.spec(op, params))
      WikiStudio.assert(res && res.ok !== false, 422, "engine_error", "Wiki operation failed", res)
      if (route === "graph/stats") return { stats: res, source: io.fileExists(w.root + "/.mini-a-wiki-graph/graph.json") ? "knowledge-graph-snapshot" : "markdown-links-fallback", freshness: "Snapshot freshness is not inferred from its presence; rebuild after external changes", semantic: "Not inferred; semantic extraction is opt-in" }
      return res
    }
    WikiStudio.fail(405, "method_not_allowed", "Method not allowed")
  })
}
