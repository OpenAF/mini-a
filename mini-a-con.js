// Author: Nuno Aguiar
// License: Apache 2.0
// Terminal entry point. Command behavior is shared with Advanced web sessions.
try {
  var miniASessionBase = io.fileExists("mini-a-session.js") ? "." : getOPackPath("mini-a")
  load(miniASessionBase + "/mini-a-session.js")
  MiniAInteractiveSession(processExpr(" "))
} catch(e) { $err(e) }
