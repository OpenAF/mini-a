load("js/core/mini-a-common.js")
load("js/wiki/mini-a-graph.js")
var fixture=io.readFileJSON("tests/fixtures/graph-connections/benchmark.json"), pages=[], queries=[]
fixture.topics.forEach(function(topic,index){var relevant=[];topic.titles.forEach(function(title,number){var path="topic"+index+"/page"+number+".md",body="# "+title+"\n\n"+topic.evidence;pages.push({path:path,meta:{title:title},body:body,revision:sha1(body),links:[]});relevant.push(path)});queries.push({query:topic.query,relevant:relevant,graph:true})})
fixture.lexicalQueries.forEach(function(query){queries.push({query:query,relevant:pages.filter(function(page){return page.meta.title===query}).map(function(page){return page.path}),graph:false})})
for(var i=0;i<fixture.distractors;i++){var body="# Unrelated note "+i+"\nPlain prose outside all tested domains.";pages.push({path:"noise/"+i+".md",meta:{title:"Unrelated note "+i},body:body,revision:sha1(body),links:[]})}
var root=String(io.createTempDir("graph-benchmark-")), started=Date.now()
try {
  var baseline=new MiniAWikiGraph({graphDir:root+"/baseline",modelExtractors:[]});baseline.buildStructural(pages)
  // Frozen baseline ranking contract: pre-change retrieve selects only matching document nodes.
  var before=function(query){return baseline.query(query).filter(function(hit){return hit.id.indexOf("doc:")===0}).slice(0,10).map(function(hit){return hit.id.substring(4)})}
  var graph=new MiniAWikiGraph({graphDir:root+"/enhanced",modelExtractors:[{role:"lc",fingerprint:"empty-fixture-v1",extract:function(){return {relationships:[]}}}]})
  var build=graph.build(pages,merge({extraction:"semantic",modelHelp:"auto"},fixture.budgets)), metrics={baseline:{recall:0,precision:0},enhanced:{recall:0,precision:0}}, rows=[], maxEdges=0
  queries.forEach(function(query){var old=before(query.query), result=graph.retrieve(query.query,fixture.budgets), current=result.pages.map(function(hit){return hit.path});maxEdges=Math.max(maxEdges,result.work.edges);var hits=function(paths){return paths.filter(function(path){return query.relevant.indexOf(path)>=0}).length};if(query.graph){metrics.baseline.recall+=hits(old)/query.relevant.length;metrics.enhanced.recall+=hits(current)/query.relevant.length}metrics.baseline.precision+=hits(old)/10;metrics.enhanced.precision+=hits(current)/10;rows.push({query:query.query,baselineHits:hits(old),enhancedHits:hits(current)})})
  metrics.baseline.recall/=fixture.topics.length;metrics.enhanced.recall/=fixture.topics.length;metrics.baseline.precision/=queries.length;metrics.enhanced.precision/=queries.length
  var relative=(metrics.enhanced.recall-metrics.baseline.recall)/metrics.baseline.recall, regression=metrics.baseline.precision-metrics.enhanced.precision
  if(relative<0.1||regression>0.02||maxEdges>fixture.budgets.maxEdges||build.calls>fixture.budgets.maxCalls||build.estimatedTokens>fixture.budgets.maxTokens)throw new Error("Benchmark acceptance failed")
  print(JSON.stringify({ok:true,fixture:"graph-connections-v1",pages:pages.length,queries:queries.length,metrics:metrics,relativeRecallImprovement:relative,precisionRegression:regression,maxRetrievalEdges:maxEdges,modelCalls:build.calls,estimatedTokens:build.estimatedTokens,pending:build.pending,elapsedMs:Date.now()-started,rows:rows}))
} finally {io.rm(root)}
