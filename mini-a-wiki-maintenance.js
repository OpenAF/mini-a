// Shared local writer coordination. Reentrancy belongs to a Java thread, never
// merely to the process: another session in this JVM must receive a busy result.
if (!global.__miniAWikiWriters) global.__miniAWikiWriters = {
  mutex: new java.util.concurrent.locks.ReentrantLock(), entries: {}
}
var __miniAWikiWriterLock = function(root, options) {
  var registry = global.__miniAWikiWriters, opts = options || {}
  var canonical = String(new java.io.File(String(root)).getCanonicalPath())
  var path = canonical + "/.mini-a-wiki-ingest/writer.lock"
  var thread = String(java.lang.Thread.currentThread().getId()), entry, file, channel, lock
  registry.mutex.lock()
  try {
    entry = registry.entries[path]
    if (entry) {
      if (entry.thread !== thread) throw new Error("wiki-writer-busy")
      entry.depth++
    } else {
      if (String(new java.io.File(path).getCanonicalPath()) !== path) throw new Error("unsafe-writer-lock")
      if (!opts.maintenance && io.fileExists(canonical + "/.mini-a-wiki-maintenance/pending.json")) throw new Error("wiki-maintenance-pending: run /dream wiki auto to reconcile")
      var dir = new java.io.File(path).getParentFile()
      if (!dir.exists() && !dir.mkdirs()) throw new Error("cannot create wiki writer directory")
      try {
        file = new java.io.RandomAccessFile(path, "rw"); channel = file.getChannel(); lock = channel.tryLock()
        if (!lock) throw new Error("wiki-writer-busy")
      } catch(e) {
        if (channel) channel.close()
        if (file) file.close()
        throw new Error("wiki-writer-busy: " + String(e))
      }
      entry = { thread: thread, depth: 1, file: file, channel: channel, lock: lock }
      registry.entries[path] = entry
    }
  } finally { registry.mutex.unlock() }
  var released = false
  return { release: function() {
    registry.mutex.lock()
    try {
      if (released) return
      released = true
      if (--entry.depth === 0) {
        try { entry.lock.release() } finally {
          try { entry.channel.close() } finally { entry.file.close(); delete registry.entries[path] }
        }
      }
    } finally { registry.mutex.unlock() }
  } }
}

// Crash-safe JSON replaces only after the temporary file has reached disk.
var __miniAWikiMaintenanceJson = function(path, value) {
  var target = new java.io.File(path), parent = target.getParentFile()
  if (String(target.getCanonicalPath()) !== String(target.getAbsolutePath())) throw new Error("unsafe-maintenance-path: " + path)
  if (!parent.exists() && !parent.mkdirs()) throw new Error("backup-directory-failed")
  var temp = path + ".tmp-" + java.util.UUID.randomUUID(), fd
  try {
    fd = new java.io.RandomAccessFile(temp, "rw")
    fd.write(new java.lang.String(JSON.stringify(value)).getBytes("UTF-8")); fd.getFD().sync(); fd.close(); fd = null
    java.nio.file.Files.move(new java.io.File(temp).toPath(), target.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    // Persist the rename and newly created maintenance/run directory entries.
    ;[parent, parent.getParentFile()].forEach(function(dir) {
      if (!dir) return
      var channel = java.nio.channels.FileChannel.open(dir.toPath(), java.nio.file.StandardOpenOption.READ)
      try { channel.force(true) } finally { channel.close() }
    })
  } finally { if (fd) fd.close(); if (io.fileExists(temp)) io.rm(temp) }
}
