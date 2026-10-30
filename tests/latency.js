// OpenAF thread and loopback transport checks. Run: oaf -f tests/latency.js
load('mini-a.js')
function check(value, message) { if (!value) throw new Error(message) }
var a = new MiniA(), server
var started = new java.util.concurrent.CountDownLatch(2)
var releaseFirst = new java.util.concurrent.CountDownLatch(1)
var releaseSecond = new java.util.concurrent.CountDownLatch(1)
var active = new java.util.concurrent.atomic.AtomicInteger(0)
var total = new java.util.concurrent.atomic.AtomicInteger(0)
var overflow = new java.util.concurrent.atomic.AtomicBoolean(false)
var closed = new java.util.concurrent.atomic.AtomicInteger(0)
var configs = [{type:'remote',id:'one'}, {type:'remote',id:'two'}, {type:'remote',id:'three'}]
a.fnI = function() {}
a._newStartupMcpClient = function(config) {
  return {
    __miniAStartupHooks: {},
    initialize: function() {
      if (active.incrementAndGet() > 2) overflow.set(true)
      total.incrementAndGet(); started.countDown()
      try {
        if (config.id === 'one') releaseFirst.await(5, java.util.concurrent.TimeUnit.SECONDS)
        else releaseSecond.await(5, java.util.concurrent.TimeUnit.SECONDS)
      } finally { active.decrementAndGet() }
    },
    destroy: function() { closed.incrementAndGet() }
  }
}
try {
  a.prepareSession({mcp:configs})
  check(started.await(5, java.util.concurrent.TimeUnit.SECONDS), 'Two handshakes start concurrently')
  check(total.get() === 2 && !overflow.get(), 'Third handshake waits for a worker')
  releaseFirst.countDown()
  var adopted = a._takeStartupMcp(configs[0])
  check(adopted && releaseSecond.getCount() === 1, 'Ready client adopted while other handshakes remain blocked')
  a._closeStartupPreparation()
  releaseSecond.countDown()
  var batch = a._startupEntries[0]
  check(batch.done.await(5, java.util.concurrent.TimeUnit.SECONDS), 'Cancelled workers settle')
  // Disposal follows latch publication, so allow the worker to finish cleanup.
  var until = now() + 1000
  while ((!batch.disposed || closed.get() + 1 < total.get()) && now() < until) sleep(10, true)
  check(batch.disposed && !overflow.get(), 'Abandoned transports are disposed with bounded concurrency')
  adopted.destroy()
  check(closed.get() === total.get(), 'Every created transport is closed exactly once')

  // Real HTTP I/O must receive the remaining read budget through manager.read.
  ow.loadServer()
  server = ow.server.httpd.start(__, '127.0.0.1')
  ow.server.httpd.route(server, {'/slow.md': function(req) {
    sleep(400, true)
    return ow.server.httpd.reply('# Late page', 200, 'text/plain', {})
  }, '/fast.md': function(req) {
    return ow.server.httpd.reply('# Fast page', 200, 'text/plain', {})
  }})
  var wiki = Object.create(MiniAWikiManager.prototype)
  wiki._maybeRefreshArtifactBundle = function() {}
  wiki._auditRetrieval = function() {}
  wiki._extractLinkEntries = function() { return [] }
  wiki._decorateEntry = function(v) { return v }
  wiki._backend = wiki._makeHttpBackend({url:'http://127.0.0.1:' + server.getPort(),wikihttptimeout:2000})
  var before = now(), page = wiki.read('slow.md', {maxMillis:60}), elapsed = now() - before
  check(isUnDef(page) && elapsed < 350, 'HTTP read honors short retrieval budget: ' + elapsed + 'ms')
  check(wiki.read('fast.md', {maxMillis:1000}).body.indexOf('Fast page') >= 0, 'Budgeted HTTP body reads preserve content')
  check(wiki.read('fast.md').body.indexOf('Fast page') >= 0, 'Standalone HTTP reads remain supported')
  print('PASS latency OpenAF: concurrent preparation, ownership cleanup, bounded HTTP reads')
} finally {
  releaseFirst.countDown(); releaseSecond.countDown()
  a._closeStartupPreparation()
  if (server) ow.server.httpd.stop(server)
}
