// OpenAF integration checks for the real shared runtime, disk journal and async adapter.
// Run: oaf -f tests/webAdvanced.js (no model requests).
load('mini-a-session.js')
load('mini-a-advanced.js')
var testRoot = String(io.createTempFile('mini-a-advanced-tests-', '.dir'))
io.rm(testRoot); io.mkdir(testRoot)
testRoot = String(new java.io.File(testRoot).getCanonicalPath())
var originalHome = __gHDir
__gHDir = function() { return testRoot }
function check(value, message) { if (!value) throw new Error(message) }
var jobs = []
global.__busy = {}; global.__runTokens = {}; global.__conversations = {}; global.__lastActivity = {}
global._mini_a_web_isValidUuid = function(id) { return /^[a-z0-9-]+$/.test(id) }
global._mini_a_web_reserve = function(id) { if (global.__busy[id]) return __; global.__busy[id] = true; return global.__runTokens[id] = genUUID() }
global._mini_a_web_release = function(id, token) { if (global.__runTokens[id] === token) { delete global.__busy[id]; delete global.__runTokens[id] } }
global._mini_a_web_dispose = function(id) { delete global.__conversations[id] }
var submitted=[]
var MiniAWebPrompt = function(req) { submitted.push(jsonParse(req.files.postData)) }
try {
  var advanced = new MiniAAdvanced({homedir:testRoot, webadvancedpath: testRoot, usehistory: false, model: '(type: openai, model: fixture, key: TOP-SECRET)' })
  advanced.schedule = function(fn) { jobs.push(fn); return { catch: function() {} } }
  advanced.submitPrompt = function(req) { submitted.push(jsonParse(req.files.postData)) }
  var first=advanced.get('first'), second=advanced.get('second')
  check(first.runtime.options().conversation === testRoot + '/.openaf-mini-a/history/c-first.json', 'Advanced conversations use the console history directory: ' + first.runtime.options().conversation + ' expected ' + testRoot)
  check(advanced.request({uuid:'first',action:'stats'}).metrics === null, 'stats before first goal')
  var originalAgent = first.runtime.agent
  first.runtime.agent = function() { return { getMetrics: function() { return { goals: { achieved: 2 }, advisor: { trace: ['private'] }, memory: { enabled: true, sections: [{name: 'notes', count: 2}] }, invalid: NaN } } } }
  var chartStats = advanced.request({uuid:'first',action:'stats'})
  check(chartStats.metrics.goals.achieved === 2, 'structured chart metrics')
  check(chartStats.details.memory.sections[0].name === 'notes' && chartStats.details.memory.enabled === true, 'structured statistics retain arrays and booleans')
  check(stringify(chartStats).indexOf('private') < 0, 'chart metrics omit text and traces')
  check(!global.__busy.first && jobs.length === 0, 'statistics read does not schedule a command')
  first.runtime.agent = originalAgent
  var snap=advanced.snapshot(first,0)
  check(snap.commands.indexOf('absorb')>=0,'broad command registry')
  var settingByName = {}
  snap.settings.forEach(function(setting) { settingByName[setting.name] = setting })
  check(settingByName.model.dataEditor === 'map', 'model editor metadata reaches browser')
  check(settingByName.wikimounts.dataEditor === 'array', 'array editor metadata reaches browser')
  check(isUnDef(settingByName.absorboutput.dataEditor) && isUnDef(settingByName.policyfile.dataEditor), 'path-only settings do not offer data editors')
  check(stringify(snap).indexOf('TOP-SECRET')<0,'model credentials redacted')
  jobs = []
  var change={uuid:'first',action:'command',command:'/set useshell true',requestId:'change-1'}
  var received = advanced.request(change); check(jobs.length===1,'command scheduled: jobs=' + jobs.length + ' receipt=' + stringify(received))
  advanced.request(change); check(jobs.length===1,'duplicate request not rescheduled')
  check(advanced.request({uuid:'first',action:'command',command:'/help',requestId:'busy-1'}).busy,'overlap rejected')
  jobs.shift()()
  check(first.runtime.options().useshell===true,'shared setting applied')
  check(second.runtime.options().useshell!==true,'settings isolated')
  check(!global.__busy.first,'reservation released')
  advanced.request({uuid:'first',action:'command',command:'/set onport 1234',requestId:'blocked-1'});jobs.shift()()
  check(advanced.events(first,0,100).some(function(e){return e.type==='error'}),'server options rejected')
  advanced.request({uuid:'first',action:'preset',op:'save',name:'Personal',requestId:'preset-1'});jobs.shift()()
  check(io.readFileString(advanced.presetPath).indexOf('TOP-SECRET')<0,'presets omit secrets')
  advanced.request({uuid:'first',action:'command',command:'Hello',requestId:'goal-1'});jobs.shift()()
  check(submitted.length===1 && submitted[0].prompt==='Hello','goals use shared prompt route')
  var recovered=new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false}).get('first')
  check(recovered.runtime.options().useshell===true,'settings recovered')
  check(recovered.sequence===first.sequence,'journal recovered')
  var events=advanced.events(first,1,2)
  check(events.length===2 && events[0].sequence===2,'cursor pagination')
  advanced.emit(first,'output','Unicode café 漢字')
  check(advanced.events(first,first.sequence-1,1)[0].value==='Unicode café 漢字','UTF-8 journal')
  check(advanced.safe(42,'absorbmaxtokens')===42,'token budgets remain visible')
  check(advanced.safe({parameter:'secpass',value:'private'}).value==='[redacted]','setting table credentials redacted')
  advanced.request({uuid:'first',action:'settings',values:{model:'{"type":"openai","model":"changed","key":"[redacted]"}'},requestId:'masked-1'});jobs.shift()()
  var model=af.fromJSSLON(first.runtime.options().model)
  check(model.model==='changed' && model.key==='TOP-SECRET','masked editing preserves credentials')
  advanced.emit(first,'output',new Array(12002).join('x'))
  check(advanced.events(first,first.sequence-1,1)[0].truncated===true,'large events summarized')
  check(advanced.request({uuid:'first',action:'event',sequence:first.sequence}).value.length===12001,'large payload fetched on demand')
  first.pending={id:'choice-1',type:'choice',choices:['No','Yes']}
  advanced.request({uuid:'first',action:'reply',id:'choice-1',answer:1})
  check(first.pending===null,'pending interaction answered')
  first.pending={id:'choice-2',type:'choice',choices:['No','Yes']}
  advanced.request({uuid:'first',action:'stop'})
  check(first.cancelled && first.pending===null,'stop unblocks pending interaction')
  var sink=first.runtime.beginTrace('fixture')
  sink('tool_call',{name:'fixture',arguments:{text:'hello'}})
  var traces=first.runtime.tracePage(0,100,'calls')
  check(traces.events.length===1,'shared trace classification')
  check(first.runtime.tracePage(0,100,'all',1).payload.name==='fixture','trace details')
  var traceJournalSequence = first.sequence
  var longTraceText = new Array(15002).join('x') + '<script>café 漢字</script>'
  sink('tool_result',{nested:{items:[{text:longTraceText}]}})
  sink('event',{event:'warn',message:'fixture warning'})
  sink('llm_prompt',{label:'SYSTEM_INSTRUCTION',content:'system fixture'})
  var tracePage = advanced.request({uuid:'first',action:'trace',after:0,category:'all'})
  check(tracePage.filters[1].label === 'MCP and tool calls' && tracePage.filters[8].label === 'Warnings and errors', 'console debug labels reach browser')
  check(tracePage.filters[1].category === 'calls', 'filter names survive API redaction')
  check(tracePage.events.map(function(e) { return e.sequence }).join(',') === '1,2,3,4', 'trace index is chronological')
  check(tracePage.events[1].summary === 'tool_result' && tracePage.events[2].summary === 'warn: fixture warning', 'compact fallback retains readable summaries')
  check(isUnDef(tracePage.events[1].payload) && isUnDef(tracePage.events[1].offset), 'trace pages contain only public index metadata')
  var traceDetail = advanced.request({uuid:'first',action:'trace',sequence:2})
  check(traceDetail.payload.nested.items[0].text === longTraceText, 'selected record retains complete nested long UTF-8 strings')
  check(first.runtime.tracePage(0,1,'all').hasMore && !first.runtime.tracePage(3,1,'all').hasMore, 'trace page continuation')
  check(first.runtime.tracePage(1,1,'all').events[0].sequence === 2, 'trace cursor continuation')
  check(first.runtime.tracePage(0,1,'problems').events[0].sequence === 3 && !first.runtime.tracePage(0,1,'problems').hasMore, 'filtered trace continuation')
  check(first.runtime.tracePage(0,100,'thinking').events.length === 0, 'empty trace category')
  check(Object.keys(advanced.request({uuid:'first',action:'trace',sequence:999})).length === 0, 'missing trace record')
  check(advanced.request({uuid:'second',action:'trace'}).total === 0, 'empty trace metadata')
  check(first.sequence === traceJournalSequence && jobs.length === 0, 'debug inspection emits no activity or commands')
  var confirmationAgent = new MiniA(), confirmationCount = 0
  confirmationAgent.setInteractionFn(function() {})
  confirmationAgent.setConfirmFn(function(label, choices) { confirmationCount++; check(choices[0] === 'No', 'confirmation defaults to refusal'); return 0 })
  var denied = confirmationAgent._runCommand({command:'echo fixture',checkall:true})
  check(confirmationCount === 1 && denied.output.indexOf('[blocked]') === 0, 'browser callback controls shell approval')
  confirmationAgent._shellBatch = true
  confirmationAgent._runCommand({command:'echo fixture',checkall:true})
  check(confirmationCount === 1, 'batch mode remains noninteractive and denies')
  global.__res.first = [{event:'final',message:'old'}]
  advanced.request({uuid:'first',action:'command',command:'/clear',requestId:'clear-history'});jobs.shift()()
  check(global.__res.first.length === 0, 'clear updates the shared web transcript')
  delete global.__res.first
  var cleared = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false}).get('first')
  check(global.__res.first.length === 0, 'cleared transcript remains cleared after reload')
  cleared.runtime.dispose()
  var originalSchedule = advanced.schedule
  advanced.schedule = function() { throw new Error('scheduler unavailable') }
  try { advanced.request({uuid:'second',action:'command',command:'/help',requestId:'retry-schedule'}) } catch(expected) {}
  check(!global.__busy.second && !second.receipts['retry-schedule'], 'scheduler failure releases reservation for retry')
  advanced.schedule = originalSchedule
  first.runtime.dispose();second.runtime.dispose();recovered.runtime.dispose()
  var statsState = advanced.get('statistics')
  statsState.runtime.sync({ getMetrics: function() { return { goals: { achieved: 1 }, per_tool_usage: {} } } })
  ;['/stats', '/stats detailed', '/stats tools', '/stats memory', '/stats wiki'].forEach(function(command) {
    statsState.runtime.execute(command)
    check(advanced.snapshot(statsState, 0).events.length > 0, command + ' output can be polled, including blank lines')
  })
  advanced.emit(statsState, 'output', __)
  advanced.emit(statsState, 'output', null)
  advanced.emit(statsState, 'output', 0)
  var emptyRecords = advanced.events(statsState, statsState.sequence - 3, 3)
  check(emptyRecords.length === 3 && emptyRecords[2].value === 0, 'missing and null payloads do not break journal pagination')
  var restoredStats = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false}).get('statistics')
  check(advanced.snapshot(restoredStats, 0).events.length > 0, 'existing journals with blank outputs remain readable')
  statsState.runtime.dispose(); restoredStats.runtime.dispose()
  var historyDir = testRoot + '/.openaf-mini-a/history'
  var oldStamp = new Date(Date.now() - 120000)
  io.writeFileJSON(historyDir + '/c-expired.json', {c:[],updated_at:oldStamp,u:oldStamp})
  io.mkdir(historyDir + '/c-expired.json.historyvm')
  io.writeFileString(historyDir + '/c-expired.json.historyvm/fixture', 'old')
  io.writeFileJSON(testRoot + '/expired.json', {options:{}})
  io.writeFileString(testRoot + '/expired.ndjson', '')
  var retention = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot, historykeepperiod:1})
  var retained = retention.get('retained')
  check(!io.fileExists(historyDir + '/c-expired.json'), 'shared period retention prunes expired history')
  check(!io.fileExists(historyDir + '/c-expired.json.historyvm'), 'retention removes history VM sidecars')
  check(!io.fileExists(testRoot + '/expired.json') && !io.fileExists(testRoot + '/expired.ndjson'), 'retention removes matching Advanced metadata and journals')
  io.writeFileJSON(testRoot + '/c-legacy.json', {c:[],u:new Date()})
  var legacy = retention.get('legacy')
  check(legacy.runtime.options().conversation === testRoot + '/c-legacy.json', 'existing Advanced conversations remain readable')
  io.writeFileJSON(historyDir + '/c-protected.json', {c:[],updated_at:oldStamp,u:oldStamp})
  var protectedSession = retention.get('protected')
  global.__busy.protected = true
  retention.pruneHistory()
  check(io.fileExists(historyDir + '/c-protected.json'), 'busy conversations survive housekeeping')
  delete global.__busy.protected
  retention.pruneHistory()
  check(!io.fileExists(historyDir + '/c-protected.json'), 'idle expired conversation is pruned')
  check(!global.__busy.protected, 'housekeeping releases its session reservation')
  io.writeFileJSON(historyDir + '/c-count-old.json', {c:[],u:oldStamp,updated_at:oldStamp})
  io.writeFileJSON(historyDir + '/c-count-new.json', {c:[],u:new Date(),updated_at:new Date()})
  var countStore = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,historykeepcount:1})
  var countSession = countStore.get('count-current')
  check(!io.fileExists(historyDir + '/c-count-old.json') && io.fileExists(historyDir + '/c-count-new.json'), 'shared count retention keeps newest conversations')
  countSession.runtime.sync({llm:{getGPT:function() { return {getConversation:function() { return [{role:'user',content:'saved fixture'}] }} }}})
  countSession.runtime.saveConversation()
  check(io.readFileJSON(countSession.runtime.options().conversation).c[0].content === 'saved fixture', 'shared console writer saves Advanced history')
  var stablePath = countSession.runtime.options().conversation
  countSession.runtime.execute('/clear')
  check(countSession.runtime.options().conversation === stablePath, 'clear retains the UUID history path for subsequent resume')
  countSession.runtime.dispose()
  retained.runtime.dispose(); legacy.runtime.dispose(); protectedSession.runtime.dispose()
  print('Advanced OpenAF integration checks passed')
} catch(e) { printErr(e); exit(1) } finally { __gHDir = originalHome; io.rm(testRoot) }
