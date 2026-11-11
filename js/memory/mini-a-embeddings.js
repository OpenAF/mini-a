// Shared handles coalesce identical requests across managers in the same process.
if (!global.__miniAWikiEmbeddingCaches) global.__miniAWikiEmbeddingCaches = {
  lock: new java.util.concurrent.locks.ReentrantLock(), entries: {}
}

// Cache provider embeddings on disk before considering them for wiki retrieval.
var MiniAEmbeddings = function(path, options) {
  var opts = isMap(options) ? options : {}
  this.config = isMap(opts.model) ? af.fromJson(stringify(opts.model)) : af.fromJSSLON(getEnv("OAF_EMBED_MODEL"))
  if (!isMap(this.config) || !isString(this.config.type) || !isString(this.config.model)) throw new Error("OAF_EMBED_MODEL requires type and model")
  if (isDef(opts.dimensions) && (!isNumber(opts.dimensions) || opts.dimensions < 1 || Math.floor(opts.dimensions) !== opts.dimensions)) throw new Error("Invalid embedding dimensions")
  this.dimensions = opts.dimensions
  this.request = opts.request
  this.identity = sha256(MiniAEmbeddings.canonical(this.config) + "|" + String(this.dimensions))
  this.stats = { hits: 0, calls: 0, failures: 0 }
  this.path = String(new java.io.File(String(path)).getCanonicalPath())
  var registry = global.__miniAWikiEmbeddingCaches
  registry.lock.lock()
  try {
    if (!registry.entries[this.path]) {
      ow.loadCh()
      var name = "mini-a.embeddings." + String(java.util.UUID.randomUUID())
      $ch(name).create(1, "mvs", { file: this.path, shouldCompress: true })
      registry.entries[this.path] = { name: name, lock: new java.util.concurrent.locks.ReentrantLock(), references: 0 }
    }
    this.entry = registry.entries[this.path]
    this.entry.references++
    this.name = this.entry.name
    this.lock = this.entry.lock
  } finally {
    registry.lock.unlock()
  }
}

// Use an independent lock so cache close and usage collection cannot invert locks.
if (!global.__miniAEmbeddingMetricsLock) global.__miniAEmbeddingMetricsLock = new java.util.concurrent.locks.ReentrantLock()

// Keep process-wide usage across short-lived retrieval caches and model clients.
MiniAEmbeddings.metrics = function(event) {
  var registry = global.__miniAWikiEmbeddingCaches
  global.__miniAEmbeddingMetricsLock.lock()
  try {
    if (!registry.metrics) registry.metrics = { calls: 0, hits: 0, failures: 0, duration_ms: 0, input_tokens: 0, total_tokens: 0, usage_reports: 0 }
    var metrics = registry.metrics
    if (isMap(event)) {
      metrics.hits += event.hit ? 1 : 0
      if (event.called) {
        metrics.calls++
        metrics.failures += event.failed ? 1 : 0
        metrics.duration_ms += event.duration_ms || 0
        var stats = event.stats || {}, tokens = stats.tokens || {}
        var input = isNumber(tokens.prompt) ? tokens.prompt : isNumber(stats.prompt_tokens) ? stats.prompt_tokens : stats.input_tokens
        var total = isNumber(tokens.total) ? tokens.total : stats.total_tokens
        if (isNumber(input) && isFinite(input) && input >= 0) metrics.input_tokens += input
        if (isNumber(total) && isFinite(total) && total >= 0) metrics.total_tokens += total
        else if (isNumber(input) && isFinite(input) && input >= 0) metrics.total_tokens += input
        if (isNumber(input) || isNumber(total)) metrics.usage_reports++
      }
    }
    return clone(metrics)
  } finally {
    global.__miniAEmbeddingMetricsLock.unlock()
  }
}

// Canonical configuration avoids duplicate entries caused by object member order.
MiniAEmbeddings.canonical = function(value) {
  if (isArray(value)) return "[" + value.map(MiniAEmbeddings.canonical).join(",") + "]"
  if (isMap(value)) return "{" + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ":" + MiniAEmbeddings.canonical(value[key])
  }).join(",") + "}"
  return JSON.stringify(value)
}

