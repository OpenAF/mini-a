// Per-instance artifact broker. Never exposes a host path or accepts browser-supplied code.
var MiniAWebArtifacts = (function() {
  var enabled = false, root = '', worker = '', secret = '', formats = [], runs = {}, bindings = {}, busy = false
  var serverModels = {}, modelsLocked = false
  var lock = new java.util.concurrent.locks.ReentrantLock(), ttl = 24 * 60 * 60 * 1000
  function fail(message) { throw new Error(message) }
  function uuid(value) { if (!/^[a-f0-9-]{36}$/i.test(String(value))) fail('Invalid identifier'); return String(value) }
  function logEvent(event, item) { log('[artifacts] ' + stringify({event:event, id:item.id, session:item.session, size:item.size, format:item.format}, __, '')) }
  function atomic(path, bytes) {
    var temporary = path + '.tmp-' + genUUID()
    try {
      java.nio.file.Files.write(java.nio.file.Paths.get(temporary), bytes)
      java.nio.file.Files.move(java.nio.file.Paths.get(temporary), java.nio.file.Paths.get(path), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    } finally { java.nio.file.Files.deleteIfExists(java.nio.file.Paths.get(temporary)) }
  }
  function save(item) { atomic(root + '/' + item.id + '.json', new java.lang.String(stringify(item, __, '')).getBytes('UTF-8')) }
  function records() {
    return io.listFiles(root).files.filter(function(f) { return f.isFile && /^[a-f0-9-]{36}\.json$/i.test(f.filename) }).map(function(f) { return io.readFileJSON(f.canonicalPath) })
  }
  function cleanup() {
    if (!enabled) return
    lock.lock()
    try {
      records().forEach(function(item) {
        if (item.expires <= Date.now() && item.status !== 'expired' && item.status !== 'deleted') {
          io.rm(root + '/' + item.id + '.bin'); item.status = 'expired'; save(item); logEvent('expired',item)
        }
        if (item.expires + 7 * ttl < Date.now()) io.rm(root + '/' + item.id + '.json')
      })
    } finally { lock.unlock() }
  }
  function rpc(payload, timeout) {
    var connection = new java.net.URL(worker).openConnection()
    connection.setConnectTimeout(5000); connection.setReadTimeout(timeout || 150000)
    connection.setRequestMethod('POST'); connection.setDoOutput(true)
    connection.setRequestProperty('Content-Type','application/json')
    connection.setRequestProperty('x-mini-a-worker-token', secret)
    var output = connection.getOutputStream()
    try { output.write(new java.lang.String(stringify(payload, __, '')).getBytes('UTF-8')) } finally { output.close() }
    var stream, buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,8192), out = new java.io.ByteArrayOutputStream()
    try {
      if (connection.getResponseCode() !== 200) fail('Worker rejected request')
      stream = connection.getInputStream()
      var count
      while ((count = stream.read(buffer)) !== -1) {
        if (out.size() + count > 145 * 1024 * 1024) fail('Worker response exceeds limit')
        out.write(buffer,0,count)
      }
      var response = jsonParse(String(out.toString('UTF-8')))
      if (response.error) fail('Worker rejected generation')
      return response
    } finally { if (stream) stream.close(); connection.disconnect() }
  }
  function init(args) {
    enabled = false
    if (toBoolean(args.webartifacts) !== true) return
    if (!isString(args.webtoken) || args.webtoken.length < 32) fail('webartifacts requires a webtoken of at least 32 characters')
    if (!/^(true|on|1|auto|linux|macos|windows)$/i.test(String(args.usesandbox))) fail('webartifacts requires enabled usesandbox')
    secret = String(getEnv('MINIA_ARTIFACT_WORKER_TOKEN') || '')
    worker = String(args.artifactworkerurl || '')
    if (secret.length < 32 || !/^https?:\/\/[^?#]+\/artifact-worker$/.test(worker)) fail('Configure private artifactworkerurl and MINIA_ARTIFACT_WORKER_TOKEN')
    var configuredRoot = String(args.artifactdir || (java.lang.System.getProperty('user.home') + '/.mini-a-artifacts'))
    if (java.nio.file.Files.isSymbolicLink(java.nio.file.Paths.get(configuredRoot))) fail('Artifact storage cannot be a link')
    root = String(new java.io.File(configuredRoot).getCanonicalPath())
    var publicRoot = new java.io.File(typeof __miniAPath === 'function' ? __miniAPath('public') : String(getOPackPath('mini-a') || '.') + '/public').getCanonicalPath()
    if (root === String(publicRoot) || root.indexOf(String(publicRoot) + '/') === 0) fail('Artifact storage must be outside static public content')
    var path = java.nio.file.Paths.get(root)
    if (java.nio.file.Files.isSymbolicLink(path)) fail('Artifact storage cannot be a link')
    java.nio.file.Files.createDirectories(path)
    java.nio.file.Files.setPosixFilePermissions(path, java.nio.file.attribute.PosixFilePermissions.fromString('rwx------'))
    var health = rpc({action:'health'}, 20000)
    if (health.protocol !== 1 || health.ready !== true || !isArray(health.formats)) fail('Artifact worker is not ready')
    formats = health.formats
    enabled = true
    // Remove incomplete atomic writes and orphan snapshots left by a crash.
    io.listFiles(root).files.forEach(function(file) {
      if (file.filename.indexOf('.tmp-') >= 0 || (/^[a-f0-9-]{36}\.bin$/i.test(file.filename) && !io.fileExists(root + '/' + file.filename.replace(/\.bin$/, '.json')))) io.rm(file.canonicalPath)
    })
    // Pending files from a crashed run cannot be published after restart.
    records().forEach(function(item) { if ((item.status === 'pending' || item.status === 'selected')) { io.rm(root + '/' + item.id + '.bin'); item.status = 'expired'; save(item) } })
    cleanup()
    protect(args)
  }
  function protect(args) {
    if (!enabled) return args
    ;['useshell','useutils','useskills','useskillswiki','usedelegation','usejsontool','useprogcall','usehistory','historyvm','historyvmshadow','usememory','useplanning','usewiki','wikiretrieval','wikiretrievalv2','usemaps','usecharts','usebrowser','useojob','readwrite','mcpproxy','mcpdynamic','usecontext','useexec','mcpprogcall','autodelegation','contextvirtualization','contextvirtualizationshadow','sessionprewarm','useaudit','usereflection','usereflectionmemory','resumefailed'].forEach(function(key) { args[key] = false })
    ;['mcp','plugins','pluginsroot','pluginsroots','exec','shell','shellprefix','workerreg','conversation','init','execinit','execbefore','execafter','goalprefix','rules','knowledge','libs','outfile','outfileall','outputfile','planfile','subtasks','subtasksfile','plancontent','validationgoal','validationcmd','planlog','metricsch','auditch','debugch','toollog','debuglcch','debugdecch','debugvalch'].forEach(function(key) { delete args[key] })
    args.debug = false
    args.showexecs = false
    args.noagentsmd = true
    args.nosetmcpwd = true
    args.libs = ''
    args.usetools = true
    args.usesandbox = 'true'
    args.format = 'markdown'
    // Provider-native filesystem/tools integrations are outside this profile.
    ;['model','modellc','modelval','modeldec','modelvisual'].forEach(function(key) {
      var env = {model:'OAF_MODEL',modellc:'OAF_LC_MODEL',modelval:'OAF_VAL_MODEL',modeldec:'OAF_DECIDE_MODEL',modelvisual:'OAF_VISUAL_MODEL'}[key]
      var raw = modelsLocked ? serverModels[key] : (args[key] || getEnv(env))
      if (!raw) { delete args[key]; return }
      if (!raw) return
      var config = isString(raw) ? af.fromJSSLON(raw) : clone(raw)
      if (['openai','ollama','anthropic','gemini'].indexOf(config.type) < 0) fail('Artifact profile requires a supported plain model provider')
      ;[config,config.params].forEach(function(value) { if (isMap(value)) ['tools','functions','tool_choice','function_call','toolConfig'].forEach(function(field) { delete value[field] }) })
      args[key] = stringify(config, __, '')
      serverModels[key] = args[key]
    })
    modelsLocked = true
    return args
  }
  function begin(session, run, live) {
    if (!enabled) return null
    cleanup()
    var binding = bindings[session] || {}
    binding.session=uuid(session);binding.run=uuid(run);binding.live=live
    bindings[session]=binding
    runs[session] = binding
    return binding
  }
  function generate(binding, params) {
    binding = {session:binding.session,run:binding.run,live:binding.live}
    if (!binding.live()) fail('Run is no longer active')
    if (!isString(params.code) || params.code.length > 1000000 || !isArray(params.outputs) || params.outputs.length < 1 || params.outputs.length > 10) fail('Invalid generation request')
    params.outputs.forEach(function(name) { MiniAArtifactPolicy.name(name); if (formats.indexOf(name.split('.').pop().toLowerCase()) < 0) fail('Format unavailable') })
    lock.lock()
    try {
      if (busy) fail('Worker busy; retry later')
      var existing = records(), used = 0, runUsed = 0, runCount = 0
      existing.forEach(function(item) { if ((item.status === 'pending' || item.status === 'selected') || item.status === 'published') { used += item.size; if (item.run === binding.run) {runUsed += item.size; runCount++} } })
      if (existing.length >= 10000 || used + MiniAArtifactPolicy.maxRun > 500 * 1024 * 1024 || runUsed >= MiniAArtifactPolicy.maxRun || runCount + params.outputs.length > 10) fail('Artifact quota exceeded')
      busy = true
      binding.remaining = MiniAArtifactPolicy.maxRun - runUsed
    } finally { lock.unlock() }
    try {
      var response = rpc({action:'generate',id:binding.run,code:params.code,outputs:params.outputs})
      if (!binding.live()) fail('Run cancelled')
      if (!isArray(response.files) || response.files.length !== params.outputs.length) fail('Invalid worker response')
      var files = [], total = 0
      response.files.forEach(function(file,index) {
        if (file.name !== params.outputs[index] || !isString(file.data) || file.data.length > 4 * Math.ceil(MiniAArtifactPolicy.maxFile / 3)) fail('Invalid worker output')
        var bytes = java.util.Base64.getDecoder().decode(file.data)
        if (bytes.length > MiniAArtifactPolicy.maxFile || bytes.length !== file.size) fail('Invalid worker size')
        total += bytes.length
        if (total > binding.remaining) fail('Run byte limit')
        files.push({bytes:bytes, item:{id:genUUID(),session:binding.session,run:binding.run,name:file.name,size:bytes.length,format:file.name.split('.').pop().toLowerCase(),created:Date.now(),expires:Date.now()+ttl,status:'pending'}})
      })
      lock.lock()
      try {
        if (!binding.live()) fail('Run cancelled')
        try { files.forEach(function(file) { atomic(root + '/' + file.item.id + '.bin',file.bytes); save(file.item); logEvent('created',file.item) }) }
        catch(e) { files.forEach(function(file) {io.rm(root+'/'+file.item.id+'.bin');io.rm(root+'/'+file.item.id+'.json')});throw e }
      } finally { lock.unlock() }
      return files.map(function(file) { return publicItem(file.item) })
    } finally { lock.lock(); try {busy=false} finally {lock.unlock()} }
  }
  function publicItem(item) { return {id:item.id, run:item.run, name:item.name, size:item.size, format:item.format, expires:item.expires, status:item.status} }
  function publish(binding, ids) {
    if (!binding.live() || !isArray(ids) || ids.length < 1 || ids.length > 10) fail('Invalid publication request')
    lock.lock()
    try {
      var selected = ids.map(function(id) {
        var item = io.readFileJSON(root + '/' + uuid(id) + '.json')
        if (item.session !== binding.session || item.run !== binding.run || item.status !== 'pending' || item.expires <= Date.now()) fail('Candidate unavailable')
        return item
      })
      selected.forEach(function(item) { item.status='selected';save(item);logEvent('selected',item) })
      return selected.map(publicItem)
    } finally { lock.unlock() }
  }
  function finish(binding, success) {
    if (!binding) return
    lock.lock()
    try {
      records().forEach(function(item) {
        if (item.run === binding.run && item.status === 'selected' && success) { item.status = 'published'; save(item); logEvent('published',item); return }
        if (item.run === binding.run && ((item.status === 'pending' || item.status === 'selected') || (!success && item.status === 'published'))) {
          io.rm(root + '/' + item.id + '.bin');item.status='expired';save(item)
        }
      })
      if (runs[binding.session] === binding) delete runs[binding.session]
    } finally { lock.unlock() }
  }
  function cancel(session) {
    var binding = runs[session]
    if (binding) { try { rpc({action:'cancel',id:binding.run},10000) } catch(ignore) {} }
  }
  function remove(session) {
    if (!enabled) return
    lock.lock()
    try { records().forEach(function(item) { if (item.session === session) { io.rm(root+'/'+item.id+'.bin');item.status='deleted';save(item);logEvent('deleted',item) } }) } finally { lock.unlock() }
  }
  function route(request) {
    var headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
    try {
      // Header authentication only; no bearer credentials in download URLs.
      if (!enabled || request.method !== 'POST' || !request.header || request.header['x-mini-a-token'] !== global.__webtoken) return ow.server.httpd.reply({error:'unauthorized'},401,__,headers)
      var raw = request.files.postData
      if (!isString(raw) || raw.length > 500) fail('Invalid artifact request')
      var data = jsonParse(raw), session = uuid(data.uuid)
      cleanup()
      lock.lock()
      try {
        if (!data.id) return ow.server.httpd.reply({files:records().filter(function(item) {return item.session===session && ['pending','selected'].indexOf(item.status)<0}).map(publicItem)},200,__,headers)
        var item = io.readFileJSON(root+'/'+uuid(data.id)+'.json')
        if (item.session !== session || item.status !== 'published' || item.expires <= Date.now()) fail('File unavailable')
        headers['Content-Disposition'] = 'attachment; filename="' + item.name + '"'
        var bytes = MiniAArtifactPolicy.readRegular(root+'/'+item.id+'.bin')
        if (bytes.length !== item.size) fail('File unavailable')
        logEvent('downloaded',item)
        return ow.server.httpd.reply(bytes,200,'application/octet-stream',headers)
      } finally { lock.unlock() }
    } catch(e) { return ow.server.httpd.reply({error:'File unavailable'},404,__,headers) }
  }
  function guardAdvanced(data) {
    if (!enabled) return
    var actions = ['snapshot','results','result','stats','sessions','session-preview','stop','reply','command']
    if (!isMap(data) || actions.indexOf(data.action) < 0 || (data.action === 'command' && (!isString(data.command) || /^\s*[/$]/.test(data.command)))) fail('Operation disabled in artifact isolation profile')
  }
  function config(binding) {
    var fns = {
      create_download: function(p) {
        MiniAArtifactPolicy.name(p.name)
        if (!isString(p.content) || p.content.length > 1000000) fail('Text content limit')
        return generate(binding,{outputs:[p.name],code:'io.writeFileString('+stringify(p.name)+','+stringify(p.content)+')'})
      },
      generate_downloads: function(p) { return generate(binding,p) },
      publish_generated: function(p) { return publish(binding,p.ids) }
    }, meta = {}
    meta.create_download={name:'create_download',description:'Create a text download candidate. Then publish its returned ID. Available formats: '+formats.join(', '),inputSchema:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content']}}
    meta.generate_downloads={name:'generate_downloads',description:'Execute OpenAF JavaScript in an isolated networkless worker. Write named files in the current directory. Return validated candidates, then publish selected IDs. No host files or environment secrets are available. PDF/DOCX: loadLib("mdconvert.js") and MDConvert; XLSX: plugin("XLS"); PPTX: loadExternalJars(getOPackPath("plugin-XLS")) and Apache POI XSLF; raster images: Java ImageIO/Java2D. Available formats: '+formats.join(', '),inputSchema:{type:'object',properties:{code:{type:'string'},outputs:{type:'array',items:{type:'string'}}},required:['code','outputs']}}
    meta.publish_generated={name:'publish_generated',description:'Explicitly publish selected generated candidate IDs for the user to download.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'}}},required:['ids']}}
    Object.keys(fns).forEach(function(key) { var fn=fns[key];fns[key]=function(p) { try { return fn(p||{}) } catch(e) { logEvent('rejected',{session:binding.session});return {error:'Artifact operation unavailable, rejected or over quota'} } } })
    return {id:'mini-a-artifacts',type:'dummy',options:{name:'mini-a-artifacts',fns:fns,fnsMeta:meta}}
  }
  return {init:init,protect:protect,begin:begin,config:config,finish:finish,cancel:cancel,remove:remove,cleanup:cleanup,route:route,guardAdvanced:guardAdvanced,enabled:function(){return enabled}}
})()
