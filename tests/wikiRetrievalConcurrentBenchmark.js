// Bounded same-JVM reader load on one real local-FS Lucene generation.
load("mini-a-common.js"); load("mini-a-wiki.js")
var pages=Math.max(10,Number(getEnv("WIKI_BENCH_PAGES"))||1000), callers=Math.max(2,Number(getEnv("WIKI_BENCH_CALLERS"))||4), calls=Math.max(2,Number(getEnv("WIKI_BENCH_CALLS"))||30)
var dir=String(io.createTempDir("wiki-concurrent-")), manager, times=new java.util.concurrent.ConcurrentLinkedQueue(), errors=new java.util.concurrent.ConcurrentLinkedQueue()
var ready=new java.util.concurrent.CountDownLatch(callers), start=new java.util.concurrent.CountDownLatch(1), threads=[]
var source={wiki:sha1(io.readFileString("mini-a-wiki.js")),retrieval:sha1(io.readFileString("mini-a-wiki-retrieval.js")),harness:sha1(io.readFileString("tests/wikiRetrievalConcurrentBenchmark.js"))}
try {
  for(var i=0;i<pages;i++)io.writeFileString(dir+"/page-"+i+".md","# Concurrent reference\nconcurrentparameter"+i+" controls expiry.")
  manager=new MiniAWikiManager({backend:"fs",root:dir,access:"rw",wikiretrievalv2:true},function(){})
  if(!manager.reindex().ok)throw new Error("concurrent fixture publication failed")
  if(manager.retrieve("concurrentparameter0",{chunks:1}).evidence.length!==1)throw new Error("concurrent fixture warmup failed")
  for(var c=0;c<callers;c++){
    var thread=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){
      ready.countDown()
      try {
        if(!start.await(10,java.util.concurrent.TimeUnit.SECONDS))throw new Error("start timeout")
        for(var n=0;n<calls;n++){
          var t=java.lang.System.nanoTime(), out=manager.retrieve("concurrentparameter0",{chunks:1})
          times.add(Number(java.lang.System.nanoTime()-t)/1000000)
          if(!out.evidence || out.evidence.length!==1)throw new Error("missing concurrent evidence")
        }
      }catch(e){errors.add(String(e.message||e))}
    }}))
    threads.push(thread);thread.start()
  }
  if(!ready.await(10,java.util.concurrent.TimeUnit.SECONDS))throw new Error("readers did not start")
  var wall=java.lang.System.nanoTime();start.countDown()
  for(var j=0;j<threads.length;j++)threads[j].join(60000)
  var wallMillis=Number(java.lang.System.nanoTime()-wall)/1000000
  for(var k=0;k<threads.length;k++)if(threads[k].isAlive())throw new Error("reader thread did not stop")
  var array=[], iter=times.iterator();while(iter.hasNext())array.push(Number(iter.next()))
  array.sort(function(a,b){return a-b})
  var p=function(f){return array[Math.min(array.length-1,Math.ceil(array.length*f)-1)]}, err=[];iter=errors.iterator();while(iter.hasNext())err.push(String(iter.next()))
  var report={kind:"same-jvm-concurrent-retrieve",backend:"local-fs",liveProvider:false,pages:pages,callers:callers,callsPerCaller:calls,samples:array.length,wallMillis:wallMillis,latency:array.length?{p50:p(0.5),p95:p(0.95),p99:p(0.99)}:null,errors:err,sourceSha1:source,runtime:getVersion(),jvm:String(java.lang.System.getProperty("java.version"))}
  print("CONCURRENT="+stringify(report,__,""))
  if(err.length || array.length!==callers*calls)throw new Error("concurrent benchmark errors")
}finally{start.countDown();if(manager)manager.close();io.rm(dir)}
