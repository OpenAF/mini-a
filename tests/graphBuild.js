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
  var batchGraph = graph("batch-derived"), referenceGraph = graph("reference-derived")
  var batchPages = [page("one.md", "# One\nAlpha", {title:"One", tags:["shared"]}), page("two.md", "# Two\nBeta", {title:"Two", tags:["shared"]}), page("old.md", "# Old\nRemove me")]
  batchGraph.build(batchPages, {extraction:"structural"}); referenceGraph.build(batchPages, {extraction:"structural"})
  batchPages = [page("one.md", "# One\nChanged alpha", {title:"One",tags:["shared"]}), page("two.md", "# Two\nChanged beta", {title:"Two",tags:["shared"]}), page("new.md", "# New\nAdded")]
  var rebuilds = 0, rescored = 0, detect = batchGraph.detectCommunities, surprise = batchGraph.crossDocumentSurprise
  batchGraph.detectCommunities = function() { rebuilds++; return detect.apply(this, arguments) }
  batchGraph.crossDocumentSurprise = function() { rescored++; return surprise.apply(this, arguments) }
  var batchReport = batchGraph.build(batchPages, {extraction:"structural"})
  batchPages.forEach(function(p) { referenceGraph.updatePage(p) }); referenceGraph.removePage("old.md")
  assert(rebuilds === 1 && rescored === 1, "changed-page batch rebuilds communities and scores once")
  assert(stringify(batchGraph.stats()) === stringify(referenceGraph.stats()), "batch derived stats equal sequential public updates")
  function graphShape(g) {
    return { nodes:Object.keys(g._state.nodes).sort().map(function(k) { return g._state.nodes[k] }), edges:g._state.edges.filter(function(e) {return !e._deleted}), summaries:g._state.summaries }
  }
  assert(stringify(graphShape(batchGraph)) === stringify(graphShape(referenceGraph)), "batch graph state equals sequential updates")
  assert(batchGraph._autosave === referenceGraph._autosave, "batch restores autosave")
  rebuilds = 0; rescored = 0
  batchGraph.build(batchPages, {extraction:"semantic",modelHelp:"off"})
  assert(rebuilds === 1 && rescored === 1, "semantic batch computes derived state only at completion")
  rebuilds = 0; rescored = 0
  batchGraph.build(batchPages, {extraction:"semantic",modelHelp:"off",strategy:"full"})
  assert(rebuilds === 1 && rescored === 1, "full semantic batch computes derived state only at completion")
  assert(!!batchGraph.updatePage(page("new.md", "# New\nChanged again")).stats, "single-page update preserves stats return")
  assert(!!batchGraph.removePage("new.md").stats, "single-page removal preserves stats return")
  var calls=0, g=graph("foundation",{modelExtractors:[{role:"main",extract:function(){calls++;return{relationships:[]}}}]})
  var pages=[page("a.md","# Alpha\nTLS and `Node.js` use C++.\n"+new Array(100).join("## Extra\nPlain prose.\n")+"## Late\nECONNREFUSED uses conn.ReceiveFunc.",{title:"Alpha",tags:["network"]}),page("b.md","# Beta\nTLS works with Node.js and conn.ReceiveFunc.",{title:"Beta"})]
  assert(g.build(pages,{extraction:"structural",modelHelp:"auto"}).calls===0 && calls===0,"structural is zero call")
  var stages=[];g.build(pages,{extraction:"structural",onProgress:function(p){stages.push(p.stage)}})
  assert(stages[0]==="structural"&&stages[stages.length-1]==="complete","structural progress reports stages")
  g.build(pages,semantic);assert(calls===0,"semantic off zero calls")
  var mentions=g._state.edges.filter(function(e){return e.type==="MENTIONS"})
  assert(mentions.some(function(e){return e.to==="concept:id:econnrefused"}),"late section evidence")
  assert(mentions.some(function(e){return e.to==="concept:id:node.js"})&&mentions.some(function(e){return e.to==="concept:id:c++"}),"punctuation preserved")
  mentions.forEach(function(e){var p=pages.filter(function(x){return x.path===e.props.page})[0];assert(p.body.substring(e.props.evidence.start,e.props.evidence.end)===e.props.evidence.quote,"evidence offsets")})
  var count=mentions.length;g.build(pages,semantic);assert(g._state.edges.filter(function(e){return e.type==="MENTIONS"}).length===count,"idempotent")
  var candidates=g.expansionCandidates("a.md",{cap:5,budget:{used:0,limit:256},deadline:Date.now()+1000})
  assert(candidates[0].path==="b.md"&&candidates[0].evidenceLayer==="grounded"&&!!candidates[0].supports[0].evidence,"rank and explanation")
  var result=g.retrieve("conn.ReceiveFunc",{cap:10,maxEdges:20});assert(result.pages.length===2&&result.work.edges<=20&&result.pages[0].references.length>0,"retrieval references and work cap")
  var tags=g.tagSuggestions("a.md",["network"],["tls"]);assert(tags.additions.length<=5&&tags.additions[0].tag==="tls","tag vocabulary preference")
  assert(tags.additions.every(function(t){return t.tag!=="network"}),"tags do not justify tags")
  var legacy={from:"concept:id:node.js",to:"concept:id:Legacy",type:"RELATED_TO",provenance:"EXTRACTED",props:{page:"b.md",revision:pages[1].revision}}
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
  var throwing = graph("diagnostic", { modelExtractors: [{ role: "main", extract: function() { throw new Error("private provider error") } }] })
  var diagnostic = throwing.build([modelPages[0]], { extraction: "semantic", modelHelp: "auto", formatModelError: function() { return "sanitized test error" } })
  assert(diagnostic.modelErrors.main === "sanitized test error", "only caller-sanitized exception sample is retained")
  assert(diagnostic.failureReasons["model-extraction-failed"] === 1, "exceptions retain their failure category")
  var fallback=graph("fallback",{modelExtractors:[{role:"lc",extract:function(){throw "failed"}},{role:"main",extract:function(){return{relationships:[]}}}]})
  assert(fallback.build([modelPages[0]],{extraction:"semantic",modelHelp:"auto"}).calls===2,"LC main escalation counted")
  var decision=graph("decision",{modelExtractors:models,decisionExtractor:{fingerprint:"decision",extract:function(){return {paths:[]}}}})
  assert(decision.build(modelPages,{extraction:"semantic",modelHelp:"auto",maxCalls:1}).calls===1,"decision calls consume shared budget")
  var changedInput=graph("dependencies",{modelExtractors:models}), sourcePair=[page("origin.md","TLS connects sockets."),page("peer.md","TLS protects TCP.")]
  changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto"})
  sourcePair[1]=page("peer.md","TLS protects HTTP.")
  assert(changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto",strategy:"resume"}).calls===1,"peer edit leaving the dependent model input unchanged reuses its cache")
  sourcePair[1]=page("peer.md","Plain prose only.")
  assert(changedInput.build(sourcePair,{extraction:"semantic",modelHelp:"auto",strategy:"resume"}).calls===2,"indexed cross-page candidate changes invalidate dependent cache")
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

  // Rebuild economics: new vocabulary only invalidates pages that mention it.
  var seenPaths = []
  var tracking = [{ role: "lc", fingerprint: "track", extract: function(payload) { seenPaths.push(payload.path); return { relationships: [] } } }]
  var econ = graph("economics", { modelExtractors: tracking })
  var econPages = [page("alpha.md", "Alpha talks about TLS.", { title: "Alpha" }), page("beta.md", "Beta mentions Gamma soon.", { title: "Beta" })]
  econ.build(econPages, { extraction: "semantic", modelHelp: "auto" })
  seenPaths = []
  econPages.push(page("gamma.md", "Gamma is new.", { title: "Gamma" }))
  econ.build(econPages, { extraction: "semantic", modelHelp: "auto" })
  assert(seenPaths.indexOf("alpha.md") < 0, "a new title does not re-extract pages that never mention it")
  assert(seenPaths.indexOf("beta.md") >= 0 && seenPaths.indexOf("gamma.md") >= 0, "the mentioning page and the new page are extracted")

  // Section-level reuse: editing one section re-extracts only that section and rebases the others.
  var sectionCalls = []
  var sectionModel = [{ role: "lc", fingerprint: "sections", extract: function(payload) {
    sectionCalls.push(payload.section)
    if (payload.body.indexOf("TLS uses HTTP") >= 0) return { relationships: [{ from: "TLS", to: "HTTP", type: "USES", provenance: "EXTRACTED", confidence: 0.9, evidence: { quote: "TLS uses HTTP" } }] }
    return { relationships: [] }
  } }]
  var sec = graph("sections", { modelExtractors: sectionModel })
  var secPage = page("doc.md", "# One\nIntro prose.\n# Two\nTLS uses HTTP here.\n", { title: "Doc" })
  sec.build([secPage], { extraction: "semantic", modelHelp: "auto" })
  assert(sectionCalls.length === 2, "two sections extracted initially")
  sectionCalls = []
  secPage = page("doc.md", "# One\nIntro prose, now edited and longer.\n# Two\nTLS uses HTTP here.\n", { title: "Doc" })
  sec.build([secPage], { extraction: "semantic", modelHelp: "auto" })
  assert(sectionCalls.length === 1 && sectionCalls[0].indexOf("One") === 0, "only the edited section is re-extracted")
  var rebased = sec._state.edges.filter(function(e) { return !e._deleted && e.props.method === "model" })
  assert(rebased.length === 1 && sec._currentEvidence(rebased[0]), "unchanged section keeps a current model assertion")
  assert(secPage.body.substring(rebased[0].props.evidence.start, rebased[0].props.evidence.end) === "TLS uses HTTP", "rebased evidence offsets point at the quote")
  var reloadedSec = graph("sections", { modelExtractors: sectionModel })
  sectionCalls = []
  reloadedSec.build([secPage], { extraction: "semantic", modelHelp: "auto" })
  assert(sectionCalls.length === 0, "reload keeps section completions")
  secPage = page("doc.md", "# One\nIntro prose, now edited and longer.\n# Two\nTLS uses HTTP here, edited.\n", { title: "Doc" })
  sectionCalls = []
  reloadedSec.build([secPage], { extraction: "structural" })
  reloadedSec.build([secPage], { extraction: "semantic", modelHelp: "auto" })
  assert(sectionCalls.length === 1 && sectionCalls[0].indexOf("Two") === 0, "carry survives a structural update before the semantic build")

  // Legacy (v2) enrichment is adopted without new model calls.
  var legacyCalls = 0
  var legacyModels = [{ role: "lc", fingerprint: "legacy", extract: function() { legacyCalls++; return { relationships: [] } } }]
  var leg = graph("legacy", { modelExtractors: legacyModels })
  var legPage = page("old.md", "Legacy body text.", { title: "Old" })
  leg.build([legPage], { extraction: "semantic", modelHelp: "auto" })
  var legFingerprint = sha1(stringify([["lc", "legacy"]], __, ""))
  var legHash = leg._pageHash(legPage)
  leg._state.enrichment["old.md"] = { key: sha1(legHash + leg._conceptVocabulary([legPage]).legacyHash + ":extractor-2:prompt-2:" + legFingerprint), hash: legHash, version: 2, completed: { "0": true }, status: "complete" }
  legacyCalls = 0
  leg.build([legPage], { extraction: "semantic", modelHelp: "auto" })
  assert(legacyCalls === 0 && leg._state.enrichment["old.md"].version === 3, "legacy completions migrate without model calls")

  // A legacy key computed against an older vocabulary keeps its model edges until re-extraction.
  var legacyRel = [{ role: "lc", fingerprint: "legacy2", extract: function() { legacyCalls++; return { relationships: [{ from: "TLS", to: "HTTP", type: "USES", provenance: "EXTRACTED", confidence: 0.9, evidence: { quote: "TLS uses HTTP" } }] } } }]
  var stale = graph("legacy-stale", { modelExtractors: legacyRel })
  var stalePage = page("old.md", "TLS uses HTTP.", { title: "Old" })
  stale.build([stalePage], { extraction: "semantic", modelHelp: "auto" })
  var staleModel = function() { return stale._state.edges.filter(function(e) { return !e._deleted && e.props.method === "model" }) }
  staleModel().forEach(function(e) { delete e.props.windowKey; e.props.window = 0 })
  stale._state.enrichment["old.md"] = { key: "from-an-older-vocabulary", hash: stale._pageHash(stalePage), version: 2, completed: { "0": true }, status: "complete" }
  legacyCalls = 0
  var staleRun = stale.build([stalePage], { extraction: "semantic", modelHelp: "auto", maxCalls: 1, maxTokens: 1 })
  assert(legacyCalls === 0 && staleRun.pending === 1, "mismatched legacy key leaves the section pending")
  assert(staleModel().length === 1 && isString(staleModel()[0].props.windowKey), "mismatched legacy key keeps and re-keys its model edges")
  stale.build([stalePage], { extraction: "semantic", modelHelp: "auto" })
  assert(legacyCalls === 1 && staleModel().length === 1, "re-extraction replaces the migrated edge once")

  // Batches flush once: one save and one derived recompute.
  var batch = graph("batch-window")
  batch.build([page("seed.md", "# Seed")], { extraction: "structural" })
  var saves = 0, derived = 0, save = batch.save, communities = batch.detectCommunities
  batch.save = function() { saves++; return save.apply(this, arguments) }
  batch.detectCommunities = function() { derived++; return communities.apply(this, arguments) }
  batch.beginBatch()
  for (var bi = 0; bi < 20; bi++) batch.updatePage(page("p" + bi + ".md", "# P" + bi + "\nBody " + bi, { title: "P" + bi, tags: ["shared"] }))
  batch.removePage("seed.md")
  assert(saves === 0 && derived === 0, "no saves or derived recompute inside a batch")
  batch.endBatch()
  assert(saves === 1 && derived === 1, "endBatch flushes exactly once")
  assert(graph("batch-window").stats().nodes === batch.stats().nodes, "batch flush is persisted")

  // Concept keys fold case, possessives and regular plurals; acronyms keep their letters.
  var keys = graph("keys")
  assert(keys._conceptKey("OpenAF") === keys._conceptKey("openaf") && keys._conceptKey("openaf's") === "openaf", "case and possessive folding")
  assert(keys._conceptKey("Connections") === "connection" && keys._conceptKey("policies") === "policy", "regular plurals fold")
  assert(keys._conceptKey("TLS") === "tls" && keys._conceptKey("Kubernetes") === "kubernetes" && keys._conceptKey("getUsers") === "getusers", "acronyms, -es words and identifiers keep their letters")

  // Shared emphasised terms become joinable vocabulary.
  var vocab = keys._conceptVocabulary([page("x.md", "Use **Retrieval V2** here.", { title: "X" }), page("y.md", "Also **Retrieval V2**.", { title: "Y" }), page("z.md", "Only **Solo Term**.", { title: "Z" })])
  assert(isArray(vocab.names["Retrieval V2"]) && vocab.names["Retrieval V2"][0].joinable === true && isUnDef(vocab.names["Solo Term"]), "emphasis on two or more pages joins vocabulary")

  // query(): IDF ranking puts the rare-word match first; the token index follows changes.
  var q = graph("query")
  var qPages = []
  for (var qi = 0; qi < 6; qi++) qPages.push(page("common" + qi + ".md", "# Common " + qi, { title: "Common " + qi, tags: ["shared"] }))
  qPages.push(page("rare.md", "# Rare", { title: "Rare zeppelin", tags: ["shared"] }))
  q.build(qPages, { extraction: "structural" })
  var qDocs = q.query("zeppelin common").filter(function(h) { return h.type === "document" })
  assert(qDocs[0].id === "doc:rare.md" && qDocs[0].score > qDocs[1].score, "rare word outranks a common word")
  assert(q.query("zeppel").some(function(h) { return h.id === "doc:rare.md" }), "substring word still matches")
  q.updatePage(page("late.md", "# Late", { title: "Late airship" }))
  assert(q.query("airship").some(function(h) { return h.id === "doc:late.md" }), "token index refreshes after an update")

  // Communities: deterministic label propagation, one community per page, no catch-all group.
  var cg = graph("communities")
  var cPages = [
    page("a1.md", "# A1", { title: "A1", tags: ["alpha"] }), page("a2.md", "# A2", { title: "A2", tags: ["alpha"] }), page("a3.md", "# A3", { title: "A3", tags: ["alpha"] }),
    page("b1.md", "# B1", { title: "B1", tags: ["beta"] }), page("b2.md", "# B2", { title: "B2", tags: ["beta"] }),
    page("lonely.md", "# Lonely", { title: "Lonely" })
  ]
  cg.build(cPages, { extraction: "structural" })
  var comms = cg.detectCommunities()
  var shape = function(list) { return list.map(function(c) { return c.members.join(",") }).join("|") }
  assert(comms.length === 2 && shape(comms) === "doc:a1.md,doc:a2.md,doc:a3.md|doc:b1.md,doc:b2.md", "tag groups become separate communities")
  assert(shape(cg.detectCommunities()) === shape(comms), "communities are deterministic")
  assert(!comms.some(function(c) { return c._memberSet["doc:lonely.md"] }), "isolated pages are not forced into a community")

  // Expansion: several shared concepts outrank a single one.
  var ex = graph("expansion")
  ex.build([
    page("src.md", "Uses `FooLib` and `BarLib` and `BazLib`.", { title: "Src" }),
    page("many.md", "Also `FooLib` and `BarLib` and `BazLib`.", { title: "Many" }),
    page("one.md", "Only `FooLib` here.", { title: "One" })
  ], semantic)
  var exHits = ex.expansionCandidates("src.md", { cap: 5, budget: { used: 0, limit: 512 }, deadline: Date.now() + 5000 })
  assert(exHits.length === 2 && exHits[0].path === "many.md" && exHits[0].score > exHits[1].score, "shared-concept scores accumulate")

  // Proximity: ranks pages by connection strength to the seeds and respects the work budget.
  var px = graph("proximity")
  px.build([
    page("seed.md", "# Seed", { title: "Seed", tags: ["t1", "t2"] }),
    page("close.md", "# Close", { title: "Close", tags: ["t1", "t2"] }),
    page("far.md", "# Far", { title: "Far", tags: ["t2"] }),
    page("none.md", "# None", { title: "None", tags: ["t3"] })
  ], { extraction: "structural" })
  var prox = px.proximity(["seed.md"], { budget: { used: 0, limit: 1024 } })
  assert(prox["close.md"] === 1 && prox["far.md"] > 0 && prox["far.md"] < 1 && isUnDef(prox["none.md"]) && isUnDef(prox["seed.md"]), "proximity ranks connected pages")
  var tiny = { used: 0, limit: 2 }
  px.proximity(["seed.md"], { budget: tiny })
  assert(tiny.used <= 2 && tiny.truncated === true, "proximity stays within its budget")
  assert(isArray(px.similarConcepts("concept:id:x")) && px.similarConcepts("concept:id:x").length === 0, "embedding seam is a no-op by default")
  // Partial acceptance: grounded relationships are kept, ungrounded ones dropped, quotes match any case.
  var mixPage = page("mix.md", "Redis uses RESP protocol. Nginx proxies Apache traffic.")
  var mixed = graph("mixed", { modelExtractors: [{ role: "main", fingerprint: "mix", extract: function() { return { relationships: [
    { from: "Redis", to: "RESP", type: "USES", provenance: "EXTRACTED", confidence: 0.9, evidence: { quote: "REDIS USES resp protocol" } },
    { from: "Nginx", to: "Varnish", type: "PROXIES", provenance: "INFERRED", confidence: 0.5, evidence: { quote: "Nginx proxies Apache traffic" } }
  ] } } }] })
  var mixedReport = mixed.build([mixPage], { extraction: "semantic", modelHelp: "auto" })
  var mixedEdges = mixed._state.edges.filter(function(e) { return e.props && e.props.method === "model" })
  assert(mixedEdges.length === 1 && mixedReport.relationshipsAccepted === 1 && mixedReport.relationshipsRejected === 1, "partial section keeps grounded relationships")
  assert(mixedEdges[0].props.evidence.quote === "Redis uses RESP protocol", "case-insensitive quote stores the exact section text")
  assert(mixed._state.enrichment["mix.md"].status === "complete", "partial acceptance completes the section")
  var junkCalls = 0
  var junk = graph("junk", { modelExtractors: [
    { role: "lc", fingerprint: "j1", extract: function() { junkCalls++; return { relationships: [{ from: "A1", to: "B1", evidence: { quote: "not in the page" } }] } } },
    { role: "main", fingerprint: "j2", extract: function() { junkCalls++; return { relationships: [{ from: "Redis", to: "RESP", type: "USES", provenance: "EXTRACTED", evidence: { quote: "Redis uses RESP" } }] } } }
  ] })
  junk.build([mixPage], { extraction: "semantic", modelHelp: "auto" })
  assert(junkCalls === 2 && junk._state.edges.some(function(e) { return e.props && e.props.method === "model" }), "wholly ungrounded response escalates to the next model")
  var allBad = graph("allbad", { modelExtractors: [{ role: "main", fingerprint: "bad", extract: function() { return { relationships: [{ from: "A1", to: "B1", evidence: { quote: "nowhere" } }] } } }] })
  var allBadReport = allBad.build([mixPage], { extraction: "semantic", modelHelp: "auto" })
  assert(allBadReport.failureReasons["ungrounded-relationships"] === 1, "ungrounded section failure is categorized")
  assert(allBadReport.failed === 1 && allBad._state.enrichment["mix.md"].status !== "complete", "wholly ungrounded response fails the section")

  // Dangling link statistic: unresolved page links count, indexed pages and @mount links do not.
  var dl = graph("dangling")
  dl.buildStructural([
    { path: "a.md", body: "# A", revision: "1", meta: { title: "A" }, links: ["b.md", "ghost.md", "@m/x.md"] },
    { path: "b.md", body: "# B", revision: "2", meta: { title: "B" }, links: [] }
  ])
  assert(dl.stats().danglingLinks === 1, "dangling links counted")
  print("PASS graph build acceptance: "+checked+" assertions")
} finally { io.rm(root) }
