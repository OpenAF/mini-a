// Pure filesystem discovery helpers shared by Agent Plugins and Web Extensions.
// No manifest loading, process execution, or directory creation. Apache-2.0.
function __miniAPluginExpandHomePath(pathValue) {
  if (!(isString(pathValue) || pathValue instanceof java.lang.String)) return pathValue
  pathValue = String(pathValue)
  if (pathValue === "~") return String(java.lang.System.getProperty("user.home"))
  if (pathValue.indexOf("~/") === 0 || pathValue.indexOf("~\\") === 0) {
    var home = java.lang.System.getProperty("user.home")
    if (isString(home) && home.length > 0) return home + pathValue.substring(1)
  }
  return pathValue
}

function __miniAPluginSplitDirList(value) {
  if (isArray(value)) {
    return value.filter(function(v) { return isString(v) || v instanceof java.lang.String })
      .map(function(v) { return String(v).trim() })
      .filter(function(v) { return v.length > 0 })
  }
  if (isString(value) || value instanceof java.lang.String) {
    return String(value).split(",").map(function(v) { return v.trim() }).filter(function(v) { return v.length > 0 })
  }
  return []
}

// Priority: an explicit options.homedir (lets tests/callers redirect without the global
// __gHDir side effect) > the __gHDir() override mini-a-con.js sets from a homedir= CLI arg
// > the JVM's user.home.
function __miniAPluginBaseHomeDir(options) {
  options = isMap(options) ? options : {}
  if ((isString(options.homedir) || options.homedir instanceof java.lang.String) && String(options.homedir).trim().length > 0) {
    return String(options.homedir).trim()
  }
  var gBase = __
  if (typeof __gHDir === "function") {
    try {
      var g = __gHDir()
      if (isString(g) || g instanceof java.lang.String) gBase = String(g)
    } catch (ignoreGHDirError) {}
  }
  if (isString(gBase) && gBase.length > 0) return gBase
  var userHome = java.lang.System.getProperty("user.home")
  return (isString(userHome) || userHome instanceof java.lang.String) ? String(userHome) : "."
}

// __miniAPluginResolveExplicit: each entry in options.plugins IS a plugin directory.
function __miniAPluginResolveExplicit(options) {
  options = isMap(options) ? options : {}
  var roots = []
  var seen = {}
  __miniAPluginSplitDirList(options.plugins).forEach(function(d) {
    var expanded = __miniAPluginExpandHomePath(d)
    var canonical
    try { canonical = String(new java.io.File(expanded).getCanonicalPath()) } catch (e) { return }
    if (seen[canonical]) return
    seen[canonical] = true
    roots.push(canonical)
  })
  return roots
}

// __miniAPluginResolveRoots: each entry in options.pluginsroot/pluginsroots CONTAINS plugin subfolders.
function __miniAPluginResolveRoots(options) {
  options = isMap(options) ? options : {}
  var roots = []
  var seen = {}
  var addRoot = function(pathValue) {
    var expanded = __miniAPluginExpandHomePath(pathValue)
    var canonical
    try { canonical = String(new java.io.File(expanded).getCanonicalPath()) } catch (e) { return }
    if (seen[canonical]) return
    if (!io.fileExists(canonical)) return
    var info = io.fileInfo(canonical)
    if (isUnDef(info) || info.isDirectory !== true) return
    seen[canonical] = true
    roots.push(canonical)
  }

  __miniAPluginSplitDirList(options.pluginsroot).forEach(addRoot)
  __miniAPluginSplitDirList(options.pluginsroots).forEach(addRoot)

  if (roots.length === 0) {
    addRoot(__miniAPluginBaseHomeDir(options) + java.io.File.separator + ".openaf-mini-a" + java.io.File.separator + "plugins")
  }
  return roots
}

