// Only trusted source registrations and registered wiki roots reach engine args.
WikiStudioServer.prototype.sourceOperation = function(w, route, body) {
  if (route === "ingestions") {
    if(body.action) {
      WikiStudio.fields(body,["action","recoveryId"])
      WikiStudio.assert(["recovery","resume","discard"].indexOf(body.action)>=0,400,"invalid_action","Invalid recovery action")
      if(body.action!=="recovery")WikiStudio.assert(isString(body.recoveryId)&&/^[a-zA-Z0-9_-]{1,160}$/.test(body.recoveryId),400,"invalid_recovery","Select a recovery ID")
      return {operation:"ingest."+body.action,params:body.action==="recovery"?{}:{id:body.recoveryId}}
    }
    WikiStudio.fields(body,["sourceId","revision","preview","options","confirmation"])
    var source=this.sourceGet(w,body.sourceId); WikiStudio.assert(source,404,"source_not_found","Source not found")
    WikiStudio.assert(body.revision===source.revision,409,"stale_source","Select the current immutable source revision")
    var o=body.options||{}; WikiStudio.fields(o,["mode","layout","section","include","exclude","prune","semantic","maxfiles","maxfilesize"])
    WikiStudio.assert(!isDef(body.preview)||isBoolean(body.preview),400,"invalid_options","Preview must be boolean")
    WikiStudio.assert(!isDef(o.mode)||["auto","normalize","raw","distill"].indexOf(o.mode)>=0,400,"invalid_options","Unsupported ingestion mode")
    WikiStudio.assert(!isDef(o.layout)||["source","flat"].indexOf(o.layout)>=0,400,"invalid_options","Unsupported ingestion layout")
    // Use the logical source identity instead of the private staging directory name.
    var section=o.section||source.id
    WikiStudio.pagePath(section,false)
    ;["include","exclude"].forEach(function(k){ if(isDef(o[k])) WikiStudio.assert(isString(o[k])&&o[k].length<=1000&&!/[\x00-\x1f]/.test(o[k]),400,"invalid_options","Invalid include/exclude patterns") })
    ;["prune","semantic"].forEach(function(k){if(isDef(o[k]))WikiStudio.assert(isBoolean(o[k]),400,"invalid_options","Expected boolean")})
    ;["maxfiles","maxfilesize"].forEach(function(k){if(isDef(o[k]))WikiStudio.assert(isNumber(o[k])&&o[k]>=1&&Math.floor(o[k])===o[k]&&o[k]<=(k==="maxfiles"?2000:8388608),400,"invalid_options","Limit exceeds Studio quota")})
    if(o.prune===true) WikiStudio.assert(body.confirmation&&body.confirmation.acknowledgePrune===true,400,"confirmation_required","Explicit prune confirmation required; empty-source authorization is not available")
    return {operation:"ingest.run",params:{sourceId:source.id,revision:source.revision,staging:source.staging,inventoryChecksum:source.inventoryChecksum,dryrun:body.preview!==false,mode:o.mode||"auto",layout:o.layout||"source",section:section,include:o.include||"",exclude:o.exclude||"",prune:o.prune===true,semantic:o.semantic===true,maxfiles:o.maxfiles||2000,maxfilesize:o.maxfilesize||8388608}}
  }
  if(route==="absorptions") {
    WikiStudio.fields(body,["action","sourceWikiIds","paths","tags","topic","exclude","planId","confirmation"])
    WikiStudio.assert(["plan","show","apply","status","resume","delete","cancel"].indexOf(body.action)>=0,400,"invalid_action","Unsupported absorption action")
    if(["apply","resume"].indexOf(body.action)>=0)WikiStudio.assert(body.confirmation&&body.confirmation.applySavedPlan===true,400,"confirmation_required","Confirm applying the saved plan")
    var p={sourceIdentities:{}}
    if(body.action==="plan") {
      WikiStudio.assert(isArray(body.sourceWikiIds)&&body.sourceWikiIds.length>0&&body.sourceWikiIds.length<=10,400,"invalid_sources","Select 1–10 registered source wikis")
      ;["paths","tags","exclude"].forEach(function(k){if(isDef(body[k]))WikiStudio.assert(isArray(body[k])&&body[k].length<=100&&body[k].every(function(v){return isString(v)&&v.length<=512&&!/[\x00-\x1f]/.test(v)}),400,"invalid_selector","Invalid selectors")})
      WikiStudio.assert(!isDef(body.topic)||isString(body.topic)&&body.topic.length<=1000,400,"invalid_selector","Invalid topic")
      var self=this
      p.spec={sources:body.sourceWikiIds.map(function(id){var source=self.registry.verify(self.registry.get(id));WikiStudio.assert(source.id!==w.id&&!WikiStudio.inside(source.root,w.root)&&!WikiStudio.inside(w.root,source.root),400,"source_overlap","Source and destination cannot overlap");p.sourceIdentities[source.id]={root:source.root,identity:source.identity};return {id:source.id,root:source.root,all:!body.paths&&!body.tags&&!body.topic,paths:body.paths||[],tags:body.tags||[],topic:body.topic||"",exclude:body.exclude||[]} })}
    } else if(body.action!=="status") { WikiStudio.assert(isString(body.planId)&&/^[a-zA-Z0-9_-]{1,160}$/.test(body.planId),400,"invalid_plan","Select a saved plan ID"); p.id=body.planId }
    if(["apply","resume"].indexOf(body.action)>=0) {
      var jobs=this.jobs||new WikiStudioJobs(this.config),matches=jobs.list().filter(function(j){if(j.wikiId!==w.id||j.operation!=="absorb.plan"||j.status!=="completed")return false;var result=WikiStudio.json(jobs.dir(j.id)+"/result.json",{});return result.id===p.id&&!!result.plan})
      var receipt = WikiStudio.json(jobs.planReceiptPath(w.id, p.id))
      WikiStudio.assert(matches.length > 0 || receipt && receipt.wikiId === w.id && receipt.rootIdentity === w.identity,409,"plan_not_reviewed","Apply/resume requires a completed plan generated through Studio")
      p.sourceIdentities=matches.length ? matches[0].params.sourceIdentities : receipt.sourceIdentities
    }
    return {operation:"absorb."+body.action,params:p}
  }
  if(route==="maintenance") {
    WikiStudio.fields(body,["action","externalProcessesStopped"])
    WikiStudio.assert(["reindex","indexes","compact"].indexOf(body.action)>=0,400,"invalid_action","Unsupported maintenance action")
    if(body.action==="compact")WikiStudio.assert(body.externalProcessesStopped===true,400,"offline_required","Stop external processes before compaction")
    return {operation:body.action==="indexes"?"dream.indexes":"wiki."+body.action,params:body.action==="compact"?{dryRun:false,offline:true}:{semantic:false}}
  }
  WikiStudio.fail(400,"invalid_operation","Unsupported source operation")
}
WikiStudio.executeSource = function(config,w,job,logFn,backup) {
  var op=job.operation,p=job.params
  if(op==="backup.snapshot") return {ok:true,backupId:WikiStudio.snapshot(config,w,job.id).id}
  if(op==="backup.restore") return WikiStudio.restore(config,w,job,backup)
  var a={wikiroot:w.root,wikiaccess:"rw",usewikigraph:w.graph.enabled,wikigraphsemantic:p.semantic===true,wikiretrievalv2:true},params={}
  if(op==="ingest.run") {
    WikiStudio.assert(WikiStudio.inside(p.staging,config.home+"/sources/uploads"),400,"invalid_source","Source staging leaves trusted area")
    var inventory = WikiStudio.scan(p.staging,true)
    WikiStudio.assert(WikiStudio.fingerprint(inventory)===p.inventoryChecksum,409,"source_changed","Immutable staging revision changed; upload it again")
    WikiStudio.assert(Object.keys(inventory).length<=p.maxfiles,413,"source_limit","Source exceeds selected file-count limit")
    params={source:p.staging,sourceid:w.id+"--"+p.sourceId,mode:p.mode,layout:p.layout,section:p.section,dryrun:p.dryrun,include:p.include,exclude:p.exclude,prune:p.prune,maxfilekb:p.maxfilesize/1024}
  } else if(/^ingest\.(recovery|resume|discard)$/.test(op))params=p.id?{id:p.id}:{}
  else if(op.indexOf("absorb.")===0) {
    params=p.spec?{spec:p.spec}:p.id?{id:p.id}:{}
    if(p.spec) p.spec.sources.forEach(function(source){WikiStudio.noLinks(source.root);WikiStudio.scan(source.root,true)})
  } else if(op==="wiki.reindex") params={}
  else if(op==="wiki.compact")params={dryRun:false,offline:true}
  else WikiStudio.fail(400,"invalid_operation","Source operation not allowlisted")
  var runner=new MiniAWikiOps(a,logFn),result
  function run(){return runner.execute(runner.spec(op,params),{confirm:true})}
  var ids=Object.keys(p.sourceIdentities||{}).sort(),registry=new WikiStudioRegistry(config)
  function locked(index){if(index===ids.length)return run();var id=ids[index];return WikiStudio.wikiLock(config.home,id,function(){var source=registry.verify(registry.get(id)),expected=p.sourceIdentities[id];WikiStudio.assert(source.root===expected.root&&source.identity===expected.identity,409,"source_changed","Absorption source root identity changed; replan");return locked(index+1)})}
  result=locked(0)
  if(op==="ingest.run") {
    new WikiStudioServer(config).sourceUpdateRun(w, job, result)
  }
  return result
}

WikiStudioServer.prototype.sourceUpdateRun = function(w, job, result) {
  var self = this, p = job.params
  return WikiStudio.sourceLock(this.config.home, w.id, p.sourceId, function() {
    var record = self.sourceGet(w, p.sourceId)
    if (!record || record.revision !== p.revision) return false
    record.lastRun = job.id
    record.lastStatus = result.ok === false ? "failed" : p.dryrun ? "previewed" : "ingested"
    record.lastInventoryChecksum = p.inventoryChecksum
    WikiStudio.atomic(self.sourcePath(w, p.sourceId), record)
    return true
  })
}
