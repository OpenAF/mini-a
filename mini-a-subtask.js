// Author: Nuno Aguiar
// License: Apache 2.0
// Description: SubtaskManager for Mini-A delegation - enables parent agents to spawn child agents for sub-goals

/**
 * <odoc>
 * <key>SubtaskManager</key>
 * Manages delegation of sub-goals to child Mini-A agent instances.
 * Supports concurrent execution, depth tracking, automatic retries, and deadline enforcement.
 * </odoc>
 */
var SubtaskManager = function(parentArgs, opts) {
  opts = _$(opts, "opts").isMap().default({})
  
  this.parentArgs = parentArgs || {}
  this.maxConcurrent = _$(opts.maxConcurrent, "opts.maxConcurrent").isNumber().default(4)
  this.defaultDeadlineMs = _$(opts.defaultDeadlineMs, "opts.defaultDeadlineMs").isNumber().default(300000)
  this.defaultMaxAttempts = _$(opts.defaultMaxAttempts, "opts.defaultMaxAttempts").isNumber().default(2)
  this.maxDepth = _$(opts.maxDepth, "opts.maxDepth").isNumber().default(3)
  this.interactionFn = opts.interactionFn || function() {}
  this.currentDepth = _$(opts.currentDepth, "opts.currentDepth").isNumber().default(0)
  this.workers = this._normalizeWorkers(isDef(opts.workers) ? opts.workers : this.parentArgs.workers)
  this.remoteDelegation = this.workers.length > 0
  this.remotePollIntervalMs = _$(opts.remotePollIntervalMs, "opts.remotePollIntervalMs").isNumber().default(1000)
  this._workerCursor = 0
  
  this.subtasks = {}
  this.runningCount = 0
  this.pendingQueue = []
  
  // Metrics
  this.metrics = {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    timedout: 0,
    retried: 0,
    totalDurationMs: 0,
    maxDepthUsed: 0
  }
  
  // Start watchdog for deadlines
  this._startWatchdog()
}

