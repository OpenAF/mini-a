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
  // Batch window state: nested beginBatch()/endBatch() defer saves and derived stats.
  this._batchDepth = 0
  this._batchChanged = false
  // Node count of the last persisted graph, for the shrink warning without a file read-back.
  this._lastSavedNodeCount = -1
  this._state = this._emptyState()
  this.load()
}

// beginBatch: defer persistence and derived statistics (communities, surprise) until the
// matching endBatch(). Batches nest; only the outermost endBatch() flushes.
MiniAWikiGraph.prototype.beginBatch = function() {
  this._batchDepth = (this._batchDepth || 0) + 1
  return this._batchDepth
}

// endBatch: flush every change made inside the batch with one derived recompute and one save.
MiniAWikiGraph.prototype.endBatch = function() {
  if (!(this._batchDepth > 0)) return { ok: true, changed: false }
  this._batchDepth--
  if (this._batchDepth > 0) return { ok: true, nested: true }
  var changed = this._batchChanged === true
  this._batchChanged = false
  if (!changed || this._readOnly) return { ok: true, changed: false }
  if (this._autosave === "off") {
    this._pendingSave = true
    return { ok: true, changed: true, autosave: "off" }
  }
  // Per-page FalkorDB diffs are not collected while batching; resynchronize once instead.
  if (this._hasFalkor()) this._falkorNeedsFullSync = true
  this._ensureDerived()
  return merge({ changed: true }, this._persist())
}

// _inBatch: true while a beginBatch() window is open.
MiniAWikiGraph.prototype._inBatch = function() {
  return this._batchDepth > 0
}

