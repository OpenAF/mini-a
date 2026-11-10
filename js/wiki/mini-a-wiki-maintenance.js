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
      if (!opts.folderRecovery && io.fileExists(canonical + "/.mini-a-wiki-folders/pending.json")) throw new Error("folder-recovery-required: restore the verified folder snapshot")
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

// Rebuild derived artifacts from Markdown, retaining graph checkpoints between runs.
var __miniAWikiFullRebuild = function(wm, options) {
  var opts = options || {}
  if (opts.confirmExpensive !== true) return { ok: false, error: "Confirm the expensive full rebuild explicitly" }
  if (wm._access !== "rw" || wm._backendType !== "fs" || wm._catalog || !wm._graph) return { ok: false, error: "Full rebuild requires a writable filesystem wiki with graph enabled" }
  var buildOptions = MiniAGraphBuild.resolve(merge(opts, { extraction: "semantic", force: false, strategy: "incremental" }))
  var root = String(new java.io.File(wm._backend.root).getCanonicalPath())
  var lock = __miniAWikiWriterLock(root)
  var path = wm._getIndexRoot() + "/.mini-a-wiki-full-rebuild.json"
  var state
  // Phase checkpoints are durable; interrupted index publication restarts atomically.
  try {
    state = io.fileExists(path) ? io.readFileJSON(path) : { version: 1, phase: "index", id: String(java.util.UUID.randomUUID()) }
    if (state.phase === "complete") state = { version: 1, phase: "index", id: String(java.util.UUID.randomUUID()) }
    if (state.version !== 1 || ["index", "graph-reset", "graph"].indexOf(state.phase) < 0 || !/^[a-f0-9-]{36}$/.test(state.id)) throw new Error("unsupported-rebuild-journal")
    if (state.destination && state.destination !== root) throw new Error("rebuild-destination-mismatch")
    state.destination = root
    // External edits invalidate the index checkpoint; rescan hashes without retaining page bodies.
    var source = sha256(wm._safeListPages("").filter(function(p) { return !wm._isSearchExcludedPath(p) }).sort().map(function(p) {
      return [p, sha256(wm._backend.read(p))]
    }).map(function(record) { return JSON.stringify(record) }).join("\n"))
    if (state.source && state.source !== source) state.phase = "index"
    state.source = source
    var progress = function(extra) {
      if (isFunction(opts.onProgress)) opts.onProgress(merge({ operation: "full-rebuild", id: state.id, phase: state.phase }, extra || {}))
    }
    __miniAWikiMaintenanceJson(path, state)
    progress()
    if (isFunction(opts.isCancelled) && opts.isCancelled()) return { ok: true, complete: false, status: "cancelled", phase: state.phase, id: state.id, partial: true, resumable: true }
    if (state.phase === "index") {
      var indexed = wm.reindex({ authoritative: true, resetLucene: true, skipGraph: true })
      if (!indexed || indexed.ok !== true) return { ok: false, phase: "index", result: indexed }
      state.phase = "graph-reset"
      __miniAWikiMaintenanceJson(path, state)
    }
    if (state.phase === "graph-reset") {
      // Keep the previous graph snapshot available for manual recovery.
      var graphFile = wm._graph._graphDir + "/graph.json"
      if (io.fileExists(graphFile) && !io.fileExists(graphFile + ".before-full-rebuild-" + state.id)) io.cp(graphFile, graphFile + ".before-full-rebuild-" + state.id)
      wm._graph._falkorNeedsFullSync = true
      wm._graph._state = wm._graph._emptyState()
      wm._graph._reindexEdges()
      wm._graph._markDerivedDirty()
      wm._graph.save()
      state.phase = "graph"
      __miniAWikiMaintenanceJson(path, state)
    }
    progress()
    buildOptions.force = false
    buildOptions.onProgress = progress
    buildOptions.formatModelError = opts.formatModelError
    buildOptions.isCancelled = opts.isCancelled
    var graph = wm.graph("build", buildOptions)
    state.phase = graph.ok !== false && graph.stage === "complete" && graph.partial !== true && !graph.failed && (buildOptions.modelHelp === "off" || !graph.pending) ? "complete" : "graph"
    __miniAWikiMaintenanceJson(path, state)
    progress({ graph: graph })
    var cancelled = isFunction(opts.isCancelled) && opts.isCancelled()
    return { ok: graph.ok !== false, complete: state.phase === "complete", partial: state.phase !== "complete", status: cancelled ? "cancelled" : state.phase === "complete" ? "complete" : "partial", phase: state.phase, id: state.id, graph: graph, resumable: state.phase !== "complete" }
  } finally {
    lock.release()
  }
}
