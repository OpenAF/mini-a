// Real shared command dispatch, Advanced progress/results and cooperative Stop.
load('mini-a-session.js')
load('mini-a-advanced.js')
var root = String(new java.io.File(io.createTempDir('web_dream_auto_')).getCanonicalPath())
var oldHome = __gHDir
__gHDir = function() { return root }
function check(value, message) { if (!value) throw new Error(message) }
var jobs = []
global.__busy = {}; global.__runTokens = {}; global.__conversations = {}; global.__lastActivity = {}
global._mini_a_web_isValidUuid = function(id) { return /^[a-z0-9-]+$/.test(id) }
global._mini_a_web_reserve = function(id) { if (global.__busy[id]) return __; global.__busy[id] = true; return global.__runTokens[id] = genUUID() }
global._mini_a_web_release = function(id, token) { if (global.__runTokens[id] === token) { delete global.__busy[id]; delete global.__runTokens[id] } }
global._mini_a_web_dispose = function(id) { delete global.__conversations[id] }
var advanced
try {
  io.mkdir(root + '/wiki'); io.writeFileString(root + '/wiki/page.md', '# Web test\n\nA page to repair.\n')
  advanced = new MiniAAdvanced({ homedir: root, webadvancedpath: root + '/sessions', usehistory: false, usewiki: true, wikiaccess: 'rw', wikiroot: root + '/wiki', dreamwikillm: false })
  advanced.schedule = function(fn) { jobs.push(fn); return { catch: function() {} } }
  var state = advanced.get('dream'), count = 0, phases = [], stop = false, emit = advanced.emit
  advanced.emit = function(s, type, value) {
    if (type === 'output' && String(value).indexOf('[dreams:wiki:auto]') >= 0) {
      phases.push(String(value))
      if (stop && String(value).indexOf('Deterministic repair') >= 0) advanced.request({ uuid: 'dream', action: 'stop' })
    }
    return emit.apply(this, arguments)
  }
  function command(text) {
    var receipt = advanced.request({ uuid: 'dream', action: 'command', command: text, requestId: 'dream-' + (++count) })
    check(receipt.accepted, 'command accepted')
    jobs.shift()()
    var page = advanced.request({ uuid: 'dream', action: 'results', view: receipt.view.name, limit: 1 })
    var record = advanced.request({ uuid: 'dream', action: 'result', sequence: page.results[0].sequence })
    check(record.value.blocks.length > 0, 'structured dream result: ' + JSON.stringify(record))
    return record.value.blocks.filter(function(b) { return b.type === 'dream' })[0].value
  }
  var dry = command('/dream wiki auto dryrun')
  check(dry.mode === 'auto' && dry.status === 'planned', 'shared auto dry-run routing')
  check(!io.fileExists(root + '/wiki/.mini-a-wiki-maintenance'), 'dry run did not create backups')
  stop = true
  var cancelled = command('/dream wiki auto')
  check(cancelled.status === 'cancelled', 'Stop cancels coordinator at a safe boundary')
  check(io.fileExists(root + '/wiki/.mini-a-wiki-maintenance/pending.json'), 'cancel retains journal')
  stop = false
  var result = command('/dream wiki auto')
  check(result.reconciled_run === cancelled.run_id && result.verification.ok, 'next command reconciles and verifies')
  check(phases.length >= 3, 'phase progress reached Advanced events')
  var definitions = state.runtime.definitions
  check(definitions.dreamwikillm && definitions.dreammaxsteps, 'same settings exposed in shared session')
  print('PASS Advanced auto routing, dry-run, progress, structured results and Stop')
} finally {
  if (advanced) Object.keys(advanced.sessions).forEach(function(id) { advanced.sessions[id].runtime.dispose() })
  __gHDir = oldHome; io.rm(root)
}
