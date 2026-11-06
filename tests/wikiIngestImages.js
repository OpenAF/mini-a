(function() {
  global.__mini_a_ingest_lib_mode = true
  global.__mini_a_dreams_lib_mode = true
  load('js/core/mini-a-common.js')
  load('js/wiki/mini-a-wiki.js')
  load('js/wiki/mini-a-wiki-knowledge.js')
  load('js/wiki/mini-a-ingest.js')
  var assert = function(a, b, message) { ow.test.assert(a, b, message) }
  var fixture = function(fn) {
    var src = String(io.createTempDir('ingest_images_src_')), wiki = String(io.createTempDir('ingest_images_wiki_'))
    var f = { src: src, wiki: wiki, calls: 0, distills: 0 }
    f.image = function(color) {
      var bitmap = new java.awt.image.BufferedImage(4, 4, java.awt.image.BufferedImage.TYPE_INT_RGB)
      bitmap.setRGB(0, 0, Number(color || 0))
      javax.imageio.ImageIO.write(bitmap, 'png', new java.io.File(src + '/diagram.png')); bitmap.flush()
    }
    f.image()
    f.runner = function(extra) {
      var runner = new MiniAIngest(merge({ usewiki: true, wikiaccess: 'rw', wikiroot: wiki, ingestsource: src,
        ingestsection: 'docs', ingestmode: 'normalize', model: { type: 'ollama', model: 'fixture', key: 'do-not-cache' } }, extra || {}), function() {})
      runner._getEnv = function() { return '' }
      runner._setLlm({ promptImage: function(prompt, image) { f.calls++; assert(String(image).indexOf('iVBOR'), 0, 'immutable image representation'); return 'Diagram text' },
        promptJSONWithStats: function() { f.distills++; return { response: { title: 'Diagram', body: '# Diagram\nDiagram text' } } } })
      return runner
    }
    f.run = function(extra) { return f.runner(extra).run() }
    f.cache = function(result) { return wiki + '/.mini-a-wiki-ingest/extractions/' + result.scope.id + '/' + sha1(result.scope.id + '|diagram.png') + '.json' }
    try { fn(f) } finally { io.rm(src); io.rm(wiki) }
  }
  exports.testImageBudgetDryRunAndCache = function() { fixture(function(f) {
    var settings = f.runner()._publicImageSettings({url:'https://user:secret@fixture.invalid/v1?api_key=secret&api-version=v2',auth:'hidden',params:{temperature:0.2,max_tokens:100,apiKey:'hidden'}})
    assert(settings.url,'https://fixture.invalid/v1?api-version=v2','endpoint keeps nonsecret query settings')
    assert(isDef(settings.auth),false,'auth omitted'); assert(settings.params.max_tokens,100,'output budget remains part of effective settings')
    var dry = f.run({ ingestdryrun: true })
    assert(f.calls, 0, 'dry run never calls vision'); assert(dry.deferred.length, 1, 'uncached vision is deferred')
    assert(io.fileExists(f.wiki + '/.mini-a-wiki-ingest/extractions'), false, 'dry run creates no extraction cache')
    var zero = f.run({ wikiingestbudget: 0 })
    assert(zero.llm_calls, 0, 'zero budget performs no provider calls'); assert(zero.deferred.length, 1, 'zero budget defers vision')
    var first = f.run()
    assert(first.ok, true, stringify(first)); assert(first.llm_calls, 1, 'vision included in actual call count')
    var cache = f.cache(first), cached = io.readFileString(cache)
    assert(cached.indexOf('do-not-cache'), -1, 'cache contains no model credentials')
    var second = f.run({ wikiingestbudget: 0, model: {type:'ollama',model:'fixture',key:'changed-secret'} })
    assert(second.ok, true, stringify(second)); assert(second.skipped_unchanged, 1, 'cached image hashes preserve existing provenance')
    assert(f.calls, 1, 'unchanged image and credential-only change do not invoke vision')
    var dryCached = f.run({ ingestdryrun:true, wikiingestbudget:0 })
    assert(dryCached.ok, true, 'dry run can read valid extraction cache'); assert(io.readFileString(cache), cached, 'dry cache read makes no writes')
    var before = io.readFileString(f.wiki + '/docs/diagram.md')
    f.image(0xff0000)
    var changed = f.run({ wikiingestbudget:0 })
    assert(changed.deferred.length, 1, 'changed image needs a budget'); assert(io.readFileString(f.wiki + '/docs/diagram.md'), before, 'deferred image preserves destination')
    var refreshed = f.run({ ingestforce:true })
    assert(refreshed.ok, true, stringify(refreshed)); assert(f.calls, 2, 'force refreshes once')
    var invalid = af.fromJson(io.readFileString(cache)); invalid.checksum = 'corrupt'; io.writeFileString(cache, stringify(invalid))
    assert(f.run({wikiingestbudget:0}).deferred.length, 1, 'invalid cache follows budgeted extraction')
    assert(f.run().ok, true, 'invalid cache can be replaced'); assert(f.calls, 3, 'invalid cache triggers one call')
    assert(f.run({model:{type:'ollama',model:'different'}}).ok, true, 'model change refreshes'); assert(f.calls, 4, 'nonsecret model settings form cache identity')
  }) }
  exports.testImageBudgetSharedWithDistillation = function() { fixture(function(f) {
    var imageOnly = f.run(), estimate = imageOnly.budget.estimated_input_tokens
    var output = imageOnly.budget.estimated_output_tokens
    io.rm(f.cache(imageOnly))
    var result = f.run({ingestmode:'distill',ingestforce:true,wikiingestbudget:estimate+output})
    assert(result.llm_calls, 1, 'one shared budget permits vision only'); assert(f.distills, 0, 'distillation cannot reuse spent vision budget')
    assert(result.deferred.length, 1, 'distillation deferred after image extraction')
    assert(result.budget.remaining, 0, 'shared operation budget consumed once')
    assert(result.budget.estimated_input_tokens > estimate, true, 'report includes both attempted phases')
    // Image representation is charged to total budget, independently of textual caps.
    var runner = f.runner({ingestforce:true,wikimaxprompttokens:80})
    var allowed = runner.run()
    assert(allowed.ok, true, stringify(allowed)); assert(allowed.llm_calls, 1, 'text prompt cap does not cap encoded image representation')
  }) }
  exports.testImagePruneAndByteValidation = function() { fixture(function(f) {
    io.writeFileString(f.src+'/remove.md','# Remove\nOld text')
    assert(f.run().ok, true, 'baseline'); io.rm(f.src+'/remove.md')
    var result = f.run({ingestprune:true,ingestforce:true})
    assert(result.ok, true, stringify(result)); assert(result.removed.length,1,'missing text page pruned')
    assert(f.calls, 2, 'force extracts once; prune validates bytes without calling vision')
    var before = io.readFileString(f.wiki+'/docs/diagram.md'), runner = f.runner({ingestforce:true})
    runner._llm.promptImage = function() { f.calls++; f.image(0x00ff00); return 'Changed during request' }
    var changed = runner.run()
    assert(changed.ok,false,'source changing during extraction rejected'); assert(changed.failed.length>0,true,'failed extraction reported')
    assert(io.readFileString(f.wiki+'/docs/diagram.md'), before, 'changed bytes cannot publish replacement')
  }) }
  exports.testIngestClientOwnership = function() { fixture(function(f) {
    var closed = 0, built = 0, runner = f.runner({ingestmode:'distill'})
    runner._setLlm(__)
    var factory = function() { built++; return { promptJSONWithStats:function(){return {response:{title:'Owned',body:'# Owned'}}}, getGPT:function(){return {model:{close:function(){closed++; throw new Error('close failure')}}}} } }
    runner._buildLlm = function() { this._distillLlmFactory = factory; return factory() }
    runner._describeImage = new Function('$llm', 'return ('+String(MiniAIngest.prototype._describeImage)+')')(function(){
      built++; return { promptImage:function(){return 'Owned vision'},getGPT:function(){return {model:{close:function(){closed++;throw new Error('close failure')}}}} }
    })
    var result = runner.run()
    assert(result.ok,true,stringify(result)); assert(built,3,'vision, initial distillation and isolated request clients created'); assert(closed,built,'all factory clients close despite cleanup failures')
    var failedVision = f.runner({ingestforce:true})
    failedVision._setLlm(__)
    failedVision._describeImage = new Function('$llm', 'return ('+String(MiniAIngest.prototype._describeImage)+')')(function(){
      built++; return { promptImage:function(){throw new Error('vision provider failure')},getGPT:function(){return {model:{close:function(){closed++;throw new Error('cleanup failure')}}}} }
    })
    assert(failedVision.run().ok,false,'owned vision failure reported'); assert(closed,built,'owned failed vision client closed')
    io.writeFileString(f.src+'/text.md','# Text\nForce distillation')
    var failedBatch = f.runner({ingestmode:'distill'})
    failedBatch._setLlm(__); failedBatch._buildLlm=function(){this._distillLlmFactory=factory;return factory()}
    failedBatch._distillAll=function(){throw new Error('batch failure')}
    assert(failedBatch.run().ok,false,'batch failure reported'); assert(closed,built,'initial owned client closed on batch failure')
    var history = [{role:'system',content:'policy'},{role:'user',content:'unrelated'}], original=stringify(history), injectedClosed=0
    var api = { getConversation:function(){return history},setConversation:function(v){history=v},model:{close:function(){injectedClosed++;throw new Error('must not close injected')}} }
    var injected = f.runner({ingestforce:true,ingestmode:'distill'})
    injected._setLlm({getGPT:function(){return api},promptImage:function(){history.push({role:'user',content:'vision'});throw new Error('vision failure')},promptJSONWithStats:function(){return {response:{title:'Injected',body:'# Injected'}}}})
    var failed=injected.run(); assert(failed.ok,false,'vision failure propagated'); assert(stringify(history),original,'injected vision conversation restored on failure')
    var direct=injected._distill(injected._llm,{rel:'a.md'},['test'],[])
    assert(direct.ok,true,'injected distillation succeeds'); assert(stringify(history),original,'injected distillation conversation restored'); assert(injectedClosed,0,'injected clients are never closed')
    var bad=f.runner(); bad._setLlm(__); bad._distillLlmFactory=function(){built++;return {prompt:function(){throw new Error('provider failure')},getGPT:function(){return {model:{close:function(){closed++}}}}}}
    assert(bad._distill({}, {rel:'a.md'},[],[]).error.indexOf('provider failure')>=0,true,'provider failure retained'); assert(closed,built,'failed factory request client closed')
  }) }
  return exports
})()
