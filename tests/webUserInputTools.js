// Tool exposure and real dummy-MCP dispatch, without model requests.
// Run: oaf -f tests/webUserInputTools.js
load('mini-a.js')
function check(value, message) { if (!value) throw new Error(message) }
var agent = new MiniA()
agent.fnI = function() {}
try {
  var web = {useutils:true,__interaction_source:'mini-a-web'}
  var simple = agent._createUtilsMcpConfig(web)
  check(!simple.options.fns.userInput, 'Simple web hides userInput')
  var simpleStd = agent._createUtilsMcpConfig(merge(web,{usestdutils:true}))
  check(!simpleStd.options.fns.question, 'Simple web hides question alias')
  check(agent._shouldIncludeNoUserInteractionRemark(web), 'Simple web retains noninteractive directive')
  var requests=[], replies=[['fixture reply'],[1,'explanation']]
  agent.setUserInputFn(function(request) { requests.push(request); return replies.shift() })
  check(!agent._shouldIncludeNoUserInteractionRemark(web),'Advanced adapter removes noninteractive directive')
  check(!agent._supportsUserInput(merge(web,{useutils:false})),'useutils=false disables browser input')
  var legacy = agent._createUtilsMcpConfig(web)
  check(!!legacy.options.fns.userInput && !legacy.options.fns.showMessage, 'Advanced enables input independently of display')
  var result=legacy.options.fns.userInput({prompt:'Fixture?'})
  check(jsonParse(result.content[0].text).answer==='fixture reply','Real userInput dispatch uses browser adapter')
  var standard=agent._createUtilsMcpConfig(merge(web,{usestdutils:true}))
  check(!!standard.options.fns.question && !standard.options.fns.userInput,'Standard catalog exposes question')
  var question=standard.options.fns.question({questions:[{header:'pick',question:'Pick',options:[{label:'a'},{label:'b'}]},{header:'why',question:'Why?'}]})
  check(jsonParse(question.content[0].text).answers.pick==='b','Real question dispatch resolves choices')
  check(jsonParse(question.content[0].text).answers.why==='explanation','Real question dispatch resolves free text')
  var denied=agent._createUtilsMcpConfig(merge(web,{utilsdeny:'userInput'}))
  check(!denied.options.fns.userInput,'Input respects denylist')
  var console=agent._createUtilsMcpConfig({useutils:true,__interaction_source:'mini-a-con'})
  check(!!console.options.fns.userInput && !!console.options.fns.showMessage,'Console tools preserved')
  var cacheReads=0, calls=0
  agent._mcpConnections.fixture={callTool:function(){calls++;return {content:[{type:'text',text:'reply'}]}}}
  agent._toolCacheSettings.userInput={enabled:true};agent._toolCacheSettings.question={enabled:true};agent._toolCacheSettings['proxy-dispatch']={enabled:true}
  agent._getToolResultFromCache=function(){cacheReads++;return {hit:true,value:'cached'}}
  agent._logToolUsage=function(){};agent._ensureConnectionInitialized=function(){};agent._recordCircuitSuccess=function(){}
  agent._executeToolWithCache('fixture','userInput',{prompt:'Repeat'})
  agent._executeToolWithCache('fixture','userInput',{prompt:'Repeat'})
  agent._executeToolWithCache('fixture','question',{questions:[]})
  agent._executeToolWithCache('fixture','proxy-dispatch',{action:'call',tool:'question',arguments:{questions:[]}})
  check(calls===4 && cacheReads===0,'Input calls bypass direct and proxy caches: calls=' + calls + ' cacheReads=' + cacheReads)
  agent.setUserInputFn(__)
  check(!agent._supportsUserInput(web),'Detached browser loses input capability')
  print('Web input tool exposure and dispatch checks passed')
} catch(e) { printErr(e); exit(1) }
