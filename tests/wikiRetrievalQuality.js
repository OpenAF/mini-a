// Deterministic passage evidence evaluation; no model judging or runtime dependencies.
load("mini-a-common.js"); load("mini-a-wiki.js"); load("mini-a-wiki-knowledge.js")
var mode = String(getEnv("WIKI_EVAL_MODE") || "v2"), split = String(getEnv("WIKI_EVAL_SPLIT") || "held-out")
if (["development", "held-out"].indexOf(split) < 0 || ["v2", "legacy"].indexOf(mode) < 0) throw new Error("invalid evaluation mode/split")
var fixture = af.fromJson(io.readFileString("tests/fixtures/wiki-retrieval-v2/" + split + ".json")), dir = String(io.createTempDir("wiki-quality-")), managers = {}, results = []
var evidenceValidator=require("tests/wikiRetrievalEvidence.js")
try {
  fixture.pages.forEach(function(page) {
    var wiki = page.wiki || "primary", root = dir + "/" + wiki; io.mkdir(root)
    var metadata = merge({title:page.title}, page.metadata || {}), body = (page.introRepeats ? "# Introduction\n" + new Array(page.introRepeats).join("General background without the answer.\n") + "\n" : "") + page.body
    io.writeFileString(root + "/" + page.path, "---\n" + af.toYAML(metadata) + "---\n" + body)
  })
  Object.keys(fixture.pages.reduce(function(m,p){m[p.wiki || "primary"]=true;return m},{})).forEach(function(wiki) {
    managers[wiki] = new MiniAWikiManager({backend:"fs",root:dir+"/"+wiki,access:"rw",wikiretrievalv2:mode==="v2"},function(){})
    var built=managers[wiki].reindex(); if(!built.ok)throw new Error(stringify(built))
  })
  var root = managers.primary
  Object.keys(managers).forEach(function(wiki){if(wiki!=="primary")root.attach(wiki,{backend:"fs",root:dir+"/"+wiki})})
  fixture.queries.forEach(function(q) {
    var out = root.retrieve(q.query,{wiki:q.wiki || "*",applicability:q.applicability,chunks:q.k,maxInspected:q.k,maxCandidates:24,maxBytes:24000,tokens:6000})
    var evidence=(out.evidence || []).slice(0,q.k), matches=q.support.filter(function(s){return evidence.some(function(e){return e.content.indexOf(s)>=0})}), correct=0, chars=0, useful=0, hashes={}
    var citationChecks=[]
    evidence.forEach(function(e){var page=root.read(e.path), raw=String(page && page.raw || ""), checked=evidenceValidator.check(raw,e);citationChecks.push(checked);if(checked.correct)correct++;chars+=e.content.length;useful+=q.support.filter(function(s){return e.content.indexOf(s)>=0}).reduce(function(n,s){return n+s.length},0);hashes[sha1(e.content)]=true})
    var rank=0;for(var i=0;i<evidence.length;i++)if(q.support.some(function(s){return evidence[i].content.indexOf(s)>=0})){rank=i+1;break}
    results.push({query:q.query,k:q.k,recall:q.support.length?matches.length/q.support.length:null,reciprocalRank:rank?1/rank:0,citationRangeCorrectness:evidence.length?correct/evidence.length:null,citationChecks:citationChecks,duplicateFraction:evidence.length?1-Object.keys(hashes).length/evidence.length:0,usefulCharsPerEstimatedContentToken:chars?useful/Math.ceil(chars/4):0,outcome:out.outcome || (evidence.length?"hits":"zero"),expectedUnanswerable:q.support.length===0,evidencePaths:evidence.map(function(e){return e.path})})
  })
  var answerable=results.filter(function(r){return r.recall!==null}), mean=function(key){return answerable.reduce(function(n,r){return n+(r[key] || 0)},0)/answerable.length}
  print("QUALITY="+stringify({mode:mode,split:split,runtime:getVersion(),samples:results.length,passageRecallAtK:mean("recall"),mrr:mean("reciprocalRank"),results:results},__,""))
} finally {Object.keys(managers).forEach(function(k){managers[k].close()});io.rm(dir)}
