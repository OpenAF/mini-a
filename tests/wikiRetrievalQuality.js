// Deterministic passage evidence evaluation; no model judging or runtime dependencies.
load("mini-a-common.js"); load("mini-a-wiki.js"); load("mini-a-wiki-knowledge.js")
var mode = String(getEnv("WIKI_EVAL_MODE") || "v2"), split = String(getEnv("WIKI_EVAL_SPLIT") || "held-out")
if (["development", "held-out", "acceptance"].indexOf(split) < 0 || ["v2", "legacy"].indexOf(mode) < 0) throw new Error("invalid evaluation mode/split")
var fixturePath = "tests/fixtures/wiki-retrieval-v2/" + split + ".json", fixtureRaw = io.readFileString(fixturePath), fixture = af.fromJson(fixtureRaw), dir = String(io.createTempDir("wiki-quality-")), managers = {}, results = []
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
    var evidence=(out.evidence || []).slice(0,q.k), support=q.support.map(function(s){return isString(s)?{text:s}:s}), supports=function(e,s){return (!s.path || s.path===e.path) && e.content.indexOf(s.text)>=0}, matches=support.filter(function(s){return evidence.some(function(e){return supports(e,s)})}), correct=0, chars=0, useful=0, hashes={}
    var citationChecks=[]
    evidence.forEach(function(e){var page=root.read(e.path), raw=String(page && page.raw || ""), checked=evidenceValidator.check(raw,e);citationChecks.push(checked);if(checked.correct)correct++;chars+=e.content.length;useful+=support.filter(function(s){return supports(e,s)}).reduce(function(n,s){return n+s.text.length},0);hashes[e.path+":"+sha1(e.content)]=true})
    var rank=0;for(var i=0;i<evidence.length;i++)if(support.some(function(s){return supports(evidence[i],s)})){rank=i+1;break}
    results.push({query:q.query,k:q.k,recall:support.length?matches.length/support.length:null,reciprocalRank:rank?1/rank:0,citationRangeCorrectness:evidence.length?correct/evidence.length:null,citationChecks:citationChecks,duplicateFraction:evidence.length?1-Object.keys(hashes).length/evidence.length:0,usefulCharsPerEstimatedContentToken:chars?useful/Math.ceil(chars/4):0,outcome:out.outcome || (evidence.length?"hits":"zero"),expectedUnanswerable:support.length===0,unanswerableCorrect:support.length===0?evidence.length===0:null,evidencePaths:evidence.map(function(e){return e.path})})
  })
  var answerable=results.filter(function(r){return r.recall!==null}), unanswerable=results.filter(function(r){return r.expectedUnanswerable}), mean=function(key){return answerable.reduce(function(n,r){return n+(r[key] || 0)},0)/answerable.length}
  print("QUALITY="+stringify({evaluationVersion:3,mode:mode,split:split,runtime:getVersion(),fixtureSha1:sha1(fixtureRaw),sourceSha1:{wiki:sha1(io.readFileString("mini-a-wiki.js")),knowledge:sha1(io.readFileString("mini-a-wiki-knowledge.js")),retrieval:io.fileExists("mini-a-wiki-retrieval.js")?sha1(io.readFileString("mini-a-wiki-retrieval.js")):null,harness:sha1(io.readFileString("tests/wikiRetrievalQuality.js"))},samples:results.length,answerableSamples:answerable.length,unanswerableSamples:unanswerable.length,passageRecallAtK:mean("recall"),mrr:mean("reciprocalRank"),unanswerableCorrect:unanswerable.filter(function(r){return r.unanswerableCorrect}).length,results:results},__,""))
} finally {Object.keys(managers).forEach(function(k){managers[k].close()});io.rm(dir)}
