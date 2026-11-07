// Author: Nuno Aguiar
// License: Apache 2.0
// Package paths follow the executing source, independently of the caller's cwd.
var __miniAResolvePackageRoot = function(source) {
  var candidates = []
  if (isString(source) && source.length) {
    var dir = new java.io.File(source).getCanonicalFile()
    if (!dir.isDirectory()) dir = dir.getParentFile()
    while (dir !== null) {
      candidates.push(String(dir.getPath()))
      dir = dir.getParentFile()
    }
  }
  var installed = getOPackPath("mini-a")
  if (isDef(installed)) candidates.push(String(installed))
  candidates.push(String(new java.io.File(".").getCanonicalPath()))
  for (var i = 0; i < candidates.length; i++) {
    if (io.fileExists(candidates[i] + "/mini-a.yaml") && io.fileExists(candidates[i] + "/js/mini-a-paths.js")) return candidates[i]
  }
  throw new Error("Cannot locate the Mini-A package for " + source)
}
var __miniAPackageRoot = __miniAResolvePackageRoot(typeof __loadedfrom === "undefined" ? "" : String(__loadedfrom))
var __miniAPath = function(relative, base) {
  return String(new java.io.File(isDef(base) ? base : __miniAPackageRoot, relative || ".").getCanonicalPath())
}
