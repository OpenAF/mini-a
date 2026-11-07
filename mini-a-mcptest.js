// Author: Nuno Aguiar
// License: Apache 2.0
// Public entry point; implementation lives under js/.
var __miniAEntryRoot = typeof __loadedfrom === "string" && io.fileExists(__loadedfrom)
  ? String(new java.io.File(__loadedfrom).getCanonicalFile().getParent())
  : (getOPackPath("mini-a") || ".")
loadLib(__miniAEntryRoot + "/js/mini-a-paths.js")
__miniAPackageRoot = __miniAResolvePackageRoot(__miniAEntryRoot)
loadLib(__miniAPath("js/session/mini-a-mcptest.js", __miniAEntryRoot), true)