SubtaskManager.prototype._normalizeWorkers = function(workers) {
  var list = []
  var parsed = workers

  if (isString(workers) && workers.trim().length > 0) {
    try {
      parsed = af.fromJSSLON(workers)
    } catch(ignoreParseErr) {
      parsed = []
    }
  }

  if (isString(parsed)) parsed = [parsed]
  if (!isArray(parsed)) parsed = []

  parsed.forEach(function(entry) {
    var url = __
    if (isString(entry)) {
      url = entry.trim()
    } else if (isMap(entry) && isString(entry.url)) {
      url = entry.url.trim()
    }

    if (!isString(url) || url.length === 0) return
    url = url.replace(/\/+$/, "")
    if (url.match(/^https?:\/\//i) === null) return
    list.push(url)
  })

  return list
}

SubtaskManager.prototype._buildChildArgs = function(subtask) {
  var mergedArgs = merge({}, this.parentArgs)

  if (isMap(subtask.args)) {
    Object.keys(subtask.args).forEach(function(key) {
      mergedArgs[key] = subtask.args[key]
    })
  }

  mergedArgs.goal = subtask.goal
  mergedArgs._delegationDepth = subtask.depth
  mergedArgs._parentSubtaskId = subtask.parentId
  return mergedArgs
}

SubtaskManager.prototype._nextWorker = function() {
  if (!isArray(this.workers) || this.workers.length === 0) return __
  var idx = this._workerCursor % this.workers.length
  this._workerCursor++
  return this.workers[idx]
}

SubtaskManager.prototype._remoteRequest = function(workerUrl, path, payload) {
  var headers = { "Content-Type": "application/json" }
  if (isString(this.parentArgs.apitoken) && this.parentArgs.apitoken.length > 0) {
    headers.Authorization = "Bearer " + this.parentArgs.apitoken
  }

  var response
  try {
    response = $rest({ requestHeaders: headers }).post(workerUrl + path, payload || {})
  } catch (e) {
    var errMsg = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
    throw new Error("Remote worker request failed (" + workerUrl + path + "): " + errMsg)
  }

  if (!isMap(response)) {
    throw new Error("Remote worker response is not a map for endpoint " + path)
  }

  if (isString(response.error) && response.error.length > 0) {
    throw new Error("Remote worker error: " + response.error)
  }

  return response
}

SubtaskManager.prototype._completeSubtask = function(subtask, prefix, answer, metrics, state) {
  subtask.result = {
    answer: answer,
    metrics: metrics,
    state: state
  }
  subtask.status = "completed"
  subtask.completedAt = new Date().getTime()
  subtask.error = __

  var duration = subtask.completedAt - subtask.startedAt
  this.metrics.totalDurationMs += duration
  this.metrics.completed++
  this.metrics.running--
  this.runningCount--

  this.interactionFn("delegate", prefix + " ✅ Completed in " + Math.round(duration / 1000) + "s")
}

SubtaskManager.prototype._failOrRetrySubtask = function(subtask, prefix, error) {
  subtask.error = error

  if (subtask.attempt < subtask.maxAttempts) {
    subtask.status = "pending"
    subtask.metadata.previousError = error
    this.pendingQueue.push(subtask.id)
    this.metrics.retried++
    this.metrics.running--
    this.runningCount--
    this.interactionFn("delegate", prefix + " ⚠️ Failed (attempt " + subtask.attempt + "/" + subtask.maxAttempts + "), will retry: " + error)
    return "retry"
  }

  subtask.status = "failed"
  subtask.completedAt = new Date().getTime()
  this.metrics.failed++
  this.metrics.running--
  this.runningCount--
  this.interactionFn("delegate", prefix + " ❌ Failed after " + subtask.maxAttempts + " attempts: " + error)
  return "failed"
}

SubtaskManager.prototype._startLocalSubtask = function(subtask, prefix) {
  var parent = this

  $doV(function() {
    try {
      var childAgent = new MiniA()
      var mergedArgs = parent._buildChildArgs(subtask)

      childAgent.setInteractionFn(function(event, message) {
        parent.interactionFn(event, prefix + " " + message)
      })

      childAgent.init(mergedArgs)
      var answer = childAgent.start(mergedArgs)
      var childMetrics = childAgent.getMetrics()
      var childState = jsonParse(stringify(childAgent._agentState || {}, __, ""), __, __, true)

      if (subtask.status === "running") {
        parent._completeSubtask(subtask, prefix, answer, childMetrics, childState)
      }
    } catch (e) {
      if (subtask.status === "running") {
        var error = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
        parent._failOrRetrySubtask(subtask, prefix, error)
      }
    }

    try {
      parent._processQueue()
    } catch(ignoreQueue) {}
  })
}

SubtaskManager.prototype._startRemoteSubtask = function(subtask, prefix) {
  var parent = this

  $doV(function() {
    try {
      var workerUrl = parent._nextWorker()
      if (!isString(workerUrl) || workerUrl.length === 0) {
        throw new Error("No remote workers configured")
      }

      subtask.workerUrl = workerUrl
      subtask.remoteEventIndex = 0

      var mergedArgs = parent._buildChildArgs(subtask)
      var timeoutSec = Math.max(1, Math.ceil(subtask.deadlineMs / 1000))
      var metadata = merge({}, subtask.metadata || {})
      metadata.parentSubtaskId = subtask.parentId
      metadata.delegationDepth = subtask.depth

      var taskResponse = parent._remoteRequest(workerUrl, "/task", {
        goal: subtask.goal,
        args: mergedArgs,
        timeout: timeoutSec,
        metadata: metadata
      })

      if (!isString(taskResponse.taskId) || taskResponse.taskId.length === 0) {
        throw new Error("Remote worker did not return taskId")
      }

      subtask.remoteTaskId = taskResponse.taskId
      parent.interactionFn("delegate", prefix + " Routed to worker: " + workerUrl)

      while (subtask.status === "running") {
        sleep(parent.remotePollIntervalMs, true)
        if (subtask.status !== "running") break

        var status = parent._remoteRequest(workerUrl, "/status", { taskId: subtask.remoteTaskId })
        var remoteStatus = isString(status.status) ? status.status.toLowerCase() : "running"

        if (isArray(status.events)) {
          var seenEvents = _$(subtask.remoteEventIndex, "subtask.remoteEventIndex").isNumber().default(0)
          for (var i = seenEvents; i < status.events.length; i++) {
            var evt = status.events[i]
            if (isMap(evt) && isString(evt.message) && evt.message.length > 0) {
              parent.interactionFn("delegate", prefix + " " + evt.message)
            }
          }
          subtask.remoteEventIndex = status.events.length
        }

        if (remoteStatus === "queued" || remoteStatus === "running") continue

        if (remoteStatus === "completed") {
          var resultPayload = __
          var resultErrMsg = __

          // /status can flip to completed slightly before /result is available.
          for (var attempt = 0; attempt < 5; attempt++) {
            try {
              resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId })
              if (isMap(resultPayload) && isMap(resultPayload.result)) break
            } catch (resultErr) {
              resultErrMsg = isDef(resultErr) && isString(resultErr.message) ? resultErr.message : stringify(resultErr, __, "")
            }
            sleep(250, true)
          }

          if (!(isMap(resultPayload) && isMap(resultPayload.result))) {
            throw new Error("Remote task completed but result is not available yet" + (isString(resultErrMsg) ? ": " + resultErrMsg : ""))
          }

          var remoteResult = isMap(resultPayload) && isMap(resultPayload.result) ? resultPayload.result : {}
          var remoteError = isDef(remoteResult.error) ? String(remoteResult.error) : __

          if (isString(remoteError) && remoteError.length > 0) {
            throw new Error(remoteError)
          }

          parent._completeSubtask(
            subtask,
            prefix,
            remoteResult.answer,
            isMap(remoteResult.metrics) ? remoteResult.metrics : {},
            isMap(remoteResult.state) ? remoteResult.state : {}
          )
          return
        }

        var resultPayload = __
        try {
          resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId })
        } catch(ignoreResultErr) {}

        var failedMsg = "Remote subtask ended with status: " + remoteStatus
        if (isMap(resultPayload) && isMap(resultPayload.result) && isDef(resultPayload.result.error)) {
          failedMsg = String(resultPayload.result.error)
        }
        throw new Error(failedMsg)
      }
    } catch (e) {
      if (subtask.status === "running") {
        var error = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
        parent._failOrRetrySubtask(subtask, prefix, error)
      }
    }

    try {
      parent._processQueue()
    } catch(ignoreQueue) {}
  })
}