// Accept one vector per input across OpenAF's raw provider response formats.
MiniAEmbeddings.vector = function(response) {
  var value = response
  if (isMap(value) && isArray(value.data) && value.data.length === 1) value = value.data[0].embedding
  else if (isMap(value) && isArray(value.embeddings) && value.embeddings.length === 1) value = value.embeddings[0]
  else if (isMap(value) && isMap(value.embedding)) value = value.embedding.values
  else if (isMap(value) && isArray(value.embedding)) value = value.embedding
  if (!isArray(value) || !value.length || !value.every(function(n) { return isNumber(n) && isFinite(n) })) throw new Error("invalid-embedding-response")
  var norm = Math.sqrt(value.reduce(function(sum, n) { return sum + n * n }, 0))
  if (!isFinite(norm) || norm === 0) throw new Error("invalid-embedding-norm")
  return value.map(function(n) { return n / norm })
}

// Serialize cache misses so identical concurrent requests are generated once.
MiniAEmbeddings.prototype.get = function(text) {
  if (!isString(text) || !text.trim().length) throw new Error("embedding input must be non-empty text")
  var called = false, started, usage, failed = false
  this.lock.lock()
  try {
    if (this.closed) throw new Error("embedding-cache-closed")
    var key = { id: sha256(this.identity + "|" + text) }
    var cached = $ch(this.name).get(key)
    if (isMap(cached)) {
      var reused = MiniAEmbeddings.vector(cached.vector)
      if (isNumber(this.dimensions) && reused.length !== this.dimensions) throw new Error("embedding-dimension-mismatch")
      this.stats.hits++
      MiniAEmbeddings.metrics({ hit: true })
      return reused
    }
    this.stats.calls++
    called = true
    started = Date.now()
    var result
    if (isFunction(this.request)) result = this.request(text)
    else {
      if (isUnDef(ow.ai)) ow.loadAI()
      if ($gpt.length < 2) throw new Error("OpenAF runtime requires independent embedding configuration support")
      if (isUnDef(this.client)) this.client = $gpt(__, this.config)
      result = this.client.getEmbeddingsWithStats(text, this.dimensions)
      usage = result.stats
      this.stats.lastUsage = result.stats
      result = result.response
    }
    var vector = MiniAEmbeddings.vector(result)
    if (isNumber(this.dimensions) && vector.length !== this.dimensions) throw new Error("embedding-dimension-mismatch")
    var dimensionKey = { identity: this.identity }
    var shape = $ch(this.name).get(dimensionKey)
    if (isMap(shape) && shape.dimensions !== vector.length) throw new Error("embedding-dimension-mismatch")
    if (!isMap(shape)) $ch(this.name).set(dimensionKey, { dimensions: vector.length })
    $ch(this.name).set(key, { vector: vector })
    return vector
  } catch(e) {
    this.stats.failures++
    failed = true
    throw e
  } finally {
    if (called) MiniAEmbeddings.metrics({ called: true, failed: failed, duration_ms: Date.now() - started, stats: usage })
    this.lock.unlock()
  }
}

// Release the MVStore file and commit the persistent cache.
MiniAEmbeddings.prototype.close = function() {
  var registry = global.__miniAWikiEmbeddingCaches
  registry.lock.lock()
  this.lock.lock()
  try {
    if (!this.closed) {
      if (--this.entry.references === 0) {
        $ch(this.name).destroy()
        delete registry.entries[this.path]
      }
      if (this.client && isFunction(this.client.close)) this.client.close()
    }
    this.closed = true
  } finally {
    this.lock.unlock()
    registry.lock.unlock()
  }
}

// Compare normalized embeddings without admitting incompatible vector spaces.
MiniAEmbeddings.cosine = function(left, right) {
  if (left.length !== right.length) throw new Error("embedding-dimension-mismatch")
  return left.reduce(function(sum, n, i) { return sum + n * right[i] }, 0)
}

// Inspect cached vectors without making provider requests.
MiniAEmbeddings.prototype.peek = function(text) {
  var cached = $ch(this.name).get({ id: sha256(this.identity + "|" + text) })
  if (isMap(cached)) {
    this.stats.hits++
    MiniAEmbeddings.metrics({ hit: true })
    return MiniAEmbeddings.vector(cached.vector)
  }
  return __
}

