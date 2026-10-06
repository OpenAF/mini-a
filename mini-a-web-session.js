// Shared prompt route used by Simple chat and Advanced console commands.
function MiniAWebPrompt(request) {
  var _res = {}
  try {
    if (!global._mini_a_web_checkToken(request)) {
      return ow.server.httpd.reply({ error: "unauthorized" })
    }
    function __normalizePromptInput(value) {
      var text = isString(value) ? value : (isDef(value) ? String(value) : "")
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      var maxPromptChars = isNumber(global.__maxpromptchars) && global.__maxpromptchars > 0 ? global.__maxpromptchars : 120000
      if (text.length > maxPromptChars) {
        throw "prompt exceeds max allowed length (" + maxPromptChars + " chars)"
      }
      return text
    }
    
    // Parse POST data
    var rawPost = request.files.postData
    if (!isString(rawPost) || rawPost.length > MiniAWebAttachments.maxRequestChars) throw new Error("Request exceeds attachment payload limit")
    var postData = jsonParse(rawPost)
    postData.prompt = __normalizePromptInput(postData.prompt)
    if (isString(postData.displayPrompt)) postData.displayPrompt = __normalizePromptInput(postData.displayPrompt)
    var binaryAttachments = MiniAWebAttachments.validate(postData.attachments, postData.prompt)
    var attachmentDisplayPrompt = binaryAttachments.length ? MiniAWebAttachments.displayPrompt(postData.prompt, binaryAttachments) : __
    delete postData.attachments
    // Validate UUID or generate a new one
    if (isDef(postData.uuid)) {
      if (!global._mini_a_web_isValidUuid(postData.uuid)) {
        return ow.server.httpd.reply({ error: "invalid uuid" })
      }
      _res.uuid = postData.uuid
    } else {
      _res.uuid = genUUID()
    }

    var runToken = global._mini_a_web_reserve(_res.uuid)
    if (isUnDef(runToken)) {
      return ow.server.httpd.reply({ error: "session busy", uuid: _res.uuid, busy: true })
    }

    global.__attachmentStops = global.__attachmentStops || {}
    delete global.__attachmentStops[_res.uuid]
    if (isDef(global.__advanced) && isDef(global.__advanced.sessions[_res.uuid])) global.__advanced.sessions[_res.uuid].cancelled = false
    // Initialize response storage
    if (isUnDef(global.__res[_res.uuid])) {
      global.__res[ _res.uuid ] = [ ]
      global.__lastActivity[ _res.uuid ] = Date.now()
    } else {
      global.__lastActivity[ _res.uuid ] = Date.now()
    }
    
    // Prompt header logging
    if (global.__logpromptheaders.length > 0) {
      global.__logpromptheaders.forEach( h => {
        if (isDef(request.header[h])) {
          log("[" + _res.uuid + "] Prompt header " + h + ": " + request.header[h])
        }
      })
    }
    // Start Mini-A interaction in a non-blocking way
    $doV(() => {
      var uuid = _res.uuid, lma
      try {
      if (global.__usestream && isFunction(global._mini_a_web_initSSE)) {
        global._mini_a_web_initSSE(uuid)
      }
      if (isDef(global.__planState) && isDef(global.__planState[ uuid ])) {
        delete global.__planState[ uuid ]
      }
      if (isDef(global.__subagentState) && isDef(global.__subagentState[ uuid ])) {
        delete global.__subagentState[ uuid ]
      }

      // If history is enabled, set the history file
      var _hfile = (global.__usehistory || global.maArgs.historyvm === true || global.maArgs.historyvmshadow === true) ? global.__historypath + "/c-" + uuid + ".json" : __

      var advancedState = isDef(global.__advanced) ? global.__advanced.sessions[uuid] : __
      var effectiveArgs = isDef(advancedState) ? merge(global.maArgs, advancedState.runtime.options()) : global.maArgs
      if (isDef(advancedState)) {
        advancedState.operation = isString(postData.advancedRequestId) && /^[a-zA-Z0-9-]{1,80}$/.test(postData.advancedRequestId) ? postData.advancedRequestId : runToken
        advancedState.kind = "prompt"
        advancedState.displayPrompt = postData.displayPrompt
        global.__advanced.persist(advancedState)
      }
      var startArgs = merge(effectiveArgs, {
        goal        : __miniAPrefixGoal(postData.prompt, effectiveArgs.goalprefix),
        raw         : true
      })
      if (toBoolean(startArgs.usememory) && isString(global.__memorysessionheader) && global.__memorysessionheader.length > 0 && isMap(request.header)) {
        var headerMemorySessionId = request.header[global.__memorysessionheader]
        if (isDef(headerMemorySessionId)) {
          var normalizedMemorySessionId = String(headerMemorySessionId).trim()
          if (normalizedMemorySessionId.length > 0) startArgs.memorysessionid = normalizedMemorySessionId
        }
      }
      if (isUnDef(advancedState) && (global.__usehistory || startArgs.historyvm === true || startArgs.historyvmshadow === true) && isString(_hfile)) {
        startArgs.conversation = _hfile
      }
      // Only pass browser context for new conversations to avoid replacing in-memory session state
      if (isUnDef(global.__conversations[uuid])) {
        if (isMap(postData.browserContext)) {
          startArgs.browsercontext = jsonParse(stringify(postData.browserContext, __, ""), __, __, true)
        } else if (isString(postData.browserContext) && postData.browserContext.trim().length > 0) {
          var parsedPostBrowserContext = af.fromJSSLON(postData.browserContext)
          if (isMap(parsedPostBrowserContext)) startArgs.browsercontext = parsedPostBrowserContext
        }
      }

      // If conversation does not exist, create it
      if (isUnDef(global.__conversations[ uuid ])) {
        // If history does not exist but we have history in memory, rebuild it
        if (isUnDef(advancedState) && global.__usehistory && !global._mini_a_web_historyExists(uuid) && isDef(global.__res[ uuid ]) && global.__res[ uuid ].length > 0) {
          // Try rebuilding
          var _data = []
          for (var i = 0; i < global.__res[ uuid ].length; i++) {
            var r = global.__res[ uuid ][i]
            if (r.event == "👤") {
              _data.push( { role: "user", content: r.message } )
            } else if (r.event == "final" || r.event == "🤖" || r.event == "⬅️") {
              _data.push( { role: "assistant", content: r.message } )
            } else if (r.event == "⚙️" || r.event == "🖥️") {
              _data.push( { role: "assistant", content: "[TOOL_OUTPUT] " + r.message } )
            }
          }
          if (_data.length > 0) {
            global._mini_a_web_saveFile(_hfile, { u: new Date(), c: _data })
            log("[" + uuid + "] Rebuilt history file " + _hfile)
          }
        }
    
        // Initialize MiniA
        lma = new MiniA()
        global.__conversations[uuid] = lma
        var pendingProxyThought = __
        lma.setInteractionFn( (e, m) => {
          try {
            var advancedLive = isDef(global.__advanced) ? global.__advanced.sessions[uuid] : __
            // The callback survives across goals. Attachment display labels belong
            // to the current run; extracted source data stays in the model history.
            var displayMessage
            if (e === "user" && !isString(global._mini_a_web_extractSubtaskId(m))) {
              var attachmentDisplay = lma._webAttachmentDisplayPrompt
              if (isDef(attachmentDisplay) && global._mini_a_web_owns(uuid, attachmentDisplay.token)) displayMessage = attachmentDisplay.text
              else if (isDef(advancedLive) && isString(advancedLive.displayPrompt) && advancedLive.displayPrompt.length > 0) m = advancedLive.displayPrompt
            }
            if (isDef(advancedLive) && e !== "stream" && e !== "planner_stream") global.__advanced.emit(advancedLive, e, isString(displayMessage) ? displayMessage : m)
            if (e == "stream") {
              // Local child agents inherit this callback and prefix every
              // interaction message with [subtask:id]. Do not mix their answer
              // deltas into the parent SSE stream: the browser maintains one
              // stream buffer and would otherwise append a child answer (and
              // often the parent answer again) to the main transcript.
              if (isString(global._mini_a_web_extractSubtaskId(m))) return
              if (global.__usestream && isFunction(global._mini_a_web_ssePush)) {
                global._mini_a_web_ssePush(uuid, "stream", { message: m })
              }
              return
            }
            if (e == "planner_stream") {
              // Planner deltas from a delegated child are likewise private to
              // that child and must not populate the parent planner preview.
              if (isString(global._mini_a_web_extractSubtaskId(m))) return
              if (global.__usestream && isFunction(global._mini_a_web_ssePush)) {
                global._mini_a_web_ssePush(uuid, "planner_stream", { message: m })
              }
              return
            }
            var _e = ""
            switch(e) {
            case "user"     : _e = "👤"; break
            case "exec"     : _e = "⚙️"; break
            case "shell"    : _e = "🖥️"; break
            case "think"    : _e = "💡"; break
            case "final"    : _e = "🏁"; break
            case "input"    : _e = "➡️"; break
            case "output"   : _e = "⬅️"; break
            case "thought"  : _e = "💭"; break
            case "size"     : _e = "📏"; break
            case "rate"     : _e = "⏳"; break
            case "mcp"      : _e = "🤖"; break
            case "subagent" : _e = "🤝"; break
            case "delegate" : _e = "🤝"; break
            case "plan"     : _e = "🗺️"; break
            case "done"     : _e = "✅"; break
            case "error"    : _e = "❌"; break
            case "libs"     : _e = "📚"; break
            case "info"     : _e = "ℹ️"; break
            case "skill"    : _e = "🧩"; break
            case "load"     : _e = "📂"; break
            case "warn"     : _e = "⚠️"; break
            case "stop"     : _e = "🛑"; break
            case "summarize": _e = "🌀"; break
            default         : _e = e
            }

            if (_e == "🗺️") {
              try {
                if (isFunction(lma._normalizePlanItems)) {
                  var planItems = lma._normalizePlanItems(isObject(lma._agentState) ? lma._agentState.plan : __)
                  if (isArray(planItems) && planItems.length > 0) {
                    var statusIcons = {
                      pending     : { icon: "⏳", label: "pending" },
                      todo        : { icon: "⏳", label: "to do" },
                      not_started : { icon: "⏳", label: "not started" },
                      ready       : { icon: "⏳", label: "ready" },
                      in_progress : { icon: "⚙️", label: "in progress" },
                      progressing : { icon: "⚙️", label: "in progress" },
                      working     : { icon: "⚙️", label: "working" },
                      running     : { icon: "⚙️", label: "running" },
                      active      : { icon: "⚙️", label: "active" },
                      done        : { icon: "✅", label: "done" },
                      complete    : { icon: "✅", label: "complete" },
                      completed   : { icon: "✅", label: "completed" },
                      finished    : { icon: "✅", label: "finished" },
                      success     : { icon: "✅", label: "success" },
                      blocked     : { icon: "🛑", label: "blocked" },
                      stuck       : { icon: "🛑", label: "stuck" },
                      paused      : { icon: "⏸️", label: "paused" },
                      waiting     : { icon: "⏳", label: "waiting" },
                      failed      : { icon: "❌", label: "failed" },
                      cancelled   : { icon: "🚫", label: "cancelled" },
                      canceled    : { icon: "🚫", label: "cancelled" }
                    }
                    var doneStatuses = {
                      done: true,
                      complete: true,
                      completed: true,
                      finished: true,
                      success: true
                    }
                    var normalized = []
                    for (var i = 0; i < planItems.length; i++) {
                      var entry = planItems[i] || {}
                      var statusKey = (entry.status || entry.rawStatus || "").toString()
                      var statusInfo = statusIcons[statusKey] || { icon: "•", label: statusKey || "pending" }
                      var isDone = doneStatuses[statusKey] === true || statusInfo.icon == "✅"
                      normalized.push({
                        title   : entry.title || ("Step " + (i + 1)),
                        status  : statusKey,
                        icon    : statusInfo.icon,
                        label   : statusInfo.label,
                        done    : isDone === true,
                        rawStatus: entry.rawStatus
                      })
                    }
                    var completedCount = 0
                    normalized.forEach(item => { if (item.done === true) completedCount++ })

                    var progressInfo = isObject(lma._planningProgress) ? lma._planningProgress : {}
                    var overallProgress = 0
                    if (isNumber(progressInfo.overall)) {
                      overallProgress = Math.max(0, Math.min(100, Math.round(progressInfo.overall)))
                    } else if (normalized.length > 0) {
                      overallProgress = Math.round((completedCount / normalized.length) * 100)
                    }

                    var checkpointInfo = { reached: 0, total: 0 }
                    if (isObject(progressInfo.checkpoints)) {
                      var checkpoints = progressInfo.checkpoints
                      if (isNumber(checkpoints.reached)) checkpointInfo.reached = checkpoints.reached
                      if (isNumber(checkpoints.total)) checkpointInfo.total = checkpoints.total
                    }

                    global.__planState[uuid] = {
                      items      : normalized,
                      total      : normalized.length,
                      completed  : completedCount,
                      overall    : overallProgress,
                      checkpoints: checkpointInfo,
                      active     : normalized.length > 0,
                      updated    : Date.now()
                    }
                    if (global.__usestream && isFunction(global._mini_a_web_ssePush)) {
                      global._mini_a_web_ssePush(uuid, "plan", { plan: global.__planState[uuid] })
                    }
                  } else {
                    if (isDef(global.__planState[uuid])) delete global.__planState[uuid]
                  }
                }
              } catch(planErr) {
                logErr(planErr)
              }
            //} else if (_e == "🏁" || _e == "✅" || _e == "❌") {
            } else if (_e == "🏁" || _e == "🛑") {
              if (isDef(global.__planState[uuid])) {
                log(`[${uuid}] ${_e} Plan closed`)
                delete global.__planState[uuid]
              }
              if (_e == "🛑" && global.__usestream && isFunction(global._mini_a_web_sseClose)) {
                global._mini_a_web_sseClose(uuid, "stopped")
              }
            }
            var _subtaskId = global._mini_a_web_extractSubtaskId(m)
            if (e == "subagent" || isString(_subtaskId)) {
              // Child events remain in the dedicated subagent panel.
              if (global.__showdelegate) {
                var _sid = isString(_subtaskId) ? _subtaskId : sha1(m || "").substring(0, 8)
                var _title = "Sub-agent " + _sid
                if (isString(m) && m.indexOf(":") >= 0) {
                  var _parts = m.split(":")
                  var _candidate = _parts.slice(1).join(":").trim()
                  if (_candidate.length > 0) _title = _candidate.substring(0, 120)
                }
                var _status = global._mini_a_web_statusFromSubtaskMessage(m)
                // Child interaction callbacks carry their event kind separately
                // from the message. Preserve its mapped icon in the sub-agent
                // panel so thoughts (💭), tool work (⚙️), etc. remain legible.
                var _subtaskMessage = _e + (isString(m) && m.length > 0 ? " " + m : "")
                global._mini_a_web_upsertSubtaskEvent(uuid, _sid, _title, _status, _subtaskMessage)
                if (global.__usestream && isFunction(global._mini_a_web_ssePush)) {
                  global._mini_a_web_ssePush(uuid, "subagents", { subagents: global.__subagentState[uuid] })
                }
              }
              log("[" + uuid + "] 🤝 " + m)
              return
            }
            var genericProxyPattern = /^Using tool ['"]proxy-dispatch['"]\.?(?: #\d+)?$/i
            var isGenericProxyThought = _e == "💭" && isString(m) && genericProxyPattern.test(m.trim())
            var isTranslatedProxyThought = _e == "💭" && isString(m) && (/^Using tool ['"](?!proxy-dispatch['"])([^'"]+)['"]\.?(?: #\d+)?$/i.test(m.trim()) || /^(Listing available tools|Searching available tools|Checking tool connections|Reading a saved tool result)(?: #\d+)?$/.test(m.trim()))
            if (isGenericProxyThought) {
              // Wait for actual dispatch parameters, across intervening diagnostics.
              pendingProxyThought = m
              return
            }
            if (isDef(pendingProxyThought)) {
              var proxyDisplayThought = lma._pendingProxyDisplayThought
              if (_e == "⚙️" && isString(proxyDisplayThought) && !genericProxyPattern.test(proxyDisplayThought.trim())) {
                var proxyCounter = / #\d+$/.exec(pendingProxyThought.trim())
                global.__res[uuid].push({ event: "💭", message: proxyDisplayThought + (proxyCounter ? proxyCounter[0] : "") })
                pendingProxyThought = __
              } else if (isTranslatedProxyThought || _e == "🏁" || _e == "🛑" || _e == "👤") {
                // Canonical thoughts supersede announcements. Never guess a tool
                // or publish an unresolved announcement at the end of a turn.
                pendingProxyThought = __
              }
            }
            var transcriptEntry = { event: _e, message: m }
            if (isString(displayMessage)) transcriptEntry.displayMessage = displayMessage
            global.__res[uuid].push(transcriptEntry)
            if (global.__usestream && isFunction(global._mini_a_web_ssePush) && _e != "🗺️") {
              global._mini_a_web_ssePush(uuid, "interaction", { event: _e })
            }
            // Only sync to S3 after user prompts (not on every event)
            if (isUnDef(advancedState) && _e == "👤" && global.maArgs.historyvm !== true && global.maArgs.historyvmshadow !== true && isFunction(global._mini_a_web_storeHistory)) {
              try {
                global._mini_a_web_storeHistory(uuid)
              } catch(syncErr) {
                logErr(syncErr)
              }
            }
            log("[" + uuid + "] " + _e + " " + m)
          } catch(eee) {
            $err(eee)
            logErr(`[${uuid}] interaction handler error: ` + __miniAErrMsg(eee))
            try {
              if (isDef(global.__res[uuid])) {
                global.__res[uuid].push({ event: "❗", message: String(__miniAErrMsg(eee)) })
              }
            } catch(ignorePushErr) {}
          }
        })
        if (isString(startArgs.conversation) && isUnDef(advancedState)) startArgs.conversation = global._mini_a_web_loadFile(startArgs.conversation)
        lma.init(startArgs)
      } else {
        lma = global.__conversations[ uuid ]
      }

      lma._historyCheckpointFn = function(goal) {
        if (isUnDef(advancedState) && isObject(lma._historyVm)) global._mini_a_web_storeHistory(uuid, goal)
      }
      if (isDef(advancedState)) {
        advancedState.runtime.attach(lma)
        advancedState.runtime.sync(lma, postData.prompt)
        var traceSink = advancedState.runtime.beginTrace(postData.prompt)
        lma.setTraceFn(function(kind, payload) { traceSink(kind, global.__advanced.safe(payload)) })
      }
      if (binaryAttachments.length) {
        postData.prompt = __normalizePromptInput(MiniAWebAttachments.process(binaryAttachments, postData.prompt, lma,
          function() { return global._mini_a_web_owns(uuid, runToken) && global.__attachmentStops[uuid] !== runToken && (!advancedState || !advancedState.cancelled) },
          function(message) {
            global.__res[uuid].push({ event: "info", message: message })
            if (advancedState) global.__advanced.emit(advancedState, "info", message)
          }))
        startArgs.goal = __miniAPrefixGoal(postData.prompt, effectiveArgs.goalprefix)
      }
      if (global.__attachmentStops[uuid] === runToken || (advancedState && advancedState.cancelled) || !global._mini_a_web_owns(uuid, runToken)) return
      if (isString(attachmentDisplayPrompt)) lma._webAttachmentDisplayPrompt = { token: runToken, text: attachmentDisplayPrompt }
      var _rma = lma.start(startArgs)

      if (!global._mini_a_web_owns(uuid, runToken)) return
      // start() can return a string, a structured result, or no result on failure.
      // Keep typed answers intact and never dereference an absent result.
      if (isUnDef(_rma)) throw "Agent returned no final answer"
      var finalMessage = isObject(_rma) && isString(_rma.answer) && _rma.answer.trim().length > 0 ? _rma.answer : _rma
      if (isString(finalMessage) && startArgs.format != "raw") finalMessage = __miniAUnwrapAnswer(finalMessage)
      if (isObject(finalMessage)) finalMessage = af.toSLON(finalMessage)
      global.__res[uuid].push( { event: "final", message: finalMessage } )
      if (isDef(advancedState)) {
        advancedState.runtime.sync(lma, isString(attachmentDisplayPrompt) ? attachmentDisplayPrompt : postData.prompt, finalMessage)
        advancedState.runtime.saveConversation()
        advancedState.runtime.afterGoal(isString(attachmentDisplayPrompt) ? attachmentDisplayPrompt : postData.prompt, finalMessage)
        global.__advanced.emit(advancedState, "answer", finalMessage)
      }
      if (global.__usestream && isFunction(global._mini_a_web_ssePush)) {
        global._mini_a_web_ssePush(uuid, "interaction", { event: "final" })
      }
      if (global.__usestream && isFunction(global._mini_a_web_sseClose)) {
        global._mini_a_web_sseClose(uuid, "finished")
      }
      if (isUnDef(advancedState) && isFunction(global._mini_a_web_storeHistory)) {
        try {
          global._mini_a_web_storeHistory(uuid)
        } catch(storeErr) {
          logErr(storeErr)
        }
      }
      log("[" + uuid + "] " + (isObject(_rma) ? af.toSLON(_rma) : _rma))
      } catch(eee) {
        logErr(eee)
        if (isDef(advancedState)) global.__advanced.emit(advancedState, "error", __miniAErrMsg(eee))
        if (global._mini_a_web_owns(uuid, runToken)) {
          if (isUnDef(global.__res[uuid])) global.__res[uuid] = []
          global.__res[uuid].push({ event: "❗", message: "Agent failed: " + __miniAErrMsg(eee) })
          if (global.__usestream && isFunction(global._mini_a_web_sseClose)) global._mini_a_web_sseClose(uuid, "error")
          global._mini_a_web_dispose(uuid)
        }
      } finally {
        if (isDef(lma) && isDef(lma._webAttachmentDisplayPrompt) && lma._webAttachmentDisplayPrompt.token === runToken) delete lma._webAttachmentDisplayPrompt
        binaryAttachments = null
        if (global.__attachmentStops[uuid] === runToken) delete global.__attachmentStops[uuid]
        try { if (isDef(advancedState)) { global.__advanced.emit(advancedState, "complete", { requestId: advancedState.operation, action: "goal" }); advancedState.operation = null; delete advancedState.displayPrompt; global.__advanced.persist(advancedState) } }
        finally { global._mini_a_web_release(uuid, runToken) }
      }
    }).catch((eee) => {
      logErr(eee)
      global._mini_a_web_release(_res.uuid, runToken)
    })
  } catch(ee) {
    _res.error = String(ee)
    logErr(ee)
    if (isDef(runToken)) global._mini_a_web_release(_res.uuid, runToken)
  }

  return ow.server.httpd.reply(_res)

}
