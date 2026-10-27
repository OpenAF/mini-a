// Run: oaf -f tests/fileAccess.js (real filesystem, no model calls).
load('mini-a.js')
load('mini-a-utils.js')
load('mini-a-wiki.js')
load('mini-a-advanced.js')
var root = String(java.nio.file.Files.createTempDirectory('mini-a-fileallow-').toFile().getCanonicalPath())
var allowed = root + '/allowed', outside = root + '/outside'
io.mkdir(allowed); io.mkdir(outside)
io.writeFileString(allowed + '/ok.md', 'ALLOWED CONTENT')
io.writeFileString(outside + '/secret.md', 'DENIED CONTENT')
var checks = 0
function check(value, message) { checks++; if (!value) throw new Error(message) }
function denied(fn, message) { var failed = false; try { fn() } catch(e) { failed = /fileallow|denied by policy/.test(String(e)) }; check(failed, message) }
try {
  var access = new MiniAFileAccess([allowed])
  check(access.assert(allowed + '/ok.md') === allowed + '/ok.md', 'allowed file')
  denied(function() { access.assert(outside + '/secret.md') }, 'outside file')
  denied(function() { access.assert(allowed + '/../outside/secret.md') }, 'traversal')
  denied(function() { access.assert(allowed + '-sibling/x') }, 'prefix collision')
  java.nio.file.Files.createSymbolicLink(new java.io.File(allowed + '/escape').toPath(), new java.io.File(outside).toPath())
  denied(function() { access.assert(allowed + '/escape/secret.md') }, 'symlink escape')
  denied(function() { new MiniAFileAccess([]).assert(allowed + '/ok.md') }, 'empty denies all')
  denied(function() { new MiniAFileAccess('not-an-array') }, 'nonexistent single path fails closed')
  check(new MiniAFileAccess(allowed).allows(allowed + '/ok.md'), 'single path string')
  var commaAccess = new MiniAFileAccess('  ' + allowed + ' , ' + outside + '  ')
  check(commaAccess.allows(allowed + '/ok.md') && commaAccess.allows(outside + '/secret.md'), 'comma-delimited paths with whitespace')
  denied(function() { new MiniAFileAccess(allowed).assert(outside + '/secret.md') }, 'single path retains boundary')
  ;['', ',', allowed + ',', ',' + allowed, allowed + ',,' + outside, '[invalid'].forEach(function(value) {
    denied(function() { new MiniAFileAccess(value) }, 'malformed list rejected: ' + value)
  })
  var commaPath = root + '/with,comma'; io.mkdir(commaPath)
  check(new MiniAFileAccess(JSON.stringify([commaPath])).allows(commaPath + '/new.md'), 'JSON array preserves path commas')
  check(new MiniAFileAccess("['" + allowed + "']").allows(allowed + '/ok.md'), 'SLON array remains supported')
  denied(function() { new MiniAFileAccess('[]').assert(allowed + '/ok.md') }, 'string empty array denies all')
  check(new MiniAFileAccess().assert(outside + '/secret.md') === outside + '/secret.md', 'omission preserves compatibility')
  var exact = new MiniAFileAccess(JSON.stringify([allowed + '/ok.md']))
  denied(function() { exact.assert(allowed + '/another.md') }, 'exact file only')
  check(!new MiniAFileAccess([outside]).allows(allowed + '/ok.md') && access.allows(allowed + '/ok.md'), 'instance isolation')
  var nested = allowed + '/nested'; io.mkdir(nested)
  check(isUnDef(MiniAFileAccess.intersection(__, __)), 'unrestricted intersection stays unrestricted')
  check(MiniAFileAccess.intersection([allowed], __)[0] === allowed, 'unrestricted worker retains parent restriction')
  check(MiniAFileAccess.intersection(__, [nested])[0] === nested, 'unrestricted parent retains worker restriction')
  check(MiniAFileAccess.intersection([allowed], [nested])[0] === nested, 'intersection keeps narrower directory')
  check(MiniAFileAccess.intersection([nested], [allowed])[0] === nested, 'intersection is symmetric')
  check(MiniAFileAccess.intersection([allowed], [outside]).length === 0, 'disjoint roots deny all')
  check(MiniAFileAccess.intersection([], [allowed]).length === 0, 'deny-all survives intersection')
  check(MiniAFileAccess.intersection([allowed], [allowed + '/ok.md'])[0] === allowed + '/ok.md', 'exact file stays exact')
  check(MiniAFileAccess.intersection([allowed], [allowed + '/ok.md', allowed + '/ok.md']).length === 1, 'duplicate roots are deduplicated')
  denied(function() { new MiniAFileAccess(MiniAFileAccess.intersection([allowed], [nested])).assert(nested + '/../ok.md') }, 'intersection blocks parent traversal')
  var scopedUtils = new MiniUtilsTool({ root: allowed, readwrite: true, fileallow: [allowed], writeallow: [nested] })
  check(scopedUtils.readFile({ path: 'ok.md' }).content === 'ALLOWED CONTENT', 'write ceiling does not block permitted reads')
  check(String(scopedUtils.writeFile({ path: 'ok.md', content: 'FORBIDDEN' })).indexOf('[ERROR]') === 0, 'write outside write ceiling denied')
  check(!io.fileExists(nested + '/new.md'), 'patch test starts without target')
  var patchDenied = false
  try { scopedUtils.apply_patch({ patchText: '*** Begin Patch\n*** Add File: nested/new.md\n+new\n*** Update File: ok.md\n@@\n-ALLOWED CONTENT\n+FORBIDDEN\n*** End Patch' }) } catch(e) { patchDenied = true }
  check(patchDenied && !io.fileExists(nested + '/new.md') && io.readFileString(allowed + '/ok.md') === 'ALLOWED CONTENT', 'mixed patch is rejected atomically')
  check(scopedUtils.apply_patch({ patchText: '*** Begin Patch\n*** Add File: nested/new.md\n+permitted\n*** End Patch' }).ok === true, 'write inside write ceiling succeeds')
  var scopedArgs = __miniARemoteScopedFileConfine({ useshell: true, readwrite: true, mcp: 'unsafe', plugins: outside },
    { root: allowed, reads: [allowed], writes: [nested], policies: [{ shell: 'deny' }] })
  check(scopedArgs.useutils && scopedArgs.usetools && scopedArgs.usestdutils, 'scoped file profile exposes built-in tools')
  check(!scopedArgs.useshell && isUnDef(scopedArgs.mcp), 'scoped file profile disables shell and external MCP')
  check(scopedArgs.fileallow[0] === allowed && scopedArgs._remoteWriteAllow[0] === nested, 'read and write ceilings stay separate')
  check(scopedArgs.utilsallow === 'read,apply_patch' && scopedArgs._inheritedPolicies.length === 1, 'profile applies restricted tool list and inherited policy')
  var scopedAgent = new MiniA(); scopedAgent.fnI = function() {}
  check(scopedAgent._getPluginsDiscovery(scopedArgs).mcpConfigs.length === 0, 'scoped profile does not discover plugin MCPs')
  var workerCfg = { apitoken: 'fixture-token', useutils: true, usestdutils: true, usetools: true, readwrite: true, utilsroot: allowed, fileallow: [allowed] }
  var scopeRequest = { version: 1, root: allowed, reads: [allowed + '/ok.md'], writes: [nested], parentFileallow: [allowed], policies: [{ shell: 'deny' }] }
  var admitted = __miniARemoteScopedFileValidate(scopeRequest, workerCfg)
  var noTokenRejected = false; try { __miniARemoteScopedFileValidate(scopeRequest, merge(workerCfg, { apitoken: '' })) } catch(e) { noTokenRejected = true }
  check(noTokenRejected, 'worker rejects scoped access without authentication')
  check(admitted.reads.length === 2 && admitted.writes.length === 1 && admitted.writes[0] === nested, 'worker admits intersection of parent, task and worker scopes')
  var badScope = clone(scopeRequest); badScope.writes = [outside]
  var rejected = false; try { __miniARemoteScopedFileValidate(badScope, workerCfg) } catch(e) { rejected = true }
  check(rejected, 'worker rejects scopes outside shared root and permissions')
  var readOnlyWorker = merge(workerCfg, { readwrite: false })
  rejected = false; try { __miniARemoteScopedFileValidate(scopeRequest, readOnlyWorker) } catch(e) { rejected = true }
  check(rejected, 'worker read-only setting cannot be widened')
  rejected = false; try { __miniARemoteScopedFileValidate(merge(scopeRequest, { policies: [{ filesystem: { write: 'deny' } }] }), workerCfg) } catch(e) { rejected = true }
  check(rejected, 'parent policy denial survives worker admission')
  rejected = false; try { __miniARemoteScopedFileValidate(scopeRequest, merge(workerCfg, { policy: { filesystem: { read: 'deny' } } })) } catch(e) { rejected = true }
  check(rejected, 'worker policy denial survives parent admission')
  var agent = new MiniA(); agent.fnI = function() {}
  var args = { fileallow: [allowed] }; agent._configureFileAccess(args)
  check(agent._readPromptFile(allowed + '/ok.md', args) === 'ALLOWED CONTENT', 'prompt control')
  ;['knowledge','youare','chatyouare','rules'].forEach(function(field) {
    var promptArgs = {fileallow:[allowed],knowledge:'',youare:'',chatyouare:'',rules:''}; promptArgs[field] = outside + '/secret.md'
    denied(function() { agent._refreshRunPrompt(promptArgs) }, 'prompt loader denies ' + field)
  })
  check(agent._readPromptFile('@' + allowed + '/ok.md', args) === 'ALLOWED CONTENT', '@ prompt control')
  denied(function() { agent._readPromptFile(outside + '/secret.md', args) }, 'original prompt-file attack')
  check(agent._readPromptFile('literal\n' + outside + '/secret.md', args).indexOf('literal') === 0, 'multiline remains literal')
  check(!agent._loadPlanFromArgs({fileallow:[allowed], knowledge:outside + '/secret.md'}), 'plan detection cannot read denied file')
  denied(function() { agent._readPromptFile(allowed + '/ok.md', {fileallow:[allowed],policy:{filesystem:{read:'deny'}}}) }, 'existing read policy respected')
  denied(function() { __miniALoadSkillTemplateDocument(outside + '/secret.md', access) }, 'skill template denied')
  check(__miniALoadSkillTemplateDocument(allowed + '/ok.md', access).rawContent === 'ALLOWED CONTENT', 'skill template control')
  var utils = new MiniUtilsTool({root:root, fileallow:[allowed], readwrite:true})
  check(utils.readFile({path:allowed + '/ok.md'}).content === 'ALLOWED CONTENT', 'utils control')
  check(String(utils.readFile({path:outside + '/secret.md'})).indexOf('fileallow') >= 0, 'utils read denied')
  check(String(utils.writeFile({path:outside + '/new.md',content:'bad'})).indexOf('fileallow') >= 0 && !io.fileExists(outside + '/new.md'), 'utils write denied')
  var fileUrl = String(new java.io.File(outside + '/secret.md').toURI())
  check(String(utils.textUtilities({operation:'webfetch',url:fileUrl})).indexOf('fileallow') >= 0, 'file URL denied')
  check(String(utils.textUtilities({operation:'fetch',url:'jar:' + fileUrl + '!/x'})).indexOf('fileallow') >= 0, 'jar URL denied')
  var refs = utils._preprocessSkillTemplateReferences('[ref](../outside/secret.md)', {templatePath:allowed + '/ok.md'}, {})
  check(refs.text.indexOf('DENIED CONTENT') < 0, 'skill relative include denied')
  denied(function() { new MiniAWikiManager({root:outside,backend:'fs',fileallow:[allowed],maintenanceSourceOnly:true}) }, 'wiki denied before cached retrieval')
  var wiki = new MiniAWikiManager({root:allowed,backend:'fs',fileallow:[allowed],maintenanceSourceOnly:true})
  check(wiki._backend.read('ok.md') === 'ALLOWED CONTENT', 'wiki control')
  var utilsConfig = agent._createUtilsMcpConfig({useutils:true,utilsroot:root,fileallow:[allowed]})
  var proxy = agent._createMcpProxyConfig([utilsConfig], {usestdutils:true}).options.fns
  var resultDenied = proxy['proxy-dispatch']({action:'readresult',resultFile:outside + '/secret.md',op:'read'})
  check(String(resultDenied.error).indexOf('fileallow') >= 0, 'proxy result file denied')
  agent._registerOwnedResultFile(outside + '/secret.md')
  check(!proxy['proxy-dispatch']({action:'readresult',resultFile:outside + '/secret.md',op:'stat'}).error, 'owned result files remain usable')
  var spillAgent = new MiniA(); spillAgent.fnI = function() {}; spillAgent._configureFileAccess({fileallow:[]})
  var mock = {id:'fileallow-fixture',type:'dummy',options:{
    fns:{fileallow_mock:function(){return {content:[{type:'text',text:new Array(501).join('x')}]}}},
    fnsMeta:{fileallow_mock:{name:'fileallow_mock',inputSchema:{type:'object',properties:{}}}}
  }}
  var spillProxy = spillAgent._createMcpProxyConfig([mock],{mcpproxythreshold:100,usestdutils:true}).options.fns
  var spilled = spillProxy['proxy-dispatch']({action:'call',tool:'fileallow_mock',arguments:{}})
  check(isString(spilled.resultFile) && !spillProxy.result_stat({resultFile:spilled.resultFile}).error, 'real managed spill works with deny-all policy')
  if (isString(spilled.resultFile)) io.rm(spilled.resultFile)
  var otherAgent = new MiniA(); otherAgent._configureFileAccess(args)
  denied(function() { otherAgent._resultFilePath(outside + '/secret.md') }, 'owned file grants are instance local')
  global.__mini_a_ingest_lib_mode = true; loadLib('mini-a-ingest.js')
  var ingest = new MiniAIngest({usewiki:true,ingestsource:allowed,wikiroot:outside,fileallow:[allowed],ingestdryrun:true}, function() {})
  var ingestResult = ingest.run()
  check(ingestResult.ok === false && String(ingestResult.error).indexOf('fileallow') >= 0, 'ingestion dry-run cannot open a denied destination')
  global.__mini_a_dreams_lib_mode = true; loadLib('mini-a-dreams.js')
  var dream = new MiniADreams({usewiki:true,dreammode:'wiki',fileallow:[allowed],dreamreport:outside + '/report.json'}, function() {})
  dream.dreamWiki = function() { return {ok:true} }
  var dreamResult = dream.run()
  check(dreamResult.ok === false && String(dreamResult.report_error).indexOf('fileallow') >= 0 && !io.fileExists(outside + '/report.json'), 'dream report output denied')
  loadLib('mini-a-plugins.js')
  denied(function() { __miniAPluginLoadOne(outside, {fileallow:[allowed]}) }, 'plugin manifest directory denied')
  loadLib('mini-a-eval.js')
  var evaluator = new MiniAEval({fileallow:[allowed]})
  denied(function() { evaluator._readDefinition(outside + '/secret.md') }, 'evaluation definition denied')
  var advanced = Object.create(MiniAAdvanced.prototype); advanced.args = {fileallow:[allowed]}
  check(advanced.isServerOption('fileallow'), 'web setting protected')
  check(advanced.mergeOptions(advanced.args,{fileallow:[]}).fileallow[0] === allowed, 'preset cannot change ceiling')
  check(advanced.mergeOptions(advanced.args,{fileallow:null}).fileallow[0] === allowed, 'saved session cannot remove ceiling')
  denied(function() { new MiniAWikiManager({root:outside,backend:'FS',fileallow:[allowed],maintenanceSourceOnly:true}) }, 'normalized wiki backend cannot bypass root check')
  print('fileAccess: ' + checks + ' checks passed')
} finally { io.rm(root) }