// Rank independently discovered semantic candidates within a bounded request budget.
var MiniASemanticRetrieve = function(query, documents, lexicalIds, options) {
  var opts = isMap(options) ? options : {}
  var status = { mode: "lexical", indexed: 0, eligible: documents.length, calls: 0, hits: 0 }
  var fallback = { ids: lexicalIds, status: status }
  if (opts.mode === "off" || !String(query || "").trim().length || !isDef(getEnv("OAF_EMBED_MODEL"))) return fallback
  var identity = sha256(String(getEnv("OAF_EMBED_MODEL")))
  if (!global.__miniASemanticFailures) global.__miniASemanticFailures = {}
  var failure = global.__miniASemanticFailures[identity] || { count: 0, until: 0 }
  if (failure.until > Date.now()) {
    status.reason = "provider-cooldown"
    return fallback
  }
  var cache, channel, fileLock
  try {
    var path = String(opts.path)
    io.mkdir(String(new java.io.File(path).getParent()))
    channel = new java.io.RandomAccessFile(path + ".lock", "rw").getChannel()
    fileLock = channel.tryLock()
    if (fileLock === null) throw new Error("embedding-cache-busy")
    cache = new MiniAEmbeddings(path)
    var budget = isNumber(opts.maxCalls) ? Math.max(1, Math.floor(opts.maxCalls)) : 9
    var queryVector = cache.get(String(query))
    var remaining = Math.min(8, Math.max(0, budget - cache.stats.calls))
    var vectors = {}, missing = []
    documents.forEach(function(doc) {
      var vector = cache.peek(doc.text)
      if (isArray(vector)) vectors[doc.key] = vector
      else missing.push(doc)
    })
    // Lexical candidates warm first; stable input order ensures eventual full coverage.
    missing.sort(function(a, b) {
      var ai = lexicalIds.indexOf(a.id), bi = lexicalIds.indexOf(b.id)
      return (ai < 0 ? 1000000 : ai) - (bi < 0 ? 1000000 : bi)
    })
    for (var i = 0; i < missing.length && remaining > 0; i++, remaining--) vectors[missing[i].key] = cache.get(missing[i].text)
    var scores = {}
    documents.forEach(function(doc) {
      if (!isArray(vectors[doc.key])) return
      status.indexed++
      var score = MiniAEmbeddings.cosine(queryVector, vectors[doc.key])
      if (score > 0) scores[doc.id] = Math.max(isNumber(scores[doc.id]) ? scores[doc.id] : -1, score)
    })
    var semantic = Object.keys(scores).sort(function(a, b) { return scores[b] - scores[a] || a.localeCompare(b) })
    var fused = {}
    lexicalIds.forEach(function(id, index) { fused[id] = 1 / (61 + index) })
    semantic.forEach(function(id, index) { fused[id] = (fused[id] || 0) + 1 / (61 + index) })
    var literal = {}
    documents.forEach(function(doc) { if (doc.text.toLowerCase().indexOf(String(query).toLowerCase()) >= 0) literal[doc.id] = true })
    status.mode = "hybrid"
    status.calls = cache.stats.calls
    status.hits = cache.stats.hits
    global.__miniASemanticFailures[identity] = { count: 0, until: 0 }
    return { ids: Object.keys(fused).sort(function(a, b) { return Number(!!literal[b]) - Number(!!literal[a]) || fused[b] - fused[a] || a.localeCompare(b) }), status: status }
  } catch(e) {
    if (isFunction(opts.onError)) opts.onError(e)
    var message = String(e)
    var cacheBusy = /OverlappingFileLock|embedding-cache-busy/.test(message)
    if (!cacheBusy) failure.count++
    failure.until = failure.count >= 3 ? Date.now() + 60000 : 0
    global.__miniASemanticFailures[identity] = failure
    status.reason = cacheBusy ? "embedding-cache-busy" : /independent embedding configuration/.test(message) ? "unsupported-runtime" : "embedding-unavailable"
    if (cache) status.calls = cache.stats.calls
    return fallback
  } finally {
    // Cleanup must not prevent lexical fallback when persistence is unavailable.
    try { if (cache) cache.close() } catch(closeError) { status.reason = "embedding-cache-close-failed" }
    try { if (fileLock !== null && isDef(fileLock)) fileLock.release() } catch(lockError) {}
    try { if (channel) channel.close() } catch(channelError) {}
  }
}
