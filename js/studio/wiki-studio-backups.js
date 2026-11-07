// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
WikiStudio.hex = function(bytes) { var out = ""; for (var i = 0; i < bytes.length; i++) out += ("0" + (Number(bytes[i]) & 255).toString(16)).slice(-2); return out }
WikiStudio.backupPath = function(config, w, id) {
  WikiStudio.assert(/^[a-f0-9-]{36}$/.test(id), 400, "invalid_backup", "Invalid backup ID")
  return config.home + "/backups/" + w.id + "/" + id
}
WikiStudio.checkBackup = function(config, w, id, destination) {
  var dir = WikiStudio.backupPath(config,w,id), info = WikiStudio.json(dir + "/manifest.json")
  WikiStudio.assert(info && info.wikiId === w.id && info.id === id, 409, "foreign_backup", "Backup does not belong to this wiki")
  var archive = dir + "/snapshot.zip"; WikiStudio.noLinks(archive)
  WikiStudio.assert(new java.io.File(archive).isFile() && new java.io.File(archive).length() === info.size, 409, "corrupt_backup", "Backup archive is missing or changed")
  // Archive hash is streamed, including before restore. Never trust only a ZIP CRC.
  var input = new java.io.FileInputStream(archive), md = java.security.MessageDigest.getInstance("SHA-256"), buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,8192), n
  try { while ((n=input.read(buf)) !== -1) md.update(buf,0,n) } finally { input.close() }
  WikiStudio.assert(WikiStudio.hex(md.digest()) === info.archiveChecksum, 409, "corrupt_backup", "Backup archive checksum mismatch")
  var zip = new java.util.zip.ZipFile(archive), en = zip.entries(), seen = {}, total = 0
  try {
    while (en.hasMoreElements()) {
      var entry = en.nextElement(), name = String(entry.getName()).replace(/\/$/, "")
      WikiStudio.assert(name.length > 0 && name.length <= 1024 && !/[\\:\x00-\x1f]/.test(name) && name.split("/").every(function(p) { return p && p !== "." && p !== ".." }), 400, "unsafe_backup", "Unsafe backup member")
      WikiStudio.assert(!seen[name.toLowerCase()], 409, "unsafe_backup", "Duplicate backup member"); seen[name.toLowerCase()] = true
      var target = destination ? destination + "/" + name : null
      if (target) { WikiStudio.noLinks(target); WikiStudio.assert(WikiStudio.inside(WikiStudio.canonical(target),destination),400,"unsafe_backup","Backup path escapes restore staging") }
      if (entry.isDirectory()) { if (target) WikiStudio.privateDir(target); continue }
      var expected = info.files[name]
      WikiStudio.assert(expected && Number(entry.getSize()) === expected.size && expected.size <= 16777216,409,"corrupt_backup","Unexpected or oversized backup member")
      var source = zip.getInputStream(entry), digest = java.security.MessageDigest.getInstance("SHA-256"), written = 0, out
      if (target) { WikiStudio.privateDir(String(new java.io.File(target).getParent())); out = new java.io.FileOutputStream(target) }
      try {
        while ((n=source.read(buf)) !== -1) { written += n; total += n; WikiStudio.assert(written <= expected.size && total <= 536870912,413,"backup_limit","Backup expansion limit exceeded"); digest.update(buf,0,n); if (out) out.write(buf,0,n) }
        if(out) out.getFD().sync()
      } finally { source.close(); if(out) out.close() }
      WikiStudio.assert(written === expected.size && WikiStudio.hex(digest.digest()) === expected.hash,409,"corrupt_backup","Backup member content mismatch")
    }
    WikiStudio.assert(Object.keys(info.files).every(function(p) { return seen[p.toLowerCase()] }),409,"corrupt_backup","Backup members are missing")
  } finally { zip.close() }
  return info
}
WikiStudio.snapshot = function(config,w,jobId) {
  var files = WikiStudio.scan(w.root,true), id = WikiStudio.id(), dir = WikiStudio.backupPath(config,w,id)
  WikiStudio.privateDir(dir)
  // Reuse Mini-A's full-wiki ZIP implementation, including hidden engine state.
  loadLib(config.base + "/utils/wikiJobsLib.js", true)
  var original = wikiJobsBackup(w.root,function(){}), archive = dir + "/snapshot.zip"
  try {
    java.nio.file.Files.copy(WikiStudio.path(original),WikiStudio.path(archive))
    var sync = new java.io.RandomAccessFile(archive,"rw"); sync.getFD().sync(); sync.close()
    var stream = new java.io.FileInputStream(archive), digest = java.security.MessageDigest.getInstance("SHA-256"), b = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,8192), n
    try { while((n=stream.read(b)) !== -1) digest.update(b,0,n) } finally { stream.close() }
    var info = {version:1,id:id,wikiId:w.id,createdAt:WikiStudio.now(),sourceJob:jobId,rootIdentity:w.identity,beforeFingerprint:WikiStudio.fingerprint(files),archiveChecksum:WikiStudio.hex(digest.digest()),size:Number(new java.io.File(archive).length()),files:files,verified:false,origin: jobsOrigin(config,jobId)}
    WikiStudio.atomic(dir + "/manifest.json",info)
    WikiStudio.checkBackup(config,w,id)
    WikiStudio.assert(WikiStudio.fingerprint(WikiStudio.scan(w.root,true)) === info.beforeFingerprint,409,"external_change","Wiki changed during backup; stop external writers")
    info.verified=true; WikiStudio.atomic(dir + "/manifest.json",info)
    new java.io.File(original).delete(); return info
  } catch(e) { // Keep the original archive for local recovery if adoption failed.
    throw e
  }
}
WikiStudio.restore = function(config,w,job,preRestore) {
  var p = job.params, current = WikiStudio.fingerprint(WikiStudio.scan(w.root,true))
  WikiStudio.assert(p.expectedFingerprint === current && p.confirmation === p.backupId + ":" + current,409,"restore_conflict","Wiki changed since restore confirmation")
  WikiStudio.assert(preRestore && preRestore.verified,409,"backup_required","Pre-restore backup required")
  var parent = String(new java.io.File(w.root).getParent()), staged = parent + "/.studio-restore-" + job.id, replaced = parent + "/.studio-replaced-" + job.id, journal = config.home + "/jobs/" + job.id + "/restore.json"
  WikiStudio.assert(!io.fileExists(staged) && !io.fileExists(replaced),409,"restore_pending","Restore staging already exists; inspect local recovery")
  WikiStudio.privateDir(staged)
  try {
    WikiStudio.checkBackup(config,w,p.backupId,staged)
    var info = WikiStudio.json(WikiStudio.backupPath(config,w,p.backupId) + "/manifest.json")
    WikiStudio.assert(WikiStudio.fingerprint(WikiStudio.scan(staged,true)) === info.beforeFingerprint,409,"corrupt_backup","Restored staging validation failed")
    new WikiStudioRegistry(config).verify(w)
    WikiStudio.assert(WikiStudio.fingerprint(WikiStudio.scan(w.root,true)) === current,409,"restore_conflict","Wiki changed during restore preflight")
    WikiStudio.atomic(journal,{phase:"prepared",wikiId:w.id,staged:staged,replaced:replaced,backupId:p.backupId})
    java.nio.file.Files.move(WikiStudio.path(w.root),WikiStudio.path(replaced),java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    try { java.nio.file.Files.move(WikiStudio.path(staged),WikiStudio.path(w.root),java.nio.file.StandardCopyOption.ATOMIC_MOVE) }
    catch(e) { java.nio.file.Files.move(WikiStudio.path(replaced),WikiStudio.path(w.root),java.nio.file.StandardCopyOption.ATOMIC_MOVE); throw e }
    // The directory swap intentionally changes inode; update only after validation.
    w.identity = WikiStudio.identity(w.root)
    var registry = new WikiStudioRegistry(config)
    WikiStudio.lock(config.home,"registry",function(){var all=registry.list().map(function(x){return x.id===w.id?w:x});WikiStudio.atomic(registry.path,{version:1,wikis:all})})
    WikiStudio.atomic(journal,{phase:"completed",wikiId:w.id,replaced:replaced,backupId:p.backupId,preRestoreBackupId:preRestore.id})
    return {ok:true,backupId:p.backupId,preRestoreBackupId:preRestore.id,replacedStateRetained:true,warning:"Replaced directory retained as local recovery state. Reopen readers; check graph/search health before use."}
  } finally { if(io.fileExists(staged)) io.rm(staged) }
}
WikiStudio.contentDiffs = function(config,w,backup,diff) {
  if(!backup) { diff.contentDiffWarning="No before-content snapshot was captured for this operation; only path/hash comparisons are available";return diff }
  var zip=new java.util.zip.ZipFile(WikiStudio.backupPath(config,w,backup.id)+"/snapshot.zip"), budget=524288
  try {
    diff.changes.forEach(function(change){
      if(budget<=0){change.diffTruncated=true;return}
      var entry=zip.getEntry(change.path),old="",after="",file=w.root+"/"+change.path
      if(entry) {
        if(entry.getSize()>32768){change.diffTruncated=true;return}
        var input=zip.getInputStream(entry),out=new java.io.ByteArrayOutputStream(),buf=java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,8192),n
        try{while((n=input.read(buf))!==-1)out.write(buf,0,n);old=String(out.toString("UTF-8"))}finally{input.close()}
      }
      if(io.fileExists(file)) {WikiStudio.noLinks(file);if(new java.io.File(file).length()>32768){change.diffTruncated=true;return}after=io.readFileString(file)}
      var a=old.split("\n"),b=after.split("\n"),text="--- before/"+change.path+"\n+++ after/"+change.path+"\n@@ -1,"+a.length+" +1,"+b.length+" @@\n"+a.map(function(l){return "-"+l}).concat(b.map(function(l){return "+"+l})).join("\n")
      change.unifiedDiff=text.substring(0,Math.min(16384,budget));change.diffTruncated=change.unifiedDiff.length<text.length;budget-=change.unifiedDiff.length
    })
  } finally{zip.close()}
  return diff
}
WikiStudioServer.prototype.backupRoute = function(req,w,parts,role) {
  var route=parts.join("/"),c=this.config,jobs=this.jobs||new WikiStudioJobs(c),body=req.body||{},q=req.query||{},self=this
  if(route==="backups" && req.method==="GET") {
    var dir=c.home+"/backups/"+w.id; WikiStudio.privateDir(dir)
    var items=io.listFiles(dir).files.filter(function(f){return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename)}).map(function(f){var info=WikiStudio.json(f.filepath+"/manifest.json");var out=JSON.parse(JSON.stringify(info));delete out.files;delete out.rootIdentity;out.origin=out.origin||jobsOrigin(c,out.sourceJob);out.deletion=WikiStudio.backupDeletion(c,w,out,jobs);return out})
    return WikiStudioServer.paginate(items.sort(function(a,b){return b.createdAt.localeCompare(a.createdAt)}),q)
  }
  if(route==="changes" && req.method==="GET") {
    var j=jobs.get(q.jobId); WikiStudio.assert(j.wikiId===w.id,404,"job_not_found","Job does not belong to this wiki")
    return WikiStudio.json(jobs.dir(j.id)+"/changes.json",{changes:[],warning:"No finalized comparison is available"})
  }
  WikiStudio.authorize(role,"admin",w)
  if (parts.length === 2 && req.method === "DELETE") {
    WikiStudio.fields(body,["confirmation","acknowledgeLast"])
    WikiStudio.assert(body.confirmation === parts[1],400,"confirmation_required","Confirm the snapshot ID")
    return WikiStudio.wikiLock(c.home,w.id,function() {
      self.registry.verify(w)
      return WikiStudio.lock(c.home,"queue",function() {
        var dir = WikiStudio.backupPath(c,w,parts[1]), info = WikiStudio.json(dir+"/manifest.json")
        WikiStudio.assert(info && info.wikiId === w.id && info.id === parts[1],404,"backup_not_found","Snapshot not found")
        var eligibility = WikiStudio.backupDeletion(c,w,info,jobs)
        WikiStudio.assert(eligibility.allowed,409,"backup_protected",eligibility.reason)
        var verified = io.listFiles(c.home+"/backups/"+w.id).files.filter(function(f) { return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename) }).map(function(f) { return WikiStudio.json(f.filepath+"/manifest.json",{}) }).filter(function(b) { return b.verified })
        WikiStudio.assert(!info.verified || verified.length > 1 || body.acknowledgeLast === true,409,"last_backup","Confirm deletion of the last verified snapshot")
        WikiStudio.noLinks(dir); io.listFiles(dir).files.forEach(function(f) { WikiStudio.noLinks(f.filepath); WikiStudio.assert(f.isFile,400,"unsafe_backup","Unexpected snapshot directory") })
        var trash = c.home+"/deleted-history/backup-"+info.id
        WikiStudio.privateDir(c.home+"/deleted-history");WikiStudio.noLinks(trash)
        java.nio.file.Files.move(WikiStudio.path(dir),WikiStudio.path(trash),java.nio.file.StandardCopyOption.ATOMIC_MOVE)
        io.rm(trash)
        return {deleted:info.id}
      })
    })
  }
  WikiStudio.assert(req.method==="POST",405,"method_not_allowed","Use POST")
  var op,params
  if(route==="backups") { WikiStudio.fields(body,[]);op="backup.snapshot";params={} }
  else if(parts.length===3 && parts[2]==="restore") {
    WikiStudio.fields(body,["expectedFingerprint","confirmation","externalProcessesStopped"])
    WikiStudio.checkBackup(c,w,parts[1])
    WikiStudio.assert(body.externalProcessesStopped===true,400,"offline_required","Stop external readers/writers before restore")
    params={backupId:parts[1],expectedFingerprint:body.expectedFingerprint,confirmation:body.confirmation}
    WikiStudio.assert(isString(body.expectedFingerprint) && body.confirmation===parts[1]+":"+body.expectedFingerprint,400,"confirmation_required","Restore confirmation must bind backup ID and current wiki fingerprint")
    op="backup.restore"
  } else WikiStudio.fail(404,"not_found","Backup route not found")
  return WikiStudio.wikiLock(c.home,w.id,function(){ self.registry.verify(w);return WikiStudioJobs.publicJob(jobs.submit(w,op,params,req.headers["idempotency-key"],role)) })
}

