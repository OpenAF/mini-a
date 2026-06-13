// Author: OpenAI Assistant
// License: Apache 2.0
// Description: Shared MCP wiki bootstrap helpers for standalone wiki MCP jobs.

loadLib("mini-a-common.js")
loadLib("mini-a-wiki.js")
loadLib("mini-a-utils.js")

function __miniAMcpWikiBuildConfig(args, options) {
  args = isMap(args) ? args : {}
  options = isMap(options) ? options : {}

  var backend = isDef(args.wikibackend) ? String(args.wikibackend).toLowerCase().trim() : "fs"
  if (["fs", "s3", "es", "s3fs"].indexOf(backend) < 0) backend = "fs"

  var access = isString(options.access) ? options.access.toLowerCase().trim() : "ro"
  if (access !== "rw") access = "ro"
  if (toBoolean(options.readonly) === true) access = "ro"

  var wikiGraphHintCap = Number(args.wikigraphhintcap)
  var wikiGraphFalkorHost = isString(args.wikigraphfalkorhost) && args.wikigraphfalkorhost.trim().length > 0
    ? args.wikigraphfalkorhost.trim() : __
  var wikiGraphFalkorPort = Number(args.wikigraphfalkorport)

  var cfg = {
    access              : access,
    backend             : backend,
    indexdir            : isString(args.wikiindexdir) && args.wikiindexdir.trim().length > 0 ? args.wikiindexdir.trim() : __,
    wikimetacache       : isDef(args.wikimetacache) ? toBoolean(args.wikimetacache) : true,
    usegraph            : (isDef(args.usewikigraph) ? toBoolean(args.usewikigraph) : false) || isString(wikiGraphFalkorHost),
    wikigraphcommunity  : isString(args.wikigraphcommunity) && args.wikigraphcommunity.trim().length > 0 ? args.wikigraphcommunity.trim() : __,
    wikigraphsearchhints: isDef(args.wikigraphsearchhints) ? toBoolean(args.wikigraphsearchhints) : true,
    wikigraphmounts     : isDef(args.wikigraphmounts) ? toBoolean(args.wikigraphmounts) : true,
    wikigraphhintcap    : isNumber(wikiGraphHintCap) && wikiGraphHintCap > 0 ? wikiGraphHintCap : 5,
    wikimountgraphttlms : isNumber(Number(args.wikimountgraphttlms)) ? Number(args.wikimountgraphttlms) : 60000,
    wikigraphautosave   : isString(args.wikigraphautosave) && args.wikigraphautosave.trim().length > 0 ? args.wikigraphautosave.trim() : "always",
    wikigraphsavedebouncems: isNumber(Number(args.wikigraphsavedebouncems)) ? Number(args.wikigraphsavedebouncems) : 5000,
    wikilintstreamthreshold: isNumber(Number(args.wikilintstreamthreshold)) ? Number(args.wikilintstreamthreshold) : 2000,
    wikilintmaxpairs    : isNumber(Number(args.wikilintmaxpairs)) ? Number(args.wikilintmaxpairs) : 250000,
    wikigraphfalkor     : {
      host : wikiGraphFalkorHost,
      port : isNumber(wikiGraphFalkorPort) ? wikiGraphFalkorPort : 6379,
      graph: isString(args.wikigraphfalkorgraph) && args.wikigraphfalkorgraph.trim().length > 0 ? args.wikigraphfalkorgraph.trim() : "mini_a_wiki",
      user : isString(args.wikigraphfalkoruser) && args.wikigraphfalkoruser.trim().length > 0 ? args.wikigraphfalkoruser.trim() : __,
      pass : isString(args.wikigraphfalkorpass) && args.wikigraphfalkorpass.trim().length > 0 ? args.wikigraphfalkorpass.trim() : __
    }
  }

  if (backend === "s3" || backend === "s3fs") {
    cfg.bucket          = args.wikibucket
    cfg.prefix          = args.wikiprefix
    cfg.url             = args.wikiurl
    cfg.accessKey       = args.wikiaccesskey
    cfg.secret          = args.wikisecret
    cfg.region          = args.wikiregion
    cfg.useVersion1     = args.wikiuseversion1
    cfg.ignoreCertCheck = args.wikiignorecertcheck
    if (backend === "s3fs") cfg.root = isString(args.wikiroot) && args.wikiroot.trim().length > 0 ? args.wikiroot.trim() : "."
  } else if (backend === "es") {
    cfg.esurl   = args.wikiurl
    cfg.esindex = isString(args.wikiprefix) && args.wikiprefix.trim().length > 0 ? args.wikiprefix.trim() : "mini_a_wiki"
    cfg.esuser  = args.wikiaccesskey
    cfg.espass  = args.wikisecret
  } else {
    cfg.root = isString(args.wikiroot) && args.wikiroot.trim().length > 0 ? args.wikiroot.trim() : "."
  }

  return cfg
}

function __miniAMcpWikiDefaultLabel(args, cfg) {
  args = isMap(args) ? args : {}
  cfg = isMap(cfg) ? cfg : {}

  if (isString(args.label) && args.label.trim().length > 0) return args.label.trim()
  if (cfg.backend === "s3") {
    if (isString(args.wikibucket) && args.wikibucket.length > 0) return "s3://" + args.wikibucket + "/" + args.wikiprefix
    return "S3 wiki"
  }
  return cfg.root || "wiki"
}

function __miniAMcpWikiCreateTool(cfg, wikiManager) {
  var toolRoot = isString(cfg.root) && cfg.root.trim().length > 0 ? cfg.root.trim() : "."
  var tool = new MiniUtilsTool({
    root     : toolRoot,
    readwrite: String(cfg.access || "").toLowerCase() === "rw"
  })
  tool._wikiManager = wikiManager
  return tool
}

function __miniAMcpWikiAttachMounts(wikiManager, mountsRaw, logPrefix) {
  if (!isObject(wikiManager) || !isString(mountsRaw) || mountsRaw.trim().length === 0) return
  try {
    var mountsList = af.fromJSSLON(mountsRaw)
    if (!isArray(mountsList)) mountsList = [mountsList]
    mountsList.forEach(function(mc) {
      if (!isMap(mc) || !isString(mc.name)) return
      wikiManager.attach(mc.name, merge({ access: "ro" }, mc))
    })
  } catch(mErr) {
    printErrnl("[" + logPrefix + "] wikimounts parse error: " + String(mErr))
  }
}

function __miniAMcpWikiInit(args, options) {
  args = isMap(args) ? args : {}
  options = isMap(options) ? options : {}

  var cfg = __miniAMcpWikiBuildConfig(args, options)
  global.__wikiManager = new MiniAWikiManager(cfg)
  global.__wikiTool = __miniAMcpWikiCreateTool(cfg, global.__wikiManager)
  args.label = __miniAMcpWikiDefaultLabel(args, cfg)
  __miniAMcpWikiAttachMounts(global.__wikiManager, args.wikimounts, isString(options.logPrefix) ? options.logPrefix : "mcp-wiki")

  global.__miniAMcpWiki = {
    access: cfg.access,
    config: cfg,
    label : args.label
  }

  return global.__miniAMcpWiki
}
