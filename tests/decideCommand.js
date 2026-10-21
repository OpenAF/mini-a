// Provider-free integration of /decide through the shared Advanced/console dispatcher.
// Run: OAF_DECIDE_MODEL="(type: ollama, model: env-decision)" oaf -f tests/decideCommand.js
if (getEnv("OAF_DECIDE_MODEL") !== "(type: ollama, model: env-decision)") throw new Error("Run with the documented fixture model configuration")
load('mini-a-session.js')
load('mini-a-advanced.js')
var testRoot = String(io.createTempFile('mini-a-decide-', '.dir'))
io.rm(testRoot); io.mkdir(testRoot)
var originalHome = __gHDir
__gHDir = function() { return testRoot }
function check(value, message) { if (!value) throw new Error(message) }
var jobs = [], calls = [], debugChannels = [], fail = false
global.__busy = {}; global.__runTokens = {}; global.__conversations = {}; global.__lastActivity = {}
global._mini_a_web_isValidUuid = function(id) { return /^[a-z0-9-]+$/.test(id) }
global._mini_a_web_reserve = function(id) { if (global.__busy[id]) return __; global.__busy[id] = true; return global.__runTokens[id] = genUUID() }
global._mini_a_web_release = function(id, token) { if (global.__runTokens[id] === token) { delete global.__busy[id]; delete global.__runTokens[id] } }
global._mini_a_web_dispose = function(id) { delete global.__conversations[id] }
try {
  var advanced = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false})
  advanced.schedule = function(fn) { jobs.push(fn); return {catch:function(){}} }
  var state = advanced.get('decide'), runtime = state.runtime, sequence = 0
  var originalClient = MiniADecision.prototype._client
  MiniADecision.prototype._client = function() { this._options.clientFactory = fixtureClient; return originalClient.call(this) }
  function fixtureClient(config) {
    return {
      getCapabilities: function() { return {} },
      setDebugCh: function(name) { debugChannels.push(name) },
      decideWithStats: function(evidence, questions) {
        calls.push({config:config,state:evidence,questions:questions})
        if (fail) throw new Error('PRIVATE PROVIDER RESPONSE')
        return {response:{answers:{urgent:{type:'boolean',value:false}}},stats:{tokens:{prompt:7,completion:2,total:9}}}
      }
    }
  }
  function command(text) {
    var receipt = advanced.request({uuid:'decide',action:'command',command:text,requestId:'decide-'+(++sequence)})
    check(receipt.accepted, 'command accepted')
    jobs.shift()()
    var page = advanced.request({uuid:'decide',action:'results',view:receipt.view.name,limit:1})
    return advanced.request({uuid:'decide',action:'result',sequence:page.results[0].sequence}).value
  }
  function stats() { return advanced.request({uuid:'decide',action:'stats'}) }
  var payload = {state:{scope:'Assess this incident',evidence:'Double charge'},questions:{urgent:{type:'boolean',instructions:'Urgent?'}}}
  check(runtime.commands().indexOf('decide')>=0 && runtime.commandMetadata().some(function(m){return m.name==='decide' && m.destination==='decide'}), 'registered command')
  check(command('/decide help').status==='completed' && calls.length===0, 'help makes no call')
  check(command('/decide').blocks[0].value.compose===true && calls.length===0, 'bare web command opens form')
  runtime.sync(__,'Prior goal','Prior answer')
  var result = command('/decide '+stringify(payload))
  check(result.status==='completed' && result.blocks[0].value.response.answers.urgent.value===false, 'typed answer')
  check(calls.length===1 && calls[0].config.model==='env-decision' && !runtime.agent(), 'environment model without agent initialization')
  check(stats().details.decisions.calls===1 && stats().metrics.llm_calls.total===1, 'stats before first goal')
  check(command('/stats').status==='completed', 'slash stats before first goal')
  check(command('/last').blocks[0].value.answer==='Prior answer', 'previous answer preserved')
  runtime.setOptions({modeldec:'(type: ollama, model: session-decision)',debugdecch:'(type: simple, name: decide_test_debug)'})
  command('/decide (state: Evidence, questions: (urgent: (type: boolean, instructions: Urgent?)))')
  check(calls.length===2 && calls[1].config.model==='session-decision', 'SLON and model override')
  check(debugChannels.length===1 && debugChannels[0]==='decide_test_debug', 'debug channel attached')
  var agentMetrics = {decisions:{calls:3,total_tokens:30,usage_reports:1},llm_calls:{decision:3,total:5}}
  var agent = {getMetrics:function(){return agentMetrics}}
  global.__conversations.decide=agent
  runtime.sync(agent)
  check(stats().details.decisions.calls===5 && stats().metrics.llm_calls.total===7, 'merge direct and agent counts once')
  check(stats().details.decisions.calls===5 && agentMetrics.decisions.calls===3, 'stats snapshots do not mutate or double count')
  runtime.setOptions({usedecide:false})
  check(command('/decide '+stringify(payload)).status==='failed' && calls.length===2, 'explicit disable')
  runtime.setOptions({usedecide:true})
  var invalid = [merge(payload,{options:{strategy:'auto'}}),{state:'x',questions:{}},{state:'x',questions:{q:{type:'free',instructions:'x'}}},
    {state:'x',questions:{q:{type:'choice',instructions:'x',criteria:{only:'One'}}}}, {state:'x',questions:{q:{type:'score',instructions:'x',criteria:['one']}}},
    merge(payload,{state:'é'.repeat(25000)})]
  var many = {}; for(var i=0;i<33;i++)many['q'+i]=payload.questions.urgent
  invalid.push({state:'x',questions:many})
  invalid.forEach(function(request){check(command('/decide '+stringify(request)).status==='failed','invalid request rejected')})
  check(command('/decide invalid-json').status==='failed' && calls.length===2, 'no rejected request dispatched')
  fail=true
  result=command('/decide '+stringify(payload))
  check(result.status==='failed' && stringify(result).indexOf('PRIVATE PROVIDER')<0, 'sanitized error')
  check(stats().details.decisions.calls===6 && stats().details.decisions.failures===1, 'failed request counted')
  fail=false
  function interactive(answers) {
    var receipt=advanced.request({uuid:'decide',action:'command',command:'/decide interactive',requestId:'decide-'+(++sequence)})
    check(receipt.accepted,'interactive request accepted')
    var work=jobs.shift(), done=false
    $doV(function(){try {work()} finally {done=true}})
    function waitFor(predicate) { var until=Date.now()+5000; while(!predicate() && Date.now()<until)sleep(20); check(predicate(),'interactive input available') }
    answers.forEach(function(answer){
      waitFor(function(){return !!state.pending || done})
      check(!done && state.pending.type===(typeof answer==='number'?'choice':'text'),'interactive dialog type')
      var id=state.pending.id
      advanced.request({uuid:'decide',action:'reply',id:id,answer:answer})
      waitFor(function(){return done || !state.pending || state.pending.id!==id})
    })
    waitFor(function(){return done})
    return advanced.result(state,advanced.results(state,'decide',0,1).results[0].sequence).value
  }
  var beforeInteractive=calls.length
  var prompted=interactive(['Scope','Evidence','team',1,'Choose a team','billing','Payments','technical','Software',0,0,1])
  check(prompted.status==='completed' && calls.length===beforeInteractive+1,'interactive dialogs submit exactly one decision')
  check(calls[calls.length-1].questions.team.criteria.billing==='Payments','interactive criteria collected individually')
  interactive(['/cancel'])
  check(calls.length===beforeInteractive+1,'interactive cancellation makes no call')
  var originalLimiter = MiniA.prototype._createRateLimiter, limitsSeen, before = 0, used = []
  MiniA.prototype._createRateLimiter = function(limits) {
    limitsSeen=limits
    return {beforeCall:function(){before++},afterCall:function(tokens){used.push(tokens)}}
  }
  runtime.setOptions({rpm:17,tpm:101})
  command('/decide '+stringify(payload))
  fail=true; command('/decide '+stringify(payload)); fail=false
  check(limitsSeen.rpm===17 && limitsSeen.tpm===101 && before===2 && used[0]===9 && used[1]===0, 'rate limiter receives calls and usage including failures')
  var cancelMode, cancelLimiter, waiting = false, releases = 0
  MiniA.prototype._createRateLimiter = function(limits) {
    cancelLimiter = originalLimiter.call({fnI:function(){waiting=true}},limits)
    var beforeCall=cancelLimiter.beforeCall, afterCall=cancelLimiter.afterCall
    cancelLimiter.beforeCall=function(isCancelled) {
      if (cancelMode==='before') advanced.request({uuid:'decide',action:'stop'})
      var admitted=beforeCall(isCancelled)
      if (cancelMode==='admitted' && admitted) advanced.request({uuid:'decide',action:'stop'})
      return admitted
    }
    cancelLimiter.afterCall=function(tokens) { releases++; afterCall(tokens) }
    return cancelLimiter
  }
  var callsBeforeCancel=calls.length
  cancelMode='before'; runtime.setOptions({rpm:10,tpm:0})
  check(command('/decide '+stringify(payload)).status==='cancelled','cancellation before admission reported')
  check(calls.length===callsBeforeCancel && releases===0,'no dispatch or cleanup before admission')
  check(cancelLimiter.tryBeforeCall(),'pre-admission cancellation leaves limiter available')
  cancelLimiter.afterReservedCall(0)
  cancelMode='admitted'; runtime.setOptions({rpm:11})
  check(command('/decide '+stringify(payload)).status==='cancelled','cancellation after admission reported')
  check(calls.length===callsBeforeCancel && releases===1,'post-admission cancellation releases without dispatch')
  check(cancelLimiter.tryBeforeCall(),'post-admission cancellation releases in-flight guard')
  cancelLimiter.afterReservedCall(0)
  cancelMode='waiting'; runtime.setOptions({rpm:1})
  check(command('/decide '+stringify(payload)).status==='completed','first request reserves RPM')
  callsBeforeCancel=calls.length
  var waitReceipt=advanced.request({uuid:'decide',action:'command',command:'/decide '+stringify(payload),requestId:'decide-'+(++sequence)})
  check(waitReceipt.accepted,'waiting request accepted')
  var waitingWork=jobs.shift(), waitDone=new java.util.concurrent.CountDownLatch(1), waitError
  $doV(function(){try {waitingWork()} catch(e) {waitError=e} finally {waitDone.countDown()}})
  try {
    var untilWaiting=now()+5000
    while (!waiting && now()<untilWaiting) sleep(10,true)
    check(waiting,'second request reaches rate-limit wait')
  } finally {
    advanced.request({uuid:'decide',action:'stop'})
    check(waitDone.await(5,java.util.concurrent.TimeUnit.SECONDS),'rate-limit wait stops promptly')
  }
  check(isUnDef(waitError) && calls.length===callsBeforeCancel && releases===2,'cancelled wait neither dispatches nor releases an unreserved call')
  var cancelledResult=advanced.result(state,advanced.results(state,'decide',0,1).results[0].sequence).value
  check(cancelledResult.status==='cancelled','waiting command records cancellation')
  MiniA.prototype._createRateLimiter=originalLimiter
  check(runtime.agent()===agent && agentMetrics.decisions.calls===3, 'active agent preserved')
  runtime.setOptions({modeldec:'broken'})
  check(command('/decide '+stringify(payload)).blocks[0].value.error==='MINI_A_DECISION_INVALID_CONFIG','invalid configuration')
  runtime.setOptions({modeldec:'',usedecide:true})
  var originalConfigured = MiniADecision.prototype.isConfigured
  MiniADecision.prototype.isConfigured = function() { return false }
  check(command('/decide '+stringify(payload)).status==='failed', 'missing configuration')
  MiniADecision.prototype.isConfigured = originalConfigured
  print('PASS /decide dispatch, JSON/SLON, model precedence, debug channel, validation, stats, errors and conversation preservation')
} finally {
  if (originalClient) MiniADecision.prototype._client=originalClient
  if (originalLimiter) MiniA.prototype._createRateLimiter=originalLimiter
  if (originalConfigured) MiniADecision.prototype.isConfigured=originalConfigured
  __gHDir=originalHome
  try { advanced.get('decide').runtime.dispose() } catch(ignore) {}
  try { $ch('decide_test_debug').destroy() } catch(ignore) {}
  io.rm(testRoot)
}
