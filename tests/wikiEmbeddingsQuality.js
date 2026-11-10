// Evaluate live embeddings against the existing lexical passage index before enabling them.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-wiki.js")
load("js/wiki/mini-a-wiki-embeddings.js")
var fixturePath = getEnv("WIKI_EMBED_FIXTURE") || "tests/fixtures/wiki-retrieval-v2/held-out.json"
var fixture = io.readFileJSON(fixturePath)
var dir = String(io.createTempDir("wiki-embed-quality-"))
var cachePath = getEnv("WIKI_EMBED_CACHE")
if (!isString(cachePath) || !cachePath.length) throw new Error("Set WIKI_EMBED_CACHE to a persistent local cache file")
ow.loadAI()
if (isString(getEnv("WIKI_EMBED_OPENAF_SOURCE"))) load(getEnv("WIKI_EMBED_OPENAF_SOURCE"))
var cache = new MiniAWikiEmbeddings(cachePath)
// Source-checkout validation can explicitly use the sibling OpenAF implementation.
if (isString(getEnv("WIKI_EMBED_OPENAF_SOURCE"))) {
  cache.request = function(text) {
    load(getEnv("WIKI_EMBED_OPENAF_SOURCE"))
    var response = $gpt(__, cache.config).getEmbeddings(text)
    if (isMap(response) && isDef(response.error)) throw new Error("Provider rejected embedding input (" + text.length + " characters)")
    return response
  }
}
var managers = {}, passages = [], results = []
// Keep test wiki artifacts temporary while retaining reusable provider vectors.
try {
  fixture.pages.forEach(function(page) {
    var wiki = page.wiki || "primary", root = dir + "/" + wiki
    io.mkdir(root)
    var metadata = merge({ title: page.title }, page.metadata || {})
    var raw = "---\n" + af.toYAML(metadata) + "---\n" + (page.introRepeats ? "# Introduction\n" + new Array(page.introRepeats).join("General background without the answer.\n") + "\n" : "") + page.body
    io.writeFileString(root + "/" + page.path, raw)
    MiniAWikiRetrievalV2.parse(page.path, raw, 1400).passages.forEach(function(p) {
      passages.push({ wiki: wiki, path: page.path, text: p.text, metadata: metadata, vector: cache.get(p.text) })
    })
  })
  // Use the production lexical index, analyzer, and ranking as the baseline.
  fixture.pages.forEach(function(page) {
    var wiki = page.wiki || "primary"
    if (managers[wiki]) return
    managers[wiki] = new MiniAWikiManager({ backend: "fs", root: dir + "/" + wiki, access: "rw", wikiretrievalv2: true }, function() {})
    var built = managers[wiki].reindex()
    if (!built.ok) throw new Error(stringify(built))
  })
  var root = managers.primary
  Object.keys(managers).forEach(function(wiki) {
    if (wiki !== "primary") root.attach(wiki, { backend: "fs", root: dir + "/" + wiki })
  })
  // This exhaustive scan is only a small-corpus quality oracle, never a serving implementation.
  fixture.queries.forEach(function(q) {
    var before = Date.now()
    var lexical = root.retrieve(q.query, { wiki: q.wiki || "*", applicability: q.applicability, chunks: q.k, maxInspected: q.k, maxCandidates: 24, maxBytes: 24000, tokens: 6000 })
    // Fuse canonical passage candidates, not expanded citation envelopes.
    var candidates = []
    Object.keys(managers).forEach(function(wiki) {
      if (q.wiki && q.wiki !== "*" && q.wiki !== wiki) return
      var engine = managers[wiki]._retrievalV2, snapshot = engine.acquire()
      try {
        engine._query(snapshot, q.query, 24, 0).hits.forEach(function(hit) {
          var page = engine.lookupPage(snapshot, hit.record.path)
          if (!engine._constraints(page, { applicability: q.applicability })) return
          candidates.push({ wiki: wiki, path: hit.record.path, text: hit.text, score: hit.nativeScore })
        })
      } finally {
        engine.release(snapshot)
      }
    })
    candidates.sort(function(a, b) { return b.score - a.score || a.path.localeCompare(b.path) })
    var baseline = (lexical.evidence || []).map(function(e) { return { path: e.path, text: e.content } })
    var vector = cache.get(q.query)
    var semantic = passages.filter(function(p) {
      return (!q.wiki || q.wiki === "*" || q.wiki === p.wiki) && managers[p.wiki]._retrievalV2._constraints({ metadata: p.metadata }, { applicability: q.applicability })
    }).map(function(p) {
      return { path: p.path, text: p.text, score: MiniAWikiEmbeddings.cosine(vector, p.vector), wiki: p.wiki }
    }).sort(function(a, b) { return b.score - a.score || a.path.localeCompare(b.path) }).slice(0, 24)
    var fused = {}, add = function(p, rank) {
      var id = p.wiki + "|" + p.path + "|" + sha1(p.text)
      if (!fused[id]) fused[id] = { path: p.path, text: p.text, score: 0 }
      fused[id].score += 1 / (60 + rank)
    }
    // Repeated boilerplate contributes at most one vote per route.
    var addRoute = function(route) {
      var seen = {}, rank = 0
      route.forEach(function(p) {
        var id = p.wiki + "|" + p.path + "|" + sha1(p.text)
        if (seen[id]) return
        seen[id] = true
        add(p, ++rank)
      })
    }
    addRoute(candidates.slice(0, 24))
    addRoute(semantic)
    var hybrid = Object.keys(fused).map(function(id) { return fused[id] }).sort(function(a, b) { return b.score - a.score || a.path.localeCompare(b.path) }).slice(0, q.k)
    var recall = function(hits) {
      if (!q.support.length) return hits.length === 0 ? 1 : 0
      return q.support.filter(function(s) {
        var support = isString(s) ? { text: s } : s
        return hits.some(function(h) { return (!support.path || h.path === support.path) && h.text.indexOf(support.text) >= 0 })
      }).length / q.support.length
    }
    results.push({ query: q.query, lexical: recall(baseline), lexicalCandidates: recall(candidates.slice(0, q.k)), hybrid: recall(hybrid), answerable: q.support.length > 0, millis: Date.now() - before })
  })
  var mean = function(key) { return results.reduce(function(n, r) { return n + r[key] }, 0) / results.length }
  print("EMBED_QUALITY=" + stringify({ fixture: fixturePath, fixtureHash: sha256(io.readFileString(fixturePath)), embeddingIdentity: cache.identity, lexical: mean("lexical"), hybrid: mean("hybrid"), passes: mean("hybrid") >= mean("lexical") + 0.1 && results.every(function(r) { return r.hybrid >= r.lexical }), stats: cache.stats, results: results }, __, ""))
} finally {
  Object.keys(managers).forEach(function(wiki) { managers[wiki].close() })
  cache.close()
  io.rm(dir)
}
