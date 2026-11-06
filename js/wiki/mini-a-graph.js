// Resolve the shared, model-free build contract from this package.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")
loadLib(__miniAPath("js/wiki/mini-a-graph-options.js"))

// Author: OpenAI Assistant
// License: Apache 2.0
// Description: Optional wiki knowledge-graph layer for Mini-A.

var MiniAWikiGraph = function(config, loggerFn) {
  this._cfg = isMap(config) ? config : {}
  this._log = isFunction(loggerFn) ? loggerFn : function() {}
  this._graphDir = isString(this._cfg.graphDir) && this._cfg.graphDir.trim().length > 0 ? String(this._cfg.graphDir).trim() : "./.mini-a-wiki-graph"
  this._communityAlgo = isString(this._cfg.communityAlgo) ? this._cfg.communityAlgo : "louvain"
  this._llmExtractFn = isFunction(this._cfg.llmExtractFn) ? this._cfg.llmExtractFn : __
  this._falkor = isMap(this._cfg.falkor) ? this._cfg.falkor : __
  this._readOnly = this._cfg.readOnly === true
  this._autosave = isString(this._cfg.autosave) ? String(this._cfg.autosave).toLowerCase().trim() : "always"
  if (["always", "debounced", "off"].indexOf(this._autosave) < 0) this._autosave = "always"
  this._saveDebounceMs = isNumber(this._cfg.saveDebounceMs) && this._cfg.saveDebounceMs >= 0 ? this._cfg.saveDebounceMs : 5000
  this._lastSaveAt = 0
  this._pendingSave = false
  this._falkorNeedsFullSync = false
  this._deletedEdges = 0
  this._state = this._emptyState()
  this.load()
}

MiniAWikiGraph.prototype._emptyState = function() {
  return {
    version: 2,
    created_at: new Date().toISOString(),
    nodes: {},
    edges: [],
    summaries: { pages: {}, communities: {} },
    semantic_cache: {},
    enrichment: {},
    communities: [],
    surprise: []
  }
}

// _hasFalkorRead: FalkorDB is reachable for queries. Read-only graphs are allowed here —
// an externally maintained FalkorDB is exactly what a read-only wiki should be consuming.
MiniAWikiGraph.prototype._hasFalkorRead = function() {
  return isMap(this._falkor) && isString(this._falkor.host) && this._falkor.host.trim().length > 0
}

// _hasFalkor: FalkorDB is writable (sync/diff/build). Read-only graphs never mutate it.
MiniAWikiGraph.prototype._hasFalkor = function() {
  return !this._readOnly && this._hasFalkorRead()
}

MiniAWikiGraph.prototype._ensureDir = function() {
  try { if (!io.fileExists(this._graphDir)) io.mkdir(this._graphDir) } catch(e) {}
}

MiniAWikiGraph.prototype._id = function(kind, value) {
  return kind + ":" + String(value || "")
}

MiniAWikiGraph.prototype._normalizeProvenance = function(provenance) {
  var allowed = { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true }
  var p = isString(provenance) ? provenance.toUpperCase().trim() : "AMBIGUOUS"
  return allowed[p] ? p : "AMBIGUOUS"
}

MiniAWikiGraph.prototype._edgeKey = function(from, to, type, provenance, props) {
  // A relationship assertion belongs to its source, not just its endpoints.
  return stringify([from, to, type, this._normalizeProvenance(provenance), isMap(props) ? props.page || "" : "", isMap(props) ? props.section || "" : ""], __, "")
}

MiniAWikiGraph.prototype._nodeBlob = function(id, props) {
  return (String(id || "") + " " + stringify(isMap(props) ? props : {}, __, "")).toLowerCase()
}

MiniAWikiGraph.prototype._upsertNode = function(id, type, props) {
  if (!isString(id) || id.length === 0) return
  if (!isMap(this._state.nodes[id])) this._state.nodes[id] = { id: id, type: type || "concept", props: {} }
  if (isString(type) && type.length > 0) this._state.nodes[id].type = type
  if (isMap(props)) this._state.nodes[id].props = merge(this._state.nodes[id].props, props)
  this._state.nodes[id]._blob = this._nodeBlob(id, this._state.nodes[id].props)
}

MiniAWikiGraph.prototype._fingerprint = function(text) {
  var s = isString(text) ? text : ""
  var h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff
  return "h" + h + "_" + s.length
}

MiniAWikiGraph.prototype._estimateTokens = function(text) {
  var chars = isString(text) ? text.length : 0
  return Math.max(1, Math.ceil(chars / 4))
}

