// Graph-lift evaluation: retrieval quality with the wiki graph off, structural and semantic.
// Runs the deterministic quality harness once per mode (stub model, no network).
(function() {
  exports.runQuality = function(graphMode) {
    var env = merge(getEnvs(), { WIKI_EVAL_GRAPH: graphMode, WIKI_EVAL_SPLIT: "graph-lift" })
    var out = $sh(["oaf", "-f", "tests/wikiRetrievalQuality.js"]).envs(env).get(0)
    var line = String(out.stdout).split("\n").filter(function(l) { return l.indexOf("QUALITY=") === 0 })[0]
    if (!isString(line)) throw new Error("no QUALITY output for graph mode " + graphMode + ": " + out.stderr)
    return jsonParse(line.substring(8))
  }

  // The graph must never lower recall, and each layer must add lift on the multi-hop queries.
  exports.testGraphLiftIsMonotonic = function() {
    var off = exports.runQuality("off")
    var structural = exports.runQuality("structural")
    var semantic = exports.runQuality("semantic")
    ow.test.assert(structural.passageRecallAtK >= off.passageRecallAtK, true, "structural graph must not lower recall")
    ow.test.assert(semantic.passageRecallAtK >= structural.passageRecallAtK, true, "semantic graph must not lower recall")
    ow.test.assert(semantic.passageRecallAtK > off.passageRecallAtK, true, "graph must add recall on multi-hop queries")
    ow.test.assert(semantic.mrr >= off.mrr, true, "graph must not lower MRR")
    log("graph-lift recall off=" + off.passageRecallAtK + " structural=" + structural.passageRecallAtK + " semantic=" + semantic.passageRecallAtK)
  }
})()
