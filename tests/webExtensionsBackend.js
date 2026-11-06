// Provider-free integration tests against actual OpenAF filesystem/HTTP response APIs.
load('js/web/mini-a-web-extensions.js')
ow.loadServer()
var checks=0, failure
function check(value,message) {checks++;if(!value)throw new Error(message)}
function rejects(fn,code) {var caught;try{fn()}catch(e){caught=e};check(!!caught && (!code || caught.code===code),'Expected rejection '+code)}
var temp=String(java.nio.file.Files.createTempDirectory('mini-a-web-extensions-test-').toRealPath())
var fixturePlugin=temp+'/extension', home=temp+'/home', configPath=temp+'/config.json', uuid=genUUID(), other=genUUID()
var token='fixture-web-extensions-token-0000000000000', fs=MiniAWebDocumentIO
var manifest={$schema:'https://openaf.io/schemas/mini-a/web-extension/1.0/schema.json',id:'org.example.text',name:'Text',version:'1.0.0',apiVersions:['1.0'],entry:'index.html',rendering:'iframe',activation:['command','open-with'],formats:[{mimeTypes:['text/plain'],extensions:['.txt']}],capabilities:['render','edit','create'],permissions:['artifact.read','artifact.propose-write'],network:{origins:[]},offline:true,license:'Apache-2.0'}
function makePlugin(dir,m) {io.mkdir(dir);io.mkdir(dir+'/web');io.writeFileJSON(dir+'/mini-a-web.json',m);io.writeFileString(dir+'/web/index.html','<!doctype html><script src="app.js"></script>');io.writeFileString(dir+'/web/app.js','/* fixture */')}
function req(route,method,data,headers) {return MiniAWebExtensions.route({uri:route,method:method,header:merge({host:'localhost:8888','x-mini-a-token':token,origin:'http://localhost:8888'},headers || {}),files:{postData:JSON.stringify(data || {})}})}
function result(response) {return typeof response.data==='string'?JSON.parse(response.data):response.data}
function post(data) {return req('/web-extensions','POST',data)}
function docs(data) {return req('/web-documents','POST',merge({uuid:uuid},data))}
try {
  var jobs=io.readFileYAML(__miniAPath('mini-a-web.yaml')).jobs
  var loading=jobs.filter(function(job){return job.name==='Load web libraries'})[0].exec
  var registering=jobs.filter(function(job){return job.name==='Register web extensions'})[0].exec
  ;[undefined,{webextensions:false,webextensionsagent:true}].forEach(function(disabledArgs){
    var loaded=[]
    new Function('args','loadLib','ow','__miniAResolvePackageRoot','__miniAPath','var __miniAPackageRoot;\n'+loading)(disabledArgs,function(p){loaded.push(p)},{oJob:{__file:__miniAPath('mini-a-web.yaml')}},function(p){return p},__miniAPath)
    check(!loaded.some(function(p){return /web-extensions|web-documents|document-agent|document-tools|plugin-paths/.test(p)}),'Disabled YAML library hook does not load extension, discovery, store or agent modules')
  })
  ;[undefined,{enabled:function(){return false}}].forEach(function(disabledRegistry){
    var fakeGlobal={__ojobRoutes:{8888:{}}}, routes=0
    new Function('MiniAWebExtensions','args','global','ow',registering)(disabledRegistry,{onport:8888},fakeGlobal,{server:{httpd:{route:function(){routes++}}}})
    check(routes===0 && Object.keys(fakeGlobal.__ojobRoutes[8888]).length===0,'Disabled YAML registration hook installs no routes')
  })
  MiniAWebExtensions.init({webextensions:false,homedir:home,webextensionsconfig:temp+'/missing-config.json',plugins:temp+'/missing-package'})
  check(!io.fileExists(home),'Disabled mode creates no storage')
  check(req('/web-extensions','GET').status===503,'Disabled registry never exposes catalog or initializes discovery')
  makePlugin(fixturePlugin,manifest)
  io.writeFileString(fixturePlugin+'/mcp.json','THIS MUST NOT BE PARSED')
  io.writeFileJSON(configPath,{directories:[fixturePlugin],publicOrigin:'http://localhost:8888'})
  var args={webextensions:true,webtoken:token,homedir:home,webextensionsconfig:configPath}
  MiniAWebExtensions.init(args)
  check(!io.fileExists(home+'/.openaf-mini-a/fixturePlugin-data'),'Discovery creates no Agent Plugin data')
  var catalog=result(req('/web-extensions','GET')), extension=catalog.extensions[0]
  check(extension && extension.id===manifest.id && !extension.enabled,'Standalone package discovered but disabled')
  check(req('/web-extensions','GET',{}, {'x-mini-a-token':''}).status===401,'Query-free header authentication')
  check(req('/web-extensions','GET',{}, {origin:'null'}).status===403,'Opaque guest API denied')
  check(req('/web-extensions','POST',{action:'refresh'},{origin:'https://attacker.invalid'}).status===403,'Foreign browser origin denied')
  rejects(function(){fs.parseJSON('['.repeat(4000)+'0'+']'.repeat(4000))},'invalid_request')
  check(fs.parseJSON(JSON.stringify({text:'brackets in text do not count: [[[[\\"'})).text==='brackets in text do not count: [[[[\\"','Nesting preflight respects escaped JSON strings')
  ;['null','[]','42','"value"','true'].forEach(function(raw){
    var response=MiniAWebExtensions.route({uri:'/web-documents',method:'POST',header:{host:'localhost:8888','x-mini-a-token':token},files:{postData:raw}})
    check(response.status===400 && result(response).code==='invalid_request','Primitive/array request rejects cleanly: '+raw)
  })
  check(post({action:'enable',extensionId:manifest.id,digest:extension.digest,permissions:[]}).status===403,'Permissions require explicit full grant')
  var writeJSON=fs.writeJSON
  try {
    fs.writeJSON=function(path,data){if(/grants\.json$/.test(path))throw new Error('simulated storage failure');return writeJSON(path,data)}
    check(post({action:'enable',extensionId:manifest.id,digest:extension.digest,permissions:manifest.permissions}).status===500,'Persisting approval failure is reported')
    check(!result(req('/web-extensions','GET')).extensions[0].enabled,'Failed approval persistence does not silently enable the package')
  } finally {fs.writeJSON=writeJSON}
  var enabled=post({action:'enable',extensionId:manifest.id,digest:extension.digest,permissions:manifest.permissions})
  check(enabled.status===200 && result(enabled).enabled,'Enable approved digest')
  var page=req(extension.entryUrl,'GET')
  check(page.status===200 && /sandbox allow-scripts/.test(page.header['Content-Security-Policy']) && !/allow-same-origin/.test(page.header['Content-Security-Policy']),'Guest HTML gets opaque HTTP sandbox')
  check(page.header['Access-Control-Allow-Origin']==='*','Only public assets have anonymous CORS')
  check(page.header['X-DNS-Prefetch-Control']==='off' && page.header['Connection-Allowlist']==='("http://localhost:8888'+extension.entryUrl.replace(/index\.html$/,'')+'*")','Guest network allowlist is limited to immutable package assets')
  check(!req('/web-extensions','GET').header['Access-Control-Allow-Origin'],'API has no CORS grant')
  check(req('/web-extension-assets/'+extension.digest+'/%2e%2e/mini-a-web.json','GET').status===400,'Encoded traversal denied')
  check(req('/web-extension-assets/'+extension.digest+'/../mini-a-web.json','GET').status!==200,'Plain traversal denied')
  check(req('/web-extension-frame/'+extension.digest,'GET').header['Content-Security-Policy'].indexOf('/web-extension-assets/'+extension.digest+'/')>=0,'Containment framing constrained to approved snapshot')
  var prefixed=MiniAWebExtensions.route({uri:'/web-extensions',originalURI:'/tools/mini-a/web-extensions',method:'GET',header:{host:'localhost:8888','x-mini-a-token':token,origin:'http://localhost:8888'}})
  check(result(prefixed).extensions[0].entryUrl.indexOf('/tools/mini-a/web-extension-assets/')===0,'Original request prefix retained after route normalization')
  var bound=result(post({action:'bind',extensionId:manifest.id,digest:extension.digest,uuid:uuid}))
  check(!!bound.binding && bound.instanceId!==bound.binding,'Host binding and guest instance IDs are distinct')
  var save={action:'save',binding:bound.binding,expectedRevision:0,title:'Document',filename:'test.txt',mimeType:'text/plain',content:{encoding:'utf8',text:'Olá 🌍'}}
  check(docs(merge(save,{uuid:other})).status===403,'Binding cannot save in another session')
  var first=docs(save), document=result(first)
  check(first.status===200 && document.revision===1,'Native explicit save')
  check(MiniAWebDocuments.linked(uuid).length===1 && MiniAWebDocuments.linked(other).length===0,'Conversation links are scoped')
  var read=result(docs({action:'read',id:document.id}))
  check(fs.utf8(java.util.Base64.getDecoder().decode(read.content.data))==='Olá 🌍','UTF-8 round trip')
  var changed=merge(save,{id:document.id,expectedRevision:1,content:{encoding:'utf8',text:'Updated'}})
  check(docs(changed).status===200,'Second revision saved')
  check(docs(changed).status===409,'Stale save rejected')
  check(docs(merge(changed,{id:genUUID(),expectedRevision:0})).status===403,'Binding cannot select another document')
  check(docs({action:'read',id:'../../etc/passwd'}).status===400,'Document traversal denied')
  var download=docs({action:'download',id:document.id})
  check(download.mimetype==='application/octet-stream' && /attachment/.test(download.header['Content-Disposition']),'Native downloads cannot execute inline')
  MiniAWebExtensions.disposeSession(uuid)
  check(MiniAWebDocuments.linked(uuid).length===1,'Session expiry retains document references')
  check(docs(merge(changed,{expectedRevision:2})).status===403,'Disposed session revokes editor binding')
  MiniAWebExtensions.close();MiniAWebExtensions.init(args)
  check(MiniAWebDocuments.read(document.id).artifact.revision===2,'Committed document survives restart')
  var orphan=home+'/.openaf-mini-a/web-documents/'+document.id+'/native-3.bin'
  io.writeFileString(orphan,'interrupted commit')
  MiniAWebExtensions.init(args)
  check(!io.fileExists(orphan) && MiniAWebDocuments.read(document.id).artifact.revision===2,'Recovery discards bytes without a committed metadata pointer')
  rejects(function(){fs.acquire(home+'/.openaf-mini-a/web-documents')},'storage_busy')
  var assetBefore=fs.hash(page.data)
  io.writeFileString(fixturePlugin+'/web/index.html','changed source')
  check(fs.hash(req(extension.entryUrl,'GET').data)===assetBefore,'Source replacement cannot mutate approved snapshot')
  var refreshed=result(post({action:'refresh'})).extensions[0]
  check(refreshed.digest!==extension.digest && !refreshed.enabled,'Changed bytes require renewed enablement')
  check(req(extension.entryUrl,'GET').status!==200,'Old digest cannot mount after refresh')
  var gated=JSON.parse(JSON.stringify(manifest));gated.id='org.example.gated';gated.extensions={'x-mini-a-release-gate':{id:'fixture-browser',required:true}}
  makePlugin(temp+'/gated',gated)
  io.writeFileJSON(configPath,{directories:[fixturePlugin,temp+'/gated'],publicOrigin:'http://localhost:8888'})
  MiniAWebExtensions.init(args)
  check(result(req('/web-extensions','GET')).extensions.some(function(x){return x.id===gated.id && x.status==='unavailable'}),'Conformance gate fails closed')
  var future=JSON.parse(JSON.stringify(manifest));future.id='org.example.future';future.minMiniAVersion='99991231'
  makePlugin(temp+'/future',future)
  io.writeFileJSON(configPath,{directories:[temp+'/future'],publicOrigin:'http://localhost:8888'})
  MiniAWebExtensions.init(args)
  var incompatible=result(req('/web-extensions','GET')).extensions[0]
  check(incompatible.status==='unavailable' && incompatible.reason==='Mini-A version is too old','Minimum Mini-A build version is enforced against actual package metadata')
  check(post({action:'enable',extensionId:future.id,digest:incompatible.digest,permissions:future.permissions}).status===409,'An incompatible minimum host version cannot be enabled')
  var duplicate=temp+'/duplicate';makePlugin(duplicate,manifest)
  io.writeFileJSON(configPath,{directories:[fixturePlugin,duplicate],publicOrigin:'http://localhost:8888'})
  MiniAWebExtensions.init(args)
  check(result(req('/web-extensions','GET')).extensions[0].reason==='Duplicate extension ID','Duplicate IDs fail closed')
  var target=temp+'/secret.txt';io.writeFileString(target,'secret')
  java.nio.file.Files.createSymbolicLink(java.nio.file.Paths.get(fixturePlugin+'/web/link.txt'),java.nio.file.Paths.get(target))
  io.writeFileJSON(configPath,{directories:[fixturePlugin],publicOrigin:'http://localhost:8888'})
  MiniAWebExtensions.init(args)
  check(result(req('/web-extensions','GET')).extensions.length===0,'Symlink asset rejects package')
  rejects(function(){MiniAWebDocuments.save({expectedRevision:0,title:'Bad',filename:'bad.txt',mimeType:'text/plain',content:{encoding:'base64',data:'!!!!'}})},'invalid_content')
  rejects(function(){MiniAWebDocuments.save({expectedRevision:0,title:'Bad',filename:'../bad.txt',mimeType:'text/plain',content:{encoding:'utf8',text:'x'}})},'invalid_filename')
  var authorizeCalls=0
  rejects(function(){MiniAWebDocuments.save({id:document.id,expectedRevision:2,title:'Revoked',filename:'test.txt',mimeType:'text/plain',content:{encoding:'utf8',text:'Never commit'},authorize:function(){return ++authorizeCalls<3}})},'permission_denied')
  check(MiniAWebDocuments.read(document.id).artifact.revision===2,'Revocation before atomic metadata commit preserves prior document')
  authorizeCalls=0
  rejects(function(){MiniAWebDocuments.save({expectedRevision:0,title:'Revoked new document',filename:'new.txt',mimeType:'text/plain',content:{encoding:'utf8',text:'Never create'},authorize:function(){return ++authorizeCalls<3}})},'permission_denied')
  check(MiniAWebDocuments.list().length===1,'Revoked creation removes its uncommitted directory immediately')
  MiniAWebDocuments.unlinkSession(uuid)
  check(MiniAWebDocuments.list().length===1 && MiniAWebDocuments.linked(uuid).length===0,'Unlink preserves independently saved documents')
  MiniAWebDocuments.remove(document.id,2)
  check(MiniAWebDocuments.list().length===0,'Explicit document deletion')
  ;[{directories:'not-an-array'},{roots:[42]},{defaults:[]},{mounts:[]},{conformance:{'org.example.text':{digest:'bad',gates:[]}}},{limits:{nativeBytes:0}}].forEach(function(invalid){io.writeFileJSON(configPath,invalid);rejects(function(){MiniAWebExtensions.init(args)},'invalid_config')})
  ;[0,-1,NaN,Infinity,1.5,'1024'].forEach(function(invalid){rejects(function(){MiniAWebDocuments.init({enabled:true,root:temp+'/invalid-limits',nativeBytes:invalid})},'invalid_config')})
  print('PASS '+checks+' Web Extension backend checks')
} catch(e) {failure=e} finally {MiniAWebExtensions.close();io.rm(temp)}
if(failure){printErr(String(failure));exit(1)}