MiniAWikiGraph.prototype._stripMarkdown = function(text) {
  var s = isString(text) ? String(text) : ""
  if (s.length === 0) return ""
  s = s.replace(/```[\s\S]*?```/g, " ")
  s = s.replace(/`([^`]+)`/g, "$1")
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1")
  s = s.replace(/^#+\s+/gm, "")
  s = s.replace(/[*_~>#-]+/g, " ")
  s = s.replace(/\s+/g, " ").trim()
  return s
}

MiniAWikiGraph.prototype._normalizeConceptName = function(text) {
  var s = this._stripMarkdown(text)
  if (s.length === 0) return ""
  s = s.replace(/\.[a-z0-9]+$/i, "")
  s = s.replace(/\s+/g, " ").trim()
  return s
}

MiniAWikiGraph.prototype._semanticSummaryFor = function(payload) {
  var lines = isString(payload && payload.body) ? payload.body.split(/\r?\n/) : []
  for (var i = 0; i < lines.length; i++) {
    var line = this._stripMarkdown(lines[i])
    if (line.length === 0) continue
    if (String(lines[i] || "").match(/^#{1,6}\s+/)) continue
    return line.substring(0, 300)
  }
  var fallback = this._normalizeConceptName(payload && payload.title)
  return fallback.substring(0, 300)
}

MiniAWikiGraph.prototype._pageDigest = function(p) {
  var title = isMap(p.meta) && isString(p.meta.title) ? p.meta.title : p.path
  var first = ""
  var lines = isString(p.body) ? p.body.split(/\r?\n/) : []
  for (var i = 0; i < lines.length; i++) {
    var l = String(lines[i] || "").trim()
    if (l.length === 0) continue
    first = l.startsWith("#") ? l.replace(/^#+\s*/, "") : l
    break
  }
  return title + (first.length > 0 ? " - " + first.substring(0, 120) : "")
}

MiniAWikiGraph.prototype._ensureIndexes = function() {
  if (!isMap(this._state._edgeIndex)) this._state._edgeIndex = {}
  if (!isMap(this._adj)) this._adj = {}
  if (!isMap(this._nodeRefs)) this._nodeRefs = {}
  if (!isMap(this._semanticByPage)) this._semanticByPage = {}
  if (!isMap(this._dirty)) this._dirty = { communities: true, surprise: true }
}

MiniAWikiGraph.prototype._reindexEdges = function() {
  this._state._edgeIndex = {}
  this._adj = {}
  this._nodeRefs = {}
  this._semanticByPage = {}
  this._deletedEdges = 0
  var compact = []
  var self = this
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (!isMap(e) || e._deleted === true) return
    e.provenance = self._normalizeProvenance(e.provenance)
    var key = self._edgeKey(e.from, e.to, e.type, e.provenance, e.props)
    if (self._state._edgeIndex[key]) return
    self._state._edgeIndex[key] = true
    compact.push(e)
    self._indexSemanticOwner(e)
    self._adj[e.from] = self._adj[e.from] || []
    self._adj[e.to] = self._adj[e.to] || []
    self._adj[e.from].push(e)
    self._adj[e.to].push(e)
    self._nodeRefs[e.from] = (self._nodeRefs[e.from] || 0) + 1
    self._nodeRefs[e.to] = (self._nodeRefs[e.to] || 0) + 1
  })
  this._state.edges = compact
  var nodes = this._state.nodes, self = this
  Object.keys(nodes).forEach(function(id) {
    nodes[id]._blob = self._nodeBlob(id, nodes[id].props)
  })
  if (isArray(this._state.communities)) {
    this._state.communities.forEach(function(comm) {
      comm._memberSet = {}
      ;(isArray(comm.members) ? comm.members : []).forEach(function(id) { comm._memberSet[id] = true })
    })
  }
  this._ensureIndexes()
}

MiniAWikiGraph.prototype._indexSemanticOwner = function(edge) {
  if ((String(edge.from).indexOf("concept:") !== 0 && String(edge.to).indexOf("concept:") !== 0) || !edge.props || !isString(edge.props.page)) return
  var path = edge.props.page
  if (!this._semanticByPage[path]) this._semanticByPage[path] = []
  this._semanticByPage[path].push(edge)
}

MiniAWikiGraph.prototype._addEdge = function(from, to, type, provenance, props) {
  if (!isString(from) || from.length === 0 || !isString(to) || to.length === 0 || !isString(type) || type.length === 0) return
  this._ensureIndexes()
  if (!isMap(this._state.nodes[from]) || !isMap(this._state.nodes[to])) return
  var prov = this._normalizeProvenance(provenance)
  var key = this._edgeKey(from, to, type, prov, props)
  if (this._state._edgeIndex[key]) return
  var edge = { from: from, to: to, type: type, provenance: prov, props: isMap(props) ? props : {} }
  this._state._edgeIndex[key] = true
  this._state.edges.push(edge)
  this._indexSemanticOwner(edge)
  this._adj[from] = this._adj[from] || []
  this._adj[to] = this._adj[to] || []
  this._adj[from].push(edge)
  this._adj[to].push(edge)
  this._nodeRefs[from] = (this._nodeRefs[from] || 0) + 1
  this._nodeRefs[to] = (this._nodeRefs[to] || 0) + 1
}

MiniAWikiGraph.prototype._removeEdge = function(edge) {
  if (!isMap(edge) || edge._deleted === true) return
  this._ensureIndexes()
  edge._deleted = true
  var key = this._edgeKey(edge.from, edge.to, edge.type, edge.provenance, edge.props)
  delete this._state._edgeIndex[key]
  var self = this
  ;[edge.from, edge.to].forEach(function(id) {
    var list = isArray(self._adj[id]) ? self._adj[id] : []
    self._adj[id] = list.filter(function(ref) { return ref !== edge && ref._deleted !== true })
    self._nodeRefs[id] = Math.max(0, (self._nodeRefs[id] || 0) - 1)
  })
  if (edge.props && this._semanticByPage[edge.props.page]) this._semanticByPage[edge.props.page] = this._semanticByPage[edge.props.page].filter(function(e) { return e !== edge })
  this._deletedEdges++
}

MiniAWikiGraph.prototype._compactEdges = function(force) {
  if (force !== true && this._deletedEdges < 1024) return
  this._state.edges = this._state.edges.filter(function(e) { return isMap(e) && e._deleted !== true })
  this._deletedEdges = 0
  this._reindexEdges()
}

MiniAWikiGraph.prototype._pageHash = function(p) {
  return sha1(stringify({ discoveryVersion: 1, body: p.body || "", meta: p.meta || {}, links: p.links || [], revision: p.revision || "" }, __, ""))
}

MiniAWikiGraph.prototype._indexPageStructural = function(p) {
  if (!isMap(p) || !isString(p.path)) return { hash: "", docId: "" }
  var docId = this._id("doc", p.path)
  var newHash = this._pageHash(p)
  this._upsertNode(docId, "document", {
    path: p.path,
    title: isMap(p.meta) && isString(p.meta.title) ? p.meta.title : p.path,
    updated: isMap(p.meta) && isDef(p.meta.updated) ? String(p.meta.updated) : "",
    hash: newHash,
    revision: p.revision || newHash
  })

  // Published, deterministic discovery keys. Query-time joins reuse the bounded
  // adjacency index; no corpus scan, inferred prose, or edits to source pages.
  var generic = /^(readme|index|usage|guide|reference|overview|documentation|docs|source|src|tests?|api|configuration|common|openaf|opacks?|the|and|for|with|from|this|that|file|files)$/
  var discovery = {}, values = [p.meta && p.meta.title, p.meta && p.meta.source]
  values.forEach(function(value) {
    if (!isString(value)) return
    var normalized=value.toLowerCase().replace(/\.[a-z0-9]+$/," ").replace(/[^a-z0-9_-]+/g," ").trim()
    var keys=normalized.split(/\s+/)
    if (keys.length>1 && keys.length<=5) keys.unshift(normalized)
    keys.slice(0,12).forEach(function(key){if(key.length>=4 && key.length<=80 && !generic.test(key))discovery[key]=true})
  })
  Object.keys(discovery).slice(0,8).forEach(function(key) {
    var id=this._id("discovery",key)
    this._upsertNode(id,"discovery",{value:key})
    this._addEdge(docId,id,"HAS_DISCOVERY_KEY","EXTRACTED",{derived:true})
  },this)

  var tags = isMap(p.meta) && isArray(p.meta.tags) ? p.meta.tags : []
  for (var t = 0; t < tags.length; t++) {
    var tag = String(tags[t] || "").trim().toLowerCase()
    if (tag.length === 0) continue
    var tagId = this._id("tag", tag)
    this._upsertNode(tagId, "tag", { name: tag })
    this._addEdge(docId, tagId, "HAS_TAG", "EXTRACTED", {})
  }

  var aliases = isMap(p.meta) && isArray(p.meta.aliases) ? p.meta.aliases : []
  for (var a = 0; a < aliases.length; a++) {
    var alias = String(aliases[a] || "").trim()
    if (alias.length === 0) continue
    var aliasId = this._id("alias", alias.toLowerCase())
    this._upsertNode(aliasId, "alias", { value: alias })
    this._addEdge(aliasId, docId, "ALIAS_OF", "EXTRACTED", {})
  }

  if (isMap(p.meta) && isString(p.meta.supersedes) && p.meta.supersedes.trim().length > 0) {
    var supPath = p.meta.supersedes.trim()
    var supId = this._id("doc", supPath)
    this._upsertNode(supId, "document", { path: supPath })
    this._addEdge(docId, supId, "SUPERSEDES", "EXTRACTED", {})
  }

  var links = isArray(p.links) ? p.links : []
  for (var l = 0; l < links.length; l++) {
    var target = String(links[l] || "").trim()
    if (target.length === 0) continue
    var targetId = this._id("doc", target)
    this._upsertNode(targetId, "document", { path: target })
    this._addEdge(docId, targetId, "LINKS_TO", "EXTRACTED", {})
  }

  var lines = isString(p.body) ? p.body.split(/\r?\n/) : []
  for (var h = 0; h < lines.length; h++) {
    var m = String(lines[h] || "").match(/^(#{1,6})\s+(.+)$/)
    if (!m) continue
    var heading = String(m[2] || "").trim()
    if (heading.length === 0) continue
    var secId = this._id("section", p.path + "#" + heading.toLowerCase())
    this._upsertNode(secId, "section", { page: p.path, heading: heading, level: m[1].length })
    this._addEdge(docId, secId, "IN_SECTION", "EXTRACTED", { level: m[1].length })
  }

  if (!isMap(this._state.summaries.pages)) this._state.summaries.pages = {}
  if (!isMap(this._state.summaries.pages[p.path])) this._state.summaries.pages[p.path] = {}
  this._state.summaries.pages[p.path].digest = this._pageDigest(p)
  this._state.summaries.pages[p.path].hash = newHash
  if (!this._state.enrichment[p.path]) this._state.enrichment[p.path] = { hash: newHash, status: "pending", completed: {} }
  return { hash: newHash, docId: docId }
}

MiniAWikiGraph.prototype._edgeOwnedByPage = function(edge, path) {
  if (!isMap(edge) || !isString(path) || path.length === 0) return false
  if (isMap(edge.props) && isString(edge.props.page) && edge.props.page === path) return true
  if (edge.type === "HAS_DISCOVERY_KEY" || edge.type === "HAS_TAG" || edge.type === "SUPERSEDES" || edge.type === "LINKS_TO" || edge.type === "IN_SECTION") {
    return edge.from === this._id("doc", path)
  }
  if (edge.type === "ALIAS_OF") return edge.to === this._id("doc", path)
  return false
}

MiniAWikiGraph.prototype._nodeOwnedByPage = function(id, node, path) {
  if (!isString(id) || !isMap(node) || !isString(path) || path.length === 0) return false
  if (id === this._id("doc", path)) return true
  return node.type === "section" && isMap(node.props) && node.props.page === path
}

MiniAWikiGraph.prototype._pruneUnreferencedNodes = function(path) {
  var self = this
  Object.keys(this._state.nodes).forEach(function(id) {
    var node = self._state.nodes[id]
    var refs = self._nodeRefs[id] || 0
    var keep = refs > 0
    if (!keep && isMap(node) && node.type === "document" && isMap(node.props) && isString(node.props.path) && node.props.path !== path) keep = true
    if (!keep) delete self._state.nodes[id]
  })
}

MiniAWikiGraph.prototype._removePageState = function(path) {
  if (!isString(path) || path.length === 0) return { deleteNodes: [], deleteEdges: [] }
  this._ensureIndexes()
  var beforeNodes = Object.keys(this._state.nodes)
  var deleteNodes = {}
  var deleteEdges = []
  var self = this
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(edge) {
    if (edge._deleted === true) return
    if (self._edgeOwnedByPage(edge, path)) {
      deleteEdges.push({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        provenance: edge.provenance,
        props: isMap(edge.props) ? clone(edge.props) : {}
      })
      self._removeEdge(edge)
    }
  })

  Object.keys(this._state.nodes).forEach(function(id) {
    var node = self._state.nodes[id]
    if (self._nodeOwnedByPage(id, node, path)) deleteNodes[id] = true
  })

  this._compactEdges(false)
  this._pruneUnreferencedNodes(path)
  Object.keys(deleteNodes).forEach(function(id) {
    if ((self._nodeRefs[id] || 0) <= 0 && isMap(self._state.nodes[id]) && self._nodeOwnedByPage(id, self._state.nodes[id], path)) delete self._state.nodes[id]
  })

  if (this._state.enrichment) delete this._state.enrichment[path]
  delete this._state.semantic_cache[path]
  if (isMap(this._state.summaries.pages)) delete this._state.summaries.pages[path]
  return { deleteNodes: beforeNodes.filter(function(id) { return !isMap(self._state.nodes[id]) }), deleteEdges: deleteEdges }
}

MiniAWikiGraph.prototype._markDerivedDirty = function() {
  this._ensureIndexes()
  this._dirty.communities = true
  this._dirty.surprise = true
  this._joinKeysDirty = true
}

MiniAWikiGraph.prototype._ensureDerived = function() {
  this._ensureIndexes()
  if (this._dirty.communities) this.detectCommunities()
  if (this._dirty.surprise) this.crossDocumentSurprise()
}

MiniAWikiGraph.prototype._scheduleSave = function(diff) {
  if (this._readOnly) return { ok: true, readOnly: true }
  if (this._autosave === "off") return { ok: true, autosave: "off" }
  if (this._autosave === "debounced") {
    var nowMs = now()
    if (this._lastSaveAt > 0 && (nowMs - this._lastSaveAt) < this._saveDebounceMs) {
      this._falkorNeedsFullSync = true
      this._pendingSave = true
      return { ok: true, debounced: true }
    }
  }
  return this._persist(diff)
}

MiniAWikiGraph.prototype._persist = function(diff) {
  if (this._readOnly) return { ok: true, readOnly: true }
  this._compactEdges(true)
  var syncResult = { ok: true }
  if (this._hasFalkor()) {
    if (this._falkorNeedsFullSync === true || !isMap(diff)) syncResult = this.falkorSync()
    else syncResult = this.falkorApplyDiff(diff)
    if (!isMap(syncResult) || syncResult.ok !== true) {
      this._falkorNeedsFullSync = true
      this._log("warn", "[graph] FalkorDB sync failed: " + (isMap(syncResult) ? syncResult.error : "unknown error"))
    } else {
      this._falkorNeedsFullSync = false
    }
  }
  this.save()
  this._lastSaveAt = now()
  this._pendingSave = false
  return syncResult
}

MiniAWikiGraph.prototype.buildStructural = function(pages, opts) {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  var options = isMap(opts) ? opts : {}
  var list = isArray(pages) ? pages : []
  var oldSummaries = this._state.summaries.pages, oldCache = this._state.semantic_cache, oldEnrichment = this._state.enrichment || {}
  var oldSemanticEdges = []
  var semanticNodeIds = {}
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    var prov = String(e.provenance || "").toUpperCase()
    if (e._deleted !== true && (isMap(e.props) && isString(e.props.page) || prov === "INFERRED" || prov === "AMBIGUOUS")) {
      oldSemanticEdges.push({
        from: e.from, to: e.to, type: e.type, provenance: e.provenance, props: isMap(e.props) ? clone(e.props) : {}
      })
      semanticNodeIds[e.from] = true
      semanticNodeIds[e.to] = true
    }
  })
  var oldNodes = this._state.nodes

  this._state = this._emptyState()
  this._reindexEdges()
  for (var i = 0; i < list.length; i++) { this._indexPageStructural(list[i]); if (isFunction(options.onStructuralProgress) && (i + 1) % 25 === 0) options.onStructuralProgress(i + 1) }
  var unchanged = {}
  list.forEach(function(page) {
    if (oldSummaries[page.path] && oldSummaries[page.path].hash === this._pageHash(page)) {
      unchanged[page.path] = true
      this._state.summaries.pages[page.path] = clone(oldSummaries[page.path])
      if (oldCache[page.path]) this._state.semantic_cache[page.path] = clone(oldCache[page.path])
      if (oldEnrichment[page.path]) this._state.enrichment[page.path] = clone(oldEnrichment[page.path])
    }
  }, this)
  Object.keys(semanticNodeIds).forEach(function(nodeId) {
    var node = oldNodes[nodeId]
    if (!isMap(node)) return
    // Only preserve non-structural semantic nodes across rebuilds.
    // Document nodes are recreated from the new structural page list.
    if (node.type === "document") return
    if (!isMap(this._state.nodes[nodeId])) this._upsertNode(nodeId, node.type, isMap(node.props) ? clone(node.props) : {})
  }, this)
  for (var j = 0; j < oldSemanticEdges.length; j++) {
    var se = oldSemanticEdges[j]
    if (!isMap(se.props) || !unchanged[se.props.page]) continue
    if (!isMap(this._state.nodes[se.from]) || !isMap(this._state.nodes[se.to])) continue
    this._addEdge(se.from, se.to, se.type, se.provenance, se.props)
  }
  this._pruneUnreferencedNodes("")
  this._markDerivedDirty()
  this._ensureDerived()
  if (options.preview !== true) this._persist()
  return this.stats()
}

MiniAWikiGraph.prototype.updatePage = function(p) {
  if (this._readOnly) return {ok:false,error:"graph is read-only"}
  if (!isMap(p) || !isString(p.path)) return { ok: false, error: "path is required" }
  var newHash = this._pageHash(p)
  var prev = isMap(this._state.summaries.pages[p.path]) ? this._state.summaries.pages[p.path] : __
  if (isMap(prev) && prev.hash === newHash) return { ok: true, changed: false }
  var removed = this._removePageState(p.path)
  var beforeNodes = {}
  Object.keys(this._state.nodes).forEach(function(id) { beforeNodes[id] = true })
  this._indexPageStructural(p)
  var upsertNodes = []
  var self = this
  Object.keys(this._state.nodes).forEach(function(id) {
    if (!beforeNodes[id] || self._nodeOwnedByPage(id, self._state.nodes[id], p.path) || (isMap(self._state.nodes[id].props) && self._state.nodes[id].props.path === p.path)) {
      upsertNodes.push(clone(self._state.nodes[id]))
    }
  })
  var upsertEdges = []
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(edge) {
    if (edge._deleted === true) return
    if (self._edgeOwnedByPage(edge, p.path)) upsertEdges.push({
      from: edge.from, to: edge.to, type: edge.type, provenance: edge.provenance, props: isMap(edge.props) ? clone(edge.props) : {}
    })
  })
  this._markDerivedDirty()
  this._scheduleSave({
    upsertNodes: upsertNodes,
    deleteNodes: removed.deleteNodes,
    upsertEdges: upsertEdges,
    deleteEdges: removed.deleteEdges
  })
  return { ok: true, changed: true, stats: this.stats() }
}

MiniAWikiGraph.prototype.removePage = function(path) {
  if (this._readOnly) return {ok:false,error:"graph is read-only"}
  if (!isString(path) || path.length === 0) return { ok: false, error: "path is required" }
  var removed = this._removePageState(path)
  var placeholder = this._state.nodes[this._id("doc", path)]
  if (placeholder) {
    placeholder.props = { path: path }
    placeholder._blob = this._nodeBlob(placeholder.id, placeholder.props)
  }
  this._markDerivedDirty()
  this._scheduleSave({
    upsertNodes: placeholder ? [clone(placeholder)] : [],
    deleteNodes: removed.deleteNodes,
    upsertEdges: [],
    deleteEdges: removed.deleteEdges
  })
  return { ok: true, changed: true, stats: this.stats() }
}

// All semantic evidence uses body offsets (UTF-16), one-based body lines and a section ID.
// Sections are split into bounded windows, so late-page evidence is never truncated away.
MiniAWikiGraph.prototype._semanticSections = function(page) {
  var body = String(page.body || ""), lines = body.split(/\n/), out = [], start = 0, line = 1, section = "", text = "", offset = 0
  var flush = function() { if (text.length) out.push({ section: section, start: start, line: line, text: text }); text = "" }
  lines.forEach(function(value, index) {
    var heading = value.match(/^#{1,6}\s+(.+)/)
    if (heading || text.length + value.length > 6000) { flush(); start = offset; line = index + 1 }
    if (heading) section = heading[1].trim() + "@" + (index + 1)
    var remaining = value + (index < lines.length - 1 ? "\n" : "")
    while (remaining.length > 6000) {
      flush(); start = offset; line = index + 1; text = remaining.substring(0, 6000); flush()
      remaining = remaining.substring(6000); offset += 6000; start = offset
    }
    text += remaining; offset += remaining.length
  })
  flush(); return out
}

MiniAWikiGraph.prototype._conceptVocabulary = function(pages) {
  var names = {}, first = {}, self = this
  pages.forEach(function(page) {
    var meta = page.meta || {}, title = String(meta.title || page.path.replace(/\.md$/, "").split("/").pop())
    ;[title].concat(isArray(meta.aliases) ? meta.aliases : []).forEach(function(name) {
      name = String(name).trim()
      if (!self._usefulConcept(name)) return
      if (!names[name]) names[name] = []
      var id = "concept:page:" + page.path + ":" + title
      if (!names[name].some(function(x) { return x.id === id })) names[name].push({ id: id, name: title, joinable: false })
    })
  })
  Object.keys(names).sort().forEach(function(name) {
    var token = (name.match(/[A-Za-z0-9_$][A-Za-z0-9_.$:+#/-]*/) || [""])[0]
    if (!first[token]) first[token] = []
    first[token].push(name)
  })
  return { names: names, first: first, hash: sha1(stringify(names, __, "")) }
}

MiniAWikiGraph.prototype._usefulConcept = function(value) {
  return value.length >= 2 && value.length <= 100 && !/^(the|and|for|with|from|this|that|file|files|page|pages|readme|index|usage|guide|reference|overview|documentation|docs|source|src|tests?|api|configuration|common|example|examples|introduction|notes|true|false|null|undefined|return|var|function|const|let)$/i.test(value)
}

MiniAWikiGraph.prototype._deterministicMentions = function(page, sections, vocabulary) {
  var self = this, result = []
  sections.forEach(function(section) {
    var seen = {}, count = 0, re = /[A-Za-z_$][A-Za-z0-9_.$:+#/-]*/g, match
    var add = function(term, index, identity) {
      if (count >= 64 || !self._usefulConcept(term)) return
      var id = identity ? identity.id : "concept:id:" + term
      if (seen[id]) return
      seen[id] = true; count++
      result.push({ id: id, name: identity ? identity.name : term, joinable: identity ? identity.joinable : true,
        props: { page: page.path, revision: page.revision || self._pageHash(page), sourceHash: self._pageHash(page), section: section.section,
          evidenceLayer: "grounded", method: "deterministic", confidence: 1, evidence: { start: section.start + index, end: section.start + index + term.length, line: section.line + section.text.substring(0, index).split("\n").length - 1, quote: term } } })
    }
    while ((match = re.exec(section.text)) !== null) {
      var token = match[0].replace(/[.:/-]+$/, ""), index = match.index
      ;(vocabulary.first[token] || []).slice(0, 32).forEach(function(name) {
        if (section.text.substring(index, index + name.length) !== name || /[A-Za-z0-9_$]/.test(section.text.charAt(index + name.length))) return
        var choices = vocabulary.names[name]
        if (choices.length === 1) add(name, index, choices[0])
      })
      // Technical names and inline code only; no generic capitalized-prose heuristic.
      if (!(vocabulary.names[token] && vocabulary.names[token].length > 1) && (/^[A-Z][A-Z0-9_]{1,}$/.test(token) || /[a-z][A-Z]|[A-Za-z][._:$][A-Za-z]|\+\+|#$/.test(token) || section.text.charAt(index - 1) === "`")) add(token, index)
    }
  })
  return result
}