/**
 * <odoc>
 * <key>SubtaskManager.submit(goal, childArgs, opts)</key>
 * Creates a subtask entry with status "pending". Validates depth and queues it.
 * Returns the subtask ID.
 * 
 * Parameters:
 * - goal: The sub-goal for the child agent
 * - childArgs: Optional overrides for child agent configuration
 * - opts: Optional { deadlineMs, maxAttempts, metadata }
 * </odoc>
 */
SubtaskManager.prototype.submit = function(goal, childArgs, opts) {
  if (!isString(goal) || goal.trim().length === 0) {
    throw new Error("Goal is required and must be a non-empty string")
  }
  
  opts = _$(opts, "opts").isMap().default({})
  childArgs = _$(childArgs, "childArgs").isMap().default({})
  
  var depth = this.currentDepth + 1
  if (depth > this.maxDepth) {
    throw new Error("Maximum delegation depth (" + this.maxDepth + ") exceeded")
  }
  
  var subtaskId = sha384(nowNano() + goal).substr(0, 16)
  var now = new Date().getTime()
  
  var subtask = {
    id: subtaskId,
    parentId: this.parentArgs._id || __,
    goal: goal,
    args: childArgs,
    status: "pending",
    result: __,
    error: __,
    metrics: __,
    agentState: __,
    createdAt: now,
    startedAt: __,
    completedAt: __,
    deadlineMs: _$(opts.deadlineMs, "opts.deadlineMs").isNumber().default(this.defaultDeadlineMs),
    attempt: 0,
    maxAttempts: _$(opts.maxAttempts, "opts.maxAttempts").isNumber().default(this.defaultMaxAttempts),
    depth: depth,
    metadata: opts.metadata || {}
  }
  
  this.subtasks[subtaskId] = subtask
  this.pendingQueue.push(subtaskId)
  this.metrics.total++
  
  if (depth > this.metrics.maxDepthUsed) {
    this.metrics.maxDepthUsed = depth
  }
  
  return subtaskId
}

