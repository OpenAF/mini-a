// Native verified-reader microbenchmark; this is not end-to-end retrieval latency.
load("mini-a-common.js"); load("mini-a-wiki.js")
var samples = Math.max(10, Number(getEnv("WIKI_BLOCK_SAMPLES")) || 1000)
var dir = String(io.createTempDir("wiki-block-bench-")), manager
var bean = java.lang.management.ManagementFactory.getThreadMXBean()
var allocationSupported = bean instanceof com.sun.management.ThreadMXBean && bean.isThreadAllocatedMemorySupported()
if (allocationSupported && !bean.isThreadAllocatedMemoryEnabled()) bean.setThreadAllocatedMemoryEnabled(true)
var threadId = java.lang.Thread.currentThread().threadId()
var allocation = function() { return allocationSupported ? Number(bean.getThreadAllocatedBytes(threadId)) : null }
var clock = function() { return Number(java.lang.System.nanoTime()) / 1000000 }
var report = { kind: "verified-block-microbenchmark", samples: samples, runtime: getVersion(), jvm: String(java.lang.System.getProperty("java.version")), sourceSha1: sha1(io.readFileString("mini-a-wiki-retrieval.js")), cases: [], allocationEstimator: allocationSupported ? "ThreadMXBean current-thread allocated Java heap bytes; includes harness, excludes native/non-heap and other threads; not peak memory" : "unavailable" }
try {
  manager = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", wikiretrievalv2: true }, function(){})
  var values = ["parameter is supported.\r\n", new Array(100).join("é😀\r\n"), new Array(40000).join("é😀\r\n")]
  values.forEach(function(value, index) {
    var path = dir + "/block.md"
    io.writeFileString(path, value)
    var record = { bytes: MiniAWikiRetrievalV2.bytes(value), checksum: MiniAWikiRetrievalV2.digest(path) }
    for (var warmup = 0; warmup < 10; warmup++) if (manager._retrievalV2._readVerifiedBlock(path,record) !== value) throw new Error("warmup content mismatch")
    var times = [], allocatedBefore = allocation()
    for (var sample = 0; sample < samples; sample++) {
      var started = clock(), actual = manager._retrievalV2._readVerifiedBlock(path,record)
      times.push(clock() - started)
      if (actual !== value) throw new Error("verified block content mismatch")
    }
    var allocatedAfter = allocation()
    times.sort(function(a,b){return a-b})
    var percentile = function(f) { return times[Math.min(times.length-1,Math.ceil(times.length*f)-1)] }
    report.cases.push({ caseId: index, bytes: record.bytes, characters: value.length, p50Millis: percentile(0.5), p95Millis: percentile(0.95), p99Millis: percentile(0.99), allocatedBytes: allocatedBefore === null ? null : allocatedAfter - allocatedBefore, allocatedBytesPerRead: allocatedBefore === null ? null : (allocatedAfter - allocatedBefore) / samples })
  })
  print("BLOCK_BENCHMARK=" + stringify(report, __, ""))
} finally { if (manager) manager.close(); io.rm(dir) }