MiniAWikiGraph.prototype._emptyState = function() {
  return {
    version: 2,
    created_at: new Date().toISOString(),
    nodes: {},
    edges: [],
    summaries: { pages: {}, communities: {} },
    semantic_cache: {},
    semantic_carry: {},
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
  this._tokenIndexDirty = true
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
  if (!isMap(this._edgesByOwner)) this._edgesByOwner = {}
  if (!isMap(this._dirty)) this._dirty = { communities: true, surprise: true }
}

// _indexEdgeOwner: posting of every edge carrying props.page, so page removal can find the
// page's evidence without scanning the whole edge list.
MiniAWikiGraph.prototype._indexEdgeOwner = function(edge) {
  if (!isMap(edge.props) || !isString(edge.props.page) || edge.props.page.length === 0) return
  var path = edge.props.page
  if (!isArray(this._edgesByOwner[path])) this._edgesByOwner[path] = []
  this._edgesByOwner[path].push(edge)
}

MiniAWikiGraph.prototype._reindexEdges = function() {
  this._state._edgeIndex = {}
  this._adj = {}
  this._nodeRefs = {}
  this._semanticByPage = {}
  this._edgesByOwner = {}
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
    self._indexEdgeOwner(e)
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
  this._indexEdgeOwner(edge)
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
  if (edge.props && this._edgesByOwner[edge.props.page]) this._edgesByOwner[edge.props.page] = this._edgesByOwner[edge.props.page].filter(function(e) { return e !== edge })
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
  var docId = this._id("doc", path)
  var candidates = {}
  var deleteEdges = []
  var self = this
  candidates[docId] = true
  // Model work of an edited page is carried to the next semantic build (see _rebaseCarry).
  this._stashCarry(path, this._semanticByPage[path], isMap(this._state.enrichment) && isMap(this._state.enrichment[path]) ? this._state.enrichment[path].completed : __, this._state.nodes)

  // Owned edges are always adjacent to the page's document node or carry props.page,
  // so the two postings cover them without scanning the whole edge list.
  var owned = (this._adj[docId] || []).concat(this._edgesByOwner[path] || [])
  owned.forEach(function(edge) {
    if (edge._deleted === true || !self._edgeOwnedByPage(edge, path)) return
    deleteEdges.push({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      provenance: edge.provenance,
      props: isMap(edge.props) ? clone(edge.props) : {}
    })
    candidates[edge.from] = true
    candidates[edge.to] = true
    self._removeEdge(edge)
  })

  // Only endpoints of removed edges can have become orphans. Other pages' isolated
  // document nodes are kept, as in _pruneUnreferencedNodes.
  this._compactEdges(false)
  var deleteNodes = []
  Object.keys(candidates).forEach(function(id) {
    var node = self._state.nodes[id]
    if (!isMap(node) || (self._nodeRefs[id] || 0) > 0) return
    if (node.type === "document" && isMap(node.props) && isString(node.props.path) && node.props.path !== path) return
    delete self._state.nodes[id]
    deleteNodes.push(id)
  })

  if (this._state.enrichment) delete this._state.enrichment[path]
  delete this._state.semantic_cache[path]
  if (isMap(this._state.summaries.pages)) delete this._state.summaries.pages[path]
  return { deleteNodes: deleteNodes, deleteEdges: deleteEdges }
}

MiniAWikiGraph.prototype._markDerivedDirty = function() {
  this._ensureIndexes()
  this._dirty.communities = true
  this._dirty.surprise = true
  this._joinKeysDirty = true
  this._tokenIndexDirty = true
  this._docCount = __
}

// _pageCount: number of indexed pages (documents with a summary), cached until the next change.
MiniAWikiGraph.prototype._pageCount = function() {
  if (isUnDef(this._docCount)) this._docCount = Object.keys(isMap(this._state.summaries.pages) ? this._state.summaries.pages : {}).length
  return this._docCount
}

MiniAWikiGraph.prototype._ensureDerived = function() {
  this._ensureIndexes()
  if (this._dirty.communities) this.detectCommunities()
  if (this._dirty.surprise) this.crossDocumentSurprise()
}

MiniAWikiGraph.prototype._scheduleSave = function(diff) {
  if (this._readOnly) return { ok: true, readOnly: true }
  if (this._inBatch()) {
    this._batchChanged = true
    return { ok: true, batched: true }
  }
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
  // A full-state save covers every change collected by an open batch.
  this._batchChanged = false
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

MiniAWikiGraph.prototype.buildStructural = function(pages, opts) { return this._buildStructural(pages, opts, false) }

MiniAWikiGraph.prototype._buildStructural = function(pages, opts, deferStats) {
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
  var oldCarry = isMap(this._state.semantic_carry) ? this._state.semantic_carry : {}

  this._state = this._emptyState()
  this._state.semantic_carry = oldCarry
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
  // Changed pages carry their model work to the next semantic build.
  var changedModel = {}
  oldSemanticEdges.forEach(function(se) {
    if (!isMap(se.props) || !isString(se.props.page) || unchanged[se.props.page]) return
    if (!changedModel[se.props.page]) changedModel[se.props.page] = []
    changedModel[se.props.page].push(se)
  })
  list.forEach(function(page) {
    if (unchanged[page.path]) return
    this._stashCarry(page.path, changedModel[page.path], isMap(oldEnrichment[page.path]) ? oldEnrichment[page.path].completed : __, oldNodes)
  }, this)
  for (var j = 0; j < oldSemanticEdges.length; j++) {
    var se = oldSemanticEdges[j]
    if (!isMap(se.props) || !unchanged[se.props.page]) continue
    if (!isMap(this._state.nodes[se.from]) || !isMap(this._state.nodes[se.to])) continue
    this._addEdge(se.from, se.to, se.type, se.provenance, se.props)
  }
  this._pruneUnreferencedNodes("")
  this._markDerivedDirty()
  if (!deferStats) this._ensureDerived()
  if (options.preview !== true) this._persist()
  return deferStats ? { ok: true } : this.stats()
}

MiniAWikiGraph.prototype.updatePage = function(p) { return this._updatePage(p, false) }

// Batch builds defer derived statistics until every page change is present.
MiniAWikiGraph.prototype._updatePage = function(p, deferStats) {
  if (this._readOnly) return {ok:false,error:"graph is read-only"}
  if (!isMap(p) || !isString(p.path)) return { ok: false, error: "path is required" }
  var newHash = this._pageHash(p)
  var prev = isMap(this._state.summaries.pages[p.path]) ? this._state.summaries.pages[p.path] : __
  if (isMap(prev) && prev.hash === newHash) return { ok: true, changed: false }
  if (this._inBatch()) deferStats = true
  var removed = this._removePageState(p.path)
  this._indexPageStructural(p)
  this._markDerivedDirty()
  this._scheduleSave(this._inBatch() ? __ : this._pageDiff(p.path, removed))
  return deferStats ? { ok: true, changed: true } : { ok: true, changed: true, stats: this.stats() }
}

// _pageDiff: FalkorDB upserts/deletes after re-indexing one page. Built from the page's
// own edges only; upserting every endpoint is a safe superset (MERGE is idempotent).
MiniAWikiGraph.prototype._pageDiff = function(path, removed) {
  var self = this
  var docId = this._id("doc", path)
  var nodeIds = {}
  var seenEdges = {}
  var upsertEdges = []
  nodeIds[docId] = true
  ;(this._adj[docId] || []).concat(this._edgesByOwner[path] || []).forEach(function(edge) {
    if (edge._deleted === true || !self._edgeOwnedByPage(edge, path)) return
    var key = self._edgeKey(edge.from, edge.to, edge.type, edge.provenance, edge.props)
    if (seenEdges[key]) return
    seenEdges[key] = true
    nodeIds[edge.from] = true
    nodeIds[edge.to] = true
    upsertEdges.push({ from: edge.from, to: edge.to, type: edge.type, provenance: edge.provenance, props: isMap(edge.props) ? clone(edge.props) : {} })
  })
  var upsertNodes = Object.keys(nodeIds)
                          .filter(function(id) { return isMap(self._state.nodes[id]) })
                          .map(function(id) { return clone(self._state.nodes[id]) })
  return { upsertNodes: upsertNodes, deleteNodes: removed.deleteNodes, upsertEdges: upsertEdges, deleteEdges: removed.deleteEdges }
}

MiniAWikiGraph.prototype.removePage = function(path) { return this._removePage(path, false) }

MiniAWikiGraph.prototype._removePage = function(path, deferStats) {
  if (this._readOnly) return {ok:false,error:"graph is read-only"}
  if (!isString(path) || path.length === 0) return { ok: false, error: "path is required" }
  if (this._inBatch()) deferStats = true
  var removed = this._removePageState(path)
  // A deleted page has nothing to re-attach carried model work to.
  if (isMap(this._state.semantic_carry)) delete this._state.semantic_carry[path]
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
  return deferStats ? { ok: true, changed: true } : { ok: true, changed: true, stats: this.stats() }
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

// Extraction contract versions. Bumping EXTRACTOR_VERSION re-derives deterministic mentions
// (CPU only); bumping PROMPT_VERSION invalidates completed model work.
MiniAWikiGraph.EXTRACTOR_VERSION = 3
MiniAWikiGraph.PROMPT_VERSION = 2

// _isCodeLike: acronyms and identifiers (UPPER_CASE, camelCase, dotted, symbols, digits).
// They are only case-folded, never plural/possessive-folded.
MiniAWikiGraph.prototype._isCodeLike = function(term) {
  var s = String(term || "")
  return /^[A-Z0-9_]{2,}$/.test(s) || /[a-z][A-Z]/.test(s) || /[._:$#+\/\\0-9]/.test(s)
}

// _conceptKey: canonical join identity for a concept name. Case-folded and possessive-free;
// the last prose word also loses a regular plural ("Connections" joins "connection").
MiniAWikiGraph.prototype._conceptKey = function(term) {
  var s = String(term || "").trim().replace(/\s+/g, " ").replace(/['’]s$/i, "")
  if (this._isCodeLike(s)) return s.toLowerCase()
  var words = s.toLowerCase().split(" ")
  var last = words[words.length - 1]
  if (/^[a-z]+$/.test(last)) {
    if (last.length > 5 && /ies$/.test(last)) last = last.substring(0, last.length - 3) + "y"
    else if (last.length > 5 && /sses$/.test(last)) last = last.substring(0, last.length - 2)
    else if (last.length > 4 && /[^aeiosu]s$/.test(last)) last = last.substring(0, last.length - 1)
  }
  words[words.length - 1] = last
  return words.join(" ")
}

// _conceptId: joinable concept node id for a free concept name.
MiniAWikiGraph.prototype._conceptId = function(term) {
  return "concept:id:" + this._conceptKey(term)
}

// _emphasisTerms: short **bold** and `code` spans of a page; candidates for shared vocabulary.
MiniAWikiGraph.prototype._emphasisTerms = function(page) {
  var body = String(page.body || "").replace(/```[\s\S]*?```/g, " ")
  var out = []
  var seen = {}
  var self = this
  var re = /\*\*([^*\n]{2,60})\*\*|`([^`\n]{2,60})`/g
  var match
  while ((match = re.exec(body)) !== null && out.length < 32) {
    var term = String(match[1] || match[2] || "").trim()
    if (seen[term] || term.split(/\s+/).length > 4 || /[=(){}\[\]<>"]/.test(term) || /^[^A-Za-z0-9_$]|[,;:.!?]$/.test(term)) continue
    if (!self._usefulConcept(term)) continue
    seen[term] = true
    out.push(term)
  }
  return out
}

// _conceptVocabulary: page identities (titles and aliases, never joinable across wikis) plus
// emphasised terms used on two or more pages (joinable concepts). A page identity always
// claims its name before a shared term does.
MiniAWikiGraph.prototype._conceptVocabulary = function(pages) {
  var names = {}
  var first = {}
  var self = this
  var addIdentity = function(name, identity) {
    name = String(name || "").trim()
    if (!self._usefulConcept(name)) return
    if (!names[name]) names[name] = []
    if (!names[name].some(function(x) { return x.id === identity.id })) names[name].push(identity)
  }

  // Page identities.
  pages.forEach(function(page) {
    var meta = page.meta || {}
    var title = String(meta.title || page.path.replace(/\.md$/, "").split("/").pop())
    var id = "concept:page:" + page.path + ":" + title
    ;[title].concat(isArray(meta.aliases) ? meta.aliases : []).forEach(function(name) {
      addIdentity(name, { id: id, name: title, joinable: false })
    })
  })
  // Pre-v3 key component, used only to migrate completed model work.
  var legacyHash = sha1(stringify(names, __, ""))

  // Shared emphasised terms.
  var termPages = {}
  pages.forEach(function(page) {
    self._emphasisTerms(page).forEach(function(term) { termPages[term] = (termPages[term] || 0) + 1 })
  })
  Object.keys(termPages).sort().forEach(function(term) {
    if (termPages[term] < 2 || names[term]) return
    addIdentity(term, { id: self._conceptId(term), name: term, joinable: true })
  })

  // First-token index for the mention scanner.
  Object.keys(names).sort().forEach(function(name) {
    var token = (name.match(/[A-Za-z0-9_$][A-Za-z0-9_.$:+#/-]*/) || [""])[0]
    if (!first[token]) first[token] = []
    first[token].push(name)
  })
  return { names: names, first: first, hash: sha1(stringify(names, __, "")), legacyHash: legacyHash }
}

MiniAWikiGraph.prototype._usefulConcept = function(value) {
  return value.length >= 2 && value.length <= 100 && !/^(the|and|for|with|from|this|that|file|files|page|pages|readme|index|usage|guide|reference|overview|documentation|docs|source|src|tests?|api|configuration|common|example|examples|introduction|notes|true|false|null|undefined|return|var|function|const|let)$/i.test(value)
}

// _deterministicMentions: grounded MENTIONS for vocabulary names and technical tokens.
// Also returns vocabHash, a hash of exactly the vocabulary entries this page looked up, so a
// vocabulary change elsewhere only invalidates pages that mention the changed names.
MiniAWikiGraph.prototype._deterministicMentions = function(page, sections, vocabulary, pageHash) {
  var self = this
  var result = []
  var used = {}
  var hash = isString(pageHash) ? pageHash : this._pageHash(page)
  var revision = page.revision || hash
  sections.forEach(function(section) {
    var seen = {}
    var count = 0
    var re = /[A-Za-z_$][A-Za-z0-9_.$:+#/-]*/g
    var match

    // add: one mention per concept per section, at most 64 per section.
    var add = function(term, index, identity) {
      if (count >= 64 || !self._usefulConcept(term)) return
      var id = identity ? identity.id : self._conceptId(term)
      if (seen[id]) return
      seen[id] = true
      count++
      result.push({
        id: id,
        name: identity ? identity.name : term,
        joinable: identity ? identity.joinable : true,
        props: {
          page: page.path,
          revision: revision,
          sourceHash: hash,
          section: section.section,
          evidenceLayer: "grounded",
          method: "deterministic",
          confidence: 1,
          evidence: { start: section.start + index, end: section.start + index + term.length, line: section.line + section.text.substring(0, index).split("\n").length - 1, quote: term }
        }
      })
    }

    while ((match = re.exec(section.text)) !== null) {
      var token = match[0].replace(/[.:/-]+$/, "")
      var index = match.index
      if (vocabulary.names[token]) used[token] = true
      ;(vocabulary.first[token] || []).slice(0, 32).forEach(function(name) {
        if (section.text.substring(index, index + name.length) !== name || /[A-Za-z0-9_$]/.test(section.text.charAt(index + name.length))) return
        used[name] = true
        var choices = vocabulary.names[name]
        if (choices.length === 1) add(name, index, choices[0])
      })
      // Technical names and inline code only; no generic capitalized-prose heuristic.
      if (!(vocabulary.names[token] && vocabulary.names[token].length > 1) && (/^[A-Z][A-Z0-9_]{1,}$/.test(token) || /[a-z][A-Z]|[A-Za-z][._:$][A-Za-z]|\+\+|#$/.test(token) || section.text.charAt(index - 1) === "`")) add(token, index)
    }
  })
  var deps = Object.keys(used).sort().map(function(name) { return [name, vocabulary.names[name].map(function(x) { return x.id })] })
  return { mentions: result, vocabHash: sha1(stringify(deps, __, "")) }
}

MiniAWikiGraph.prototype._currentEvidence = function(edge) {
  var p = edge.props || {}, node = this._state.nodes["doc:" + p.page]
  return !edge._deleted && p.evidenceLayer === "grounded" && isMap(p.evidence) && !!node && node.props.hash === p.sourceHash && (!p.revision || p.revision === node.props.revision)
}

// _semanticWork: per-build page facts computed once (hash, revision, sections with stable ids).
// A section id hashes its heading name and text, so it survives edits elsewhere in the page.
MiniAWikiGraph.prototype._semanticWork = function(page) {
  var hash = this._pageHash(page)
  var counts = {}
  var sections = this._semanticSections(page).map(function(section) {
    var name = String(section.section || "").replace(/@\d+$/, "")
    var sid = sha1(name + "\n" + section.text)
    counts[sid] = (counts[sid] || 0) + 1
    if (counts[sid] > 1) sid = sid + "#" + counts[sid]
    return merge(section, { name: name, sid: sid })
  })
  return { hash: hash, revision: page.revision || hash, sections: sections }
}

// _stashCarry: keep a changed page's model assertions and section completions until the next
// semantic build, which re-attaches those whose section text is unchanged.
MiniAWikiGraph.prototype._stashCarry = function(path, edges, completed, nodes) {
  var models = (edges || []).filter(function(e) { return e._deleted !== true && isMap(e.props) && e.props.method === "model" && isString(e.props.windowKey) })
  var done = {}
  Object.keys(isMap(completed) ? completed : {}).forEach(function(k) { if (isString(completed[k]) && completed[k] !== "legacy") done[k] = completed[k] })
  if (models.length === 0 && Object.keys(done).length === 0) return
  if (!isMap(this._state.semantic_carry)) this._state.semantic_carry = {}
  var carry = isMap(this._state.semantic_carry[path]) ? this._state.semantic_carry[path] : { completed: {}, edges: [] }
  var nodeCopy = function(id) {
    var node = isMap(nodes) ? nodes[id] : __
    return isMap(node) ? { type: node.type, props: clone(node.props || {}) } : { type: "concept", props: {} }
  }
  carry.completed = merge(carry.completed, done)
  models.forEach(function(e) {
    if (carry.edges.length >= 512) return
    carry.edges.push({ from: e.from, to: e.to, type: e.type, provenance: e.provenance, props: clone(e.props), fromNode: nodeCopy(e.from), toNode: nodeCopy(e.to) })
  })
  this._state.semantic_carry[path] = carry
}

// _takeCarry: remove and return the stashed carry of a page.
MiniAWikiGraph.prototype._takeCarry = function(path) {
  if (!isMap(this._state.semantic_carry) || !isMap(this._state.semantic_carry[path])) return __
  var carry = this._state.semantic_carry[path]
  delete this._state.semantic_carry[path]
  return carry
}

// _dropCarry: forget carries of pages that are no longer part of the wiki.
MiniAWikiGraph.prototype._dropCarry = function(present) {
  if (!isMap(this._state.semantic_carry)) return
  Object.keys(this._state.semantic_carry).forEach(function(path) { if (!present[path]) delete this._state.semantic_carry[path] }, this)
}

// _rebaseCarry: re-attach carried model assertions to sections whose text is unchanged,
// moving evidence offsets and source hashes to the new page revision.
MiniAWikiGraph.prototype._rebaseCarry = function(page, work, carry, state) {
  var self = this
  var bySid = {}
  work.sections.forEach(function(section) { bySid[section.sid] = section })
  ;(isArray(carry.edges) ? carry.edges : []).forEach(function(e) {
    var section = bySid[e.props.windowKey]
    var evidence = e.props.evidence
    if (!section || !isMap(evidence) || !isString(evidence.quote)) return
    var quote = evidence.quote
    var at = isNumber(evidence.start) && isNumber(e.props.window) ? evidence.start - e.props.window : -1
    if (at < 0 || section.text.substring(at, at + quote.length) !== quote) at = section.text.indexOf(quote)
    if (at < 0) return
    var props = clone(e.props)
    props.page = page.path
    props.revision = work.revision
    props.sourceHash = work.hash
    props.section = section.section
    props.window = section.start
    props.evidence = merge(props.evidence, { start: section.start + at, end: section.start + at + quote.length, line: section.line + section.text.substring(0, at).split("\n").length - 1 })
    self._upsertNode(e.from, e.fromNode.type, e.fromNode.props)
    self._upsertNode(e.to, e.toNode.type, e.toNode.props)
    self._addEdge(e.from, e.to, e.type, e.provenance, props)
  })
  Object.keys(isMap(carry.completed) ? carry.completed : {}).forEach(function(sid) { if (bySid[sid] && isUnDef(state.completed[sid])) state.completed[sid] = carry.completed[sid] })
}

// _migrateLegacyEnrichment: adopt pre-v3 model work of an unchanged page. Model edges always
// move to normalized concept ids and gain a section id (so a later re-extraction replaces them
// and a failed one keeps them). Completed window offsets count as done only when the stored
// v2 key still matches.
MiniAWikiGraph.prototype._migrateLegacyEnrichment = function(page, work, previous, legacyKey, state) {
  var self = this
  var byStart = {}
  work.sections.forEach(function(section) { byStart[section.start] = section })
  var valid = isMap(previous) && previous.key === legacyKey && isMap(previous.completed)
  if (valid) work.sections.forEach(function(section) { if (previous.completed[String(section.start)]) state.completed[section.sid] = "legacy" })
  ;(this._semanticByPage[page.path] || []).slice().forEach(function(e) {
    if (!isMap(e.props) || e.props.method !== "model" || isString(e.props.windowKey)) return
    var section = byStart[e.props.window]
    var remap = function(id) { return id.indexOf("concept:id:") === 0 ? self._conceptId(id.substring(11)) : id }
    var fromNode = self._state.nodes[e.from]
    var toNode = self._state.nodes[e.to]
    if (!section || !isMap(fromNode) || !isMap(toNode)) return
    var props = clone(e.props)
    props.windowKey = section.sid
    self._removeEdge(e)
    self._upsertNode(remap(e.from), fromNode.type, clone(fromNode.props))
    self._upsertNode(remap(e.to), toNode.type, clone(toNode.props))
    self._addEdge(remap(e.from), remap(e.to), e.type, e.provenance, props)
  })
}

// _sectionPlan: the model payload of one section and the hash of everything it depends on.
// Cross-page candidates are ordered by path so the plan is stable across rebuild orders.
MiniAWikiGraph.prototype._sectionPlan = function(page, section, fingerprint) {
  var self = this
  var mentions = (this._semanticByPage[page.path] || []).filter(function(e) { return e.props.method === "deterministic" && e.props.section === section.section && self._currentEvidence(e) })
  var candidates = {}
  var cross = []
  mentions.slice(0, 16).forEach(function(e) {
    var others = (self._adj[e.to] || []).slice(0, 256).filter(function(other) {
      var owner = other.props && other.props.page
      return owner && owner !== page.path && other.props.method === "deterministic" && self._currentEvidence(other)
    })
    others.sort(function(a, b) { return a.props.page.localeCompare(b.props.page) })
    others.forEach(function(other) {
      var owner = other.props.page
      if (candidates[owner] || cross.length >= 16) return
      candidates[owner] = true
      cross.push({ path: owner, concept: e.to, evidence: other.props.evidence })
    })
  })
  var concepts = mentions.map(function(e) { return self._state.nodes[e.to].props.name })
  var title = (page.meta || {}).title || page.path
  var payload = {
    path: page.path,
    title: title,
    section: section.section,
    start: section.start,
    body: section.text,
    concepts: concepts,
    candidates: cross,
    instruction: "Return {relationships:[{from,to,type,provenance,confidence,evidence:{quote}}]}. Quote exact text from this section supporting both endpoints. Use INFERRED for associations, EXTRACTED only for explicit assertions. Empty relationships is valid. Do not merge identities."
  }
  var inputs = [MiniAWikiGraph.PROMPT_VERSION, fingerprint, page.path, title, section.name, section.text, concepts.slice().sort(), cross.map(function(c) { return c.path + "|" + c.concept }).sort()]
  return { section: section, payload: payload, cross: cross, inputHash: sha1(stringify(inputs, __, "")) }
}

MiniAWikiGraph.prototype.build = function(pages, options) {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  var opts = merge(options || {}, MiniAGraphBuild.resolve(options)), list = pages || [], self = this, started = Date.now()
  var report = {ok:true,stage:"structural",processed:0,cached:0,pending:0,failed:0,calls:0,estimatedTokens:0,effective:MiniAGraphBuild.resolve(opts)}
  var progress = function(count) { report.processed=count;report.elapsedMs=Date.now()-started;if(isFunction(opts.onProgress))opts.onProgress(merge(clone(report),{index:count,total:list.length})) }
  var present = {}
  list.forEach(function(page) { present[page.path] = true })
  progress(0)
  if (opts.strategy === "full") this._buildStructural(list, { preview: true, onStructuralProgress:progress }, true)
  else {
    var autosave = this._autosave
    this._autosave = "off"
    try {
      list.forEach(function(page,index) { self._updatePage(page, true); if((index+1)%25===0)progress(index+1) })
      Object.keys(this._state.summaries.pages).forEach(function(path) { if (!present[path]) self._removePage(path, true) })
    } finally { this._autosave = autosave }
  }
  // Carried model work of deleted pages can never be re-attached.
  this._dropCarry(present)
  if (opts.extraction === "semantic") return this.buildSemantic(list, opts)
  report.pending = Object.keys(this._state.enrichment || {}).filter(function(k) { return self._state.enrichment[k].status !== "complete" }).length
  report.stage="complete";report.status="complete";report.resumable=report.pending>0;report.structural=this.stats()
  progress(list.length);this._state.build_status=clone(report)
  if (opts.preview !== true) this._persist()
  return report
}

// _validateRelationship: grounds one model relationship in a section. The quote is located
// case-insensitively and both endpoints must appear in it. Returns the relationship with the
// exact section substring as its quote and the quote offset, or null when it is not grounded.
MiniAWikiGraph.prototype._validateRelationship = function(rel, section) {
  var quote = rel && rel.evidence && rel.evidence.quote
  var from = rel && rel.from
  var to = rel && rel.to
  if (!isString(quote) || quote.length === 0 || !isString(from) || !isString(to)) return null
  if (!this._usefulConcept(from) || !this._usefulConcept(to)) return null
  var text = section.text
  var at = text.indexOf(quote)
  if (at < 0 && text.toLowerCase().length === text.length) at = text.toLowerCase().indexOf(quote.toLowerCase())
  if (at < 0) return null
  var exact = text.substring(at, at + quote.length)
  var lower = exact.toLowerCase()
  if (lower.indexOf(from.toLowerCase()) < 0 || lower.indexOf(to.toLowerCase()) < 0) return null
  return { rel: rel, quote: exact, at: at }
}

MiniAWikiGraph.prototype.buildSemantic = function(pages, options) {
  if (this._readOnly) return { ok: false, error: "graph is read-only" }
  options = options || {}
  var opts = merge(options, MiniAGraphBuild.resolve(merge({ extraction: "semantic", modelHelp: "auto" }, options)))
  if (opts.extraction === "structural") return this.build(pages, opts)
  var self = this
  var list = pages || []
  var started = Date.now()
  var vocabulary = this._conceptVocabulary(list)
  var report = { ok: true, stage: "deterministic", processed: 0, cached: 0, pending: 0, failed: 0, calls: 0, estimatedTokens: 0, changed: 0, effective: MiniAGraphBuild.resolve(opts) }
  if (isUnDef(this._cfg.modelExtractors) && !isFunction(this._llmExtractFn) && opts.modelHelp === "auto") {
    var adapters = MiniAGraphBuild.modelAdapters()
    this._cfg.modelExtractors = adapters.models
    this._cfg.decisionExtractor = adapters.decision
  }
  var models = this._cfg.modelExtractors || (isFunction(this._llmExtractFn) ? [{ role: "main", fingerprint: this._cfg.modelFingerprint || "custom-v1", extract: this._llmExtractFn }] : [])
  var fingerprint = sha1(stringify(models.map(function(m) { return [m.role, m.fingerprint || "custom-v1"] }).concat(this._cfg.decisionExtractor ? [["decision", this._cfg.decisionExtractor.fingerprint]] : []), __, ""))
  var stopped = ""
  var works = {}
  var plans = {}

  // checkpoint: publish progress. Saves cost the whole graph, so they are throttled to every
  // 15s or 250 committed sections, and forced at stage boundaries. Reload recomputes derived state.
  var unsaved = 0
  var lastSaveAt = Date.now()
  var checkpoint = function(force) {
    unsaved++
    if (force !== true && unsaved < 250 && Date.now() - lastSaveAt < 15000) return
    unsaved = 0
    lastSaveAt = Date.now()
    report.pending = list.filter(function(page) { var state = self._state.enrichment[page.path]; return state && state.status !== "complete" }).length
    report.elapsedMs = Date.now() - started
    self._state.build_status = clone(report)
    self._compactEdges(force === true)
    self._markDerivedDirty()
    if (report.stage === "complete") self._ensureDerived()
    if (opts.preview !== true) self.save()
    if (isFunction(opts.onProgress)) opts.onProgress(merge(clone(report), { index: report.processed, total: list.length, status: stopped || report.stage }))
  }

  // call: one budgeted model call; null once a budget or cancellation stops the build.
  var call = function(model, payload) {
    var tokens = self._estimateTokens(stringify(payload, __, "")) + 2048
    if (isFunction(opts.isCancelled) && opts.isCancelled()) stopped = "cancelled"
    if (Date.now() - started >= opts.maxMinutes * 60000) stopped = stopped || "time-budget"
    if (report.calls >= opts.maxCalls) stopped = stopped || "call-budget"
    if (report.estimatedTokens + tokens > opts.maxTokens) stopped = stopped || "token-budget"
    if (stopped) return null
    report.calls++
    if (!report.callsByRole) report.callsByRole = { lc: 0, main: 0, decision: 0 }
    var role = model.role || "decision"
    report.callsByRole[role] = (report.callsByRole[role] || 0) + 1
    report.estimatedTokens += tokens
    try {
      return model.extract(payload, Math.max(1, opts.maxMinutes * 60000 - (Date.now() - started)))
    } catch(e) {
      // Only caller-sanitized exception samples may enter persisted reports.
      if (isFunction(opts.formatModelError)) {
        if (!isMap(report.modelErrors)) report.modelErrors = {}
        if (isUnDef(report.modelErrors[role])) report.modelErrors[role] = opts.formatModelError(e)
      }
      report.modelCallExceptions = (report.modelCallExceptions || 0) + 1
      return { ok: false, error: "model-extraction-failed" }
    }
  }
  if (!isMap(this._state.enrichment)) this._state.enrichment = {}

  // Pass 1: deterministic publication always precedes optional model work.
  list.forEach(function(page) {
    var work = self._semanticWork(page)
    works[page.path] = work
    var summary = self._state.summaries.pages[page.path]
    if (!summary || summary.hash !== work.hash) {
      self._removePageState(page.path)
      self._indexPageStructural(page)
    }
    var previous = self._state.enrichment[page.path]
    var current = isMap(previous) && previous.version === 3 && previous.hash === work.hash
    var state = current ? previous : { hash: work.hash, version: 3, promptVersion: MiniAWikiGraph.PROMPT_VERSION, completed: {}, status: "pending" }
    if (!current && isMap(previous) && previous.version !== 3 && previous.hash === work.hash) {
      self._migrateLegacyEnrichment(page, work, previous, sha1(work.hash + vocabulary.legacyHash + ":extractor-2:prompt-2:" + fingerprint), state)
    }
    var carry = self._takeCarry(page.path)

    // Deterministic mentions are re-derived only when the page or its vocabulary changed.
    var fresh = current && state.vocabularyHash === vocabulary.hash && isString(state.detKey)
    if (!fresh || opts.force) {
      var det = self._deterministicMentions(page, work.sections, vocabulary, work.hash)
      var detKey = sha1(work.hash + ":" + det.vocabHash + ":det-" + MiniAWikiGraph.EXTRACTOR_VERSION)
      if (state.detKey !== detKey || opts.force) {
        ;(self._semanticByPage[page.path] || []).slice().forEach(function(e) { if (e.props.method === "deterministic" || e.props.sourceHash !== work.hash || !e.props.evidenceLayer) self._removeEdge(e) })
        det.mentions.forEach(function(m) {
          self._upsertNode(m.id, "concept", { name: m.name, joinable: m.joinable })
          self._addEdge("doc:" + page.path, m.id, "MENTIONS", "EXTRACTED", m.props)
        })
        state.detKey = detKey
        report.changed++
      }
      state.vocabularyHash = vocabulary.hash
    }
    if (isMap(carry)) self._rebaseCarry(page, work, carry, state)
    if (opts.force) state.completed = {}
    state.modelFingerprint = fingerprint
    self._state.enrichment[page.path] = state
    self._state.summaries.pages[page.path].summary = self._semanticSummaryFor({ body: page.body, title: (page.meta || {}).title })
    self._state.semantic_cache[page.path] = { hash: work.hash, schema_version: 3, prompt_version: MiniAWikiGraph.PROMPT_VERSION, model: fingerprint, vocabulary: vocabulary.hash }
  })

  // Pass 2: plan every section. A section is done when its recorded input hash still matches;
  // only sections whose own text, mentions or cross-page candidates changed are pending.
  list.forEach(function(page) {
    var state = self._state.enrichment[page.path]
    var completed = {}
    var done = true
    plans[page.path] = works[page.path].sections.map(function(section) {
      var plan = self._sectionPlan(page, section, fingerprint)
      var recorded = state.completed[section.sid]
      if (recorded === "legacy") recorded = plan.inputHash
      plan.done = recorded === plan.inputHash
      if (plan.done) completed[section.sid] = plan.inputHash
      else done = false
      return plan
    })
    state.completed = completed
    state.status = done ? "complete" : "pending"
  })
  this._markDerivedDirty()
  checkpoint(true)
  report.stage = "enrichment"

  // Pass 3: model enrichment of pending sections, within the call/token/time budgets.
  for (var p = 0; p < list.length; p++) {
    var page = list[p]
    var state = this._state.enrichment[page.path]
    var sectionPlans = plans[page.path]
    var failed = false
    if (isFunction(opts.isCancelled) && opts.isCancelled()) stopped = "cancelled"
    for (var s = 0; s < sectionPlans.length; s++) {
      var plan = sectionPlans[s]
      var section = plan.section
      if (plan.done) {
        report.cached++
        continue
      }
      if (opts.modelHelp === "off" || !models.length || stopped) continue
      var payload = plan.payload
      if (plan.cross.length && this._cfg.decisionExtractor) {
        var classified = call(this._cfg.decisionExtractor, { section: section.text, candidates: plan.cross })
        if (classified && isArray(classified.paths)) payload = merge(payload, { candidates: plan.cross.filter(function(candidate) { return classified.paths.slice(0, 8).indexOf(candidate.path) >= 0 }) })
        if (stopped) break
      }
      var response = null
      for (var attempt = 0; attempt < models.length; attempt++) {
        var attemptResponse = call(models[attempt], payload)
        if (!attemptResponse) break
        response = attemptResponse
        // A response is usable when it is empty or grounds at least one relationship; the rest are dropped.
        if (response && response.ok !== false && isArray(response.relationships) && response.needsContext !== true && response.relationships.length <= 32 && (response.relationships.length === 0 || response.relationships.some(function(rel) { return self._validateRelationship(rel, section) !== null }))) break
        // Preserve safe failure categories instead of collapsing every response into invalid-extraction.
        var reason = "invalid-extraction"
        if (response && response.ok === false) reason = response.error === "model-extraction-failed" ? "model-extraction-failed" : response.error === "malformed-output" ? "malformed-output" : "extractor-error"
        else if (!response || !isArray(response.relationships)) reason = "missing-relationships"
        else if (response.needsContext === true) reason = "needs-context"
        else if (response.relationships.length > 32) reason = "too-many-relationships"
        else reason = "ungrounded-relationships"
        response = { ok: false, error: reason }
        if (stopped) break
      }
      if (stopped && !response) break
      if (!response || response.ok === false || !isArray(response.relationships) || response.needsContext === true) {
        failed = true
        report.failed++
        if (!isMap(report.failureReasons)) report.failureReasons = {}
        var failureReason = response && response.error || "missing-response"
        report.failureReasons[failureReason] = (report.failureReasons[failureReason] || 0) + 1
        continue
      }
      var validated = []
      response.relationships.slice(0, 32).forEach(function(rel) {
        var checked = self._validateRelationship(rel, section)
        if (checked === null) {
          report.relationshipsRejected = (report.relationshipsRejected || 0) + 1
          return
        }
        var from = rel.from
        var to = rel.to
        var quote = checked.quote
        var at = checked.at
        report.relationshipsAccepted = (report.relationshipsAccepted || 0) + 1
        var resolve = function(name) {
          var known = vocabulary.names[name]
          if (known && known.length === 1) return known[0].id
          return known && known.length > 1 ? "concept:ambiguous:" + page.path + ":" + name : self._conceptId(name)
        }
        validated.push({
          from: resolve(from),
          to: resolve(to),
          type: /^[A-Z][A-Z0-9_]{0,40}$/.test(rel.type || "") ? rel.type : "RELATED_TO",
          provenance: rel.provenance === "EXTRACTED" ? "EXTRACTED" : "INFERRED",
          names: [from, to],
          props: {
            page: page.path,
            revision: page.revision || state.hash,
            sourceHash: state.hash,
            section: section.section,
            window: section.start,
            windowKey: section.sid,
            method: "model",
            evidenceLayer: rel.provenance === "EXTRACTED" ? "grounded" : "inferred",
            confidence: isNumber(rel.confidence) && isFinite(rel.confidence) ? Math.max(0, Math.min(1, rel.confidence)) : 0.5,
            evidence: { quote: quote, start: section.start + at, end: section.start + at + quote.length, line: section.line + section.text.substring(0, at).split("\n").length - 1 }
          }
        })
      })
      // Commit a window once its grounded relationships are known. Failed refreshes retain valid old assertions.
      ;(this._semanticByPage[page.path] || []).slice().forEach(function(e) {
        if (e.props.method === "model" && (e.props.windowKey === section.sid || isUnDef(e.props.windowKey) && e.props.window === section.start)) self._removeEdge(e)
      })
      validated.forEach(function(e) {
        self._upsertNode(e.from, "concept", { name: e.names[0], joinable: e.from.indexOf("concept:id:") === 0 })
        self._upsertNode(e.to, "concept", { name: e.names[1], joinable: e.to.indexOf("concept:id:") === 0 })
        self._addEdge(e.from, e.to, e.type, e.provenance, e.props)
      })
      plan.done = true
      state.completed[section.sid] = plan.inputHash
      if (sectionPlans.every(function(x) { return x.done })) state.status = "complete"
      checkpoint()
    }
    state.status = sectionPlans.every(function(x) { return x.done }) ? "complete" : failed ? "failed" : "pending"
    report.processed++
    if (isFunction(opts.onProgress)) opts.onProgress(merge(clone(report), { path: page.path, index: report.processed, total: list.length, status: state.status }))
  }
  report.pending = list.filter(function(page) { return self._state.enrichment[page.path].status !== "complete" }).length
  report.partial = opts.modelHelp === "auto" && report.pending > 0
  report.resumable = report.pending > 0
  report.status = stopped || (report.partial ? "partial" : "complete")
  report.stage = "complete"
  this._pruneUnreferencedNodes("")
  checkpoint(true)
  if (opts.preview !== true) this._persist()
  report.stats = this.stats()
  return report
}

// detectCommunities: deterministic Louvain local moving over pages. Pages are linked by explicit
// links (weight 1) and by shared tags or grounded concepts, weighted by IDF so rare features bind
// more strongly; the page-page projection is never materialized. Each page joins at most one
// community; the modularity penalty keeps dense link chains from collapsing into one group.
// communityAlgo "louvain" (default) and "label" both select this algorithm.
MiniAWikiGraph.prototype.detectCommunities = function() {
  var self = this
  var pages = isMap(this._state.summaries.pages) ? this._state.summaries.pages : {}
  var docs = Object.keys(pages).map(function(path) { return "doc:" + path }).filter(function(id) { return isMap(self._state.nodes[id]) }).sort()
  var total = docs.length
  var isDoc = {}
  docs.forEach(function(id) { isDoc[id] = true })

  // Page features (tags, grounded concepts) and explicit link neighbours.
  var featureDocs = {}
  var docFeatures = {}
  var linkNeighbors = {}
  var deg = {}
  docs.forEach(function(id) {
    docFeatures[id] = {}
    linkNeighbors[id] = {}
  })
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (e._deleted === true) return
    var weight = e.type === "MENTIONS" && self._currentEvidence(e) ? (e.props.confidence || 0) * 2 / Math.log(2 + (self._adj[e.to] || []).length) : e.type === "HAS_TAG" ? 1 / Math.log(2 + (self._adj[e.to] || []).length) : 1
    deg[e.from] = (deg[e.from] || 0) + weight
    deg[e.to] = (deg[e.to] || 0) + weight
    if ((e.type === "LINKS_TO" || e.type === "SUPERSEDES") && isDoc[e.from] && isDoc[e.to] && e.from !== e.to) {
      linkNeighbors[e.from][e.to] = true
      linkNeighbors[e.to][e.from] = true
      return
    }
    var feature = e.type === "HAS_TAG" ? e.to : e.type === "MENTIONS" && self._currentEvidence(e) ? e.to : ""
    if (feature.length === 0 || !isDoc[e.from]) return
    if (!isMap(featureDocs[feature])) featureDocs[feature] = {}
    featureDocs[feature][e.from] = true
    docFeatures[e.from][feature] = true
  })

  // Usable features: shared by at least two pages and not near-universal (df capped so a single
  // feature's pair work stays bounded). A feature shared by df pages contributes w = idf / (df - 1)
  // to every page pair, i.e. idf in total to each member.
  var maxDf = Math.max(20, Math.min(total * 0.2, 200))
  var weights = {}
  var idfs = {}
  Object.keys(featureDocs).forEach(function(feature) {
    var df = Object.keys(featureDocs[feature]).length
    if (df < 2 || df > maxDf) return
    idfs[feature] = Math.log(1 + total / df)
    weights[feature] = idfs[feature] / (df - 1)
  })

  // Level-0 units are pages: feature multiplicities, link weights and weighted degree k.
  var units = {}
  var twoM = 0
  docs.forEach(function(id) {
    var feats = {}
    var links = {}
    var kSum = 0
    Object.keys(docFeatures[id]).forEach(function(feature) {
      if (isUnDef(weights[feature])) return
      feats[feature] = 1
      kSum += idfs[feature]
    })
    Object.keys(linkNeighbors[id]).forEach(function(other) {
      links[other] = 1
      kSum += 1
    })
    units[id] = { members: [id], feats: feats, links: links, k: kSum }
    twoM += kSum
  })

  // localMoving: every unit moves to the neighbouring community with the best modularity gain,
  // gain(C) = k_in(C) - k * tot(C) / 2m. Sorted order and smallest-label tie-break keep results
  // reproducible. Returns the unit -> community label map and whether anything moved.
  var localMoving = function(units) {
    var ids = Object.keys(units).sort()
    var label = {}
    var tot = {}
    var counts = {}
    var any = false
    ids.forEach(function(u) {
      label[u] = u
      tot[u] = units[u].k
      Object.keys(units[u].feats).forEach(function(feature) {
        if (!isMap(counts[feature])) counts[feature] = {}
        counts[feature][u] = units[u].feats[feature]
      })
    })
    for (var round = 0; round < 12; round++) {
      var moved = 0
      ids.forEach(function(u) {
        var unit = units[u]
        if (unit.k <= 0) return
        var own = label[u]
        var kin = {}
        Object.keys(unit.feats).forEach(function(feature) {
          var m = unit.feats[feature]
          var c = counts[feature]
          Object.keys(c).forEach(function(l) {
            var n = l === own ? c[l] - m : c[l]
            if (n > 0) kin[l] = (kin[l] || 0) + weights[feature] * m * n
          })
        })
        Object.keys(unit.links).forEach(function(v) { kin[label[v]] = (kin[label[v]] || 0) + unit.links[v] })
        var gain = function(l) { return (kin[l] || 0) - unit.k * ((tot[l] || 0) - (l === own ? unit.k : 0)) / twoM }
        var best = own
        var bestGain = gain(own)
        Object.keys(kin).sort().forEach(function(l) {
          var g = gain(l)
          if (g > bestGain + 1e-12) {
            best = l
            bestGain = g
          }
        })
        if (best === own) return
        tot[own] -= unit.k
        tot[best] = (tot[best] || 0) + unit.k
        Object.keys(unit.feats).forEach(function(feature) {
          var m = unit.feats[feature]
          counts[feature][own] -= m
          if (counts[feature][own] <= 0) delete counts[feature][own]
          counts[feature][best] = (counts[feature][best] || 0) + m
        })
        label[u] = best
        moved++
      })
      if (moved === 0) break
      any = true
    }
    return { label: label, moved: any }
  }

  // aggregate: communities become the next level's units (summed features, inter-community links).
  var aggregate = function(units, label) {
    var next = {}
    Object.keys(units).sort().forEach(function(u) {
      var l = label[u]
      if (!isMap(next[l])) next[l] = { members: [], feats: {}, links: {}, k: 0 }
      var target = next[l]
      target.members = target.members.concat(units[u].members)
      target.k += units[u].k
      Object.keys(units[u].feats).forEach(function(feature) { target.feats[feature] = (target.feats[feature] || 0) + units[u].feats[feature] })
      Object.keys(units[u].links).forEach(function(v) {
        var lv = label[v]
        if (lv !== l) target.links[lv] = (target.links[lv] || 0) + units[u].links[v]
      })
    })
    return next
  }

  // Louvain levels: move, aggregate, repeat until no unit moves (at most 6 levels).
  for (var level = 0; level < 6 && twoM > 0; level++) {
    var pass = localMoving(units)
    if (!pass.moved) break
    units = aggregate(units, pass.label)
  }
  var label = {}
  Object.keys(units).forEach(function(u) { units[u].members.forEach(function(id) { label[id] = u }) })

  // Group, label by the best-connected member, order by size.
  var groups = {}
  docs.forEach(function(id) {
    if (!isArray(groups[label[id]])) groups[label[id]] = []
    groups[label[id]].push(id)
  })
  var out = Object.keys(groups)
                  .filter(function(l) { return groups[l].length >= 2 })
                  .map(function(l) {
                    var members = groups[l]
                    var memberSet = {}
                    members.forEach(function(id) { memberSet[id] = true })
                    var hub = members.slice().sort(function(a, b) { return (deg[b] || 0) - (deg[a] || 0) || a.localeCompare(b) })[0]
                    var props = self._state.nodes[hub] && self._state.nodes[hub].props ? self._state.nodes[hub].props : {}
                    return { label: props.title || props.name || hub, members: members, weight: members.reduce(function(sum, id) { return sum + (deg[id] || 0) }, 0), coverage: Number((members.length / Math.max(1, total)).toFixed(4)), _memberSet: memberSet }
                  })
                  .sort(function(a, b) { return b.members.length - a.members.length || a.members[0].localeCompare(b.members[0]) })
  out.forEach(function(comm, idx) { comm.id = "c" + (idx + 1) })
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
  // Grounded concept postings first. No pairwise page edges are materialized. Every shared
  // concept adds its IDF (rare concepts count more); near-universal concepts are skipped.
  var semantic = this._semanticByPage[path] || [], concepts = {}
  var total = Math.max(2, this._pageCount())
  var maxDf = isNumber(opts.maxDf) ? opts.maxDf : 0.25
  var shared = {}
  for (var s = 0; s < semantic.length; s++) {
    if (!charge()) break
    var assertion = semantic[s]
    if (!this._currentEvidence(assertion)) continue
    var endpoints = [assertion.from, assertion.to]
    for (var c = 0; c < endpoints.length; c++) {
      var concept = endpoints[c]
      if (concept.indexOf("concept:") !== 0 || concepts[concept]) continue
      concepts[concept] = true
      var assertions = this._adj[concept] || []
      var owners = {}
      var found = []
      for (var a = 0; a < assertions.length; a++) {
        if (!charge()) break
        var evidence = assertions[a], owner = evidence.props && evidence.props.page
        if (!owner || owners[owner] || !this._currentEvidence(evidence)) continue
        owners[owner] = true
        if (owner !== path) found.push(evidence)
      }
      // Document frequency counts distinct supporting pages, including this one.
      var df = Object.keys(owners).length
      if (total >= 20 && df > total * maxDf) continue
      var idf = Math.log(1 + total / Math.max(1, df)) / Math.log(1 + total)
      for (var f = 0; f < found.length; f++) {
        var match = found[f], other = match.props.page
        var gain = idf * Math.min(assertion.props.confidence || 0, match.props.confidence || 0)
        var entry = shared[other] || { sum: 0, best: -1, supports: __, concept: "", names: [] }
        entry.sum += gain
        if (entry.names.length < 3) entry.names.push(this._state.nodes[concept] && this._state.nodes[concept].props.name || concept)
        if (gain > entry.best) {
          entry.best = gain
          entry.supports = [support(path, assertion), support(other, match)]
          entry.concept = concept
        }
        shared[other] = entry
      }
    }
  }
  Object.keys(shared).forEach(function(owner) {
    var entry = shared[owner]
    add(owner, "shared_concept", entry.supports, 3 + Math.min(0.99, entry.sum), "grounded", entry.names.join(", "))
  })
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

