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

  // Exercise normal CLI/web configuration, including its unconfigured Falkor map.
  var wikiRoot = memoryDir + "/wiki"
  io.mkdir(wikiRoot)
  io.writeFileString(wikiRoot + "/index.md", "# Memory fixture")
  var wikiWriter = new MiniAWikiGraph({ graphDir: wikiRoot + "/.mini-a-wiki-graph" })
  wikiWriter.buildStructural([{ path: "index.md", meta: { title: "Memory fixture" }, body: "# Memory fixture", links: [] }])
  wikiWriter.close()
  for (var cycle = 0; cycle < 3; cycle++) {
    var managers = []
    try {
      var hosts = [__, "", "  "]
      hosts.forEach(function(host) {
        var config = __miniAWikiConfigFromArgs({ wikiroot: wikiRoot, wikiaccess: "ro", usewikigraph: true, wikigraphfalkorhost: host })
        var manager = new MiniAWikiManager(config)
        managers.push(manager)
        memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before, "default manager defers graph loading")
      })
      managers.forEach(function(manager) {
        memoryAssert(manager._graph.stats().nodes > 0, "manager can query the shared graph")
      })
      memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before + 1, "default managers share one parsed graph")
      managers[0].close()
      memoryAssert(managers[1]._graph.stats().nodes > 0, "closing one manager preserves other readers")
    } finally {
      managers.forEach(function(manager) { manager.close() })
    }
    memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before, "manager closure releases shared graphs every cycle")
  }

  // Configured remote, writable and custom readers must keep private graph state.
  io.writeFileString(memoryDir + "/remote-sync.json", "{}")
  var privateConfigs = [
    { graphDir: memoryDir, readOnly: true, falkor: { host: "fixture.invalid" } },
    { graphDir: memoryDir, readOnly: false, falkor: {} },
    { graphDir: memoryDir, readOnly: true, similarConceptsFn: function() { return [] } },
    { graphDir: memoryDir, readOnly: true, graphRaw: io.readFileString(memoryDir + "/graph.json") }
  ]
  privateConfigs.forEach(function(config) {
    var graph = new MiniAWikiGraph(config)
    try {
      memoryAssert(Object.prototype.hasOwnProperty.call(graph, "_cfg"), "configured private reader retains its implementation")
      memoryAssert(Object.keys(global.__miniAGraphReaders.entries).length === before, "private reader does not publish a shared snapshot")
    } finally { graph.close() }
  })
  print("PASS wiki memory streaming and graph ownership")
} finally {
  io.scanJSON = memoryScan
  memoryReaders.forEach(function(reader) { reader.close() })
  io.rm(memoryDir)
}
