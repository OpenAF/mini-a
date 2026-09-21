(function() {
  global.__mini_a_ingest_lib_mode = true
  global.__mini_a_dreams_lib_mode = true
  load('mini-a-common.js')
  load('mini-a-wiki.js')
  load('mini-a-wiki-knowledge.js')
  load('mini-a-ingest.js')
  var assert = function(actual, expected, message) { ow.test.assert(actual, expected, message) }
  var fixture = function(fn) {
    var src = String(io.createTempDir('reconcile_src_')), wiki = String(io.createTempDir('reconcile_wiki_'))
    var f = { src: src, wiki: wiki, prompts: [] }
    f.write = function(name, body) { io.writeFileString(src + '/' + name, body) }
    f.state = function() { return af.fromJson(io.readFileString(wiki + '/.mini-a-wiki-state/manifest.json')) }
    f.save = function(s) { io.writeFileString(wiki + '/.mini-a-wiki-state/manifest.json', stringify(s)) }
    f.runner = function(extra) {
      var args = merge({ usewiki: true, wikiaccess: 'rw', wikiroot: wiki, ingestsource: src, ingestsection: 'docs', ingestmode: 'normalize', ingestconcurrency: 1 }, extra || {})
      if (extra && extra.wikimanager) args.wikimanager = extra.wikimanager
      var r = new MiniAIngest(args, function() {})
      r._setLlm({ promptJSONWithStats: function(p) {
        f.prompts.push(p)
        return { response: { title: 'Complete source', description: 'Complete source', type: 'reference', tags: [], body: '# Complete source\n\n' + p.split('## Content\n')[1] } }
      } })
      return r
    }
    f.run = function(extra) { return f.runner(extra).run() }
    f.body = function(path) { return io.readFileString(wiki + '/' + path) }
    f.initial = function() { f.write('a.md', '# A\n\n## One\n\nFIRST\n\n## Two\n\nSECOND\n\n## Three\n\nTHIRD'); f.write('b.md', '# B\n\nB remains'); return f.run() }
    try { fn(f) } finally { io.rm(src); io.rm(wiki) }
  }
  exports.testLegacyContextProvenance = function() { fixture(function(f) {
    f.write('a.md','# Original source\nSOURCE_ONLY_PARAMETER is original transformation input.')
    var runner=f.runner({ingestmode:'distill'})
    runner._setLlm({promptJSONWithStats:function(){return {response:{title:'Distilled page',description:'Distilled page',type:'reference',tags:[],body:'# Distilled\nDISTILLED_ONLY_PARAMETER is the wiki answer.'}}}})
    assert(runner.run().ok,true,'simulated distillation publishes an owned complete-source page')
    var wm=new MiniAWikiManager({backend:'fs',root:f.wiki,access:'ro',wikiretrievalv2:false},function(){})
    try {
      wm.assembleContext=wm._assembleContextPlaceholder
      global.__miniAWikiKnowledge.install(wm)
      assert(wm.assembleContext!==wm._assembleContextPlaceholder,true,'explicit installer replaces a core placeholder across module scopes')
      var installedAssembly=wm.assembleContext, customAssembly=function(){return {custom:true}}
      wm.assembleContext=customAssembly;global.__miniAWikiKnowledge.install(wm)
      assert(wm.assembleContext===customAssembly,true,'installer preserves custom context implementations')
      wm.assembleContext=installedAssembly
      wm.search=function(){return [{path:'docs/a.md',score:1}]}
      var context=wm.assembleContext('DISTILLED_ONLY_PARAMETER'), chunk=context.chunks[0], page=wm.read('docs/a.md')
      assert(context.chunks.length,1,'legacy context keeps existing source-input selection')
      assert(chunk.text.indexOf('SOURCE_ONLY_PARAMETER')>=0,true,'source chunk differs from distilled wiki answer')
      assert(page.raw.indexOf('SOURCE_ONLY_PARAMETER')<0,true,'source text does not occupy wiki citation positions')
      assert(chunk.origin,'original-source','owned ingestion input has explicit source origin')
      assert(chunk.evidenceRole,'ingestion-input','source input is not advertised as wiki passage evidence')
      assert(chunk.quotationStatus,'not-a-verbatim-wiki-quotation','legacy mapping does not impersonate a wiki quotation')
      assert(chunk.sourceLocatorStatus,'unverified','legacy records do not invent a valid original-source locator')
      assert(chunk.wikiPath,'docs/a.md','destination path is retained for navigation compatibility')
      assert(chunk.scoreOrigin,'parent-wiki-page','legacy chunk score is explicitly inherited from its parent')
      assert(isDef(chunk.lineStart)||isDef(chunk.revision)||isDef(chunk.citation),false,'source input inherits no wiki positions revisions or citations')
      wm.search=function(){return {error:'invalid-query',outcome:'invalid-query'}}
      var invalid=wm.assembleContext('title:(')
      assert(invalid.ok,false,'legacy context propagates explicit search failure')
      assert(invalid.error,'invalid-query','query failure is not flattened to empty successful context')
      assert(invalid.chunks.length,0,'failure retains compatible empty chunk envelope')
      wm.search=function(){return []}
      assert(wm.assembleContext('unanswerable').chunks.length,0,'healthy legacy zero remains a successful empty context')
    } finally {wm.close()}
  }) }
  exports.testFullDistillation = function() { fixture(function(f) {
    f.initial(); f.write('a.md', '# A\n\n## One\n\nFIRST\n\n## Two\n\nCHANGED\n\n## Three\n\nTHIRD')
    var r = f.run({ ingestmode: 'distill' })
    assert(r.ok, true, stringify(r)); assert(f.prompts[0].indexOf('FIRST') >= 0 && f.prompts[0].indexOf('THIRD') >= 0, true, 'complete distill input')
    f.write('a.md', '# A\n\n## One\n\nFIRST\n\n## Three\n\nTHIRD')
    r = f.run({ ingestmode: 'distill' }); assert(r.ok, true, stringify(r))
    assert(f.body('docs/a.md').indexOf('CHANGED') < 0, true, 'removed section cannot survive'); assert(f.body('docs/a.md').indexOf('THIRD') >= 0, true, 'remaining section preserved')
    r = f.run({ ingestmode: 'distill', ingestforce: true }); assert(r.ok, true, stringify(r)); assert(f.prompts[f.prompts.length - 2].indexOf('FIRST') >= 0, true, 'force uses complete input')
    assert(f.state().sources[Object.keys(f.state().sources)[0]].chunks.length > 0, true, 'complete manifest')
  }) }
  exports.testDeterministicModes = function() { fixture(function(f) {
    f.write('a.md', '# A\n\n## One\n\nFIRST\n\n## Two\n\nSECOND')
    ;['normalize', 'raw', 'auto'].forEach(function(mode) {
      var runner = f.runner({ ingestmode: mode, ingestforce: true }); runner._buildLlm = function() { throw new Error('LLM forbidden') }
      assert(runner.run().ok, true, mode + ' deterministic')
    })
    f.write('a.md', '# A\n\n## One\n\nFIRST'); assert(f.run({ ingestmode: 'raw' }).ok, true, 'raw deletion-only update')
    assert(f.body('docs/a.md').indexOf('SECOND') < 0, true, 'raw removes deleted content')
  }) }
  exports.testBudgetDeferral = function() { fixture(function(f) {
    f.initial(); var before = f.body('docs/a.md'), state = stringify(f.state())
    f.write('a.md', '# A\n\n' + repeat(10000, 'oversized '))
    var r = f.run({ ingestmode: 'distill', wikimaxprompttokens: 100 })
    assert(r.ok, false, 'budget blocks success'); assert(r.deferred.length > 0, true, 'full prompt deferred'); assert(r.llm_calls, 0, 'no partial call')
    assert(f.body('docs/a.md'), before, 'last applied page retained'); assert(stringify(f.state()), state, 'applied hash unchanged')
  }) }
  exports.testMissingPageAndFingerprintRepair = function() { fixture(function(f) {
    f.initial(); assert(f.run().status, 'noop', 'second run no-op')
    io.rm(f.wiki + '/docs/a.md'); var r = f.run(); assert(r.written.length, 1, 'missing page repaired')
    r = f.run({ ingestmode: 'raw' }); assert(r.written.length, 2, 'mode invalidates hash skip')
    r = f.run({ ingestsection: 'elsewhere' }); assert(r.written.length, 2, 'new destination scope')
  }) }
  exports.testPruneAndRemovalFinalization = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var r = f.run()
    assert(r.ok, true, 'upsert succeeds'); assert(r.missing_sources.length, 1, 'missing source reported'); assert(r.sync_complete, false, 'upsert is not mirror'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'default preserves')
    r = f.run({ ingestprune: true }); assert(r.ok, true, stringify(r)); assert(r.removed.length, 1, 'prune removed page'); assert(r.written.length, 0, 'removal only'); assert(r.finalize.reindexed, true, 'removal finalizes'); assert(r.sync_complete, true, 'scope synchronized')
    assert(Object.keys(f.state().chunks).some(function(k) { return f.state().chunks[k].page === 'docs/b.md' }), false, 'exclusive chunks retired')
    assert(f.body('docs/index.md').indexOf('b.md') < 0, true, 'generated index no stale reference')
  }) }
  exports.testEmptyOriginAuthorization = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/a.md'); io.rm(f.src + '/b.md')
    var r = f.run({ ingestprune: true }); assert(r.ok, false, 'empty origin blocked'); assert(r.removed.length, 0, 'no empty prune')
    r = f.run({ ingestprune: true, ingestallowemptyprune: true }); assert(r.ok, true, stringify(r)); assert(r.removed.length, 2, 'explicit empty prune')
  }) }
  exports.testMissingOriginNeverPrunes = function() { fixture(function(f) {
    f.initial(); var r = f.run({ ingestsource: f.src + '/missing', ingestprune: true, ingestallowemptyprune: true })
    assert(r.ok, false, 'missing origin fails'); assert(io.fileExists(f.wiki + '/docs/a.md'), true, 'missing origin preserves wiki')
  }) }
  exports.testIncompleteDiscoveryBlocksPrune = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var runner = f.runner({ ingestprune: true }), discover = runner._discover
    runner._discover = function(r) { var v = discover.call(this, r); v.complete = false; v.errors = ['fault: listing']; return v }
    var r = runner.run(); assert(r.ok, false, 'incomplete discovery fails'); assert(r.prune_blocked.length > 0, true, 'prune blocked'); assert(r.removed.length, 0, 'no deletion')
  }) }
  exports.testPresentIneligibleSources = function() { fixture(function(f) {
    f.initial(); f.write('b.md', ''); var r = f.run({ ingestprune: true }); assert(r.missing_sources.length, 0, 'empty is present'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'empty preserves')
    f.write('b.md', repeat(2000, 'x')); r = f.run({ ingestprune: true, ingestmaxfilekb: 1 }); assert(r.missing_sources.length, 0, 'oversized is present')
    r = f.run({ ingestprune: true, ingestexclude: 'b.md' }); assert(r.missing_sources.length, 0, 'excluded is present')
    var runner = f.runner({ ingestprune: true }), read = runner._readSource; runner._readSource = function(s) { return s.id === 'b.md' ? __ : read.call(this, s) }
    r = runner.run(); assert(r.missing_sources.length, 0, 'unreadable is present'); assert(r.ok, false, 'unreadable unresolved')
  }) }
  exports.testChangedFiltersBlockPrune = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var r = f.run({ ingestprune: true, ingestinclude: 'a.md' })
    assert(r.prune_blocked.length, 1, 'incompatible selection blocks deletion'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'filtered scope preserved')
  }) }
  exports.testUrlPruneRejected = function() { fixture(function(f) {
    var r = f.run({ ingestsource: 'https://example.invalid/a', ingesttype: 'url', ingestprune: true })
    assert(r.ok, false, 'URL prune rejected'); assert(r.reason.indexOf('complete site inventory') >= 0, true, 'explicit explanation')
  }) }
  exports.testRenameReconciliation = function() { fixture(function(f) {
    f.initial(); io.writeFileString(f.src + '/renamed.md', io.readFileString(f.src + '/b.md')); io.rm(f.src + '/b.md')
    var r = f.run({ ingestprune: true }); assert(r.ok, true, stringify(r)); assert(r.written.length, 1, 'new source creates'); assert(r.removed.length, 1, 'old source removed')
  }) }
  exports.testChunkIdentityAndRetrieval = function() { fixture(function(f) {
    f.write('a.md', '# A\n\n## Examples\n\nOLD\n\n## Examples\n\nKEEP'); f.run()
    var s = f.state(), ids = Object.keys(s.chunks); assert(ids.length, 3, 'repeated headings distinct')
    f.write('a.md', '# A\n\n## Examples\n\nKEEP'); f.run(); s = f.state(); assert(Object.keys(s.chunks).length, 2, 'removed chunks collected')
    var wm = new MiniAWikiManager({ backend: 'fs', root: f.wiki, access: 'ro' }, function() {})
    Object.keys(global.__miniAWikiKnowledge.methods).forEach(function(k) { wm[k] = global.__miniAWikiKnowledge.methods[k] })
    wm.search = function() { return [{ path: 'docs/a.md', score: 1 }] }
    var stale = { id: 'stale', page: 'docs/a.md', sourceKey: Object.keys(s.sources)[0], generation: 'old', hash: 'old', normalizedHash: 'old', text: 'OLD', estimatedTokens: 1 }; s.chunks.stale = stale; f.save(s)
    assert(wm.assembleContext('A').chunks.some(function(c) { return c.text.indexOf('OLD') >= 0 }), false, 'stale generation excluded')
    wm.close(); f.run({ ingestforce: true }); assert(Object.keys(f.state().chunks).length, 2, 'explicitly owned orphan retired')
  }) }
  exports.testOriginNamespacesAndNaming = function() { fixture(function(f) {
    f.write('api.md', '# API\n\nFirst'); f.write('index.md', '# Reserved\n\nSafe'); f.write('a b.md', '# Space\n\nSafe'); f.write('a-b.md', '# Dash\n\nSafe'); f.write('世界.md', '# Unicode\n\nSafe')
    var r = f.run(); assert(r.ok, true, stringify(r)); assert(r.written.length, 5, 'unique mappings')
    assert(r.written.indexOf('docs/index.md'), -1, 'reserved index avoided')
    var ids = Object.keys(f.state().chunks); r = f.run({ ingestsourceid: 'second-origin' }); assert(r.ok, true, stringify(r)); assert(r.written.length, 5, 'other origin receives new mappings')
    assert(Object.keys(f.state().chunks).length, ids.length * 2, 'equal relative paths across origins cannot collide')
  }) }
  exports.testManualEditConflicts = function() { fixture(function(f) {
    f.initial(); io.writeFileString(f.wiki + '/docs/a.md', f.body('docs/a.md') + '\nMANUAL EDIT'); f.write('a.md', '# A\n\nNew source'); io.rm(f.src + '/b.md')
    var r = f.run({ ingestforce: true, ingestprune: true }); assert(r.ok, false, 'force does not bypass conflict'); assert(r.conflicts.length, 1, 'edit reported'); assert(r.removed.length, 0, 'conflict blocks destructive phase'); assert(f.body('docs/a.md').indexOf('MANUAL EDIT') >= 0, true, 'manual edit preserved')
  }) }
  exports.testManualUnownedPage = function() { fixture(function(f) {
    io.mkdir(f.wiki + '/docs'); io.writeFileString(f.wiki + '/docs/a.md', '# Manual\n\nPreserve'); f.write('a.md', '# Source\n\nNew')
    var r = f.run(); assert(r.ok, true, stringify(r)); assert(r.written[0] !== 'docs/a.md', true, 'unowned page not claimed'); assert(f.body('docs/a.md').indexOf('Preserve') >= 0, true, 'manual page retained')
  }) }
  exports.testSharedChunksAndDerivativeInvalidation = function() { fixture(function(f) {
    f.initial(); var s = f.state(), keys = Object.keys(s.sources), removed = keys.filter(function(k) { return s.sources[k].source === 'b.md' })[0], keep = keys.filter(function(k) { return k !== removed })[0]
    var shared = s.sources[removed].chunks[0]; s.sources.sharedProducer = { scopeId: 'other', page: 'manual.md', chunks: [shared], active: true }
    s.facts.shared = { sources: [removed, keep], text: 'derived' }; s.dependencies['docs/b.md'] = ['derived']; s.summaries.sections.derived = { text: 'old' }; f.save(s)
    io.rm(f.src + '/b.md'); var r = f.run({ ingestprune: true }); assert(r.ok, true, stringify(r)); s = f.state()
    assert(isDef(s.chunks[shared.id]), true, 'referenced chunk preserved'); assert(s.facts.shared.invalidated, true, 'multi-source fact invalidated'); assert(s.facts.shared.sources.indexOf(keep) >= 0, true, 'valid contributor retained'); assert(isDef(s.summaries.sections.derived), false, 'dependent summary invalidated')
  }) }
  exports.testCorruptManifestBlocksPrune = function() { fixture(function(f) {
    f.initial(); io.writeFileString(f.wiki + '/.mini-a-wiki-state/manifest.json', '{broken'); io.rm(f.src + '/b.md')
    var r = f.run({ ingestprune: true }); assert(r.ok, false, 'corrupt manifest fails closed'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'corrupt state never authorizes deletion')
  }) }
  exports.testLegacyMigration = function() { fixture(function(f) {
    f.initial(); var s = f.state(), old = {}, root = String(new java.io.File(f.src).getCanonicalPath())
    Object.keys(s.sources).forEach(function(k) { var v = s.sources[k], key = sha1('markdown|' + root + '|' + v.source); old[key] = { source: v.source, sourceHash: v.sourceHash, page: v.page, chunks: v.chunks.slice(0, 1) } })
    s.version = 1; s.sources = old; f.save(s)
    var r = f.run(); assert(r.ok, true, stringify(r)); assert(r.migrated.length, 2, 'validated records reassociated'); assert(io.fileExists(f.wiki + '/.mini-a-wiki-ingest/pre-migration.json'), true, 'migration backup')
    assert(f.run().status, 'noop', 'migration idempotent'); assert(Object.keys(f.state().chunks).length, 5, 'full chunks repaired')
  }) }
  exports.testAmbiguousLegacyPreserved = function() { fixture(function(f) {
    f.initial(); var s = f.state(), k = Object.keys(s.sources).filter(function(k) { return s.sources[k].source === 'b.md' })[0]
    delete s.sources[k].scopeId; f.save(s); io.rm(f.src + '/b.md'); var r = f.run({ ingestprune: true })
    assert(r.unresolved.length > 0, true, 'unknown ownership reported'); assert(r.sync_complete, false, 'unresolved is not synchronized'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'ambiguous legacy preserved')
  }) }
  exports.testLlmFailureKeepsAppliedVersion = function() { fixture(function(f) {
    f.initial(); var before = f.body('docs/a.md'); f.write('a.md', '# A\n\nNew'); io.rm(f.src + '/b.md')
    var runner = f.runner({ ingestmode: 'distill', ingestprune: true }); runner._setLlm({ prompt: function() { throw new Error('fault: LLM') } })
    var r = runner.run(); assert(r.ok, false, 'LLM failure fails'); assert(r.removed.length, 0, 'failed distill blocks prune'); assert(f.body('docs/a.md'), before, 'old page retained')
    assert(f.run({ ingestmode: 'distill', ingestprune: true }).ok, true, 'retry eligible')
  }) }
  exports.testFinalizeRecovery = function() { fixture(function(f) {
    var runner = f.runner(); f.write('a.md', '# A\n\nSource'); runner._finalize = function() { return { ok: false, reindexed: false } }
    var r = runner.run(); assert(r.ok, false, 'finalize failure partial'); assert(r.status, 'partial', 'partial result'); assert(io.fileExists(f.wiki + '/.mini-a-wiki-ingest/journal.json'), true, 'pending journal retained')
    r = f.run(); assert(r.ok, true, stringify(r)); assert(r.recovered, true, 'pending finalization recovered'); assert(r.llm_calls, 0, 'no redistillation'); assert(f.run().status, 'noop', 'recovery idempotent')
  }) }
  exports.testDryRunNoDestinationMutation = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); f.write('a.md', '# A\n\nChanged')
    var snapshot = function(dir) { var out = {}; var walk = function(d) { io.listFiles(d).files.forEach(function(x) { if (x.isDirectory) walk(x.canonicalPath); else out[String(x.canonicalPath)] = [sha1(io.readFileString(x.canonicalPath)), String(new java.io.File(x.canonicalPath).lastModified())] }) }; walk(dir); return stringify(out) }
    var before = snapshot(f.wiki), r = f.run({ ingestdryrun: true, ingestprune: true, ingestmode: 'distill' })
    assert(r.status, 'planned', 'dry-run planned'); assert(r.planned_writes.length, 1, 'same destination identity plans current changed source'); assert(r.planned_removals.length, 1, 'canonical destination identity preserves dry prune scope'); assert(r.written.length, 0, 'no applied writes'); assert(r.removed.length, 0, 'no applied deletes'); assert(f.prompts.length, 0, 'no dry-run LLM'); assert(snapshot(f.wiki), before, 'all destination bytes and timestamps unchanged')
    var nonexistent = f.wiki + '/nonexistent'; r = f.run({ ingestdryrun: true, wikiroot: nonexistent }); assert(r.ok, true, stringify(r)); assert(io.fileExists(nonexistent), false, 'no destination initialization')
  }) }
  exports.testBorrowedRemoteContractsAndFailures = function() { fixture(function(f) {
    f.write('a.md', '# A\n\nSource'); f.write('b.md', '# B\n\nSource')
    var pages = {}, state, closed = 0, saveFails = false, deleteFails = false, writeFails = false
    var wm = Object.create(MiniAWikiManager.prototype)
    wm._access = 'rw'; wm._backendType = 'es'; wm._config = { esurl: 'mock://es', esindex: 'wiki', indexdir: f.wiki }; wm._logFn = function() {}
    wm._backend = { root: f.wiki, read: function(p) { return pages[p] } }
    wm.close = function() { closed++ }; wm.knowledgeLoadState = function() { return state ? af.fromJson(stringify(state)) : wm._knowledgeEmptyState() }
    wm.knowledgeSaveState = function(s) { if (saveFails) return false; state = af.fromJson(stringify(s)); return true }
    wm.write = function(p, m, b) { if (writeFails) return { ok: false, error: 'fault: write' }; pages[p] = wm._serializeFrontmatter(m, b); return { ok: true } }
    wm.delete = function(p) { if (deleteFails) return { ok: false, error: 'fault: delete' }; delete pages[p]; return { ok: true } }
    var run = function(extra) { var params = merge({}, extra || {}); params.wikimanager = wm; var runner = f.runner(params); runner._finalize = function() { return { ok: true, reindexed: true } }; return runner.run() }
    var initial = run(); assert(initial.ok, true, 'simulated remote write: ' + stringify(initial)); assert(closed, 0, 'borrowed manager never closed')
    f.write('a.md', '# A\n\nChanged'); saveFails = true; var r = run(); assert(r.ok, false, 'state persistence failure reported'); saveFails = false
    r = run(); assert(r.ok, true, stringify(r)); assert(r.recovered, true, 'page-before-manifest interruption recovered')
    io.rm(f.src + '/b.md'); deleteFails = true; r = run({ ingestprune: true }); assert(r.ok, false, 'delete failure reported'); deleteFails = false
    r = run({ ingestprune: true }); assert(r.ok, true, stringify(r)); assert(isDef(pages['docs/b.md']), false, 'recovered delete')
    f.write('a.md', '# A\n\nAnother'); writeFails = true; r = run(); assert(r.ok, false, 'write failure reported'); writeFails = false; assert(run().ok, true, 'write recovery succeeds')
    assert(closed, 0, 'all borrowed-manager paths preserve ownership')
  }) }
  exports.testConcurrentManifestChange = function() { fixture(function(f) {
    f.initial(); f.write('a.md', '# A\n\nChanged')
    var runner = f.runner({ ingestmode: 'distill' }); runner._setLlm({ promptJSONWithStats: function(p) {
      var s = f.state(); s.telemetry.concurrent = true; f.save(s)
      return { response: { title: 'A', body: '# A\n\nChanged' } }
    } })
    var r = runner.run(); assert(r.ok, false, 'concurrent state rejected'); assert(r.error.indexOf('concurrently') >= 0, true, 'concurrency reason'); assert(f.state().telemetry.concurrent, true, 'concurrent update preserved'); assert(f.body('docs/a.md').indexOf('FIRST') >= 0, true, 'no lost-update write')
  }) }
  exports.testSourceChangesBlockPrune = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var runner = f.runner({ ingestprune: true }), discover = runner._discover, n = 0
    runner._discover = function(r) { n++; if (n === 2) f.write('b.md', '# B\n\nReappeared'); return discover.call(this, r) }
    var r = runner.run(); assert(r.ok, false, 'source race blocks sync'); assert(r.removed.length, 0, 'reappeared source preserved')
  }) }
  exports.testReorderingAndRepeatedCycles = function() { fixture(function(f) {
    f.initial()
    for (var i = 0; i < 3; i++) {
      f.write('a.md', '# A\n\n## Three\n\nTHIRD\n\n## One\n\nFIRST' + i)
      var r = f.run({ ingestmode: 'distill' }); assert(r.ok, true, stringify(r))
      var prompt = f.prompts.filter(function(p) { return p.indexOf('## Source\na.md\n') >= 0 }).pop(); assert(prompt.indexOf('THIRD') < prompt.indexOf('FIRST'), true, 'current section order')
      assert(Object.keys(f.state().chunks).length, 4, 'repeated cycles do not accumulate chunks')
    }
  }) }
  exports.testExistingWikiMoveBinding = function() { fixture(function(f) {
    f.initial(); var wm = new MiniAWikiManager({ backend: 'fs', root: f.wiki, access: 'rw' }, function() {})
    assert(wm.move('docs/a.md', 'docs/moved.md').ok, true, 'wiki tool move'); wm.close()
    var r = f.run(); assert(r.ok, true, stringify(r)); assert(io.fileExists(f.wiki + '/docs/a.md'), false, 'old path is not recreated'); assert(r.written[0], 'docs/moved.md', 'unique moved binding repaired')
  }) }
  exports.testDryMigrationNoWrite = function() { fixture(function(f) {
    f.initial(); var s = f.state(), old = {}, root = String(new java.io.File(f.src).getCanonicalPath())
    Object.keys(s.sources).forEach(function(k) { var v = s.sources[k]; old[sha1('markdown|' + root + '|' + v.source)] = { source: v.source, sourceHash: v.sourceHash, page: v.page, chunks: v.chunks.slice(0, 1) } })
    s.sources = old; f.save(s); var before = io.readFileString(f.wiki + '/.mini-a-wiki-state/manifest.json'), r = f.run({ ingestdryrun: true })
    assert(r.ok, true, stringify(r)); assert(io.readFileString(f.wiki + '/.mini-a-wiki-state/manifest.json'), before, 'dry migration changes no manifest'); assert(io.fileExists(f.wiki + '/.mini-a-wiki-ingest/pre-migration.json'), false, 'no dry migration backup mutation')
  }) }
  exports.testReadOnlyEntryAndBorrowedManager = function() { fixture(function(f) {
    f.initial(); var wm = new MiniAWikiManager({ backend: 'fs', root: f.wiki, access: 'rw' }, function() {}), closed = false, originalClose = wm.close
    wm.close = function() { closed = true }
    var r = f.runner({ wikimanager: wm, ingestforce: true }); assert(r._args.wikimanager === wm, true, 'original borrowed instance retained'); assert(r.run().ok, true, 'borrowed real writer reused'); assert(closed, false, 'borrowed writer is not closed')
    assert(f.run({ wikiaccess: 'ro', ingestforce: true }).ok, false, 'explicit ro refused'); originalClose.call(wm)
    var wrapper = io.readFileString('mini-a-ingest.yaml'); assert(wrapper.indexOf('isDef(args.wikiaccess) ? args.wikiaccess') >= 0, true, 'standalone preserves explicit access')
  }) }
  exports.testWikiWriterLock = function() { fixture(function(f) {
    f.initial(); var file = new java.io.RandomAccessFile(f.wiki + '/.mini-a-wiki-ingest/writer.lock', 'rw'), channel = file.getChannel(), lock = channel.lock()
    try { var r = f.run({ ingestforce: true }); assert(r.ok, false, 'concurrent ingestion rejected'); assert(r.written.length, 0, 'locked writer applies nothing') }
    finally { lock.release(); channel.close(); file.close() }
  }) }
  exports.testDeleteBeforeManifestRecovery = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var runner = f.runner({ ingestprune: true }), apply = runner._applyJournal
    runner._applyJournal = function(wm, journal, path, result) {
      var save = wm.knowledgeSaveState; wm.knowledgeSaveState = function() { return false }
      try { return apply.call(this, wm, journal, path, result) } finally { wm.knowledgeSaveState = save }
    }
    var r = runner.run(); assert(r.ok, false, 'delete-before-state failure reported'); assert(io.fileExists(f.wiki + '/docs/b.md'), false, 'page delete applied before interruption')
    r = f.run({ ingestprune: true }); assert(r.ok, true, stringify(r)); assert(r.recovered, true, 'already absent deletion recovered'); assert(f.run({ ingestprune: true }).status, 'noop', 'repeat recovery idempotent')
  }) }
  exports.testPendingJournalSuppressesRetrieval = function() { fixture(function(f) {
    f.initial(); f.write('a.md', '# A\n\nNew'); var runner = f.runner(); runner._finalize = function() { return { ok: false, reindexed: false } }; assert(runner.run().ok, false, 'pending finalize journal')
    var wm = new MiniAWikiManager({ backend: 'fs', root: f.wiki, access: 'ro' }, function() {})
    Object.keys(global.__miniAWikiKnowledge.methods).forEach(function(k) { wm[k] = global.__miniAWikiKnowledge.methods[k] }); wm.search = function() { return [{ path: 'docs/a.md' }] }
    assert(wm.assembleContext('A').chunks.length, 0, 'pending affected evidence suppressed'); wm.close()
  }) }
  exports.testCorruptLedgerBlocksApproximateMigration = function() { fixture(function(f) {
    f.initial(); io.writeFileString(f.wiki + '/.mini-a-wiki-ingest/ledger.json', '{corrupt'); io.rm(f.src + '/b.md')
    var r = f.run({ ingestprune: true }); assert(r.ok, false, 'unreadable ledger fails closed'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'no approximate ownership prune')
  }) }
  exports.testAtomicJournalFailure = function() { fixture(function(f) {
    f.initial(); var before = f.body('docs/a.md'); f.write('a.md', '# A\n\nChanged')
    var runner = f.runner(); runner._atomicJson = function() { throw new Error('fault: atomic persistence unavailable') }
    var r = runner.run(); assert(r.ok, false, 'prepared journal must persist'); assert(f.body('docs/a.md'), before, 'no page writes without persisted journal')
  }) }
  exports.testSeparateUrlsDoNotPrune = function() { fixture(function(f) {
    var make = function(url) { var runner = f.runner({ ingestsource: url, ingesttype: 'url', ingestsection: 'web' }); runner._readSource = function() { return '# URL\n\n' + url }; return runner.run() }
    assert(make('https://example.invalid/a').ok, true, 'first individual URL'); var r = make('https://example.invalid/b'); assert(r.ok, true, stringify(r)); assert(Object.keys(f.state().sources).length, 2, 'other URL origin preserved')
  }) }
  exports.testLegacyEditsWithoutSignaturePreserved = function() { fixture(function(f) {
    f.initial(); var s = f.state(), old = {}, root = String(new java.io.File(f.src).getCanonicalPath())
    Object.keys(s.sources).forEach(function(k) { var v = s.sources[k]; old[sha1('markdown|' + root + '|' + v.source)] = { source: v.source, sourceHash: v.sourceHash, page: v.page, chunks: v.chunks } })
    s.sources = old; f.save(s); io.writeFileString(f.wiki + '/docs/a.md', f.body('docs/a.md') + '\nMANUAL LEGACY EDIT')
    var r = f.run(); assert(r.ok, false, 'legacy provenance is not last-write proof'); assert(f.body('docs/a.md').indexOf('MANUAL LEGACY EDIT') >= 0, true, 'legacy edit preserved')
    io.rm(f.wiki + '/docs/a.md'); r = f.run(); assert(r.ok, true, stringify(r)); assert(f.body('docs/a.md').indexOf('FIRST') >= 0, true, 'reviewed missing legacy destination rebuilt completely')
  }) }
  exports.testConcurrentChangesDuringApplication = function() { fixture(function(f) {
    f.initial(); f.write('a.md', '# A\n\nNew'); var runner = f.runner(), apply = runner._applyJournal
    runner._applyJournal = function(wm, journal, path, result) {
      var write = wm.write; wm.write = function(p, m, b) { var r = write.call(this, p, m, b), s = f.state(); s.telemetry.concurrent = true; f.save(s); return r }
      try { return apply.call(this, wm, journal, path, result) } finally { wm.write = write }
    }
    var r = runner.run(); assert(r.ok, false, 'commit refuses concurrent manifest change'); assert(f.state().telemetry.concurrent, true, 'concurrent namespace update retained'); assert(r.error.indexOf('concurrently during application') >= 0, true, 'explicit recovery review needed')
  }) }
  exports.testPreparedRecoveryWithIncompleteOrigin = function() { fixture(function(f) {
    f.initial(); io.rm(f.src + '/b.md'); var runner = f.runner({ ingestprune: true }); runner._applyJournal = function() { throw new Error('fault: interruption before pages') }
    assert(runner.run().ok, false, 'prepared journal left for recovery')
    runner = f.runner({ ingestprune: true }); var discover = runner._discover; runner._discover = function(r) { var v = discover.call(this, r); v.complete = false; return v }
    var r = runner.run(); assert(r.ok, false, 'incomplete recovery inventory blocked'); assert(io.fileExists(f.wiki + '/docs/b.md'), true, 'recovery never deletes on inaccessible inventory')
  }) }
})()
