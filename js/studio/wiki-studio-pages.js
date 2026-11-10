// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/wiki/mini-a-wikiops.js"))
WikiStudioServer.prototype.manager = function(w, write, fn, options) {
  this.registry.verify(w)
  // Scan before giving a manager permission to write other pages (logs, backlinks,
  // indexes); do not let hidden symlinks or aliases redirect engine writes.
  WikiStudio.scan(w.root, true)
  var wm = new MiniAWikiManager({ skipBootstrap: options && options.skipBootstrap === true, backend: "fs", root: w.root, access: write ? "rw" : "ro", usegraph: w.graph.enabled === true, wikiretrievalv2: w.retrieval.v2 !== false })
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
// Graph and combined search for one wiki. Graph hits come from graph.retrieve (pages grounded by
// concept/metadata matches); combined fuses index and graph rankings by reciprocal rank, so scores
// from the two engines are never compared directly. Called inside wikiRoute's wiki lock.
WikiStudioServer.prototype.modeSearch = function(w, q) {
  var mode = String(q.mode)
  WikiStudio.assert(["graph", "combined"].indexOf(mode) >= 0, 400, "invalid_mode", "Search mode must be index, graph or combined")
  WikiStudio.assert(isString(q.q) && q.q.trim().length > 0 && q.q.length <= 1000, 400, "invalid_query", "Search query required (max 1000 characters)")
  var paging = WikiStudioServer.paginate([], q), depth = Math.min(200, paging.offset + paging.limit)
  WikiStudio.scan(w.root, true)
  var coverage = {}, indexHits = [], graphHits = []

  // Graph side: unavailable graphs are reported in coverage instead of failing the request.
  if (w.graph.enabled !== true) coverage.graph = { outcome: "unavailable", warning: "Graph is disabled for this wiki in Settings" }
  else if (!io.fileExists(w.root + "/.mini-a-wiki-graph/graph.json")) coverage.graph = { outcome: "unavailable", warning: "No graph snapshot yet; build the graph from Maintenance to enable graph search" }
  else {
    var gops = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "ro", usewikigraph: true, wikiretrievalv2: w.retrieval.v2 !== false })
    var gres = gops.execute(gops.spec("graph.retrieve", { query: q.q, cap: depth }))
    if (gres && gres.ok !== false && isArray(gres.pages)) {
      graphHits = gres.pages.map(function(page) { return { path: page.path, score: page.score, summary: page.summary || "", explanations: (page.explanations || []).slice(0, 5) } })
      coverage.graph = { outcome: gres.work && gres.work.truncated ? "partial" : "complete", warning: gres.work && gres.work.truncated ? "Graph traversal budget reached; lower-ranked pages may be missing" : null }
    } else coverage.graph = { outcome: "unavailable", warning: "Graph search failed: " + String((gres && gres.error) || "unknown error") }
  }

  // Index side only for combined mode.
  if (mode === "combined") {
    var iops = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "ro", usewikigraph: false, wikiretrievalv2: w.retrieval.v2 !== false })
    var ires = iops.execute(iops.spec("wiki.search", { query: q.q, limit: depth, offset: 0 }))
    if (ires && ires.ok !== false) {
      indexHits = isArray(ires.results) ? ires.results : []
      // The engine reports outcomes such as "hits"/"no-hits"; only partial or truncated runs are incomplete.
      var incomplete = ires.outcome === "partial" || ires.truncated === true
      coverage.index = { outcome: incomplete ? "partial" : "complete", warning: incomplete ? (ires.warning || "Index search coverage is incomplete") : null }
    } else coverage.index = { outcome: "unavailable", warning: "Index search failed: " + String((ires && ires.error) || "unknown error") }
  }

  // Reciprocal-rank fusion keyed by page path; each hit records which engines matched it.
  var merged = {}, order = [], k = 60
  function fold(hits, source) {
    hits.forEach(function(hit, i) {
      if (!isString(hit.path)) return
      var entry = merged[hit.path]
      if (isUnDef(entry)) { entry = merged[hit.path] = { path: hit.path, matchedBy: [], ranks: {}, fused: 0 }; order.push(hit.path) }
      entry.matchedBy.push(source)
      entry.ranks[source] = i + 1
      entry.fused += 1 / (k + i + 1)
      if (source === "index") ["title", "description", "snippet", "line", "score"].forEach(function(f) { if (isDef(hit[f]) && isUnDef(entry[f])) entry[f] = hit[f] })
      if (source === "graph") { entry.graphScore = hit.score; entry.explanations = hit.explanations; if (isUnDef(entry.description) && hit.summary) entry.description = hit.summary }
    })
  }
  fold(indexHits, "index")
  fold(graphHits, "graph")
  var results = order.map(function(path) { return merged[path] })
  results.sort(function(a, b) { return b.fused - a.fused || b.matchedBy.length - a.matchedBy.length || a.path.localeCompare(b.path) })
  results.forEach(function(r) { r.fused = Math.round(r.fused * 1e6) / 1e6 })
  var page = results.slice(paging.offset, paging.offset + paging.limit)
  var partial = Object.keys(coverage).some(function(key) { return coverage[key].outcome !== "complete" })
  var warnings = Object.keys(coverage).map(function(key) { return coverage[key].warning }).filter(function(v) { return isString(v) && v.length > 0 })
  return {
    ok: true,
    mode: mode,
    results: page,
    total: results.length,
    offset: paging.offset,
    limit: paging.limit,
    truncated: paging.offset + paging.limit < results.length || results.length >= depth && depth < 200,
    outcome: partial ? "partial" : "complete",
    coverage: coverage,
    warning: warnings.length ? warnings.join(" ") : (partial ? "Search coverage is incomplete; absence is not established." : null)
  }
}