MiniAWikiGraph.prototype._currentEvidence = function(edge) {
  var p = edge.props || {}, node = this._state.nodes["doc:" + p.page]
  return !edge._deleted && p.evidenceLayer === "grounded" && isMap(p.evidence) && !!node && node.props.hash === p.sourceHash && (!p.revision || p.revision === node.props.revision)
}

MiniAWikiGraph.prototype.build = function(pages, options) {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  var opts = merge(options || {}, MiniAGraphBuild.resolve(options)), list = pages || [], self = this, started = Date.now()
  var report = {ok:true,stage:"structural",processed:0,cached:0,pending:0,failed:0,calls:0,estimatedTokens:0,effective:MiniAGraphBuild.resolve(opts)}
  var progress = function(count) { report.processed=count;report.elapsedMs=Date.now()-started;if(isFunction(opts.onProgress))opts.onProgress(merge(clone(report),{index:count,total:list.length})) }
  progress(0)
  if (opts.strategy === "full") this.buildStructural(list, { preview: true, onStructuralProgress:progress })
  else {
    var present = {}, autosave = this._autosave; this._autosave = "off"
    try {
      list.forEach(function(page,index) { present[page.path] = true; self.updatePage(page); if((index+1)%25===0)progress(index+1) })
      Object.keys(this._state.summaries.pages).forEach(function(path) { if (!present[path]) self.removePage(path) })
    } finally { this._autosave = autosave }
  }
  if (opts.extraction === "semantic") return this.buildSemantic(list, opts)
  report.pending = Object.keys(this._state.enrichment || {}).filter(function(k) { return self._state.enrichment[k].status !== "complete" }).length
  report.stage="complete";report.status="complete";report.resumable=report.pending>0;report.structural=this.stats()
  progress(list.length);this._state.build_status=clone(report)
  if (opts.preview !== true) this._persist()
  return report
}

