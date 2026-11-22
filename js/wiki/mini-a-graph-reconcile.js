// Maintain derived concept memberships without turning similarity into assertions.
var MiniAGraphReconciler = function(graph) {
  this.graph = graph
}

// Release every cache resource even if a provider or MVStore close fails.
MiniAGraphReconciler.closeCache = function(cache, lock, channel) {
  var closed = true
  ;[function() { if (cache) cache.close() }, function() { if (lock) lock.release() }, function() { if (channel) channel.close() }].forEach(function(release) {
    try { release() } catch(error) { closed = false }
  })
  return closed
}

// Derived cache names never follow a wiki-supplied link outside their directory.
MiniAGraphReconciler.dataPath = function(graph, name) {
  var dir = String(new java.io.File(graph._cfg.embeddingCacheDir || graph._graphDir).getCanonicalPath())
  var path = dir + "/" + name
  var file = new java.io.File(path)
  if (String(file.getCanonicalPath()) !== String(file.getAbsolutePath())) throw new Error("unsafe-reconciliation-cache-path")
  return path
}

// Rebuildable page indexes are loaded only for maintenance, never ordinary retrieval.
MiniAGraphReconciler.loadIndex = function(graph, state) {
  if (state.pages) return
  state.pages = {}
  var dir = graph._cfg.reconcileIndexDir || graph._graphDir + "/reconcile"
  try {
    if (String(new java.io.File(dir).getCanonicalPath()) !== String(new java.io.File(dir).getAbsolutePath())) throw new Error("unsafe-discovery-index")
    ;(state.index || []).forEach(function(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid-discovery-shard")
      var file = dir + "/" + hash + ".json"
      if (java.nio.file.Files.isSymbolicLink(new java.io.File(file).toPath())) throw new Error("unsafe-discovery-shard")
      var raw = io.readFileString(file)
      if (sha256(raw) !== hash) throw new Error("discovery-shard-checksum-mismatch")
      var shard = af.fromJson(raw)
      if (!isMap(shard)) throw new Error("invalid-discovery-shard")
      Object.keys(shard).forEach(function(path) { state.pages[path] = shard[path] })
    })
  } catch(error) {
    state.pages = {}
    state.completed = {}
    state.index = []
  }
}

