// Author: OpenAI Assistant
// License: Apache 2.0
// Description: Optional wiki knowledge-graph layer for Mini-A.

var MiniAWikiGraph = function(config, loggerFn) {
  this._cfg = isMap(config) ? config : {}
  this._log = isFunction(loggerFn) ? loggerFn : function() {}
  var _gDir = isDef(this._cfg.graphDir) ? String(this._cfg.graphDir).trim() : ""
  this._graphDir = _gDir.length > 0 ? _gDir : "./.mini-a-wiki-graph"
  this._communityAlgo = isString(this._cfg.communityAlgo) ? this._cfg.communityAlgo : "louvain"
  this._llmExtractFn = isFunction(this._cfg.llmExtractFn) ? this._cfg.llmExtractFn : __
  this._falkor = isMap(this._cfg.falkor) ? this._cfg.falkor : __
  this._state = {
    version: 1,
    created_at: new Date().toISOString(),
    nodes: {},
    edges: [],
    summaries: { pages: {}, communities: {} },
    semantic_cache: {},
    communities: [],
    surprise: []
  }
  this.load()
}

MiniAWikiGraph.prototype._ensureDir = function() {
  try { if (!io.fileExists(this._graphDir)) io.mkdir(this._graphDir) } catch(e) {}
}

MiniAWikiGraph.prototype._id = function(kind, value) {
  return kind + ":" + String(value || "")
}

MiniAWikiGraph.prototype._upsertNode = function(id, type, props) {
  if (!isString(id) || id.length === 0) return
  if (!isMap(this._state.nodes[id])) this._state.nodes[id] = { id: id, type: type || "concept", props: {} }
  if (isString(type) && type.length > 0) this._state.nodes[id].type = type
  if (isMap(props)) this._state.nodes[id].props = merge(this._state.nodes[id].props, props)
}

MiniAWikiGraph.prototype._normalizeProvenance = function(provenance) {
  var allowed = { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true }
  var p = isString(provenance) ? provenance.toUpperCase().trim() : "AMBIGUOUS"
  return allowed[p] ? p : "AMBIGUOUS"
}

MiniAWikiGraph.prototype._edgeKey = function(from, to, type, provenance) {
  return [from, to, type, provenance].join("|")
}

