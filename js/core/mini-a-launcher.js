// Author: Nuno Aguiar
// License: Apache 2.0
// Lightweight launcher diagnostics shared by console and core.
var MiniALauncher = typeof MiniALauncher === "object" ? MiniALauncher : {}

MiniALauncher._KNOWN_ARGUMENT_NAMES = (function() {
  var known = {}
  ;[
    "absorbmaxpages", "absorbmaxtokens", "absorboutput", "changetrackroot", "dream", "dreamwikimaxaffected", "dreamwikiorganize",
    "dryrun", "editor", "eval", "evalbaseline", "evalfile", "evalout", "evalwritebaseline",
    "ingestallowemptyprune", "ingestchunkchars", "ingestconcurrency", "ingestdryrun", "ingestexclude", "ingestforce", "ingestinclude",
    "ingestindependent", "ingestlayout", "ingestledger", "ingestmaxfilekb", "ingestmode", "ingestprune", "ingestsection",
    "ingestsource", "ingestsourceid", "ingesttype", "lccontextlimit", "maxauditrecords", "maxtotalsteps", "runmaxtokens", "runmaxtimems", "mcpproxyallow",
    "mcpproxydeny", "mcpproxynative", "nologtrunc", "skillcontextchars", "skillmanifestchars", "skillmaxautoload", "specfile",
    "taskfile", "trackchanges", "useeditor", "warnunknownargs", "wikidreambudget", "wikigraphautosave", "wikigraphsavedebouncems",
    "wikiingestbudget", "wikiingestmaxcalls", "wikillmbudget", "wikimaxprompttokens", "wikimetacache", "wikitelemetry",
    "rpm", "tpm", "rtm", "maxsteps", "knowledge", "fileallow", "chatyouare", "youare", "homedir",
    "promptprofile", "systempromptbudget", "outfile", "outfileall", "libs", "model", "modellc", "modelval", "modeldec", "modelvisual",
    "conversation", "historyvm", "historyvmmode", "historyvmshadow", "contextvirtualization", "contextvirtualizationshadow", "shell", "usesandbox", "sandboxprofile", "sandboxnonetwork", "shellallow", "shellbanextra",
    "shellguard", "shellguardask", "shellguarddeny", "shellguardtimeout", "shelltimeout", "shellmaxbytes", "toolcachettl", "sessionprewarm", "mcplazy", "mcpdynamic", "mcpproxy", "mcpproxythreshold", "toolargcheck", "toolargrepair",
    "mcpproxytoon", "contextguard", "contextguardbudget", "toolresultmaxinline", "readresultmaxmatches",
    "auditch", "toollog", "metricsch", "debugch", "debuglcch", "debugdecch", "debugvalch", "debugvisualch", "capabilityselection", "capabilitylimit", "policy", "policyfile", "planfile",
    "planformat", "plancontent", "planstyle", "forceplanning", "saveplannotes", "outputfile", "updatefreq",
    "updateinterval", "forceupdates", "planlog", "nosetmcpwd", "noagentsmd", "utilsroot", "utilsallow", "utilsdeny",
    "useskills", "usestdutils", "useasciiviz", "mini-a-docs", "miniadocs",
    "usejsonschema", "usejsontool", "usedelegation", "workers", "workerreg", "workerregtoken", "workerevictionttl", "maxconcurrent",
    "delegationmaxdepth", "delegationtimeout", "delegationstalltimeout", "delegationhardtimeout", "delegationmaxretries",
    "autodelegation", "autodelegationthreshold", "autodelegationmaxperstep", "noisytools",
    "subtasks", "subtasksfile", "subtaskssequential", "forkstatemaxbytes", "forkpolicy", "forkdecide",
    "mcpprogcall", "mcpprogcallport",
    "mcpprogcallmaxbytes", "mcpprogcallresultttl", "mcpprogcalltools", "mcpprogcallbatchmax", "agent", "agentfile",
    "verbose", "readwrite", "debug", "debugfile", "debugtrace", "raw", "showthinking", "useshell", "checkall", "shellallowpipes",
    "shellbatch", "usetools", "usetoolslc", "toolfallback", "useutils", "usediagrams", "usemermaid", "usecharts", "useascii", "usemaps",
    "usemath", "usesvg", "usevectors", "browsercontext", "chatbotmode", "useplanning", "planmode", "validateplan",
    "convertplan", "resumefailed", "showexecs", "usestream", "format", "maxcontext", "compressgoal", "compressgoaltokens", "compressgoalchars", "maxpromptchars", "rules",
    "state", "maxcontent", "earlystopthreshold", "orchestration", "orchestrationcontext", "adaptiverouting", "routerorder",
    "routerallow", "routerdeny", "routerproxythreshold", "usememory", "memoryscope", "memorysessionid", "memorych",
    "memorysessionch", "memoryuser", "memoryusersession", "memorymaxpersection", "memorymaxentries", "memorycompactevery", "memorydedup",
    "memorypromote", "memorystaledays", "memoryartifactttldays", "memoryindexttldays", "memoryinject",
    "usememorywrite", "memorywritemax", "memorymd", "memoryrelevantcap",
    "memoryreflect", "memoryreflectmode", "acceptancereview", "acceptanceoptimization", "proxyargrepair", "memoryreflectmodel", "memoryreflectmin", "memorycandidatedays", "memorysessionmaxdays",
    "memorybudget", "memorysearchbudget", "memorypersistevery",
    "memorysessionheader", "goal", "mcp", "validationgoal", "valgoal", "deepresearch", "maxcycles",
    "validationthreshold", "persistlearnings", "valtools", "outerloop", "outerloopinstructions", "outerloopsessionid", "outerloopmaxcycles", "outerloopmaxtime", "outerloopstoponrepeat", "outerloopmaxnochange",
    "durable", "runid", "resumerun", "runstatus", "runroot", "showseparator", "goalprefix", "shellprefix", "resume", "mode",
    "webartifacts", "artifactworkerurl", "artifactdir", "onport", "web", "webadvanced", "webadvancedpath", "webembed", "webembedorigins", "webembedfields", "webembedcontextrequired", "webembedprompt", "modelman", "mcptest", "memoryman", "wikiman", "wikihydrate", "wikidream", "wikiquery", "wikitarget", "workermode", "path", "usehistory", "useattach", "historypath",
    "historykeep", "historykeepperiod", "historykeepcount", "historyretention", "ssequeuetimeout",
    "logpromptheaders", "historys3bucket", "historys3prefix", "historys3url", "historys3accesskey",
    "historys3secret", "historys3region", "historys3useversion1", "historys3ignorecertcheck", "extracommands",
    "extraskills", "extrahooks", "plugins", "pluginsroot", "pluginsroots", "workerregurl", "workerskills", "workertags", "workerreginterval", "secpass",
    "contractfile", "contractargs", "savecontract", "reusecontract",
    "agentcomms", "showdelegate", "usea2a", "modellock", "modelstrategy", "advisormaxuses", "advisorenable",
    "advisoronrisk", "advisoronambiguity", "advisoronharddecision", "advisorcooldownsteps",
    "advisorbudgetratio", "emergencyreserve", "harddecision", "evidencegate", "evidencegatestrictness",
    "lcescalatedefer", "lcbudget", "lcjsonretries", "lcreplytool", "llmcomplexity", "usedecide",
    "usewiki", "wikiaccess", "wikibackend", "wikiroot", "wikibucket", "wikiprefix", "wikiindexdir", "wikis3artifactprefix", "s3artifactbundle", "wikihttpindexurl", "wikihttptimeout", "wikiartifactrefreshsecs",
    "wikiurl", "wikiaccesskey", "wikisecret", "wikiregion", "wikiuseversion1",
    "wikiignorecertcheck", "wikilintstaleddays", "wikimounts", "wikilexical", "wikiretrievalv2", "wikiretrievalconfig", "wikisourceurl", "wikisourcefield", "wikisourceinline", "usewikigraph", "wikigraphsemantic", "wikigraphcommunity", "wikigraphsearchhints", "wikigraphhintcap", "wikigraphmounts", "wikimountgraphttlms", "wikigraphcross", "wikigraphcrossjoin", "wikigraphcrosscap", "wikigraphcrossdepth", "wikigraphcrossmaxdf", "wikigraphcrossminkeylen", "wikigraphproximity", "wikigraphfalkorhost", "wikigraphfalkorport", "wikigraphfalkorgraph", "wikigraphfalkoruser", "wikigraphfalkorpass", "dreammode", "dreamwiki",
    "dreamwikimode", "dreamwikillm", "dreammaxsteps", "dreammemorymode", "dreamwikidryrun", "dreamwikiapproval", "dreamwikireorg", "dreamwikiinstructions",
    "dreamwikiminpages", "dreamwikimaxdepth", "dreamwikilintresultlimit", "dreamwikisurgical", "wikilintresultlimit", "dreamreport",
    "useskillswiki", "skillwikibackend", "skillwikiroot", "skillwikimounts", "skillsautosearch", "skillsautolimit", "skillsmaxloaded", "skillsmaxchars"
  ].forEach(function(name) {
    if (!isDef(name)) return
    var normalized = String(name).trim().toLowerCase()
    if (normalized.length > 0) known[normalized] = true
  })
  return known
})()

