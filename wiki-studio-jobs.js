loadLib("wiki-studio-common.js")
var WikiStudioJobs = function(config) { this.config = config }
WikiStudioJobs.terminal = ["completed", "failed", "partial", "recovery-required", "cancelled", "interrupted"]
WikiStudioJobs.prototype.dir = function(id) { WikiStudio.assert(/^[a-f0-9-]{36}$/.test(id), 400, "invalid_job", "Invalid job ID"); return this.config.home + "/jobs/" + id }
WikiStudioJobs.prototype.get = function(id) { var j = WikiStudio.json(this.dir(id) + "/job.json"); WikiStudio.assert(j, 404, "job_not_found", "Job not found"); return j }
WikiStudioJobs.prototype.list = function() {
  var self = this
  return io.listFiles(this.config.home + "/jobs").files.filter(function(f) { return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename) }).map(function(f) { return self.get(f.filename) }).sort(function(a,b) { return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id) })
}
WikiStudioJobs.prototype.update = function(id, values) {
  var self = this
  return WikiStudio.lock(this.config.home, "job-" + id, function() {
    var j = self.get(id); Object.keys(values).forEach(function(k) { j[k] = values[k] }); j.updatedAt = WikiStudio.now()
    WikiStudio.atomic(self.dir(id) + "/job.json", j); return j
  })
}
WikiStudioJobs.prototype.event = function(id, phase, message, severity) {
  var self = this
  return WikiStudio.lock(this.config.home, "event-" + id, function() {
  var dir = self.dir(id), file = dir + "/events.ndjson", j = self.get(id)
  WikiStudio.noLinks(file)
  if (new java.io.File(file).length() > 1048576) return
  var seq = Number(WikiStudio.json(dir + "/cursor.json", { seq: 0 }).seq) + 1
  var out = new java.io.FileOutputStream(file, true)
  try { out.write(WikiStudio.bytes(JSON.stringify({ seq: seq, time: WikiStudio.now(), jobId: id, wikiId: j.wikiId, phase: phase, severity: severity || "info", message: WikiStudio.redact(message) }) + "\n")); out.getFD().sync() } finally { out.close() }
  WikiStudio.atomic(dir + "/cursor.json", { seq: seq })
  })
}
WikiStudioJobs.prototype.submit = function(w, operation, params, key, role) {
  WikiStudio.assert(isString(key) && /^[a-zA-Z0-9_-]{8,120}$/.test(key), 400, "idempotency_required", "Use an Idempotency-Key header (8–120 letters/digits/_/-)")
  var self = this, digest = WikiStudio.hash(JSON.stringify({ operation: operation, params: params })), scope = WikiStudio.hash(role + ":" + w.id + ":" + operation + ":" + key)
  return WikiStudio.lock(this.config.home, "queue", function() {
    var previous = self.list().filter(function(j) { return j.idempotency === scope })[0]
    if (previous) { WikiStudio.assert(previous.payloadHash === digest, 409, "idempotency_conflict", "Idempotency key already used with a different payload"); return previous }
    WikiStudio.assert(self.list().length < 1000, 507, "job_retention_limit", "Job inventory is full; archive completed jobs locally")
    var id = WikiStudio.id(), dir = self.dir(id)
    WikiStudio.privateDir(dir)
    var j = { version: 1, id: id, wikiId: w.id, operation: operation, params: params, root: w.root, rootIdentity: w.identity, status: "queued", phase: "queued", createdAt: WikiStudio.now(), updatedAt: WikiStudio.now(), idempotency: scope, payloadHash: digest, role: role, cancelRequested: false }
    WikiStudio.atomic(dir + "/job.json", j); self.event(id, "queued", "Job persisted; waiting for an exclusive Studio lock")
    return j
  })
}
WikiStudioServer.prototype.assertIdle = function(wikiId) {
  if (!this.jobs) return
  WikiStudio.assert(!this.jobs.list().some(function(j) { return j.wikiId === wikiId && WikiStudioJobs.terminal.indexOf(j.status) < 0 }), 423, "wiki_maintenance", "Wiki has queued or running maintenance; wait for it to finish")
}
WikiStudioServer.prototype.startJobs = function() {
  var self = this, c = this.config
  this.jobs = new WikiStudioJobs(c)
  // A second server must never mark another server's jobs interrupted.
  var file = new java.io.RandomAccessFile(c.home + "/locks/server", "rw"), channel = file.getChannel(), lease
  try { lease = channel.tryLock() } catch(ignore) {}
  WikiStudio.assert(lease !== null && isDef(lease), 423, "server_running", "Another Studio server owns this home")
  this._lease = { file: file, channel: channel, lock: lease }
  this.jobs.list().forEach(function(j) { if (WikiStudioJobs.terminal.indexOf(j.status) < 0) self.jobs.update(j.id, { status: "interrupted", phase: "interrupted", warning: "Server restarted. No automatic retry. A worker may still hold the OS lock; inspect engine recovery before a new submission." }) })
  this._running = new java.util.concurrent.atomic.AtomicInteger(0)
  $doV(function() {
    while (self.http) {
      try {
        var queued = self.jobs.list().filter(function(j) { return j.status === "queued" }).reverse(), selected = {}
        queued.forEach(function(j) {
          if (self._running.get() >= c.workers || selected[j.wikiId]) return
          var busy = self.jobs.list().some(function(x) { return x.wikiId === j.wikiId && x.id !== j.id && WikiStudioJobs.terminal.indexOf(x.status) < 0 && x.status !== "queued" })
          if (busy) return
          selected[j.wikiId] = true; self.jobs.update(j.id, { status: "acquiring-lock", phase: "acquiring-lock" }); self._running.incrementAndGet()
          $doV(function() {
            var child
            try {
              var args = new java.util.ArrayList(); args.add(String(getOpenAFPath()) + "/ojob"); args.add(c.base + "/mini-a-wiki-studio-worker.yaml"); args.add("studiohome=" + c.home); args.add("jobid=" + j.id)
              child = new java.lang.ProcessBuilder(args).directory(new java.io.File(c.base)).redirectOutput(java.lang.ProcessBuilder.Redirect.DISCARD).redirectError(java.lang.ProcessBuilder.Redirect.DISCARD).start()
              var code = Number(child.waitFor()), final = self.jobs.get(j.id)
              if (WikiStudioJobs.terminal.indexOf(final.status) < 0) self.jobs.update(j.id, { status: "recovery-required", phase: "worker-exit", warning: "Worker exited without finalization (exit " + code + "). Inspect engine journals before retry." })
            } catch(e) { self.jobs.update(j.id, { status: "recovery-required", phase: "worker-error", warning: "Worker failed; inspect recovery before retry" }) }
            finally { self._running.decrementAndGet() }
          })
        })
      } catch(ignoreQueueError) {}
      sleep(500, true)
    }
  })
}
WikiStudioServer.prototype.extraRoute = function(req, parts, role) {
  var jobs = this.jobs || new WikiStudioJobs(this.config), q = req.query || {}, body = req.body || {}
  if (parts[2] === "jobs") {
    if (parts.length === 3 && req.method === "GET") return WikiStudioServer.paginate(jobs.list().filter(function(j) { return !q.wikiId || j.wikiId === q.wikiId }).map(WikiStudioJobs.publicJob), q)
    var j = jobs.get(parts[3])
    if (parts.length === 4 && req.method === "GET") {
      var result = WikiStudioJobs.publicJob(j); result.result = WikiStudio.json(jobs.dir(j.id) + "/result.json", null); return result
    }
    if (parts.length === 5 && parts[4] === "cancel" && req.method === "POST") {
      WikiStudio.authorize(role, "admin"); WikiStudio.fields(body, [])
      if (j.status === "queued") return WikiStudioJobs.publicJob(jobs.update(j.id, { status: "cancelled", phase: "cancelled", cancelRequested: true }))
      WikiStudio.assert(WikiStudioJobs.terminal.indexOf(j.status) < 0, 409, "job_finished", "Job is already terminal")
      return WikiStudioJobs.publicJob(jobs.update(j.id, { cancelRequested: true, warning: "Cancellation requested. Active engines have no safe abort checkpoint; the job may finish with writes. No rollback is implied." }))
    }
  }
  WikiStudio.fail(404, "not_found", "Route not found")
}
WikiStudioJobs.publicJob = function(j) { var out = JSON.parse(JSON.stringify(j)); ["root", "rootIdentity", "idempotency", "payloadHash", "role"].forEach(function(k) { delete out[k] }); return out }
WikiStudioServer.prototype.streamEvents = function(req, ex) {
  var jobs = this.jobs, id = req.path.split("/")[4], j = jobs.get(id), cursor = Number(req.headers["last-event-id"] || req.query.cursor || 0)
  WikiStudio.assert(cursor >= 0 && isFinite(cursor), 400, "invalid_cursor", "Invalid event cursor")
  var file = jobs.dir(j.id) + "/events.ndjson", events = io.fileExists(file) ? io.readFileString(file).split("\n").filter(Boolean).map(function(l) { return JSON.parse(l) }) : []
  var text = ": replay; reconnect with Last-Event-ID\n\n" + events.filter(function(e) { return e.seq > cursor }).slice(0, 200).map(function(e) { return "id: " + e.seq + "\nevent: progress\ndata: " + JSON.stringify(e) + "\n\n" }).join("")
  var bytes = WikiStudio.bytes(text)
  ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8"); ex.sendResponseHeaders(200, bytes.length); ex.getResponseBody().write(bytes); ex.close()
}