MiniAWikiGraph.prototype.buildSemantic = function(pages, options) {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  options = options || {}
  var opts = merge(options, MiniAGraphBuild.resolve(merge({ extraction: "semantic", modelHelp: "auto" }, options)))
  if (opts.extraction === "structural") return this.build(pages, opts)
  var self = this, list = pages || [], started = Date.now(), vocabulary = this._conceptVocabulary(list)
  var report = { ok: true, stage: "deterministic", processed: 0, cached: 0, pending: 0, failed: 0, calls: 0, estimatedTokens: 0, changed: 0, effective: MiniAGraphBuild.resolve(opts) }
  if (isUnDef(this._cfg.modelExtractors) && !isFunction(this._llmExtractFn) && opts.modelHelp === "auto") {
    var adapters = MiniAGraphBuild.modelAdapters()
    this._cfg.modelExtractors = adapters.models; this._cfg.decisionExtractor = adapters.decision
  }
  var models = this._cfg.modelExtractors || (isFunction(this._llmExtractFn) ? [{ role: "main", fingerprint: this._cfg.modelFingerprint || "custom-v1", extract: this._llmExtractFn }] : [])
  var fingerprint = sha1(stringify(models.map(function(m) { return [m.role, m.fingerprint || "custom-v1"] }).concat(this._cfg.decisionExtractor ? [["decision", this._cfg.decisionExtractor.fingerprint]] : []), __, ""))
  var stopped = "", checkpoint = function() {
    report.pending = list.filter(function(page) { var state = self._state.enrichment[page.path]; return state && state.status !== "complete" }).length
    report.elapsedMs = Date.now() - started
    self._state.build_status = clone(report)
    self._compactEdges(true)
    self._markDerivedDirty(); self._ensureDerived()
    if (opts.preview !== true) self.save()
    if (isFunction(opts.onProgress)) opts.onProgress(merge(clone(report), { index: report.processed, total: list.length, status: stopped || report.stage }))
  }
  var call = function(model, payload) {
    var tokens = self._estimateTokens(stringify(payload, __, "")) + 2048
    if (isFunction(opts.isCancelled) && opts.isCancelled()) stopped = "cancelled"
    if (Date.now() - started >= opts.maxMinutes * 60000) stopped = stopped || "time-budget"
    if (report.calls >= opts.maxCalls) stopped = stopped || "call-budget"
    if (report.estimatedTokens + tokens > opts.maxTokens) stopped = stopped || "token-budget"
    if (stopped) return null
    report.calls++; report.estimatedTokens += tokens
    try { return model.extract(payload) } catch(e) { return { ok: false, error: "model-extraction-failed" } }
  }
  if (!isMap(this._state.enrichment)) this._state.enrichment = {}
  // Deterministic publication always precedes optional model work.
  list.forEach(function(page) {
    if (!self._state.summaries.pages[page.path] || self._state.summaries.pages[page.path].hash !== self._pageHash(page)) { self._removePageState(page.path); self._indexPageStructural(page) }
    var hash = self._pageHash(page), sections = self._semanticSections(page), key = sha1(hash + vocabulary.hash + ":extractor-2:prompt-2:" + fingerprint)
    var previous = self._state.enrichment[page.path], unchanged = previous && previous.key === key
    if (!unchanged || opts.force) {
      var deterministic = self._deterministicMentions(page, sections, vocabulary)
      ;(self._semanticByPage[page.path] || []).slice().forEach(function(e) { if (e.props.method === "deterministic" || e.props.sourceHash !== hash || !e.props.evidenceLayer) self._removeEdge(e) })
      deterministic.forEach(function(m) {
        self._upsertNode(m.id, "concept", { name: m.name, joinable: m.joinable })
        self._addEdge("doc:" + page.path, m.id, "MENTIONS", "EXTRACTED", m.props)
      })
      self._state.enrichment[page.path] = { key: key, hash: hash, version: 2, promptVersion: 2, modelFingerprint: fingerprint, completed: unchanged && previous ? clone(previous.completed) : {}, status: "pending" }
      if (opts.force) self._state.enrichment[page.path].completed = {}
      report.changed++
    }
    self._state.summaries.pages[page.path].summary = self._semanticSummaryFor({ body: page.body, title: (page.meta || {}).title })
    self._state.semantic_cache[page.path] = { hash: hash, schema_version: 2, prompt_version: 2, model: fingerprint, vocabulary: vocabulary.hash }
  })
  list.forEach(function(page) {
    var state = self._state.enrichment[page.path], dependencies = [], seen = {}
    self._semanticSections(page).forEach(function(section) {
      ;(self._semanticByPage[page.path] || []).filter(function(e) {return e.props.method === "deterministic" && e.props.section === section.section}).slice(0,16).forEach(function(e) {
        ;(self._adj[e.to] || []).slice(0,32).forEach(function(other) {
          var owner = other.props.page, dependency = e.to + ":" + owner
          if (owner && owner !== page.path && !seen[dependency] && other.props.method === "deterministic" && self._currentEvidence(other)) {
            seen[dependency] = true; dependencies.push([dependency,other.props.sourceHash])
          }
        })
      })
    })
    var dependencyHash = sha1(stringify(dependencies.sort(function(a,b){return a[0].localeCompare(b[0])}),__,""))
    if (state.dependencyHash && state.dependencyHash !== dependencyHash) {state.completed={};state.status="pending"}
    state.dependencyHash = dependencyHash
  })
  this._markDerivedDirty(); checkpoint()
  report.stage = "enrichment"
  for (var p = 0; p < list.length; p++) {
    var page = list[p], state = this._state.enrichment[page.path], sections = this._semanticSections(page), failed = false
    if (isFunction(opts.isCancelled) && opts.isCancelled()) stopped = "cancelled"
    for (var s = 0; s < sections.length; s++) {
      var section = sections[s], sectionKey = String(section.start)
      if (state.completed[sectionKey]) { report.cached++; continue }
      if (opts.modelHelp === "off" || !models.length || stopped) continue
      var mentions = (this._semanticByPage[page.path] || []).filter(function(e) { return self._currentEvidence(e) && e.props.method === "deterministic" && e.props.section === section.section })
      var candidates = {}, cross = []
      mentions.slice(0, 16).forEach(function(e) {
        ;(self._adj[e.to] || []).slice(0, 32).forEach(function(other) {
          var owner = other.props.page
          if (owner && owner !== page.path && !candidates[owner] && other.props.method === "deterministic" && self._currentEvidence(other) && cross.length < 16) { candidates[owner] = true; cross.push({ path: owner, concept: e.to, evidence: other.props.evidence }) }
        })
      })
      var payload = { path: page.path, title: (page.meta || {}).title || page.path, section: section.section, start: section.start, body: section.text, concepts: mentions.map(function(e) { return self._state.nodes[e.to].props.name }), candidates: cross,
        instruction: "Return {relationships:[{from,to,type,provenance,confidence,evidence:{quote}}]}. Quote exact text from this section supporting both endpoints. Use INFERRED for associations, EXTRACTED only for explicit assertions. Empty relationships is valid. Do not merge identities." }
      if (cross.length && this._cfg.decisionExtractor) {
        var classified = call(this._cfg.decisionExtractor, { section: section.text, candidates: cross })
        if (classified && isArray(classified.paths)) payload.candidates = cross.filter(function(candidate) { return classified.paths.slice(0, 8).indexOf(candidate.path) >= 0 })
        if (stopped) break
      }
      var response = null
      for (var attempt = 0; attempt < models.length; attempt++) {
        var attemptResponse = call(models[attempt], payload)
        if (!attemptResponse) break
        response = attemptResponse
        if (response && response.ok !== false && isArray(response.relationships) && response.needsContext !== true && response.relationships.length <= 32 && response.relationships.every(function(rel) {
          var quote = rel && rel.evidence && rel.evidence.quote
          return isString(quote) && quote.length > 0 && section.text.indexOf(quote) >= 0 && isString(rel.from) && isString(rel.to) && self._usefulConcept(rel.from) && self._usefulConcept(rel.to) && quote.indexOf(rel.from) >= 0 && quote.indexOf(rel.to) >= 0
        })) break
        if (response) response = { ok: false, error: "invalid-extraction" }
        if (stopped) break
      }
      if (stopped && !response) break
      if (!response || response.ok === false || !isArray(response.relationships) || response.needsContext === true) { failed = true; report.failed++; continue }
      var validated = [], invalid = false
      response.relationships.slice(0, 32).forEach(function(rel) {
        var quote = rel && rel.evidence && rel.evidence.quote, from = rel && rel.from, to = rel && rel.to
        var at = isString(quote) && quote.length > 0 ? section.text.indexOf(quote) : -1
        if (!isString(from) || !isString(to) || at < 0 || quote.indexOf(from) < 0 || quote.indexOf(to) < 0 || !self._usefulConcept(from) || !self._usefulConcept(to)) { invalid = true; return }
        var resolve = function(name) {
          var known = vocabulary.names[name]
          return known && known.length === 1 ? known[0].id : "concept:" + (known && known.length > 1 ? "ambiguous:" + page.path + ":" : "id:") + name
        }
        validated.push({ from: resolve(from), to: resolve(to), type: /^[A-Z][A-Z0-9_]{0,40}$/.test(rel.type || "") ? rel.type : "RELATED_TO", provenance: rel.provenance === "EXTRACTED" ? "EXTRACTED" : "INFERRED", names: [from, to],
          props: { page: page.path, revision: page.revision || state.hash, sourceHash: state.hash, section: section.section, window: section.start, method: "model", evidenceLayer: rel.provenance === "EXTRACTED" ? "grounded" : "inferred", confidence: isNumber(rel.confidence) && isFinite(rel.confidence) ? Math.max(0, Math.min(1, rel.confidence)) : 0.5, evidence: { quote: quote, start: section.start + at, end: section.start + at + quote.length, line: section.line + section.text.substring(0, at).split("\n").length - 1 } } })
      })
      if (invalid || response.relationships.length > 32) { failed = true; report.failed++; continue }
      // Commit a window only after complete validation. Failed refreshes retain valid old assertions.
      ;(this._semanticByPage[page.path] || []).slice().forEach(function(e) { if (e.props.method === "model" && e.props.window === section.start) self._removeEdge(e) })
      validated.forEach(function(e) {
        self._upsertNode(e.from, "concept", { name: e.names[0], joinable: e.from.indexOf("concept:id:") === 0 })
        self._upsertNode(e.to, "concept", { name: e.names[1], joinable: e.to.indexOf("concept:id:") === 0 })
        self._addEdge(e.from, e.to, e.type, e.provenance, e.props)
      })
      state.completed[sectionKey] = true
      if (sections.every(function(sec) {return state.completed[String(sec.start)]})) state.status = "complete"
      checkpoint()
    }
    state.status = sections.every(function(sec) { return state.completed[String(sec.start)] }) ? "complete" : failed ? "failed" : "pending"
    report.processed++
    if (isFunction(opts.onProgress)) opts.onProgress(merge(clone(report), { path: page.path, index: report.processed, total: list.length, status: state.status }))
  }
  report.pending = list.filter(function(page) { return self._state.enrichment[page.path].status !== "complete" }).length
  report.partial = opts.modelHelp === "auto" && report.pending > 0
  report.resumable = report.pending > 0
  report.status = stopped || (report.partial ? "partial" : "complete")
  report.stage = "complete"
  this._markDerivedDirty(); this._ensureDerived(); this._pruneUnreferencedNodes("")
  checkpoint()
  if (opts.preview !== true) this._persist()
  report.stats = this.stats()
  return report
}

