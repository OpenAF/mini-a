(function() {
  // Verify persistent reuse, configuration isolation, and rejected provider responses.
  load("js/wiki/mini-a-wiki-embeddings.js")
  var path = String(io.createTempFile("wiki-embedding-cache-", ".db"))
  io.rm(path)
  var count = 0, cache
  var assert = function(value, message) {
    if (!value) throw new Error(message)
  }
  var options = { model: { type: "ollama", model: "fixture" }, request: function(text) {
    count++
    if (text === "bad") return { embeddings: [[0, 0]] }
    return { embeddings: [[3, 4]] }
  } }
  try {
    cache = new MiniAWikiEmbeddings(path, options)
    assert(Math.abs(cache.get("hello")[0] - 0.6) < 0.000001, "normalize Ollama vectors")
    cache.get("hello")
    assert(count === 1, "identical content must reuse its vector")
    var second = new MiniAWikiEmbeddings(path, options)
    second.get("hello")
    assert(count === 1, "managers sharing a cache coalesce requests")
    second.close()
    cache.get("hello")
    assert(count === 1, "closing one manager retains other handles")
    cache.close()
    cache = new MiniAWikiEmbeddings(path, options)
    cache.get("hello")
    assert(count === 1, "reuse must survive closing and reopening the cache")
    for (var i = 0; i < 2; i++) {
      var rejected = false
      try { cache.get("bad") } catch(e) { rejected = true }
      assert(rejected, "zero vectors must be rejected")
    }
    assert(count === 3, "failed responses must not be cached")
    cache.close()
    cache = new MiniAWikiEmbeddings(path, merge(options, { model: { type: "ollama", model: "other" } }))
    cache.get("hello")
    assert(count === 4, "model changes must isolate the cache")
    assert(MiniAWikiEmbeddings.vector({ data: [{ embedding: [1, 0] }] })[0] === 1, "OpenAI response")
    assert(MiniAWikiEmbeddings.vector({ embedding: { values: [0, 2] } })[1] === 1, "Gemini response")
    print("Embedding cache tests passed")
  } finally {
    if (cache) cache.close()
    io.rm(path)
  }
})()
