// Provider-free dispatch, concurrency and proxy regression fixtures.
// Run: oaf -f tests/mcpExecutionSafety.js
load("mini-a.js")
load("js/core/mini-a-progcall.js")
try {
var assertions = 0
function check(value, message) { if (!value) throw new Error(message); assertions++ }
function equal(actual, expected, message) { check(actual === expected, message + " (actual=" + stringify(actual) + ")") }
function agent() {
  var a = new MiniA()
  a.fnI = function() {}
  a._logToolUsage = function() {}
  return a
}
function tool(name, annotations, metadata) {
  return { name: name, annotations: annotations || {}, metadata: metadata || {}, inputSchema: { type: "object", properties: {} } }
}
function install(a, id, tools, call) {
  var client = { callTool: call }
  a._mcpConnections[id] = client
  a.mcpTools = (a.mcpTools || []).concat(tools)
  a.mcpToolToConnection = a.mcpToolToConnection || {}
  tools.forEach(function(t) { a._toolInfoByName[t.name] = t; a.mcpToolToConnection[t.name] = id; a._toolCacheSettings[t.name] = a._computeToolCacheSettings(t, 300000) })
  a._registerToolCacheClient(id, client, tools)
  return client
}
function invoke(a, id, name, params) { return a._executeToolWithCache(id, name, params || {}) }
var pure = tool("read", { readOnlyHint: true, cacheable: true })
var write = tool("write", { readOnlyHint: false })
var live = tool("live", { readOnlyHint: true, idempotentHint: true })
var a = agent()
check(a._computeToolCacheSettings(pure, 1000).enabled, "Explicit cache contract enables caching")
check(!a._computeToolCacheSettings(live, 1000).enabled, "Read-only idempotent live tools stay fresh")
;[
  tool("t", { cacheable: true, deterministic: false }),
  tool("t", { deterministic: true }, { cacheable: false }),
  tool("t", { cacheable: true, readOnlyHint: false }),
  tool("t", { deterministic: true, readOnlyHint: true }, { readOnlyHint: false }),
  tool("t", { cacheable: "true" }),
  tool("t", { cacheable: true, readOnlyHint: true, destructiveHint: true })
].forEach(function(t) { check(!a._computeToolCacheSettings(t, 1000).enabled, "Negative and non-boolean declarations do not opt in") })
var settings = a._computeToolCacheSettings(tool("t", { deterministic: true, cacheTtl: 71, cacheKeyFields: "id,region" }), 1000)
equal(settings.ttl, 71, "TTL preserved")
equal(settings.keyFields.join(","), "id,region", "Key fields preserved")
var calls = 0, value = 1
install(a, "fixture", [pure, write, live], function(name) { calls++; if (name === "write") value++; return { value: value } })
equal(invoke(a, "fixture", "read").value, 1, "Initial read")
equal(invoke(a, "fixture", "read").value, 1, "Cached read")
equal(calls, 1, "Stable read cached")
invoke(a, "fixture", "live"); invoke(a, "fixture", "live")
equal(calls, 3, "Read-only live calls never cached")
invoke(a, "fixture", "write")
equal(invoke(a, "fixture", "read").value, 2, "Write invalidates existing reads")
equal(calls, 5, "Read dispatched after write")
var keyed = agent(), keyCalls = 0
install(keyed, "keyed", [tool("keyed", { deterministic: true, cacheKeyFields: ["id"] })], function() { keyCalls++; return { value: keyCalls } })
equal(invoke(keyed, "keyed", "keyed", { id: 1, ignored: "first" }).value, 1, "Deterministic-only contract caches")
equal(invoke(keyed, "keyed", "keyed", { id: 1, ignored: "second" }).value, 1, "Argument key controls preserved")
equal(invoke(keyed, "keyed", "keyed", { id: 2 }).value, 2, "Selected argument changes invalidate key")
var timed = agent(), timedCalls = 0
install(timed, "timed", [tool("timed", { cacheable: true, readOnlyHint: true, cacheTtl: 1 })], function() { timedCalls++; return { value: timedCalls } })
invoke(timed, "timed", "timed"); sleep(5, true)
equal(invoke(timed, "timed", "timed").value, 2, "Expired entries are not returned")
var errors = agent(), errorCalls = 0
install(errors, "errors", [pure], function() { errorCalls++; return { isError: true, content: [{ type: "text", text: "failure" }] } })
invoke(errors, "errors", "read"); invoke(errors, "errors", "read")
equal(errorCalls, 2, "MCP isError results are never cached")
var b = agent(), bCalls = 0
install(b, "fixture", [pure], function() { bCalls++; return { value: "other session" } })
equal(invoke(b, "fixture", "read").value, "other session", "Equal connection IDs do not collide across sessions")
equal(bCalls, 1, "Independent root dispatched")
install(a, "other", [pure], function() { return { value: "other connection" } })
equal(invoke(a, "other", "read").value, "other connection", "Equal tool names do not collide across connections")
a._mcpConnections.other = { callTool: function() { return { value: "replacement" } } }
equal(invoke(a, "other", "read").value, "replacement", "Client replacement rotates its generation")
var firstGeneration = a._registerToolCacheClient("other", a._mcpConnections.other)
a._registerToolCacheClient("other", a._mcpConnections.other, [pure, live])
check(a._registerToolCacheClient("other", a._mcpConnections.other) !== firstGeneration, "Changed catalog rotates generation")
var changedCalls = 0
var changedClient = install(a, "catalog", [pure], function() { changedCalls++; return { value: changedCalls } })
invoke(a, "catalog", "read"); invoke(a, "catalog", "read")
a._registerToolCacheClient("catalog", changedClient, [pure, live])
equal(invoke(a, "catalog", "read").value, 2, "Catalog change invalidates previously cached tool results")
var duplicate = agent(), duplicateWrites = 0, duplicateReads = 0
install(duplicate, "read-side", [tool("same-name", { readOnlyHint: true, cacheable: true })], function() { duplicateReads++; return { value: duplicateReads } })
install(duplicate, "write-side", [tool("same-name", { readOnlyHint: false })], function() { duplicateWrites++; throw new Error("Connection reset after commit") })
invoke(duplicate, "read-side", "same-name"); invoke(duplicate, "read-side", "same-name")
equal(duplicateReads, 1, "Direct cache uses selected connection's tool contract")
equal(invoke(duplicate, "write-side", "same-name").outcome, "unknown", "Same-name write uses its own execution contract")
equal(duplicateWrites, 1, "Same-name unsafe write runs once")
var child = agent()
a._prepareChildMcpHandoff(child, { _mcpHandoffTools: ["read", "write", "live"] }, {})
check(child._toolCacheFamily === a._toolCacheFamily, "Delegated agents share invalidation family")
// Use the same shared client and catalog in both delegates.
child._mcpConnections.fixture = a._mcpConnections.fixture
child._toolInfoByName.write = write
child._toolInfoByName.read = pure
invoke(child, "fixture", "write")
equal(invoke(a, "fixture", "read").value, 3, "Child mutation invalidates parent read")
var beforeShell = a._toolCacheFamily.epoch
a._runCommand({ command: "echo cache-invalidation-fixture", readwrite: false, checkall: false })
check(a._toolCacheFamily.epoch > beforeShell, "Shell execution invalidates family")

// Real overlapping dispatches: reads that cross a write cannot populate the cache.
var concurrent = agent(), entered = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1)
var readCalls = new java.util.concurrent.atomic.AtomicInteger(0), concurrentValue = new java.util.concurrent.atomic.AtomicInteger(1)
install(concurrent, "concurrent", [pure, write], function(name) {
  if (name === "write") { concurrentValue.incrementAndGet(); return { value: concurrentValue.get() } }
  var n = readCalls.incrementAndGet(), captured = concurrentValue.get()
  if (n === 1) { entered.countDown(); if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new Error("fixture timeout") }
  return { value: captured }
})
var asyncRead = $do(function() { return invoke(concurrent, "concurrent", "read") })
check(entered.await(10, java.util.concurrent.TimeUnit.SECONDS), "Read entered before mutation")
invoke(concurrent, "concurrent", "write")
release.countDown()
$doWait(asyncRead)
equal(invoke(concurrent, "concurrent", "read").value, 2, "Read spanning mutation is not inserted")
equal(Number(readCalls.get()), 2, "Fresh read dispatched after overlapping write")
var during = agent(), writeEntered = new java.util.concurrent.CountDownLatch(1), writeRelease = new java.util.concurrent.CountDownLatch(1), duringReads = 0
install(during, "during", [pure, write], function(name) {
  if (name === "write") { writeEntered.countDown(); if (!writeRelease.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new Error("fixture timeout"); return {} }
  duringReads++; return { value: duringReads }
})
invoke(during, "during", "read")
var asyncWrite = $do(function() { return invoke(during, "during", "write") })
check(writeEntered.await(10, java.util.concurrent.TimeUnit.SECONDS), "Write entered")
equal(invoke(during, "during", "read").value, 2, "Cached reads bypassed while writer runs")
equal(invoke(during, "during", "read").value, 3, "Reads inside mutation window not cached")
writeRelease.countDown(); $doWait(asyncWrite)
equal(invoke(during, "during", "read").value, 4, "Post-write read fresh")
equal(during._toolCacheFamily.mutations, 0, "Mutation activity released")

var unsafe = agent(), committed = 0
install(unsafe, "unsafe", [write], function() { committed++; throw new Error("Connection reset after committed write") })
var uncertain = invoke(unsafe, "unsafe", "write")
equal(committed, 1, "Committed unsafe write executes once after lost response")
equal(uncertain.outcome, "unknown", "Unsafe outcome reported as unknown")
equal(uncertain.retryable, false, "Unsafe outcome forbids automatic replay")
equal(unsafe._toolCacheFamily.mutations, 0, "Failed write releases mutation activity")
var routed = agent(), routeWrites = 0
install(routed, "routed", [write], function() { routeWrites++; throw new Error("Connection reset after commit") })
routed._adaptiveRouting = true
routed._toolRouter.select = function() { return { selectedRoute: "first", fallbackChain: ["second"] } }
routed._prepareToolExecution = function() { return { contextId: "fixture", updateContext: false } }
routed._finalizeToolExecution = function() {}
var routedResult = routed._executeParallelToolBatch([{ toolName: "write", params: {} }])
equal(routeWrites, 1, "Adaptive route fallback cannot replay uncertain writes")
equal(routedResult[0].result.rawResult.outcome, "unknown", "Routed result preserves uncertainty")
var envelopeWrites = 0
routed._mcpConnections.routed = { callTool: function() { envelopeWrites++; return { error: "Committed partially, result unavailable" } } }
routed._executeParallelToolBatch([{ toolName: "write", params: {} }])
equal(envelopeWrites, 1, "Returned unsafe errors cannot trigger adaptive replay")
var bridgeError = new MiniAProgCallServer(unsafe)._makeErrorResponse({ rawResult: uncertain, normalized: { display: uncertain.error } })
equal(bridgeError.outcome, "unknown", "Programmatic error preserves unknown outcome")
equal(bridgeError.retryable, false, "Programmatic error preserves no-retry hint")
var safe = agent(), safeCalls = 0
install(safe, "safe", [live], function() { safeCalls++; if (safeCalls < 3) throw new Error("Connection reset"); return { value: "safe" } })
equal(invoke(safe, "safe", "live").value, "safe", "Read-only transient retries still work")
equal(safeCalls, 3, "Read-only retry count")
var idem = tool("idem", { readOnlyHint: false, idempotentHint: true }), idemCalls = 0
install(safe, "idem", [idem], function() { idemCalls++; if (idemCalls < 2) throw new Error("Connection reset"); return { value: "idempotent" } })
equal(invoke(safe, "idem", "idem").value, "idempotent", "Explicit idempotent writes retry safely")
equal(idemCalls, 2, "Idempotent retry count")
var init = agent(), initializations = 0, dispatches = 0
var initClient = install(init, "initialization", [write], function() { dispatches++; return {} })
initClient.initialize = function() { initializations++; if (initializations < 2) throw new Error("Connection reset before dispatch") }
init._lazyMcpConnections.initialization = true
invoke(init, "initialization", "write")
equal(initializations, 2, "Initialization retries before unsafe dispatch")
equal(dispatches, 1, "Unsafe dispatch starts only once after initialization")

// Exercise the actual embedded proxy, including the outer wrapper and argument files.
function proxy(label) {
  var p = agent(), count = { read: 0, write: 0 }, current = 1
  p._takeStartupMcp = function() { return {
    listTools: function() { return { tools: [pure, write, live] } },
    callTool: function(name, params) {
      if (name === "write") { count.write++; current++; if (params.lose) throw new Error("Connection reset after commit") }
      else count.read++
      return { value: label + ":" + current, argument: params.id }
    }
  } }
  var cfg = p._createMcpProxyConfig([{ id: "same-proxy-connection", type: "dummy" }], {})
  check(isObject(cfg), "Proxy fixture created")
  install(p, "proxy", [tool("proxy-dispatch", { cacheable: true, readOnlyHint: true })], function(name, params) { return cfg.options.fns[name](params) })
  p.mcpToolToConnection["proxy-dispatch"] = "proxy"
  return { agent: p, counts: count, config: cfg }
}
var p1 = proxy("one"), p2 = proxy("two")
function proxyCall(p, name, params, extra) { return invoke(p.agent, "proxy", "proxy-dispatch", merge({ action: "call", tool: name, arguments: params || {} }, extra || {})) }
function proxyData(result) { return jsonParse(result.content[0].text) }
equal(proxyData(proxyCall(p1, "read")).value, "one:1", "First proxy retains own client after second root starts")
equal(proxyData(proxyCall(p2, "read")).value, "two:1", "Second proxy has independent client")
proxyCall(p1, "read")
equal(p1.counts.read, 1, "Resolved downstream read cached")
proxyCall(p1, "live"); proxyCall(p1, "live")
equal(p1.counts.read, 3, "Outer proxy never caches live calls")
var proxyUnknown = proxyCall(p1, "write", { lose: true })
equal(p1.counts.write, 1, "Proxy write with lost response executes once")
equal(proxyUnknown.outcome, "unknown", "Proxy retains unknown outcome")
equal(proxyUnknown.retryable, false, "Proxy retains retryable false")
equal(proxyData(proxyCall(p1, "read")).value, "one:2", "Proxy mutation invalidates downstream cache")
var argsFile = String(io.createTempFile("mini_a_args_", ".json"))
try {
  io.writeFileString(argsFile, '{"id":1}')
  equal(proxyData(proxyCall(p1, "read", {}, { argumentsFile: argsFile })).argument, 1, "Argument-file inputs resolved before caching")
  io.writeFileString(argsFile, '{"id":2}')
  equal(proxyData(proxyCall(p1, "read", {}, { argumentsFile: argsFile })).argument, 2, "Argument-file edits do not hit stale outer cache")
} finally { io.rm(argsFile) }
var oldWrite = io.writeFileString, formatWrites = p1.counts.write
try {
  io.writeFileString = function() { throw new Error("Connection reset during result-file formatting") }
  var failedFormat = proxyCall(p1, "write", {}, { resultToFile: true })
  check(isString(failedFormat.error), "Result-file failure returns existing error envelope")
  equal(failedFormat.retryable, false, "Result-file failures are not replayed")
} finally { io.writeFileString = oldWrite }
equal(p1.counts.write, formatWrites + 1, "Formatting failure cannot repeat downstream action")
MiniA._destroyMcpProxyConnections(p1.agent._id)
equal(proxyData(proxyCall(p2, "read")).value, "two:1", "Closing another proxy preserves current owner")
MiniA._destroyMcpProxyConnections(p2.agent._id)
print("PASS MCP execution safety: " + assertions + " assertions")

} catch(e) { printErr(e); if (e.stack) printErr(e.stack); exit(1) }
