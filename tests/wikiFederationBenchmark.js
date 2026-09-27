// Read-only optional local replay, or a disposable 11-wiki benchmark by default.
// WIKI_FEDERATION_MOUNTS is a JSON array of mount configurations; never printed.
load('mini-a-common.js'); load('mini-a-wiki.js')
var supplied=getEnv('WIKI_FEDERATION_MOUNTS'), root, mounts=[], writer, manager
try {
  if (isString(supplied) && supplied.trim()) mounts=af.fromJson(supplied)
  else {
    root=String(io.createTempDir('wiki-federation-benchmark-'))
    for(var n=0;n<11;n++) {
      var dir=root+'/m'+n;io.mkdir(dir)
      writer=new MiniAWikiManager({root:dir,access:'rw',wikiretrievalv2:true,wikilexical:{ngrams:true,shingles:true,queryExpansion:true,pseudoRelevanceFeedback:true}},function(){})
      writer.write('topic.md',{title:n===10?'Parquet':'General reference'},n===10?'# Parquet\nThe Parquet oPack reads parquet files.':'# Reference\nOther tools mention parquet as a format.')
      if(n===10)writer.write('tests.md',{title:'Parquet/tests/autoTestParquet'},'# Parquet tests\n'+new Array(400).join('parquet tests parquet fixture.\n'))
      writer.reindex();writer.close();writer=__
      mounts.push({name:n===10?'opacks':'m'+n,root:dir})
    }
  }
  manager=__miniAWikiCreatePrimary(__miniAWikiPrimaryConfig({access:'ro',wikiretrievalv2:true,wikilexical:{ngrams:true,shingles:true,queryExpansion:true,pseudoRelevanceFeedback:true},usegraph:true,wikigraphsearchhints:true},__,mounts),function(){})
  var records=[], reads=0, bytes=0
  manager._mounts.forEach(function(mount){var backend=mount.manager._backend, original=backend.read;backend.read=function(path){var value=original.call(backend,path);reads++;if(isString(value))bytes+=new java.lang.String(value).getBytes("UTF-8").length;return value}})
  var validationReads=function(){return manager._mounts.reduce(function(total,mount){return total+(mount.manager._retrievalV2 ? Number(mount.manager._retrievalV2.metrics.validationBlockReads) || 0 : 0)},0)}
  for(var i=0;i<6;i++) {
    reads=0;bytes=0;var validationBefore=validationReads()
    var start=Date.now(), result=manager.agenticSearch('parquet',{limit:5}), elapsed=Date.now()-start
    var shown=isFunction(manager.presentSearch)?manager.presentSearch(result):result
    records.push({millis:elapsed,backendReadCalls:reads,backendReadBytes:bytes,validationBlockReads:validationReads()-validationBefore,paths:(result.results||[]).map(function(hit){return hit.path}),rawChars:stringify(result,__, '').length,modelChars:af.toTOON(shown).length,outcome:result.outcome,used:result.budget&&result.budget.used})
  }
  print('FEDERATION_BENCHMARK='+stringify({runtime:getVersion(),sources:mounts.length,fixture:supplied?'existing-read-only-mounts':'disposable-11-wikis',samples:records,sourceSha1:{wiki:sha1(io.readFileString('mini-a-wiki.js')),retrieval:sha1(io.readFileString('mini-a-wiki-retrieval.js'))}},__,''))
} finally {if(manager)manager.close();if(writer)writer.close();if(root)io.rm(root)}
