// Evaluate held-out paraphrases against literal retrieval using the configured model.
load("mini-a.js")
ow.loadAI()
if (isString(getEnv("MINIA_EMBED_OPENAF_SOURCE"))) load(getEnv("MINIA_EMBED_OPENAF_SOURCE"))
loadLib(__miniAPath("js/memory/mini-a-embeddings.js"))
var fixtures = [
  ["tls", "Unknown TLS issuer requires certificate trust inspection before approval.", "investigate an unrecognized authority signing the server identity"],
  ["heap", "Java heap dump analysis finds retained objects and memory leaks.", "diagnose JVM allocations that are never released"],
  ["backup", "Create recovery snapshots before deleting wiki folders.", "preserve a restorable copy before removing a knowledge directory"],
  ["proxy", "Configure HTTPS proxy credentials and reconnect the session.", "route encrypted web traffic through an authenticated intermediary"],
  ["sql", "Database SQL queries require read-only JDBC connections.", "fetch relational table records without allowing modifications"],
  ["git", "Resolve Git merge conflicts and inspect branch differences.", "reconcile incompatible edits between source control revisions"],
  ["image", "Generate transparent PNG images and remove backgrounds.", "make a picture cutout with an invisible backdrop"],
  ["audio", "Transcribe spoken audio recordings with speaker labels.", "turn recorded voices into text identifying each participant"],
  ["chart", "Plot time series metrics as line charts.", "visualize measurements evolving over successive dates"],
  ["release", "Prepare release notes from changelog entries.", "summarize shipped product improvements for a new version"],
  ["timezone", "Convert timestamps between time zones.", "translate clock readings from Lisbon to Tokyo"],
  ["archive", "Compress files into ZIP archives.", "bundle documents into a smaller downloadable package"]
]
var path = getEnv("MINIA_EMBED_QUALITY_CACHE")
if (!isString(path) || !path.length) throw new Error("Set MINIA_EMBED_QUALITY_CACHE")
var reports = []
var rankingAgent = Object.create(MiniA.prototype)
;["history", "skill"].forEach(function(area) {
  var docs = fixtures.map(function(f) { return { id: area + ":" + f[0], key: area + ":" + f[0], text: area === "skill" ? "Skill: " + f[0] + "\n" + f[1] : f[1] } })
  // Warm under the same bounded-search contract; record cold calls separately.
  var coldStarted = Date.now()
  var cold = MiniASemanticRetrieve(fixtures[0][2], docs, [], { path: path })
  var coldMs = Date.now() - coldStarted
  var warmup = MiniASemanticRetrieve(fixtures[0][2], docs, [], { path: path })
  var lexical = 0, hybrid = 0, calls = cold.status.calls + warmup.status.calls, degraded = 0
  var warmStarted = Date.now()
  fixtures.forEach(function(f) {
    var ids
    if (area === "skill") {
      ids = docs.map(function(doc, index) { return { id: doc.id, score: rankingAgent._scoreSkillForPrompt({ name: fixtures[index][0], description: fixtures[index][1] }, f[2], "") } })
        .filter(function(item) { return item.score > 1 })
        .sort(function(a, b) { return b.score - a.score })
        .map(function(item) { return item.id })
    } else ids = docs.filter(function(doc) { return doc.text.toLowerCase().indexOf(f[2].toLowerCase()) >= 0 }).map(function(doc) { return doc.id })
    var result = MiniASemanticRetrieve(f[2], docs, ids, { path: path })
    if (ids.slice(0, 5).indexOf(area + ":" + f[0]) >= 0) lexical++
    if (result.ids.slice(0, 5).indexOf(area + ":" + f[0]) >= 0) hybrid++
    if (result.status.mode !== "hybrid") degraded++
    calls += result.status.calls
  })
  var exact = docs.every(function(doc) { return MiniASemanticRetrieve(doc.text, docs, [doc.id], { path: path }).ids[0] === doc.id })
  reports.push({ area: area, lexicalRecall5: lexical / fixtures.length, hybridRecall5: hybrid / fixtures.length, exactPreserved: exact, coldMs: coldMs, warmQueriesMs: Date.now() - warmStarted, degraded: degraded, calls: calls, passes: hybrid / fixtures.length >= lexical / fixtures.length + 0.1 && exact && !degraded })
})
print("SEMANTIC_QUALITY=" + stringify(reports, __, ""))
if (!reports.every(function(report) { return report.passes })) throw new Error("Semantic quality gate failed")
