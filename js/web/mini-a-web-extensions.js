// Opt-in, local Web Extension registry and authenticated host endpoints. Apache-2.0.
if (typeof __miniAPath !== 'function') loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + '/mini-a-paths.js')
loadLib(__miniAPath('js/skills/mini-a-plugin-paths.js'), true)
loadLib(__miniAPath('public/web-extension-contract.js'), true)
loadLib(__miniAPath('js/web/mini-a-web-documents.js'), true)

var MiniAWebExtensions = (function() {
  var fs = MiniAWebDocumentIO, active = false, args = {}, config = {}, registry = {}, grants = {}, bindings = {}, root = '', epoch = 0
  var lock = new java.util.concurrent.locks.ReentrantLock(), leaseMs = 45000
  var processLock
  var limits = {nativeBytes:8388608,exportBytes:16777216,storedBytes:536870912,controlBytes:65536,instances:4}
  var mimeTypes = {html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',mjs:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',xml:'application/xml',txt:'text/plain; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',wasm:'application/wasm',map:'application/json'}
  function fail(code,message,status) { fs.fail(code,message,status) }
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function fields(data, allowed) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(function(k) { return allowed.indexOf(k) < 0 })) fail('invalid_request', 'Unexpected request fields')
  }
  function origin(value) {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) fail('invalid_origin', 'A full HTTP(S) origin is required')
    var parsed = new java.net.URI(value), host = parsed.getHost(), port = parsed.getPort()
    if (!host || parsed.getRawUserInfo() !== null || parsed.getRawQuery() !== null || parsed.getRawFragment() !== null || String(parsed.getRawPath() || '') !== '' || port === 0 || port > 65535) fail('invalid_origin', 'Invalid origin')
    var scheme = String(parsed.getScheme()), name = String(host).toLowerCase()
    if (name.indexOf(':') >= 0 && name.charAt(0) !== '[') name = '[' + name + ']'
    return scheme + '://' + name + (port >= 0 && !(scheme === 'http' && port === 80) && !(scheme === 'https' && port === 443) ? ':' + port : '')
  }
  function header(request,name) {
    var headers = request.header || {}, found
    Object.keys(headers).some(function(k) { if (k.toLowerCase() === name) { found = String(headers[k]); return true }; return false })
    return found
  }
  function publicOrigin(request) {
    if (config.publicOrigin) return config.publicOrigin
    var host = header(request, 'host')
    if (!host || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(host)) fail('invalid_origin', 'Configure publicOrigin for this deployment')
    return origin('http://' + host)
  }
  function auth(request) {
    if (!active) fail('unavailable','Web Extensions are disabled',503)
    var supplied = header(request,'x-mini-a-token')
    if (typeof supplied !== 'string' || !java.security.MessageDigest.isEqual(fs.bytes(supplied), fs.bytes(args.webtoken))) fail('unauthorized','Authentication required',401)
    var suppliedOrigin = header(request,'origin')
    if (suppliedOrigin !== undefined && (suppliedOrigin === 'null' || origin(suppliedOrigin) !== publicOrigin(request))) fail('forbidden','Request origin is not allowed',403)
    var site = header(request,'sec-fetch-site')
    if (site === 'cross-site' || site === 'same-site') fail('forbidden','Cross-origin requests are not allowed',403)
  }
  function body(request, max) {
    var raw = request.files && request.files.postData
    if (typeof raw !== 'string' || raw.length > max || fs.bytes(raw).length > max) fail('size_limit','Request exceeds size limit',413)
    var data=fs.parseJSON(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalid_request','Request must be a JSON object')
    var visit = function(value,depth) {
      if (depth > 24) fail('invalid_request','Request nesting limit')
      if (value && typeof value === 'object') Object.keys(value).forEach(function(key) { if (/^(__proto__|constructor|prototype)$/.test(key)) fail('invalid_request','Unsafe object key'); visit(value[key],depth+1) })
    }
    visit(data,0); return data
  }
  function enabledItem(id, digest) {
    var item = registry[id], grant = grants[id]
    if (!item || item.reason || !grant || grant.digest !== item.digest || (digest && digest !== item.digest)) fail('extension_unavailable','Extension is disabled or incompatible',403)
    return item
  }
  function snapshotPath(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest','Invalid package digest')
    return fs.safe(root, 'assets/' + digest)
  }
  function inventory(base, prefix, output) {
    if (java.nio.file.Files.isSymbolicLink(fs.path(base))) fail('invalid_path','Asset root cannot be a symbolic link')
    var walk = function(dir, relative, depth) {
      if (depth > 24) fail('asset_limit','Asset directory nesting limit')
      fs.list(dir).forEach(function(name) {
        var child = fs.safe(dir,name)
        if (name.charAt(0) === '.') return
        if (!/^[A-Za-z0-9_ .@()+,-]+$/.test(name)) fail('invalid_path','Unsupported asset filename')
        var next = relative ? relative + '/' + name : name
        if (java.nio.file.Files.isDirectory(fs.path(child))) walk(child,next,depth+1)
        else {
          if (output.length >= 20000) fail('asset_limit','Too many public assets')
          var bytes = fs.read(child,64*1024*1024), key = prefix + next
          output.push({path:key,source:child,size:bytes.length,sha256:fs.hash(bytes)})
        }
      })
    }
    walk(base,'',0)
  }
  function digestInventory(files) {
    return fs.hash(fs.bytes(files.map(function(f) { return f.path + '\t' + f.size + '\t' + f.sha256 }).sort().join('\n')))
  }
  function candidateDirectories() {
    var opts = {homedir:args.homedir,plugins:config.directories === undefined ? args.plugins : config.directories,pluginsroots:config.roots === undefined ? args.pluginsroots : config.roots,pluginsroot:config.roots === undefined ? args.pluginsroot : undefined}
    var found = [], seen = {}
    ;[opts.plugins,opts.pluginsroot,opts.pluginsroots].forEach(function(values) {
      __miniAPluginSplitDirList(values).forEach(function(value) {if(java.nio.file.Files.isSymbolicLink(fs.path(__miniAPluginExpandHomePath(value))))fail('invalid_path','Plugin directories cannot be symbolic links')})
    })
    function add(value) { var canonical = String(new java.io.File(value).getCanonicalPath()); if (!seen[canonical]) { seen[canonical] = true; found.push(canonical) } }
    __miniAPluginResolveExplicit(opts).forEach(add)
    __miniAPluginResolveRoots(opts).forEach(function(dir) {
      fs.list(dir).forEach(function(name) { if (name.charAt(0) === '.') return; var child = fs.safe(dir,name); if (java.nio.file.Files.isDirectory(fs.path(child))) add(child) })
    })
    if(found.length>256)fail('asset_limit','At most 256 extension directories can be discovered')
    return found
  }
  function discoverOne(dir) {
    var manifestFile = fs.safe(dir,'mini-a-web.json')
    if (!java.nio.file.Files.exists(fs.path(manifestFile))) return null
    var manifest = MiniAWebExtensionContract.validateManifest(fs.json(manifestFile,65536)), files = []
    inventory(fs.safe(dir,'web'),'',files)
    if (files.some(function(f) { return /^_(sdk|contract)\.js$/.test(f.path) })) fail('invalid_path','Reserved SDK asset name')
    ;[['_sdk.js','public/web-extension-sdk.js'],['_contract.js','public/web-extension-contract.js']].forEach(function(pair) {
      var source = __miniAPath(pair[1]), bytes = fs.read(source,1024*1024)
      files.push({path:pair[0],source:source,size:bytes.length,sha256:fs.hash(bytes)})
    })
    var reason = null
    ;(manifest.assetMounts || []).forEach(function(name) {
      var mount = config.mounts && config.mounts[manifest.id] && config.mounts[manifest.id][name]
      if (!mount) { reason = 'Required local asset mount is not configured: ' + name; return }
      fields(mount,['path','sha256'])
      if (typeof mount.path !== 'string' || typeof mount.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(mount.sha256)) fail('invalid_config','Asset mounts require a path and SHA-256 inventory digest')
      if (files.some(function(f) { return f.path === name || f.path.indexOf(name + '/') === 0 })) fail('invalid_config','Asset mount overlaps package assets')
      if(java.nio.file.Files.isSymbolicLink(fs.path(mount.path)))fail('invalid_path','Asset mounts cannot be symbolic links')
      var mounted = []; inventory(String(new java.io.File(mount.path).getCanonicalPath()),'',mounted)
      if (digestInventory(mounted) !== mount.sha256) fail('digest_mismatch','Mounted editor asset inventory changed')
      mounted.forEach(function(f) { f.path = name + '/' + f.path; files.push(f) })
    })
    files.sort(function(a,b) { return a.path.localeCompare(b.path) })
    if (!files.some(function(f) { return f.path === manifest.entry })) fail('invalid_manifest','Extension entry is missing')
    if (!/\.html?$/i.test(manifest.entry)) fail('invalid_manifest','Extension entry must be HTML')
    var total = files.reduce(function(sum,f) { return sum+f.size },0)
    if (total > 512*1024*1024) fail('asset_limit','Public assets exceed 512 MiB')
    var digest = fs.hash(fs.bytes(JSON.stringify(manifest) + '\n' + digestInventory(files)))
    if (manifest.apiVersions.indexOf('1.0') < 0) reason = 'No compatible Web Extension API version'
    if (manifest.minMiniAVersion && String(io.readFileYAML(__miniAPath('.package.yaml')).version) < manifest.minMiniAVersion) reason = 'Mini-A version is too old'
    var gate = manifest.extensions && manifest.extensions['x-mini-a-release-gate'], proof = config.conformance && config.conformance[manifest.id]
    if (gate && gate.required === true && (!proof || proof.digest !== digest || !Array.isArray(proof.gates) || proof.gates.indexOf(gate.id) < 0)) reason = 'Browser conformance gate has not been approved: ' + gate.id
    return {manifest:manifest,digest:digest,files:files,reason:reason}
  }
  function refresh() {
    var next = {}, warnings = [], duplicates = {}
    candidateDirectories().forEach(function(dir) {
      try {
        var item = discoverOne(dir)
        if (!item) return
        var id = item.manifest.id
        if (next[id]) { duplicates[id] = true; next[id].reason = 'Duplicate extension ID'; return }
        next[id] = item
      } catch(e) { warnings.push({code:e.code || 'invalid_extension',message:'An extension could not be loaded: ' + String(e.message || e).replace(/(?:\/[^\s:]+){2,}/g,'[path]')}) }
    })
    registry = next; epoch++
    Object.keys(bindings).forEach(function(key) { var b=bindings[key]; if (!registry[b.extensionId] || registry[b.extensionId].digest !== b.digest || registry[b.extensionId].reason) delete bindings[key] })
    pruneSnapshots()
    return {warnings:warnings}
  }
  function persistGrants() { fs.writeJSON(fs.safe(root,'grants.json'),{version:1,extensions:grants}) }
  function removeTree(dir) {
    fs.list(dir).forEach(function(name) {var p=fs.safe(dir,name);if(java.nio.file.Files.isDirectory(fs.path(p)))removeTree(p);else fs.remove(p)})
    fs.remove(dir)
  }
  function pruneSnapshots() {
    var keep={}
    Object.keys(registry).forEach(function(id){var item=registry[id];if(!item.reason && grants[id] && grants[id].digest===item.digest)keep[item.digest]=true})
    Object.keys(bindings).forEach(function(id){if(bindings[id].expires>=Date.now())keep[bindings[id].digest]=true})
    fs.list(fs.safe(root,'assets')).forEach(function(name){
      if(/^\.new-[a-f0-9-]+$/.test(name) || (/^[a-f0-9]{64}$/.test(name) && !keep[name]))removeTree(fs.safe(root,'assets/'+name))
      else if(/^[a-f0-9]{64}\.json$/.test(name) && !keep[name.substring(0,64)])fs.remove(fs.safe(root,'assets/'+name))
    })
  }
  function snapshot(item) {
    var destination = snapshotPath(item.digest), temporary = fs.safe(root,'assets/.new-' + genUUID())
    if (java.nio.file.Files.exists(fs.path(destination))) {
      if(!java.nio.file.Files.exists(fs.path(fs.safe(root,'assets/'+item.digest+'.json'))))fail('invalid_state','Asset snapshot index is missing; disable and refresh this extension',409)
      return
    }
    pruneSnapshots()
    var indexes=fs.list(fs.safe(root,'assets')).filter(function(name){return /^[a-f0-9]{64}\.json$/.test(name)})
    var used=indexes.reduce(function(total,name){var index=fs.json(fs.safe(root,'assets/'+name));if(!Number.isSafeInteger(index.bytes) || index.bytes<0)fail('invalid_state','Invalid asset snapshot index');return total+index.bytes},0)
    var added=item.files.reduce(function(total,file){return total+file.size},0)
    if(indexes.length>=64 || used+added>1024*1024*1024)fail('asset_quota','Enabled extension assets exceed the 1 GiB snapshot quota',429)
    fs.mkdir(temporary)
    try {
      item.files.forEach(function(file) {
        var bytes = fs.read(file.source,64*1024*1024)
        if (bytes.length !== file.size || fs.hash(bytes) !== file.sha256) fail('digest_mismatch','Package changed; refresh before enabling')
        var output = fs.safe(temporary,file.path), parent = String(fs.path(output).getParent())
        fs.mkdir(parent); fs.atomic(output,bytes)
      })
      java.nio.file.Files.move(fs.path(temporary),fs.path(destination),java.nio.file.StandardCopyOption.ATOMIC_MOVE)
      fs.writeJSON(fs.safe(root,'assets/'+item.digest+'.json'),{bytes:added})
    } catch(e) {
      // Failed snapshots contain only files created here; leave no activatable digest.
      if(java.nio.file.Files.exists(fs.path(temporary)))removeTree(temporary)
      if(java.nio.file.Files.exists(fs.path(destination)))removeTree(destination)
      fs.remove(fs.safe(root,'assets/'+item.digest+'.json'))
      throw e
    }
  }
  function init(options) {
    close(); registry={}; bindings={}; grants={}; config={}; args=options || {}
    if (toBoolean(args.webextensions) !== true) return
    if (toBoolean(args.webartifacts) === true) fail('invalid_config','Web Extensions cannot run in the restricted generated-artifact profile')
    if (typeof args.webtoken !== 'string' || args.webtoken.length < 32) fail('invalid_config','Web Extensions require a webtoken of at least 32 characters')
    if (args.webextensionsconfig) config=fs.json(String(args.webextensionsconfig),65536)
    fields(config,['directories','roots','mounts','defaults','limits','publicOrigin','conformance'])
    ;['directories','roots'].forEach(function(key){if(config[key]!==undefined && (!Array.isArray(config[key]) || config[key].length>64 || config[key].some(function(p){return typeof p!=='string' || !p.trim() || p.length>4096 || /[\u0000-\u001f]/.test(p)})))fail('invalid_config','Invalid '+key+' configuration')})
    ;['mounts','defaults','conformance'].forEach(function(key){if(config[key]!==undefined && (!config[key] || typeof config[key]!=='object' || Array.isArray(config[key]) || Object.keys(config[key]).length>256))fail('invalid_config','Invalid '+key+' configuration')})
    Object.keys(config.defaults || {}).forEach(function(key){if(!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(key) || typeof config.defaults[key]!=='string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(config.defaults[key]))fail('invalid_config','Invalid default extension')})
    Object.keys(config.mounts || {}).forEach(function(id){var mounts=config.mounts[id];if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id) || !mounts || typeof mounts!=='object' || Array.isArray(mounts) || Object.keys(mounts).length>4 || Object.keys(mounts).some(function(name){return !/^[a-z][a-z0-9-]{0,31}$/.test(name)}))fail('invalid_config','Invalid static asset mounts')})
    Object.keys(config.conformance || {}).forEach(function(id){var proof=config.conformance[id];fields(proof,['digest','gates']);if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id) || typeof proof.digest!=='string' || !/^[a-f0-9]{64}$/.test(proof.digest) || !Array.isArray(proof.gates) || proof.gates.length>16 || proof.gates.some(function(gate){return typeof gate!=='string' || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(gate)}))fail('invalid_config','Invalid conformance approval')})
    if (config.publicOrigin) config.publicOrigin=origin(config.publicOrigin)
    limits={nativeBytes:8388608,exportBytes:16777216,storedBytes:536870912,controlBytes:65536,instances:4}
    if (config.limits) {
      fields(config.limits,['nativeBytes','exportBytes','storedBytes'])
      Object.keys(config.limits).forEach(function(key) { var value=config.limits[key]; if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) fail('invalid_config','Invalid resource limit'); limits[key]=value })
    }
    var home = __miniAPluginBaseHomeDir(args), candidateBase=String(new java.io.File(String(new java.io.File(home).getCanonicalPath()) + '/.openaf-mini-a').getCanonicalPath())
    var publicRoot=String(new java.io.File(__miniAPath('public')).getCanonicalPath())
    if(candidateBase===publicRoot || candidateBase.indexOf(publicRoot+'/')===0)fail('invalid_config','Extension storage must be outside public static content')
    var privateBase = fs.mkdir(candidateBase)
    root=fs.mkdir(fs.safe(privateBase,'web-extensions')); fs.mkdir(fs.safe(root,'assets'))
    processLock=fs.acquire(root)
    var grantsPath=fs.safe(root,'grants.json')
    if (java.nio.file.Files.exists(fs.path(grantsPath))) {
      var saved=fs.json(grantsPath,1024*1024)
      if (saved.version !== 1 || !saved.extensions || typeof saved.extensions !== 'object' || Array.isArray(saved.extensions)) fail('invalid_config','Invalid extension grants')
      grants=saved.extensions
    }
    MiniAWebDocuments.init({enabled:true,root:fs.safe(privateBase,'web-documents'),nativeBytes:limits.nativeBytes,storedBytes:limits.storedBytes})
    refresh(); active=true
  }
  function publicItem(item,prefix) {
    var m=item.manifest, grant=grants[m.id], enabled=!item.reason && !!grant && grant.digest===item.digest
    return {id:m.id,name:m.name,version:m.version,description:m.description || '',manifest:clone(m),digest:item.digest,enabled:enabled,status:item.reason?'unavailable':enabled?'enabled':'disabled',reason:item.reason,permissions:enabled?grant.permissions:[],entryUrl:prefix+'/web-extension-assets/'+item.digest+'/'+m.entry,frameUrl:prefix+'/web-extension-frame/'+item.digest}
  }
  function instanceLimits(item) {
    var result=clone(limits), requested=item.manifest.resources || {}
    if(requested.maxArtifactBytes)result.nativeBytes=Math.min(result.nativeBytes,requested.maxArtifactBytes)
    if(requested.maxExportBytes)result.exportBytes=Math.min(result.exportBytes,requested.maxExportBytes)
    return result
  }
  function catalog(prefix) { return {extensions:Object.keys(registry).sort().map(function(id){return publicItem(registry[id],prefix)}),defaults:clone(config.defaults || {}),limits:clone(limits),epoch:epoch} }
  function binding(value) {
    var b=bindings[value]
    if (!b || b.expires < Date.now()) { delete bindings[value]; fail('binding_expired','Editor binding expired',403) }
    enabledItem(b.extensionId,b.digest); return b
  }
  function registryAction(data,prefix) {
    switch(data.action) {
      case 'refresh': fields(data,['action']); var result=refresh(); return Object.assign(catalog(prefix),result)
      case 'enable':
        fields(data,['action','extensionId','digest','permissions'])
        var item=registry[data.extensionId]
        if (!item || item.reason || item.digest !== data.digest) fail('extension_unavailable','Extension is unavailable or changed',409)
        if (!Array.isArray(data.permissions) || data.permissions.length !== item.manifest.permissions.length || data.permissions.some(function(p,i){return item.manifest.permissions.indexOf(p)<0 || data.permissions.indexOf(p)!==i})) fail('permission_denied','Review and grant all requested permissions',403)
        snapshot(item)
        var previous=grants[data.extensionId]
        grants[data.extensionId]={digest:item.digest,permissions:data.permissions.slice(),enabledAt:Date.now()}
        try {persistGrants()} catch(error) {if(previous)grants[data.extensionId]=previous;else delete grants[data.extensionId];throw error}
        epoch++; return publicItem(item,prefix)
      case 'disable':
        fields(data,['action','extensionId']); delete grants[data.extensionId]; persistGrants(); epoch++
        Object.keys(bindings).forEach(function(key){if(bindings[key].extensionId===data.extensionId)delete bindings[key]}); pruneSnapshots(); return {disabled:true}
      case 'bind':
        fields(data,['action','extensionId','digest','uuid','documentId'])
        if(typeof data.digest!=='string' || !/^[a-f0-9]{64}$/.test(data.digest))fail('invalid_digest','An approved package digest is required')
        var selected=enabledItem(data.extensionId,data.digest), session=MiniAWebDocuments.uuid(data.uuid)
        Object.keys(bindings).forEach(function(key){if(bindings[key].expires<Date.now())delete bindings[key]})
        if(Object.keys(bindings).length>=32)fail('instance_limit','Too many active editor instances',429)
        if(data.documentId) {
          if(grants[data.extensionId].permissions.indexOf('artifact.read')<0)fail('permission_denied','Extension cannot read documents',403)
          var opening=MiniAWebDocuments.read(data.documentId).artifact
          if(opening.native.byteLength>instanceLimits(selected).nativeBytes)fail('size_limit','Document exceeds extension limit',413)
          if(!(selected.manifest.formats || []).some(function(f){return f.mimeTypes.indexOf(opening.native.mimeType)>=0}))fail('unsupported_format','Extension cannot open this document')
        }
        var id=genUUID(), b={binding:id,instanceId:genUUID(),extensionId:data.extensionId,digest:selected.digest,uuid:session,documentId:data.documentId || null,expires:Date.now()+leaseMs}
        bindings[id]=b
        return {binding:id,instanceId:b.instanceId,extension:publicItem(selected,prefix),digest:b.digest,permissions:grants[b.extensionId].permissions.slice(),limits:instanceLimits(selected),documentId:b.documentId,frameUrl:prefix+'/web-extension-frame/'+b.digest,entryUrl:prefix+'/web-extension-assets/'+b.digest+'/'+selected.manifest.entry}
      case 'heartbeat': fields(data,['action','binding']); var live=binding(data.binding); live.expires=Date.now()+leaseMs; return {active:true,epoch:epoch}
      case 'release': fields(data,['action','binding']); delete bindings[data.binding]; return {released:true}
      default: fail('invalid_action','Unknown extension action')
    }
  }
  function documentAction(data) {
    var session=MiniAWebDocuments.uuid(data.uuid)
    switch(data.action) {
      case 'list': fields(data,['action','uuid']); return {documents:MiniAWebDocuments.list(session)}
      case 'read': fields(data,['action','uuid','id']); return MiniAWebDocuments.read(data.id)
      case 'link': fields(data,['action','uuid','id']); return MiniAWebDocuments.link(data.id,session)
      case 'delete': fields(data,['action','uuid','id','expectedRevision']); return MiniAWebDocuments.remove(data.id,data.expectedRevision)
      case 'save':
        fields(data,['action','uuid','binding','id','expectedRevision','title','mimeType','filename','artifactType','content'])
        var b=binding(data.binding), item=enabledItem(b.extensionId,b.digest)
        if (b.uuid!==session || b.documentId!==(data.id || null) || grants[b.extensionId].permissions.indexOf('artifact.propose-write')<0) fail('permission_denied','Editor cannot write this document',403)
        if (!(item.manifest.formats || []).some(function(format){return format.mimeTypes.indexOf(data.mimeType)>=0})) fail('unsupported_format','Editor does not support this document format')
        if(MiniAWebDocuments.decode(data.content).length>instanceLimits(item).nativeBytes)fail('size_limit','Document exceeds extension limit',413)
        var saving=Object.assign({},data,{authorize:function(){return bindings[data.binding]===b && b.expires>=Date.now()}})
        var saved=MiniAWebDocuments.save(saving); b.documentId=saved.id; return saved
      default: fail('invalid_action','Unknown document action')
    }
  }
  function securityHeaders() { return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-DNS-Prefetch-Control':'off'} }
  function reply(value,status,mime,headers) { return ow.server.httpd.reply(value,status || 200,mime,headers || securityHeaders()) }
  function route(request,server) {
    var headers=securityHeaders()
    try {
      if(!active)fail('unavailable','Web Extensions are disabled',503)
      var original=String(request.originalURI || request.uri || '').split('?')[0], match=/^(.*?)(\/web-(?:extension-assets|extension-frame|extensions|documents))(\/.*)?$/.exec(original)
      if(!match)fail('unavailable','Unknown extension route',404)
      var prefix=match[1], endpoint=match[2], remainder=match[3] || '', method=String(request.method || 'GET').toUpperCase()
      if(prefix && !/^(?:\/[A-Za-z0-9_~-][A-Za-z0-9_.~-]*)+$/.test(prefix))fail('invalid_path','Unsupported application prefix')
      if(endpoint==='/web-extension-assets' || endpoint==='/web-extension-frame') {
        if(method!=='GET' && method!=='HEAD')fail('method_not_allowed','Method not allowed',405)
        var pieces=remainder.split('/'), digest=pieces[1], item
        Object.keys(registry).some(function(key){if(registry[key].digest===digest){item=registry[key];return true};return false})
        if(!item)fail('unavailable','Extension assets unavailable',404)
        enabledItem(item.manifest.id,digest)
        var assetRoot=publicOrigin(request)+prefix+'/web-extension-assets/'+digest+'/'
        headers['Permissions-Policy']='camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=(), fullscreen=()'
        if(endpoint==='/web-extension-frame') {
          if(remainder!=='/'+digest)fail('invalid_path','Invalid containment path')
          headers['Content-Security-Policy']="default-src 'none'; script-src " + publicOrigin(request)+prefix+'/web-extension-frame.js '+publicOrigin(request)+prefix+"/web-extension-contract.js; style-src " + publicOrigin(request)+prefix+"/web-extensions.css 'unsafe-inline'; frame-src "+assetRoot+"; object-src 'none'; base-uri 'none'; form-action 'none'"
          return reply(method==='HEAD'?'':fs.utf8(fs.read(__miniAPath('public/web-extension-frame.html'),65536)),200,'text/html; charset=utf-8',headers)
        }
        var rawPath=pieces.slice(2).join('/'), relative
        try { relative=decodeURIComponent(rawPath) } catch(e) { fail('invalid_path','Invalid asset path') }
        if(/%|[?#]/.test(relative) || relative.split('/').some(function(p){return p.charAt(0)==='.'}))fail('invalid_path','Invalid asset path')
        var entry=item.files.filter(function(file){return file.path===relative})[0]
        if(!entry)fail('unavailable','Asset unavailable',404)
        var bytes=fs.read(fs.safe(snapshotPath(digest),relative),64*1024*1024)
        if(bytes.length!==entry.size || fs.hash(bytes)!==entry.sha256)fail('digest_mismatch','Asset integrity check failed',409)
        var ext=relative.split('.').pop().toLowerCase(), mime=mimeTypes[ext] || 'application/octet-stream'
        headers['Access-Control-Allow-Origin']='*'; headers['Cross-Origin-Resource-Policy']='cross-origin'; headers['Cache-Control']='public, max-age=31536000, immutable'
        // Supporting browsers also restrict non-Fetch channels (including RTC).
        // CSP remains required: Connection-Allowlist is not yet universal.
        headers['Connection-Allowlist']='("'+assetRoot+'*")'
        // Apply document policy even to SVG/XML direct navigations. Applying it only
        // to HTML would let a plugin's active SVG execute in Mini-A's own origin.
        var frames=(item.manifest.childFrames || []).map(function(p){return assetRoot+p}).join(' ')
        headers['Content-Security-Policy']="sandbox allow-scripts; default-src 'none'; script-src "+assetRoot+"; style-src "+assetRoot+" 'unsafe-inline'; img-src "+assetRoot+" data: blob:; font-src "+assetRoot+"; connect-src "+assetRoot+"; frame-src "+(frames || "'none'")+"; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; webrtc 'block'"
        return reply(method==='HEAD'?'':bytes,200,mime,headers)
      }
      auth(request)
      lock.lock()
      try {
        if(endpoint==='/web-extensions' && !remainder && method==='GET')return reply(catalog(prefix))
        if(method!=='POST' || remainder)fail('method_not_allowed','Method not allowed',405)
        var data=body(request,endpoint==='/web-documents'?12*1024*1024:65536)
        if(endpoint==='/web-documents' && data.action==='download') {
          fields(data,['action','uuid','id']); MiniAWebDocuments.uuid(data.uuid)
          var doc=MiniAWebDocuments.read(data.id), bytes=java.util.Base64.getDecoder().decode(doc.content.data)
          headers['Content-Disposition']='attachment; filename="'+doc.artifact.native.filename.replace(/[^A-Za-z0-9_. -]/g,'_')+'"'
          return reply(bytes,200,'application/octet-stream',headers)
        }
        return reply(endpoint==='/web-extensions'?registryAction(data,prefix):documentAction(data))
      } finally {lock.unlock()}
    } catch(e) {return reply({error:e.code ? String(e.message) : 'Extension operation failed',code:e.code || 'internal_error'},e.status || 500,undefined,headers)}
  }
  function disposeSession(uuid,unlink) {
    if(!active)return
    uuid=MiniAWebDocuments.uuid(uuid)
    lock.lock()
    try {Object.keys(bindings).forEach(function(key){if(bindings[key].uuid===uuid)delete bindings[key]});if(unlink===true)MiniAWebDocuments.unlinkSession(uuid)} finally {lock.unlock()}
  }
  function close() {active=false;bindings={};MiniAWebDocuments.close();if(processLock){processLock.close();processLock=null}}
  function info() {return {enabled:active,apiVersion:'1.0',agentEnabled:active && toBoolean(args.webextensionsagent)===true,limits:clone(limits)}}
  return {init:init,close:close,enabled:function(){return active},info:info,route:route,disposeSession:disposeSession,refresh:refresh,inventoryDigest:function(dir){var files=[];inventory(dir,'',files);return digestInventory(files)}}
})()