// proximity: personalized PageRank from seed pages over the page-feature graph (explicit
// links, tags, grounded concepts). Hub features above maxDegree are not traversed. Every edge
// read is charged to the shared work budget; when it runs out the walk stops early.
// Returns { path: score } for non-seed pages, normalized so the best page scores 1.
MiniAWikiGraph.prototype.proximity = function(seedPaths, options) {
  var opts = options || {}
  var budget = opts.budget || { used: 0, limit: 1024 }
  var deadline = opts.deadline || Infinity
  var alpha = isNumber(opts.alpha) ? Math.max(0.01, Math.min(0.99, opts.alpha)) : 0.15
  var iters = isNumber(opts.iters) ? Math.max(1, Math.min(20, Math.floor(opts.iters))) : 10
  var maxDegree = isNumber(opts.maxDegree) ? opts.maxDegree : 64
  var self = this
  var seeds = (isArray(seedPaths) ? seedPaths : []).map(function(path) { return "doc:" + path }).filter(function(id, i, all) { return isMap(self._state.nodes[id]) && all.indexOf(id) === i })
  if (seeds.length === 0) return {}
  var restart = {}
  seeds.forEach(function(id) { restart[id] = 1 / seeds.length })
  var cache = {}

  // neighbours: traversable neighbours of a node, read once and charged per edge.
  var neighbours = function(id) {
    if (isArray(cache[id])) return cache[id]
    var edges = self._adj[id] || []
    var out = []
    if (id.indexOf("doc:") !== 0 && edges.length > maxDegree) {
      cache[id] = out
      return out
    }
    for (var i = 0; i < edges.length; i++) {
      if (Date.now() >= deadline || budget.used >= budget.limit) {
        budget.truncated = true
        break
      }
      budget.used++
      var e = edges[i]
      if (e._deleted === true) continue
      var traversable = e.type === "LINKS_TO" || e.type === "SUPERSEDES" || e.type === "HAS_TAG" || e.type === "MENTIONS" && self._currentEvidence(e)
      if (!traversable) continue
      out.push(e.from === id ? e.to : e.from)
    }
    cache[id] = out
    return out
  }

  var rank = merge({}, restart)
  for (var round = 0; round < iters && budget.truncated !== true; round++) {
    var next = {}
    Object.keys(rank).forEach(function(id) {
      var list = neighbours(id)
      if (list.length === 0) {
        seeds.forEach(function(seed) { next[seed] = (next[seed] || 0) + (1 - alpha) * rank[id] * restart[seed] })
        return
      }
      var share = (1 - alpha) * rank[id] / list.length
      list.forEach(function(other) { next[other] = (next[other] || 0) + share })
    })
    seeds.forEach(function(seed) { next[seed] = (next[seed] || 0) + alpha * restart[seed] })
    rank = next
  }

  var out = {}
  var best = 0
  Object.keys(rank).forEach(function(id) {
    if (id.indexOf("doc:") !== 0 || isDef(restart[id]) || !isMap(self._state.summaries.pages[id.substring(4)])) return
    out[id.substring(4)] = rank[id]
    if (rank[id] > best) best = rank[id]
  })
  if (best > 0) Object.keys(out).forEach(function(path) { out[path] = Number((out[path] / best).toFixed(4)) })
  return out
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
      if (String(tagId).startsWith("tag:") || String(tagId).startsWith("concept:")) srcTagIds[tagId] = true
    })
  })
  // Shared tags and grounded concepts, weighted by IDF so a rare shared feature counts more.
  var total = Math.max(2, this._pageCount())
  Object.keys(srcTagIds).forEach(function(tagId) {
    var isTag = String(tagId).startsWith("tag:")
    var adj = (isArray(self._adj[tagId]) ? self._adj[tagId] : []).filter(function(e) {
      return e.from.indexOf("doc:") === 0 && (isTag ? e.type === "HAS_TAG" : e.type === "MENTIONS" && self._currentEvidence(e))
    })
    var owners = {}
    adj.forEach(function(e) { owners[e.from] = true })
    var df = Object.keys(owners).length
    if (df < 2 || !isTag && df > Math.max(20, total * 0.25)) return
    var weight = Number((Math.log(1 + total / df) / Math.log(1 + total)).toFixed(4))
    Object.keys(owners).forEach(function(otherId) {
      if (srcIdSet[otherId]) return
      add(otherId.substring(4), isTag ? "shared_tag" : "shared_concept", "EXTRACTED", isTag ? Math.max(weight, 0.5) : weight)
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

// _ensureTokenIndex: token -> node ids posting list over node blobs, rebuilt lazily after
// changes, so queries do not stringify and scan every node.
MiniAWikiGraph.prototype._ensureTokenIndex = function() {
  if (isMap(this._tokenIndex) && this._tokenIndexDirty !== true) return this._tokenIndex
  var index = {}
  var nodes = this._state.nodes
  var self = this
  Object.keys(nodes).forEach(function(id) {
    var node = nodes[id]
    var blob = isString(node._blob) ? node._blob : self._nodeBlob(id, node.props)
    var seen = {}
    blob.split(/[^a-z0-9_.$+#\/-]+/).forEach(function(token) {
      token = token.replace(/^[.\/-]+|[.\/-]+$/g, "")
      if (token.length === 0 || seen[token]) return
      seen[token] = true
      if (!isMap(index[token])) index[token] = {}
      index[token][id] = true
    })
  })
  this._tokenIndex = index
  this._tokenKeys = Object.keys(index)
  this._tokenIndexDirty = false
  return index
}

// query: nodes matching the words of text, ranked by summed IDF of the matched words, so a
// rare word outweighs a common one. A word matches every indexed token that contains it.
MiniAWikiGraph.prototype.query = function(text) {
  var q = isString(text) ? text.toLowerCase().trim() : ""
  if (q.length === 0) return []
  var index = this._ensureTokenIndex()
  var keys = this._tokenKeys
  var total = Math.max(1, Object.keys(this._state.nodes).length)
  var scores = {}
  var self = this
  q.split(/\s+/).filter(function(word, i, all) { return word.length > 0 && all.indexOf(word) === i }).forEach(function(word) {
    var matched = {}
    var df = 0
    var collect = function(token) {
      Object.keys(index[token]).forEach(function(id) {
        if (matched[id] || !isMap(self._state.nodes[id])) return
        matched[id] = true
        df++
      })
    }
    if (isMap(index[word])) collect(word)
    keys.forEach(function(token) { if (token !== word && token.indexOf(word) >= 0) collect(token) })
    if (df === 0) return
    var idf = Math.log(1 + total / df)
    Object.keys(matched).forEach(function(id) { scores[id] = (scores[id] || 0) + idf })
  })
  return Object.keys(scores)
               .map(function(id) { var n = self._state.nodes[id]; return { id: id, type: n.type, score: Number(scores[id].toFixed(4)), props: n.props } })
               .sort(function(a, b) { return b.score - a.score || a.id.localeCompare(b.id) })
               .slice(0, 20)
}

// similarConcepts: extension seam for an embedding layer. Returns [] unless a
// similarConceptsFn(conceptId, k, graph) is configured.
MiniAWikiGraph.prototype.similarConcepts = function(conceptId, k) {
  if (!isFunction(this._cfg.similarConceptsFn)) return []
  try {
    var out = this._cfg.similarConceptsFn(conceptId, isNumber(k) ? k : 5, this)
    return isArray(out) ? out : []
  } catch(e) {
    this._log("warn", "[graph] similarConcepts failed: " + __miniAErrMsg(e))
    return []
  }
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
  var dangling = 0
  this._state.edges.forEach(function(e) {
    if (e._deleted === true) return
    byProv[this._normalizeProvenance(e.provenance)]++
    // A page link whose target never became an indexed page (cross-wiki @links excluded).
    if (e.type === "LINKS_TO" && String(e.to).indexOf("doc:@") !== 0) {
      var target = this._state.nodes[e.to]
      if (!isMap(target) || !isMap(target.props) || !isString(target.props.hash)) dangling++
    }
  }.bind(this))
  return { nodes: nodes, edges: edges, provenance: byProv, danglingLinks: dangling, communities: isArray(this._state.communities) ? this._state.communities.length : 0 }
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
  var meta = { version: 2, semantic_cache: this._state.semantic_cache, semantic_carry: this._state.semantic_carry, enrichment: this._state.enrichment, build_status: this._state.build_status }
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
  // Shrink warning against the last loaded/saved node count; no read-back of graph.json.
  var prevCount = this._lastSavedNodeCount
  var newCount = Object.keys(this._state.nodes).length
  if (prevCount > 10 && newCount < prevCount * 0.5) this._log("warn", "[graph] shrink warning: nodes " + prevCount + " -> " + newCount)
  // Deleted (not yet compacted) edges are never persisted.
  var liveEdges = this._state.edges
  this._state.edges = liveEdges.filter(function(e) { return isMap(e) && e._deleted !== true })
  var cloneState
  try { cloneState = clone(this._state) } finally { this._state.edges = liveEdges }
  delete cloneState._edgeIndex
  delete cloneState.updated_at
  delete cloneState._dirty
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
  this._lastSavedNodeCount = newCount
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
        ;["semantic_cache", "semantic_carry", "enrichment", "build_status"].forEach(function(k) { if (isMap(meta[k])) this._state[k] = meta[k] }, this)
      }
      // Derived communities/surprise are recomputed lazily on first use.
      this._markDerivedDirty()
      this._lastSavedNodeCount = Object.keys(this._state.nodes).length
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
    // Derived communities/surprise are recomputed lazily on first use.
    this._markDerivedDirty()
    this._lastSavedNodeCount = Object.keys(this._state.nodes).length
    return true
  } catch(e) {
    return false
  }
}

MiniAWikiGraph.prototype.close = function() {
  if (this._pendingSave === true) this._persist()
}