// Immutable checksum-addressed shards can be installed before graph publication safely.
MiniAGraphReconciler.saveIndex = function(graph, state) {
  if (!state.pages || !state.indexDirty && state.index) return
  var dir = graph._cfg.reconcileIndexDir || graph._graphDir + "/reconcile"
  if (String(new java.io.File(dir).getCanonicalPath()) !== String(new java.io.File(dir).getAbsolutePath())) throw new Error("unsafe-discovery-index")
  io.mkdir(dir)
  var shards = Object.create(null)
  Object.keys(state.pages).sort().forEach(function(path) {
    var prefix = sha1(path).substring(0, 2)
    if (!shards[prefix]) shards[prefix] = {}
    shards[prefix][path] = state.pages[path]
  })
  state.index = Object.keys(shards).sort().map(function(prefix) {
    var raw = stringify(shards[prefix], __, "")
    var hash = sha256(raw)
    var file = dir + "/" + hash + ".json"
    if (!io.fileExists(file)) {
      var temp = file + "." + java.util.UUID.randomUUID() + ".tmp"
      var descriptor
      try {
        descriptor = new java.io.RandomAccessFile(temp, "rw")
        descriptor.write(new java.lang.String(raw).getBytes("UTF-8"))
        descriptor.getFD().sync()
        descriptor.close()
        descriptor = null
        java.nio.file.Files.move(new java.io.File(temp).toPath(), new java.io.File(file).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
      } finally {
        if (descriptor) descriptor.close()
        java.nio.file.Files.deleteIfExists(new java.io.File(temp).toPath())
      }
    }
    return hash
  })
  delete state.indexDirty
}

// Keep punctuation-sensitive technical identifiers compatible with graph concepts.
MiniAGraphReconciler.tokens = function(text) {
  var found = Object.create(null)
  var matches = String(text || "").match(/[A-Za-z_$][A-Za-z0-9_.$:+#/-]*/g) || []
  matches.forEach(function(token) { found[token.replace(/[.:/-]+$/, "")] = true })
  return Object.keys(found).sort()
}

// Use the same immutable embedding input for refresh and candidate ranking.
MiniAGraphReconciler.embeddingInput = function(page) {
  var meta = page.meta || {}
  var body = String(page.body || "")
  var passages = []
  var lastEnd = -1
  var pattern = /`[^`\n]{2,100}`|\b[A-Z][A-Z0-9_]{1,}\b|\b[a-z]+[A-Z][A-Za-z0-9_]*\b/g
  var match
  while (passages.length < 4 && (match = pattern.exec(body)) !== null) {
    if (match.index < lastEnd) continue
    var start = Math.max(0, match.index - 200)
    lastEnd = Math.min(body.length, start + 800)
    passages.push(body.substring(start, lastEnd))
  }
  if (!passages.length) passages.push(body.substring(0, 3200))
  return [String(meta.title || page.path).substring(0, 256), String(meta.description || "").substring(0, 512), passages.join("\n")].join("\n").substring(0, 4096)
}

// Refresh vectors independently from structural builds or model extraction.
MiniAGraphReconciler.prototype.refreshEmbeddings = function(pages, options) {
  var graph = this.graph
  var opts = MiniAGraphBuild.resolve(options)
  if (options.preview === true) return { ok: true, preview: true, pages: pages.length, calls: 0, estimatedMisses: [0, pages.length] }
  if (graph._readOnly) return { ok: false, error: "graph is read-only" }
  if (!getEnv("OAF_EMBED_MODEL") && !graph._cfg.reconcileEmbeddingModel) return { ok: true, complete: false, partial: true, status: "no-embedding-model", calls: 0 }
  if (typeof MiniAWikiEmbeddings === "undefined") loadLib(__miniAPath("js/wiki/mini-a-wiki-embeddings.js"))
  var started = Date.now()
  var cache
  var channel
  var lock
  var report = { ok: true, calls: 0, hits: 0, processed: 0, pending: pages.length }
  try {
    graph._ensureDir()
    var path = MiniAGraphReconciler.dataPath(graph, "reconcile-embeddings.db")
    MiniAGraphReconciler.dataPath(graph, "reconcile-embeddings.db.lock")
    channel = new java.io.RandomAccessFile(path + ".lock", "rw").getChannel()
    lock = channel.tryLock()
    if (!lock) throw new Error("embedding-cache-busy")
    cache = new MiniAWikiEmbeddings(path, { model: graph._cfg.reconcileEmbeddingModel, request: graph._cfg.reconcileEmbeddingRequest, dimensions: graph._cfg.reconcileEmbeddingDimensions })
    var list = pages.slice().sort(function(a, b) { return a.path.localeCompare(b.path) })
    for (var at = 0; at < list.length; at++) {
      if (isFunction(options.isCancelled) && options.isCancelled()) {
        report.status = "cancelled"
        break
      }
      if (Date.now() - started >= opts.reconcileMaxMinutes * 60000) {
        report.status = "time-budget"
        break
      }
      var text = MiniAGraphReconciler.embeddingInput(list[at])
      if (cache.peek(text)) report.hits++
      else {
        if (report.calls >= opts.embeddingMaxCalls || report.calls >= opts.reconcileMaxPages) break
        report.calls++
        cache.get(text)
      }
      report.processed++
    }
  } catch(error) {
    report.status = "embedding-unavailable"
  } finally {
    if (!MiniAGraphReconciler.closeCache(cache, lock, channel)) report.status = "embedding-cache-finalization-failed"
  }
  report.pending = pages.length - report.processed
  if (report.status === "embedding-cache-finalization-failed") report.pending = Math.max(1, report.pending)
  report.partial = report.pending > 0
  report.complete = !report.partial
  report.resumable = report.partial
  report.status = report.status || (report.partial ? "partial" : "complete")
  return report
}

// Candidate records explain discovery and retain both revisions and literal support.
MiniAGraphReconciler.prototype.discover = function(path, index, options) {
  var record = index.pages[path]
  if (!record) return []
  var scores = Object.create(null)
  var visits = 0
  var cap = options.reconcileMaxCandidates
  var maxDf = Math.min(200, Math.max(2, Math.floor(index.paths.length * options.reconcileMaxDf)))

  // Bounded postings include pages from every ingestion batch.
  function collect(key, method, score, mention) {
    if (visits >= 256) return
    var posting = index.postings[key] || []
    if (posting.length < 2 || posting.length > maxDf) return
    posting.forEach(function(target) {
      if (target === path || visits >= 256) return
      visits++
      if (!scores[target]) scores[target] = { target: target, score: 0, methods: [], matches: [] }
      var candidate = scores[target]
      candidate.score += score / Math.log(2 + posting.length)
      if (candidate.methods.indexOf(method) < 0) candidate.methods.push(method)
      if (mention && !candidate.matches.some(function(item) { return item.id === mention.id })) candidate.matches.push(mention)
    })
  }
  record.mentions.forEach(function(mention) { collect("concept:" + mention.id, "concept", 3, mention) })
  record.tags.forEach(function(tag) { collect("tag:" + tag, "tag", 1) })
  record.words.forEach(function(word) { collect("word:" + word, "lexical", 1) })
  if (isFunction(options.lexicalCandidates)) {
    ;(options.lexicalCandidates(path, record.words.slice(0, 8).join(" "), cap) || []).slice(0, cap).forEach(function(hit) {
      if (!index.pages[hit.path] || hit.path === path) return
      if (!scores[hit.path]) scores[hit.path] = { target: hit.path, score: 0, methods: [], matches: [] }
      scores[hit.path].score += 1 / (1 + (hit.rank || 0))
      scores[hit.path].methods.push("retrieval-v2")
    })
  }
  ;(record.links || []).slice(0, cap).forEach(function(target) {
    if (index.pages[target] && target !== path) {
      if (!scores[target]) scores[target] = { target: target, score: 0, methods: [], matches: [] }
      scores[target].score += 10
      scores[target].methods.push("explicit")
    }
  })
  return Object.keys(scores)
    .map(function(target) {
      var candidate = scores[target]
      return {
        source: path, sourceRevision: record.revision, sourceHash: record.hash,
        target: target, targetRevision: index.pages[target].revision, targetHash: index.pages[target].hash,
        methods: candidate.methods, matches: candidate.matches, score: candidate.score,
        validation: "pending", postingVisits: visits, discoveryTruncated: visits >= 256
      }
    })
    .sort(function(a, b) { return b.score - a.score || a.target.localeCompare(b.target) })
    .slice(0, cap)
    .map(function(candidate, rank) {
      candidate.ranking = { position: rank + 1, lexicalFeatureScore: candidate.score }
      candidate.matchingTerms = candidate.matches.map(function(mention) { return mention.name })
      candidate.provenance = "unvalidated"
      candidate.supportingPassages = candidate.matches.slice(0, 16).map(function(mention) {
        var peer = index.pages[candidate.target].mentions.filter(function(other) { return other.id === mention.id })[0]
        return { source: clone(mention.props.evidence), target: peer ? clone(peer.props.evidence) : null }
      })
      return candidate
    })
}

// Require independent current support in each document for every shared concept.
MiniAGraphReconciler.prototype.validate = function(candidate, index) {
  var graph = this.graph
  var source = index.pages[candidate.source]
  var target = index.pages[candidate.target]
  if (!source || !target || source.revision !== candidate.sourceRevision || target.revision !== candidate.targetRevision) return { status: "rejected", reason: "stale-candidate", matches: [] }
  var matches = candidate.matches.filter(function(mention) {
    return graph._usefulConcept(mention.name) && mention.id.indexOf("concept:ambiguous:") !== 0 && target.mentions.some(function(other) { return other.id === mention.id })
  })
  candidate.validation = matches.length ? "grounded" : "discovery-only"
  candidate.provenance = matches.length ? "EXTRACTED" : "unvalidated"
  return { status: candidate.validation, matches: matches }
}

// Page identity concepts are named concept:page:<path>:<title>; wiki pages always end in .md.
MiniAGraphReconciler.mentionTarget = function(id) {
  var match = /^concept:page:(.+?\.md):/.exec(String(id || ""))
  return match ? match[1] : ""
}

// Unlinked mentions of another page's unique title or alias become grounded page-to-page
// MENTIONS_PAGE edges. Explicitly linked targets are skipped, and a single plain word that
// names a page counts only while few pages use it.
MiniAGraphReconciler.prototype.implicitLinks = function(path, index, options) {
  var graph = this.graph
  var record = index.pages[path]
  var wanted = Object.create(null)
  var kept = Object.create(null)
  var result = { added: 0, removed: 0 }
  if (graph._cfg.implicitLinks !== false && record) {
    var linked = Object.create(null)
    ;(record.links || []).forEach(function(target) { linked[target] = true })
    var maxDf = Math.max(5, Math.floor(index.paths.length * options.reconcileMaxDf))
    ;(record.mentions || []).forEach(function(mention) {
      var target = MiniAGraphReconciler.mentionTarget(mention.id)
      var evidence = mention.props && mention.props.evidence
      if (!target || target === path || linked[target] || wanted[target] || !index.pages[target] || !isMap(evidence)) return
      var term = String(evidence.quote || "")
      var plainWord = !/\s/.test(term) && !graph._isCodeLike(term)
      if (term.length < 3 || plainWord && (index.postings["concept:" + mention.id] || []).length > maxDf) return
      wanted[target] = mention
    })
  }

  // Keep one current edge per wanted target; everything else this page owned is stale.
  ;(graph._edgesByOwner[path] || []).slice().forEach(function(edge) {
    if (edge._deleted === true || edge.type !== "MENTIONS_PAGE") return
    var target = edge.to.substring(4)
    if (wanted[target] && !kept[target] && graph._implicitCurrent(edge)) {
      kept[target] = true
      return
    }
    graph._removeEdge(edge)
    result.removed++
  })
  Object.keys(wanted).sort().forEach(function(target) {
    if (kept[target]) return
    var mention = wanted[target]
    graph._addEdge("doc:" + path, "doc:" + target, "MENTIONS_PAGE", "EXTRACTED", {
      page: path, revision: record.revision, sourceHash: record.hash, section: mention.props.section,
      evidenceLayer: "grounded", method: "reconcile-implicit", confidence: 1, title: mention.name,
      evidence: clone(mention.props.evidence), reconcileVersion: 1, implicitVersion: MiniAWikiGraph.IMPLICIT_LINK_VERSION
    })
    result.added++
  })
  return result
}

// Cache compact page inputs and completed work in the existing graph envelope.
MiniAGraphReconciler.prototype.run = function(pages, options) {
  var graph = this.graph
  options = options || {}
  var opts = MiniAGraphBuild.resolve(options)
  if (opts.reconcile === "off") return { ok: true, status: "off", changed: false, calls: 0 }
  if (graph._readOnly) return { ok: false, error: "graph is read-only" }
  var started = Date.now()
  var state = graph._state.reconciliation
  if (state && state.version !== 1) return { ok: false, error: "unsupported-reconciliation-version" }
  if (!state) state = { version: 1, pages: {}, completed: {}, rejected: 0, pairs: {} }
  MiniAGraphReconciler.loadIndex(graph, state)
  if (!state.pairs) state.pairs = {}
  if (!state.completed) state.completed = {}
  state.rejected = Number(state.rejected) || 0
  var report = { ok: true, status: "indexing", complete: false, partial: true, processed: 0, indexed: 0, cached: 0, pending: 0, added: 0, removed: 0, rejected: 0, calls: 0, estimatedTokens: 0, embeddingCalls: 0, embeddingHits: 0, comparisons: 0, discoveryTruncated: 0, candidates: 0 }
  var list = pages.slice().sort(function(a, b) { return a.path.localeCompare(b.path) })
  var byPath = Object.create(null)
  list.forEach(function(page) { byPath[page.path] = page })
  var paths = Object.keys(byPath)
  var vocabulary = graph._conceptVocabulary(list)
  var changed = false
  var self = this
  var deferredPairs = 0
  var runnablePairs = 0
  var pairPending = false
  var embeddingPending = false
  var embeddingConfig = graph._cfg.reconcileEmbeddingModel
  if (!embeddingConfig && getEnv("OAF_EMBED_MODEL")) {
    try { embeddingConfig = af.fromJSSLON(getEnv("OAF_EMBED_MODEL")) } catch(ignoreConfig) {}
  }
  var validationConfigs = []
  if (opts.reconcileLlm === "auto" && !graph._cfg.reconcileValidators) {
    ;["OAF_LC_MODEL", "OAF_MODEL"].forEach(function(name) {
      try { validationConfigs.push(MiniAGraphBuild.fingerprint(af.fromJSSLON(getEnv(name)))) } catch(ignoreModel) {}
    })
  }
  var policy = [validationConfigs, 1, opts.reconcile, opts.reconcileLlm, opts.reconcileMaxCandidates, opts.reconcileMaxEdges, opts.reconcileMaxDf,
    opts.reconcile === "hybrid" ? MiniAGraphBuild.fingerprint(embeddingConfig) : "",
    (graph._cfg.reconcileValidators || []).map(function(model) { return model.fingerprint || "custom-v1" }), graph._cfg.reconcileEmbeddingDimensions || "auto"]

  // Deadlines and cancellation stop work between durable page units.
  function stopped() {
    if (isFunction(options.isCancelled) && options.isCancelled()) {
      report.reason = "cancelled"
      return true
    }
    if (Date.now() - started >= opts.reconcileMaxMinutes * 60000) {
      report.reason = "time-budget"
      return true
    }
    return false
  }

  // Removed pages cannot remain candidates or retain completed work.
  Object.keys(state.pages).forEach(function(path) {
    if (byPath[path]) return
    delete state.pages[path]
    delete state.completed[path]
    state.indexDirty = true
    changed = true
  })
  Object.keys(state.pairs).forEach(function(key) {
    var pair = state.pairs[key]
    if (!byPath[pair.source] || !byPath[pair.target] || byPath[pair.source].revision !== pair.sourceRevision || byPath[pair.target].revision !== pair.targetRevision) {
      delete state.pairs[key]
      changed = true
    }
  })
  var needsIndex = []
  paths.forEach(function(path) {
    var page = byPath[path]
    var hash = graph._pageHash(page)
    var old = state.pages[path]
    var tokens = old && old.hash === hash ? old.tokens : MiniAGraphReconciler.tokens(page.body)
    var relevant = tokens.filter(function(token) { return vocabulary.first[token] }).map(function(token) { return [token, vocabulary.first[token].slice(0, 32).map(function(name) { return [name, vocabulary.names[name].length === 1 ? vocabulary.names[name] : "ambiguous"] })] })
    var input = sha1(stringify([hash, relevant], __, ""))
    if (!old || old.input !== input) needsIndex.push({ page: page, hash: hash, input: input, tokens: tokens })
  })
  for (var i = 0; i < needsIndex.length && report.indexed < opts.reconcileMaxPages && !stopped(); i++) {
    var item = needsIndex[i]
    var page = item.page
    var mentions = graph._deterministicMentions(page, graph._semanticSections(page), vocabulary, item.hash).mentions
    var unique = Object.create(null)
    mentions.forEach(function(mention) { if (!unique[mention.id]) unique[mention.id] = mention })
    var meta = page.meta || {}
    var words = MiniAGraphReconciler.tokens(String(meta.title || "") + " " + String(meta.description || "") + " " + (meta.aliases || []).join(" ")).map(function(word) { return word.toLowerCase() })
    words = words.filter(function(word, at) { return word.length >= 4 && graph._usefulConcept(word) && words.indexOf(word) === at }).slice(0, 32)
    state.pages[page.path] = { hash: item.hash, revision: page.revision || item.hash, input: item.input, tokens: item.tokens, mentions: Object.keys(unique).sort().map(function(id) { return unique[id] }), words: words, tags: (meta.tags || []).map(function(tag) { return String(tag).toLowerCase() }).sort(), links: page.links || [] }
    delete state.completed[page.path]
    report.indexed++
    state.indexDirty = true
    changed = true
  }
  report.pendingIndex = needsIndex.length - report.indexed
  var index = { paths: paths, pages: state.pages, postings: Object.create(null) }

  // Postings represent incidence only; their construction never enumerates pairs.
  function post(key, path) {
    if (!index.postings[key]) index.postings[key] = []
    index.postings[key].push(path)
  }
  if (!report.pendingIndex) {
    paths.forEach(function(path) {
      var record = state.pages[path]
      record.mentions.forEach(function(mention) { post("concept:" + mention.id, path) })
      record.tags.forEach(function(tag) { post("tag:" + tag, path) })
      record.words.forEach(function(word) { post("word:" + word, path) })
    })
  }
  var embeddingCache
  var embeddingLock
  var embeddingChannel
  var embeddingDisabled = false
  var validators
  var attemptedPairs = Object.create(null)

  // Hybrid ranks a bounded candidate set; unavailable vectors never block grounding.
  function hybrid(path, candidates) {
    if (opts.reconcile !== "hybrid" || !candidates.length || options.preview === true) return candidates
    if (embeddingDisabled) {
      embeddingPending = true
      return candidates
    }
    try {
      if (!embeddingCache) {
        if (!getEnv("OAF_EMBED_MODEL") && !graph._cfg.reconcileEmbeddingModel) {
          report.embeddingFallback = "no-embedding-model"
          embeddingPending = true
          embeddingDisabled = true
          return candidates
        }
        if (typeof MiniAWikiEmbeddings === "undefined") loadLib(__miniAPath("js/wiki/mini-a-wiki-embeddings.js"))
        var cachePath = MiniAGraphReconciler.dataPath(graph, "reconcile-embeddings.db")
        MiniAGraphReconciler.dataPath(graph, "reconcile-embeddings.db.lock")
        graph._ensureDir()
        embeddingChannel = new java.io.RandomAccessFile(cachePath + ".lock", "rw").getChannel()
        embeddingLock = embeddingChannel.tryLock()
        if (!embeddingLock) throw new Error("embedding-cache-busy")
        embeddingCache = new MiniAWikiEmbeddings(cachePath, { model: graph._cfg.reconcileEmbeddingModel, request: graph._cfg.reconcileEmbeddingRequest, dimensions: graph._cfg.reconcileEmbeddingDimensions })
      }

      // Limit input size and charge only cache misses against the provider budget.
      function vector(pagePath) {
        var page = byPath[pagePath]
        var text = MiniAGraphReconciler.embeddingInput(page)
        var cached = embeddingCache.peek(text)
        if (cached) {
          report.embeddingHits++
          return cached
        }
        if (report.embeddingCalls >= opts.embeddingMaxCalls) {
          embeddingPending = true
          return null
        }
        report.embeddingCalls++
        return embeddingCache.get(text)
      }
      var source = vector(path)
      if (!source) return candidates
      candidates.forEach(function(candidate) {
        if (report.comparisons >= opts.embeddingMaxComparisons || stopped()) {
          embeddingPending = true
          return
        }
        var target = vector(candidate.target)
        if (!target) return
        candidate.similarity = MiniAEmbeddings.cosine(source, target)
        report.comparisons++
      })
      candidates.sort(function(a, b) {
        return (isNumber(b.similarity) ? b.similarity : -1) - (isNumber(a.similarity) ? a.similarity : -1) || b.score - a.score || a.target.localeCompare(b.target)
      })
    } catch(error) {
      report.embeddingFallback = "embedding-unavailable"
      embeddingPending = true
      embeddingDisabled = true
    }
    return candidates
  }

  // Model assistance can ground an ambiguous shared phrase, but must cite both pages.
  function validatePair(candidate) {
    if (opts.reconcileLlm !== "auto" || options.preview === true) return []
    var reversed = candidate.source.localeCompare(candidate.target) > 0
    var source = byPath[reversed ? candidate.target : candidate.source]
    var target = byPath[reversed ? candidate.source : candidate.target]
    var payload = { kind: "wiki-graph-pair", source: { path: source.path, revision: source.revision, body: source.body.substring(0, 6000) }, target: { path: target.path, revision: target.revision, body: target.body.substring(0, 6000) } }
    var key = sha256(stringify([policy, payload], __, ""))
    var prior = state.pairs[key]
    var receiptPath = MiniAGraphReconciler.dataPath(graph, "validation/" + key + ".json")
    if (!prior && io.fileExists(receiptPath)) {
      try {
        var receipt = io.readFileJSON(receiptPath)
        if (receipt.key === key && receipt.version === 1) prior = receipt.pair
      } catch(ignoreReceipt) {}
    }
    // A single validated pair can support both independently owned memberships.
    function oriented(concepts) {
      return concepts.map(function(concept) {
        return reversed ? { name: concept.name, sourceQuote: concept.targetQuote, targetQuote: concept.sourceQuote } : concept
      })
    }
    // Cached approvals must satisfy the same grounding contract as fresh output.
    function supportedConcept(concept) {
      if (!concept || !isString(concept.name) || !graph._usefulConcept(concept.name) || !isString(concept.sourceQuote) || !isString(concept.targetQuote)) return false
      if (concept.name.length < 4 || concept.name.length > 100 || !/\s|[A-Z].*[A-Z]|[a-z][A-Z]|[._:$]/.test(concept.name)) return false
      if ((vocabulary.names[concept.name] || []).length > 1) return false
      return concept.sourceQuote.length <= 500 && concept.targetQuote.length <= 500 && payload.source.body.indexOf(concept.sourceQuote) >= 0 && payload.target.body.indexOf(concept.targetQuote) >= 0 && concept.sourceQuote.indexOf(concept.name) >= 0 && concept.targetQuote.indexOf(concept.name) >= 0
    }
    if (prior && prior.complete && isArray(prior.concepts) && prior.concepts.length <= 8 && prior.concepts.every(supportedConcept)) return oriented(prior.concepts)
    if (attemptedPairs[key]) {
      runnablePairs++
      pairPending = true
      return []
    }
    if (prior && prior.failures >= 2 && !opts.reconcileRetryFailed) {
      pairPending = true
      report.retryRequired = true
      deferredPairs++
      return []
    }
    if (report.calls >= opts.reconcileMaxCalls || stopped()) {
      runnablePairs++
      pairPending = true
      return []
    }
    var tokens = graph._estimateTokens(stringify(payload, __, "")) + 1024
    if (report.estimatedTokens + tokens > opts.reconcileMaxTokens) {
      runnablePairs++
      pairPending = true
      return []
    }
    if (!validators) validators = graph._cfg.reconcileValidators || MiniAGraphBuild.modelAdapters().models
    if (!validators.length) {
      report.validationFallback = "no-validation-model"
      runnablePairs++
      pairPending = true
      return []
    }
    report.calls++
    attemptedPairs[key] = true
    report.estimatedTokens += tokens
    try {
      var response = validators[0].extract(payload, Math.max(1, opts.reconcileMaxMinutes * 60000 - (Date.now() - started)))
      if (!response || !isArray(response.concepts) || response.concepts.length > 8) throw new Error("invalid-pair-validation")
      var concepts = response.concepts.filter(supportedConcept)
      if (concepts.length !== response.concepts.length) throw new Error("ungrounded-pair-concept")
      state.pairs[key] = { complete: true, concepts: concepts, source: source.path, sourceRevision: source.revision, target: target.path, targetRevision: target.revision }
      if (typeof __miniAWikiMaintenanceJson !== "function") loadLib(__miniAPath("js/wiki/mini-a-wiki-maintenance.js"))
      __miniAWikiMaintenanceJson(receiptPath, { version: 1, key: key, pair: state.pairs[key] })
      changed = true
      return oriented(concepts)
    } catch(error) {
      report.rejected++
      runnablePairs++
      report.validationFallback = "validation-unavailable-or-ungrounded"
      state.pairs[key] = { complete: false, failures: (prior && prior.failures || 0) + 1, source: source.path, sourceRevision: source.revision, target: target.path, targetRevision: target.revision }
      if (typeof __miniAWikiMaintenanceJson !== "function") loadLib(__miniAPath("js/wiki/mini-a-wiki-maintenance.js"))
      try {
        __miniAWikiMaintenanceJson(receiptPath, { version: 1, key: key, pair: state.pairs[key] })
      } catch(checkpointError) {
        report.checkpointFailure = true
      }
      pairPending = true
      changed = true
      return []
    }
  }

  // Preserve existing independently grounded assertions instead of duplicating them.
  function materialize(path, mention, method) {
    var page = byPath[path]
    var record = state.pages[path]
    var existing = (graph._semanticByPage[path] || []).some(function(edge) { return edge.type === "MENTIONS" && edge.to === mention.id && graph._currentEvidence(edge) })
    if (existing) return
    graph._upsertNode(mention.id, "concept", { name: mention.name, joinable: mention.joinable !== false })
    var props = clone(mention.props)
    props.page = path
    props.revision = page.revision || record.hash
    props.sourceHash = record.hash
    props.method = method
    props.reconcileVersion = 1
    props.validation = "grounded"
    var key = graph._edgeKey("doc:" + path, mention.id, "MENTIONS", "EXTRACTED", props)
    ;(graph._semanticByPage[path] || []).slice().forEach(function(edge) {
      if (graph._edgeKey(edge.from, edge.to, edge.type, edge.provenance, edge.props) === key && !graph._currentEvidence(edge)) {
        graph._removeEdge(edge)
        report.removed++
      }
    })
    graph._addEdge("doc:" + path, mention.id, "MENTIONS", "EXTRACTED", props)
    report.added++
    changed = true
  }

  try {
    if (!report.pendingIndex) {
      report.status = "reconciling"
      for (var at = 0; at < paths.length && report.processed < opts.reconcileMaxPages && !stopped(); at++) {
        var path = paths[at]
        var candidates = self.discover(path, index, merge(opts, { lexicalCandidates: options.lexicalCandidates }))
        // The implicit-link marker lives here, not in policy, so pair validation receipts stay valid.
        var implicitMarker = graph._cfg.implicitLinks === false ? "implicit-off" : "implicit-" + MiniAWikiGraph.IMPLICIT_LINK_VERSION
        var signature = sha1(stringify([policy, state.pages[path].input, candidates.map(function(candidate) { return [candidate.target, candidate.targetRevision, candidate.matches.map(function(mention) { return mention.id })] }), implicitMarker], __, ""))
        if (state.completed[path] === signature) {
          report.cached++
          continue
        }
        deferredPairs = 0
        runnablePairs = 0
        pairPending = false
        embeddingPending = false
        candidates = hybrid(path, candidates)
        report.candidates += candidates.length
        if (candidates.some(function(candidate) { return candidate.discoveryTruncated })) report.discoveryTruncated++
        var wanted = Object.create(null)
        candidates.forEach(function(candidate) {
          var checked = self.validate(candidate, index)
          checked.matches.forEach(function(mention) { if (Object.keys(wanted).length < opts.reconcileMaxEdges) wanted[mention.id] = mention })
          if (checked.status === "discovery-only" && opts.reconcileLlm === "auto") {
            validatePair(candidate).forEach(function(concept) {
              if (Object.keys(wanted).length >= opts.reconcileMaxEdges) return
              var name = concept.name
              var known = vocabulary.names[name]
              var identity = known && known.length === 1 ? known[0] : null
              var id = identity ? identity.id : graph._conceptId(name)
              var quote = concept.sourceQuote
              wanted[id] = { id: id, name: identity ? identity.name : name, joinable: identity ? identity.joinable : true, props: { section: "reconcile", evidenceLayer: "grounded", confidence: 1, supports: [{ path: path, revision: candidate.sourceRevision, quote: quote }, { path: candidate.target, revision: candidate.targetRevision, quote: concept.targetQuote }], evidence: { quote: quote, start: byPath[path].body.indexOf(quote), end: byPath[path].body.indexOf(quote) + quote.length } }, model: true }
            })
          }
        })
        ;(graph._semanticByPage[path] || []).slice().forEach(function(edge) {
          var current = graph._currentEvidence(edge)
          var preserveModel = edge.props.method === "reconcile-model" && opts.reconcileLlm === "off" && current
          if (edge.props.reconcileVersion === 1 && (!current || !wanted[edge.to] && !pairPending && !embeddingPending && !preserveModel)) {
            graph._removeEdge(edge)
            report.removed++
            changed = true
          }
        })
        Object.keys(wanted).sort().forEach(function(id) { materialize(path, wanted[id], wanted[id].model ? "reconcile-model" : "reconcile-deterministic") })
        var implicit = self.implicitLinks(path, index, opts)
        report.implicitAdded = (report.implicitAdded || 0) + implicit.added
        report.implicitRemoved = (report.implicitRemoved || 0) + implicit.removed
        if (implicit.added || implicit.removed) changed = true
        if (!pairPending && !embeddingPending) {
          state.completed[path] = signature
          changed = true
        } else {
          if (state.completed[path]) {
            delete state.completed[path]
            changed = true
          }
          report.pendingProviders = (report.pendingProviders || 0) + 1
          if (deferredPairs > 0 && runnablePairs === 0 && !embeddingPending) report.deferredPages = (report.deferredPages || 0) + 1
        }
        report.processed++
      }
    }
  } finally {
    if (!MiniAGraphReconciler.closeCache(embeddingCache, embeddingLock, embeddingChannel)) {
      report.embeddingFallback = "embedding-cache-finalization-failed"
      report.pendingProviders = Math.max(1, report.pendingProviders || 0)
      paths.forEach(function(path) { delete state.completed[path] })
      changed = true
    }
  }
  report.pending = report.pendingIndex || paths.length - report.cached - report.processed + (report.pendingProviders || 0)
  report.partial = report.pending > 0
  report.complete = !report.partial
  report.resumable = report.partial && report.pending > (report.deferredPages || 0)
  report.status = report.reason || (report.partial ? report.resumable ? "partial" : "retry-required" : "complete")
  if (report.retryRequired && !(state.report || {}).retryRequired) changed = true
  if (report.complete && Object.keys(state.dirty || {}).length) {
    state.dirty = {}
    state.dirtyCount = 0
    changed = true
  }
  report.elapsedMs = Date.now() - started
  if (report.calls || report.embeddingCalls) changed = true
  report.changed = changed
  if (changed) {
    if (!state.usage) state.usage = { validationCalls: 0, estimatedValidationTokens: 0, embeddingCalls: 0, comparisons: 0 }
    state.usage.validationCalls += report.calls
    state.usage.estimatedValidationTokens += report.estimatedTokens
    state.usage.embeddingCalls += report.embeddingCalls
    state.usage.comparisons += report.comparisons
    report.cumulativeUsage = clone(state.usage)
    state.report = clone(report)
    state.rejected += report.rejected
    graph._state.reconciliation = state
    graph._markDerivedDirty()
    if (options.preview !== true) graph._scheduleSave()
  }
  if (isFunction(options.onProgress)) options.onProgress(clone(report))
  return report
}