/**
 * <odoc>
 * <key>SubtaskManager.start(subtaskId)</key>
 * Spawns a new MiniA agent for the subtask, calls init() + start() inside $doV().
 * Tracks the subtask in the registry and manages concurrency.
 * </odoc>
 */
SubtaskManager.prototype.start = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  if (subtask.status !== "pending") {
    throw new Error("Subtask " + subtaskId + " is not in pending state (current: " + subtask.status + ")")
  }
  
  // Check concurrency limit
  if (this.runningCount >= this.maxConcurrent) {
    // Keep it pending, will be started by _processQueue
    return
  }
  
  subtask.status = "running"
  subtask.startedAt = new Date().getTime()
  subtask.attempt++
  this.runningCount++
  this.metrics.running++
  
  // Remove from pending queue
  var queueIndex = this.pendingQueue.indexOf(subtaskId)
  if (queueIndex >= 0) {
    this.pendingQueue.splice(queueIndex, 1)
  }
  
  // Emit delegation start event
  var prefix = "[subtask:" + subtaskId.substring(0, 8) + "]"
  this.interactionFn("delegate", prefix + " Starting sub-goal: " + subtask.goal)

  if (this.remoteDelegation) {
    this._startRemoteSubtask(subtask, prefix)
  } else {
    this._startLocalSubtask(subtask, prefix)
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.submitAndRun(goal, childArgs, opts)</key>
 * Shorthand method that calls submit() then start().
 * Returns the subtask ID.
 * </odoc>
 */
SubtaskManager.prototype.submitAndRun = function(goal, childArgs, opts) {
  var subtaskId = this.submit(goal, childArgs, opts)
  this.start(subtaskId)
  return subtaskId
}

/**
 * <odoc>
 * <key>SubtaskManager.status(subtaskId)</key>
 * Returns the current state of a subtask as a descriptor object.
 * </odoc>
 */
SubtaskManager.prototype.status = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Return a copy to prevent external modification
  return jsonParse(stringify(subtask, __, ""), __, __, true)
}

/**
 * <odoc>
 * <key>SubtaskManager.result(subtaskId)</key>
 * Returns the final result of a completed subtask.
 * Returns { answer, metrics, state, error } or throws if not in terminal state.
 * </odoc>
 */