MiniAWikiGraph.prototype._addEdge = function(from, to, type, provenance, props) {
  if (!isString(from) || from.length === 0 || !isString(to) || to.length === 0 || !isString(type) || type.length === 0) return
  var prov = this._normalizeProvenance(provenance)
  var edge = {
    from: from,
    to: to,
    type: type,
    provenance: prov,
    props: isMap(props) ? props : {}
  }
  if (!isMap(this._state._edgeIndex)) this._state._edgeIndex = {}
  var key = this._edgeKey(edge.from, edge.to, edge.type, edge.provenance)
  if (this._state._edgeIndex[key]) return
  this._state._edgeIndex[key] = true
  this._state.edges.push(edge)
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

MiniAWikiGraph.prototype._pageDigest = function(p) {
  var title = isMap(p.meta) && isString(p.meta.title) ? p.meta.title : p.path
  var first = ""
  var lines = isString(p.body) ? p.body.split(/\r?\n/) : []
  for (var i = 0; i < lines.length; i++) {
    var l = String(lines[i] || "").trim()
    if (l.length === 0) continue
    if (l.startsWith("#")) { first = l.replace(/^#+\s*/, ""); break }
    first = l
    break
  }
  return title + (first.length > 0 ? " — " + first.substring(0, 120) : "")
}

MiniAWikiGraph.prototype._reindexEdges = function() {
  this._state._edgeIndex = {}
  for (var i = 0; i < this._state.edges.length; i++) {
    var e = this._state.edges[i]
    this._state._edgeIndex[this._edgeKey(e.from, e.to, e.type, this._normalizeProvenance(e.provenance))] = true
    e.provenance = this._normalizeProvenance(e.provenance)
  }
}

MiniAWikiGraph.prototype.buildStructural = function(pages) {
  var list = isArray(pages) ? pages : []
  var keepNode = {}
  var keepEdge = {}
  var oldEdges = isArray(this._state.edges) ? this._state.edges : []

  // F9: track which pages are in this build to detect removed pages
  var newPageSet = {}
  for (var pi = 0; pi < list.length; pi++) {
    if (isMap(list[pi]) && isString(list[pi].path)) newPageSet[list[pi].path] = true
  }
  // F9: pages in semantic_cache not in this build are removed → stale
  var staleSemanticPages = {}
  var _scache = isMap(this._state.semantic_cache) ? this._state.semantic_cache : {}
  Object.keys(_scache).forEach(function(path) {
    if (!newPageSet[path]) staleSemanticPages[path] = true
  })

  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    if (!isMap(p) || !isString(p.path)) continue
    var docId = this._id("doc", p.path)
    var newHash = this._fingerprint((p.body || "") + "\n" + stringify(p.meta || {}, __, ""))

    // F9: detect hash change → mark stale, drop summary and cache entry
    var prevCache = isMap(this._state.semantic_cache[p.path]) ? this._state.semantic_cache[p.path] : __
    if (isMap(prevCache) && prevCache.hash !== newHash) {
      delete this._state.semantic_cache[p.path]
      if (isMap(this._state.summaries.pages[p.path])) {
        delete this._state.summaries.pages[p.path].summary
      }
      staleSemanticPages[p.path] = true
    }

    keepNode[docId] = true
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
      keepNode[tagId] = true
      this._upsertNode(tagId, "tag", { name: tag })
      keepEdge[this._edgeKey(docId, tagId, "HAS_TAG", "EXTRACTED")] = [docId, tagId, "HAS_TAG", "EXTRACTED"]
      this._addEdge(docId, tagId, "HAS_TAG", "EXTRACTED", {})
    }

    var aliases = isMap(p.meta) && isArray(p.meta.aliases) ? p.meta.aliases : []
    for (var a = 0; a < aliases.length; a++) {
      var alias = String(aliases[a] || "").trim()
      if (alias.length === 0) continue
      var aliasId = this._id("alias", alias.toLowerCase())
      keepNode[aliasId] = true
      this._upsertNode(aliasId, "alias", { value: alias })
      keepEdge[this._edgeKey(aliasId, docId, "ALIAS_OF", "EXTRACTED")] = [aliasId, docId, "ALIAS_OF", "EXTRACTED"]
      this._addEdge(aliasId, docId, "ALIAS_OF", "EXTRACTED", {})
    }

    if (isMap(p.meta) && isString(p.meta.supersedes) && p.meta.supersedes.trim().length > 0) {
      var supId = this._id("doc", p.meta.supersedes.trim())
      keepNode[supId] = true
      this._upsertNode(supId, "document", { path: p.meta.supersedes.trim() })
      keepEdge[this._edgeKey(docId, supId, "SUPERSEDES", "EXTRACTED")] = [docId, supId, "SUPERSEDES", "EXTRACTED"]
      this._addEdge(docId, supId, "SUPERSEDES", "EXTRACTED", {})
    }

    var links = isArray(p.links) ? p.links : []
    for (var l = 0; l < links.length; l++) {
      var target = String(links[l] || "").trim()
      if (target.length === 0) continue
      var targetId = this._id("doc", target)
      keepNode[targetId] = true
      this._upsertNode(targetId, "document", { path: target })
      keepEdge[this._edgeKey(docId, targetId, "LINKS_TO", "EXTRACTED")] = [docId, targetId, "LINKS_TO", "EXTRACTED"]
      this._addEdge(docId, targetId, "LINKS_TO", "EXTRACTED", {})
    }

    var lines = isString(p.body) ? p.body.split(/\r?\n/) : []
    for (var h = 0; h < lines.length; h++) {
      var m = String(lines[h] || "").match(/^(#{1,6})\s+(.+)$/)
      if (!m) continue
      var heading = String(m[2] || "").trim()
      if (heading.length === 0) continue
      var secId = this._id("section", p.path + "#" + heading.toLowerCase())
      keepNode[secId] = true
      this._upsertNode(secId, "section", { page: p.path, heading: heading, level: m[1].length })
      keepEdge[this._edgeKey(docId, secId, "IN_SECTION", "EXTRACTED")] = [docId, secId, "IN_SECTION", "EXTRACTED"]
      this._addEdge(docId, secId, "IN_SECTION", "EXTRACTED", { level: m[1].length })
    }

    if (!isMap(this._state.summaries.pages)) this._state.summaries.pages = {}
    if (!isMap(this._state.summaries.pages[p.path])) this._state.summaries.pages[p.path] = {}
    this._state.summaries.pages[p.path].digest = this._pageDigest(p)
    this._state.summaries.pages[p.path].hash = newHash
  }

  // F9: filter semantic edges — drop stale-page edges, keep the rest
  var semanticEdges = oldEdges.filter(function(e) {
    var ep = String(e.provenance || "").toUpperCase()
    if (ep !== "INFERRED" && ep !== "AMBIGUOUS") return false
    if (isMap(e.props) && isString(e.props.page) && staleSemanticPages[e.props.page]) return false
    return true
  })
  this._state.edges = []
  this._state._edgeIndex = {}
  for (var se = 0; se < semanticEdges.length; se++) {
    this._addEdge(semanticEdges[se].from, semanticEdges[se].to, semanticEdges[se].type, semanticEdges[se].provenance, semanticEdges[se].props)
  }
  for (var ek in keepEdge) {
    if (!Object.prototype.hasOwnProperty.call(keepEdge, ek)) continue
    var e = keepEdge[ek]
    if (!isArray(e)) continue
    var props = {}
    if (e[2] === "IN_SECTION") {
      var sec = this._state.nodes[e[1]]
      if (sec && isMap(sec.props) && isNumber(sec.props.level)) props.level = sec.props.level
    }
    this._addEdge(e[0], e[1], e[2], e[3], props)
  }

  // F2: prune stale nodes — keep nodes in keepNode or referenced by retained semantic edges
  var referencedConcept = {}
  this._state.edges.forEach(function(e) {
    var ep = String(e.provenance || "").toUpperCase()
    if (ep === "INFERRED" || ep === "AMBIGUOUS") {
      referencedConcept[e.from] = true
      referencedConcept[e.to] = true
    }
  })
  var self = this
  Object.keys(this._state.nodes).forEach(function(id) {
    if (!keepNode[id] && !referencedConcept[id]) delete self._state.nodes[id]
  })

  this.detectCommunities()
  this.crossDocumentSurprise()
  this.save()
  return this.stats()
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
    var hash = this._fingerprint((page.body || "") + "\n" + stringify(page.meta || {}, __, ""))
    var cache = isMap(this._state.semantic_cache[page.path]) ? this._state.semantic_cache[page.path] : __
    if (isMap(cache) && cache.hash === hash) continue
    var payload = { path: page.path, title: isMap(page.meta) && isString(page.meta.title) ? page.meta.title : page.path, body: page.body || "" }
    var res = this._llmExtractFn(payload)
    var rels = isArray(res && res.relationships) ? res.relationships : []
    rels.forEach(function(r) {
      if (!isMap(r)) return
      var from = isString(r.from) ? r.from.trim() : ""
      var to = isString(r.to) ? r.to.trim() : ""
      var type = isString(r.type) ? r.type.trim() : "RELATED_TO"
      if (from.length === 0 || to.length === 0) return
      var fromId = this._id("concept", from.toLowerCase())
      var toId = this._id("concept", to.toLowerCase())
      this._upsertNode(fromId, "concept", { name: from })
      this._upsertNode(toId, "concept", { name: to })
      this._addEdge(fromId, toId, type, this._normalizeProvenance(r.provenance), { page: page.path, confidence: isNumber(r.confidence) ? r.confidence : __ })
    }.bind(this))

    var summary = isString(res && res.summary) ? res.summary.trim() : ""
    if (summary.length > 0) {
      if (!isMap(this._state.summaries.pages[page.path])) this._state.summaries.pages[page.path] = {}
      this._state.summaries.pages[page.path].summary = summary.substring(0, 300)
    }
    this._state.semantic_cache[page.path] = { hash: hash, updated_at: new Date().toISOString() }
    changed++
  }

  this.detectCommunities()
  this.crossDocumentSurprise()
  this.save()
  return { ok: true, changed: changed, stats: this.stats() }
}

// F3 (Option B): tag-grouping communities, field renamed to "coverage" (doc fraction, not modularity).
// communityAlgo is stored but not yet applied (Louvain not implemented).
MiniAWikiGraph.prototype.detectCommunities = function() {
  var docNodes = Object.keys(this._state.nodes).filter(function(id) { return this._state.nodes[id].type === "document" }.bind(this))
  var byTag = {}
  this._state.edges.forEach(function(e) {
    if (e.type !== "HAS_TAG") return
    byTag[e.to] = byTag[e.to] || []
    byTag[e.to].push(e.from)
  })
  var groups = {}
  Object.keys(byTag).forEach(function(tagId) {
    var docs = byTag[tagId]
    if (!isArray(docs) || docs.length === 0) return
    var gid = "tag:" + tagId
    groups[gid] = docs
  })
  if (Object.keys(groups).length === 0 && docNodes.length > 0) groups["all"] = docNodes

  var out = []
  var self = this
  Object.keys(groups).forEach(function(gid, idx) {
    var members = groups[gid]
    var deg = {}
    self._state.edges.forEach(function(e) {
      if (members.indexOf(e.from) >= 0) deg[e.from] = (deg[e.from] || 0) + 1
      if (members.indexOf(e.to) >= 0) deg[e.to] = (deg[e.to] || 0) + 1
    })
    var hub = members.slice().sort(function(a, b) { return (deg[b] || 0) - (deg[a] || 0) })[0] || members[0]
    var label = self._state.nodes[hub] && self._state.nodes[hub].props ? (self._state.nodes[hub].props.title || self._state.nodes[hub].props.name || hub) : hub
    out.push({ id: "c" + (idx + 1), label: label, members: members, coverage: Number((members.length / Math.max(1, docNodes.length)).toFixed(4)) })
  })
  self._state.communities = out
  return out
}

// F7: cross-file (not folder) surprise with degree-based rarity scores and multiple edge types.
MiniAWikiGraph.prototype.crossDocumentSurprise = function() {
  var degree = {}
  this._state.edges.forEach(function(e) {
    if (String(e.from).startsWith("doc:")) degree[e.from] = (degree[e.from] || 0) + 1
    if (String(e.to).startsWith("doc:")) degree[e.to] = (degree[e.to] || 0) + 1
  })
  var maxDeg = 1
  Object.keys(degree).forEach(function(id) { if (degree[id] > maxDeg) maxDeg = degree[id] })

  var result = []
  var seen = {}
  this._state.edges.forEach(function(e) {
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
  return result
}

// F1: relatedFor using direct edges (score 2), shared tags (score 1 per shared tag), community (score 0.5).
MiniAWikiGraph.prototype.relatedFor = function(paths, opts) {
  var cap = isMap(opts) && isNumber(opts.cap) ? Math.max(1, opts.cap) : 5
  var src = isArray(paths) ? paths : []
  var srcIds = src.map(function(p) { return "doc:" + p })
  var scores = {}
  var add = function(path, type, provenance, score) {
    if (!isString(path) || path.length === 0 || src.indexOf(path) >= 0) return
    if (!isMap(scores[path])) scores[path] = { path: path, score: 0, connection_types: {}, provenance: {}, digest: "" }
    scores[path].score += score
    scores[path].connection_types[type] = true
    scores[path].provenance[provenance] = true
  }

  // Direct-edge pass (LINKS_TO / SUPERSEDES): weight 2
  this._state.edges.forEach(function(e) {
    if (srcIds.indexOf(e.from) >= 0 && String(e.to).startsWith("doc:")) add(String(e.to).substring(4), e.type, e.provenance, 2)
    if (srcIds.indexOf(e.to) >= 0 && String(e.from).startsWith("doc:")) add(String(e.from).substring(4), e.type, e.provenance, 2)
  })

  // Shared-tag pass: weight 1 per shared tag
  var srcTagIds = {}
  this._state.edges.forEach(function(e) {
    if (e.type !== "HAS_TAG" || srcIds.indexOf(e.from) < 0) return
    srcTagIds[e.to] = true
  })
  var tagToOtherDocs = {}
  this._state.edges.forEach(function(e) {
    if (e.type !== "HAS_TAG" || !srcTagIds[e.to]) return
    if (srcIds.indexOf(e.from) >= 0) return // skip source docs
    if (!String(e.from).startsWith("doc:")) return
    var otherPath = String(e.from).substring(4)
    tagToOtherDocs[e.to] = tagToOtherDocs[e.to] || []
    if (tagToOtherDocs[e.to].indexOf(otherPath) < 0) tagToOtherDocs[e.to].push(otherPath)
  })
  Object.keys(tagToOtherDocs).forEach(function(tagId) {
    tagToOtherDocs[tagId].forEach(function(otherPath) {
      add(otherPath, "shared_tag", "EXTRACTED", 1)
    })
  })

  // Community pass: weight 0.5 (only if communities exist)
  if (isArray(this._state.communities)) {
    this._state.communities.forEach(function(comm) {
      var members = isArray(comm.members) ? comm.members : []
      var srcInComm = srcIds.filter(function(id) { return members.indexOf(id) >= 0 })
      if (srcInComm.length === 0) return
      members.forEach(function(memberId) {
        if (srcIds.indexOf(memberId) >= 0) return
        if (!String(memberId).startsWith("doc:")) return
        add(String(memberId).substring(4), "community", "EXTRACTED", 0.5)
      })
    })
  }

  return Object.keys(scores).map(function(path) {
    var info = scores[path]
    var sum = isMap(this._state.summaries.pages[path]) ? this._state.summaries.pages[path] : {}
    return {
      path: path,
      score: Number(info.score.toFixed(4)),
      connection: Object.keys(info.connection_types).join(","),
      provenance: Object.keys(info.provenance).join(","),
      digest: isString(sum.summary) ? sum.summary : (isString(sum.digest) ? sum.digest : path)
    }
  }.bind(this)).sort(function(a, b) { return b.score - a.score }).slice(0, cap)
}

MiniAWikiGraph.prototype.retrieve = function(concepts, opts) {
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
  Object.keys(this._state.nodes).forEach(function(id) {
    var n = this._state.nodes[id]
    var blob = (id + " " + stringify(n.props || {}, __, "")).toLowerCase()
    var score = 0
    words.forEach(function(w) { if (blob.indexOf(w) >= 0) score++ })
    if (score > 0) out.push({ id: id, type: n.type, score: score, props: n.props })
  }.bind(this))
  return out.sort(function(a, b) { return b.score - a.score }).slice(0, 20)
}

MiniAWikiGraph.prototype.neighbors = function(node) {
  var id = isString(node) && node.indexOf(":") > 0 ? node : this._id("doc", String(node || ""))
  return this._state.edges.filter(function(e) { return e.from === id || e.to === id })
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
    var nbs = this.neighbors(cur)
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
  var nodes = Object.keys(this._state.nodes).length
  var edges = this._state.edges.length
  var byProv = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 }
  this._state.edges.forEach(function(e) { byProv[this._normalizeProvenance(e.provenance)]++ }.bind(this))
  return { nodes: nodes, edges: edges, provenance: byProv, communities: isArray(this._state.communities) ? this._state.communities.length : 0 }
}

// F8: real GraphML export; honest HTML/SVG descriptions.
// F13: "falkordb" removed from export (use the "falkor" op to sync).
MiniAWikiGraph.prototype.export = function(format) {
  var f = isString(format) ? format.toLowerCase().trim() : "mermaid"
  if (f === "mermaid") {
    var lines = ["graph TD"]
    var _sanitize = function(s) { return String(s || "").replace(/[^a-zA-Z0-9_]/g, "_") }
    this._state.edges.forEach(function(e) { lines.push("  " + _sanitize(e.from) + " -->|" + _sanitize(e.type) + "| " + _sanitize(e.to)) })
    return lines.join("\n")
  }
  if (f === "graphml") {
    var gml = [
      "<?xml version=\"1.0\"?>",
      "<graphml xmlns=\"http://graphml.graphdrawing.org/graphml\">",
      "  <key id=\"type\" for=\"node\" attr.name=\"type\" attr.type=\"string\"/>",
      "  <key id=\"etype\" for=\"edge\" attr.name=\"type\" attr.type=\"string\"/>",
      "  <key id=\"prov\" for=\"edge\" attr.name=\"provenance\" attr.type=\"string\"/>",
      "  <graph id=\"wiki\" edgedefault=\"directed\">"
    ]
    var escAttr = function(s) { return String(s || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;") }
    Object.keys(this._state.nodes).forEach(function(id) {
      var n = this._state.nodes[id]
      gml.push("    <node id=\"" + escAttr(id) + "\"><data key=\"type\">" + escAttr(n.type || "concept") + "</data></node>")
    }.bind(this))
    this._state.edges.forEach(function(e, i) {
      gml.push("    <edge id=\"e" + i + "\" source=\"" + escAttr(e.from) + "\" target=\"" + escAttr(e.to) + "\"><data key=\"etype\">" + escAttr(e.type) + "</data><data key=\"prov\">" + escAttr(e.provenance) + "</data></edge>")
    })
    gml.push("  </graph>", "</graphml>")
    return gml.join("\n")
  }
  if (f === "neo4j") return this._state.edges.map(function(e) { return "MERGE (a:Node {id:'" + e.from + "'}) MERGE (b:Node {id:'" + e.to + "'}) MERGE (a)-[:" + e.type + "]->(b);" }).join("\n")
  if (f === "html") return "<html><body><pre>" + this.export("mermaid") + "</pre></body></html>"
  if (f === "svg") return "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='40'><text x='10' y='25'>mini-a wiki graph: " + this.stats().nodes + " nodes</text></svg>"
  return stringify(this._state, __, "  ")
}

MiniAWikiGraph.prototype.falkorSync = function() {
  if (!isMap(this._falkor) || !isString(this._falkor.host)) return { ok: false, error: "falkor not configured" }
  try {
    includeOPack("FalkorDB")
    loadLib("falkordb.js")
    var db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
    var self = this
    Object.keys(this._state.nodes).forEach(function(id) { db.createOrUpdateNode("Node", { id: id, type: self._state.nodes[id].type }) })
    this._state.edges.forEach(function(e) { db.linkNodes("Node", { id: e.from }, e.type, "Node", { id: e.to }, { provenance: e.provenance }) })
    return { ok: true, nodes: Object.keys(this._state.nodes).length, edges: this._state.edges.length }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiGraph.prototype.falkorQuery = function(cypher) {
  if (!isMap(this._falkor) || !isString(this._falkor.host)) return { ok: false, error: "falkor not configured" }
  try {
    includeOPack("FalkorDB")
    loadLib("falkordb.js")
    var db = new FalkorDB(this._falkor.host, this._falkor.port || 6379, this._falkor.graph || "mini_a_wiki", this._falkor.user, this._falkor.pass)
    return db.query(cypher)
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

// F6: shrink warning when node count drops ≥50% vs previous on-disk graph.
MiniAWikiGraph.prototype.save = function() {
  this._ensureDir()
  var p = this._graphDir + "/graph.json"
  // F6: warn if node count shrank dramatically
  try {
    if (io.fileExists(p)) {
      var prev = af.fromJson(io.readFileString(p))
      if (isMap(prev) && isMap(prev.nodes)) {
        var prevCount = Object.keys(prev.nodes).length
        var newCount = Object.keys(this._state.nodes).length
        if (prevCount > 10 && newCount < prevCount * 0.5) {
          this._log("warn", "[graph] shrink warning: nodes " + prevCount + " -> " + newCount)
        }
      }
    }
  } catch(e) {}
  // F11: do not persist updated_at (volatile timestamp); keep it in-memory only
  var cloneState = clone(this._state)
  delete cloneState._edgeIndex
  delete cloneState.updated_at
  io.writeFileString(p, stringify(cloneState, __, "  "))
  var s = this.stats()

  var nodesArr = []
  var edgesArr = []
  var nodeKeys = Object.keys(this._state.nodes)
  for (var i = 0; i < nodeKeys.length; i++) {
    var k = nodeKeys[i]
    var n = this._state.nodes[k]
    nodesArr.push({
      id: n.id,
      label: n.id.replace(/^(doc:|tag:|section:|concept:)/i, ""),
      type: n.type || "concept",
      props: n.props || {},
      community: isDef(n.community) ? n.community : 0
    })
  }

  for (var j = 0; j < this._state.edges.length; j++) {
    var e = this._state.edges[j]
    edgesArr.push({
      from: e.from,
      to: e.to,
      type: e.type,
      provenance: e.provenance,
      props: e.props || {}
    })
  }

  var commsArr = isArray(this._state.communities) ? this._state.communities : []
  var surpriseArr = isArray(this._state.surprise) ? this._state.surprise : []

  var jsonNodes = JSON.stringify(nodesArr)
  var jsonEdges = JSON.stringify(edgesArr)
  var jsonComms = JSON.stringify(commsArr)
  var jsonSurprise = JSON.stringify(surpriseArr)

  var reportMD = "# Graph report\n\n" +
                 "<div class=\"wiki-graph-container\" style=\"display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: var(--text-primary, #333); margin-top: 20px;\">\n" +
                 "  <!-- Stats Summary Cards -->\n" +
                 "  <div style=\"display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap;\">\n" +
                 "    <div class=\"stat-card\" style=\"flex: 1; min-width: 150px; padding: 15px; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);\">\n" +
                 "      <div style=\"font-size: 12px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 5px;\">Nodes</div>\n" +
                 "      <div id=\"stat-nodes\" style=\"font-size: 28px; font-weight: 800; color: #1e3a8a;\">0</div>\n" +
                 "    </div>\n" +
                 "    <div class=\"stat-card\" style=\"flex: 1; min-width: 150px; padding: 15px; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);\">\n" +
                 "      <div style=\"font-size: 12px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 5px;\">Edges</div>\n" +
                 "      <div id=\"stat-edges\" style=\"font-size: 28px; font-weight: 800; color: #1e3a8a;\">0</div>\n" +
                 "    </div>\n" +
                 "    <div class=\"stat-card\" style=\"flex: 1; min-width: 150px; padding: 15px; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);\">\n" +
                 "      <div style=\"font-size: 12px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 5px;\">Communities</div>\n" +
                 "      <div id=\"stat-communities\" style=\"font-size: 28px; font-weight: 800; color: #1e3a8a;\">0</div>\n" +
                 "    </div>\n" +
                 "  </div>\n\n" +
                 "  <!-- Main Workspace Grid -->\n" +
                 "  <div style=\"display: flex; gap: 20px; flex-wrap: wrap; position: relative;\">\n" +
                 "    <!-- Visualizer Canvas Panel -->\n" +
                 "    <div class=\"graph-panel\" style=\"flex: 2; min-width: 500px; height: 600px; border: 1px solid #ddd; border-radius: 8px; background: #fff; overflow: hidden; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.05);\">\n" +
                 "      <div id=\"graph-visualizer\" style=\"width: 100%; height: 100%;\"></div>\n" +
                 "      <canvas id=\"fallback-canvas\" style=\"display: none; width: 100%; height: 100%; cursor: grab;\"></canvas>\n" +
                 "      <div style=\"position: absolute; top: 10px; right: 10px; display: flex; gap: 8px; z-index: 100;\">\n" +
                 "        <button id=\"btn-fullscreen-graph\" style=\"padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.05);\">Fullscreen 🖥️</button>\n" +
                 "        <button id=\"btn-zoom-fit\" style=\"padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.05);\">Fit 🔄</button>\n" +
                 "      </div>\n" +
                 "      <div style=\"position: absolute; bottom: 10px; left: 10px; font-size: 11px; color: #888; background: rgba(255,255,255,0.8); padding: 4px 8px; border-radius: 4px; z-index: 100;\">\n" +
                 "        Scroll to zoom. Drag to pan. Click node to inspect.\n" +
                 "      </div>\n" +
                 "    </div>\n\n" +
                 "    <!-- Sidebar Panel -->\n" +
                 "    <div class=\"sidebar-panel\" style=\"flex: 1; min-width: 300px; max-height: 600px; overflow-y: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 20px;\">\n" +
                 "      <!-- Search & Filters -->\n" +
                 "      <div>\n" +
                 "        <h3 style=\"margin-top: 0; margin-bottom: 12px; font-size: 15px; font-weight: 600; color: #1e3a8a;\">Search & Filters</h3>\n" +
                 "        <input type=\"text\" id=\"graph-search\" placeholder=\"Search nodes...\" style=\"width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; box-sizing: border-box; margin-bottom: 12px;\" />\n" +
                 "        <div style=\"display: flex; flex-direction: column; gap: 8px; font-size: 12px;\">\n" +
                 "          <label style=\"display: flex; align-items: center; gap: 6px; cursor: pointer;\">\n" +
                 "            <input type=\"checkbox\" class=\"type-filter\" value=\"document\" checked />\n" +
                 "            <span>Document Nodes</span>\n" +
                 "          </label>\n" +
                 "          <label style=\"display: flex; align-items: center; gap: 6px; cursor: pointer;\">\n" +
                 "            <input type=\"checkbox\" class=\"type-filter\" value=\"tag\" checked />\n" +
                 "            <span>Tag Nodes</span>\n" +
                 "          </label>\n" +
                 "          <label style=\"display: flex; align-items: center; gap: 6px; cursor: pointer;\">\n" +
                 "            <input type=\"checkbox\" class=\"type-filter\" value=\"section\" checked />\n" +
                 "            <span>Section Nodes</span>\n" +
                 "          </label>\n" +
                 "          <label style=\"display: flex; align-items: center; gap: 6px; cursor: pointer;\">\n" +
                 "            <input type=\"checkbox\" class=\"type-filter\" value=\"concept\" checked />\n" +
                 "            <span>Concept Nodes</span>\n" +
                 "          </label>\n" +
                 "        </div>\n" +
                 "      </div>\n\n" +
                 "      <!-- Node Details Container -->\n" +
                 "      <div id=\"details-section\" style=\"border-top: 1px solid #eee; padding-top: 15px;\">\n" +
                 "        <h3 style=\"margin-top: 0; margin-bottom: 12px; font-size: 15px; font-weight: 600; color: #1e3a8a;\">Node Details</h3>\n" +
                 "        <div id=\"details-empty\" style=\"font-size: 12px; color: #888; font-style: italic;\">\n" +
                 "          Click on any node in the graph to inspect its details, community membership, properties, and links.\n" +
                 "        </div>\n" +
                 "        <div id=\"details-content\" style=\"display: none; font-size: 12px; display: flex; flex-direction: column; gap: 10px;\">\n" +
                 "          <div><strong style=\"color: #666;\">ID:</strong> <span id=\"node-detail-id\" style=\"font-family: monospace;\">-</span></div>\n" +
                 "          <div><strong style=\"color: #666;\">Type:</strong> <span id=\"node-detail-type\" style=\"text-transform: capitalize;\">-</span></div>\n" +
                 "          <div><strong style=\"color: #666;\">Community:</strong> <span id=\"node-detail-community\" style=\"font-weight: 500;\">-</span></div>\n" +
                 "          <div id=\"node-detail-props-container\" style=\"display: none;\">\n" +
                 "            <strong style=\"color: #666;\">Properties:</strong>\n" +
                 "            <pre id=\"node-detail-props\" style=\"background: #eaeaea; padding: 6px; border-radius: 4px; font-family: monospace; overflow-x: auto; margin-top: 4px; margin-bottom: 0; font-size: 11px;\"></pre>\n" +
                 "          </div>\n" +
                 "          <div>\n" +
                 "            <strong style=\"color: #666;\">Connected Neighbors:</strong>\n" +
                 "            <ul id=\"node-detail-neighbors\" style=\"padding-left: 18px; margin: 4px 0 0 0; display: flex; flex-direction: column; gap: 4px;\"></ul>\n" +
                 "          </div>\n" +
                 "        </div>\n" +
                 "      </div>\n\n" +
                 "      <!-- Communities Summary List -->\n" +
                 "      <div style=\"border-top: 1px solid #eee; padding-top: 15px;\">\n" +
                 "        <h3 style=\"margin-top: 0; margin-bottom: 12px; font-size: 15px; font-weight: 600; color: #1e3a8a;\">Communities</h3>\n" +
                 "        <div id=\"communities-list\" style=\"display: flex; flex-direction: column; gap: 6px; font-size: 12px; max-height: 150px; overflow-y: auto;\"></div>\n" +
                 "      </div>\n\n" +
                 "      <!-- Surprise Links List -->\n" +
                 "      <div style=\"border-top: 1px solid #eee; padding-top: 15px;\">\n" +
                 "        <h3 style=\"margin-top: 0; margin-bottom: 6px; font-size: 15px; font-weight: 600; color: #1e3a8a;\">Top Surprise Links 🌀</h3>\n" +
                 "        <div style=\"font-size: 11px; color: #777; margin-bottom: 10px;\">Links with high surprise values span across separate tag/folder boundaries.</div>\n" +
                 "        <div style=\"max-height: 150px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; background: #fff;\">\n" +
                 "          <table style=\"width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;\">\n" +
                 "            <thead>\n" +
                 "              <tr style=\"background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-weight: bold;\">\n" +
                 "                <th style=\"padding: 6px 8px;\">From</th>\n" +
                 "                <th style=\"padding: 6px 8px;\">To</th>\n" +
                 "                <th style=\"padding: 6px 8px; text-align: right;\">Surprise</th>\n" +
                 "              </tr>\n" +
                 "            </thead>\n" +
                 "            <tbody id=\"surprise-links-body\"></tbody>\n" +
                 "          </table>\n" +
                 "        </div>\n" +
                 "      </div>\n" +
                 "    </div>\n" +
                 "  </div>\n" +
                 "</div>\n\n" +
                 "<style>\n" +
                 "  .wiki-graph-container {\n" +
                 "    --bg-primary: #ffffff;\n" +
                 "    --bg-secondary: #fafafa;\n" +
                 "    --bg-tertiary: #f1f5f9;\n" +
                 "    --border-color: #ddd;\n" +
                 "    --text-primary: #333333;\n" +
                 "    --text-secondary: #666666;\n" +
                 "    --accent: #1e3a8a;\n" +
                 "  }\n" +
                 "  \n" +
                 "  body.markdown-body-dark .wiki-graph-container,\n" +
                 "  .markdown-body-dark .wiki-graph-container {\n" +
                 "    --bg-primary: #161b22;\n" +
                 "    --bg-secondary: #0d1117;\n" +
                 "    --bg-tertiary: #21262d;\n" +
                 "    --border-color: #30363d;\n" +
                 "    --text-primary: #c9d1d9;\n" +
                 "    --text-secondary: #8b949e;\n" +
                 "    --accent: #58a6ff;\n" +
                 "  }\n\n" +
                 "  .stat-card {\n" +
                 "    background: var(--bg-secondary) !important;\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "  }\n" +
                 "  .stat-card div:first-child {\n" +
                 "    color: var(--text-secondary) !important;\n" +
                 "  }\n" +
                 "  .stat-card div:last-child {\n" +
                 "    color: var(--accent) !important;\n" +
                 "  }\n\n" +
                 "  .graph-panel {\n" +
                 "    background: var(--bg-primary) !important;\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "  }\n" +
                 "  .graph-panel button {\n" +
                 "    background: var(--bg-secondary) !important;\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "    color: var(--text-primary) !important;\n" +
                 "  }\n" +
                 "  .graph-panel button:hover {\n" +
                 "    background: var(--bg-tertiary) !important;\n" +
                 "  }\n" +
                 "  .graph-panel div[style*=\"background\"] {\n" +
                 "    background: var(--bg-secondary) !important;\n" +
                 "    color: var(--text-secondary) !important;\n" +
                 "    border: 1px solid var(--border-color) !important;\n" +
                 "  }\n\n" +
                 "  .sidebar-panel {\n" +
                 "    background: var(--bg-secondary) !important;\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "    color: var(--text-primary) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel h3 {\n" +
                 "    color: var(--accent) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel input[type=\"text\"] {\n" +
                 "    background: var(--bg-primary) !important;\n" +
                 "    color: var(--text-primary) !important;\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel table {\n" +
                 "    border-color: var(--border-color) !important;\n" +
                 "    background: var(--bg-primary) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel tr:first-child {\n" +
                 "    background: var(--bg-tertiary) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel tr {\n" +
                 "    border-bottom: 1px solid var(--border-color) !important;\n" +
                 "  }\n" +
                 "  .sidebar-panel pre {\n" +
                 "    background: var(--bg-tertiary) !important;\n" +
                 "    color: var(--text-primary) !important;\n" +
                 "  }\n\n" +
                 "  .community-pill {\n" +
                 "    padding: 4px 8px;\n" +
                 "    border-radius: 4px;\n" +
                 "    font-size: 11px;\n" +
                 "    cursor: pointer;\n" +
                 "    transition: all 0.2s ease;\n" +
                 "    border: 1px solid transparent;\n" +
                 "    display: flex;\n" +
                 "    justify-content: space-between;\n" +
                 "    align-items: center;\n" +
                 "  }\n" +
                 "  .community-pill:hover {\n" +
                 "    filter: brightness(0.9);\n" +
                 "    border-color: var(--border-color);\n" +
                 "  }\n\n" +
                 "  .neighbor-link {\n" +
                 "    color: var(--accent);\n" +
                 "    cursor: pointer;\n" +
                 "    text-decoration: underline;\n" +
                 "  }\n" +
                 "  .neighbor-link:hover {\n" +
                 "    filter: brightness(1.2);\n" +
                 "  }\n" +
                 "</style>\n\n" +
                 "<script>\n" +
                 "var rawNodes = " + jsonNodes + ";\n" +
                 "var rawEdges = " + jsonEdges + ";\n" +
                 "var rawCommunities = " + jsonComms + ";\n" +
                 "var rawSurprise = " + jsonSurprise + ";\n" +
                 "(function() {\n" +
                 "  var nodes = rawNodes;\n" +
                 "  var edges = rawEdges;\n" +
                 "  var communities = rawCommunities;\n" +
                 "  var surprise = rawSurprise;\n\n" +
                 "  var colors = [\n" +
                 "    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', \n" +
                 "    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7'\n" +
                 "  ];\n\n" +
                 "  document.getElementById('stat-nodes').innerText = nodes.length;\n" +
                 "  document.getElementById('stat-edges').innerText = edges.length;\n" +
                 "  document.getElementById('stat-communities').innerText = communities.length;\n\n" +
                 "  var surpriseBody = document.getElementById('surprise-links-body');\n" +
                 "  if (surprise && surprise.length > 0) {\n" +
                 "    surprise.slice(0, 15).forEach(function(s) {\n" +
                 "      var tr = document.createElement('tr');\n" +
                 "      tr.style.borderBottom = '1px solid var(--border-color)';\n" +
                 "      tr.innerHTML = '<td style=\"padding: 6px 8px; font-family: monospace;\">' + s.from + '</td>' +\n" +
                 "                     '<td style=\"padding: 6px 8px; font-family: monospace;\">' + s.to + '</td>' +\n" +
                 "                     '<td style=\"padding: 6px 8px; text-align: right; font-weight: bold; color: #d97706;\">' + s.score + '</td>';\n" +
                 "      surpriseBody.appendChild(tr);\n" +
                 "    });\n" +
                 "  } else {\n" +
                 "    surpriseBody.innerHTML = '<tr><td colspan=\"3\" style=\"padding: 10px; color: #888; text-align: center;\">No cross-document surprise scores calculated.</td></tr>';\n" +
                 "  }\n\n" +
                 "  var commsList = document.getElementById('communities-list');\n" +
                 "  if (communities && communities.length > 0) {\n" +
                 "    communities.forEach(function(c, idx) {\n" +
                 "      var pill = document.createElement('div');\n" +
                 "      pill.className = 'community-pill';\n" +
                 "      var color = colors[idx % colors.length];\n" +
                 "      pill.style.background = color + '20';\n" +
                 "      pill.style.color = color;\n" +
                 "      pill.innerHTML = '<strong>' + (c.label || ('Community ' + idx)) + '</strong>' +\n" +
                 "                       '<span style=\"font-size: 10px; opacity: 0.8;\">' + (c.coverage ? (c.coverage.toFixed(2) + ' cov') : '') + '</span>';\n" +
                 "      \n" +
                 "      pill.addEventListener('click', function() {\n" +
                 "        highlightCommunity(idx);\n" +
                 "      });\n" +
                 "      commsList.appendChild(pill);\n" +
                 "    });\n" +
                 "  } else {\n" +
                 "    commsList.innerHTML = '<div style=\"color: #888; font-style: italic;\">No community detection state.</div>';\n" +
                 "  }\n\n" +
                 "  var network = null;\n" +
                 "  var currentSearchQuery = \"\";\n" +
                 "  var activeFilters = { document: true, tag: true, section: true, concept: true };\n" +
                 "  var selectedNodeId = null;\n\n" +
                 "  function getFilteredData() {\n" +
                 "    var filteredNodes = nodes.filter(function(n) {\n" +
                 "      if (!activeFilters[n.type]) return false;\n" +
                 "      if (currentSearchQuery) {\n" +
                 "        var query = currentSearchQuery.toLowerCase();\n" +
                 "        return n.label.toLowerCase().indexOf(query) >= 0 || n.id.toLowerCase().indexOf(query) >= 0;\n" +
                 "      }\n" +
                 "      return true;\n" +
                 "    });\n\n" +
                 "    var filteredNodeIds = {};\n" +
                 "    filteredNodes.forEach(function(n) { filteredNodeIds[n.id] = true; });\n\n" +
                 "    var filteredEdges = edges.filter(function(e) {\n" +
                 "      return filteredNodeIds[e.from] && filteredNodeIds[e.to];\n" +
                 "    });\n\n" +
                 "    return { nodes: filteredNodes, edges: filteredEdges };\n" +
                 "  }\n\n" +
                 "  function initVisNetwork() {\n" +
                 "    var container = document.getElementById('graph-visualizer');\n" +
                 "    var data = getFilteredData();\n\n" +
                 "    var visNodes = data.nodes.map(function(n) {\n" +
                 "      var color = colors[n.community % colors.length];\n" +
                 "      var shape = 'dot';\n" +
                 "      if (n.type === 'tag') shape = 'triangle';\n" +
                 "      if (n.type === 'section') shape = 'square';\n" +
                 "      if (n.type === 'concept') shape = 'diamond';\n" +
                 "      \n" +
                 "      return {\n" +
                 "        id: n.id,\n" +
                 "        label: n.label,\n" +
                 "        color: {\n" +
                 "          background: color,\n" +
                 "          border: '#ffffff',\n" +
                 "          highlight: { background: color, border: '#1e3a8a' }\n" +
                 "        },\n" +
                 "        shape: shape,\n" +
                 "        size: n.type === 'document' ? 22 : 15,\n" +
                 "        font: { color: 'var(--text-primary)', size: 12, face: 'inherit' }\n" +
                 "      };\n" +
                 "    });\n\n" +
                 "    var visEdges = data.edges.map(function(e) {\n" +
                 "      return {\n" +
                 "        from: e.from,\n" +
                 "        to: e.to,\n" +
                 "        arrows: 'to',\n" +
                 "        color: { color: 'rgba(156, 163, 175, 0.4)', highlight: '#1e3a8a' },\n" +
                 "        width: 1\n" +
                 "      };\n" +
                 "    });\n\n" +
                 "    var networkData = {\n" +
                 "      nodes: new vis.DataSet(visNodes),\n" +
                 "      edges: new vis.DataSet(visEdges)\n" +
                 "    };\n\n" +
                 "    var options = {\n" +
                 "      physics: {\n" +
                 "        solver: 'forceAtlas2Based',\n" +
                 "        forceAtlas2Based: {\n" +
                 "          gravitationalConstant: -50,\n" +
                 "          centralGravity: 0.01,\n" +
                 "          springLength: 100,\n" +
                 "          springConstant: 0.08\n" +
                 "        },\n" +
                 "        stabilization: { iterations: 150, updateInterval: 25 }\n" +
                 "      },\n" +
                 "      interaction: {\n" +
                 "        hover: true,\n" +
                 "        selectable: true,\n" +
                 "        multiselect: false\n" +
                 "      }\n" +
                 "    };\n\n" +
                 "    network = new vis.Network(container, networkData, options);\n\n" +
                 "    network.on(\"selectNode\", function(params) {\n" +
                 "      if (params.nodes.length > 0) {\n" +
                 "        showNodeDetails(params.nodes[0]);\n" +
                 "      }\n" +
                 "    });\n\n" +
                 "    network.on(\"deselectNode\", function() {\n" +
                 "      hideNodeDetails();\n" +
                 "    });\n\n" +
                 "    window.customZoomFit = function() {\n" +
                 "      network.fit({ animation: true });\n" +
                 "    };\n" +
                 "  }\n\n" +
                 "  var fallbackActive = false;\n" +
                 "  function initFallbackCanvas() {\n" +
                 "    fallbackActive = true;\n" +
                 "    var visDiv = document.getElementById('graph-visualizer');\n" +
                 "    var canvas = document.getElementById('fallback-canvas');\n" +
                 "    visDiv.style.display = 'none';\n" +
                 "    canvas.style.display = 'block';\n\n" +
                 "    var ctx = canvas.getContext('2d');\n" +
                 "    canvas.width = canvas.parentElement.clientWidth || 600;\n" +
                 "    canvas.height = canvas.parentElement.clientHeight || 600;\n\n" +
                 "    var data = getFilteredData();\n" +
                 "    var fnodes = data.nodes;\n" +
                 "    var fedges = data.edges;\n\n" +
                 "    fnodes.forEach(function(n) {\n" +
                 "      n.x = canvas.width/2 + (Math.random() - 0.5) * 200;\n" +
                 "      n.y = canvas.height/2 + (Math.random() - 0.5) * 200;\n" +
                 "      n.vx = 0;\n" +
                 "      n.vy = 0;\n" +
                 "      n.color = colors[n.community % colors.length];\n" +
                 "    });\n\n" +
                 "    var dragNode = null;\n" +
                 "    var transform = { x: 0, y: 0, scale: 1 };\n" +
                 "    var dragStart = null;\n\n" +
                 "    canvas.addEventListener('mousedown', function(e) {\n" +
                 "      var rect = canvas.getBoundingClientRect();\n" +
                 "      var mx = (e.clientX - rect.left - transform.x) / transform.scale;\n" +
                 "      var my = (e.clientY - rect.top - transform.y) / transform.scale;\n\n" +
                 "      dragNode = fnodes.find(function(n) {\n" +
                 "        var dx = n.x - mx;\n" +
                 "        var dy = n.y - my;\n" +
                 "        return Math.sqrt(dx*dx + dy*dy) < 15;\n" +
                 "      });\n\n" +
                 "      if (dragNode) {\n" +
                 "        showNodeDetails(dragNode.id);\n" +
                 "      } else {\n" +
                 "        dragStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };\n" +
                 "      }\n" +
                 "    });\n\n" +
                 "    window.addEventListener('mousemove', function(e) {\n" +
                 "      if (dragNode) {\n" +
                 "        var rect = canvas.getBoundingClientRect();\n" +
                 "        dragNode.x = (e.clientX - rect.left - transform.x) / transform.scale;\n" +
                 "        dragNode.y = (e.clientY - rect.top - transform.y) / transform.scale;\n" +
                 "      } else if (dragStart) {\n" +
                 "        transform.x = dragStart.tx + (e.clientX - dragStart.x);\n" +
                 "        transform.y = dragStart.ty + (e.clientY - dragStart.y);\n" +
                 "      }\n" +
                 "    });\n\n" +
                 "    window.addEventListener('mouseup', function() {\n" +
                 "      dragNode = null;\n" +
                 "      dragStart = null;\n" +
                 "    });\n\n" +
                 "    canvas.addEventListener('wheel', function(e) {\n" +
                 "      e.preventDefault();\n" +
                 "      var factor = e.deltaY < 0 ? 1.1 : 0.9;\n" +
                 "      transform.scale *= factor;\n" +
                 "      if (transform.scale < 0.2) transform.scale = 0.2;\n" +
                 "      if (transform.scale > 5) transform.scale = 5;\n" +
                 "    }, { passive: false });\n\n" +
                 "    window.customZoomFit = function() {\n" +
                 "      transform.x = 0;\n" +
                 "      transform.y = 0;\n" +
                 "      transform.scale = 1;\n" +
                 "    };\n\n" +
                 "    function tick() {\n" +
                 "      if (!fallbackActive) return;\n\n" +
                 "      for (var i = 0; i < fnodes.length; i++) {\n" +
                 "        var n1 = fnodes[i];\n" +
                 "        for (var j = i + 1; j < fnodes.length; j++) {\n" +
                 "          var n2 = fnodes[j];\n" +
                 "          var dx = n2.x - n1.x;\n" +
                 "          var dy = n2.y - n1.y;\n" +
                 "          var dist = Math.sqrt(dx*dx + dy*dy) || 1;\n" +
                 "          if (dist < 250) {\n" +
                 "            var force = 65 / (dist * dist);\n" +
                 "            var fx = (dx / dist) * force;\n" +
                 "            var fy = (dy / dist) * force;\n" +
                 "            n1.vx -= fx;\n" +
                 "            n1.vy -= fy;\n" +
                 "            n2.vx += fx;\n" +
                 "            n2.vy += fy;\n" +
                 "          }\n" +
                 "        }\n" +
                 "        n1.vx += (canvas.width/2 - n1.x) * 0.003;\n" +
                 "        n1.vy += (canvas.height/2 - n1.y) * 0.003;\n" +
                 "      }\n\n" +
                 "      fedges.forEach(function(e) {\n" +
                 "        var n1 = fnodes.find(n => n.id === e.from);\n" +
                 "        var n2 = fnodes.find(n => n.id === e.to);\n" +
                 "        if (n1 && n2) {\n" +
                 "          var dx = n2.x - n1.x;\n" +
                 "          var dy = n2.y - n1.y;\n" +
                 "          var dist = Math.sqrt(dx*dx + dy*dy) || 1;\n" +
                 "          var targetDist = 90;\n" +
                 "          var force = (dist - targetDist) * 0.012;\n" +
                 "          var fx = (dx / dist) * force;\n" +
                 "          var fy = (dy / dist) * force;\n" +
                 "          n1.vx += fx;\n" +
                 "          n1.vy += fy;\n" +
                 "          n2.vx -= fx;\n" +
                 "          n2.vy -= fy;\n" +
                 "        }\n" +
                 "      });\n\n" +
                 "      fnodes.forEach(function(n) {\n" +
                 "        if (n === dragNode) return;\n" +
                 "        n.x += n.vx;\n" +
                 "        n.y += n.vy;\n" +
                 "        n.vx *= 0.85;\n" +
                 "        n.vy *= 0.85;\n" +
                 "      });\n\n" +
                 "      ctx.clearRect(0, 0, canvas.width, canvas.height);\n" +
                 "      ctx.save();\n" +
                 "      ctx.translate(transform.x, transform.y);\n" +
                 "      ctx.scale(transform.scale, transform.scale);\n\n" +
                 "      ctx.strokeStyle = 'rgba(150, 150, 150, 0.4)';\n" +
                 "      ctx.lineWidth = 1;\n" +
                 "      fedges.forEach(function(e) {\n" +
                 "        var n1 = fnodes.find(n => n.id === e.from);\n" +
                 "        var n2 = fnodes.find(n => n.id === e.to);\n" +
                 "        if (n1 && n2) {\n" +
                 "          ctx.beginPath();\n" +
                 "          ctx.moveTo(n1.x, n1.y);\n" +
                 "          ctx.lineTo(n2.x, n2.y);\n" +
                 "          ctx.stroke();\n" +
                 "        }\n" +
                 "      });\n\n" +
                 "      fnodes.forEach(function(n) {\n" +
                 "        ctx.beginPath();\n" +
                 "        ctx.arc(n.x, n.y, n.type === 'document' ? 10 : 7, 0, 2*Math.PI);\n" +
                 "        ctx.fillStyle = n.color;\n" +
                 "        ctx.fill();\n" +
                 "        ctx.strokeStyle = selectedNodeId === n.id ? '#1e3a8a' : '#ffffff';\n" +
                 "        ctx.lineWidth = selectedNodeId === n.id ? 3 : 1.5;\n" +
                 "        ctx.stroke();\n\n" +
                 "        ctx.fillStyle = 'var(--text-primary)';\n" +
                 "        ctx.font = '10px sans-serif';\n" +
                 "        ctx.fillText(n.label, n.x + 14, n.y + 4);\n" +
                 "      });\n\n" +
                 "      ctx.restore();\n" +
                 "      requestAnimationFrame(tick);\n" +
                 "    }\n" +
                 "    tick();\n" +
                 "  }\n\n" +
                 "  function showNodeDetails(nodeId) {\n" +
                 "    selectedNodeId = nodeId;\n" +
                 "    var node = nodes.find(n => n.id === nodeId);\n" +
                 "    if (!node) return;\n\n" +
                 "    document.getElementById('details-empty').style.display = 'none';\n" +
                 "    var details = document.getElementById('details-content');\n" +
                 "    details.style.display = 'flex';\n\n" +
                 "    document.getElementById('node-detail-id').innerText = node.id;\n" +
                 "    document.getElementById('node-detail-type').innerText = node.type;\n" +
                 "    \n" +
                 "    var color = colors[node.community % colors.length];\n" +
                 "    var commSpan = document.getElementById('node-detail-community');\n" +
                 "    commSpan.innerText = communities[node.community] ? (communities[node.community].label || ('Community ' + node.community)) : ('Community ' + node.community);\n" +
                 "    commSpan.style.color = color;\n\n" +
                 "    var propsCont = document.getElementById('node-detail-props-container');\n" +
                 "    if (node.props && Object.keys(node.props).length > 0) {\n" +
                 "      propsCont.style.display = 'block';\n" +
                 "      document.getElementById('node-detail-props').innerText = JSON.stringify(node.props, null, 2);\n" +
                 "    } else {\n" +
                 "      propsCont.style.display = 'none';\n" +
                 "    }\n\n" +
                 "    var neighborList = document.getElementById('node-detail-neighbors');\n" +
                 "    neighborList.innerHTML = '';\n" +
                 "    \n" +
                 "    var connected = edges.filter(e => e.from === nodeId || e.to === nodeId);\n" +
                 "    if (connected.length > 0) {\n" +
                 "      var added = {};\n" +
                 "      connected.forEach(function(e) {\n" +
                 "        var otherId = e.from === nodeId ? e.to : e.from;\n" +
                 "        if (added[otherId]) return;\n" +
                 "        added[otherId] = true;\n\n" +
                 "        var li = document.createElement('li');\n" +
                 "        var cleanLabel = otherId.replace(/^(doc:|tag:|section:|concept:)/i, \"\");\n" +
                 "        li.innerHTML = '<span class=\"neighbor-link\" data-id=\"' + otherId + '\">' + cleanLabel + '</span>' +\n" +
                 "                       ' <span style=\"font-size: 10px; color: #888;\">(' + e.type + ')</span>';\n" +
                 "        \n" +
                 "        li.querySelector('.neighbor-link').addEventListener('click', function() {\n" +
                 "          focusNode(otherId);\n" +
                 "        });\n" +
                 "        neighborList.appendChild(li);\n" +
                 "      });\n" +
                 "    } else {\n" +
                 "      neighborList.innerHTML = '<span style=\"color: #888; font-style: italic;\">No connections</span>';\n" +
                 "    }\n" +
                 "  }\n\n" +
                 "  function hideNodeDetails() {\n" +
                 "    selectedNodeId = null;\n" +
                 "    document.getElementById('details-empty').style.display = 'block';\n" +
                 "    document.getElementById('details-content').style.display = 'none';\n" +
                 "  }\n\n" +
                 "  function focusNode(nodeId) {\n" +
                 "    showNodeDetails(nodeId);\n" +
                 "    if (network) {\n" +
                 "      network.selectNodes([nodeId]);\n" +
                 "      network.focus(nodeId, { scale: 1.2, animation: true });\n" +
                 "    }\n" +
                 "  }\n\n" +
                 "  function highlightCommunity(communityId) {\n" +
                 "    if (network) {\n" +
                 "      var filtered = getFilteredData();\n" +
                 "      var updates = [];\n" +
                 "      filtered.nodes.forEach(function(n) {\n" +
                 "        var baseColor = colors[n.community % colors.length];\n" +
                 "        var isMatch = n.community === communityId;\n" +
                 "        updates.push({\n" +
                 "          id: n.id,\n" +
                 "          color: {\n" +
                 "            background: isMatch ? baseColor : 'rgba(200, 200, 200, 0.2)',\n" +
                 "            border: isMatch ? '#ffffff' : 'rgba(200, 200, 200, 0.2)'\n" +
                 "          }\n" +
                 "        });\n" +
                 "      });\n" +
                 "      network.body.data.nodes.update(updates);\n" +
                 "    }\n" +
                 "  }\n\n" +
                 "  function reloadData() {\n" +
                 "    if (network) {\n" +
                 "      network.destroy();\n" +
                 "      initVisNetwork();\n" +
                 "    } else if (fallbackActive) {\n" +
                 "      initFallbackCanvas();\n" +
                 "    }\n" +
                 "  }\n\n" +
                 "  document.getElementById('graph-search').addEventListener('input', function(e) {\n" +
                 "    currentSearchQuery = e.target.value;\n" +
                 "    reloadData();\n" +
                 "  });\n\n" +
                 "  var filters = document.querySelectorAll('.type-filter');\n" +
                 "  filters.forEach(function(f) {\n" +
                 "    f.addEventListener('change', function() {\n" +
                 "      activeFilters[f.value] = f.checked;\n" +
                 "      reloadData();\n" +
                 "    });\n" +
                 "  });\n\n" +
                 "  document.getElementById('btn-zoom-fit').addEventListener('click', function() {\n" +
                 "    if (window.customZoomFit) window.customZoomFit();\n" +
                 "  });\n\n" +
                 "  document.getElementById('btn-fullscreen-graph').addEventListener('click', function() {\n" +
                 "    var panel = document.querySelector('.graph-panel');\n" +
                 "    if (!document.fullscreenElement) {\n" +
                 "      panel.requestFullscreen().catch(function(err) {\n" +
                 "        console.error(err);\n" +
                 "      });\n" +
                 "      panel.style.height = '100%';\n" +
                 "    } else {\n" +
                 "      document.exitFullscreen();\n" +
                 "    }\n" +
                 "  });\n\n" +
                 "  document.addEventListener('fullscreenchange', function() {\n" +
                 "    var panel = document.querySelector('.graph-panel');\n" +
                 "    if (!document.fullscreenElement) {\n" +
                 "      panel.style.height = '600px';\n" +
                 "    }\n" +
                 "  });\n\n" +
                 "  function init() {\n" +
                 "    var checkInterval = setInterval(function() {\n" +
                 "      if (typeof vis !== 'undefined') {\n" +
                 "        clearInterval(checkInterval);\n" +
                 "        initVisNetwork();\n" +
                 "      }\n" +
                 "    }, 200);\n\n" +
                 "    setTimeout(function() {\n" +
                 "      if (typeof vis === 'undefined') {\n" +
                 "        clearInterval(checkInterval);\n" +
                 "        initFallbackCanvas();\n" +
                 "      }\n" +
                 "    }, 2000);\n" +
                 "  }\n\n" +
                 "  init();\n" +
                 "})();\n" +
                 "</script>\n"
  io.writeFileString(this._graphDir + "/GRAPH_REPORT.md", reportMD)
}

MiniAWikiGraph.prototype.load = function() {
  try {
    var p = this._graphDir + "/graph.json"
    if (!io.fileExists(p)) return false
    var raw = io.readFileString(p)
    var obj = af.fromJson(raw)
    if (!isMap(obj)) return false
    this._state = merge(this._state, obj)
    this._reindexEdges()
    return true
  } catch(e) {
    return false
  }
}
