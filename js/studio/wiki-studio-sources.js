// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
loadLib(__miniAPath("js/studio/wiki-studio-outbound.js"))
WikiStudioServer.prototype.streamUpload = function(req, input) {
  WikiStudio.authorize(req.role, "admin")
  var c = this.config, id = req.headers["x-upload-id"], relative
  WikiStudio.assert(isString(id) && /^[a-f0-9-]{36}$/.test(id), 400, "invalid_upload", "Supply a UUID in X-Upload-ID")
  try { relative = decodeURIComponent(req.headers["x-upload-path"] || "") } catch(e) { WikiStudio.fail(400, "invalid_upload", "Invalid upload path") }
  WikiStudio.pagePath(relative, false)
  WikiStudio.assert(/\.(md|txt|pdf|zip)$/i.test(relative), 415, "unsupported_file", "Upload Markdown, text, PDF or a ZIP archive")
  var dir = c.home + "/sources/uploads/" + id, self = this
  return WikiStudio.lock(c.home, "upload-" + id, function() {
    WikiStudio.assert(!io.fileExists(dir + "/sealed.json"), 409, "upload_sealed", "This upload revision is immutable")
    WikiStudio.privateDir(dir + "/files")
    var file = WikiStudio.safeFile(dir + "/files", relative, false)
    WikiStudio.assert(!io.fileExists(file), 409, "duplicate_upload", "Duplicate file path")
    var existing = WikiStudio.scan(dir + "/files", true), total = Object.keys(existing).reduce(function(n,k) { return n + existing[k].size }, 0)
    WikiStudio.assert(!Object.keys(existing).some(function(p){return p.toLowerCase()===relative.toLowerCase()}),409,"duplicate_upload","Duplicate case-insensitive file path")
    WikiStudio.assert(Object.keys(existing).length < 2000, 413, "upload_count", "Upload file limit exceeded")
    var temp = dir + "/incoming-" + WikiStudio.id(), out = new java.io.FileOutputStream(temp), size = 0, n, buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
    try {
      while ((n = input.read(buf)) !== -1) {
        size += n; WikiStudio.assert(size <= (/\.zip$/i.test(relative)?20971520:8388608) && total + size <= 67108864, 413, "upload_limit", "Upload byte limit exceeded")
        out.write(buf, 0, n)
      }
      out.getFD().sync(); out.close(); out = null
      WikiStudio.privateDir(String(new java.io.File(file).getParent()))
      java.nio.file.Files.move(WikiStudio.path(temp), WikiStudio.path(file), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
      return { uploadId: id, path: relative, bytes: size, checksum: WikiStudio.hash(java.nio.file.Files.readAllBytes(WikiStudio.path(file))) }
    } finally { input.close(); if (out) out.close(); new java.io.File(temp).delete() }
  })
}
// ZIP metadata is checked before any member is written. JDK ZipEntry does not
// expose Unix mode/encryption flags, so inspect the central directory as well.
WikiStudio.validateZip = function(file) {
  WikiStudio.noLinks(file)
  var raf = new java.io.RandomAccessFile(file, "r"), size = Number(raf.length()), eocd = -1
  function u16() { return raf.readUnsignedByte() | raf.readUnsignedByte() << 8 }
  function u32() { return (u16() + u16() * 65536) >>> 0 }
  try {
    WikiStudio.assert(size <= 20971520 && size >= 22, 413, "zip_limit", "ZIP byte limit exceeded")
    for (var p = size - 22; p >= Math.max(0, size - 65557); p--) { raf.seek(p); if (u32() === 0x06054b50) { raf.seek(p + 20); if (p + 22 + u16() === size) { eocd = p; break } } }
    WikiStudio.assert(eocd >= 0, 400, "invalid_zip", "ZIP central directory missing")
    raf.seek(eocd + 4); var disk = u16(), cdDisk = u16(), countDisk = u16(), count = u16(), cdSize = u32(), start = u32()
    WikiStudio.assert(disk === 0 && cdDisk === 0 && countDisk === count && count <= 2000 && count > 0 && start + cdSize === eocd, 400, "invalid_zip", "Multipart, ZIP64 or oversized archives are unsupported")
    raf.seek(start)
    for (var i = 0; i < count; i++) {
      WikiStudio.assert(u32() === 0x02014b50, 400, "invalid_zip", "Invalid central directory")
      var made = u16(); u16(); var flags = u16(), method = u16(); raf.skipBytes(4); u32(); var compressed = u32(), expanded = u32(), nameLen = u16(), extra = u16(), comment = u16(), diskStart = u16(); u16(); var attrs = u32(); u32()
      var mode = (attrs >>> 16) & 0xf000
      WikiStudio.assert(!(flags & 1) && !(flags & 64) && diskStart === 0 && [0,8].indexOf(method) >= 0 && [0,0x8000,0x4000].indexOf(mode) >= 0 && expanded <= 8388608 && expanded <= Math.max(1, compressed) * 100, 400, "unsafe_zip", "Encrypted, special, symlink or high-ratio ZIP entries are forbidden")
      raf.skipBytes(nameLen + extra + comment)
    }
    WikiStudio.assert(Number(raf.getFilePointer()) === start + cdSize, 400, "invalid_zip", "Invalid central directory bounds")
  } finally { raf.close() }
  var zip = new java.util.zip.ZipFile(file), names = {}, total = 0, entries = [], en = zip.entries()
  try {
    while (en.hasMoreElements()) {
      var entry = en.nextElement(), name = String(entry.getName()).replace(/\/$/, "")
      WikiStudio.pagePath(name, false)
      WikiStudio.assert(name.split("/").length <= 16 && !names[name.toLowerCase()], 400, "unsafe_zip", "Duplicate or deep ZIP path")
      names[name.toLowerCase()] = true
      WikiStudio.assert(entry.isDirectory() || /\.(md|txt|pdf)$/i.test(name), 415, "unsupported_zip_file", "ZIP may contain only Markdown, text and PDF sources")
      total += Number(entry.getSize())
      WikiStudio.assert(total <= 67108864 && entry.getSize() >= 0 && entry.getSize() <= 8388608, 413, "zip_limit", "Uncompressed ZIP limit exceeded")
      entries.push(name)
    }
  } finally { zip.close() }
  return entries
}
WikiStudio.extractZip = function(file, destination) {
  WikiStudio.validateZip(file)
  var zip = new java.util.zip.ZipFile(file), en = zip.entries(), total = 0
  WikiStudio.privateDir(destination)
  try {
    while (en.hasMoreElements()) {
      var entry = en.nextElement(), name = String(entry.getName()).replace(/\/$/, ""), path = WikiStudio.safeFile(destination, name, false)
      if (entry.isDirectory()) { WikiStudio.privateDir(path); continue }
      WikiStudio.privateDir(String(new java.io.File(path).getParent()))
      WikiStudio.assert(!io.fileExists(path), 400, "unsafe_zip", "ZIP member collision")
      var input = zip.getInputStream(entry), output = new java.io.FileOutputStream(path), digest = new java.util.zip.CRC32(), n, bytes = 0, buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
      try {
        while ((n = input.read(buffer)) !== -1) { bytes += n; total += n; WikiStudio.assert(bytes <= 8388608 && total <= 67108864, 413, "zip_limit", "ZIP extraction limit exceeded"); digest.update(buffer,0,n); output.write(buffer,0,n) }
        WikiStudio.assert(bytes === entry.getSize() && Number(digest.getValue()) === Number(entry.getCrc()), 400, "corrupt_zip", "ZIP member checksum mismatch")
        output.getFD().sync()
      } finally { output.close(); input.close() }
    }
  } finally { zip.close() }
}
WikiStudioServer.prototype.sourcePath = function(w, id) { return this.config.home + "/sources/" + w.id + "--" + WikiStudio.name(id) + ".json" }
WikiStudioServer.prototype.sourceList = function(w) {
  var self = this
  return io.listFiles(this.config.home + "/sources").files.filter(function(f) { return f.isFile && f.filename.indexOf(w.id + "--") === 0 && /\.json$/.test(f.filename) }).map(function(f) { return WikiStudio.json(f.filepath) }).sort(function(a,b) { return a.id.localeCompare(b.id) })
}
WikiStudioServer.prototype.sourceAdd = function(w, body) {
  WikiStudio.fields(body, ["id", "name", "type", "uploadId", "directoryId", "url", "video", "lang"]); WikiStudio.name(body.id)
  var sourceType=body.type, origin
  if(body.type==="web"||body.type==="youtube") {
    WikiStudio.assert(isString(body.name)&&body.name.length<=120,400,"invalid_source","Provide a source display name")
    var fetched=body.type==="web"?(WikiStudio.assert(isString(body.url)&&body.url.length<=2048,400,"invalid_url","Provide a URL"),WikiStudioOutbound.webpage(body.url)):(WikiStudio.assert(isString(body.video),400,"invalid_video","Provide a YouTube URL or video ID"),WikiStudioOutbound.youtube(body.video,body.lang))
    var webUpload=WikiStudio.id(),webStage=this.config.home+"/sources/uploads/"+webUpload+"/files"
    WikiStudio.privateDir(webStage)
    try{var webDest=WikiStudio.safeFile(webStage,fetched.name,true);java.nio.file.Files.write(WikiStudio.path(webDest),new java.lang.String(fetched.markdown).getBytes("UTF-8"))}catch(e){io.rm(String(new java.io.File(webStage).getParent()));throw e}
    origin=fetched.origin
    body={id:body.id,name:body.name,type:"upload",uploadId:webUpload}
  }
  if(body.type==="directory"||body.type==="git") {
    var selected=(this.config.directories||[]).filter(function(d){return d.id===body.directoryId})[0]
    WikiStudio.assert(selected,403,"source_not_allowed","Select an operator-allowlisted source directory ID")
    WikiStudio.assert(!WikiStudio.inside(selected.path,w.root)&&!WikiStudio.inside(w.root,selected.path),400,"source_overlap","Source and wiki cannot contain each other")
    WikiStudio.assert(!this.registry.list().some(function(registered){return WikiStudio.inside(selected.path,registered.root)||WikiStudio.inside(registered.root,selected.path)}),400,"use_absorption","Use the saved-plan Absorb workflow for registered wikis")
    WikiStudio.assert(WikiStudio.identity(selected.path)===selected.identity,409,"source_changed","Source directory identity changed; restart after review")
    var uploadId=WikiStudio.id(),stage=this.config.home+"/sources/uploads/"+uploadId+"/files"
    WikiStudio.privateDir(stage)
    var count=0,total=0
    var copy=function(dir,depth){WikiStudio.assert(depth<16,413,"source_limit","Source depth exceeded");var entries=io.listFiles(dir).files;entries.forEach(function(f){if(String(f.filename).charAt(0)==="."||/^AGENTS\.md$/i.test(f.filename))return;WikiStudio.noLinks(f.filepath);if(f.isDirectory){copy(f.filepath,depth+1);return}if(!/\.(md|txt|pdf)$/i.test(f.filename))return;count++;var bytes=Number(new java.io.File(f.filepath).length());total+=bytes;WikiStudio.assert(count<=2000&&total<=67108864&&bytes<=8388608,413,"source_limit","Source byte/count limit exceeded");var rel=String(f.filepath).substring(selected.path.length+1),dest=WikiStudio.safeFile(stage,rel,false);WikiStudio.privateDir(String(new java.io.File(dest).getParent()));java.nio.file.Files.copy(WikiStudio.path(f.filepath),WikiStudio.path(dest))})}
    try{copy(selected.path,0)}catch(e){io.rm(String(new java.io.File(stage).getParent()));throw e}
    body={id:body.id,name:body.name,type:"upload",uploadId:uploadId}
  }
  WikiStudio.assert(body.type === "upload", 501, "adapter_unavailable", "Remote Git clones are disabled; webpage and YouTube adapters require type web/youtube. Upload a reviewed checkout instead.")
  WikiStudio.assert(isString(body.name) && body.name.length <= 120 && /^[a-f0-9-]{36}$/.test(String(body.uploadId)), 400, "invalid_source", "Provide a source name and upload revision UUID")
  var dir = this.config.home + "/sources/uploads/" + body.uploadId, self = this
  return WikiStudio.lock(this.config.home, "upload-" + body.uploadId, function() {
    var existing = WikiStudio.json(self.sourcePath(w, body.id), null)
    WikiStudio.assert(!io.fileExists(dir + "/sealed.json"), 409, "upload_sealed", "Upload is already sealed")
    WikiStudio.assert(io.fileExists(dir + "/files"), 404, "upload_not_found", "Upload not found")
    var inventory = WikiStudio.scan(dir + "/files", true), zips = Object.keys(inventory).filter(function(p) { return /\.zip$/i.test(p) }), staging = dir + "/files"
    if (zips.length) {
      WikiStudio.assert(zips.length === 1 && Object.keys(inventory).length === 1, 400, "mixed_zip", "Submit a single ZIP separately from directory uploads")
      staging = dir + "/expanded"
      WikiStudio.assert(!io.fileExists(staging), 409, "staging_exists", "Failed extraction remains; use a new upload UUID")
      try { WikiStudio.extractZip(dir + "/files/" + zips[0], staging) } catch(e) { if (io.fileExists(staging)) io.rm(staging); throw e }
      inventory = WikiStudio.scan(staging, true)
    }
    var source = { id: body.id, wikiId: w.id, name: body.name, type: sourceType, origin: origin, revision: body.uploadId, inventoryChecksum: WikiStudio.fingerprint(inventory), staging: staging, createdAt: WikiStudio.now(), lineage: existing ? (existing.lineage || []).concat([existing.revision]).slice(-100) : [], files: inventory, status: "staged" }
    WikiStudio.atomic(dir + "/sealed.json", { wikiId: w.id, sourceId: source.id, checksum: source.inventoryChecksum })
    WikiStudio.atomic(self.sourcePath(w, source.id), source)
    return WikiStudioServer.publicSource(source)
  })
}
WikiStudioServer.publicSource = function(s) { var out = JSON.parse(JSON.stringify(s)); delete out.staging; return out }
