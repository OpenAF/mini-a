// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
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
WikiStudioJobs.prototype.transition = function(id, from, values) {
  var self=this
  return WikiStudio.lock(this.config.home,"job-"+id,function(){var j=self.get(id);if(from.indexOf(j.status)<0)return null;Object.keys(values).forEach(function(k){j[k]=values[k]});j.updatedAt=WikiStudio.now();WikiStudio.atomic(self.dir(id)+"/job.json",j);return j})
}
WikiStudioJobs.prototype.event = function(id, phase, message, severity) {
  var self = this
  return WikiStudio.lock(this.config.home, "event-" + id, function() {
  var dir = self.dir(id), file = dir + "/events.ndjson", j = self.get(id)
  WikiStudio.noLinks(file)
  if (new java.io.File(file).length() > 1048576) return
  var previous=Number(WikiStudio.json(dir + "/cursor.json", { seq: 0 }).seq),fileSize=Number(new java.io.File(file).length())
  if(fileSize) {
    var raf=new java.io.RandomAccessFile(file,"rw"),start=Math.max(0,fileSize-16384),tail=java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,fileSize-start)
    try {
      raf.seek(start);raf.readFully(tail);var end=tail.length-1;while(end>=0&&Number(tail[end])!==10)end--
      if(end<tail.length-1){raf.setLength(start+end+1);raf.getFD().sync()}
      var text=String(new java.lang.String(java.util.Arrays.copyOf(tail,end+1),"UTF-8"))
      var lines=text.split("\n").filter(Boolean)
      if(lines.length)try{previous=Math.max(previous,Number(JSON.parse(lines[lines.length-1]).seq)||0)}catch(ignoreTail){}
    } finally{raf.close()}
  }
  var seq = previous + 1
  var out = new java.io.FileOutputStream(file, true)
  try { out.write(WikiStudio.bytes(JSON.stringify({ seq: seq, time: WikiStudio.now(), jobId: id, wikiId: j.wikiId, phase: phase, severity: severity || "info", message: WikiStudio.redact(message) }) + "\n")); out.getFD().sync() } finally { out.close() }
  WikiStudio.atomic(dir + "/cursor.json", { seq: seq })
  })
}
WikiStudioJobs.prototype.submit = function(w, operation, params, key, role) {
  WikiStudio.assert(isString(key) && /^[a-zA-Z0-9_-]{8,120}$/.test(key), 400, "idempotency_required", "Use an Idempotency-Key header (8–120 letters/digits/_/-)")
  var self = this, digest = WikiStudio.hash(JSON.stringify({ operation: operation, params: params })), scope = WikiStudio.hash(role + ":" + w.id + ":" + operation + ":" + key)
  return WikiStudio.lock(this.config.home, "queue", function() {
    var receipt = WikiStudio.json(self.config.home + "/receipts/requests/" + scope + ".json")
    if (receipt) {
      WikiStudio.assert(receipt.payloadHash === digest, 409, "idempotency_conflict", "Idempotency key already used with a different payload")
      WikiStudio.fail(410, "job_history_deleted", "This request already ran; its job history was deleted")
    }
    var previous = self.list().filter(function(j) { return j.idempotency === scope })[0]
    if (previous) { WikiStudio.assert(previous.payloadHash === digest, 409, "idempotency_conflict", "Idempotency key already used with a different payload"); return previous }
    WikiStudio.assert(self.list().length < 1000, 507, "job_retention_limit", "Job inventory is full; delete eligible history in Activity")
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
  if (this.migrateSources) this.migrateSources()
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
          if(!self.jobs.transition(j.id,["queued"],{status:"acquiring-lock",phase:"acquiring-lock"}))return
          selected[j.wikiId] = true; self._running.incrementAndGet()
          $doV(function() {
            var child
            try {
              var args = new java.util.ArrayList(); args.add(String(getOpenAFPath()) + "/ojob"); args.add(c.base + "/mini-a-wiki-studio-worker.yaml"); args.add("studiohome=" + c.home); args.add("jobid=" + j.id)
              child = new java.lang.ProcessBuilder(args).directory(new java.io.File(c.base)).redirectOutput(java.lang.ProcessBuilder.Redirect.DISCARD).redirectError(java.lang.ProcessBuilder.Redirect.DISCARD).start()
              var code = Number(child.waitFor()), final = WikiStudio.json(self.jobs.dir(j.id) + "/job.json")
              if (!final) return // Terminal history may have been removed after worker finalization.
              if (WikiStudioJobs.terminal.indexOf(final.status) < 0) self.jobs.update(j.id, { status: "recovery-required", phase: "worker-exit", warning: "Worker exited without finalization (exit " + code + "). Inspect engine journals before retry." })
            } catch(e) { if(io.fileExists(self.jobs.dir(j.id)+"/job.json")) self.jobs.update(j.id, { status: "recovery-required", phase: "worker-error", warning: "Worker failed; inspect recovery before retry" }) }
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
    if (req.method === "DELETE" && (parts.length === 3 || parts.length === 4)) {
      WikiStudio.authorize(role, "admin")
      WikiStudio.fields(body, ["wikiId", "ids", "confirmation"])
      var w = this.registry.verify(this.registry.get(WikiStudio.name(body.wikiId)))
      var ids = parts.length === 4 ? [parts[3]] : body.ids
      WikiStudio.assert(isArray(ids) && ids.length > 0 && ids.length <= 1000 && body.confirmation === "delete-history", 400, "confirmation_required", "Confirm the selected job history")
      var self = this
      return WikiStudio.wikiLock(this.config.home, w.id, function() {
        self.registry.verify(w)
        return WikiStudio.lock(self.config.home, "queue", function() { return jobs.removeHistory(w, ids) })
      })
    }
    if (parts.length === 3 && req.method === "GET") {
      var inventory = jobs.list(), registry = this.registry
      return WikiStudioServer.paginate(inventory.filter(function(j) { return !q.wikiId || j.wikiId === q.wikiId }).map(function(j) {
        var out = WikiStudioJobs.publicJob(j), wiki
        try { wiki = registry.verify(registry.get(j.wikiId)); out.deletion = jobs.deletion(j, wiki, inventory) }
        catch(e) { out.deletion = { allowed: false, reason: "Wiki is unavailable; restore its registration before cleanup" } }
        return out
      }), q)
    }
    var j = jobs.get(parts[3])
    if (parts.length === 4 && req.method === "GET") {
      var result = WikiStudioJobs.publicJob(j); result.result = WikiStudio.json(jobs.dir(j.id) + "/result.json", null); return result
    }
    if (parts.length === 5 && parts[4] === "review-recovery" && req.method === "POST") {
      WikiStudio.authorize(role, "admin"); WikiStudio.fields(body, ["confirmation"])
      WikiStudio.assert(body.confirmation === j.id && ["partial", "interrupted", "recovery-required"].indexOf(j.status) >= 0, 400, "confirmation_required", "Confirm the reviewed recovery job")
      var self = this, w = this.registry.verify(this.registry.get(j.wikiId))
      return WikiStudio.wikiLock(this.config.home, w.id, function() {
        self.assertIdle(w.id)
        WikiStudio.assert(WikiStudio.pending(w.root).length === 0, 409, "recovery_pending", "Resolve engine journals before marking recovery reviewed")
        return WikiStudioJobs.publicJob(jobs.update(j.id, { recoveryReviewedAt: WikiStudio.now() }))
      })
    }
    if (parts.length === 5 && parts[4] === "cancel" && req.method === "POST") {
      WikiStudio.authorize(role, "admin"); WikiStudio.fields(body, [])
      if (j.status === "queued") { var cancelled=jobs.transition(j.id,["queued"],{status:"cancelled",phase:"cancelled",cancelRequested:true}); if(cancelled)return WikiStudioJobs.publicJob(cancelled);j=jobs.get(j.id) }
      WikiStudio.assert(WikiStudioJobs.terminal.indexOf(j.status) < 0, 409, "job_finished", "Job is already terminal")
      return WikiStudioJobs.publicJob(jobs.update(j.id, { cancelRequested: true, warning: j.operation === "graph.build" ? "Cancellation requested. Completed graph work is checkpointed; no further model calls will be scheduled. In-flight calls use their request timeout." : "Cancellation requested. Active engines have no safe abort checkpoint; the job may finish with writes. No rollback is implied." }))
    }
  }
  WikiStudio.fail(404, "not_found", "Route not found")
}
WikiStudioJobs.publicJob = function(j) { var out = JSON.parse(JSON.stringify(j)); ["root", "rootIdentity", "idempotency", "payloadHash", "role"].forEach(function(k) { delete out[k] }); return out }
WikiStudioServer.prototype.streamEvents = function(req, ex) {
  var jobs = this.jobs, id = req.path.split("/")[4], j = jobs.get(id), cursor = Number(req.headers["last-event-id"] || req.query.cursor || 0)
  WikiStudio.assert(cursor >= 0 && isFinite(cursor), 400, "invalid_cursor", "Invalid event cursor")
  var file = jobs.dir(j.id) + "/events.ndjson", events = []
  if(io.fileExists(file))io.readFileString(file).split("\n").filter(Boolean).forEach(function(l){try{events.push(JSON.parse(l))}catch(ignoreIncompleteEvent){}})
  var text = ": replay; reconnect with Last-Event-ID\n\n" + events.filter(function(e) { return e.seq > cursor }).slice(0, 200).map(function(e) { return "id: " + e.seq + "\nevent: progress\ndata: " + JSON.stringify(e) + "\n\n" }).join("")
  var bytes = WikiStudio.bytes(text)
  ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8"); ex.sendResponseHeaders(200, bytes.length); ex.getResponseBody().write(bytes); ex.close()
}

// Keep only durable authorization/deduplication receipts when users remove history.
WikiStudioJobs.prototype.planReceiptPath = function(wikiId, planId) {
  return this.config.home + "/receipts/plans/" + WikiStudio.hash(wikiId + ":" + planId) + ".json"
}
WikiStudioJobs.prototype.deletion = function(job, wiki, inventory) {
  var reason = ""
  if (WikiStudioJobs.terminal.indexOf(job.status) < 0) reason = "Job is still active"
  else if (WikiStudio.pending(wiki.root).length) reason = "Resolve pending wiki recovery before clearing history"
  else if (["partial", "recovery-required", "interrupted"].indexOf(job.status) >= 0 && !job.recoveryReviewedAt) reason = "Review and resolve this job's recovery before deleting history"
  return { allowed: !reason, reason: reason }
}
WikiStudioJobs.prototype.removeHistory = function(wiki, ids) {
  var self = this, inventory = this.list(), selected = [], seen = {}
  ids.forEach(function(id) {
    var j = self.get(id)
    WikiStudio.assert(j.wikiId === wiki.id, 404, "job_not_found", "Job does not belong to this wiki")
    WikiStudio.assert(!seen[id], 400, "duplicate_job", "Select each job once"); seen[id] = true
    var eligibility = self.deletion(j, wiki, inventory)
    WikiStudio.assert(eligibility.allowed, 409, "history_protected", eligibility.reason)
    WikiStudio.scan(self.dir(id), true); selected.push(j)
  })
  var deleted = []
  selected.forEach(function(j) {
    WikiStudio.lock(self.config.home, "job-" + j.id, function() {
      WikiStudio.lock(self.config.home, "event-" + j.id, function() {
        var current = self.get(j.id)
        WikiStudio.assert(self.deletion(current, wiki, inventory).allowed, 409, "history_protected", "Job eligibility changed")
        if (j.operation === "absorb.plan" && j.status === "completed") {
          var result = WikiStudio.json(self.dir(j.id) + "/result.json", {})
          if (result.id && result.plan) WikiStudio.atomic(self.planReceiptPath(wiki.id, result.id), { wikiId: wiki.id, planId: result.id, rootIdentity: j.rootIdentity, sourceIdentities: j.params.sourceIdentities })
        }
        var backups = self.config.home + "/backups/" + wiki.id
        if (io.fileExists(backups)) io.listFiles(backups).files.filter(function(f) { return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename) }).forEach(function(f) {
          var manifest = WikiStudio.json(f.filepath+"/manifest.json")
          if (manifest && manifest.sourceJob === j.id && !manifest.origin) { manifest.origin = j.operation === "backup.snapshot" ? "manual" : "automatic"; WikiStudio.atomic(f.filepath+"/manifest.json",manifest) }
        })
        if (j.idempotency) WikiStudio.atomic(self.config.home + "/receipts/requests/" + j.idempotency + ".json", { id: j.id, payloadHash: j.payloadHash })
        // Rename out of the live inventory before removing files. A crash can only
        // leave disposable garbage, never a half-deleted job in the scheduler.
        var trash = self.config.home + "/deleted-history/" + j.id
        WikiStudio.privateDir(self.config.home + "/deleted-history"); WikiStudio.noLinks(trash)
        java.nio.file.Files.move(WikiStudio.path(self.dir(j.id)), WikiStudio.path(trash), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
        io.rm(trash); deleted.push(j.id)
      })
    })
  })
  return { deleted: deleted }
}
