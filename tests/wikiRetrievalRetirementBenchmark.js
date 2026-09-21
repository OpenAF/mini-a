// Real Lucene publication after simulated batch source removals. No ingest prune.
load("mini-a-common.js");load("mini-a-wiki.js")
var pages=Math.max(10,Number(getEnv("WIKI_BENCH_PAGES"))||1000), samples=Math.max(2,Number(getEnv("WIKI_BENCH_SAMPLES"))||10)
var retired=Math.max(1,Math.min(pages-1,Number(getEnv("WIKI_BENCH_RETIRED"))||Math.floor(pages/2)))
var dir=String(io.createTempDir("wiki-retirement-")), manager, observations=[]
var report={kind:"batch-source-retirement-publication",backend:"local-fs",liveProvider:false,scope:"simulated backend removals and real derived publication; excludes source removal IO, ingest ownership/journaling and fixture construction",pages:pages,retiredPages:retired,samples:samples,runtime:getVersion(),jvm:String(java.lang.System.getProperty("java.version")),sourceSha1:{wiki:sha1(io.readFileString("mini-a-wiki.js")),retrieval:sha1(io.readFileString("mini-a-wiki-retrieval.js")),harness:sha1(io.readFileString("tests/wikiRetrievalRetirementBenchmark.js"))}}
var clock=function(){return Number(java.lang.System.nanoTime())/1000000}
try {
  for(var round=0;round<samples;round++) {
    var root=dir+"/round-"+round;io.mkdir(root)
    for(var i=0;i<pages;i++)io.writeFileString(root+"/page-"+i+".md","# Reference "+i+"\n"+new Array(30).join("Technical prerequisite and warning.\n")+"\n# Configuration\nretirementparameter"+i+" controls expiry.")
    manager=new MiniAWikiManager({backend:"fs",root:root,access:"rw",wikiretrievalv2:true,wikiretrievalconfig:{linkImmutableFiles:false}},function(){})
    var built=manager.reindex();if(!built.ok)throw new Error(stringify(built))
    if(manager.retrieve("retirementparameter0").evidence.length!==1)throw new Error("warm baseline evidence missing")
    var changed=[]
    for(var removed=0;removed<retired;removed++){var path="page-"+removed+".md";io.rm(root+"/"+path);changed.push(path)}
    var before=manager._retrievalV2.metrics.parsedPages, started=clock(), result=manager._retrievalV2.build(changed), elapsed=clock()-started
    if(!result.ok || result.pages!==pages-retired)throw new Error("retirement publication failed: "+stringify(result))
    if(manager.retrieve("retirementparameter0").evidence.length!==0 || manager.retrieve("retirementparameter"+(pages-1)).evidence.length!==1)throw new Error("current-view retirement evidence mismatch")
    observations.push({millis:elapsed,pagesRemaining:result.pages,parsedPages:manager._retrievalV2.metrics.parsedPages-before,work:result.updateWork})
    manager.close();manager=__;io.rm(root)
  }
  var times=observations.map(function(o){return o.millis}).sort(function(a,b){return a-b}), percentile=function(f){return times[Math.min(times.length-1,Math.ceil(times.length*f)-1)]}
  report.observations=observations;report.latency={p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99)}
  print("RETIREMENT="+stringify(report,__,""))
}finally{if(manager)manager.close();io.rm(dir)}