SubtaskManager.prototype.result = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  if (subtask.status !== "completed" && subtask.status !== "failed" && subtask.status !== "cancelled" && subtask.status !== "timeout") {
    throw new Error("Subtask " + subtaskId + " is not in terminal state (current: " + subtask.status + ")")
  }
  
  return {
    answer: isDef(subtask.result) ? subtask.result.answer : __,
    metrics: isDef(subtask.result) ? subtask.result.metrics : __,
    state: isDef(subtask.result) ? subtask.result.state : __,
    error: subtask.error
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.cancel(subtaskId, reason)</key>
 * Cancels a running or pending subtask.
 * Returns true if cancelled, false if already in terminal state.
 * </odoc>
 */
SubtaskManager.prototype.cancel = function(subtaskId, reason) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Check if already terminal
  if (subtask.status === "completed" || subtask.status === "failed" || subtask.status === "cancelled" || subtask.status === "timeout") {
    return false
  }
  
  var wasRunning = subtask.status === "running"

  if (wasRunning && this.remoteDelegation && isString(subtask.workerUrl) && isString(subtask.remoteTaskId)) {
    try {
      this._remoteRequest(subtask.workerUrl, "/cancel", {
        taskId: subtask.remoteTaskId,
        reason: reason || "Cancelled by user"
      })
    } catch(ignoreRemoteCancel) {}
  }
  
  // Mark as cancelled
  subtask.status = "cancelled"
  subtask.completedAt = new Date().getTime()
  subtask.error = reason || "Cancelled by user"
  
  // Update metrics
  if (wasRunning) {
    this.metrics.running--
    this.runningCount--
  }
  this.metrics.cancelled++
  
  // Remove from pending queue if present
  var queueIndex = this.pendingQueue.indexOf(subtaskId)
  if (queueIndex >= 0) {
    this.pendingQueue.splice(queueIndex, 1)
  }
  
  var prefix = "[subtask:" + subtaskId.substring(0, 8) + "]"
  this.interactionFn("delegate", prefix + " 🛑 Cancelled: " + (reason || "user request"))
  
  // Try to process queue in case this frees up a slot
  try {
    this._processQueue()
  } catch(ignoreQueue) {}
  
  return true
}

/**
 * <odoc>
 * <key>SubtaskManager.waitFor(subtaskId, timeoutMs)</key>
 * Blocking poll-wait until the subtask reaches a terminal state.
 * Returns the result.
 * </odoc>
 */
SubtaskManager.prototype.waitFor = function(subtaskId, timeoutMs) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  timeoutMs = _$(timeoutMs, "timeoutMs").isNumber().default(300000)
  var startTime = new Date().getTime()
  var pollInterval = 500
  
  while (true) {
    if (subtask.status === "completed" || subtask.status === "failed" || subtask.status === "cancelled" || subtask.status === "timeout") {
      return this.result(subtaskId)
    }
    
    var elapsed = new Date().getTime() - startTime
    if (elapsed >= timeoutMs) {
      throw new Error("Timeout waiting for subtask " + subtaskId)
    }
    
    sleep(pollInterval, true)
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.waitForAll(subtaskIds, timeoutMs)</key>
 * Wait for multiple subtasks to complete.
 * Returns an array of results in the same order as the input IDs.
 * </odoc>
 */
SubtaskManager.prototype.waitForAll = function(subtaskIds, timeoutMs) {
  if (!isArray(subtaskIds)) {
    throw new Error("subtaskIds must be an array")
  }
  
  timeoutMs = _$(timeoutMs, "timeoutMs").isNumber().default(300000)
  var results = []
  
  for (var i = 0; i < subtaskIds.length; i++) {
    var remainingTime = timeoutMs - (results.length > 0 ? 0 : 0)
    results.push(this.waitFor(subtaskIds[i], remainingTime))
  }
  
  return results
}

/**
 * <odoc>
 * <key>SubtaskManager.list(filter)</key>
 * Lists all subtasks, optionally filtered by status.
 * Returns an array of subtask descriptors.
 * </odoc>
 */
SubtaskManager.prototype.list = function(filter) {
  var parent = this
  var subtaskIds = Object.keys(this.subtasks)
  var results = []
  
  subtaskIds.forEach(function(id) {
    var subtask = parent.subtasks[id]
    if (isDef(filter) && isString(filter)) {
      if (subtask.status !== filter) return
    }
    results.push(jsonParse(stringify(subtask, __, ""), __, __, true))
  })
  
  return results
}

/**
 * <odoc>
 * <key>SubtaskManager.cleanup(subtaskId)</key>
 * Removes a subtask from the registry.
 * Can only cleanup tasks in terminal states.
 * </odoc>
 */
SubtaskManager.prototype.cleanup = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Only allow cleanup of terminal states
  if (subtask.status !== "completed" && subtask.status !== "failed" && subtask.status !== "cancelled" && subtask.status !== "timeout") {
    throw new Error("Cannot cleanup subtask " + subtaskId + " in non-terminal state: " + subtask.status)
  }
  
  delete this.subtasks[subtaskId]
}