function jobsOrigin(config, jobId) {
  var j = /^[a-f0-9-]{36}$/.test(jobId) ? WikiStudio.json(config.home + "/jobs/" + jobId + "/job.json") : null
  return j && j.operation === "backup.snapshot" ? "manual" : "automatic"
}
WikiStudio.backupDeletion = function(config, w, backup, jobs) {
  var reason = "", inventory = jobs.list()
  if (WikiStudio.pending(w.root).length) reason = "Resolve pending wiki recovery before deleting snapshots"
  inventory.filter(function(j) { return j.wikiId === w.id }).forEach(function(j) {
    if (WikiStudioJobs.terminal.indexOf(j.status) < 0) reason = "Wait for active wiki jobs before deleting snapshots"
    if ((j.backupId === backup.id || (j.params || {}).backupId === backup.id || backup.sourceJob === j.id) && ["partial","interrupted","recovery-required"].indexOf(j.status) >= 0 && !j.recoveryReviewedAt) reason = "Snapshot is needed by unresolved recovery"
  })
  return { allowed: !reason, reason: reason }
}

// ── Wiki ZIP exports (pages + portable index for other Mini-A instances) ─────
// Files live under <home>/exports/<wikiId>/<jobId>/ and are delivered by the
// authenticated streaming download route; the most recent few are retained.
WikiStudio.exportKeep = 5
WikiStudio.exportDir = function(config, wikiId, id) {
  WikiStudio.assert(/^[a-f0-9-]{36}$/.test(id), 400, "invalid_export", "Invalid export ID")
  return config.home + "/exports/" + wikiId + "/" + id
}
WikiStudio.exportWiki = function(config, w, job, logFn) {
  var dir = WikiStudio.exportDir(config, w.id, job.id), output = dir + "/export.zip"
  WikiStudio.privateDir(config.home + "/exports"); WikiStudio.privateDir(config.home + "/exports/" + w.id); WikiStudio.privateDir(dir)
  var runner = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "ro", usewikigraph: w.graph.enabled, wikiretrievalv2: true }, logFn)
  var result = runner.execute(runner.spec("wiki.export", { output: output, nobundle: (job.params || {}).nobundle === true }), {})
  if (!result || result.ok === false) { try { io.rm(dir) } catch(ignoreRm) {}; return result || { ok: false, error: "export failed" } }
  WikiStudio.atomic(dir + "/export.json", { version: 1, id: job.id, wikiId: w.id, createdAt: WikiStudio.now(), mode: result.mode, size: result.bytes, pages: result.pages, generation: result.generation, graph: result.graph === true })
  var all = io.listFiles(config.home + "/exports/" + w.id).files.filter(function(f) { return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename) }).map(function(f) { return WikiStudio.json(f.filepath + "/export.json") }).filter(function(x) { return x && x.id })
  all.sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt) }).slice(WikiStudio.exportKeep).forEach(function(old) { try { io.rm(WikiStudio.exportDir(config, w.id, old.id)) } catch(ignoreOld) {} })
  delete result.output; delete result.usage
  result.exportId = job.id
  return result
}
WikiStudioServer.prototype.exportRoute = function(req, w, parts, role) {
  var c = this.config, jobs = this.jobs || new WikiStudioJobs(c), body = req.body || {}, self = this
  WikiStudio.authorize(role, "admin")
  var base = c.home + "/exports/" + w.id
  if (parts.length === 1 && req.method === "GET") {
    var items = io.fileExists(base) ? io.listFiles(base).files.filter(function(f) { return f.isDirectory && /^[a-f0-9-]{36}$/.test(f.filename) }).map(function(f) { return WikiStudio.json(f.filepath + "/export.json") }).filter(function(x) { return x && x.id && x.wikiId === w.id }) : []
    return WikiStudioServer.paginate(items.sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt) }), req.query || {})
  }
  if (parts.length === 1 && req.method === "POST") {
    WikiStudio.fields(body, ["nobundle"])
    WikiStudio.assert(!isDef(body.nobundle) || isBoolean(body.nobundle), 400, "invalid_options", "nobundle must be boolean")
    return WikiStudio.wikiLock(c.home, w.id, function() { self.registry.verify(w); return WikiStudioJobs.publicJob(jobs.submit(w, "wiki.export", { nobundle: body.nobundle === true }, req.headers["idempotency-key"], role)) })
  }
  if (parts.length === 2 && req.method === "DELETE") {
    WikiStudio.fields(body, ["confirmation"])
    WikiStudio.assert(body.confirmation === parts[1], 400, "confirmation_required", "Confirm the export ID")
    var dir = WikiStudio.exportDir(c, w.id, parts[1]), info = WikiStudio.json(dir + "/export.json")
    WikiStudio.assert(info && info.wikiId === w.id && info.id === parts[1], 404, "export_not_found", "Export not found")
    WikiStudio.noLinks(dir); io.rm(dir)
    return { deleted: parts[1] }
  }
  WikiStudio.fail(405, "method_not_allowed", "Unknown export route or method")
}
// Streams one finished export. handle() has already authenticated the bearer token.
WikiStudioServer.prototype.streamExport = function(req, ex, role) {
  var m = /^\/api\/v1\/wikis\/([^/]+)\/exports\/([a-f0-9-]{36})\/download$/.exec(req.path), c = this.config
  WikiStudio.assert(m, 404, "not_found", "Route not found")
  WikiStudio.authorize(role, "admin")
  var w = this.registry.verify(this.registry.get(m[1])), dir = WikiStudio.exportDir(c, w.id, m[2]), file = dir + "/export.zip", info = WikiStudio.json(dir + "/export.json")
  WikiStudio.assert(info && info.wikiId === w.id && info.id === m[2], 404, "export_not_found", "Export not found")
  WikiStudio.noLinks(file)
  var f = new java.io.File(file)
  WikiStudio.assert(f.isFile() && Number(f.length()) === info.size, 409, "corrupt_export", "Export file is missing or changed")
  this.audit(req.requestId, role, "GET " + req.path, w.id)
  var label = String(w.name || w.id).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 60) || "wiki"
  var headers = ex.getResponseHeaders()
  headers.set("Content-Type", "application/zip"); headers.set("Content-Disposition", 'attachment; filename="' + label + "-" + String(info.createdAt).substring(0, 10) + '.zip"')
  ex.sendResponseHeaders(200, Number(f.length()))
  var input = new java.io.FileInputStream(f), out = ex.getResponseBody(), buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536), n
  try { while ((n = input.read(buf)) !== -1) out.write(buf, 0, n) } finally { input.close(); ex.close() }
}
