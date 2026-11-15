// Optional isolated-server acceptance. Never point this at a shared production graph.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-graph.js")
if (!getEnv("MINIA_GRAPH_TEST_PORT")) throw new Error("Set MINIA_GRAPH_TEST_PORT to a disposable local FalkorDB server")
var root=String(io.createTempDir("graph-falkor-")), config={graphDir:root,modelExtractors:[],falkor:{host:"127.0.0.1",port:Number(getEnv("MINIA_GRAPH_TEST_PORT")),graph:"minia_test_"+String(java.util.UUID.randomUUID()).replace(/-/g,"")}}, checks=0
function check(ok,note){if(!ok)throw new Error(note);checks++}
try {
  var g=new MiniAWikiGraph(config,function(level,msg){print(level+": "+msg)}), pages=[{path:"a.md",meta:{title:"Alpha"},body:"TLS uses HTTP.",revision:"a1",links:[]},{path:"b.md",meta:{title:"Beta"},body:"TLS uses HTTP.",revision:"b1",links:[]}]
  g.build(pages,{extraction:"semantic",modelHelp:"off"})
  var first=g._state.edges.filter(function(e){return e.type==="MENTIONS"})
  check(first.length===4,"both pages independently assert concepts")
  // Remove local file to require the remote transport, including nested evidence and checkpoints.
  io.rm(root+"/graph.json")
  var remote=new MiniAWikiGraph(config,function(level,msg){print(level+": "+msg)}), edges=remote._state.edges.filter(function(e){return e.type==="MENTIONS"})
  check(edges.length===first.length,"remote assertions round trip")
  check(edges.every(function(e){return isMap(e.props.evidence)&&e.props.evidence.quote.length>0}),"nested evidence round trip")
  check(remote._state.nodes["concept:id:tls"].props.name === "TLS" && remote._state.nodes["concept:id:tls"].props.joinable === true,"concept name and boolean metadata round trip")
  check(remote._state.enrichment["a.md"].status==="pending","remote enrichment state round trip")
  check(remote._state.semantic_cache["b.md"].schema_version===g._state.semantic_cache["b.md"].schema_version,"remote cache versions round trip")
  remote.removePage("a.md")
  io.rm(root+"/graph.json")
  var deleted=new MiniAWikiGraph(config,function(level,msg){print(level+": "+msg)})
  check(!deleted._state.nodes["doc:a.md"],"incremental remote deletion")
  check(deleted._state.edges.filter(function(e){return e.type==="MENTIONS"&&e.props.page==="b.md"}).length===2,"independent support survives deletion")
  check(!deleted._state.enrichment["a.md"],"deleted pending work removed remotely")
  // Reconciliation metadata and independently owned memberships round trip remotely.
  deleted.build(pages, { reconcile: "lexical" })
  io.rm(root + "/graph.json")
  var reconciled = new MiniAWikiGraph(config)
  check(reconciled._state.reconciliation.version === 1, "reconciliation metadata survives remote load")
  check(reconciled._state.edges.some(function(edge) { return edge.props.reconcileVersion === 1 && isMap(edge.props.evidence) }), "reconciliation evidence survives remote serialization")
  check(reconciled.build(pages, { reconcile: "lexical" }).reconciliation.cached === 2, "remote reconciliation resumes from compatible discovery checkpoints")
  load("js/wiki/mini-a-wiki.js")
  var wiki = root + "/wiki"
  io.mkdir(wiki)
  io.writeFileString(wiki + "/a.md", "---\ntitle: Alpha\n---\nTLS uses HTTP.")
  io.writeFileString(wiki + "/b.md", "---\ntitle: Beta\n---\nTLS uses HTTP.")
  var manager = new MiniAWikiManager({ backend: "fs", root: wiki, access: "rw", usegraph: true, wikigraphfalkor: config.falkor, skipBootstrap: true }, function() {})
  try {
    var upgraded = manager.graph("upgrade", { confirmExpensive: true, reconcile: "lexical" })
    check(upgraded.complete && io.fileExists(upgraded.previous), "staged upgrade retains a predecessor even for a remote-first graph")
    check(!io.fileExists(manager._graph._graphDir + "/remote-sync.json"), "successful real remote publication clears its marker")
    var published = new MiniAWikiGraph(merge(config, { graphDir: manager._graph._graphDir }))
    check(published.stats({ detailed: true }).connectivity.documentsWithGroundedConcepts === 2, "upgraded remote graph has grounded connectivity")
    published.close()
  } finally { manager.close() }
  print("PASS live FalkorDB round trip: "+checks+" assertions")
} finally {io.rm(root)}
