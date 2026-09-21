// Local real-Lucene benchmark. First-call costs use fresh read-only managers; warm calls reuse them.
load("mini-a-common.js"); load("mini-a-wiki.js"); load("mini-a-wiki-knowledge.js")
var simulated=String(getEnv("WIKI_BENCH_REMOTE") || "false")==="true", latency=Math.max(0,Number(getEnv("WIKI_BENCH_LATENCY_MS")) || 0)
var measureBytes=function(text){return Number(new java.lang.String(String(text)).getBytes("UTF-8").length)}
var mode=String(getEnv("WIKI_BENCH_MODE") || "v2"), count=Math.max(10,Number(getEnv("WIKI_BENCH_PAGES")) || 100), samples=Math.max(2,Number(getEnv("WIKI_BENCH_SAMPLES")) || 10)
var lexical=isString(getEnv("WIKI_BENCH_LEXICAL")) ? af.fromJSSLON(getEnv("WIKI_BENCH_LEXICAL")) : __
var zeroQuery=lexical && lexical.ngrams === true ? "zqxjvkb" : "neverpresentidentifier"
var dir=String(io.createTempDir("wiki-perf-")), root, mounted, report={mode:mode,pages:count,samples:samples,backend:simulated?"simulated-remote-current-source":"local-fs",simulatedLatencyMs:latency,liveProvider:false,runtime:getVersion(),jvm:String(java.lang.System.getProperty("java.version")),operations:{},sourceSha1:{wiki:sha1(io.readFileString("mini-a-wiki.js")),knowledge:sha1(io.readFileString("mini-a-wiki-knowledge.js")),retrieval:io.fileExists("mini-a-wiki-retrieval.js")?sha1(io.readFileString("mini-a-wiki-retrieval.js")):null}}
report.lexical=lexical || {language:"english"};report.zeroQuery=zeroQuery
var make=function(path,access){return new MiniAWikiManager({backend:"fs",root:path,access:access,wikiretrievalv2:mode==="v2",wikilexical:lexical},function(){})}
var millis=function(fn){var t=java.lang.System.nanoTime(),value=fn();return {ms:Number(java.lang.System.nanoTime()-t)/1000000,value:value}}
var walkBytes=function(path){var f=new java.io.File(path),total=0;if(f.isFile())return Number(f.length());var fs=f.listFiles();for(var i=0;fs && i<fs.length;i++)total+=walkBytes(String(fs[i].getPath()));return total}
// Sample aggregate heap usage instead of presenting the final GC-dependent
// heap observation as a peak. Ten-millisecond sampling can miss shorter peaks.
var heapBean=java.lang.management.ManagementFactory.getMemoryMXBean(), heapMax=new java.util.concurrent.atomic.AtomicLong(0), heapSamples=new java.util.concurrent.atomic.AtomicLong(0), stopHeap=new java.util.concurrent.atomic.AtomicBoolean(false), heapErrors=new java.util.concurrent.ConcurrentLinkedQueue()
var sampleHeap=function(){var used=Number(heapBean.getHeapMemoryUsage().getUsed()), previous=Number(heapMax.get());while(used>previous && !heapMax.compareAndSet(previous,used))previous=Number(heapMax.get());heapSamples.incrementAndGet()}
var heapSampler=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{while(!stopHeap.get()){sampleHeap();java.lang.Thread.sleep(10)}}catch(e){heapErrors.add(String(e))}}}))
heapSampler.setDaemon(true);heapSampler.start()
try {
  io.mkdir(dir+"/root");io.mkdir(dir+"/mount")
  for(var i=0;i<count;i++)io.writeFileString(dir+"/root/page-"+i+".md","---\ntitle: Reference "+i+"\n---\n# Introduction\n"+new Array(20).join("General content.\n")+"\n# Specific\nqueryparameter "+i+" controls expiry.\n[related](page-0.md)")
  io.writeFileString(dir+"/mount/answer.md","# Specific\nlastmountparameter controls expiry precisely.")
  root=make(dir+"/root","rw");mounted=make(dir+"/mount","rw")
  var build=millis(function(){return root.reindex()});if(!build.value.ok)throw new Error(stringify(build.value));if(!mounted.reindex().ok)throw new Error("mount build failed")
  report.initialBuild={ms:build.ms,fixtureDiskBytes:walkBytes(dir+"/root")}
  var operations={compactSearch:function(m){return m.agenticSearch("queryparameter")},zeroSearch:function(m){return m.agenticSearch(zeroQuery)},retrieve:function(m){return m.retrieve("queryparameter",{chunks:2,maxInspected:2})},assembleContext:function(m){return m.assembleContext("queryparameter",{chunks:2})},open:function(m){return m.open("page-0.md")},navigate:function(m){return m.navigate("page-0.md",{section:"Specific"})},backlinks:function(m){return m.backlinks("page-0.md")},federation:function(m){return m.retrieve("lastmountparameter expiry",{wiki:"*",chunks:1})}}
  Object.keys(operations).forEach(function(name){
    var constructed=millis(function(){return make(dir+"/root","ro")}),client=constructed.value,attached=millis(function(){return client.attach("last",{backend:"fs",root:dir+"/mount"})})
    var reads=0,bytes=0
    ;[client].concat(client._mounts.map(function(m){return m.manager})).forEach(function(manager){
      var original=manager._backend.read
      if(simulated){manager._backendType="http";manager._config.indexdir=manager._backend.root;manager._config.url="https://simulated.invalid"}
      manager._backend.read=function(p){if(latency)java.lang.Thread.sleep(latency);var text=original.call(manager._backend,p);reads++;bytes+=measureBytes(String(text || ""));return text}
    })
    var validation=function(){var totals={reads:0,bytes:0};[client].concat(client._mounts.map(function(m){return m.manager})).forEach(function(m){if(m._retrievalV2){totals.reads+=Number(m._retrievalV2.metrics.validationBlockReads)||0;totals.bytes+=Number(m._retrievalV2.metrics.validationBlockBytes)||0}});return totals}
    var initializationValidation=validation(),first=millis(function(){return operations[name](client)}),coldReads=reads,coldBytes=bytes,coldValidation=validation();reads=0;bytes=0
    var times=[],outputBytes=0
    for(var s=0;s<samples;s++){var result=millis(function(){return operations[name](client)});times.push(result.ms);outputBytes+=measureBytes(stringify(result.value,__,""))}
    times.sort(function(a,b){return a-b});var p=function(f){return times[Math.min(samples-1,Math.ceil(samples*f)-1)]}
    var warmValidation=validation()
    report.operations[name]={managerConstructionMs:constructed.ms,mountAttachMs:attached.ms,initializationValidationBlockReads:initializationValidation.reads,initializationValidationBlockBytes:initializationValidation.bytes,coldMs:first.ms,coldSourceReads:coldReads,coldSourceBytes:coldBytes,coldValidationBlockReads:coldValidation.reads-initializationValidation.reads,coldValidationBlockBytes:coldValidation.bytes-initializationValidation.bytes,warm:{p50:p(0.5),p95:p(0.95),p99:p(0.99),sourceReads:reads,sourceBytes:bytes,outputBytes:outputBytes,validationBlockReads:warmValidation.reads-coldValidation.reads,validationBlockBytes:warmValidation.bytes-coldValidation.bytes},servingMetrics:client._retrievalV2?clone(client._retrievalV2.metrics):null}
    client.close()
  })
  var parsedBefore=root._retrievalV2?root._retrievalV2.metrics.parsedPages:0
  var update=millis(function(){return root.write("page-0.md",{title:"Changed"},"# Specific\nqueryparameter is updated.")})
  report.incrementalUpdate={ms:update.ms,ok:update.value.ok,updateWork:root._lastServingUpdate?root._lastServingUpdate.updateWork:null,parsedPages:root._retrievalV2?root._retrievalV2.metrics.parsedPages-parsedBefore:null}
  var publication=millis(function(){return root.reindex()});report.fullPublication={ms:publication.ms,ok:publication.value.ok,fixtureDiskBytes:walkBytes(dir+"/root")}
  report.memoryUsed=Number(java.lang.Runtime.getRuntime().totalMemory()-java.lang.Runtime.getRuntime().freeMemory())
  stopHeap.set(true);heapSampler.join(1000);sampleHeap()
  if(heapSampler.isAlive() || heapErrors.size()>0)throw new Error("heap-sampler-failed")
  report.memory={estimator:"MemoryMXBean aggregate heap sampled every 10 ms; shorter peaks may be missed",sampleIntervalMillis:10,samples:Number(heapSamples.get()),maxSampledHeapBytes:Number(heapMax.get()),heapAtEndBytes:Number(heapBean.getHeapMemoryUsage().getUsed()),scope:"fixture/index construction, all operations, update and publication; excludes native/JVM non-heap memory"}
  print("PERFORMANCE="+stringify(report,__,""))
}finally{stopHeap.set(true);heapSampler.join(1000);if(root)root.close();if(mounted)mounted.close();io.rm(dir)}
