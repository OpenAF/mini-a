// Run from the checkout under test: WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalBenchmark.js
// Local FS + real Lucene; zero-result contract microbenchmark, not passage quality evaluation.
load("mini-a-common.js")
load("mini-a-wiki.js")
var pages = Math.max(1, Number(getEnv("WIKI_BENCH_PAGES")) || 100)
var samples = Math.max(2, Number(getEnv("WIKI_BENCH_SAMPLES")) || 10)
var dir = java.io.File.createTempFile("wiki-bench-", "").getCanonicalPath()
io.rm(dir); io.mkdir(dir)
var wm, reads = 0, bytes = 0, durations = []
try {
  for (var i = 0; i < pages; i++) io.writeFileString(dir + "/page-" + i + ".md", "---\ntitle: Fixture " + i + "\n---\n# Fixture\nOrdinary indexed content " + i)
  wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
  var indexed = wm.reindex()
  if (!indexed.ok) throw new Error(stringify(indexed))
  var original = wm._backend.read
  wm._backend.read = function(path) { var raw = original.call(wm._backend, path); reads++; bytes += new java.lang.String(String(raw || "")).getBytes("UTF-8").length; return raw }
  var coldStart = java.lang.System.nanoTime()
  wm.search("neverpresentidentifier", { __wikiNoMounts: true })
  var cold = Number(java.lang.System.nanoTime() - coldStart) / 1000000
  var coldReads = reads, coldBytes = bytes; reads = 0; bytes = 0
  for (var j = 0; j < samples; j++) {
    var start = java.lang.System.nanoTime()
    wm.search("neverpresentidentifier", { __wikiNoMounts: true })
    durations.push(Number(java.lang.System.nanoTime() - start) / 1000000)
  }
  durations.sort(function(a,b) { return a-b })
  var percentile = function(p) { return durations[Math.min(samples-1, Math.ceil(samples*p)-1)] }
  print("BENCHMARK=" + stringify({fixture:"indexed-zero-result",backend:"local-fs",pages:pages,samples:samples,runtime:getVersion(),jvm:String(java.lang.System.getProperty("java.version")),lucene:String(Packages.org.apache.lucene.util.Version.LATEST),cold:{ms:cold,bodyReads:coldReads,bytes:coldBytes},warm:{p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99),bodyReads:reads,bytes:bytes},memoryUsed:Number(java.lang.Runtime.getRuntime().totalMemory()-java.lang.Runtime.getRuntime().freeMemory())},__,""))
} finally { if (wm) wm.close(); io.rm(dir) }
