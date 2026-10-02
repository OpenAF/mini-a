(function() {
  load('mini-a-common.js')
  load('mini-a-wiki.js')
  load('mini-a-mcp-wiki.js')
  var makeDir = function() { var d = String(java.io.File.createTempFile('catalog-test-', '').getCanonicalPath()); io.rm(d); io.mkdir(d); return d }
  var primary = function(mounts, extra, root) { return __miniAWikiCreatePrimary(__miniAWikiPrimaryConfig(merge({ backend: 'fs', root: root || '.', access: 'rw' }, extra || {}), root, mounts)) }
  exports.testCatalog = function() {
    var a = makeDir(), b = makeDir(), wm
    try {
      io.writeFileString(a + '/index.md', '---\ntitle: Alpha\ndescription: First library\n---\n# Alpha\nneedle')
      io.writeFileString(a + '/topic.md', '# Alpha topic\nneedle')
      io.writeFileString(b + '/topic.md', '# Topic\nneedle')
      wm = primary([{ name: 'alpha', root: a, label: 'Alpha Library' }, { name: 'beta', root: b, description: 'Second library' }], { usegraph: true, wikiretrievalv2: true })
      ow.test.assert(wm._backendType, 'catalog', 'mounts-only primary uses memory')
      ow.test.assert(isUnDef(wm._graph) && isUnDef(wm._retrievalV2) && isUnDef(wm._legacyRetrievalV2), true, 'no primary graph or V2 initialization')
      var page = wm.read('index.md')
      ow.test.assert(page.body.indexOf('[Alpha Library](@alpha/index.md)') >= 0, true, 'indexed mount link and label')
      ow.test.assert(page.body.indexOf('[beta](@beta/)') >= 0, true, 'missing index links to browsable root')
      ow.test.assert(page.body.indexOf('First library') >= 0 && page.body.indexOf('Second library') >= 0, true, 'descriptions')
      ow.test.assert(wm.open('index.md').title, 'Wiki Mount Catalog', 'open catalog metadata')
      ow.test.assert(wm.list('', { withMeta: true }).some(function(x) { return x.path === 'index.md' }), true, 'list catalog')
      ow.test.assert(wm.tree('').index.exists, true, 'tree catalog')
      ow.test.assert(wm.browse('').nearest_index.exists, true, 'browse catalog')
      ow.test.assert(wm.browse('@beta/').direct_pages.length, 1, 'missing index root browsable')
      ow.test.assert(wm.context().wikis[0].generated, true, 'context identifies generated primary')
      ow.test.assert(wm.context().access, 'ro', 'rw cannot override catalog')
      ow.test.assert(isUnDef(wm.context().retrieval.fallbackReason), true, 'no primary reindex warning')
      ow.test.assert(wm.search('needle').length, 2, 'federation searches inherited unpublished V2 mounts')
      ow.test.assert(wm.search('needle', { wiki: 'beta' })[0].path, '@beta/topic.md', 'mount scoped search')
      ;[wm.write('test.md', {}, 'body'), wm.delete('index.md'), wm.move('index.md', 'other.md'), wm.init(), wm.reindex(), wm.compact(), wm.graph('build')].forEach(function(result) {
        ow.test.assert(result.ok, false, 'mutation rejected')
        ow.test.assert(result.error.indexOf('wikiroot') >= 0, true, 'actionable storage guidance')
      })
      ow.test.assert(isUnDef(wm.read('README.md')), true, 'cwd files inaccessible')
      ow.test.assert(wm.attach('alpha', { root: b + '/missing' }).ok, false, 'missing root cannot replace a working mount')
      ow.test.assert(wm.read('index.md').body.indexOf('@alpha/index.md') >= 0, true, 'failed replacement preserves catalog')
      ow.test.assert(wm.attach('alpha', { root: b }).ok, true, 'replace mount')
      ow.test.assert(wm.open('index.md').links.indexOf('@alpha/index.md') < 0, true, 'replacement invalidates navigation')
      ow.test.assert(wm.read('index.md').body.indexOf('First library') < 0, true, 'replacement invalidates content')
      wm.detach('alpha'); wm.detach('beta')
      ow.test.assert(wm.read('index.md').body.indexOf('No wikis') >= 0, true, 'empty catalog persists')
      ow.test.assert(wm._safeListPages('').join(','), 'index.md', 'empty catalog never falls back')
      ow.test.assert(wm.attach('missing-root', {}).ok, false, 'missing mount root cannot expose cwd')
      ow.test.assert(io.listFiles(a).files.length, 2, 'no primary or mount artifacts in first library')
      ow.test.assert(io.listFiles(b).files.length, 1, 'no primary or mount artifacts in second library')
    } finally { if (wm) wm.close(); io.rm(a); io.rm(b) }
  }
  exports.testGraphStats = function() {
    var a = makeDir(), b = makeDir(), writer, wm
    try {
      io.writeFileString(a + '/topic.md', '# Topic\n[Other](other.md)')
      io.writeFileString(a + '/other.md', '# Other')
      writer = new MiniAWikiManager({ root:a, access:'rw', usegraph:true })
      writer.graph('build')
      var expected = writer.graph('stats')
      writer.close(); writer = __
      var graphPath = a + '/.mini-a-wiki-graph/graph.json', before = io.readFileString(graphPath)
      wm = primary([{name:'alpha', root:a}, {name:'beta', root:a}, {name:'missing', root:b}, {name:'disabled', root:a, usegraph:false}], {usegraph:true})
      var stats = wm.graph('stats')
      ow.test.assert(stats.ok, true, 'catalog stats succeed without a primary graph')
      ow.test.assert(stats.scope, 'mounts', 'stats identify mounted scope')
      ow.test.assert(stats.nodes, expected.nodes * 2, 'totals count each mount separately')
      ow.test.assert(stats.edges, expected.edges * 2, 'edge totals')
      ow.test.assert(stats.communities, expected.communities * 2, 'community totals')
      ow.test.assert(stats.provenance.EXTRACTED, expected.provenance.EXTRACTED * 2, 'provenance totals')
      ow.test.assert(stats.available, 2, 'available graph count')
      ow.test.assert(stats.mounts.length, 4, 'missing and disabled mounts are reported')
      ow.test.assert(stats.mounts[2].error.indexOf('no graph is loaded') >= 0, true, 'missing graph distinguished from disabled')
      ow.test.assert(stats.mounts[3].error.indexOf('usewikigraph=true') >= 0, true, 'public flag in disabled diagnostic')
      ow.test.assert(wm.graph('query', {query:'topic'}).error.indexOf('catalog has no primary graph') >= 0, true, 'unsupported catalog operation has storage guidance')
      ow.test.assert(io.readFileString(graphPath), before, 'stats do not write mounted graph')
      ow.test.assert(io.listFiles(b).files.length, 0, 'stats do not create missing graph')
      wm.close(); wm = primary([{name:'alpha', root:a}])
      ow.test.assert(wm.graph('stats').error.indexOf('usewikigraph=true') >= 0, true, 'catalog graph remains opt-in')
      wm.close(); wm = primary([{name:'missing', root:b}], {usegraph:true})
      ow.test.assert(wm.graph('stats').available, 0, 'all-missing graphs remain visible')
      wm.detach('missing')
      ow.test.assert(wm.graph('stats').mounts.length, 0, 'empty catalog stats')
    } finally { if (writer) writer.close(); if (wm) wm.close(); io.rm(a); io.rm(b) }
  }
  exports.testSelection = function() {
    var a = makeDir(), wm, logs = []
    try {
      ;[__, '', [], '[]', '  '].forEach(function(m) { ow.test.assert(__miniAWikiPrimaryConfig({ backend: 'fs', root: '.' }, __, m).__catalog, false, 'empty mounts keep ordinary primary') })
      ow.test.assert(__miniAWikiPrimaryConfig({ backend: 'fs', root: '.' }, '.', [{name:'a'}]).__catalog, false, 'explicit dot wins')
      ;['s3', 's3fs', 'es', 'http', 'https'].forEach(function(b) { ow.test.assert(__miniAWikiPrimaryConfig({ backend:b }, __, [{name:'a'}]).__catalog, false, 'remote backend preserved') })
      ;['broken', '[{]', '[{}]', 42].forEach(function(m) { var error = ''; try { primary(m) } catch(e) { error = String(e) }; ow.test.assert(error.indexOf('wikimounts') >= 0, true, 'malformed configuration fails closed') })
      wm = __miniAWikiCreatePrimary(__miniAWikiPrimaryConfig({ access:'rw' }, __, [{ name:'bad', backend:'fs', root:a, wikilexical:{language:'invalid'} }]), function(level, msg) { logs.push(msg) })
      ow.test.assert(wm._catalog, true, 'failed attachments retain catalog')
      ow.test.assert(wm.mounts().length, 0, 'failed mount absent')
      ow.test.assert(logs.length > 0, true, 'attachment error reported')
      wm.close(); wm = primary([], {}, a)
      ow.test.assert(wm._catalog, false, 'empty list retains ordinary manager')
      wm.attach('later', { root:a })
      ow.test.assert(wm._catalog, false, 'interactive mount preserves primary')
      wm.close()
      io.writeFileString(a + '/synonyms.txt', 'boat,ship')
      wm = primary([{name:'relative', root:a}], { wikilexical:{ synonymsfile:'synonyms.txt' } })
      ow.test.assert(wm.mounts().length, 1, 'relative lexical resources resolved at mount root')
      ow.test.assert(wm._mounts[0].manager._lexicalConfig.synonyms[0][0], 'boat', 'mount inherits lexical rules')
    } finally { if (wm) wm.close(); io.rm(a) }
  }
  exports.testInitialization = function() {
    var dir = makeDir(), managers = [], savedManager = global.__wikiManager, savedTool = global.__wikiTool, savedMcp = global.__miniAMcpWiki
    var originalFs = MiniAWikiManager.prototype._makeFsBackend
    try {
      io.writeFileString(dir + '/topic.md', '---\ntitle: Needle page\ndescription: Needle content\n---\n# Needle\nneedle text')
      var mounts = [{ name: 'library', root: dir }], raw = JSON.stringify(mounts, null, 2)
      // Exercise the real initialization functions without constructing an LLM
      // or starting an interactive console. Reject any accidental cwd backend.
      MiniAWikiManager.prototype._makeFsBackend = function(cfg) {
        if (!cfg.root || cfg.root === '.') throw new Error('TEST: attempted cwd backend')
        return originalFs.call(this, cfg)
      }
      var source = io.readFileString('mini-a.js')
      var method = function(name, end) {
        var start = source.indexOf('MiniA.prototype.' + name + ' = ') + ('MiniA.prototype.' + name + ' = ').length
        return (new Function('return (' + source.substring(start, source.indexOf(end, start)).trim().replace(/;$/, '') + ')'))()
      }
      var agent = { fnI: function() {} }
      method('_initWiki', '// Virtual skill library').call(agent, { usewiki: true, wikiaccess: 'rw', wikimounts: raw })
      ow.test.assert(!!agent._wikiManager && agent._wikiManager._catalog, true, 'agent initialization selects catalog before fs')
      managers.push(agent._wikiManager)
      var initSkills = method('_initSkillWiki', 'MiniA.prototype._getDefaultMemoryWriteManager')
      initSkills.call(agent, { useskillswiki: true })
      ow.test.assert(agent._skillWikiManager === agent._wikiManager, true, 'shared skill library reuses catalog')
      initSkills.call(agent, { useskillswiki: true, skillwikimounts: mounts })
      ow.test.assert(!!agent._skillWikiManager && agent._skillWikiManager._catalog, true, 'dedicated skills array selects catalog')
      managers.push(agent._skillWikiManager)
      var consoleSource = io.readFileString('mini-a-session.js')
      var start = consoleSource.indexOf('  function getConsoleWikiManager()'), end = consoleSource.indexOf('  function getWikiSubcommandCompletions()', start)
      var consoleInit = new Function('adapter', 'sessionOptions', 'extraCLIArgs', 'activeAgent', consoleSource.substring(start, end) + '\nreturn [getConsoleWikiManager(), getConsoleSkillWikiManager()]')
      var consoleManagers = consoleInit(__, { usewiki:true, usewikigraph:true, useskillswiki:true, skillwikimounts:raw }, { wikimounts:raw }, __)
      consoleManagers.forEach(function(wm) { ow.test.assert(!!wm && wm._catalog, true, 'console factory selects catalog'); managers.push(wm) })
      ow.test.assert(consoleManagers[0].graph('stats').scope, 'mounts', 'console public flag enables mounted graph stats')
      __miniAMcpWikiInit({ wikimounts: raw, wikiaccess:'rw' }, {})
      managers.push(global.__wikiManager)
      ow.test.assert(global.__wikiManager._catalog, true, 'MCP catalog')
      ow.test.assert(global.__wikiManager.mounts().length, 1, 'MCP pretty JSON mounts')
      __miniAMcpWikiInit({ wikimounts:raw, wikirestrict:true }, {})
      managers.push(global.__wikiManager)
      var result = __miniAMcpWikiRestrictedSearchImpl({ query:'needle' })
      ow.test.assert(JSON.stringify(result).indexOf('@library') < 0, true, 'restricted search hides mount paths')
      ow.test.assert(JSON.stringify(result).indexOf('ref') >= 0, true, 'restricted search issues opaque ref')
      var catalogResult = __miniAMcpWikiRestrictedSearchImpl({ query:'catalog' })
      ow.test.assert(JSON.stringify(catalogResult).indexOf('Wiki Mount Catalog') < 0, true, 'restricted search does not grant catalog navigation')
      ow.test.assert(io.listFiles(dir).files.length, 1, 'initialization creates no mount artifacts')
    } finally {
      MiniAWikiManager.prototype._makeFsBackend = originalFs
      managers.forEach(function(wm) { if (wm) wm.close() })
      global.__wikiManager = savedManager; global.__wikiTool = savedTool; global.__miniAMcpWiki = savedMcp
      io.rm(dir)
    }
  }
  exports.testPublishedRetrieval = function() {
    var dir = makeDir(), legacy = makeDir(), writer, wm
    try {
      io.writeFileString(dir + '/topic.md', '---\ntitle: Needle\n---\n# Needle\nneedle evidence')
      io.writeFileString(legacy + '/legacy.md', '# Legacy\nneedle legacy evidence')
      writer = new MiniAWikiManager({ root:dir, access:'rw', wikiretrievalv2:true })
      ow.test.assert(writer.reindex().ok, true, 'publish V2 fixture')
      writer.close(); writer = __
      wm = primary([{name:'v2', root:dir}, {name:'legacy', root:legacy, wikiretrievalv2:false}], { wikiretrievalv2:true })
      ow.test.assert(wm.search('needle').length, 2, 'mixed published V2 and legacy search')
      ow.test.assert(wm.search('needle', { wiki:'v2' })[0].path, '@v2/topic.md', 'published mount scoped search')
      ow.test.assert(wm.open('@v2/topic.md').path, '@v2/topic.md', 'mounted V2 open')
      ow.test.assert(wm.agenticRead('@v2/topic.md', { section:'needle' }).path, '@v2/topic.md', 'mounted V2 bounded read')
      var ptr = dir + '/.mini-a-wiki-serving/current.json'
      io.writeFileString(ptr, '{broken')
      ow.test.assert(isArray(wm.search('needle')), false, 'published mount failure is preserved')
      ow.test.assert(isString(wm.agenticRead('@v2/topic.md').error), true, 'bounded read preserves published mount failure')
    } finally { if (writer) writer.close(); if (wm) wm.close(); io.rm(dir); io.rm(legacy) }
  }
  return exports
})()
