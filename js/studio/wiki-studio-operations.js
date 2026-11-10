// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/wiki/mini-a-wikiops.js"))
WikiStudioServer.prototype.jobWikiRoute = function(req, w, parts, role) {
  var route = parts.join("/"), body = req.body || {}, self = this, jobs = this.jobs || new WikiStudioJobs(this.config)
  if (route === "sources") {
    if (req.method === "GET") return WikiStudioServer.paginate(this.sourceList(w).map(WikiStudioServer.publicSource), req.query || {})
    if (req.method === "POST") { WikiStudio.authorize(role, "admin", w); return this.sourceAdd(w, body) }
  }
  if (parts.length === 2 && parts[0] === "sources") {
    WikiStudio.assert(req.method === "DELETE", 405, "method_not_allowed", "Use DELETE to remove a source")
    WikiStudio.authorize(role, "admin", w)
    return this.sourceDelete(w, parts[1], body)
  }
  if (this.exportRoute && (route === "exports" || /^exports\//.test(route))) return this.exportRoute(req, w, parts, role)
  if (this.backupRoute && (route === "backups" || /^backups\//.test(route) || route === "changes")) return this.backupRoute(req, w, parts, role)
  if (route === "graph/settings") {
    if (req.method !== "GET") WikiStudio.authorize(role, "admin", w)
    WikiStudio.assert(req.method === "GET" || req.method === "PUT", 405, "method_not_allowed", "Use GET or PUT for graph settings")
    WikiStudio.fields(body, ["extraction", "modelHelp", "maxCalls", "maxTokens", "maxMinutes", "preset"])
    return WikiStudio.wikiLock(this.config.home, w.id, function() {
      if (req.method === "PUT" && self.assertIdle) self.assertIdle(w.id)
      return self.manager(w, req.method === "PUT", function(wm) { return wm.graphBuildSettings(body, req.method === "PUT") }, {skipBootstrap:true})
    })
  }
  WikiStudio.assert(req.method === "POST", 405, "method_not_allowed", "Use POST to submit jobs")
  WikiStudio.authorize(role, "admin", w)
  var operation, params = {}
  if (/^folders\/(preview|move|delete)$/.test(route)) {
    WikiStudio.fields(body, ["source", "destination", "expectedRevision", "confirmation"])
    WikiStudio.safeFile(w.root, body.source, false)
    if (body.destination) WikiStudio.safeFile(w.root, body.destination, false)
    if (route === "folders/preview") return WikiStudio.wikiLock(this.config.home, w.id, function() {
      self.assertIdle(w.id)
      var preview = self.manager(w, false, function(wm) { return wm.previewFolder(body.source, body.destination || null) }, {skipBootstrap:true})
      WikiStudio.assert(preview.ok, 409, "folder_preflight", preview.error || "Folder preview failed")
      return preview
    })
    WikiStudio.assert(isString(body.expectedRevision) && /^[a-f0-9]{40}$/.test(body.expectedRevision), 400, "preview_required", "Preview the folder operation first")
    if (route === "folders/delete") WikiStudio.assert(body.confirmation === body.source && !body.destination, 400, "confirmation_required", "Confirm deletion by exact source folder path")
    else WikiStudio.assert(isString(body.destination) && body.destination.length > 0, 400, "destination_required", "Choose a destination folder")
    params = {from:body.source,to:route === "folders/move" ? body.destination : null,expectedRevision:body.expectedRevision,confirmation:body.confirmation || ""}
    operation = route === "folders/move" ? "wiki.folderMove" : "wiki.folderDelete"
  } else if (/^selection\/(preview|move|delete)$/.test(route)) {
    WikiStudio.fields(body, ["items", "destination", "expectedRevision", "confirmation"])
    WikiStudio.assert(isArray(body.items) && body.items.length > 0 && body.items.length <= 500, 400, "invalid_items", "Select between 1 and 500 items")
    body.items.forEach(function(i) { WikiStudio.assert(isString(i), 400, "invalid_items", "Items must be paths"); WikiStudio.safeFile(w.root, i, false) })
    var dest = isString(body.destination) ? body.destination : null
    if (dest) WikiStudio.safeFile(w.root, dest, false)
    if (route === "selection/preview") return WikiStudio.wikiLock(this.config.home, w.id, function() {
      self.assertIdle(w.id)
      var preview = self.manager(w, false, function(wm) { return wm.previewSelection(body.items, dest) }, {skipBootstrap:true})
      WikiStudio.assert(preview.ok, 409, "selection_preflight", preview.error || "Selection preview failed")
      return preview
    })
    WikiStudio.assert(isString(body.expectedRevision) && /^[a-f0-9]{40}$/.test(body.expectedRevision), 400, "preview_required", "Preview the selection first")
    if (route === "selection/delete") WikiStudio.assert(body.confirmation === "delete " + body.items.length + (body.items.length === 1 ? " item" : " items") && dest === null, 400, "confirmation_required", "Confirm deletion by typing: delete " + body.items.length + (body.items.length === 1 ? " item" : " items"))
    else WikiStudio.assert(dest !== null, 400, "destination_required", "Choose a destination folder (empty for the wiki root)")
    params = {items:body.items,to:route === "selection/move" ? dest : null,expectedRevision:body.expectedRevision,confirmation:body.confirmation || ""}
    operation = route === "selection/move" ? "wiki.selectionMove" : "wiki.selectionDelete"
  } else if (route === "graph/rebuild") {
    WikiStudio.fields(body, MiniAGraphBuild.fields.concat(["compact", "confirmation"]))
    WikiStudio.assert(isUnDef(body.compact) || isBoolean(body.compact), 400, "invalid_options", "Compact must be boolean")
    if (body.compact) WikiStudio.assert(body.confirmation && body.confirmation.externalProcessesStopped === true, 400, "offline_required", "Confirm external processes are stopped")
    try { params = this.manager(w, false, function(wm) { return wm.graphBuildSettings(body).effective }) }
    catch(e) { WikiStudio.fail(400, "invalid_options", String(e.message || e)) }
    params.compact = body.compact === true
    operation = "graph.build"
  } else if (route === "dreams") {
    WikiStudio.fields(body, ["mode", "options", "confirmation"])
    WikiStudio.assert(["plan", "apply", "repair", "reindex", "graph", "indexes", "reorg", "auto"].indexOf(body.mode) >= 0, 400, "invalid_mode", "Unsupported dream mode")
    var o = body.options || {}; WikiStudio.fields(o, ["semantic", "organize", "instructions", "dreammaxsteps", "backup", "compact", "dryrun", "tuning"])
    WikiStudio.assert(body.mode!=="plan"||o.semantic!==true,400,"plan_model_free","Plan is model-free maintenance diagnostics; semantic extraction is unavailable in plan mode")
    ;["semantic", "backup", "compact", "dryrun"].forEach(function(k) { if (isDef(o[k])) WikiStudio.assert(isBoolean(o[k]), 400, "invalid_options", "Expected boolean: " + k) })
    WikiStudio.assert(!isDef(o.organize) || ["none", "topics"].indexOf(o.organize) >= 0, 400, "invalid_options", "Organization must be none or topics")
    WikiStudio.assert(!isDef(o.instructions) || isString(o.instructions) && o.instructions.length <= 8000, 400, "invalid_options", "Instructions exceed limit")
    WikiStudio.assert(!isDef(o.dreammaxsteps) || isNumber(o.dreammaxsteps) && o.dreammaxsteps >= 1 && o.dreammaxsteps <= 100 && Math.floor(o.dreammaxsteps) === o.dreammaxsteps, 400, "invalid_options", "Step budget must be 1–100")
    params = { semantic: o.semantic === true, organize: o.organize || "none", instructions: o.instructions || "", dreammaxsteps: o.dreammaxsteps || 40, compact: o.compact === true, dryrun: body.mode === "plan" || body.mode === "auto" && o.dryrun !== false, backup: true }
    if (["reorg", "auto"].indexOf(body.mode) >= 0) {
      params.tuning = this.resolveTuning(w, body.mode, o.tuning || {})
      if (isDef(o.dreammaxsteps)) params.tuning.dreammaxsteps = o.dreammaxsteps
      params.dreammaxsteps = params.tuning.dreammaxsteps
    }
    if (body.mode === "reorg") WikiStudio.assert(body.confirmation && body.confirmation.acknowledgeStructuralChanges === true, 400, "confirmation_required", "Reorg is a live structural edit, not a frozen plan. Explicit structural-change confirmation is required")
    if (o.compact === true) WikiStudio.assert(body.confirmation && body.confirmation.externalProcessesStopped === true, 400, "offline_required", "Stop external readers/writers and confirm before offline compaction")
    operation = "dream." + body.mode
  } else if (this.sourceOperation && ["ingestions", "absorptions", "maintenance"].indexOf(route) >= 0) {
    var spec = this.sourceOperation(w, route, body); operation = spec.operation; params = spec.params
  } else WikiStudio.fail(501, "operation_unavailable", "This operation has no safe adapter in this build")
  if (operation !== "graph.build" && params.semantic || operation === "dream.reorg") WikiStudio.assert(String(getEnv("OAF_MODEL") || "").length > 0, 422, "model_required", "Configure OAF_MODEL in the trusted server environment for this operation")
  // Reject a new submission while a synchronous Studio page mutation holds the
  // same lock. Queued jobs then block subsequent page reads/writes.
  return WikiStudio.wikiLock(this.config.home, w.id, function() { self.registry.verify(w); return WikiStudioJobs.publicJob(jobs.submit(w, operation, params, req.headers["idempotency-key"], role)) })
}
WikiStudio.diffManifests = function(before, after) {
  var changes = [], deleted = [], created = []
  Object.keys(before).sort().forEach(function(p) { if (!after[p]) { deleted.push(p); changes.push({path:p,kind:"deleted",before:before[p].hash}) } else if (before[p].hash !== after[p].hash) changes.push({path:p,kind:"modified",before:before[p].hash,after:after[p].hash}) })
  Object.keys(after).sort().forEach(function(p) { if (!before[p]) { created.push(p); changes.push({path:p,kind:"created",after:after[p].hash}) } })
  var moves = []
  deleted.forEach(function(p) { created.forEach(function(q) { if (before[p].hash === after[q].hash) moves.push({from:p,to:q,kind:"equal-hash-move-candidate"}) }) })
  return { changedPageCount: changes.length, changes: changes.slice(0,500), moveCandidates: moves.slice(0,100), truncated: changes.length > 500 }
}
var wikiStudioRunWorker = function(config, id) {
  var jobs = new WikiStudioJobs(config), registry = new WikiStudioRegistry(config), j = jobs.get(id), started = false
  // Internal entrypoint is one-shot: completed/interrupted jobs are never replayed.
  if (j.status !== "acquiring-lock") return
  function phase(name, message) { jobs.update(id, { status: name === "running" ? "running" : name, phase: name }); jobs.event(id, name, message) }
  try {
    WikiStudio.wikiLock(config.home, j.wikiId, function() {
      var w = registry.verify(registry.get(j.wikiId)); WikiStudio.authorize(j.role, "admin", j.operation === "wiki.export" ? __ : w)
      WikiStudio.assert(w.root === j.root && w.identity === j.rootIdentity, 409, "root_changed", "Job root identity no longer matches registry")
      if (jobs.get(id).cancelRequested) { jobs.update(id, {status:"cancelled",phase:"cancelled"}); return }
      phase("preflight", "Checking root identity and file boundaries")
      var before = WikiStudio.scan(w.root, false), beforeState = WikiStudio.scan(w.root, true)
      WikiStudio.atomic(jobs.dir(id) + "/before.json", before)
      var operation = j.operation, params = j.params, needsBackup = /^(dream\.(apply|repair|indexes|reorg)|ingest\.resume|absorb\.(apply|resume)|backup.restore)$/.test(operation) || operation === "dream.auto" && !params.dryrun || operation === "ingest.run" && !params.dryrun
      if(!/^(ingest\.(recovery|resume|discard)|absorb\.(status|show|resume)|backup\.)/.test(operation)) WikiStudio.assert(WikiStudio.pending(w.root).length===0,423,"recovery_pending","Pending engine journal must be reviewed/resumed before a new operation")
      var backup
      if (needsBackup) {
        WikiStudio.assert(isFunction(WikiStudio.snapshot), 501, "backup_unavailable", "Verified snapshots are required before this operation")
        phase("backup", "Creating and verifying a full pre-operation snapshot")
        backup = WikiStudio.snapshot(config, w, id); jobs.update(id, { backupId: backup.id })
      }
      // No mid-engine kill: cancellation after this checkpoint may finish with
      // writes. The final status always reflects the real result.
      if (jobs.get(id).cancelRequested) { jobs.update(id,{status:"cancelled",phase:"cancelled"}); return }
      phase("running", "Executing the existing Mini-A engine; semantic extraction " + (params.extraction === "semantic" || params.semantic ? "enabled" : "disabled")); started = true
      var result = wikiStudioExecute(config, w, j, function(msg) { jobs.event(id, "running", msg) }, backup)
      if (/^wiki\.(folder|selection)/.test(operation)) { var updated = jobs.get(id); if (updated.backupId) backup = WikiStudio.json(WikiStudio.backupPath(config,w,updated.backupId) + "/manifest.json") }
      phase("refreshing", "Closing engine readers and comparing Markdown manifests")
      registry.verify(w)
      var after = WikiStudio.scan(w.root, false), diff = WikiStudio.diffManifests(before, after)
      if(isFunction(WikiStudio.contentDiffs)) diff=WikiStudio.contentDiffs(config,w,backup,diff)
      WikiStudio.atomic(jobs.dir(id) + "/after.json", after); WikiStudio.atomic(jobs.dir(id) + "/changes.json", diff)
      if (operation === "dream.plan") WikiStudio.assert(WikiStudio.fingerprint(beforeState) === WikiStudio.fingerprint(WikiStudio.scan(w.root,true)), 500, "plan_mutated", "Maintenance preview unexpectedly changed wiki files")
      result = MiniAWikiOps.sanitize(result || {ok:false}, {model:String(getEnv("OAF_MODEL")||""),modeldec:String(getEnv("OAF_LC_MODEL")||"")})
      var outcomes = [result].concat(isMap(result.result) ? [result.result] : [])
      var cancelled = outcomes.some(function(r) { return r.status === "cancelled" || r.cancelled === true })
      var failed = outcomes.some(function(r) { return r.ok === false || r.status === "failed" })
      var partial = outcomes.some(function(r) { return r.partial === true || ["partial", "blocked"].indexOf(r.status) >= 0 || r.sync_complete === false && !params.dryrun })
      var status = cancelled ? "cancelled" : failed ? (/^wiki\.(folder|selection)/.test(operation) && result.recovery_pending === false ? "failed" : "recovery-required") : partial ? "partial" : "completed"
      var serialized = JSON.stringify(result)
      if (serialized.length > 1048576) {
        var summary = {warning:"Engine result exceeded retention limit; inspect local engine artifacts", truncated:true, terminalStatus:status}
        ;["ok", "status", "partial", "sync_complete", "recovery_pending", "cancelled", "outcome"].forEach(function(key) { if (isDef(result[key])) summary[key] = result[key] })
        if (isMap(result.result)) {
          summary.result = {}
          ;["ok", "status", "partial", "sync_complete", "recovery_pending", "cancelled", "outcome"].forEach(function(key) { if (isDef(result.result[key])) summary.result[key] = result.result[key] })
        }
        result = summary
      }
      WikiStudio.atomic(jobs.dir(id) + "/result.json", result)
      jobs.update(id, {status:status,phase:status,completedAt:WikiStudio.now(),changedPageCount:diff.changedPageCount}); jobs.event(id,status,"Finished with " + diff.changedPageCount + " changed Markdown paths")
    })
  } catch(e) {
    jobs.update(id, {status: started ? "recovery-required" : "failed",phase:"failed",completedAt:WikiStudio.now(),error: e.code || "engine_error",warning: e.status ? WikiStudio.redact(e.message) : "Worker failed. Inspect engine recovery; partial writes may remain."})
    jobs.event(id,"failed",e.status ? e.message : "Engine failed; inspect recovery artifacts", "error")
  }
}
var wikiStudioExecute = function(config, w, job, logFn, backup) {
  var p = job.params, operation = job.operation
  var a = { wikiroot: w.root, wikiaccess: "rw", wikiretrievalv2: true, usewikigraph: w.graph.enabled, wikigraphsemantic: isDef(p.semantic) ? p.semantic === true : __, dreammaxsteps: p.dreammaxsteps || 40 }
  Object.keys(p.tuning || {}).forEach(function(key) { a[key] = p.tuning[key] })
  // A writable manager may bootstrap an empty registered directory even for a
  // preview. Plan must open a reader and must never bootstrap Markdown/state.
  if (operation === "dream.plan" || operation === "dream.auto" && p.dryrun) a.wikiaccess = "ro"
  if (operation === "dream.reorg") { a.dreamwikireorg = true; a.dreamwikiapproval = "auto" }
  var params = operation === "graph.build" ? clone(p) : operation.indexOf("dream.") === 0 ? {dryrun:p.dryrun === true} : {}
  if (operation === "graph.build") delete params.compact
  if (operation === "dream.reorg") { params.instructions = p.instructions; params.organize = p.organize }
  if (operation === "wiki.folderMove" || operation === "wiki.folderDelete") {
    var wm = new MiniAWikiManager({root:w.root,backend:"fs",access:"rw",skipBootstrap:true,usegraph:w.graph.enabled,wikiretrievalv2:w.retrieval.v2 !== false})
    try {
      var folderOptions = {expectedRevision:p.expectedRevision,confirmation:p.confirmation,onProgress:logFn,snapshot:function() {
        var info = WikiStudio.snapshot(config,w,job.id)
        new WikiStudioJobs(config).update(job.id,{backupId:info.id})
        return info
      }}
      return operation === "wiki.folderMove" ? wm.moveFolder(p.from,p.to,folderOptions) : wm.deleteFolder(p.from,folderOptions)
    } finally { wm.close() }
  }
  if (operation === "wiki.selectionMove" || operation === "wiki.selectionDelete") {
    var sm = new MiniAWikiManager({root:w.root,backend:"fs",access:"rw",skipBootstrap:true,usegraph:w.graph.enabled,wikiretrievalv2:w.retrieval.v2 !== false})
    try {
      var selectionOptions = {expectedRevision:p.expectedRevision,confirmation:p.confirmation,onProgress:logFn,snapshot:function() {
        var info = WikiStudio.snapshot(config,w,job.id)
        new WikiStudioJobs(config).update(job.id,{backupId:info.id})
        return info
      }}
      return operation === "wiki.selectionMove" ? sm.moveSelection(p.items,p.to,selectionOptions) : sm.deleteSelection(p.items,selectionOptions)
    } finally { sm.close() }
  }
  if (isFunction(WikiStudio.executeSource) && /^(ingest|absorb|backup|wiki)\./.test(operation)) return WikiStudio.executeSource(config,w,job,logFn,backup)
  WikiStudio.assert(operation === "graph.build" || /^dream\.(plan|apply|repair|reindex|graph|indexes|auto|reorg)$/.test(operation), 400, "invalid_operation", "Worker operation is not allowlisted")
  var runner = new MiniAWikiOps(a,logFn)
  if (operation === "graph.build") {
    var jobs = new WikiStudioJobs(config)
    runner.isCancelled = function() { return jobs.get(job.id).cancelRequested === true }
    runner.onGraphProgress = function(progress) { jobs.update(job.id, { progress: progress }); logFn(af.toSLON(progress)) }
  }
  var result = runner.execute(runner.spec(operation,params), {confirm:true,backupconfirmed:!!backup})
  if (result.ok !== false && p.compact && operation !== "dream.plan" && !p.dryrun) {
    var compact = runner.execute(runner.spec("wiki.compact",{dryRun:false,offline:true}),{confirm:true})
    result.compaction = compact; if (compact.ok === false) result.ok = false
  }
  return result
}