MiniALauncher._IGNORED_INTERNAL_ARGUMENT_NAMES = (function() {
  var ignored = {}
  ;[
    "exec", "mini-a", "__id", "init", "objid", "execid", "agent",
    "__format", "__interaction_source", "__explicitargkeys", "__unknownargsreported",
    "__modeapplied", "__modelstrategyrequested", "_agentbasedir", "_mcpdefaultdir", "_delegationdepth", "_workerhint", "_requiredskills",
    "_autodelegate", "_mcphandofftools", "_mcphandoffproxy",
    "knowledgeupdated"
  ].forEach(function(name) {
    var normalized = String(name || "").trim().toLowerCase()
    if (normalized.length > 0) ignored[normalized] = true
  })
  return ignored
})()

MiniALauncher._normalizeArgName = function(name) {
  var normalized = String(name || "").trim().toLowerCase()
  if (normalized.length === 0) return ""
  normalized = normalized.replace(/^-+/, "")
  return normalized
}

MiniALauncher._argLevenshteinDistance = function(a, b) {
  var left = String(a || "")
  var right = String(b || "")
  var leftLen = left.length
  var rightLen = right.length
  if (leftLen === 0) return rightLen
  if (rightLen === 0) return leftLen

  var matrix = []
  for (var i = 0; i <= leftLen; i++) {
    matrix[i] = [i]
  }
  for (var j = 1; j <= rightLen; j++) {
    matrix[0][j] = j
  }
  for (var row = 1; row <= leftLen; row++) {
    for (var col = 1; col <= rightLen; col++) {
      var cost = left.charAt(row - 1) === right.charAt(col - 1) ? 0 : 1
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      )
    }
  }
  return matrix[leftLen][rightLen]
}

