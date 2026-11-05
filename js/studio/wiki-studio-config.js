// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
var wikiStudioConfig = function(args, base) {
  var home = WikiStudio.canonical(String(args.studiohome || (java.lang.System.getProperty("user.home") + "/.openaf-mini-a/wiki-studio")))
  WikiStudio.noLinks(home); WikiStudio.privateDir(home)
  var roots
  try { roots = JSON.parse(String(args.studioallowroots || "[]")) } catch(e) { throw new Error("studioallowroots must be a JSON array") }
  WikiStudio.assert(isArray(roots), 400, "invalid_config", "studioallowroots must be a JSON array")
  roots = roots.map(function(p) {
    WikiStudio.noLinks(p)
    var r = WikiStudio.canonical(p)
    WikiStudio.assert(new java.io.File(r).isDirectory() && !/^\/(?:System|Library|Applications|etc|private\/etc|usr|bin|sbin|var|private\/var)(?:\/|$)/.test(r) && r.split("/").length > 2 && !/(?:^|\/)\.[^/]+/.test(r), 400, "unsafe_allowroot", "Choose a dedicated data directory as allowroot")
    WikiStudio.assert(!WikiStudio.inside(r, home), 400, "unsafe_allowroot", "Allowroot cannot be inside Studio home")
    return r
  })
  var port = Number(args.onport || 8890)
  WikiStudio.assert(port > 0 && port < 65536 && Math.floor(port) === port, 400, "invalid_port", "Invalid port")
  // Remote listeners are deliberately unavailable until a separately audited proxy configuration exists.
  WikiStudio.assert(!args.studiohost || args.studiohost === "127.0.0.1", 400, "invalid_host", "Studio binds only 127.0.0.1; use a trusted HTTPS reverse proxy")
  var token = String(getEnv("STUDIO_TOKEN") || "")
  if (!token) {
    var b = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32); new java.security.SecureRandom().nextBytes(b)
    token = String(java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b))
    print("Wiki Studio access token (this process only): " + token)
  }
  WikiStudio.assert(token.length >= 32, 400, "weak_token", "STUDIO_TOKEN must contain at least 32 characters")
  var directories=[]
  if(args.studiosourcedirs) {
    try{directories=JSON.parse(String(args.studiosourcedirs))}catch(e){throw new Error("studiosourcedirs must be a JSON array")}
    WikiStudio.assert(isArray(directories)&&directories.length<=50,400,"invalid_config","Invalid source-directory allowlist")
    var seen={}
    directories=directories.map(function(d){WikiStudio.fields(d,["id","path"]);WikiStudio.name(d.id);WikiStudio.assert(!seen[d.id],400,"invalid_config","Duplicate directory ID");seen[d.id]=true;WikiStudio.noLinks(d.path);var path=WikiStudio.canonical(d.path);WikiStudio.assert(new java.io.File(path).isDirectory()&&!WikiStudio.inside(path,home)&&path.split("/").length>3&&!/(?:^|\/)\.[^/]+/.test(path),400,"invalid_config","Choose a dedicated visible source directory");return{id:d.id,path:path,identity:WikiStudio.identity(path)}})
  }
  var c = { home: home, roots: roots, host: "127.0.0.1", port: port, token: token, openBrowser: !(args.openbrowser === false || String(args.openbrowser) === "false"), graphNonce: WikiStudio.id(), maxPageBytes: 1048576, maxBodyBytes: 2097152, workers: 2, base: __miniAPath(".", base) }
  c.directories=directories
  ;["sources", "jobs", "backups", "graph-cache", "locks", "audit"].forEach(function(d) { WikiStudio.privateDir(home + "/" + d) })
  WikiStudio.atomic(home + "/config.json", { version: 1, host: c.host, port: port, roots: roots, maxPageBytes: c.maxPageBytes, workers: c.workers })
  return c
}
