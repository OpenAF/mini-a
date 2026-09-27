(function() {
  load('mini-a-common.js'); load('mini-a-wiki.js')
  var temp = function() { return String(io.createTempDir('wiki-federation-parity-')) }
  var catalog = function(mounts) { return __miniAWikiCreatePrimary(__miniAWikiPrimaryConfig({wikiretrievalv2:true,usegraph:true}, __, mounts), function(){}) }
  exports.testLateMount = function() {
    var root = temp(), writer, wm, mounts = []
    try {
      for (var i = 0; i < 11; i++) {
        var dir = root + '/m' + i; io.mkdir(dir)
        io.writeFileString(dir + '/topic.md', i === 10 ? '---\ntitle: Parquet\n---\n# Parquet\nThe Parquet oPack reads parquet files.\n' : '---\ntitle: General reference\n---\n# Reference\nOther tools mention parquet as a format.\n')
        if (i===10) io.writeFileString(dir+'/tests.md','---\ntitle: Parquet/tests/autoTestParquet\n---\n# Parquet tests\n'+new Array(400).join('parquet tests parquet fixture.\n'))
        writer = new MiniAWikiManager({root:dir,access:'rw',wikiretrievalv2:true},function(){})
        ow.test.assert(writer.reindex().ok,true,'publish source'); writer.close(); writer = __
        mounts.push({name:i === 10 ? 'opacks' : 'm' + i, root:dir})
      }
      var orders = [mounts, mounts.slice().reverse(), mounts.slice(4).concat(mounts.slice(0,4))]
      orders.forEach(function(order) {
        wm = catalog(order)
        var overview=wm.context()
        ow.test.assert(overview.wikis.some(function(wiki){return wiki.name==='opacks'}),true,'context selector list includes the eleventh mount')
        ow.test.assert(overview.retrieval.federation.mode,'passage-v2','catalog reports effective federation mode')
        var result = wm.agenticSearch('parquet',{limit:5})
        ow.test.assert(result.results[0].path,'@opacks/topic.md','late exact title wins independent of mount order')
        ow.test.assert(result.sources.length,11,'catalog excludes synthetic primary from coverage')
        ow.test.assert(result.budget.used.queries <= result.budget.limits.maxQueries,true,'shared query budget')
        var read = wm.agenticRead(result.results[0].ref,{section:'Parquet',maxChars:200})
        ow.test.assert(read.body.indexOf('oPack reads') >= 0,true,'bounded evidence round trip')
        var packed = wm.presentSearch(result)
        ow.test.assert(stringify(packed,__, '').length <= 4000,true,'compact search envelope')
        ow.test.assert(isUnDef(packed.results[0].scoreComponents),true,'scores remain outside model context')
        var context = wm.assembleContext('parquet',{chunks:1})
        ow.test.assert(context.chunks[0].path,'@opacks/topic.md','catalog context uses global ranking')
        wm.close(); wm = __
      })
    } finally { if(writer)writer.close(); if(wm)wm.close(); io.rm(root) }
  }
  exports.testSearchOptions = function() {
    var root = temp(), wm
    try {
      io.writeFileString(root+'/topic.md','---\ntitle: Case reference\n---\n# Heading\nUPPERneedle matches here.\ncontext after\n')
      ;[false,true].forEach(function(v2) {
        wm = new MiniAWikiManager({root:root,access:'rw',wikiretrievalv2:v2},function(){})
        ow.test.assert(wm.reindex().ok,true,'publish mode')
        var hits = wm.search('UPPERneedle',{compact:false,contextLines:1})
        ow.test.assert(isString(hits[0].snippet),true,'V1 and V2 expose requested snippets')
        ow.test.assert(wm.search('upperneedle',{caseSensitive:true}).length,0,'case sensitive query does not silently fold case')
        ow.test.assert(wm.search('UPPER.*here',{regex:true}).length,1,'regex remains available')
        ow.test.assert(wm.search('Case reference',{searchIn:'body'}).length,0,'body scope excludes frontmatter')
        if(v2) {
          ow.test.assert(wm.presentSearch(wm.agenticSearch('title:(')).error,'invalid-query','compact errors remain explicit')
          wm.write('retired.md',{title:'Retired',status:'retired'},'# Retired\nUPPERneedle')
          ow.test.assert(wm.search('UPPERneedle',{caseSensitive:true}).some(function(hit){return hit.path==='retired.md'}),false,'explicit scans do not disclose retired V2 evidence')
          io.writeFileString(root+'/.mini-a-wiki-serving/current.json','{}')
          io.rm(root+'/.mini-a-wiki-serving/previous.json')
          ow.test.assert(isArray(wm.search('UPPERneedle',{caseSensitive:true})),false,'explicit scans preserve published-generation failure')
        }
        wm.close(); wm = __
      })
    } finally {if(wm)wm.close();io.rm(root)}
  }
  exports.testDerivedConnections = function() {
    var root=temp(), a, b, wm
    try {
      io.mkdir(root+'/a');io.mkdir(root+'/b')
      a=new MiniAWikiManager({root:root+'/a',access:'rw',wikiretrievalv2:true,usegraph:true},function(){})
      b=new MiniAWikiManager({root:root+'/b',access:'rw',wikiretrievalv2:true,usegraph:true},function(){})
      a.write('seed.md',{title:'Parquet',source:'Parquet/README.md'},'# Parquet\nneedle')
      b.write('target.md',{title:'Parquet Reader',source:'Parquet/reader.js'},'# Reader\nSupporting instructions.')
      a.reindex();b.reindex()
      wm=catalog([{name:'a',root:root+'/a'},{name:'b',root:root+'/b'}])
      wm._config.wikigraphsearchhints=true
      var has=function(r){return r.results.some(function(hit){return hit.path==='@b/target.md' && hit.retrievalMethod==='graph'})}
      var result=wm.agenticSearch('needle configuration')
      ow.test.assert(has(result),true,'weak lexical evidence automatically joins published title/source keys')
      ow.test.assert(result.budget.used.graphEdges<=256,true,'derived joins share bounded adjacency work')
      ow.test.assert(has(wm.agenticSearch('needle configuration',{expandGraph:false})),false,'explicit disable wins')
      ow.test.assert(has(wm.agenticSearch('needle configuration',{wiki:'a'})),false,'derived joins respect selected scope')
      var graph=wm._mounts[1].manager._graph
      graph._state.nodes['doc:target.md'].props.revision='stale'
      ow.test.assert(has(wm.agenticSearch('needle configuration')),false,'stale target support is rejected')
      b.write('target.md',{title:'Parquet Reader',source:'Parquet/reader.js'},'# Reader\nUpdated supporting instructions.')
      b.reindex()
      ow.test.assert(has(wm.agenticSearch('needle configuration')),true,'published generation refresh invalidates mounted graph cache')
      wm.detach('b')
      ow.test.assert(has(wm.agenticSearch('needle configuration')),false,'detached targets disappear')
      ow.test.assert(Object.keys(a.read('seed.md').meta).indexOf('aliases'),-1,'source pages remain unchanged')
    } finally {if(wm)wm.close();if(a)a.close();if(b)b.close();io.rm(root)}
  }
  exports.testMixedCoverage = function() {
    var root=temp(), writer, wm
    try {
      io.mkdir(root+'/v2');io.mkdir(root+'/legacy')
      io.writeFileString(root+'/legacy/old.md','# Old\nparquet in an old page')
      writer=new MiniAWikiManager({root:root+'/v2',access:'rw',wikiretrievalv2:true},function(){})
      writer.write('readme.md',{title:'Parquet'},'# Parquet\nA parquet oPack.');writer.reindex();writer.close();writer=__
      wm=catalog([{name:'first',root:root+'/legacy',wikiretrievalv2:false},{name:'opacks',root:root+'/v2'}])
      var result=wm.agenticSearch('parquet',{limit:1})
      ow.test.assert(result.results[0].path,'@opacks/readme.md','mixed sources globally rank before limit')
      ow.test.assert(result.sources.length,2,'mixed coverage preserved')
      ow.test.assert(wm.search('parquet',{path:'@opacks/readme.md'})[0].path,'@opacks/readme.md','qualified path scope routes to selected mount')
      ow.test.assert(wm.search('parquet',{path:'@opacks/readme.md',wiki:'first'}).error,'conflicting-wiki-path','conflicting path cannot widen explicit selector')
      ow.test.assert(wm.agenticSearch('parquet',{maxQueries:1}).outcome,'partial','unsearched source is explicit')
      var context=wm.assembleContext('parquet',{maxQueries:1})
      ow.test.assert(context.requestBudget.used.queries<=1,true,'mixed context cannot reset query budget after discovery')
      ow.test.assert(context.outcome,'partial','context exhaustion remains visible')
      var evidence=wm.retrieve('parquet',{maxQueries:1})
      ow.test.assert(evidence.budget.used.queries<=1,true,'mixed evidence reports actual shared search attempts')
      var selected=wm.agenticSearch('parquet',{wiki:'opacks',applicability:{product:'missing'}})
      ow.test.assert(selected.results.length,0,'catalog V2-only applicability is enforced')
      io.writeFileString(root+'/v2/.mini-a-wiki-serving/current.json','{}')
      var broken=wm.agenticSearch('parquet')
      ow.test.assert(broken.outcome,'partial','broken publication remains explicit')
      ow.test.assert(broken.results[0].path,'@first/old.md','healthy evidence survives alongside failure')
      ow.test.assert(broken.sources.some(function(source){return source.wiki==='opacks' && source.status==='unavailable'}),true,'failed source identified')
      var small=wm.presentSearch(broken)
      ow.test.assert(small.coverage.complete,false,'model sees incomplete coverage')
      ow.test.assert(small.warning.indexOf('absence')>=0,true,'negative answer warning survives compact output')
    } finally {if(writer)writer.close();if(wm)wm.close();io.rm(root)}
  }
  exports.testFederatedSynonyms = function() {
    var root=temp(), writer, wm
    try {
      ;['a','b','legacy'].forEach(function(name){io.mkdir(root+'/'+name)})
      var lexical={synonyms:[['maintenance window','quiet period']]}
      ;['a','b'].forEach(function(name){
        writer=new MiniAWikiManager({root:root+'/'+name,access:'rw',wikiretrievalv2:true,wikilexical:lexical},function(){})
        writer.write('topic.md',{title:name},name==='a'?'# A\nmaintenance window definition':'# B\nA quiet period is suitable for updates.')
        writer.reindex();writer.close();writer=__
      })
      ;[false,true].forEach(function(mixed){
        var mounts=[{name:'a',root:root+'/a',wikilexical:lexical},{name:'b',root:root+'/b',wikilexical:lexical}]
        if(mixed)mounts.push({name:'legacy',root:root+'/legacy',wikiretrievalv2:false})
        wm=catalog(mounts)
        var result=wm.agenticSearch('maintenance window')
        ow.test.assert(result.results.some(function(hit){return hit.path==='@b/topic.md'}),true,'configured synonyms survive strong exact hits in another source')
        ow.test.assert(result.budget.used.queries<=result.budget.limits.maxQueries,true,'synonyms share federation budget')
        wm.close();wm=__
      })
    } finally {if(writer)writer.close();if(wm)wm.close();io.rm(root)}
  }
  return exports
})()
