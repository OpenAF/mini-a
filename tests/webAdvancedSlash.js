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
  var advanced = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false})
  advanced.schedule = function(fn) { jobs.push(fn); return {catch:function(){}} }
  var state = advanced.get('slash'), runtime = state.runtime, request = 0
  function command(text) {
    var receipt = advanced.request({uuid:'slash',action:'command',command:text,requestId:'slash-' + (++request)})
    check(receipt.accepted, 'accepted ' + text)
    jobs.shift()()
    var page = advanced.request({uuid:'slash',action:'results',view:receipt.view.name,limit:1})
    var record = advanced.request({uuid:'slash',action:'result',sequence:page.results[0].sequence})
    check(record.runId === receipt.requestId, 'result request ID ' + text)
    check(advanced.events(state,state.sequence-1,1)[0].runId === receipt.requestId, 'completion request ID ' + text)
    return {view:receipt.view,result:record.value,record:record}
  }
  var metadata=runtime.commandMetadata()
  runtime.commands().forEach(function(name){check(metadata.some(function(m){return m.name===name && m.destination}), 'destination '+name)})
  check(command('/help').result.blocks[0].type==='help','structured help')
  var resetPath=runtime.options().conversation
  check(command('/reset').result.status==='completed' && runtime.options().conversation===resetPath,'reset preserves session path')
  check(command('/show wiki').view.params.filter==='wiki','settings prefix')
  check(command('/model lc').view.params.slot==='modellc','model slot')
  check(command('/model bad').result.status==='failed','invalid model slot')
  check(command('/debug calls').view.params.filter==='calls','debug filter')
  check(command('/debug bad').result.status==='failed','invalid debug filter')
  check(command('/set useshell true').result.status==='completed' && runtime.options().useshell===true,'setting mutation')
  check(command('/set onport 1').result.status==='failed','server restriction visible')
  check(command('/set useshell invalid').result.status==='failed','invalid setting visible')
  command('/set secpass NAVIGATION-SECRET\nSECOND-LINE-SECRET')
  check(io.readFileString(state.file).indexOf('NAVIGATION-SECRET')<0 && stringify(advanced.snapshot(state,0)).indexOf('NAVIGATION-SECRET')<0,'navigation receipts and snapshots mask credentials')
  check(io.readFileString(state.journal).indexOf('SECOND-LINE-SECRET')<0,'multiline credentials are masked in command events and results')
  var before=runtime.options().conversation
  check(command('/restore').result.blocks[0].value.picker===true && runtime.options().conversation===before && !state.pending,'restore only opens picker')
  runtime.sync(__,'Prior goal','# Answer\n\n**bold**')
  check(command('/last md').result.blocks[0].value.answer==='# Answer\n\n**bold**','raw answer preserved')
  runtime.sync(__,'JSON goal','{\n  \"answer\": \"literal JSON\"\n}\n')
  check(command('/last md').result.blocks[0].value.answer === '{\n  \"answer\": \"literal JSON\"\n}\n','raw JSON remains a string with exact spacing')
  runtime.sync(__,'Prior goal','# Answer\n\n**bold**')
  var save=command('/save "'+testRoot+'/answer.md"')
  check(save.result.blocks[0].value.destination===testRoot+'/answer.md' && io.readFileString(testRoot+'/answer.md')==='# Answer\n\n**bold**','server save outcome')
  command('/clear')
  check(!command('/last').result.blocks.length,'clear invalidates previous answer')
  // Structured wiki data comes from the original subsystem call, including partial coverage.
  var written, wiki={
    read:function(path){return {body:'# '+path+'\n\n<script>unsafe()</script>',meta:{title:'Fixture'}}},
    write:function(path,body){written={path:path,body:body};return {ok:true,path:path}},
    list:function(){return ['a.md','@team/index.md']},
    search:function(){var hits=[{path:'a.md',snippet:'match'}];hits.outcome='partial';hits.sources=[{id:'team'}];return hits},
    graph:function(op,params){return op==='export' ? 'graph TD; A-->B' : {op:op,params:params}},
    lint:function(){return {summary:{errors:1},issues:[{page:'a.md',severity:'error',type:'broken-link'}]}}
  }
  var agent={_wikiManager:wiki,getMetrics:function(){return {goals:{achieved:2}}}}
  global.__conversations.slash=agent;runtime.sync(agent)
  runtime.setOptions({usewiki:true,wikiaccess:'rw'})
  check(command('/wiki list').result.blocks[0].type==='pages','native wiki list')
  check(command('/wiki read "a page.md"').result.blocks[0].value.indexOf('a page.md')>=0,'wiki path preserved')
  var search=command('/wiki search test').result
  check(search.status==='partial' && search.blocks[0].value.sources[0].id==='team','partial coverage preserved')
  command('/wiki write "a page.md"  leading\nbody\n\n')
  check(written.path==='a page.md' && written.body===' leading\nbody\n\n','wiki content preserved exactly')
  command('/wiki write spaces.md   ')
  check(written.body==='  ','supplied whitespace content is not treated as missing')
  check(command('/wiki lint').result.blocks[0].value.issues[0].severity==='error','lint issues')
  check(command('/graph export mermaid').result.blocks[0].value==='graph TD; A-->B','graph export raw')
  var exported=testRoot+'/metrics.json'
  check(command('/stats detailed tools out="'+exported+'"').result.blocks.some(function(b){return b.value.destination===exported}),'stats combinations and server export')
  check(io.fileExists(exported),'stats export exists')
  var conversation=[{role:'user',content:'First goal'}, {role:'assistant',content:'First answer'}, {role:'user',content:'Second goal'}, {role:'assistant',content:'Second answer'}]
  var cancelledTasks=[]
  agent.llm={getGPT:function(){return {getConversation:function(){return conversation},setConversation:function(value){conversation=value}}}}
  agent.summarizeText=function(){return '# Summary\n\n- Fixture summary'}
  agent.getHistoryVmDiagnostics=function(){return {active:true,states:{hot:2}}}
  agent._subtaskManager={list:function(){return [{id:'child',status:'running'}]},cancel:function(id){cancelledTasks.push(id);return true}}
  runtime.sync(agent,'Second goal','Second answer')
  check(command('/history 1').result.blocks[0].value.goals[0]==='Second goal','history count')
  check(command('/context vm').result.blocks[0].value.states.hot===2,'VM diagnostics')
  check(command('/rewind 1').result.blocks[0].value.exchanges===1 && cancelledTasks[0]==='child','rewind count and subtask cancellation')
  check(global.__res.slash.length===2 && global.__res.slash[1].message==='First answer','rewind refreshes transcript')
  check(command('/last').result.blocks[0].value.answer==='First answer','rewind refreshes previous answer')
  conversation=[{role:'user',content:'a'},{role:'assistant',content:'b'},{role:'user',content:'c'},{role:'assistant',content:'d'}]
  check(command('/summarize 1').result.blocks.some(function(b){return b.type==='markdown' && b.value.indexOf('# Summary')===0}),'readable generated summary')
  check(command('/compact 1').result.blocks.some(function(b){return b.type==='context'}),'compact refreshed measurements')
  runtime.setOptions({wikiaccess:'ro'})
  check(command('/wiki write denied.md text').result.status==='failed','read only outcome')
  var page1=advanced.request({uuid:'slash',action:'results',view:'wiki',limit:2})
  var page2=advanced.request({uuid:'slash',action:'results',view:'wiki',limit:2,before:page1.before})
  check(page1.results.length===2 && page2.results.length===2 && page2.results[0].sequence<page1.results[1].sequence,'result pagination')
  check(advanced.request({uuid:'other',action:'results',view:'wiki'}).results.length===0,'session isolation')
  var recovered=new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false}).get('slash')
  check(advanced.results(recovered,'wiki',0,2).results[0].sequence===page1.results[0].sequence,'reconnect results')
  check(jobs.length===0,'reconnect does not rerun commands')
  var legacy=advanced.get('legacy-output');legacy.operation='old-request'
  advanced.emit(legacy,'command','/context');advanced.emit(legacy,'output','Legacy context text');advanced.emit(legacy,'complete',{});legacy.operation=null
  var legacyRows=advanced.results(legacy,'context',0,20)
  check(legacyRows.results[0].legacy===true && advanced.result(legacy,legacyRows.results[0].sequence).value.messages[0].value==='Legacy context text','legacy grouped fallback')
  var dialogCalls=[], dialogResult, goalFromEditor, dialogAnswer='Edited goal', editorWrites=[]
  var editorRuntime=MiniAInteractiveSession({homedir:testRoot,usehistory:false,usewiki:true,wikiaccess:'rw'}, {
    print:function(){},error:function(){},event:function(){},view:function(){},validateOption:function(){},
    ask:function(type,label,choices,value){dialogCalls.push({type:type,value:value});return dialogAnswer},
    goal:function(goal){goalFromEditor=goal;return true},commandResult:function(result){dialogResult=result}
  })
  editorRuntime.sync({_wikiManager:{write:function(path,body){editorWrites.push(body);return {ok:true}}}},'Original goal','Previous answer')
  editorRuntime.execute('/editor last')
  check(dialogCalls[0].type==='editor' && dialogCalls[0].value==='Original goal' && goalFromEditor==='Edited goal','editor prefill and normal goal flow')
  goalFromEditor=null;dialogAnswer=__
  editorRuntime.execute('/edit')
  check(goalFromEditor===null,'editor cancellation does not submit')
  dialogAnswer='# Page\n\nbody\n'
  editorRuntime.execute('/wiki write page.md')
  check(dialogCalls[2].type==='wiki-editor' && editorWrites[0]===dialogAnswer,'wiki missing content opens multiline editor')
  editorRuntime.dispose()
  check(command('/quit').view.name==='history' && state.closed,'close session')
  recovered.runtime.dispose();legacy.runtime.dispose()
  print('Advanced slash routing, structured results, persistence and permissions passed')
} catch(e) { printErr(e); if (e.stack) printErr(e.stack); exit(1) } finally { __gHDir=originalHome;io.rm(testRoot) }