/**
 * <odoc>
 * <key>SubtaskManager.getMetrics()</key>
 * Returns aggregated metrics about all subtasks.
 * </odoc>
 */
SubtaskManager.prototype.getMetrics = function() {
  var avgDurationMs = this.metrics.completed > 0 
    ? Math.round(this.metrics.totalDurationMs / this.metrics.completed) 
    : 0
  
  return {
    total: this.metrics.total,
    running: this.metrics.running,
    completed: this.metrics.completed,
    failed: this.metrics.failed,
    cancelled: this.metrics.cancelled,
    timedout: this.metrics.timedout,
    retried: this.metrics.retried,
    avgDurationMs: avgDurationMs,
    maxDepthUsed: this.metrics.maxDepthUsed
  }
}

/**
 * <odoc>
 * <key>SubtaskManager._processQueue()</key>
 * Internal method to process the pending queue and start new tasks if concurrency allows.
 * </odoc>
 */
SubtaskManager.prototype._processQueue = function() {
  while (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
    var nextId = this.pendingQueue[0]
    try {
      this.start(nextId)
    } catch(e) {
      // If start fails, remove from queue and mark as failed
      this.pendingQueue.shift()
      var subtask = this.subtasks[nextId]
      if (isDef(subtask)) {
        subtask.status = "failed"
        subtask.error = "Failed to start: " + (isDef(e) && isString(e.message) ? e.message : stringify(e, __, ""))
        subtask.completedAt = new Date().getTime()
        this.metrics.failed++
      }
    }
  }
}

/**
 * <odoc>
 * <key>SubtaskManager._startWatchdog()</key>
 * Internal method to start a watchdog thread that checks for deadline timeouts.
 * </odoc>
 */
SubtaskManager.prototype._startWatchdog = function() {
  var parent = this
  
  $doV(function() {
    while (true) {
      try {
        var now = new Date().getTime()
        var subtaskIds = Object.keys(parent.subtasks)
        
        subtaskIds.forEach(function(id) {
          var subtask = parent.subtasks[id]
          
          // Check running tasks for timeout
          if (subtask.status === "running" && isDef(subtask.startedAt)) {
            var elapsed = now - subtask.startedAt
            if (elapsed >= subtask.deadlineMs) {
              if (parent.remoteDelegation && isString(subtask.workerUrl) && isString(subtask.remoteTaskId)) {
                try {
                  parent._remoteRequest(subtask.workerUrl, "/cancel", {
                    taskId: subtask.remoteTaskId,
                    reason: "Deadline exceeded (" + subtask.deadlineMs + "ms)"
                  })
                } catch(ignoreRemoteCancel) {}
              }

              // Mark as timeout
              subtask.status = "timeout"
              subtask.completedAt = now
              subtask.error = "Deadline exceeded (" + subtask.deadlineMs + "ms)"
              parent.metrics.timedout++
              parent.metrics.running--
              parent.runningCount--
              
              var prefix = "[subtask:" + id.substring(0, 8) + "]"
              parent.interactionFn("delegate", prefix + " ⏱️ Timeout after " + Math.round(elapsed / 1000) + "s")
              
              // Try to process queue
              try {
                parent._processQueue()
              } catch(ignoreQueue) {}
            }
          }
        })
      } catch(e) {
        // Ignore watchdog errors
      }
      
      // Check every 5 seconds
      sleep(5000, true)
    }
  })
}