MiniAWikiGraph.prototype.detectCommunities = function() {
  var docNodes = Object.keys(this._state.nodes).filter(function(id) { return this._state.nodes[id].type === "document" }.bind(this))
  var byTag = {}
  var deg = {}, self = this
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (e._deleted === true) return
    var weight = e.type === "MENTIONS" && self._currentEvidence(e) ? (e.props.confidence || 0) * 2 / Math.log(2 + (self._adj[e.to] || []).length) : e.type === "HAS_TAG" ? 1 / Math.log(2 + (self._adj[e.to] || []).length) : 1
    deg[e.from] = (deg[e.from] || 0) + weight
    deg[e.to] = (deg[e.to] || 0) + weight
    if (e.type !== "HAS_TAG" && !(e.type === "MENTIONS" && e.from.indexOf("doc:") === 0 && self._currentEvidence(e))) return
    byTag[e.to] = byTag[e.to] || []
    byTag[e.to].push(e.from)
  })
  var groups = {}
  Object.keys(byTag).forEach(function(tagId) {
    var docs = byTag[tagId]
    if (!isArray(docs) || docs.length === 0 || tagId.indexOf("concept:") === 0 && (docs.length < 2 || docs.length > Math.max(20, docNodes.length * 0.2))) return
    groups[tagId] = docs.filter(function(id, i) { return docs.indexOf(id) === i })
  })
  if (Object.keys(groups).length === 0 && docNodes.length > 0) groups["all"] = docNodes.slice()
  var out = []
  var self = this
  Object.keys(groups).forEach(function(gid, idx) {
    var members = groups[gid]
    var memberSet = {}
    members.forEach(function(id) { memberSet[id] = true })
    var hub = members.slice().sort(function(a, b) { return (deg[b] || 0) - (deg[a] || 0) })[0] || members[0]
    var label = self._state.nodes[hub] && self._state.nodes[hub].props ? (self._state.nodes[hub].props.title || self._state.nodes[hub].props.name || hub) : hub
    out.push({ id: "c" + (idx + 1), label: label, members: members, weight: members.reduce(function(sum,id) {return sum + (deg[id] || 0)},0), coverage: Number((members.length / Math.max(1, docNodes.length)).toFixed(4)), _memberSet: memberSet })
  })
  this._state.communities = out
  this._dirty.communities = false
  return out
}

MiniAWikiGraph.prototype.crossDocumentSurprise = function() {
  var degree = {}
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (e._deleted === true) return
    if (String(e.from).startsWith("doc:")) degree[e.from] = (degree[e.from] || 0) + 1
    if (String(e.to).startsWith("doc:")) degree[e.to] = (degree[e.to] || 0) + 1
  })
  var maxDeg = 1
  Object.keys(degree).forEach(function(id) { if (degree[id] > maxDeg) maxDeg = degree[id] })
  var result = []
  var seen = {}
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (e._deleted === true) return
    var prov = String(e.provenance || "").toUpperCase()
    var docEdge = e.type === "LINKS_TO" || e.type === "SUPERSEDES" || prov === "INFERRED" || prov === "AMBIGUOUS"
    if (!docEdge) return
    if (!String(e.from).startsWith("doc:") || !String(e.to).startsWith("doc:")) return
    var a = String(e.from).substring(4)
    var b = String(e.to).substring(4)
    if (a === b) return
    var key = a < b ? a + "|" + b : b + "|" + a
    if (seen[key]) return
    seen[key] = true
    var degA = degree[e.from] || 1
    var degB = degree[e.to] || 1
    var score = Number((1 / Math.sqrt(degA * degB / maxDeg + 1)).toFixed(4))
    result.push({ from: a, to: b, score: score, type: e.type, provenance: e.provenance })
  })
  result.sort(function(a, b) { return b.score - a.score })
  this._state.surprise = result
  this._dirty.surprise = false
  return result
}

// Bounded one-hop discovery. Shared metadata requires two supported assertions.
// The caller validates every support revision before disclosing a candidate.
MiniAWikiGraph.prototype.expansionCandidates = function(path, options) {
  var opts = options || {}, budget = opts.budget || { used: 0, limit: 256 }, deadline = opts.deadline || Infinity
  var out = {}, self = this, docId = "doc:" + path, cap = opts.cap || 10
  var charge = function() { if (Date.now() >= deadline || budget.used >= budget.limit) { budget.truncated = true; return false }; budget.used++; return true }
  var support = function(owner, edge) { var node = self._state.nodes["doc:" + owner]; return { path: owner, revision: edge ? edge.props.revision : node && node.props.revision || "", evidence: edge && clone(edge.props.evidence), section: edge && edge.props.section } }
  var add = function(target, relation, supports, score, layer, concept) {
    if (target === path || isFunction(opts.accept) && !opts.accept(target)) return
    if (out[target] && out[target].score >= score) return
    out[target] = { path: target, relation: relation, supports: supports, score: score, evidenceLayer: layer, explanation: relation + (concept ? ": " + concept : "") }
  }
  // Grounded concept postings first. No pairwise page edges are materialized.
  var semantic = this._semanticByPage[path] || [], concepts = {}
  for (var s = 0; s < semantic.length; s++) {
    if (!charge()) break
    var assertion = semantic[s]
    if (!this._currentEvidence(assertion)) continue
    var endpoints = [assertion.from, assertion.to]
    for (var c = 0; c < endpoints.length; c++) {
      var concept = endpoints[c]
      if (concept.indexOf("concept:") !== 0 || concepts[concept]) continue
      concepts[concept] = true
      var assertions = this._adj[concept] || [], specificity = 1 / Math.log(2 + assertions.length)
      for (var a = 0; a < assertions.length; a++) {
        if (!charge()) break
        var evidence = assertions[a], owner = evidence.props && evidence.props.page
        if (!owner || !this._currentEvidence(evidence)) continue
        add(owner, "shared_concept", [support(path, assertion), support(owner, evidence)], 3 + specificity * Math.min(assertion.props.confidence || 0, evidence.props.confidence || 0), "grounded", concept)
      }
    }
  }
  var edges = this._adj[docId] || []
  for (var i = 0; i < edges.length; i++) {
    if (!charge()) break
    var edge = edges[i], other = edge.from === docId ? edge.to : edge.from
    if (edge._deleted) continue
    if (other.indexOf("doc:") === 0 && (edge.type === "LINKS_TO" || edge.type === "SUPERSEDES")) add(other.substring(4), edge.type, [support(edge.from.substring(4))], 4, "structural")
    else if (edge.type === "HAS_TAG" || edge.type === "ALIAS_OF") {
      var shared = this._adj[other] || []
      for (var j = 0; j < shared.length; j++) {
        if (!charge()) break
        var next = shared[j], target = next.from === other ? next.to : next.from
        if (!next._deleted && next.type === edge.type && target.indexOf("doc:") === 0) add(target.substring(4), edge.type === "HAS_TAG" ? "shared_tag" : "shared_alias", [support(path), support(target.substring(4))], 1 + 1 / Math.log(2 + shared.length), "structural")
      }
    }
  }
  // Inference is only a secondary expansion, with source freshness checked independently.
  if (opts.includeInferred !== false) for (var n = 0; n < semantic.length; n++) {
    if (!charge()) break
    var inferred = semantic[n], props = inferred.props || {}, source = this._state.nodes[docId]
    if (inferred._deleted || props.evidenceLayer !== "inferred" || !props.evidence || !source || source.props.hash !== props.sourceHash) continue
    var postings = (this._adj[inferred.to] || []).concat(this._adj[inferred.from] || [])
    for (var k = 0; k < postings.length; k++) {
      if (!charge()) break
      var grounded = postings[k]
      if (this._currentEvidence(grounded)) add(grounded.props.page, "inferred_association", [support(path, inferred), support(grounded.props.page, grounded)], 0.25, "inferred", inferred.to)
    }
  }
  return Object.keys(out).map(function(key) { return out[key] }).sort(function(a, b) { return b.score - a.score || a.path.localeCompare(b.path) }).slice(0, cap)
}

// Cross-wiki joins use the same bounded adjacency work counter as local traversal.
// Do not call joinKeys()/keysForDocs(): their cold path scans the entire graph.
MiniAWikiGraph.prototype.expansionJoinKeys = function(path, options) {
  var opts = options, out = [], seen = {}, self = this, node = this._state.nodes["doc:" + path]
  var add = function(id, kind, revision) {
    if (!(kind === "discovery" ? opts.kinds.alias : opts.kinds[kind]) || seen[id] || id.substring(id.indexOf(":") + 1).length < opts.minKeyLen) return
    seen[id] = true; out.push({id:id,kind:kind,support:{path:path,revision:revision || ""}})
  }
  var visit = function(edges, semantic) {
    for (var i = 0; i < edges.length; i++) {
      if (Date.now() >= opts.deadline || opts.budget.used >= opts.budget.limit) {opts.budget.truncated = true;break}
      opts.budget.used++
      var edge = edges[i]
      if (edge._deleted) continue
      if (semantic && self._currentEvidence(edge)) {
        ;[edge.from, edge.to].forEach(function(id) { var concept = self._state.nodes[id]; if (concept && concept.type === "concept" && concept.props.joinable === true) add(id,"concept",edge.props.revision) })
      }
      else if (edge.type === "HAS_TAG") add(edge.to,"tag",node && node.props.revision)
      else if (edge.type === "ALIAS_OF") add(edge.from,"alias",node && node.props.revision)
      else if (edge.type === "HAS_DISCOVERY_KEY") add(edge.to,"discovery",node && node.props.revision)
    }
  }
  if (opts.kinds.tag || opts.kinds.alias) visit(this._adj["doc:" + path] || [],false)
  if (opts.kinds.concept) visit(this._semanticByPage[path] || [],true)
  return out
}

MiniAWikiGraph.prototype.expansionMatches = function(keys, options) {
  var opts = options, out = [], seen = {}, maxDocs = Math.floor(opts.maxDf * Math.max(1,opts.pageCount))
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k], edges = this._adj[key.id] || [], owners = {}, matches = [], complete = true
    // Charge even an absent key, bounding work across many empty mounted graphs.
    if (Date.now() >= opts.deadline || opts.budget.used >= opts.budget.limit) {opts.budget.truncated = true;break}
    opts.budget.used++
    for (var i = 0; i < edges.length; i++) {
      if (Date.now() >= opts.deadline || opts.budget.used >= opts.budget.limit) {opts.budget.truncated = true;complete = false;break}
      opts.budget.used++
      var edge = edges[i], owner, revision
      if (edge._deleted) continue
      if (key.kind === "concept") {if (!this._currentEvidence(edge)) { if (edge.props && edge.props.evidenceLayer === "grounded") opts.budget.staleEvidence = true; continue }; owner = edge.props && edge.props.page;revision = edge.props && edge.props.revision}
      else {
        var doc = (key.kind === "tag" && edge.type === "HAS_TAG" || key.kind === "discovery" && edge.type === "HAS_DISCOVERY_KEY") ? edge.from : key.kind === "alias" && edge.type === "ALIAS_OF" ? edge.to : ""
        if (doc.indexOf("doc:") !== 0) continue
        owner = doc.substring(4)
        var node = this._state.nodes[doc]; revision = node && node.props.revision
      }
      if (!owner || owner.indexOf("@") === 0 || owners[owner]) continue
      owners[owner] = true
      matches.push({path:owner,relation:"shared_" + key.kind,sourceSupport:key.support,targetSupport:{path:owner,revision:revision || ""}})
      if (matches.length > (key.kind === "discovery" && opts.maxDf > 0 ? Math.max(1,maxDocs) : maxDocs)) {complete = false;break}
    }
    // An incomplete posting cannot establish that this key passes the DF filter.
    if (!complete) continue
    for (var m = 0; m < matches.length; m++) {
      if (seen[matches[m].path] || isFunction(opts.accept) && !opts.accept(matches[m].path)) continue
      seen[matches[m].path] = true;out.push(matches[m])
      if (out.length >= opts.cap) {opts.budget.truncated = true;return out}
    }
  }
  return out
}

