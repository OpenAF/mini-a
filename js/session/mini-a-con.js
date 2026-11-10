if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")
// Author: Nuno Aguiar
// License: Apache 2.0
// Terminal entry point. Command behavior is shared with Advanced web sessions.
try {
  var miniASessionBase = __miniAPackageRoot
  loadLib(miniASessionBase + "/js/session/mini-a-session.js")
  MiniAInteractiveSession(processExpr(" "))
} catch(e) { $err(e) }