MiniALauncher.findClosestKnownArg = function(name, knownNames, maxDistance) {
  var normalized = MiniALauncher._normalizeArgName(name)
  if (normalized.length === 0 || !isArray(knownNames) || knownNames.length === 0) return __

  var threshold = isNumber(maxDistance) ? maxDistance : 3
  var bestMatch = __
  var bestDistance = Number.MAX_SAFE_INTEGER

  if (isDef(ow.format) && isDef(ow.format.string) && isFunction(ow.format.string.closest)) {
    try {
      bestMatch = ow.format.string.closest(normalized, knownNames, threshold)
    } catch(ignoreClosestErr) {}
  }
  if (isString(bestMatch) && bestMatch.length > 0) {
    if (isDef(ow.format) && isDef(ow.format.string) && isFunction(ow.format.string.distance)) {
      try {
        bestDistance = ow.format.string.distance(normalized, bestMatch)
      } catch(ignoreDistanceErr) {}
    }
    if (!isNumber(bestDistance) || !isFinite(bestDistance)) {
      bestDistance = MiniALauncher._argLevenshteinDistance(normalized, bestMatch)
    }
    return bestDistance <= threshold ? { match: bestMatch, distance: bestDistance } : __
  }

  knownNames.forEach(function(candidate) {
    var normalizedCandidate = MiniALauncher._normalizeArgName(candidate)
    if (normalizedCandidate.length === 0) return
    var distance = MiniALauncher._argLevenshteinDistance(normalized, normalizedCandidate)
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = candidate
    }
  })
  if (!isString(bestMatch) || bestDistance > threshold) return __
  return { match: bestMatch, distance: bestDistance }
}

MiniALauncher.applyLibEnvDefault = function(args) {
  var target = isMap(args) ? args : {}

  if (!(isString(target.libs) && target.libs.trim().length > 0)) {
    var envLibs = target.OAF_MINI_A_LIBS || getEnv("OAF_MINI_A_LIBS")
    if (isString(envLibs) && envLibs.trim().length > 0) {
      target.libs = envLibs.trim()
    }
  }

  return target
}