MiniAWikiGraph.prototype.relatedFor = function(paths, opts) {
  this._ensureDerived()
  var cap = isMap(opts) && isNumber(opts.cap) ? Math.max(1, opts.cap) : 5
  var src = isArray(paths) ? paths : []
  var srcIds = src.map(function(p) { return "doc:" + p })
  var srcIdSet = {}
  srcIds.forEach(function(id) { srcIdSet[id] = true })
  var scores = {}
  var self = this
  var add = function(path, type, provenance, score) {
    if (!isString(path) || path.length === 0 || src.indexOf(path) >= 0) return
    if (!isMap(scores[path])) scores[path] = { path: path, score: 0, connection_types: {}, provenance: {} }
    scores[path].score += score
    scores[path].connection_types[type] = true
    scores[path].provenance[provenance] = true
  }

  srcIds.forEach(function(id) {
    var adj = isArray(self._adj[id]) ? self._adj[id] : []
    adj.forEach(function(e) {
      var otherId = e.from === id ? e.to : e.from
      if (!String(otherId).startsWith("doc:")) return
      add(String(otherId).substring(4), e.type, e.provenance, 2)
    })
  })

  var srcTagIds = {}
  srcIds.forEach(function(id) {
    var adj = isArray(self._adj[id]) ? self._adj[id] : []
    adj.forEach(function(e) {
      if (e.type !== "HAS_TAG" && !(e.type === "MENTIONS" && e.from.indexOf("doc:") === 0 && self._currentEvidence(e))) return
      var tagId = e.from === id ? e.to : e.from
      if (String(tagId).startsWith("tag:")) srcTagIds[tagId] = true
    })
  })
  Object.keys(srcTagIds).forEach(function(tagId) {
    var adj = isArray(self._adj[tagId]) ? self._adj[tagId] : []
    adj.forEach(function(e) {
      var otherId = e.from === tagId ? e.to : e.from
      if (!String(otherId).startsWith("doc:") || srcIdSet[otherId]) return
      add(String(otherId).substring(4), "shared_tag", "EXTRACTED", 1)
    })
  })

  ;(isArray(this._state.communities) ? this._state.communities : []).forEach(function(comm) {
    if (!isMap(comm._memberSet)) return
    var hasSrc = false
    Object.keys(srcIdSet).forEach(function(id) { if (comm._memberSet[id]) hasSrc = true })
    if (!hasSrc) return
    ;(isArray(comm.members) ? comm.members : []).forEach(function(memberId) {
      if (!String(memberId).startsWith("doc:") || srcIdSet[memberId]) return
      add(String(memberId).substring(4), "community", "EXTRACTED", 0.5)
    })
  })

  return Object.keys(scores).map(function(path) {
    var info = scores[path]
    var sum = isMap(self._state.summaries.pages[path]) ? self._state.summaries.pages[path] : {}
    return {
      path: path,
      score: Number(info.score.toFixed(4)),
      connection: Object.keys(info.connection_types).join(","),
      provenance: Object.keys(info.provenance).join(","),
      digest: isString(sum.summary) ? sum.summary : (isString(sum.digest) ? sum.digest : path)
    }
  }).sort(function(a, b) { return b.score - a.score }).slice(0, cap)
}

// ── Cross-wiki join keys (tags / aliases / concepts) ──────────────────────
// These three methods are the read-only surface a parent MiniAWikiManager uses to bridge
// its own graph with a mounted wiki's graph at query time (see _crossWikiExpand in
// js/wiki/mini-a-wiki.js). No cross-wiki edges are ever persisted here — joinKeys()/docsForKeys()
// only ever read this graph's own state, whichever wiki it belongs to.

// joinKeys: every tag/alias/concept key in this graph, mapped to the doc paths that carry
// it. Cached and invalidated by _markDerivedDirty (same trigger as communities/surprise).
MiniAWikiGraph.prototype.joinKeys = function() {
  this._ensureIndexes()
  if (isMap(this._joinKeysCache) && this._joinKeysDirty !== true) return this._joinKeysCache
  var tags = {}, aliases = {}, concepts = {}
  var docCount = 0
  var nodes = this._state.nodes, self = this
  Object.keys(nodes).forEach(function(id) {
    if (isMap(nodes[id]) && nodes[id].type === "document" && id.indexOf("doc:") === 0) docCount++
  })
  var addKey = function(map, key, path) {
    if (!isString(key) || key.length === 0 || !isString(path) || path.length === 0) return
    if (!isArray(map[key])) map[key] = []
    if (map[key].indexOf(path) < 0) map[key].push(path)
  }
  // Tags/aliases: doc-side of HAS_TAG (doc→tag) and ALIAS_OF (alias→doc) edges.
  // Grounded, current concepts only. Scoped page identities never join across wikis.
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (!isMap(e) || e._deleted === true) return
    if (e.type === "HAS_TAG" && String(e.from).indexOf("doc:") === 0 && String(e.to).indexOf("tag:") === 0) {
      addKey(tags, String(e.to).substring(4), String(e.from).substring(4))
    } else if (e.type === "ALIAS_OF" && String(e.from).indexOf("alias:") === 0 && String(e.to).indexOf("doc:") === 0) {
      addKey(aliases, String(e.from).substring(6), String(e.to).substring(4))
    } else if (self._currentEvidence(e)) {
      var page = isMap(e.props) && isString(e.props.page) ? e.props.page : ""
      if (page.length > 0) {
        ;[e.from,e.to].forEach(function(id) { if (nodes[id] && nodes[id].type === "concept" && nodes[id].props.joinable === true) addKey(concepts, id.substring(8), page) })
      }
    }
  })
  this._joinKeysCache = { tags: tags, aliases: aliases, concepts: concepts, docCount: docCount }
  this._joinKeysDirty = false
  return this._joinKeysCache
}

// keysForDocs: inverse of joinKeys — the join keys carried by a given set of doc paths.
MiniAWikiGraph.prototype.keysForDocs = function(paths) {
  var jk = this.joinKeys()
  var pathSet = {}
  ;(isArray(paths) ? paths : []).forEach(function(p) { if (isString(p)) pathSet[p] = true })
  var pick = function(map) {
    var out = []
    Object.keys(map).forEach(function(key) {
      var docs = isArray(map[key]) ? map[key] : []
      for (var i = 0; i < docs.length; i++) {
        if (pathSet[docs[i]]) { out.push(key); break }
      }
    })
    return out
  }
  return { tags: pick(jk.tags), aliases: pick(jk.aliases), concepts: pick(jk.concepts) }
}

// docsForKeys: docs in THIS graph carrying any of the given join keys, scored and shaped
// like relatedFor()'s output ({path, score, connection, provenance, digest}) so callers
// need no branching between within-graph and cross-graph results. A key present on more
// than opts.maxDf of this graph's docs (e.g. a boilerplate tag like "docs") is skipped —
// otherwise it would join every page to every other page.
MiniAWikiGraph.prototype.docsForKeys = function(keys, opts) {
  this._ensureDerived()
  var jk = this.joinKeys()
  var options = isMap(opts) ? opts : {}
  var maxDf = isNumber(options.maxDf) ? options.maxDf : 0.25
  var minKeyLen = isNumber(options.minKeyLen) ? options.minKeyLen : 3
  var cap = isNumber(options.cap) ? Math.max(1, options.cap) : 5
  var excludeSet = {}
  ;(isArray(options.exclude) ? options.exclude : []).forEach(function(p) { if (isString(p)) excludeSet[p] = true })
  var docCount = Math.max(1, jk.docCount)
  var scores = {}
  var self = this
  var weight = { tags: 1.0, aliases: 1.5, concepts: 0.75 }
  var connName = { tags: "shared_tag", aliases: "shared_alias", concepts: "shared_concept" }
  var kindsInput = isMap(keys) ? keys : {}
  ;["tags", "aliases", "concepts"].forEach(function(kind) {
    var list = isArray(kindsInput[kind]) ? kindsInput[kind] : []
    var map = jk[kind]
    list.forEach(function(key) {
      if (!isString(key) || key.length < minKeyLen) return
      var docs = isArray(map[key]) ? map[key] : []
      if (docs.length === 0) return
      if ((docs.length / docCount) > maxDf) return
      docs.forEach(function(path) {
        if (excludeSet[path]) return
        if (!isMap(scores[path])) scores[path] = { path: path, score: 0, connection_types: {} }
        scores[path].score += weight[kind]
        scores[path].connection_types[connName[kind]] = true
      })
    })
  })
  return Object.keys(scores).map(function(path) {
    var info = scores[path]
    var sum = isMap(self._state.summaries.pages[path]) ? self._state.summaries.pages[path] : {}
    return {
      path: path,
      score: Number(info.score.toFixed(4)),
      connection: Object.keys(info.connection_types).join(","),
      provenance: "EXTRACTED",
      digest: isString(sum.summary) ? sum.summary : (isString(sum.digest) ? sum.digest : path)
    }
  }).sort(function(a, b) { return b.score - a.score }).slice(0, cap)
}

MiniAWikiGraph.prototype.retrieve = function(concepts, opts) {
  var options = opts || {}, cap = options.cap || 10, budget = options.maxEdges || 256, used = 0, scores = {}, self = this
  var hits = this.query(isArray(concepts) ? concepts.join(" ") : String(concepts || ""))
  var add = function(path, score, evidence, explanation) {
    var node = self._state.nodes["doc:" + path]
    if (!node || !self._state.summaries.pages[path]) return
    var value = scores[path] || { path: path, score: 0, references: [], explanations: [] }
    value.score += score
    if (evidence) value.references.push({ path: path, revision: evidence.props.revision, section: evidence.props.section, evidence: clone(evidence.props.evidence) })
    value.explanations.push(explanation); scores[path] = value
  }
  hits.forEach(function(hit) {
    if (hit.type === "document") add(hit.id.substring(4), hit.score, null, "document metadata match")
    if (hit.type !== "concept") return
    var edges = self._adj[hit.id] || [], seen = {}
    for (var i = 0; i < edges.length && used < budget; i++) {
      used++
      var edge = edges[i], owner = edge.props.page
      if (!owner || seen[owner] || !self._currentEvidence(edge)) continue
      seen[owner] = true
      add(owner, 3 + hit.score / Math.log(2 + edges.length), edge, "grounded concept: " + hit.props.name)
    }
  })
  var pages = Object.keys(scores).map(function(path) {
    var entry = scores[path], summary = self._state.summaries.pages[path] || {}
    entry.summary = summary.summary || summary.digest || ""; return entry
  }).sort(function(a, b) { return b.score - a.score || a.path.localeCompare(b.path) }).slice(0, cap)
  return { nodes: pages.map(function(page) { return self._state.nodes["doc:" + page.path] }), pages: pages, work: { edges: used, limit: budget, truncated: used >= budget } }
}

