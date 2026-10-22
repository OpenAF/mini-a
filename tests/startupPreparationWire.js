// Real loopback MCP and OpenAI-compatible HTTP endpoints. No external providers.
// Run: oaf -f tests/startupPreparationWire.js
load('mini-a.js')
ow.loadServer()
function check(value, message) { if (!value) throw new Error(message) }
var server = ow.server.httpd.start(__, '127.0.0.1'), agents = []
var handshakes = [], catalogs = [], requests = [], revision = 'before', failNextCatalog = false
function reply(result, id) { return ow.server.httpd.reply({jsonrpc:'2.0',id:id,result:result}, 200, 'application/json', {}) }
var complete = function(req) {
  requests.push({at:now(),body:jsonParse(req.files.postData)})
  return ow.server.httpd.reply({id:'fixture',object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content:'Fixture answer'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}},200,'application/json',{})
}
ow.server.httpd.route(server, {
  '/mcp': function(req) {
    if (req.method === 'DELETE') return ow.server.httpd.reply('',204,'text/plain',{})
    var rpc = jsonParse(req.files && req.files.postData || req.data)
    if (isUnDef(rpc.id)) return ow.server.httpd.reply('',202,'text/plain',{})
    if (rpc.method === 'initialize') {
      handshakes.push(now()); sleep(500, true)
      return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'startup-fixture',version:'1'}},rpc.id)
    }
    if (rpc.method === 'tools/list') {
      if (failNextCatalog) {
        failNextCatalog = false
        return ow.server.httpd.reply({jsonrpc:'2.0',id:rpc.id,error:{code:-32000,message:'session expired'}},200,'application/json',{})
      }
      catalogs.push({at:now(),revision:revision})
      return reply({tools:[{name:'echo',description:'Echo '+revision,inputSchema:{type:'object',properties:{text:{type:'string'}}}}]},rpc.id)
    }
    return reply({},rpc.id)
  },
  '/v1/chat/completions': complete,
  '/chat/completions': complete
})
try {
  var url = 'http://127.0.0.1:' + server.getPort()
  var options = {model:stringify({type:'openai',model:'fixture',key:'fixture',url:url}),
    mcp:stringify({type:'remote',url:url+'/mcp',timeout:5000}),
    chatbotmode:true, usetools:true, usememory:false, usedecide:false, usestream:false, useutils:false,
    goal:'Say fixture answer', format:'md', __interaction_source:'mini-a-web'}
  var cold = new MiniA(); agents.push(cold); cold.fnI = function() {}
  var coldSubmitted = now()
  cold.start(merge(options,{__startupSubmittedAt:coldSubmitted}))
  check(requests.length === 1,'Cold run reaches the model endpoint once')
  var coldWireMs = requests[0].at - coldSubmitted
  var warm = new MiniA(); agents.push(warm); warm.fnI = function() {}
  warm.prepareSession(options)
  warm._startupEntries.forEach(function(entry) { check(warm._awaitStartupEntry(entry),'Remote MCP preparation succeeds') })
  check(handshakes.length === 2,'Both agents perform one handshake')
  check(requests.length === 1,'Preparation sends no model request')
  revision = 'after'
  var warmSubmitted = now()
  warm.start(merge(options,{__startupSubmittedAt:warmSubmitted}))
  check(requests.length === 2,'Warm run reaches the model endpoint once')
  check(handshakes.length === 2,'Warm submission reuses the negotiated transport')
  check(catalogs[catalogs.length-1].revision === 'after','Submission fetches the changed catalog')
  check(warm.getStartupTimings().mcp_reused === 1,'Remote reuse is reported')
  check(cold._systemInst === warm._systemInst,'Cold and prepared system instructions match')
  check(warm.getStartupTimings().first_provider_role === 'main','Real model dispatch is timed')
  print(stringify({cold_submit_to_model_receipt_ms:coldWireMs,warm_submit_to_model_receipt_ms:requests[1].at-warmSubmitted,simulated_mcp_handshake_ms:500,warm_startup:warm.getStartupTimings()}))
  var proxy = new MiniA(); agents.push(proxy); proxy.fnI = function() {}
  var proxyOptions = merge(options,{mcpproxy:true})
  proxy.prepareSession(proxyOptions)
  proxy._startupEntries.forEach(function(entry) { check(proxy._awaitStartupEntry(entry),'Proxy remote preparation succeeds') })
  var beforeProxyHandshake = handshakes.length
  proxy.start(merge(proxyOptions,{__startupSubmittedAt:now()}))
  check(handshakes.length === beforeProxyHandshake,'Proxy adopts the prepared downstream transport')
  check(proxy.getStartupTimings().mcp_reused === 1,'Proxy remote reuse is reported')
  check(proxy.mcpToolNames.indexOf('proxy-dispatch') >= 0,'Proxy dispatch remains available')
  var expired = new MiniA(); agents.push(expired); expired.fnI = function() {}
  expired.prepareSession(options)
  expired._startupEntries.forEach(function(entry) { check(expired._awaitStartupEntry(entry),'Expired-session fixture prepares') })
  var beforeReconnect = handshakes.length
  failNextCatalog = true
  expired.start(merge(options,{__startupSubmittedAt:now()}))
  check(handshakes.length === beforeReconnect+1,'An expired prepared connection renegotiates once')
  check(expired.getStartupTimings().mcp_reused === 0,'Failed adoption does not count as successful reuse')
  print('Loopback startup transport checks passed (direct, proxy and expired-session fallback).')
} finally {
  agents.forEach(function(agent) { agent._stopAgentResources() })
  ow.server.httpd.stop(server)
}
