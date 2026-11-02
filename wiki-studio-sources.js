loadLib("wiki-studio-common.js")
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
    WikiStudio.assert(Object.keys(existing).length < 2000, 413, "upload_count", "Upload file limit exceeded")
    var temp = dir + "/incoming-" + WikiStudio.id(), out = new java.io.FileOutputStream(temp), size = 0, n, buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
    try {
      while ((n = input.read(buf)) !== -1) {
        size += n; WikiStudio.assert(size <= 20971520 && total + size <= 67108864, 413, "upload_limit", "Upload byte limit exceeded")
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
  WikiStudio.fields(body, ["id", "name", "type", "uploadId"]); WikiStudio.name(body.id)
  WikiStudio.assert(body.type === "upload", 501, "adapter_unavailable", "Remote Git, webpage and YouTube adapters are disabled: a DNS-pinned, bounded outbound transport is not implemented. Upload a reviewed export/checkout instead. Local directory intake is also unavailable; upload a directory snapshot.")
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
    var source = { id: body.id, wikiId: w.id, name: body.name, type: "upload", revision: body.uploadId, inventoryChecksum: WikiStudio.fingerprint(inventory), staging: staging, createdAt: WikiStudio.now(), lineage: existing ? (existing.lineage || []).concat([existing.revision]).slice(-100) : [], files: inventory, status: "staged" }
    WikiStudio.atomic(dir + "/sealed.json", { wikiId: w.id, sourceId: source.id, checksum: source.inventoryChecksum })
    WikiStudio.atomic(self.sourcePath(w, source.id), source)
    return WikiStudioServer.publicSource(source)
  })
}
WikiStudioServer.publicSource = function(s) { var out = JSON.parse(JSON.stringify(s)); delete out.staging; return out }