WikiStudioServer.prototype.wikiRoute = function(req, w, parts, role) {
  var self = this, q = req.query || {}, body = req.body || {}, route = parts.join("/"), read = req.method === "GET"
  if (this.jobWikiRoute && ["dreams", "ingestions", "absorptions", "graph/rebuild", "graph/settings", "backups", "changes", "maintenance", "sources", "folders/preview", "folders/move", "folders/delete", "selection/preview", "selection/move", "selection/delete", "exports"].indexOf(route) >= 0 || this.jobWikiRoute && /^(backups|exports|sources)\//.test(route)) return this.jobWikiRoute(req, w, parts, role)
  return WikiStudio.wikiLock(this.config.home, w.id, function() {
    self.registry.verify(w)
    if (self.assertIdle) self.assertIdle(w.id)
    if (route === "children" && read) {
      var path = q.path || "", folder = path ? WikiStudio.safeFile(w.root,path,false) : w.root
      WikiStudio.assert(new java.io.File(folder).isDirectory(),404,"folder_not_found","Folder not found")
      var entries = io.listFiles(folder).files.filter(function(f) { return f.filename.charAt(0) !== "." && !/^AGENTS\.md$/i.test(f.filename) && (f.isDirectory || /\.md$/i.test(f.filename)) }).map(function(f) {
        WikiStudio.noLinks(f.filepath)
        return {name:f.filename,path:(path ? path+"/" : "")+f.filename,kind:f.isDirectory ? "folder" : "page"}
      }).sort(function(a,b) { return (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name) })
      return WikiStudioServer.paginate(entries,q)
    }
    if (route === "folders" && req.method === "POST") {
      WikiStudio.authorize(role, "editor", w)
      WikiStudio.assert(WikiStudio.pending(w.root).length===0,423,"recovery_pending","Pending journal; recover before creating folders")
      WikiStudio.fields(body, ["path"])
      WikiStudio.assert(isString(body.path) && body.path.length > 0, 400, "path_required", "Choose a folder path")
      WikiStudio.safeFile(w.root, body.path + "/index.md")
      WikiStudio.assert(!io.fileExists(w.root + "/" + body.path + "/index.md"), 409, "folder_exists", "Folder already exists")
      WikiStudio.scan(w.root, true)
      var created = self.manager(w, true, function(wm) { return wm.createFolder(body.path) })
      WikiStudio.assert(created && created.ok !== false, /folder-exists/.test(String(created && created.error)) ? 409 : 422, /folder-exists/.test(String(created && created.error)) ? "folder_exists" : "engine_error", "Folder could not be created")
      return created
    }
    if (route === "page" && read) return self.readPage(w, q.path)
    if (route === "graph/html" && read && self.graphHtml) return self.graphHtml(w)
    if (["page", "pages", "pages/move"].indexOf(route) >= 0 && !read) {
      WikiStudio.authorize(role, "editor", w)
      WikiStudio.assert(WikiStudio.pending(w.root).length===0,423,"recovery_pending","Pending ingestion/absorption journal; recover before manual page edits")
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
      if((route==="pages/move"||req.method==="DELETE")&&isFunction(WikiStudio.snapshot)) WikiStudio.snapshot(self.config,w,"manual-page-"+WikiStudio.id())
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
      if (route === "graph/stats" && (!w.graph.enabled || !io.fileExists(w.root + "/.mini-a-wiki-graph/graph.json"))) return { stats: { enabled: w.graph.enabled, snapshotAvailable: false }, source: "markdown-links-fallback", freshness: "No active extracted graph snapshot. The graph viewer uses current Markdown links.", semantic: "Not inferred; semantic extraction is opt-in" }
      if (route === "search" && isDef(q.mode) && q.mode !== "index") return self.modeSearch(w, q)
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
      var ops = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "ro", usewikigraph: w.graph.enabled, wikiretrievalv2: w.retrieval.v2 !== false }), res = ops.execute(ops.spec(op, params))
      WikiStudio.assert(res && res.ok !== false, 422, "engine_error", "Wiki operation failed", res)
      if (route === "overview") {
        var inventory = WikiStudio.scan(w.root,true)
        var pageCount = Object.keys(inventory).filter(function(path) { return /\.md$/i.test(path) && path.split("/").every(function(part) { return part.charAt(0) !== "." && !/^AGENTS\.md$/i.test(part) }) }).length
        return {context:res,studio:{pageCount:pageCount,fingerprint:WikiStudio.fingerprint(inventory),pendingRecovery:WikiStudio.pending(w.root),searchIndexPublished:io.fileExists(w.root+"/.mini-a-wiki-serving/current.json"),indexFreshness:"Inspect engine context/search warnings; presence alone does not prove currency",externalProcessesControlled:false}}
      }
      if (route === "graph/stats") return { stats: res, source: io.fileExists(w.root + "/.mini-a-wiki-graph/graph.json") ? "knowledge-graph-snapshot" : "markdown-links-fallback", freshness: "Snapshot freshness is not inferred from its presence; rebuild after external changes", semantic: "Not inferred; semantic extraction is opt-in" }
      return res
    }
    WikiStudio.fail(405, "method_not_allowed", "Method not allowed")
  })
}
