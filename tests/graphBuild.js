// Deterministic acceptance. No configured provider is used by this suite.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-graph.js")
var checked = 0
function assert(value, message) { if (!value) throw new Error(message); checked++ }
function page(path, body, meta) { return { path: path, body: body, revision: sha1(body), meta: meta || {title:path}, links:[] } }
var root = String(java.nio.file.Files.createTempDirectory("graph-build-").toFile().getCanonicalPath())
function graph(name, config) { return new MiniAWikiGraph(merge({ graphDir:root+"/"+name, modelExtractors:[] }, config || {})) }
var semantic = { extraction:"semantic", modelHelp:"off" }
try {
  assert(MiniAGraphBuild.resolve({semantic:true}).modelHelp === "auto", "legacy mapping")
  assert(MiniAGraphBuild.resolve({semantic:false}, {extraction:"semantic",modelHelp:"auto"}).extraction === "structural", "explicit false wins")
  assert(MiniAGraphBuild.resolve({}, {maxCalls:7}).maxCalls === 7, "saved defaults")
  assert(MiniAGraphBuild.resolve({maxCalls:3}, {maxCalls:7}).maxCalls === 3, "run override")
  assert(MiniAGraphBuild.resolve({preset:"reset"}, {maxCalls:7}).maxCalls === 100, "reset")
  ;[{maxCalls:0},{maxCalls:1.5},{maxTokens:Infinity},{maxMinutes:-1},{strategy:"resume",force:true,extraction:"semantic"},{strategy:"resume"},{extraction:"no"},{modelHelp:"yes"}].forEach(function(options) {var rejected=false;try{MiniAGraphBuild.resolve(options)}catch(e){rejected=true}assert(rejected,"invalid options rejected: "+stringify(options))})
  assert(!MiniAGraphBuild.preferences({extraction:"semantic",strategy:"resume"}).strategy, "resume never saved")
  assert(MiniAGraphBuild.fingerprint({model:"x",key:"secret1"}) === MiniAGraphBuild.fingerprint({model:"x",key:"secret2"}), "fingerprints exclude credentials")
  var calls=0, g=graph("foundation",{modelExtractors:[{role:"main",extract:function(){calls++;return{relationships:[]}}}]})
  var pages=[page("a.md","# Alpha\nTLS and `Node.js` use C++.\n"+new Array(100).join("## Extra\nPlain prose.\n")+"## Late\nECONNREFUSED uses conn.ReceiveFunc.",{title:"Alpha",tags:["network"]}),page("b.md","# Beta\nTLS works with Node.js and conn.ReceiveFunc.",{title:"Beta"})]
  assert(g.build(pages,{extraction:"structural",modelHelp:"auto"}).calls===0 && calls===0,"structural is zero call")
  var stages=[];g.build(pages,{extraction:"structural",onProgress:function(p){stages.push(p.stage)}})
  assert(stages[0]==="structural"&&stages[stages.length-1]==="complete","structural progress reports stages")
  g.build(pages,semantic);assert(calls===0,"semantic off zero calls")
  var mentions=g._state.edges.filter(function(e){return e.type==="MENTIONS"})
  assert(mentions.some(function(e){return e.to==="concept:id:ECONNREFUSED"}),"late section evidence")
  assert(mentions.some(function(e){return e.to==="concept:id:Node.js"})&&mentions.some(function(e){return e.to==="concept:id:C++"}),"punctuation preserved")
  mentions.forEach(function(e){var p=pages.filter(function(x){return x.path===e.props.page})[0];assert(p.body.substring(e.props.evidence.start,e.props.evidence.end)===e.props.evidence.quote,"evidence offsets")})
  var count=mentions.length;g.build(pages,semantic);assert(g._state.edges.filter(function(e){return e.type==="MENTIONS"}).length===count,"idempotent")
  var candidates=g.expansionCandidates("a.md",{cap:5,budget:{used:0,limit:256},deadline:Date.now()+1000})
  assert(candidates[0].path==="b.md"&&candidates[0].evidenceLayer==="grounded"&&!!candidates[0].supports[0].evidence,"rank and explanation")
  var result=g.retrieve("conn.ReceiveFunc",{cap:10,maxEdges:20});assert(result.pages.length===2&&result.work.edges<=20&&result.pages[0].references.length>0,"retrieval references and work cap")
  var tags=g.tagSuggestions("a.md",["network"],["tls"]);assert(tags.additions.length<=5&&tags.additions[0].tag==="tls","tag vocabulary preference")
  assert(tags.additions.every(function(t){return t.tag!=="network"}),"tags do not justify tags")
  var legacy={from:"concept:id:Node.js",to:"concept:id:Legacy",type:"RELATED_TO",provenance:"EXTRACTED",props:{page:"b.md",revision:pages[1].revision}}
  g._upsertNode(legacy.to,"concept",{name:"Legacy"});g._addEdge(legacy.from,legacy.to,legacy.type,legacy.provenance,legacy.props)
  assert(!g._currentEvidence(legacy),"legacy not verified")
  var scope=graph("scope"), homonyms=[page("one.md","Mercury",{title:"Mercury"}),page("two.md","Mercury",{title:"Mercury"}),page("use.md","Mercury and mercury are ambiguous.",{title:"Consumer"})]
  scope.build(homonyms,semantic);assert(!scope._state.edges.some(function(e){return e.type==="MENTIONS"&&e.props.page==="use.md"}),"ambiguous homonyms not merged")
  var acronyms=[page("transport.md","Transport layer security",{title:"Transport",aliases:["TLS"]}),page("thread.md","Thread local storage",{title:"Thread",aliases:["TLS"]}),page("consumer.md","TLS is ambiguous.",{title:"Consumer"})]
  scope.build(acronyms,semantic);assert(!scope._state.edges.some(function(e){return e.type==="MENTIONS"&&e.props.page==="consumer.md"}),"ambiguous technical aliases never collapse to identifier identity")
  g.buildStructural(pages);assert(g._state.edges.filter(function(e){return e.type==="MENTIONS"}).length===count,"full structural retains valid enrichment")
  pages[0]=page("a.md","# Alpha\nDifferent body.",{title:"Alpha"});g.build(pages,{extraction:"structural"})
  assert(!g._state.edges.some(function(e){return e.type==="MENTIONS"&&e.props.page==="a.md"}),"edited evidence invalidated")
  g.build([pages[0]],{extraction:"structural"});assert(!g._state.enrichment["b.md"],"deletion clears pending and evidence")
  var stub=function(payload){calls++;return {relationships:[]}}, modelPages=[page("one.md","TLS uses HTTP."),page("two.md","TLS uses HTTPS."),page("three.md","TCP supports TLS.")]
  var models=[{role:"lc",fingerprint:"stub1",extract:stub}], m=graph("models",{modelExtractors:models});calls=0
  var partial=m.build(modelPages,{extraction:"semantic",modelHelp:"auto",maxCalls:1})
  assert(calls===1&&partial.pending===2&&partial.resumable,"call budget partial")
  m=graph("models",{modelExtractors:models});var resumed=m.build(modelPages,{extraction:"semantic",modelHelp:"auto",strategy:"resume"})
  assert(calls===3&&resumed.pending===0&&resumed.cached===1,"resume after restart only missing work")
  assert(m.build(modelPages,{extraction:"semantic",modelHelp:"auto",strategy:"full"}).calls===0,"full retains valid cache")
  assert(m.build(modelPages,{extraction:"semantic",modelHelp:"auto",force:true}).calls===3,"force bypasses cache")
  assert(m.build(modelPages,{extraction:"semantic",modelHelp:"auto",force:true,maxTokens:1}).calls===0,"token cap before call")
  var cancelled=m.build(modelPages,{extraction:"semantic",modelHelp:"auto",force:true,isCancelled:function(){return true}})
  assert(cancelled.calls===0&&cancelled.status==="cancelled","cancel schedules no calls")
  var clock=Date.now;try{var tick=0;Date.now=function(){return ++tick*1000};assert(m.build(modelPages,{extraction:"semantic",modelHelp:"auto",force:true,maxMinutes:0.001}).calls===0,"elapsed budget")}finally{Date.now=clock}
  var fail=false, f=graph("failure",{modelExtractors:[{role:"main",fingerprint:"x",extract:function(){if(fail)return {bad:true};return {relationships:[{from:"TLS",to:"HTTP",type:"USES",provenance:"EXTRACTED",confidence:0.9,evidence:{quote:"TLS uses HTTP"}}]}}}]})
  f.build([modelPages[0]],{extraction:"semantic",modelHelp:"auto"});var supported=f._state.edges.filter(function(e){return e.props.method==="model"});assert(supported.length===1,"valid extraction")
  fail=true;var failure=f.build([modelPages[0]],{extraction:"semantic",modelHelp:"auto",force:true})
  assert(failure.failed===1&&f._state.edges.filter(function(e){return e.props.method==="model"}).length===1,"malformed refresh preserves unchanged-source result")
  var reloaded=graph("failure");assert(reloaded._state.edges.filter(function(e){return e.props.method==="model"}).length===1,"checkpoint persistence")
  var fallback=graph("fallback",{modelExtractors:[{role:"lc",extract:function(){throw "failed"}},{role:"main",extract:function(){return{relationships:[]}}}]})
  assert(fallback.build([modelPages[0]],{extraction:"semantic",modelHelp:"auto"}).calls===2,"LC main escalation counted")
  var decision=graph("decision",{modelExtractors:models,decisionExtractor:{fingerprint:"decision",extract:function(){return {paths:[]}}}})
  assert(decision.build(modelPages,{extraction:"semantic",modelHelp:"auto",maxCalls:1}).calls===1,"decision calls consume shared budget")
  var changedInput=graph("dependencies",{modelExtractors:models}), sourcePair=[page("origin.md","TLS connects sockets."),page("peer.md","TLS protects TCP.")]
  changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto"})
  sourcePair[1]=page("peer.md","TLS protects HTTP.")
  assert(changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto",strategy:"resume"}).calls===2,"indexed cross-page input changes invalidate dependent cache")
  changedInput._cfg.modelExtractors=[{role:"lc",fingerprint:"stub2",extract:stub}]
  assert(changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto"}).calls===2,"model fingerprint invalidates caches")
  var retry=graph("malformed-fallback",{modelExtractors:[{role:"lc",extract:function(){return {relationships:[{from:"TLS",to:"HTTP",evidence:{quote:"invented"}}]}}},{role:"main",extract:function(){return {relationships:[]}}}]})
  var retried=retry.build([modelPages[0]],{extraction:"semantic",modelHelp:"auto"})
  assert(retried.calls===2&&retried.pending===0,"malformed evidence escalates and valid empty completes")
  var unavailable=graph("unavailable").build(modelPages,{extraction:"semantic",modelHelp:"auto"})
  assert(unavailable.calls===0&&unavailable.pending===3,"unavailable models retain deterministic graph and pending enrichment")
  var edge=supported[0];assert(f.path(edge.to,edge.from,{direction:"out",type:"USES"}).length===0,"path direction")
  assert(f.path(edge.from,edge.to,{direction:"out",type:"USES",evidenceLayer:"grounded",minConfidence:0.95}).length===0,"path confidence")
  assert(f.path(edge.from,edge.to,{direction:"out",type:"USES",evidenceLayer:"grounded",minConfidence:0.8}).length===2,"path evidence filters")
  var queries=[];f._falkorLink({query:function(q){queries.push(q)}},edge);assert(queries[0].indexOf('"quote"')>=0&&queries[0].indexOf("evidenceKey")>=0,"Falkor nested evidence encoding")
  print("PASS graph build acceptance: "+checked+" assertions")
} finally { io.rm(root) }