// Tag suggestions never use HAS_TAG edges as evidence. Existing vocabulary is only a naming preference.
MiniAWikiGraph.prototype.tagSuggestions = function(path, existing, vocabulary) {
  var self = this, seen = {}, out = [], tags = existing || [], names = vocabulary || []
  ;(this._semanticByPage[path] || []).forEach(function(edge) {
    if (edge.type !== "MENTIONS" || edge.props.method !== "deterministic" || !self._currentEvidence(edge)) return
    var node = self._state.nodes[edge.to], name = node && node.props.name
    if (!name || !self._usefulConcept(name)) return
    var tag = names.filter(function(value) { return String(value).toLowerCase() === name.toLowerCase() })[0] || name
    if (seen[tag] || tags.some(function(value) { return String(value).toLowerCase() === tag.toLowerCase() })) return
    seen[tag] = true
    out.push({ tag: tag, reason: "Body mentions " + name, revision: edge.props.revision, evidence: clone(edge.props.evidence), existingVocabulary: names.indexOf(tag) >= 0 })
  })
  out.sort(function(a, b) { return Number(b.existingVocabulary) - Number(a.existingVocabulary) || a.tag.localeCompare(b.tag) })
  return { path: path, additions: out.slice(0, 5), normalizationSuggestions: tags.filter(function(tag) { return tags.some(function(other) { return other !== tag && String(other).toLowerCase() === String(tag).toLowerCase() }) }).map(function(tag) { return { tag: tag, reason: "Case-variant duplicate; review separately" } }) }
}

MiniAWikiGraph.prototype.answer = function(question, opts) {
  return { question: question, retrieval: this.retrieve(String(question || "").split(/\s+/), opts) }
}

MiniAWikiGraph.prototype.query = function(text) {
  var q = isString(text) ? text.toLowerCase().trim() : ""
  if (q.length === 0) return []
  var words = q.split(/\s+/)
  var out = []
  var self = this
  Object.keys(this._state.nodes).forEach(function(id) {
    var n = self._state.nodes[id]
    var blob = isString(n._blob) ? n._blob : self._nodeBlob(id, n.props)
    var score = 0
    words.forEach(function(w) { if (blob.indexOf(w) >= 0) score++ })
    if (score > 0) out.push({ id: id, type: n.type, score: score, props: n.props })
  })
  return out.sort(function(a, b) { return b.score - a.score }).slice(0, 20)
}

MiniAWikiGraph.prototype._edgeMatches = function(edge, id, options) {
  var opts = options || {}, p = edge.props || {}
  var match = function(value, allowed) { return isUnDef(allowed) || (isArray(allowed) ? allowed : [allowed]).indexOf(value) >= 0 }
  return !edge._deleted && (!opts.direction || opts.direction === "both" || opts.direction === "out" && edge.from === id || opts.direction === "in" && edge.to === id) &&
    match(edge.type, opts.type) && match(edge.provenance, isArray(opts.provenance) ? opts.provenance.map(function(v) { return String(v).toUpperCase() }) : isString(opts.provenance) ? opts.provenance.toUpperCase() : __) &&
    match(p.evidenceLayer, opts.evidenceLayer) && (isUnDef(opts.minConfidence) || isNumber(p.confidence) && p.confidence >= opts.minConfidence)
}

MiniAWikiGraph.prototype.neighbors = function(node, options) {
  var id = isString(node) && node.indexOf(":") > 0 ? node : this._id("doc", String(node || ""))
  var self = this
  return (isArray(this._adj[id]) ? this._adj[id] : []).filter(function(e) { return self._edgeMatches(e, id, options) }).map(function(e) {
    return { from: e.from, to: e.to, type: e.type, provenance: e.provenance, props: isMap(e.props) ? clone(e.props) : {} }
  })
}

// docInfo: title + digest for a doc path in THIS graph. Used by a parent manager
// resolving an explicit cross-wiki link into a mount's graph (see _crossWikiExpand in
// js/wiki/mini-a-wiki.js) so it doesn't need to reach into _state directly.
MiniAWikiGraph.prototype.docInfo = function(path) {
  var p = String(path || "")
  var node = this._state.nodes["doc:" + p]
  var sum = isMap(this._state.summaries.pages[p]) ? this._state.summaries.pages[p] : {}
  return {
    title: isMap(node) && isMap(node.props) && isString(node.props.title) ? node.props.title : p,
    digest: isString(sum.summary) ? sum.summary : (isString(sum.digest) ? sum.digest : p)
  }
}

MiniAWikiGraph.prototype.path = function(a, b, options) {
  var opts = options || {}, depth = {}
  var aid = isString(a) && a.indexOf(":") > 0 ? a : this._id("doc", String(a || ""))
  var bid = isString(b) && b.indexOf(":") > 0 ? b : this._id("doc", String(b || ""))
  if (!this._state.nodes[aid] || !this._state.nodes[bid]) return []
  var q = [aid]
  depth[aid] = 0
  var prev = {}
  var seen = {}
  seen[aid] = true
  while (q.length > 0) {
    var cur = q.shift()
    if (cur === bid) break
    if (isNumber(opts.maxDepth) && depth[cur] >= opts.maxDepth) continue
    var nbs = this.neighbors(cur, opts)
    for (var i = 0; i < nbs.length; i++) {
      var nx = nbs[i].from === cur ? nbs[i].to : nbs[i].from
      if (seen[nx]) continue
      seen[nx] = true
      prev[nx] = cur
      depth[nx] = depth[cur] + 1
      q.push(nx)
    }
  }
  if (!seen[bid]) return []
  var out = [bid]
  var p = bid
  while (p !== aid) { p = prev[p]; out.unshift(p) }
  return out
}

MiniAWikiGraph.prototype.stats = function() {
  this._ensureDerived()
  var nodes = Object.keys(this._state.nodes).length
  var edges = this._state.edges.filter(function(e) { return e._deleted !== true }).length
  var byProv = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 }
  this._state.edges.forEach(function(e) {
    if (e._deleted === true) return
    byProv[this._normalizeProvenance(e.provenance)]++
  }.bind(this))
  return { nodes: nodes, edges: edges, provenance: byProv, communities: isArray(this._state.communities) ? this._state.communities.length : 0 }
}

MiniAWikiGraph.prototype.export = function(format) {
  this._ensureDerived()
  var f = isString(format) ? format.toLowerCase().trim() : "mermaid"
  if (f === "mermaid") {
    var lines = ["graph TD"]
    var sanitize = function(s) { return String(s || "").replace(/[^a-zA-Z0-9_]/g, "_") }
    this._state.edges.forEach(function(e) {
      if (e._deleted === true) return
      lines.push("  " + sanitize(e.from) + " -->|" + sanitize(e.type) + "| " + sanitize(e.to))
    })
    return lines.join("\n")
  }
  if (f === "graphml") {
    var gml = [
      "<?xml version=\"1.0\"?>",
      "<graphml xmlns=\"http://graphml.graphdrawing.org/xmlns\">",
      "  <key id=\"type\" for=\"node\" attr.name=\"type\" attr.type=\"string\"/>",
      "  <key id=\"etype\" for=\"edge\" attr.name=\"type\" attr.type=\"string\"/>",
      "  <key id=\"prov\" for=\"edge\" attr.name=\"provenance\" attr.type=\"string\"/>",
      "  <graph id=\"wiki\" edgedefault=\"directed\">"
    ]
    var esc = function(s) { return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }
    Object.keys(this._state.nodes).forEach(function(id) {
      var n = this._state.nodes[id]
      gml.push("    <node id=\"" + esc(id) + "\"><data key=\"type\">" + esc(n.type || "concept") + "</data></node>")
    }.bind(this))
    var edgeIdx = 0
    this._state.edges.forEach(function(e) {
      if (e._deleted === true) return
      gml.push("    <edge id=\"e" + (edgeIdx++) + "\" source=\"" + esc(e.from) + "\" target=\"" + esc(e.to) + "\"><data key=\"etype\">" + esc(e.type) + "</data><data key=\"prov\">" + esc(e.provenance) + "</data></edge>")
    })
    gml.push("  </graph>", "</graphml>")
    return gml.join("\n")
  }
  if (f === "neo4j") {
    return this._state.edges.filter(function(e) { return e._deleted !== true }).map(function(e) {
      return "MERGE (a:Node {id:'" + e.from + "'}) MERGE (b:Node {id:'" + e.to + "'}) MERGE (a)-[:" + e.type + "]->(b);"
    }).join("\n")
  }
  if (f === "html") return "<html><body><pre>" + this.export("mermaid") + "</pre></body></html>"
  if (f === "svg") return "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='40'><text x='10' y='25'>mini-a wiki graph: " + this.stats().nodes + " nodes</text></svg>"
  var cloneState = clone(this._state)
  delete cloneState._edgeIndex
  delete cloneState.updated_at
  return stringify(cloneState, __, "  ")
}

MiniAWikiGraph.prototype._falkorNodeProps = function(id, node) {
  var props = merge({ id: id }, isMap(node.props) ? clone(node.props) : {})
  if (node.type === "document" && isString(props.path) && isMap(this._state.summaries.pages[props.path])) {
    var summaryInfo = this._state.summaries.pages[props.path]
    if (isString(summaryInfo.digest)) props.digest = summaryInfo.digest
    if (isString(summaryInfo.summary)) props.summary = summaryInfo.summary
    if (isString(summaryInfo.hash)) props.hash = summaryInfo.hash
  }
  // The generic Falkor helper reserves name/type and coerces some scalar values.
  props.__miniAProps = stringify(props, __, "")
  return props
}

// MERGE each source assertion independently; endpoint-only link helpers collapse evidence.
MiniAWikiGraph.prototype._falkorLink = function(db, edge) {
  var esc = function(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'") }
  var type = String(edge.type).replace(/[^A-Za-z0-9_]/g, "_")
  var props = merge({ provenance: edge.provenance, __miniAProps: stringify(edge.props || {}, __, "") }, edge.props || {})
  var assignments = Object.keys(props).filter(function(k) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && isDef(props[k]) }).map(function(k) {
    return "r." + k + " = " + (isNumber(props[k]) && isFinite(props[k]) ? String(props[k]) : "'" + esc(isMap(props[k]) || isArray(props[k]) ? stringify(props[k], __, "") : props[k]) + "'")
  })
  db.query("MATCH (a {id:'" + esc(edge.from) + "'}), (b {id:'" + esc(edge.to) + "'}) MERGE (a)-[r:" + type + " {evidenceKey:'" + esc(this._edgeKey(edge.from,edge.to,edge.type,edge.provenance,edge.props)) + "'}]->(b)" + (assignments.length ? " SET " + assignments.join(", ") : ""))
}

