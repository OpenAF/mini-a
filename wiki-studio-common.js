// Mini-A Wiki Studio shared persistence and boundary helpers. No model required.
var WikiStudio = typeof WikiStudio === "undefined" ? {} : WikiStudio
WikiStudio.version = 1
WikiStudio.fail = function(status, code, message, details) {
  var e = new Error(message); e.status = status; e.code = code; e.details = details; throw e
}
WikiStudio.assert = function(value, status, code, message) { if (!value) WikiStudio.fail(status, code, message) }
WikiStudio.now = function() { return new Date().toISOString() }
WikiStudio.id = function() { return String(java.util.UUID.randomUUID()) }
WikiStudio.path = function(path) { return new java.io.File(String(path)).toPath() }
WikiStudio.canonical = function(path) { return String(new java.io.File(String(path)).getCanonicalPath()) }
WikiStudio.inside = function(path, root) { return path === root || path.indexOf(root + "/") === 0 }
WikiStudio.hash = function(bytes) { return String(sha256(bytes)) }
WikiStudio.bytes = function(text) { return new java.lang.String(String(text)).getBytes("UTF-8") }
WikiStudio.privateDir = function(path) {
  var f = new java.io.File(String(path))
  if (!f.exists()) java.nio.file.Files.createDirectories(f.toPath())
  WikiStudio.noLinks(String(f))
  java.nio.file.Files.setPosixFilePermissions(f.toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"))
  return String(f)
}
WikiStudio.noLinks = function(path) {
  var f = new java.io.File(String(path)).getAbsoluteFile(), parts = []
  while (f !== null) { parts.unshift(f); f = f.getParentFile() }
  parts.forEach(function(p) {
    WikiStudio.assert(!java.nio.file.Files.isSymbolicLink(p.toPath()), 400, "unsafe_path", "Symbolic links are not allowed")
    if (p.isFile()) {
      var links = Number(java.nio.file.Files.getAttribute(p.toPath(), "unix:nlink"))
      WikiStudio.assert(links === 1, 400, "unsafe_path", "Hard links are not allowed")
    }
  })
}
WikiStudio.atomic = function(path, value) {
  WikiStudio.noLinks(path)
  WikiStudio.privateDir(String(new java.io.File(path).getParent()))
  var tmp = path + ".tmp-" + WikiStudio.id(), stream
  try {
    stream = new java.io.FileOutputStream(tmp)
    java.nio.file.Files.setPosixFilePermissions(WikiStudio.path(tmp), java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
    stream.write(WikiStudio.bytes(JSON.stringify(value, null, 2))); stream.getFD().sync(); stream.close(); stream = null
    java.nio.file.Files.move(WikiStudio.path(tmp), WikiStudio.path(path), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } finally { if (stream) stream.close(); new java.io.File(tmp).delete() }
}
WikiStudio.json = function(path, fallback) {
  if (!io.fileExists(path)) return fallback
  WikiStudio.noLinks(path)
  WikiStudio.assert(Number(new java.io.File(path).length()) <= 8388608, 413, "state_limit", "State file exceeds limit")
  try { return JSON.parse(io.readFileString(path)) } catch(e) { WikiStudio.fail(503, "invalid_state", "Invalid persistent state; restore from a verified copy") }
}
WikiStudio.lock = function(home, key, fn) {
  WikiStudio.assert(/^[a-zA-Z0-9_-]+$/.test(key), 400, "invalid_lock", "Invalid lock")
  var path = home + "/locks/" + key, file, channel, lock
  WikiStudio.privateDir(home + "/locks"); WikiStudio.noLinks(path)
  try {
    file = new java.io.RandomAccessFile(path, "rw"); channel = file.getChannel()
    try { lock = channel.tryLock() } catch(ignore) {}
    WikiStudio.assert(lock !== null && isDef(lock), 423, "busy", "Wiki or registry is busy; retry after the active operation")
    return fn()
  } finally { if (lock) lock.release(); if (channel) channel.close(); if (file) file.close() }
}
WikiStudio.fields = function(obj, allowed) {
  WikiStudio.assert(isMap(obj), 400, "invalid_body", "Expected an object")
  Object.keys(obj).forEach(function(k) { WikiStudio.assert(allowed.indexOf(k) >= 0, 400, "unknown_field", "Unsupported field: " + k) })
}
WikiStudio.name = function(value) {
  WikiStudio.assert(isString(value) && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value), 400, "invalid_id", "Use a lower-case ID with letters, digits, underscores or hyphens")
  return value
}
WikiStudio.pagePath = function(value, markdown) {
  WikiStudio.assert(isString(value) && value.length <= 512 && !/[\\%:\x00-\x1f\x7f?#]/.test(value), 400, "unsafe_path", "Invalid page path")
  var parts = value.split("/")
  WikiStudio.assert(parts.every(function(p) { return p && p !== "." && p !== ".." && p.charAt(0) !== "." && !/^AGENTS\.md$/i.test(p) }), 400, "unsafe_path", "Hidden, instruction and traversal paths are not pages")
  if (markdown !== false) WikiStudio.assert(/\.md$/i.test(value), 400, "unsafe_path", "A Markdown path is required")
  return value
}
WikiStudio.safeFile = function(root, relative, markdown) {
  WikiStudio.pagePath(relative, markdown)
  var full = root + "/" + relative
  WikiStudio.noLinks(full)
  WikiStudio.assert(WikiStudio.inside(WikiStudio.canonical(full), root), 400, "unsafe_path", "Path leaves its root")
  return full
}
WikiStudio.identity = function(root) {
  WikiStudio.noLinks(root)
  var a = java.nio.file.Files.readAttributes(WikiStudio.path(root), java.nio.file.attribute.BasicFileAttributes)
  return String(a.fileKey())
}
WikiStudio.scan = function(root, all) {
  var files = {}, total = 0
  var walk = function(dir, depth) {
    WikiStudio.assert(depth < 32, 413, "depth_limit", "Directory nesting limit exceeded")
    var entries = new java.io.File(dir).listFiles()
    WikiStudio.assert(entries !== null, 400, "unreadable", "Directory is unreadable")
    for (var i = 0; i < entries.length; i++) {
      var f = entries[i], name = String(f.getName()), rel = String(f).substring(root.length + 1)
      WikiStudio.noLinks(String(f))
      if (!all && (name.charAt(0) === "." || /^AGENTS\.md$/i.test(name))) continue
      if (f.isDirectory()) walk(String(f), depth + 1)
      else if (f.isFile() && (all || /\.md$/i.test(name))) {
        total += Number(f.length())
        WikiStudio.assert(Object.keys(files).length < 20000 && total <= 536870912 && f.length() <= 16777216, 413, "inventory_limit", "Wiki inventory exceeds Studio limits")
        files[rel] = { hash: WikiStudio.hash(java.nio.file.Files.readAllBytes(f.toPath())), size: Number(f.length()) }
      }
    }
  }
  walk(root, 0); return files
}
WikiStudio.fingerprint = function(files) { return WikiStudio.hash(JSON.stringify(Object.keys(files).sort().map(function(k) { return [k, files[k].hash] }))) }
WikiStudio.redact = function(value) {
  var text = String(value).replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
  ;["OAF_MODEL", "OAF_LC_MODEL", "STUDIO_TOKEN"].forEach(function(k) { var s = String(getEnv(k) || ""); if (s) text = text.split(s).join("[redacted]") })
  return text.replace(/((?:api[_-]?key|password|secret|authorization|token)\s*[=:]\s*)[^\s,}\]]+/gi, "$1[redacted]").substring(0, 8192)
}
WikiStudio.authorize = function(role, needed, wiki) {
  var roles = ["viewer", "editor", "admin"]
  WikiStudio.assert(roles.indexOf(role) >= roles.indexOf(needed), 403, "forbidden", "This action requires " + needed)
  if (wiki && needed !== "viewer") WikiStudio.assert(wiki.access === "rw", 403, "read_only", "This wiki is read-only")
}
