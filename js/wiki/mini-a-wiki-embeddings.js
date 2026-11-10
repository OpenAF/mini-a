// Shared handles coalesce identical requests across managers in the same process.
if (!global.__miniAWikiEmbeddingCaches) global.__miniAWikiEmbeddingCaches = {
  lock: new java.util.concurrent.locks.ReentrantLock(), entries: {}
}

// Cache provider embeddings on disk before considering them for wiki retrieval.
var MiniAWikiEmbeddings = function(path, options) {
  var opts = isMap(options) ? options : {}
  this.config = isMap(opts.model) ? af.fromJson(stringify(opts.model)) : af.fromJSSLON(getEnv("OAF_EMBED_MODEL"))
  if (!isMap(this.config) || !isString(this.config.type) || !isString(this.config.model)) throw new Error("OAF_EMBED_MODEL requires type and model")
  if (isDef(opts.dimensions) && (!isNumber(opts.dimensions) || opts.dimensions < 1 || Math.floor(opts.dimensions) !== opts.dimensions)) throw new Error("Invalid embedding dimensions")
  this.dimensions = opts.dimensions
  this.request = opts.request
  this.identity = sha256(MiniAWikiEmbeddings.canonical(this.config) + "|" + String(this.dimensions))
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

// Canonical configuration avoids duplicate entries caused by object member order.
MiniAWikiEmbeddings.canonical = function(value) {
  if (isArray(value)) return "[" + value.map(MiniAWikiEmbeddings.canonical).join(",") + "]"
  if (isMap(value)) return "{" + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ":" + MiniAWikiEmbeddings.canonical(value[key])
  }).join(",") + "}"
  return JSON.stringify(value)
}

// Accept one vector per input across OpenAF's raw provider response formats.
MiniAWikiEmbeddings.vector = function(response) {
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
MiniAWikiEmbeddings.prototype.get = function(text) {
  if (!isString(text) || !text.trim().length) throw new Error("embedding input must be non-empty text")
  this.lock.lock()
  try {
    if (this.closed) throw new Error("embedding-cache-closed")
    var key = { id: sha256(this.identity + "|" + text) }
    var cached = $ch(this.name).get(key)
    if (isMap(cached)) {
      var reused = MiniAWikiEmbeddings.vector(cached.vector)
      if (isNumber(this.dimensions) && reused.length !== this.dimensions) throw new Error("embedding-dimension-mismatch")
      this.stats.hits++
      return reused
    }
    this.stats.calls++
    var result
    if (isFunction(this.request)) result = this.request(text)
    else {
      if (isUnDef(ow.ai)) ow.loadAI()
      if ($gpt.length < 2) throw new Error("OpenAF runtime requires independent embedding configuration support")
      if (isUnDef(this.client)) this.client = $gpt(__, this.config)
      result = this.client.getEmbeddingsWithStats(text, this.dimensions)
      this.stats.lastUsage = result.stats
      result = result.response
    }
    var vector = MiniAWikiEmbeddings.vector(result)
    if (isNumber(this.dimensions) && vector.length !== this.dimensions) throw new Error("embedding-dimension-mismatch")
    var dimensionKey = { identity: this.identity }
    var shape = $ch(this.name).get(dimensionKey)
    if (isMap(shape) && shape.dimensions !== vector.length) throw new Error("embedding-dimension-mismatch")
    if (!isMap(shape)) $ch(this.name).set(dimensionKey, { dimensions: vector.length })
    $ch(this.name).set(key, { vector: vector })
    return vector
  } catch(e) {
    this.stats.failures++
    throw e
  } finally {
    this.lock.unlock()
  }
}

// Release the MVStore file and commit the persistent cache.
MiniAWikiEmbeddings.prototype.close = function() {
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
MiniAWikiEmbeddings.cosine = function(left, right) {
  if (left.length !== right.length) throw new Error("embedding-dimension-mismatch")
  return left.reduce(function(sum, n, i) { return sum + n * right[i] }, 0)
}
