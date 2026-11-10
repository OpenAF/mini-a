// Run against sibling OpenAF source, without rebuilding or overwriting its installed JAR.
ow.loadCh()
load("../openaf/js/owrap.ch.js")
ow.ch.__types.graph = OpenWrap.ch.prototype.__types.graph
ow.ch.utils.graph = OpenWrap.ch.prototype.utils.graph
ow.loadTest()
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-graph.js")
var dir=String(io.createTempDir("graph-parity-")), checks=0
function check(ok,note){if(!ok)throw new Error(note);checks++}
try {
  var graph=new MiniAWikiGraph({graphDir:dir+"/wiki",modelExtractors:[]}), pages=[{path:"a.md",body:"TLS uses HTTP.",revision:"r1",meta:{title:"Alpha"},links:[]},{path:"b.md",body:"TLS uses HTTP.",revision:"r2",meta:{title:"Beta"},links:[]}]
  graph.build(pages,{extraction:"semantic",modelHelp:"off"})
  var snapshot=io.readFileJSON(dir+"/wiki/graph.json")
  ;["file","mvs"].forEach(function(mode){
    var name="parity-"+mode, options=mode==="file"?{file:dir+"/wiki/graph.json"}:{store:{type:"mvs",options:{file:dir+"/state.db"}}}, helpers=ow.ch.utils.graph
    $ch(name).create(false,"graph",options)
    if(mode==="mvs"){
      Object.keys(snapshot.nodes).forEach(function(id){$ch(name).set({id:id},snapshot.nodes[id])})
      snapshot.edges.forEach(function(e){$ch(name).set({from:e.from,to:e.to,type:e.type,provenance:e.provenance,page:e.props.page,section:e.props.section},e)})
      var meta=clone(snapshot);delete meta.nodes;delete meta.edges;helpers.metadata(name,meta)
    }
    var edge=helpers.neighbors(name,"a.md",{type:"MENTIONS",evidenceLayer:"grounded"})[0]
    check(!!edge.props.evidence.quote,"nested evidence "+mode)
    var filter={direction:"out",type:"MENTIONS",provenance:"EXTRACTED",evidenceLayer:"grounded",minConfidence:0.9}
    check(stringify(helpers.path(name,"a.md",edge.to,filter))===stringify(graph.path("a.md",edge.to,filter)),"path parity "+mode)
    check(helpers.path(name,edge.to,"a.md",filter).length===0,"direction enforced "+mode)
    check(helpers.path(name,"a.md",edge.to,{minConfidence:1.1}).length===0,"confidence enforced "+mode)
    helpers.metadata(name,{enrichment:snapshot.enrichment,extension:{kept:true}})
    $ch(name).destroy();$ch(name).create(false,"graph",options)
    check(helpers.metadata(name).extension.kept===true,"metadata restart "+mode)
    check(helpers.metadata(name).enrichment["a.md"].status==="pending","pending restart "+mode)
    $ch(name).unset({id:"doc:a.md"})
    check(helpers.neighbors(name,"a.md").length===0&&helpers.neighbors(name,"b.md").length>0,"incremental deletion independent support "+mode)
    $ch(name).destroy()
  })
  // Generic existing channel suite, including legacy envelopes and channel-backed batch behavior.
  var tests=require("../openaf/tests/autoTestAll.Channels.js")
  tests.testGraphChannel();tests.testGraphChannelStore()
  print("PASS graph/OpenAF parity: "+checks+" assertions and existing graph channel suites")
} finally {io.rm(dir)}
