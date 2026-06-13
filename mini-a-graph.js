// Author: OpenAI Assistant
// License: Apache 2.0
// Description: Optional wiki knowledge-graph layer for Mini-A.

var MiniAWikiGraph = function(config, loggerFn) {
  this._cfg = isMap(config) ? config : {}
  this._log = isFunction(loggerFn) ? loggerFn : function() {}
  this._graphDir = isString(this._cfg.graphDir) && this._cfg.graphDir.trim().length > 0 ? String(this._cfg.graphDir).trim() : "./.mini-a-wiki-graph"
  this._communityAlgo = isString(this._cfg.communityAlgo) ? this._cfg.communityAlgo : "louvain"
  this._llmExtractFn = isFunction(this._cfg.llmExtractFn) ? this._cfg.llmExtractFn : this._defaultSemanticExtract.bind(this)
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
    communities: [],
    surprise: []
  }
}

MiniAWikiGraph.prototype._hasFalkor = function() {
  return !this._readOnly && isMap(this._falkor) && isString(this._falkor.host) && this._falkor.host.trim().length > 0
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

MiniAWikiGraph.prototype._edgeKey = function(from, to, type, provenance) {
  return [from, to, type, this._normalizeProvenance(provenance)].join("|")
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

MiniAWikiGraph.prototype._defaultSemanticExtract = function(payload) {
  var title = this._normalizeConceptName(payload && payload.title)
  var body = isString(payload && payload.body) ? payload.body : ""
  var relationships = []
  var seen = {}
  var self = this
  var addRel = function(from, to, type, confidence) {
    var src = self._normalizeConceptName(from)
    var dst = self._normalizeConceptName(to)
    if (src.length === 0 || dst.length === 0 || src.toLowerCase() === dst.toLowerCase()) return
    var key = [src.toLowerCase(), dst.toLowerCase(), String(type || "RELATED_TO").toUpperCase()].join("|")
    if (seen[key]) return
    seen[key] = true
    relationships.push({
      from: src,
      to: dst,
      type: isString(type) && type.trim().length > 0 ? type.trim().toUpperCase() : "RELATED_TO",
      provenance: "AMBIGUOUS",
      confidence: isNumber(confidence) ? confidence : 0.35
    })
  }

  var headingMatches = body.match(/^#{2,6}\s+.+$/gm) || []
  headingMatches.forEach(function(line) {
    var heading = self._normalizeConceptName(String(line || "").replace(/^#{1,6}\s+/, ""))
    if (heading.length > 0 && title.length > 0) addRel(title, heading, "RELATES_TO", 0.3)
  })

  var wikiLinkRe = /\[\[([^\]]+)\]\]/g
  var wikiMatch
  while ((wikiMatch = wikiLinkRe.exec(body)) !== null) {
    if (title.length === 0) break
    addRel(title, wikiMatch[1], "REFERENCES", 0.45)
  }

  var mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  var mdMatch
  while ((mdMatch = mdLinkRe.exec(body)) !== null) {
    if (title.length === 0) break
    addRel(title, mdMatch[1], "REFERENCES", 0.45)
  }

  if (title.length > 0) {
    var sentenceMatches = body.match(/(^|[.!?]\s+)([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})/g) || []
    sentenceMatches.slice(0, 12).forEach(function(match) {
      var phrase = self._normalizeConceptName(String(match || "").replace(/^[.!?\s]+/, ""))
      if (phrase.length > 2) addRel(title, phrase, "MENTIONS", 0.25)
    })
  }

  if (relationships.length === 0 && title.length > 0) {
    var pathName = this._normalizeConceptName(isString(payload && payload.path) ? payload.path.split("/").pop() : "")
    if (pathName.length > 0 && pathName.toLowerCase() !== title.toLowerCase()) addRel(title, pathName, "ALSO_KNOWN_AS", 0.2)
  }

  if (relationships.length > 0 && this._cfg._warnedSemanticFallback !== true) {
    this._cfg._warnedSemanticFallback = true
    this._log("warn", "[graph] semantic extraction fallback active: using built-in heuristics")
  }

  return {
    summary: this._semanticSummaryFor(payload),
    relationships: relationships
  }
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
  if (!isMap(this._dirty)) this._dirty = { communities: true, surprise: true }
}

MiniAWikiGraph.prototype._reindexEdges = function() {
  this._state._edgeIndex = {}
  this._adj = {}
  this._nodeRefs = {}
  this._deletedEdges = 0
  var compact = []
  var self = this
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (!isMap(e) || e._deleted === true) return
    e.provenance = self._normalizeProvenance(e.provenance)
    var key = self._edgeKey(e.from, e.to, e.type, e.provenance)
    if (self._state._edgeIndex[key]) return
    self._state._edgeIndex[key] = true
    compact.push(e)
    self._adj[e.from] = self._adj[e.from] || []
    self._adj[e.to] = self._adj[e.to] || []
    self._adj[e.from].push(e)
    self._adj[e.to].push(e)
    self._nodeRefs[e.from] = (self._nodeRefs[e.from] || 0) + 1
    self._nodeRefs[e.to] = (self._nodeRefs[e.to] || 0) + 1
  })
  this._state.edges = compact
  var nodes = this._state.nodes
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

MiniAWikiGraph.prototype._addEdge = function(from, to, type, provenance, props) {
  if (!isString(from) || from.length === 0 || !isString(to) || to.length === 0 || !isString(type) || type.length === 0) return
  this._ensureIndexes()
  if (!isMap(this._state.nodes[from]) || !isMap(this._state.nodes[to])) return
  var prov = this._normalizeProvenance(provenance)
  var key = this._edgeKey(from, to, type, prov)
  if (this._state._edgeIndex[key]) return
  var edge = { from: from, to: to, type: type, provenance: prov, props: isMap(props) ? props : {} }
  this._state._edgeIndex[key] = true
  this._state.edges.push(edge)
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
  var key = this._edgeKey(edge.from, edge.to, edge.type, edge.provenance)
  delete this._state._edgeIndex[key]
  var self = this
  ;[edge.from, edge.to].forEach(function(id) {
    var list = isArray(self._adj[id]) ? self._adj[id] : []
    self._adj[id] = list.filter(function(ref) { return ref !== edge && ref._deleted !== true })
    self._nodeRefs[id] = Math.max(0, (self._nodeRefs[id] || 0) - 1)
  })
  this._deletedEdges++
}

MiniAWikiGraph.prototype._compactEdges = function(force) {
  if (force !== true && this._deletedEdges < 1024) return
  this._state.edges = this._state.edges.filter(function(e) { return isMap(e) && e._deleted !== true })
  this._deletedEdges = 0
  this._reindexEdges()
}

MiniAWikiGraph.prototype._pageHash = function(p) {
  return this._fingerprint((isString(p.body) ? p.body : "") + "\n" + stringify(isMap(p.meta) ? p.meta : {}, __, ""))
}

MiniAWikiGraph.prototype._indexPageStructural = function(p) {
  if (!isMap(p) || !isString(p.path)) return { hash: "", docId: "" }
  var docId = this._id("doc", p.path)
  var newHash = this._pageHash(p)
  this._upsertNode(docId, "document", {
    path: p.path,
    title: isMap(p.meta) && isString(p.meta.title) ? p.meta.title : p.path,
    updated: isMap(p.meta) && isDef(p.meta.updated) ? String(p.meta.updated) : "",
    hash: newHash
  })

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
  return { hash: newHash, docId: docId }
}

MiniAWikiGraph.prototype._edgeOwnedByPage = function(edge, path) {
  if (!isMap(edge) || !isString(path) || path.length === 0) return false
  if (isMap(edge.props) && isString(edge.props.page) && edge.props.page === path) return true
  if (edge.type === "HAS_TAG" || edge.type === "SUPERSEDES" || edge.type === "LINKS_TO" || edge.type === "IN_SECTION") {
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

  delete this._state.semantic_cache[path]
  if (isMap(this._state.summaries.pages)) delete this._state.summaries.pages[path]
  return { deleteNodes: Object.keys(deleteNodes), deleteEdges: deleteEdges }
}

MiniAWikiGraph.prototype._markDerivedDirty = function() {
  this._ensureIndexes()
  this._dirty.communities = true
  this._dirty.surprise = true
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
    var now = now()
    if (this._lastSaveAt > 0 && (now - this._lastSaveAt) < this._saveDebounceMs) {
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

MiniAWikiGraph.prototype.buildStructural = function(pages) {
  var list = isArray(pages) ? pages : []
  var oldSemanticEdges = []
  var semanticNodeIds = {}
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    var prov = String(e.provenance || "").toUpperCase()
    if (prov === "INFERRED" || prov === "AMBIGUOUS") {
      oldSemanticEdges.push({
        from: e.from, to: e.to, type: e.type, provenance: e.provenance, props: isMap(e.props) ? clone(e.props) : {}
      })
      semanticNodeIds[e.from] = true
      semanticNodeIds[e.to] = true
    }
  })
  var oldNodes = this._state.nodes

  this._state = this._emptyState()
  this._ensureIndexes()
  for (var i = 0; i < list.length; i++) this._indexPageStructural(list[i])
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
    if (isMap(se.props) && isString(se.props.page) && !isMap(this._state.summaries.pages[se.props.page])) continue
    if (!isMap(this._state.nodes[se.from]) || !isMap(this._state.nodes[se.to])) continue
    this._addEdge(se.from, se.to, se.type, se.provenance, se.props)
  }
  this._markDerivedDirty()
  this._ensureDerived()
  this._persist()
  return this.stats()
}

MiniAWikiGraph.prototype.updatePage = function(p) {
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
  if (!isString(path) || path.length === 0) return { ok: false, error: "path is required" }
  var removed = this._removePageState(path)
  this._markDerivedDirty()
  this._scheduleSave({
    upsertNodes: [],
    deleteNodes: removed.deleteNodes,
    upsertEdges: [],
    deleteEdges: removed.deleteEdges
  })
  return { ok: true, changed: true, stats: this.stats() }
}

MiniAWikiGraph.prototype.buildSemantic = function(pages, opts) {
  var options = isMap(opts) ? opts : {}
  if (!isFunction(this._llmExtractFn)) return { ok: false, error: "semantic extraction function not configured" }
  var list = isArray(pages) ? pages : []
  var chars = 0
  for (var i = 0; i < list.length; i++) chars += isString(list[i].body) ? list[i].body.length : 0
  this._log("warn", "[graph] semantic build corpus-check: pages=" + list.length + ", approx_chars=" + chars + ", est_tokens=" + this._estimateTokens("x".repeat(Math.min(chars, 10000))) * Math.max(1, Math.ceil(chars / 10000)))

  var changed = 0
  for (var p = 0; p < list.length; p++) {
    var page = list[p]
    if (!isMap(page) || !isString(page.path)) continue
    var hash = this._pageHash(page)
    var cache = isMap(this._state.semantic_cache[page.path]) ? this._state.semantic_cache[page.path] : __
    if (isMap(cache) && cache.hash === hash && options.force !== true) continue

    this._removePageState(page.path)
    this._indexPageStructural(page)

    var payload = { path: page.path, title: isMap(page.meta) && isString(page.meta.title) ? page.meta.title : page.path, body: page.body || "" }
    var res = this._llmExtractFn(payload)
    var rels = isArray(res && res.relationships) ? res.relationships : []
    for (var r = 0; r < rels.length; r++) {
      var rel = rels[r]
      if (!isMap(rel)) continue
      var from = isString(rel.from) ? rel.from.trim() : ""
      var to = isString(rel.to) ? rel.to.trim() : ""
      var type = isString(rel.type) ? rel.type.trim() : "RELATED_TO"
      if (from.length === 0 || to.length === 0) continue
      var fromId = this._id("concept", from.toLowerCase())
      var toId = this._id("concept", to.toLowerCase())
      this._upsertNode(fromId, "concept", { name: from })
      this._upsertNode(toId, "concept", { name: to })
      this._addEdge(fromId, toId, type, this._normalizeProvenance(rel.provenance), { page: page.path, confidence: isNumber(rel.confidence) ? rel.confidence : __ })
    }
    var summary = isString(res && res.summary) ? res.summary.trim() : ""
    if (summary.length > 0) {
      if (!isMap(this._state.summaries.pages[page.path])) this._state.summaries.pages[page.path] = {}
      this._state.summaries.pages[page.path].summary = summary.substring(0, 300)
    }
    this._state.semantic_cache[page.path] = { hash: hash, updated_at: new Date().toISOString() }
    changed++
  }

  this._markDerivedDirty()
  this._ensureDerived()
  this._persist()
  return { ok: true, changed: changed, stats: this.stats() }
}

MiniAWikiGraph.prototype.detectCommunities = function() {
  var docNodes = Object.keys(this._state.nodes).filter(function(id) { return this._state.nodes[id].type === "document" }.bind(this))
  var byTag = {}
  var deg = {}
  ;(isArray(this._state.edges) ? this._state.edges : []).forEach(function(e) {
    if (e._deleted === true) return
    deg[e.from] = (deg[e.from] || 0) + 1
    deg[e.to] = (deg[e.to] || 0) + 1
    if (e.type !== "HAS_TAG") return
    byTag[e.to] = byTag[e.to] || []
    byTag[e.to].push(e.from)
  })
  var groups = {}
  Object.keys(byTag).forEach(function(tagId) {
    var docs = byTag[tagId]
    if (!isArray(docs) || docs.length === 0) return
    groups["tag:" + tagId] = docs
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
    out.push({ id: "c" + (idx + 1), label: label, members: members, coverage: Number((members.length / Math.max(1, docNodes.length)).toFixed(4)), _memberSet: memberSet })
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
      if (e.type !== "HAS_TAG") return
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

MiniAWikiGraph.prototype.retrieve = function(concepts, opts) {
  this._ensureDerived()
  var hits = this.query(isArray(concepts) ? concepts.join(" ") : String(concepts || ""))
  var cap = isMap(opts) && isNumber(opts.cap) ? opts.cap : 3
  var selected = hits.filter(function(h) { return String(h.id).startsWith("doc:") }).slice(0, cap)
  return {
    nodes: selected,
    pages: selected.map(function(s) {
      var path = String(s.id).substring(4)
      return { path: path, summary: isMap(this._state.summaries.pages[path]) ? (this._state.summaries.pages[path].summary || this._state.summaries.pages[path].digest || "") : "" }
    }.bind(this))
  }
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

MiniAWikiGraph.prototype.neighbors = function(node) {
  var id = isString(node) && node.indexOf(":") > 0 ? node : this._id("doc", String(node || ""))
  return (isArray(this._adj[id]) ? this._adj[id] : []).filter(function(e) { return e._deleted !== true }).map(function(e) {
    return { from: e.from, to: e.to, type: e.type, provenance: e.provenance, props: isMap(e.props) ? clone(e.props) : {} }
  })
}

MiniAWikiGraph.prototype.path = function(a, b) {
  var aid = isString(a) && a.indexOf(":") > 0 ? a : this._id("doc", String(a || ""))
  var bid = isString(b) && b.indexOf(":") > 0 ? b : this._id("doc", String(b || ""))
  var q = [aid]
  var prev = {}
  var seen = {}
  seen[aid] = true
  while (q.length > 0) {
    var cur = q.shift()
    if (cur === bid) break
    var nbs = isArray(this._adj[cur]) ? this._adj[cur] : []
    for (var i = 0; i < nbs.length; i++) {
      var nx = nbs[i].from === cur ? nbs[i].to : nbs[i].from
      if (seen[nx]) continue
      seen[nx] = true
      prev[nx] = cur
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
  return props
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
      var fromNode = this._state.nodes[e.from]
      var toNode = this._state.nodes[e.to]
      db.linkNodes(
        e.from,
        isMap(fromNode) && isString(fromNode.type) ? fromNode.type : "concept",
        e.to,
        isMap(toNode) && isString(toNode.type) ? toNode.type : "concept",
        e.type,
        merge({ provenance: e.provenance }, isMap(e.props) ? clone(e.props) : {})
      )
    }.bind(this))
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
      db.query("MATCH (a {id:'" + esc(e.from) + "'})-[r:" + relType + "]->(b {id:'" + esc(e.to) + "'}) DELETE r")
    })
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
      var fromNode = this._state.nodes[e.from]
      var toNode = this._state.nodes[e.to]
      db.linkNodes(
        e.from,
        isMap(fromNode) && isString(fromNode.type) ? fromNode.type : "concept",
        e.to,
        isMap(toNode) && isString(toNode.type) ? toNode.type : "concept",
        e.type,
        merge({ provenance: e.provenance }, isMap(e.props) ? clone(e.props) : {})
      )
    }.bind(this))
    return { ok: true }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  } finally {
    try { if (isDef(db) && isFunction(db.close)) db.close() } catch(ignoreClose) {}
  }
}

MiniAWikiGraph.prototype.falkorQuery = function(cypher) {
  if (!this._hasFalkor()) return { ok: false, error: "falkor not configured" }
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
  io.writeFileString(p, stringify(cloneState, __, ""))
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
  if (this._hasFalkor() && this._readOnly !== true) {
    var db = __
    try {
      includeOPack("FalkorDB")
      loadLib("falkordb.js")
      db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
      var nodes = db.readOnlyQuery("MATCH (n:Node) RETURN properties(n) AS node")
      var edges = db.readOnlyQuery("MATCH (a:Node)-[r]->(b:Node) RETURN properties(a) AS fromNode, properties(b) AS toNode, type(r) AS relType, properties(r) AS relProps")
      this._state = this._emptyState()
      for (var i = 0; i < nodes.length; i++) {
        var row = nodes[i]
        var node = isMap(row) && isMap(row.node) ? row.node : __
        if (!isMap(node)) continue
        var id = isString(node.id) ? node.id : ""
        if (id.length === 0) continue
        var type = isString(node.type) ? node.type : "concept"
        var props = clone(node)
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
        delete relProps.provenance
        this._addEdge(fromId, toId, isString(edgeRow.relType) ? edgeRow.relType : "RELATED_TO", provenance, relProps)
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
    var p = this._graphDir + "/graph.json"
    if (!io.fileExists(p)) return false
    var raw = io.readFileString(p)
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
