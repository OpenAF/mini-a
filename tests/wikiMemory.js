// Verify bounded suppression reads and shared graph ownership without model calls.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-wiki.js")
load("js/wiki/mini-a-graph.js")
var memoryAssert = function(value, message) {
  if (!value) throw new Error(message)
}
var memoryDir = String(java.nio.file.Files.createTempDirectory("mini-a-memory-"))
var memoryScan = io.scanJSON
var memoryReaders = []
try {
  var path = memoryDir + "/manifest.json"
  var text = '{"sources":{"a.b[0]":{"chunks":[{"text":"' + new Array(1000001).join("x") + '"}],"page":"a.md","active":false},"__proto__":{"active":true,"page":"b.md"}}}'
  io.writeFileString(path, text)
  var checkProjection = function() {
    var projected = MiniAWikiRetrievalV2.suppressionProjection(path, false)
    memoryAssert(projected.sources["a.b[0]"].page === "a.md", "literal source key")
    memoryAssert(projected.sources["a.b[0]"].chunks === undefined, "chunks skipped")
    memoryAssert(projected.sources["__proto__"].page === "b.md", "prototype key remains literal")
    var journal = memoryDir + "/journal.json"
    io.writeFileString(journal, '{"operations":[{"content":"ignored","path":"a.md"}],"phase":"prepared"}')
    var j = MiniAWikiRetrievalV2.suppressionProjection(journal, true)
    memoryAssert(j.operations[0].path === "a.md" && j.phase === "prepared", "journal field order")
    io.writeFileString(journal, '{"operations":[]} trailing')
    var failed = false
    try { MiniAWikiRetrievalV2.suppressionProjection(journal, true) } catch(e) { failed = true }
    memoryAssert(failed, "corrupt suffix rejected")
  }
  checkProjection()
  io.scanJSON = __
  checkProjection()
  io.scanJSON = memoryScan
  var writer = new MiniAWikiGraph({ graphDir: memoryDir })
  writer.save()
  var before = Object.keys(global.__miniAGraphReaders.entries).length
  var a = new MiniAWikiGraph({ graphDir: memoryDir, readOnly: true })
  var b = new MiniAWikiGraph({ graphDir: memoryDir, readOnly: true })
  memoryReaders = [a, b]
  memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before, "graph load deferred")
  // Concurrent first use publishes a single snapshot and serializes derived work.
  var errors = new java.util.concurrent.ConcurrentLinkedQueue()
  var threads = [a, b].map(function(reader) {
    return new java.lang.Thread(function() {
      try { reader.stats() } catch(e) { errors.add(String(e)) }
    })
  })
  threads.forEach(function(thread) { thread.start() })
  threads.forEach(function(thread) { thread.join(10000) })
  memoryAssert(threads.every(function(thread) { return !thread.isAlive() }) && errors.isEmpty(), "concurrent first use completes")
  memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before + 1, "graph shared")
  var state = a._state
  state.nodes.injected = { id: "injected" }
  memoryAssert(!b._state.nodes.injected, "returned state detached")
  // Publishing a changed graph gives the next call a new snapshot.
  writer._state.nodes["replacement"] = { id: "replacement", type: "concept", props: {} }
  writer.save()
  memoryAssert(!!a._state.nodes.replacement, "replacement artifact observed")
  memoryAssert(!!b._state.nodes.replacement, "replacement shared across owners")
  a.close()
  memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before + 1, "second owner retains graph")
  b.close()
  memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before, "last close releases graph")
  print("PASS wiki memory streaming and graph ownership")
} finally {
  io.scanJSON = memoryScan
  memoryReaders.forEach(function(reader) { reader.close() })
  io.rm(memoryDir)
}
