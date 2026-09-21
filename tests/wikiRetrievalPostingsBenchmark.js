// Isolated lookup microbenchmark: parsed Markdown postings, not end-to-end search.
load("mini-a-common.js"); load("mini-a-wiki.js")
var parser=global.MiniAWikiRetrievalV2, samples=Math.max(10,Math.min(10000,Number(getEnv("WIKI_POSTING_SAMPLES"))||1000))
var sizes=String(getEnv("WIKI_POSTING_SIZES")||"100,1000,10000").split(",").map(function(n){return Number(n)})
if(!sizes.every(function(n){return isFinite(n)&&n>=1&&n<=100000&&n===Math.floor(n)}))throw new Error("invalid posting benchmark size")
var results=[], clock=function(){return Number(java.lang.System.nanoTime())}, elapsed=function(at){return (clock()-at)/1000000}
var percentiles=function(values){values.sort(function(a,b){return a-b});var pick=function(p){return values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]};return {samples:values.length,p50Millis:pick(0.5),p95Millis:pick(0.95),p99Millis:pick(0.99)}}
sizes.forEach(function(size){
  var paragraphs=[]
  for(var i=0;i<size;i++)paragraphs.push("Ordinary paragraph "+i+" "+new Array(101).join("x"))
  var raw="# Instructions\n"+paragraphs.join("\n\n")+"\n\nWarning: retain the backup.\n\n```sh\npostingparameter --apply\n```", position=raw.indexOf("Warning:")
  var parseAt=clock(), parsed=parser.parse("benchmark.md",raw,128), parseMillis=elapsed(parseAt), page={passageIds:[]}, records={}
  parsed.passages.forEach(function(p){page.passageIds.push(p.passageId);records[p.passageId]={charStart:p.charStart,charEnd:p.charEnd}})
  var linear=function(){var index=page.passageIds.length;page.passageIds.some(function(id,i){if(records[id].charEnd<=position)return false;index=i;return true});return index}
  var binary=function(){return parser.passageAt(page,records,position)}
  var expected=linear(), used={}, actual=parser.passageAt(page,records,position,used)
  if(actual!==expected)throw new Error("lookup boundary mismatch")
  for(var warm=0;warm<100;warm++){linear();binary()}
  var linearTimes=[], binaryTimes=[]
  for(var sample=0;sample<samples;sample++){
    // Alternate execution order to reduce a fixed ordering bias.
    var first=sample%2?binary:linear, second=sample%2?linear:binary
    var at=clock();if(first()!==expected)throw new Error("first lookup mismatch");var firstMillis=elapsed(at)
    at=clock();if(second()!==expected)throw new Error("second lookup mismatch");var secondMillis=elapsed(at)
    linearTimes.push(sample%2?secondMillis:firstMillis);binaryTimes.push(sample%2?firstMillis:secondMillis)
  }
  results.push({paragraphs:size,passages:page.passageIds.length,rawUtf8Bytes:parser.bytes(raw),parseMillis:parseMillis,linearRecordsVisited:expected+1,binaryComparisons:used.structuralContextLookupProbes,linear:percentiles(linearTimes),binary:percentiles(binaryTimes)})
})
print("POSTINGS_BENCHMARK="+stringify({scope:"isolated parsed-Markdown posting lookup; no Lucene queries or backend operations",clock:"System.nanoTime",runtime:String(getVersion()),jvm:String(java.lang.System.getProperty("java.version")),sourceSha1:sha1(io.readFileString("mini-a-wiki-retrieval.js")),timedBinaryAccounting:false,results:results},__,""))
