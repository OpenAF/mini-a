// Private, explicit-save document storage for Web Extensions. Apache-2.0.
// Internal callers supply their own scoped authorization; no guest receives this API.
var MiniAWebDocumentIO = (function() {
  var Files = java.nio.file.Files, Paths = java.nio.file.Paths
  function fail(code, message, status) {
    var error = new Error(message); error.code = code; error.status = status || 400; throw error
  }
  function path(value) { return Paths.get(String(value)) }
  function safe(root, member) {
    if (typeof member !== 'string' || !member || /[\\\u0000-\u001f]/.test(member) || member.charAt(0) === '/' || member.split('/').some(function(p) { return p === '.' || p === '..' || !p })) fail('invalid_path', 'Invalid relative path')
    var base = path(root).toAbsolutePath().normalize(), result = base.resolve(member).normalize()
    if (!result.startsWith(base) || Files.isSymbolicLink(base)) fail('invalid_path', 'Unsafe path')
    var current = base, parts = member.split('/')
    parts.forEach(function(part) { current = current.resolve(part); if (Files.isSymbolicLink(current)) fail('invalid_path', 'Symbolic links are not supported') })
    return String(result)
  }
  function mkdir(value) {
    var p = path(value)
    if (Files.isSymbolicLink(p)) fail('invalid_path', 'Storage cannot be a symbolic link')
    Files.createDirectories(p)
    if (!Files.isDirectory(p)) fail('invalid_path', 'Storage is not a directory')
    if (Files.getFileAttributeView(p, java.nio.file.attribute.PosixFileAttributeView) !== null) Files.setPosixFilePermissions(p, java.nio.file.attribute.PosixFilePermissions.fromString('rwx------'))
    return String(p.toRealPath())
  }
  function read(value, limit) {
    var p = path(value)
    if (Files.isSymbolicLink(p) || !Files.isRegularFile(p) || Files.size(p) > limit) fail('unavailable', 'File unavailable or oversized', 404)
    var options = new java.util.HashSet()
    options.add(java.nio.file.StandardOpenOption.READ); options.add(java.nio.file.LinkOption.NOFOLLOW_LINKS)
    var channel = Files.newByteChannel(p, options), out = new java.io.ByteArrayOutputStream(), buffer = java.nio.ByteBuffer.allocate(8192)
    try {
      var count
      while ((count = channel.read(buffer)) !== -1) {
        if (out.size() + count > limit) fail('size_limit', 'File exceeds size limit', 413)
        out.write(buffer.array(), 0, count); buffer.clear()
      }
      return out.toByteArray()
    } finally { channel.close() }
  }
  function bytes(text) { return new java.lang.String(String(text)).getBytes('UTF-8') }
  function utf8(data) {
    var decoder = java.nio.charset.StandardCharsets.UTF_8.newDecoder()
    decoder.onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
    decoder.onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
    try { return String(decoder.decode(java.nio.ByteBuffer.wrap(data))) } catch(e) { fail('invalid_encoding', 'Invalid UTF-8') }
  }
  function hash(data) {
    var digest = java.security.MessageDigest.getInstance('SHA-256').digest(data)
    return String(new java.math.BigInteger(1, digest).toString(16)).padStart(64, '0')
  }
  function atomic(value, data) {
    var p = path(value), temporary = path(value + '.tmp-' + genUUID())
    if (Files.isSymbolicLink(p) || Files.isSymbolicLink(p.getParent())) fail('invalid_path', 'Unsafe storage path')
    try {
      Files.write(temporary, data, java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE)
      if (Files.getFileAttributeView(temporary, java.nio.file.attribute.PosixFileAttributeView) !== null) Files.setPosixFilePermissions(temporary, java.nio.file.attribute.PosixFilePermissions.fromString('rw-------'))
      var channel = java.nio.channels.FileChannel.open(temporary, java.nio.file.StandardOpenOption.WRITE)
      try { channel.force(true) } finally { channel.close() }
      Files.move(temporary, p, java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    } finally { Files.deleteIfExists(temporary) }
  }
  function parseJSON(text) {
    // Reject parser-recursion attacks before Rhino allocates the nested tree.
    var depth=0, quoted=false, escaped=false
    for(var n=0;n<text.length;n++) {
      var ch=text.charAt(n)
      if(quoted) {
        if(escaped)escaped=false
        else if(ch==='\\')escaped=true
        else if(ch==='"')quoted=false
      } else if(ch==='"')quoted=true
      else if(ch==='{' || ch==='[') {if(++depth>25)fail('invalid_request','JSON nesting limit')}
      else if(ch==='}' || ch===']')depth--
    }
    try{return JSON.parse(text)}catch(error){fail('invalid_json','Invalid JSON')}
  }
  function json(value, max) { return parseJSON(utf8(read(value, max || 65536))) }
  function writeJSON(value, data) { atomic(value, bytes(JSON.stringify(data))) }
  function list(value) {
    var stream = Files.newDirectoryStream(path(value)), result = []
    try { var it = stream.iterator(); while (it.hasNext()) result.push(String(it.next().getFileName())) } finally { stream.close() }
    return result.sort()
  }
  function remove(value) { if (Files.isSymbolicLink(path(value))) fail('invalid_path', 'Unsafe removal'); Files.deleteIfExists(path(value)) }
  function acquire(root) {
    var options = new java.util.HashSet()
    options.add(java.nio.file.StandardOpenOption.CREATE); options.add(java.nio.file.StandardOpenOption.WRITE); options.add(java.nio.file.LinkOption.NOFOLLOW_LINKS)
    var channel = java.nio.channels.FileChannel.open(path(safe(root,'.lock')),options), held
    try { held=channel.tryLock(); if(held===null) fail('storage_busy','Another process owns this workspace',409) }
    catch(e) {channel.close();fail('storage_busy','Another process owns this workspace',409)}
    return {close:function(){try{held.release()}finally{channel.close()}}}
  }
  return {fail:fail,path:path,safe:safe,mkdir:mkdir,read:read,bytes:bytes,utf8:utf8,hash:hash,atomic:atomic,parseJSON:parseJSON,json:json,writeJSON:writeJSON,list:list,remove:remove,acquire:acquire}
})()

var MiniAWebDocuments = (function() {
  var fs = MiniAWebDocumentIO, root, active = false, nativeBytes = 8 * 1024 * 1024, storedBytes = 512 * 1024 * 1024
  var lock = new java.util.concurrent.locks.ReentrantLock()
  var processLock
  function close() { active=false; if(processLock) {processLock.close();processLock=null} }
  function uuid(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) fs.fail('invalid_id', 'Invalid document or session identifier')
    return value.toLowerCase()
  }
  function guard() { if (!active) fs.fail('unavailable', 'Documents are disabled', 503) }
  function directory(id) { return fs.safe(root, uuid(id)) }
  function record(id) {
    var item = fs.json(fs.safe(directory(id), 'metadata.json'))
    if (item.id !== uuid(id) || !Number.isSafeInteger(item.revision) || item.revision < 1 || !item.native || !Number.isSafeInteger(item.native.byteLength) || item.native.byteLength < 0 || item.native.byteLength > nativeBytes || !/^[a-f0-9]{64}$/.test(item.native.sha256) || !Array.isArray(item.sessions) || item.sessions.length>1024 || item.sessions.some(function(s){return typeof s!=='string' || !/^[a-f0-9-]{36}$/.test(s)})) fs.fail('unavailable', 'Document metadata is invalid', 404)
    return item
  }
  function publicItem(item) {
    return {id:item.id,artifactType:item.artifactType,title:item.title,revision:item.revision,persistence:'saved',native:item.native,metadata:{},created:item.created,updated:item.updated}
  }
  function records() {
    return fs.list(root).filter(function(name) { return /^[a-f0-9-]{36}$/.test(name) }).map(function(name) { return record(name) })
  }
  function init(options) {
    close()
    if (!options || options.enabled !== true) return
    nativeBytes = options.nativeBytes === undefined ? 8 * 1024 * 1024 : options.nativeBytes
    storedBytes = options.storedBytes === undefined ? 512 * 1024 * 1024 : options.storedBytes
    if (!Number.isSafeInteger(nativeBytes) || nativeBytes < 1 || nativeBytes > 8 * 1024 * 1024 || !Number.isSafeInteger(storedBytes) || storedBytes < 1 || storedBytes > 512 * 1024 * 1024) fs.fail('invalid_config', 'Invalid document limits')
    root = fs.mkdir(options.root)
    processLock = fs.acquire(root)
    // Recover interrupted commits. The metadata pointer is the commit boundary.
    fs.list(root).forEach(function(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return
      var dir = directory(id), item
      if (java.nio.file.Files.isSymbolicLink(fs.path(dir))) fs.fail('invalid_path', 'Unsafe document directory')
      try { item = record(id) } catch(e) {
        if (java.nio.file.Files.exists(fs.path(fs.safe(dir, 'metadata.json')))) throw e
      }
      fs.list(dir).forEach(function(name) {
        if (/\.tmp-[a-f0-9-]+$/.test(name) || (/^native-[0-9]+\.bin$/.test(name) && (!item || name !== 'native-' + item.revision + '.bin'))) fs.remove(fs.safe(dir, name))
      })
      if (!item && fs.list(dir).length === 0) fs.remove(dir)
    })
    active = true
  }
  function list(session) {
    guard(); if (session) uuid(session)
    lock.lock()
    try { return records().map(publicItem).sort(function(a,b) { return b.updated - a.updated || a.id.localeCompare(b.id) }) } finally { lock.unlock() }
  }
  function linked(session) {
    guard(); session = uuid(session); lock.lock()
    try { return records().filter(function(item) { return item.sessions.indexOf(session) >= 0 }).map(publicItem) } finally { lock.unlock() }
  }
  function read(id) {
    guard(); lock.lock()
    try {
      var item = record(id), bytes = fs.read(fs.safe(directory(id), 'native-' + item.revision + '.bin'), nativeBytes)
      if (bytes.length !== item.native.byteLength || fs.hash(bytes) !== item.native.sha256) fs.fail('unavailable', 'Document integrity check failed', 404)
      return {artifact:publicItem(item),content:{encoding:'base64',data:String(java.util.Base64.getEncoder().encodeToString(bytes))}}
    } finally { lock.unlock() }
  }
  function decode(content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) fs.fail('invalid_content', 'Content is required')
    var data
    if (content.encoding === 'utf8' && typeof content.text === 'string' && Object.keys(content).sort().join(',') === 'encoding,text') {
      if (content.text.length > nativeBytes) fs.fail('size_limit', 'Document exceeds size limit', 413)
      data = fs.bytes(content.text)
    } else if (content.encoding === 'base64' && typeof content.data === 'string' && Object.keys(content).sort().join(',') === 'data,encoding') {
      if (content.data.length > Math.ceil(nativeBytes / 3) * 4 || content.data.length % 4 !== 0) fs.fail('invalid_content', 'Invalid or oversized content')
      // Avoid a repeated regexp over megabytes: Rhino retains backtracking state.
      var end = content.data.length
      if (end && content.data.charAt(end - 1) === '=') end--
      if (end && content.data.charAt(end - 1) === '=') end--
      for (var n = 0; n < end; n++) {
        var ch = content.data.charCodeAt(n)
        if (!((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch === 43 || ch === 47)) fs.fail('invalid_content', 'Invalid base64')
      }
      try { data = java.util.Base64.getDecoder().decode(content.data) } catch(e) { fs.fail('invalid_content', 'Invalid base64') }
    } else fs.fail('invalid_content', 'Unsupported content encoding')
    if (data.length > nativeBytes) fs.fail('size_limit', 'Document exceeds size limit', 413)
    return data
  }
  function save(input) {
    guard()
    if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fs.fail('invalid_revision', 'expectedRevision is required')
    if(input.authorize!==undefined && typeof input.authorize!=='function')fs.fail('invalid_request','Invalid internal authorization callback')
    function authorize(){if(input.authorize && input.authorize()!==true)fs.fail('permission_denied','Document write grant expired',403)}
    authorize()
    var title = input.title, mime = input.mimeType, filename = input.filename
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || /[\u0000-\u001f]/.test(title)) fs.fail('invalid_title', 'Invalid document title')
    if (typeof filename !== 'string' || !filename || filename.length > 200 || /[\\/\u0000-\u001f";]/.test(filename) || filename === '.' || filename === '..') fs.fail('invalid_filename', 'Invalid document filename')
    if (typeof mime !== 'string' || mime.length > 128 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) fs.fail('invalid_mime', 'Invalid document MIME type')
    if (input.artifactType !== undefined && (typeof input.artifactType !== 'string' || input.artifactType.length > 128 || !/^[a-z0-9][a-z0-9._/-]*$/.test(input.artifactType))) fs.fail('invalid_type', 'Invalid artifact type')
    var data = decode(input.content), session = input.uuid ? uuid(input.uuid) : null
    if (/^(text\/|application\/(json|[^;]*xml))/.test(mime)) fs.utf8(data)
    if (mime === 'application/vnd.jgraph.mxfile') {
      if (typeof MiniADocumentTools === 'undefined') loadLib(__miniAPath('js/artifacts/mini-a-document-tools.js'))
      MiniADocumentTools.drawio.validate(fs.utf8(data))
    }
    var committed=false, dir, revision, existing
    lock.lock()
    try {
      authorize()
      existing = input.id ? record(input.id) : null
      var id = existing ? existing.id : genUUID()
      if ((existing ? existing.revision : 0) !== input.expectedRevision) fs.fail('revision_conflict', 'Document changed; reload or save a copy', 409)
      var items = records(), used = items.reduce(function(total,item) { return total + item.native.byteLength }, 0)
      if ((!existing && items.length >= 10000) || used - (existing ? existing.native.byteLength : 0) + data.length > storedBytes) fs.fail('quota_exceeded', 'Document storage quota exceeded', 429)
      revision = input.expectedRevision + 1
      var now = Date.now()
      dir = existing ? directory(id) : fs.mkdir(directory(id))
      var item = {id:id,artifactType:input.artifactType || (existing && existing.artifactType) || 'document',title:title.trim(),revision:revision,created:existing ? existing.created : now,updated:now,sessions:existing ? existing.sessions : [],native:{representationId:'native',mimeType:mime,filename:filename,byteLength:data.length,sha256:fs.hash(data)}}
      if (session && item.sessions.indexOf(session) < 0) {if(item.sessions.length>=1024)fs.fail('quota_exceeded','Document conversation link limit',429);item.sessions.push(session)}
      fs.atomic(fs.safe(dir, 'native-' + revision + '.bin'), data)
      authorize()
      fs.writeJSON(fs.safe(dir, 'metadata.json'), item)
      committed=true
      // A cleanup failure after commit must not report that the save failed.
      if (existing) {try {fs.remove(fs.safe(dir, 'native-' + existing.revision + '.bin'))} catch(ignoreCleanup) {}}
      return publicItem(item)
    } catch(error) {
      if(!committed && dir && revision) {
        try {
          fs.remove(fs.safe(dir,'native-'+revision+'.bin'))
          if(!existing && fs.list(dir).length===0)fs.remove(dir)
        } catch(ignoreRollback) {}
      }
      throw error
    } finally { lock.unlock() }
  }
  function link(id, session) {
    guard(); session = uuid(session); lock.lock()
    try { var item = record(id); if (item.sessions.indexOf(session) < 0) { if(item.sessions.length>=1024)fs.fail('quota_exceeded','Document conversation link limit',429);item.sessions.push(session); fs.writeJSON(fs.safe(directory(id), 'metadata.json'), item) }; return publicItem(item) } finally { lock.unlock() }
  }
  function unlinkSession(session) {
    if (!active) return
    session = uuid(session); lock.lock()
    try { records().forEach(function(item) { if (item.sessions.indexOf(session) >= 0) { item.sessions = item.sessions.filter(function(s) { return s !== session }); fs.writeJSON(fs.safe(directory(item.id), 'metadata.json'), item) } }) } finally { lock.unlock() }
  }
  function remove(id, expectedRevision) {
    guard(); lock.lock()
    try {
      var item = record(id)
      if (expectedRevision !== undefined && expectedRevision !== item.revision) fs.fail('revision_conflict', 'Document changed', 409)
      var dir = directory(id)
      var names=fs.list(dir)
      if(names.some(function(name){return name!=='metadata.json' && !/^native-[0-9]+\.bin$/.test(name) && !/\.tmp-[a-f0-9-]+$/.test(name)}))fs.fail('unavailable','Unexpected document file',409)
      names.forEach(function(name){fs.remove(fs.safe(dir,name))})
      fs.remove(dir); return {deleted:true,id:id}
    } finally { lock.unlock() }
  }
  return {init:init,close:close,list:list,linked:linked,read:read,save:save,link:link,remove:remove,unlinkSession:unlinkSession,uuid:uuid,decode:decode,enabled:function(){return active}}
})()
