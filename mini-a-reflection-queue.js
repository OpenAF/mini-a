// Durable reflection jobs. Callers supply bounded snapshots, never model configs.
var MiniAReflectionQueue = function(root) {
  this.root = String(new java.io.File(root).getCanonicalPath())
  this.maxJobs = 256
  io.mkdir(this.root)
}
MiniAReflectionQueue.prototype._locked = function(fn, wait) {
  var file = new java.io.RandomAccessFile(this.root + "/queue.lock", "rw"), lock
  try {
    var deadline = now() + (wait === true ? 1000 : 0)
    do {
      try { lock = file.getChannel().tryLock() } catch(e) {
        if (String(e).indexOf("OverlappingFileLockException") < 0) throw e
      }
      if (!lock && now() >= deadline) return __
      if (!lock) java.lang.Thread.sleep(10)
    } while (!lock)
    return fn()
  } catch(e) {
    if (String(e).indexOf("OverlappingFileLockException") >= 0) return __
    throw e
  } finally { if (lock) lock.release(); file.close() }
}
MiniAReflectionQueue.prototype._path = function(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid reflection job id")
  return this.root + "/" + id + ".json"
}
MiniAReflectionQueue.prototype._write = function(job) {
  var path = this._path(job.id), temp = path + "." + genUUID() + ".tmp"
  try {
    io.writeFileString(temp, stringify(job, __, ""))
    var file = new java.io.RandomAccessFile(temp, "rw")
    try { file.getChannel().force(true) } finally { file.close() }
    java.nio.file.Files.move(new java.io.File(temp).toPath(), new java.io.File(path).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } finally { if (io.fileExists(temp)) io.rm(temp) }
}
MiniAReflectionQueue.prototype.enqueue = function(destination, snapshot) {
  var self = this
  return this._locked(function() {
    var id = sha256(destination + ":" + snapshot.runId), path = self._path(id)
    if (io.fileExists(path)) return id
    var files = io.listFiles(self.root).files.filter(function(f) { return f.isFile && /^[a-f0-9]{64}\.json$/.test(f.filename) })
    var terminal = []
    files.forEach(function(f) {
      try {
        var job = io.readFileJSON(f.canonicalPath)
        if (job.status === "completed" || job.status === "failed") terminal.push({ path: f.canonicalPath, created: job.created })
      } catch(ignoreInvalidJob) {}
    })
    terminal.sort(function(a, b) { return a.created - b.created })
    var count = files.length
    while (count >= self.maxJobs && terminal.length > 0) { io.rm(terminal.shift().path); count-- }
    if (count >= self.maxJobs) throw new Error("Reflection queue is full; pending jobs retained")
    self._write({ version: 1, id: id, destination: destination, snapshot: clone(snapshot), status: "pending", attempts: 0, created: now() })
    return id
  }, true)
}
MiniAReflectionQueue.prototype.claim = function(destination, before) {
  var self = this
  return this._locked(function() {
    var files = io.listFiles(self.root).files.filter(function(f) { return f.isFile && /^[a-f0-9]{64}\.json$/.test(f.filename) }).sort(function(a, b) { return a.filename < b.filename ? -1 : 1 })
    for (var i = 0; i < files.length; i++) {
      var job
      try {
        job = io.readFileJSON(files[i].canonicalPath)
        if (!isMap(job) || job.id + ".json" !== files[i].filename || !isNumber(job.attempts) || !isNumber(job.created)) throw new Error("Invalid reflection job")
      } catch(invalidJob) {
        java.nio.file.Files.move(new java.io.File(files[i].canonicalPath).toPath(), new java.io.File(files[i].canonicalPath + ".invalid").toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        continue
      }
      if (job.version !== 1 || job.destination !== destination || job.created >= before) continue
      if (job.status !== "pending" && !(job.status === "running" && job.leaseUntil < now())) continue
      if (job.attempts >= 3) { job.status = "failed"; self._write(job); continue }
      job.status = "running"; job.attempts++; job.owner = genUUID(); job.leaseUntil = now() + 300000
      self._write(job)
      return clone(job)
    }
  })
}
MiniAReflectionQueue.prototype.prepare = function(claim, candidates) {
  var self = this
  return this._locked(function() {
    var job = io.readFileJSON(self._path(claim.id))
    if (job.status !== "running" || job.owner !== claim.owner || job.leaseUntil < now()) return false
    if (!isMap(candidates) || !isArray(candidates.accepted) || candidates.accepted.length > 5) throw new Error("Invalid reflection candidates")
    if (!job.prepared) { job.prepared = clone(candidates); self._write(job) }
    return true
  })
}
MiniAReflectionQueue.prototype.defer = function(claim) {
  var self = this
  return this._locked(function() {
    var job = io.readFileJSON(self._path(claim.id))
    if (job.status !== "running" || job.owner !== claim.owner || job.leaseUntil < now()) return false
    job.status = "pending"; job.attempts = Math.max(0, job.attempts - 1)
    delete job.owner; delete job.leaseUntil
    self._write(job)
    return true
  })
}
MiniAReflectionQueue.prototype.finish = function(claim, succeeded) {
  var self = this
  return this._locked(function() {
    var job = io.readFileJSON(self._path(claim.id))
    if (job.status !== "running" || job.owner !== claim.owner || job.leaseUntil < now()) return false
    job.status = succeeded ? "completed" : (job.attempts >= 3 ? "failed" : "pending")
    delete job.owner; delete job.leaseUntil
    self._write(job)
    return true
  })
}
if (typeof exports !== "undefined") exports.MiniAReflectionQueue = MiniAReflectionQueue
