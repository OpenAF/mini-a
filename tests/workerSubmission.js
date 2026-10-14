(function() {
  load("mini-a-subtask.js")
  ow.loadServer()
  var spec = io.readFileYAML("mini-a-worker.yaml")
  var init = spec.jobs.filter(function(job) { return job.name === "Init" })[0].exec
  var helpers = init.substring(init.indexOf("global.__worker_getAgentCard ="), init.indexOf("global.__worker_taskManager ="))
  var route = function(path) {
    var entry = spec.todo.filter(function(item) { return isMap(item) && item["((uri       ))"] === path })[0]
    if (!entry) throw new Error("Missing worker route " + path)
    var code = function(name) {
      var key = Object.keys(entry).filter(function(key) { return key.replace(/[()\s]/g, "") === name })[0]
      return key ? entry[key] : ""
    }
    if (!code("execURI")) throw new Error("Missing worker handler " + path)
    return new Function("request", code("execPre") + "\n" + code("execURI"))
  }
  var fixture = function(fn) {
    var saved = {}, manager = new SubtaskManager({}, { maxConcurrent: 1 }), executions = 0
    Object.keys(global).filter(function(key) { return key.indexOf("__worker_") === 0 }).forEach(function(key) { saved[key] = global[key] })
    manager._startWatchdog = function() {}
    manager._startLocalSubtask = function(task) { executions++; manager._completeSubtask(task, "fixture", "done", {}, {}); manager._processQueue() }
    global.__worker_args = { apitoken: "receipt-fixture-token", defaulttimeout: 300000, maxtimeout: 600000, taskretention: 1 }
    global.__worker_ipallow = []
    global.__worker_instanceId = genUUID()
    global.__worker_submissionLock = "worker_receipt_test_" + genUUID()
    global.__worker_submissions = Object.create(null)
    global.__worker_tasks = {}
    global.__worker_taskManager = manager
    global.__worker_subtaskToTaskId = {}
    global.__worker_subtaskShortToTaskId = {}
    global.__worker_logTaskEvent = function() {}
    global.__worker_getSkills = function() { return [] }
    new Function(helpers)()
    try { fn({ manager: manager, executions: function() { return executions }, payload: function() {
      return { goal: "fixture", submissionId: genUUID(), workerInstanceId: global.__worker_instanceId, args: {} }
    } }) }
    finally {
      manager.destroy()
      Object.keys(global).filter(function(key) { return key.indexOf("__worker_") === 0 }).forEach(function(key) { delete global[key] })
      Object.keys(saved).forEach(function(key) { global[key] = saved[key] })
    }
  }

  exports.testWorkerReceiptsAndUnpolledCleanup = function() {
    fixture(function(f) {
      var payload = f.payload()
      payload.args = { maxsteps: 2, raw: true }
      payload.args._skillHandoff = [{ ref: "local:report", revision: "v1", args: "customer-42", required: true }]
      var first = global.__worker_submitTask(payload, global.__worker_args)
      var reordered = clone(payload)
      reordered.args = { raw: true, _skillHandoff: payload.args._skillHandoff, maxsteps: 2 }
      var duplicate = global.__worker_submitTask(reordered, global.__worker_args)
      ow.test.assert(duplicate.taskId, first.taskId, "Duplicate requests return the same task")
      ow.test.assert(f.executions(), 1, "Exactly one execution")
      ow.test.assert(global.__worker_tasks[first.taskId].args._skillHandoff[0].args, "customer-42", "Remote handoff preserves invocation arguments")
      var changed = clone(payload); changed.goal = "different"
      ow.test.assert(global.__worker_submitTask(changed, global.__worker_args).code, 409, "Payload conflicts are rejected")
      changed = clone(payload); changed.workerInstanceId = "previous-worker"
      ow.test.assert(global.__worker_submitTask(changed, global.__worker_args).code, 409, "Stale worker identity is rejected")
      var lookup = { submissionId: payload.submissionId, workerInstanceId: payload.workerInstanceId }
      ow.test.assert(global.__worker_submissionStatus(lookup).body.taskId, first.taskId, "Receipt lookup recovers accepted task")
      ow.test.assert(global.__worker_submissionStatus({ submissionId: "__proto__", workerInstanceId: payload.workerInstanceId }).code, 404, "Prototype-like IDs cannot collide with object properties")
      // Simulate a disconnected client: wrapper state never observed completion.
      var task = global.__worker_tasks[first.taskId], completedAt = f.manager.status(task.subtaskId).completedAt
      task.status = "running"; task.completedAt = __
      global.__worker_cleanupTasks(completedAt + 1001)
      ow.test.assert(Object.keys(global.__worker_tasks).length, 0, "Unpolled finished tasks expire")
      ow.test.assert(Object.keys(f.manager.subtasks).length, 0, "Authoritative manager entry expires too")
      ow.test.assert(Object.keys(global.__worker_subtaskToTaskId).length, 0, "Task indexes expire")
      ow.test.assert(global.__worker_submissionStatus(lookup).code, 404, "Receipts expire with tasks")
      global.__worker_instanceId = genUUID()
      ow.test.assert(global.__worker_submissionStatus(lookup).code, 409, "Restart cannot authorize replay")
    })
  }

  exports.testWorkerConcurrentDuplicateSubmissions = function() {
    fixture(function(f) {
      var payload = f.payload()
      var responses = pForEach([1, 2, 3, 4, 5, 6], function() { return global.__worker_submitTask(clone(payload), global.__worker_args) })
      ow.test.assert(responses.every(function(result) { return isString(result.taskId) && result.taskId === responses[0].taskId }), true, "Concurrent admissions share one receipt")
      ow.test.assert(f.executions(), 1, "Concurrent duplicates execute exactly once")
      var rejected = f.payload(); rejected.goal = ""
      ow.test.assert(global.__worker_submitTask(rejected, global.__worker_args).code, 400, "Admission validation remains intact")
      ow.test.assert(global.__worker_submitTask(rejected, global.__worker_args).code, 400, "Rejected admission is not retried")
      global.__worker_cleanupTasks(Date.now() + 1001)
      ow.test.assert(Object.keys(global.__worker_submissions).length, 0, "Rejected receipts also expire")
    })
  }

  exports.testRemoteSubmissionRecoveryTransport = function() {
    ;[false, true].forEach(function(useA2A) {
      ;["lost-response", "restart", "cancel", "missing", "legacy"].forEach(function(scenario) {
        fixture(function(f) {
          var server = ow.server.httpd.start(__, "127.0.0.1"), parent = new SubtaskManager({}, {})
          var submitPath = useA2A ? "/message:send" : "/task", submissions = 0, lookups = 0, cancellations = 0, admission
          var submit = route(submitPath), lookup = route("/submission/status")
          var routes = {}
          routes[submitPath] = function(request) {
            submissions++
            if (scenario !== "missing") {
              admission = submit(request)
            }
            if (scenario === "restart") global.__worker_instanceId = genUUID()
            if (scenario === "cancel") parent.cancel(parentId, "fixture cancelled")
            return ow.server.httpd.reply(stringify({ error: "Lost admission response" }), 500, ow.server.httpd.mimes.JSON)
          }
          routes["/submission/status"] = function(request) { lookups++; return lookup(request) }
          ;["/info", "/.well-known/agent.json"].forEach(function(path) { routes[path] = route(path) })
          ;["/status", "/tasks", "/result"].forEach(function(path) { routes[path] = route(path) })
          ;["/cancel", "/tasks:cancel"].forEach(function(path) {
            var cancel = route(path)
            routes[path] = function(request) { cancellations++; return cancel(request) }
          })
          ow.server.httpd.route(server, routes)
          var url = "http://127.0.0.1:" + server.getPort()
          global.__worker_args.onport = server.getPort()
          parent.parentArgs = { apitoken: "receipt-fixture-token" }
          parent.remoteDelegation = true
          parent.useA2A = useA2A
          parent.remotePollIntervalMs = 1
          parent._startWatchdog = function() {}
          parent._nextWorkerForSubtask = function() { return url }
          var card = parent._remoteGet(url, "/.well-known/agent.json")
          ow.test.assert(card.workerInstanceId, global.__worker_instanceId, "AgentCard endpoint works before worker registration initializes networking")
          ow.test.assert(parent._fetchWorkerProfile(url, card).workerInstanceId, global.__worker_instanceId, "Inline registration carries the worker identity")
          parent._workerProfiles[url] = parent._fetchWorkerProfile(url)
          ow.test.assert(parent._workerProfiles[url].workerInstanceId, global.__worker_instanceId, "HTTP discovery carries the worker process identity")
          ow.test.assert(parent._workerProfiles[url].capabilities.indexOf("submission-recovery-v1") >= 0, true, "HTTP discovery negotiates recovery")
          if (scenario === "legacy") parent._workerProfiles[url].capabilities = []
          var parentId = parent.submit("fixture", {}, { maxAttempts: 2 })
          try {
            parent.start(parentId)
            $doWait(parent.subtasks[parentId]._executionPromise)
            var task = parent.subtasks[parentId]
            ow.test.assert(submissions, 1, "Lost response never replays submission (" + scenario + ", A2A=" + useA2A + ")")
            ow.test.assert(f.executions(), scenario === "missing" ? 0 : 1, "Exactly one worker execution at most (" + scenario + ", A2A=" + useA2A + ", admission=" + stringify(admission) + ", error=" + task.error + ")")
            ow.test.assert(task.status, scenario === "lost-response" ? "completed" : scenario === "cancel" ? "cancelled" : "failed", "Recovery preserves outcome and cancellation")
            ow.test.assert(parent.metrics.retried, 0, "Ambiguity never queues execution retries")
            if (scenario === "lost-response" || scenario === "cancel") {
              ow.test.assert(parent.metrics.remoteSubmissionRecoveries, 1, "Receipt recovery is counted")
              ow.test.assert(lookups >= 1 && lookups <= 3, true, "Receipt recovery remains within three lookups (" + scenario + ")")
              if (scenario === "cancel") ow.test.assert(cancellations, 1, "Late recovered task is cancelled")
            } else {
              ow.test.assert(lookups, scenario === "legacy" ? 0 : 3, "Only negotiated workers use bounded lookup")
              ow.test.assert(task.error.indexOf("Remote outcome unknown") >= 0, true, "Unavailable receipt remains explicitly unknown")
            }
            parent.parentArgs.apitoken = "wrong"
            var denied = false
            try { parent._remoteRequest(url, "/submission/status", { submissionId: "fixture", workerInstanceId: global.__worker_instanceId }) } catch(e) { denied = true }
            ow.test.assert(denied, true, "Receipt lookup uses worker authentication")
          } finally { parent.destroy(); ow.server.httpd.stop(server) }
        })
      })
    })
  }
})()