MiniALauncher.applyLauncherEnvDefaults = function(args) {
  var target = MiniALauncher.applyLibEnvDefault(args)

  if (!(isString(target.mode) && target.mode.trim().length > 0)) {
    var envMode = target.OAF_MINI_A_MODE || getEnv("OAF_MINI_A_MODE")
    if (isString(envMode) && envMode.trim().length > 0) {
      target.mode = envMode.trim()
    }
  }

  return target
}

MiniALauncher.shouldWarnUnknownArgs = function(args) {
  if (!isMap(args)) return false
  if (args.warnunknownargs === false || toBoolean(args.warnunknownargs) === false) return false

  var launchesNonConsoleFlow =
    isDef(args.goal) ||
    isDef(args.agent) ||
    isDef(args.agentfile) ||
    isDef(args.exec) ||
    toBoolean(args.web) === true ||
    toBoolean(args.onport) === true ||
    toBoolean(args.wikiman) === true ||
    toBoolean(args.modelman) === true ||
    toBoolean(args.mcptest) === true ||
    toBoolean(args.memoryman) === true ||
    toBoolean(args.workermode) === true

  return launchesNonConsoleFlow !== true
}

MiniALauncher.warnUnknownArgs = function(args, options) {
  if (!isMap(args) || args.__unknownargsreported === true) return []

  var opts = isMap(options) ? options : {}
  var known = merge({}, MiniALauncher._KNOWN_ARGUMENT_NAMES, true)
  var extraKnown = opts.extraKnownArgs
  if (isArray(extraKnown)) {
    extraKnown.forEach(function(name) {
      var normalized = MiniALauncher._normalizeArgName(name)
      if (normalized.length > 0) known[normalized] = true
    })
  } else if (isMap(extraKnown)) {
    Object.keys(extraKnown).forEach(function(name) {
      var normalized = MiniALauncher._normalizeArgName(name)
      if (normalized.length > 0 && extraKnown[name] === true) known[normalized] = true
    })
  }

  var ignored = merge({}, MiniALauncher._IGNORED_INTERNAL_ARGUMENT_NAMES, true)
  var extraIgnored = opts.extraIgnoredArgs
  if (isArray(extraIgnored)) {
    extraIgnored.forEach(function(name) {
      var normalized = MiniALauncher._normalizeArgName(name)
      if (normalized.length > 0) ignored[normalized] = true
    })
  } else if (isMap(extraIgnored)) {
    Object.keys(extraIgnored).forEach(function(name) {
      var normalized = MiniALauncher._normalizeArgName(name)
      if (normalized.length > 0 && extraIgnored[name] === true) ignored[normalized] = true
    })
  }

  var rawExplicitKeys = args.__explicitargkeys
  var explicitKeys = []
  if (isArray(rawExplicitKeys)) {
    explicitKeys = rawExplicitKeys.slice(0)
  } else if (isMap(rawExplicitKeys)) {
    explicitKeys = Object.keys(rawExplicitKeys).filter(function(key) {
      return rawExplicitKeys[key] === true
    })
  } else {
    explicitKeys = Object.keys(args)
  }

  var unknown = []
  var seen = {}
  explicitKeys.forEach(function(key) {
    var rawKey = String(key || "").trim()
    var normalized = MiniALauncher._normalizeArgName(rawKey)
    if (normalized.length === 0) return
    if (ignored[normalized] === true) return
    if (normalized.indexOf("__") === 0 || normalized.indexOf("_") === 0) return
    if (known[normalized] === true) return
    if (seen[normalized] === true) return
    seen[normalized] = true
    unknown.push(rawKey)
  })

  args.__unknownargsreported = true
  if (unknown.length <= 0) return []

  var logger = isFunction(opts.logger) ? opts.logger : function(message) { logWarn(message) }
  var knownNames = Object.keys(known)
  unknown.forEach(function(rawKey) {
    var suggestion = MiniALauncher.findClosestKnownArg(rawKey, knownNames, 3)
    var msg = "Unknown parameter '" + rawKey + "' provided."
    if (isMap(suggestion) && isString(suggestion.match) && suggestion.match.length > 0) {
      msg += " Did you mean '" + suggestion.match + "'?"
    }
    logger(msg)
  })
  return unknown
}

// Shared console sessions must not evaluate the same library concurrently.
if (!MiniALauncher._agentLoadLock) MiniALauncher._agentLoadLock = new java.util.concurrent.locks.ReentrantLock()
MiniALauncher.loadAgent = function(basePath) {
  var lock = MiniALauncher._agentLoadLock
  lock.lock()
  try { loadLib(basePath + "/mini-a.js") }
  finally { lock.unlock() }
}
