// Real OpenAF configuration, prompt refresh and Advanced expansion; no model calls.
load("mini-a.js")
loadLib(__miniAPath("js/web/mini-a-web-embed.js"))
function check(value, message) { if (!value) throw new Error(message) }
function rejects(fn, message) { var failed = false; try { fn() } catch(e) { failed = true }; check(failed, message) }
var file = String(java.nio.file.Files.createTempFile("mini-a-embed-", ".txt").toAbsolutePath())
var agent
try {
  var config = MiniAWebEmbed.init({webembed:true,webembedorigins:'https://APP.example:443,http://localhost:1234',webembedfields:'(customerId: (type: string, required: true))'})
  check(config.origins[0] === 'https://app.example' && config.origins[1] === 'http://localhost:1234', 'normalize origins with real JVM URI parsing')
  ;['*','null','https://app.example/','https://app.example/path','https://user:pass@app.example','https://app.example#x','https://app.example?x','https://*.example','https://app.example;evil','https://app.example:99999'].forEach(function(origin) {
    rejects(function() { MiniAWebEmbed.init({webembed:true,webembedorigins:origin,webembedcontextrequired:false}) }, 'reject invalid origin ' + origin)
  })
  rejects(function(){MiniAWebEmbed.init({webembed:true,webembedorigins:'https://app.example'})}, 'required context needs fields')
  config = MiniAWebEmbed.init({webembed:true,webembedorigins:'https://app.example',webembedcontextrequired:false,webembedprompt:true})
  var response = MiniAWebEmbed.protectResponse({mimetype:'text/html',header:{'Content-Security-Policy':"default-src 'self'",'X-Test':'retained'}})
  check(response.header['Content-Security-Policy'] === "default-src 'self', frame-ancestors https://app.example", 'CSP policies intersect')
  check(response.header['X-Test'] === 'retained', 'preserve other headers')
  check(!MiniAWebEmbed.protectResponse({mimetype:'text/javascript',header:{}}).header['Content-Security-Policy'], 'assets unchanged')
  check(MiniAWebEmbed.validate({embed:{version:1,revision:0,context:null}}).context === null, 'prompt-only configuration')
  MiniAWebEmbed.init({webembed:false})
  rejects(function(){MiniAWebEmbed.validate({embed:{version:1,revision:0,context:null}})}, 'disabled server rejects envelope')
  io.writeFileString(file, 'EXISTING_CONFIGURED_KNOWLEDGE')
  ;[false, true].forEach(function(chatbot) {
    agent = new MiniA(); agent.fnI = function() {}; agent._trace = function() {}
    var args = {goal:'fixture',model:'(type: ollama, model: fixture, url: "http://127.0.0.1:1")',
      useshell:false,usetools:false,useutils:false,usememory:false,usedelegation:false,useplanning:false,
      usedecide:false,llmcomplexity:false,noagentsmd:true,useskills:false,chatbotmode:chatbot,knowledge:file,
      _webEmbedContext:{customerId:'@' + file,selectedIds:['{{goal}}','<script>unsafe</script>']}}
    agent.init(args)
    check(agent._systemInst.indexOf('EXISTING_CONFIGURED_KNOWLEDGE') >= 0, 'existing knowledge file still loads')
    check(agent._systemInst.indexOf('"customerId":"@' + file + '"') >= 0, 'context file references stay literal')
    check(agent._systemInst.indexOf('{{goal}}') >= 0, 'context is not recursively templated')
    check(agent._systemInst.indexOf('\\u003cscript\\u003e') >= 0, 'markup stays JSON data')
    check(agent._systemInst.split('BEGIN_UNTRUSTED_EMBED_CONTEXT').length === 2, 'one current context block')
    agent.init(merge(args,{_webEmbedContext:{customerId:'LATEST_RECORD'},promptprofile:'minimal',contextvirtualization:true}))
    check(agent._systemInst.indexOf('LATEST_RECORD') >= 0 && agent._systemInst.indexOf('"customerId":"@') < 0, 'refresh replaces data under minimal profile')
    __miniAEnsureOptionalLibrary('history')
    var historyVm = new MiniAHistoryVM({enabled:true,contextVirtualization:true,conversationPath:file + '.json',conversationId:'embed-fixture',sessionId:'embed-session'})
    try {
      var conversation = [{role:'system',content:agent._systemInst},{role:'user',content:'Earlier fixture question'},{role:'assistant',content:'Earlier fixture answer'}]
      var gpt = {getConversation:function(){return conversation},setConversation:function(value){conversation=value}}
      var fakeLlm = {getGPT:function(){return gpt}}
      agent._historyVm = historyVm
      agent._sessionArgs = merge(args,{_webEmbedContext:{customerId:'LATEST_RECORD'}})
      agent._getEffectiveContextBudget = function(){return 16000}
      agent._getExplicitContextBudget = function(){return 16000}
      agent._projectContextInvocation(fakeLlm,'Answer the current goal','executor',{})
      check(stringify(conversation).indexOf('LATEST_RECORD') >= 0, 'context virtualization retains protected current parameters')
      agent._getEffectiveContextBudget = function(){return 1}
      agent._getExplicitContextBudget = function(){return 1}
      rejects(function(){agent._projectContextInvocation(fakeLlm,'Answer the current goal','executor',{})}, 'context projection reports impossible budgets')
    } finally { historyVm.deleteOwnedStore(); agent._historyVm = __ }
    var standalone = merge(args,{}); delete standalone._webEmbedContext
    agent.init(standalone)
    check(agent._systemInst.indexOf('BEGIN_UNTRUSTED_EMBED_CONTEXT') < 0, 'standalone does not inherit initial snapshot')
    rejects(function(){agent.init(merge(args,{systempromptbudget:10}))}, 'insufficient budget fails rather than dropping context')
    agent._stopAgentResources(); agent = null
  })
  loadLib(__miniAPath('js/core/mini-a-subtask.js'))
  var child = {_webEmbedContext:{customerId:'PRIVATE_PARENT'},webembed:true,goal:'explicit child task'}
  SubtaskManager.prototype._stripInheritedParentOnlyArgs(child,{})
  check(isUnDef(child._webEmbedContext) && isUnDef(child.webembed) && child.goal === 'explicit child task', 'delegation strips private parent context and server configuration')
  print('OpenAF embedding configuration, framing and actual prompt refresh checks passed')
} catch(e) { printErr(e); exit(1) } finally { if (agent) agent._stopAgentResources(); io.rm(file) }
