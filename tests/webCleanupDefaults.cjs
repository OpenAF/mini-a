// Validate the production cleanup declaration and generate an isolated installed-runtime check.
// node tests/webCleanupDefaults.cjs --runtime-fixture /tmp/mini-a-cleanup-check.yaml
// ojob /tmp/mini-a-cleanup-check.yaml [historyretention=1800 ssequeuetimeout=240]
var assert = require('node:assert/strict')
var fs = require('node:fs')
var path = require('node:path')
var root = path.resolve(__dirname, '..')
var source = fs.readFileSync(path.join(root, 'mini-a-web.yaml'), 'utf8')
var start = source.indexOf('- name : Periodic cleanup of old sessions\n')
assert.ok(start >= 0, 'Find the production cleanup job')
var cleanup = source.slice(start).split('\n#')[0].trimEnd()
var declaration = cleanup.split('  exec : | #js\n')[0]
assert.match(declaration, /timeInterval: 300000\b/, 'Keep the five-minute scheduler interval')
assert.match(declaration, /\n  check:\n    in:\n      historyretention: toNumber\(\)\.isNumber\(\)\.default\(600\)/,
  'Validate cleanup defaults through check.in; periodic jobs do not merge job-level args')
assert.match(declaration, /\n      ssequeuetimeout: toNumber\(\)\.isNumber\(\)\.default\(120\)/)
assert.doesNotMatch(declaration, /\n  args\s*:/, 'Do not rely on periodic job args for cleanup defaults')

// The fixture runs the real job and validator against disposable session maps, never live agents.
if (process.argv[2] === '--runtime-fixture') {
  assert.ok(process.argv[3], 'Provide a temporary fixture path')
  cleanup = cleanup.replace('timeInterval: 300000', 'timeInterval: 50')
    .replace('  exec : | #js\n', '  exec : | #js\n' +
      '    global.__diagRetention = args.historyretention\n' +
      '    global.__diagSseTimeout = args.ssequeuetimeout\n')
  var fixture = `ojob:
  daemon: false
  logToConsole: false
todo:
- Init disposable sessions
- Periodic cleanup of old sessions
- Verify disposal
jobs:
- name: Init disposable sessions
  exec: |
    global.__diagExpectedRetention = isDef(args.historyretention) ? Number(args.historyretention) : 600
    global.__diagExpectedSse = isDef(args.ssequeuetimeout) ? Number(args.ssequeuetimeout) : 120
    global.__diagDisposed = 0
    global.__diagCleared = 0
    global.__diagReleased = 0
    global.__historykeep = true
    global.maArgs = {}
    global.__lastActivity = { expired: Date.now() - 20 * 60 * 1000, busy: 0 }
    global.__conversations = { expired: {}, busy: {} }
    global.__sseQueues = { stale: { updated: Date.now() - 3 * 60 * 1000, closed: false } }
    global.__busy = { busy: true }
    global.__advanced = {
      sessions: {
        expired: { runtime: { dispose: function() { global.__diagDisposed++ } } },
        busy: { runtime: { dispose: function() { throw new Error("Busy session disposed") } } }
      },
      pruneHistory: function() {}
    }
    global._mini_a_web_reserve = function(uuid) { return global.__busy[uuid] ? __ : "fixture-token" }
    global._mini_a_web_release = function() { global.__diagReleased++ }
    global._mini_a_web_transcript = function() { global.__diagCleared++ }
    global._mini_a_web_dispose = function(uuid) { delete global.__conversations[uuid] }
${cleanup}
- name: Verify disposal
  exec: |
    sleep(250, true)
    var shouldExpire = global.__diagExpectedRetention < 1200
    if (!isNumber(global.__diagRetention) || global.__diagRetention !== global.__diagExpectedRetention) throw new Error("Cleanup retention was not validated")
    if (!isNumber(global.__diagSseTimeout) || global.__diagSseTimeout !== global.__diagExpectedSse) throw new Error("SSE timeout was not validated")
    if (isDef(global.__conversations.expired) === shouldExpire) throw new Error("Incorrect idle-agent retention")
    if (isDef(global.__advanced.sessions.expired) === shouldExpire) throw new Error("Incorrect Advanced session retention")
    if (global.__diagDisposed !== (shouldExpire ? 1 : 0) || global.__diagCleared !== (shouldExpire ? 1 : 0)) throw new Error("Incorrect cleanup lifecycle")
    if (!isDef(global.__conversations.busy) || !isDef(global.__advanced.sessions.busy)) throw new Error("Busy session was not preserved")
    if (isDef(global.__sseQueues.stale) === (global.__diagExpectedSse < 180)) throw new Error("Incorrect stale SSE retention")
    if (shouldExpire && global.__diagReleased !== 1) throw new Error("Cleanup reservation was not released")
    print(stringify({ passed: true, retention: global.__diagRetention, sseTimeout: global.__diagSseTimeout, disposed: global.__diagDisposed, busyPreserved: true }, __, ""))
`
  fs.writeFileSync(process.argv[3], fixture)
  console.log('Installed-runtime cleanup fixture: ' + path.resolve(process.argv[3]))
}
console.log('Cleanup declaration: scheduler interval and validated retention/SSE defaults passed.')
