// Real local-FS incremental generation benchmark; run identical harness in both checkouts.
load("mini-a-common.js"); load("mini-a-wiki.js")
var pages = Math.max(10, Number(getEnv("WIKI_BENCH_PAGES")) || 1000), samples = Math.max(2, Number(getEnv("WIKI_BENCH_SAMPLES")) || 10)
var dir = String(io.createTempDir("wiki-updates-")), manager, report = { kind: "incremental-generations", mode: String(getEnv("WIKI_BENCH_LABEL") || "reuse"), backend: "local-fs", pages: pages, samples: samples, runtime: getVersion(), jvm: String(java.lang.System.getProperty("java.version")), sourceSha1: {wiki:sha1(io.readFileString("mini-a-wiki.js")),retrieval:sha1(io.readFileString("mini-a-wiki-retrieval.js"))}, observations: [] }
var clock = function() { return Number(java.lang.System.nanoTime()) / 1000000 }
var disk = function(root) {
  var seen = {}, unique = 0, apparent = 0, files = 0
  var walk = function(file) {
    if (file.isDirectory()) { var children = file.listFiles(); for (var i = 0; children && i < children.length; i++) walk(children[i]); return }
    if (!file.isFile()) return
    var attrs = java.nio.file.Files.readAttributes(file.toPath(), java.nio.file.attribute.BasicFileAttributes), key = String(attrs.fileKey())
    apparent += Number(attrs.size()); files++
    if (!seen[key]) { unique += Number(attrs.size()); seen[key] = true }
  }
  walk(new java.io.File(root)); return { apparentBytes: apparent, uniqueFileBytes: unique, files: files, estimator: "POSIX file identity and length; excludes allocation and metadata overhead" }
}
try {
  for (var i = 0; i < pages; i++) io.writeFileString(dir + "/page-" + i + ".md", "# Reference " + i + "\n" + new Array(30).join("Technical prerequisite and warning.\n") + "\n# Configuration\nparameter" + i + " controls expiry.")
  var config = {}
  if (["true","false"].indexOf(String(getEnv("WIKI_BENCH_LINKS")))>=0) config.linkImmutableFiles = String(getEnv("WIKI_BENCH_LINKS")) === "true"
  if (["true","false"].indexOf(String(getEnv("WIKI_BENCH_SHARED_BLOCKS")))>=0) config.sharedBlockStore = String(getEnv("WIKI_BENCH_SHARED_BLOCKS")) === "true"
  manager = new MiniAWikiManager({backend:"fs",root:dir,access:"rw",wikiretrievalv2:true,wikiretrievalconfig:config}, function(){})
  report.linkImmutableFiles = manager._retrievalV2.config.linkImmutableFiles
  report.sharedBlockStore = manager._retrievalV2.config.sharedBlockStore
  var started = clock(), built = manager.reindex(); if (!built.ok) throw new Error(stringify(built)); report.buildMillis = clock() - started
  manager.retrieve("parameter0") // warm serving catalogue and reader
  for (var s = 0; s < samples; s++) {
    var before = manager._retrievalV2.metrics.parsedPages; started = clock()
    var changed = manager.write("page-" + s + ".md", { title: "Updated " + s }, "# Update\nreplacementparameter" + s + " is current.")
    var elapsed = clock() - started, serving = manager._lastServingUpdate
    if (!changed.ok || !serving.ok || manager.retrieve("replacementparameter" + s).evidence.length !== 1) throw new Error("incremental update not serving current evidence")
    report.observations.push({ millis: elapsed, parsedPages: manager._retrievalV2.metrics.parsedPages - before, work: serving.updateWork || null })
  }
  var times = report.observations.map(function(o){return o.millis}).sort(function(a,b){return a-b}), percentile = function(f){return times[Math.min(times.length-1, Math.ceil(times.length*f)-1)]}
  report.latency = {p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99)}; report.disk = disk(dir); report.memoryUsed = Number(java.lang.Runtime.getRuntime().totalMemory()-java.lang.Runtime.getRuntime().freeMemory())
  print("UPDATES=" + stringify(report, __, ""))
} finally { if (manager) manager.close(); io.rm(dir) }