MiniAWikiGraph.prototype._falkorMetadata = function(db) {
  var meta = { version: 2, semantic_cache: this._state.semantic_cache, enrichment: this._state.enrichment, build_status: this._state.build_status }
  var json = stringify(meta, __, "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  db.query("MERGE (m:MiniAGraphState {id:'state'}) SET m.json = '" + json + "'")
}

MiniAWikiGraph.prototype.falkorSync = function() {
  if (!this._hasFalkor()) return { ok: false, error: "falkor not configured" }
  var db = __
  try {
    includeOPack("FalkorDB")
    loadLib("falkordb.js")
    db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
    try { db.deleteGraph() } catch(ignoreDelete) {}
    Object.keys(this._state.nodes).forEach(function(id) {
      var node = this._state.nodes[id]
      if (!isMap(node)) return
      db.createOrUpdateNode(id, node.type || "concept", this._falkorNodeProps(id, node))
    }.bind(this))
    this._state.edges.forEach(function(e) {
      if (e._deleted === true) return
      this._falkorLink(db, e)
    }.bind(this))
    this._falkorMetadata(db)
    return { ok: true, nodes: Object.keys(this._state.nodes).length, edges: this.stats().edges }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  } finally {
    try { if (isDef(db) && isFunction(db.close)) db.close() } catch(ignoreClose) {}
  }
}

MiniAWikiGraph.prototype.falkorApplyDiff = function(diff) {
  if (!this._hasFalkor()) return { ok: false, error: "falkor not configured" }
  if (!isMap(diff)) return this.falkorSync()
  var db = __
  var esc = function(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'") }
  try {
    includeOPack("FalkorDB")
    loadLib("falkordb.js")
    db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
    ;(isArray(diff.deleteEdges) ? diff.deleteEdges : []).forEach(function(e) {
      var relType = String(e.type || "RELATED_TO").replace(/[^A-Za-z0-9_]/g, "_")
      var key = this._edgeKey(e.from, e.to, e.type, e.provenance, e.props)
      db.query("MATCH (a {id:'" + esc(e.from) + "'})-[r:" + relType + "]->(b {id:'" + esc(e.to) + "'}) WHERE r.evidenceKey = '" + esc(key) + "' OR (r.evidenceKey IS NULL AND coalesce(r.provenance, 'EXTRACTED') = '" + esc(e.provenance) + "' AND coalesce(r.page, '') = '" + esc(e.props && e.props.page) + "') DELETE r")
    }.bind(this))
    var deleteNodes = isArray(diff.deleteNodes) ? diff.deleteNodes : []
    if (deleteNodes.length > 0) {
      deleteNodes.forEach(function(id) {
        db.query("MATCH (n {id:'" + esc(id) + "'}) DETACH DELETE n")
      })
    }
    ;(isArray(diff.upsertNodes) ? diff.upsertNodes : []).forEach(function(node) {
      if (!isMap(node) || !isString(node.id)) return
      db.createOrUpdateNode(node.id, node.type || "concept", this._falkorNodeProps(node.id, node))
    }.bind(this))
    ;(isArray(diff.upsertEdges) ? diff.upsertEdges : []).forEach(function(e) {
      this._falkorLink(db, e)
    }.bind(this))
    this._falkorMetadata(db)
    return { ok: true }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  } finally {
    try { if (isDef(db) && isFunction(db.close)) db.close() } catch(ignoreClose) {}
  }
}

MiniAWikiGraph.prototype.falkorQuery = function(cypher) {
  if (!this._hasFalkorRead()) return { ok: false, error: "falkor not configured" }
  try {
    includeOPack("FalkorDB")
    loadLib("falkordb.js")
    var db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
    return db.query(cypher)
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiGraph.prototype.save = function() {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  this._ensureDir()
  var p = this._graphDir + "/graph.json"
  try {
    if (io.fileExists(p)) {
      var prev = af.fromJson(io.readFileString(p))
      if (isMap(prev) && isMap(prev.nodes)) {
        var prevCount = Object.keys(prev.nodes).length
        var newCount = Object.keys(this._state.nodes).length
        if (prevCount > 10 && newCount < prevCount * 0.5) this._log("warn", "[graph] shrink warning: nodes " + prevCount + " -> " + newCount)
      }
    }
  } catch(ignoreWarn) {}
  var cloneState = clone(this._state)
  delete cloneState._edgeIndex
  delete cloneState.updated_at
  delete cloneState._dirty
  ;(isArray(cloneState.edges) ? cloneState.edges : []).forEach(function(e) {
    delete e._deleted
  })
  Object.keys(cloneState.nodes).forEach(function(id) {
    delete cloneState.nodes[id]._blob
    delete cloneState.nodes[id]._deleted
  })
  ;(isArray(cloneState.communities) ? cloneState.communities : []).forEach(function(comm) {
    delete comm._memberSet
  })
  var temporary = p + "." + java.util.UUID.randomUUID() + ".tmp"
  try {
    io.writeFileString(temporary, stringify(cloneState, __, ""))
    java.nio.file.Files.move(new java.io.File(temporary).toPath(), new java.io.File(p).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } finally { java.nio.file.Files.deleteIfExists(new java.io.File(temporary).toPath()) }
  return { ok: true }
}

MiniAWikiGraph.prototype.saveReport = function() {
  this._ensureDerived()
  this._ensureDir()
  var st = this.stats()
  var lines = [
    "# Graph report",
    "",
    "## Stats",
    "",
    "- Nodes: " + st.nodes,
    "- Edges: " + st.edges,
    "- Communities: " + st.communities,
    "",
    "## Communities",
    ""
  ]
  ;(isArray(this._state.communities) ? this._state.communities : []).slice(0, 50).forEach(function(comm) {
    lines.push("- " + comm.id + ": " + (comm.label || "") + " (" + (isArray(comm.members) ? comm.members.length : 0) + " members, coverage=" + comm.coverage + ")")
  })
  lines.push("", "## Surprise links", "")
  ;(isArray(this._state.surprise) ? this._state.surprise : []).slice(0, 50).forEach(function(item) {
    lines.push("- " + item.from + " -> " + item.to + " score=" + item.score + " type=" + item.type + " provenance=" + item.provenance)
  })
  io.writeFileString(this._graphDir + "/GRAPH_REPORT.md", lines.join("\n"))
  return { ok: true, path: this._graphDir + "/GRAPH_REPORT.md" }
}

MiniAWikiGraph.prototype.load = function() {
  this._ensureIndexes()
  // reading the remote graph is allowed read-only; only sync/diff/build require write access
  if (this._hasFalkorRead()) {
    var db = __
    try {
      includeOPack("FalkorDB")
      loadLib("falkordb.js")
      db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
      var nodes = db.readOnlyQuery("MATCH (n:Node) RETURN properties(n) AS node")
      var edges = db.readOnlyQuery("MATCH (a:Node)-[r]->(b:Node) RETURN properties(a) AS fromNode, properties(b) AS toNode, type(r) AS relType, properties(r) AS relProps")
      this._state = this._emptyState()
      this._reindexEdges()
      for (var i = 0; i < nodes.length; i++) {
        var row = nodes[i]
        var node = isMap(row) && isMap(row.node) ? row.node : __
        if (!isMap(node)) continue
        var id = isString(node.id) ? node.id : ""
        if (id.length === 0) continue
        var type = isString(node.type) ? node.type : "concept"
        var props = clone(node)
        if (isString(props.__miniAProps)) props = af.fromJson(props.__miniAProps)
        delete props.id
        delete props.type
        this._upsertNode(id, type, props)
        if (type === "document" && isString(props.path) && props.path.length > 0) {
          this._state.summaries.pages[props.path] = {}
          if (isString(props.digest)) this._state.summaries.pages[props.path].digest = props.digest
          if (isString(props.summary)) this._state.summaries.pages[props.path].summary = props.summary
          if (isString(props.hash)) this._state.summaries.pages[props.path].hash = props.hash
        }
      }
      for (var j = 0; j < edges.length; j++) {
        var edgeRow = edges[j]
        var fromNode = isMap(edgeRow) && isMap(edgeRow.fromNode) ? edgeRow.fromNode : __
        var toNode = isMap(edgeRow) && isMap(edgeRow.toNode) ? edgeRow.toNode : __
        var fromId = isMap(fromNode) && isString(fromNode.id) ? fromNode.id : ""
        var toId = isMap(toNode) && isString(toNode.id) ? toNode.id : ""
        if (fromId.length === 0 || toId.length === 0) continue
        var relProps = isMap(edgeRow.relProps) ? clone(edgeRow.relProps) : {}
        var provenance = isString(relProps.provenance) ? relProps.provenance : "EXTRACTED"
        if (isString(relProps.__miniAProps)) relProps = af.fromJson(relProps.__miniAProps)
        delete relProps.provenance
        if (isString(relProps.evidence)) { try { relProps.evidence = af.fromJson(relProps.evidence) } catch(ignoreEvidence) {} }
        this._addEdge(fromId, toId, isDef(edgeRow.relType) ? String(edgeRow.relType) : "RELATED_TO", provenance, relProps)
      }
      var metadata = db.readOnlyQuery("MATCH (m:MiniAGraphState {id:'state'}) RETURN m.json AS json")
      if (metadata.length && isDef(metadata[0].json)) {
        var meta = af.fromJson(String(metadata[0].json))
        ;["semantic_cache", "enrichment", "build_status"].forEach(function(k) { if (isMap(meta[k])) this._state[k] = meta[k] }, this)
      }
      this._markDerivedDirty()
      this._ensureDerived()
      return true
    } catch(falkorErr) {
      this._log("warn", "[graph] FalkorDB load failed, falling back to local cache: " + __miniAErrMsg(falkorErr))
    } finally {
      try { if (isDef(db) && isFunction(db.close)) db.close() } catch(ignoreClose) {}
    }
  }
  try {
    var raw = isString(this._cfg.graphRaw) ? this._cfg.graphRaw : __
    if (isUnDef(raw)) {
      var p = this._graphDir + "/graph.json"
      if (!io.fileExists(p)) return false
      raw = io.readFileString(p)
    }
    var obj = af.fromJson(raw)
    if (!isMap(obj)) return false
    this._state = merge(this._emptyState(), obj)
    this._reindexEdges()
    this._markDerivedDirty()
    this._ensureDerived()
    return true
  } catch(e) {
    return false
  }
}

MiniAWikiGraph.prototype.close = function() {
  if (this._pendingSave === true) this._persist()
}
