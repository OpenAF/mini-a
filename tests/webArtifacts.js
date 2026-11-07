try {
// Run with MINIA_ARTIFACT_WORKER_TOKEN=fixture-only-worker-token-000000000 oaf -f tests/webArtifacts.js
// No model or Docker required.
// The private worker protocol is a fixture; OS isolation is tested separately.
ow.loadServer()
loadLib('js/artifacts/mini-a-artifact-policy.js')
loadLib('js/web/mini-a-web-artifacts.js')
var failures = 0
function check(value, label) { if (!value) { failures++; printErr('FAIL: ' + label) } }
function rejects(fn, label) { var rejected = false; try { fn() } catch(e) { rejected = true }; check(rejected,label) }
function bytes(text) { return new java.lang.String(text).getBytes('UTF-8') }
var policy = MiniAArtifactPolicy
check(policy.validate('hello.txt',bytes('Olá')) === 'txt','UTF-8 text')
check(policy.validate('hello.json',bytes('{"a":1}')) === 'json','JSON')
rejects(function(){policy.name('../secret.txt')},'Traversal')
rejects(function(){policy.name('run.exe')},'Executable')
rejects(function(){policy.validate('invalid.json',bytes('{bad'))},'Invalid JSON')
rejects(function(){policy.validate('formula.csv',bytes('name,value\na,=EXEC()'))},'CSV formula')
check(policy.validate('static.svg',bytes('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')) === 'svg','Static SVG')
rejects(function(){policy.validate('active.svg',bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))},'SVG script')
rejects(function(){policy.validate('external.svg',bytes('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.invalid/x"/></svg>'))},'SVG external reference')
rejects(function(){policy.validate('entity.svg',bytes('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'))},'XML entity')
function office(extra) {
  var out = new java.io.ByteArrayOutputStream(), zip = new java.util.zip.ZipOutputStream(out)
  var files = {'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'}
  Object.keys(extra || {}).forEach(function(key){files[key]=extra[key]})
  Object.keys(files).forEach(function(key){zip.putNextEntry(new java.util.zip.ZipEntry(key));zip.write(bytes(files[key]));zip.closeEntry()});zip.close()
  return out.toByteArray()
}
check(policy.validate('plain.docx',office())==='docx','Passive Office package')
rejects(function(){policy.validate('external.docx',office({'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship TargetMode="&#69;xternal" Target="https://example.invalid"/></Relationships>'}))},'Encoded external Office relationship')
rejects(function(){policy.validate('macro.docx',office({'word/vbaProject.bin':'macro'}))},'Office macro')
var directory=String(java.nio.file.Files.createTempDirectory('mini-a-artifacts-test-').toFile().getCanonicalPath())
var secret=String(getEnv('MINIA_ARTIFACT_WORKER_TOKEN') || '')
if (secret.length < 32) { printErr('Set the fixture MINIA_ARTIFACT_WORKER_TOKEN'); exit(1) }
var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress('127.0.0.1',0),0)
var calls=0, lastAction, cancelCount=0, checkBusy=false, cancelDuring=false
server.createContext('/artifact-worker',new JavaAdapter(com.sun.net.httpserver.HttpHandler,{handle:function(exchange){
  try {
    var raw=String(new java.lang.String(exchange.getRequestBody().readAllBytes(),'UTF-8')), data=jsonParse(raw), response
    check(String(exchange.getRequestHeaders().getFirst('x-mini-a-worker-token'))===secret,'Private worker header')
    lastAction=data.action
    if(data.action==='health') response={ready:true,protocol:1,formats:['txt','json','svg']}
    else if(data.action==='cancel'){cancelCount++;response={ok:true}}
    else {calls++;if(checkBusy){check(!!tools.create_download({name:"busy.txt",content:"busy"}).error,"Concurrent generation denied")}if(cancelDuring)live=false;response={files:data.outputs.map(function(name){var payload=bytes('fixture output');return {name:name,size:payload.length,data:String(java.util.Base64.getEncoder().encodeToString(payload))}})}}
    var encoded=bytes(stringify(response,__ ,''));exchange.sendResponseHeaders(200,encoded.length);exchange.getResponseBody().write(encoded)
  } finally {exchange.close()}
}}))
server.start()
try {
  var args={webartifacts:true,usesandbox:'true',webtoken:'fixture-web-token-00000000000000000',artifactdir:directory,artifactworkerurl:'http://127.0.0.1:'+server.getAddress().getPort()+'/artifact-worker',model:'(type: openai, model: fixture, key: fixture)',useshell:true,useutils:true,mcp:'unsafe',libs:'unsafe'}
  MiniAWebArtifacts.init(args)
  check(args.useshell===false && args.useutils===false && args.mcp===undefined && args.libs==='','Restricted profile')
  var override={useshell:true,useutils:true,model:'(type: openai, model: bad, key: bad, url: "https://attacker.invalid")'}
  MiniAWebArtifacts.protect(override)
  check(override.useshell===false && override.model.indexOf('attacker')<0,'Restored settings cannot widen profile or replace provider')
  rejects(function(){MiniAWebArtifacts.guardAdvanced({action:'settings',values:{useshell:true}})},'Advanced settings cannot widen profile')
  rejects(function(){MiniAWebArtifacts.guardAdvanced({action:'command',command:'/shell cat /etc/passwd'})},'Advanced console command denied')
  MiniAWebArtifacts.guardAdvanced({action:'command',command:'create a report'})
  load('mini-a.js')
  rejects(function(){MiniA.prototype._filePath.call({_artifactBinding:{}},'/etc/passwd')},'Core host filesystem denied')
  rejects(function(){MiniA.prototype._runCommand.call({_artifactBinding:{}},{command:'cat /etc/passwd'})},'Core host shell denied')
  global.__webtoken=args.webtoken
  var session=genUUID(), run=genUUID(), live=true
  var binding=MiniAWebArtifacts.begin(session,run,function(){return live}), tools=MiniAWebArtifacts.config(binding).options.fns
  checkBusy=true
  var generated=tools.create_download({name:'hello.txt',content:'hello'})
  checkBusy=false
  check(isArray(generated)&&generated.length===1,'Generation candidate')
  check(!!tools.create_download({name:'script.exe',content:'unsafe'}).error,'Tool rejects unsupported format')
  function request(uuid,id,auth){return MiniAWebArtifacts.route({method:'POST',header:auth===false?{}:{'x-mini-a-token':args.webtoken},params:{token:args.webtoken},files:{postData:stringify({uuid:uuid,id:id},__ ,'')}})}
  check(request(session,generated[0].id,false).status===401,'Query token alone denied')
  check(request(session,generated[0].id).status===404,'Unpublished candidate denied')
  tools.publish_generated({ids:[generated[0].id]})
  check(request(session,generated[0].id).status===404,'Selected output hidden until success')
  MiniAWebArtifacts.finish(binding,true)
  var downloaded=request(session,generated[0].id)
  check(downloaded.status===200 && downloaded.mimetype==='application/octet-stream','Binary attachment')
  check(downloaded.header['Cache-Control']==='no-store' && downloaded.header['X-Content-Type-Options']==='nosniff','Download headers')
  check(request(genUUID(),generated[0].id).status===404,'Cross-session denied')
  check(request(session,'../../etc/passwd').status===404,'Forged ID denied')
  var next=MiniAWebArtifacts.begin(session,genUUID(),function(){return live})
  check(next===binding,'Repeated turns retain tool binding')
  var second=tools.create_download({name:'second.txt',content:'second'})
  tools.publish_generated({ids:[second[0].id]})
  MiniAWebArtifacts.cancel(session);check(cancelCount===1,'Cancellation reaches worker')
  MiniAWebArtifacts.finish(next,false)
  check(request(session,second[0].id).status===404,'Failed run revokes selected output')
  var pending=MiniAWebArtifacts.begin(session,genUUID(),function(){return true})
  var candidate=tools.create_download({name:'pending.txt',content:'pending'})
  MiniAWebArtifacts.init(args)
  check(request(session,candidate[0].id).status===404,'Restart invalidates pending output')
  check(request(session,generated[0].id).status===200,'Published output survives restart')
  var priorCalls=calls
  var quota=io.readFileJSON(directory+'/'+generated[0].id+'.json');quota.size=500*1024*1024;io.writeFileJSON(directory+'/'+generated[0].id+'.json',quota)
  var quotaBinding=MiniAWebArtifacts.begin(session,genUUID(),function(){return true})
  check(!!tools.create_download({name:'quota.txt',content:'quota'}).error && calls===priorCalls,'Quota rejects before worker dispatch')
  quota.size=14;io.writeFileJSON(directory+'/'+generated[0].id+'.json',quota)
  MiniAWebArtifacts.finish(quotaBinding,false)
  live=true
  MiniAWebArtifacts.begin(session,genUUID(),function(){return live})
  cancelDuring=true
  check(!!tools.create_download({name:'cancelled.txt',content:'cancelled'}).error,'Late worker response rejected after cancellation')
  cancelDuring=false
  MiniAWebArtifacts.remove(session)
  check(request(session,generated[0].id).status===404,'Session deletion revokes output')
  var meta=io.readFileJSON(directory+'/'+generated[0].id+'.json');meta.expires=Date.now()-1;meta.status='published';io.writeFileJSON(directory+'/'+generated[0].id+'.json',meta)
  MiniAWebArtifacts.cleanup();check(request(session,generated[0].id).status===404,'Expiry')
  var file=directory+'/regular.txt';io.writeFileString(file,'safe')
  var link=java.nio.file.Paths.get(directory+'/link.txt');java.nio.file.Files.createSymbolicLink(link,java.nio.file.Paths.get(file))
  rejects(function(){policy.readRegular(String(link))},'Symlink output denied')
  java.nio.file.Files.createLink(java.nio.file.Paths.get(directory+'/hard.txt'),java.nio.file.Paths.get(file))
  rejects(function(){policy.readRegular(file)},'Hard-linked output denied')
} finally {server.stop(0);io.rm(directory)}
if(failures){printErr(failures+' failures');exit(1)}
print('Artifact policy, private protocol, publication, auth, ownership, restart, cancellation and cleanup checks passed.')

} catch(e) { printErr(e); exit(1) }
