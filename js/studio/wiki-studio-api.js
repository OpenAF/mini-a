// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
loadLib(__miniAPath("js/studio/wiki-studio-registry.js"))
var WikiStudioServer = function(config) { this.config = config; this.registry = new WikiStudioRegistry(config) }
WikiStudioServer.prototype.auth = function(headers, method) {
  var c = this.config, host = headers.host || "", origin = headers.origin
  WikiStudio.assert(["127.0.0.1:" + c.port, "localhost:" + c.port].indexOf(host) >= 0, 403, "invalid_host", "Host rejected")
  if (origin) WikiStudio.assert(["http://127.0.0.1:" + c.port, "http://localhost:" + c.port].indexOf(origin) >= 0, 403, "invalid_origin", "Cross-origin requests are denied")
  WikiStudio.assert(java.security.MessageDigest.isEqual(WikiStudio.bytes(headers.authorization || ""), WikiStudio.bytes("Bearer " + c.token)), 401, "unauthorized", "A valid bearer token is required")
  return "admin"
}
WikiStudioServer.prototype.publicWiki = function(w, role) {
  var result = JSON.parse(JSON.stringify(w)); delete result.identity
  if (role !== "admin") delete result.root
  result.capabilities = WikiStudioRegistry.capabilities(w); return result
}
WikiStudioServer.prototype.audit = function(id, role, action, wikiId) {
  var c = this.config, file = c.home + "/audit/" + WikiStudio.now().substring(0, 10) + ".ndjson"
  WikiStudio.lock(c.home, "audit", function() {
    WikiStudio.noLinks(file)
    if (new java.io.File(file).length() > 8388608) WikiStudio.fail(507, "audit_full", "Audit log limit reached; archive it locally before further writes")
    var out = new java.io.FileOutputStream(file, true)
    try { out.write(WikiStudio.bytes(JSON.stringify({ requestId: id, time: WikiStudio.now(), role: role, action: action, wikiId: wikiId || null }) + "\n")); out.getFD().sync() } finally { out.close() }
  })
}
WikiStudioServer.prototype.dispatch = function(req) {
  var role = req.role || this.auth(req.headers, req.method), p = req.path.split("/").filter(Boolean), q = req.query || {}, body = req.body || {}, self = this
  var read = req.method === "GET", c = this.config
  WikiStudio.assert(p[0] === "api" && p[1] === "v1", 404, "not_found", "Route not found")
  if (read && p.length === 3 && p[2] === "health") return { ok: true, version: 1 }
  if (read && p.length === 3 && p[2] === "session") return { role: role, version: 1, webJob: c.base + "/mini-a-web.yaml", canTestWiki: String(getEnv("OAF_MODEL") || "").trim().length > 0, csrf: "bearer-header-and-same-origin", backends: { fs: "supported", mounts: "unavailable in Studio", s3: "unavailable in Studio", es: "unavailable in Studio", http: "unavailable in Studio", archive: "unavailable in Studio" }, adapters: { upload: true, directory: (c.directories||[]).map(function(d){return{id:d.id}}), git: "allowlisted-local-checkout-only", url: true, youtube: true }, limits: { pageBytes: c.maxPageBytes } }
  if (p[2] === "wikis" && p.length === 3) {
    if (read) return WikiStudioServer.paginate(this.registry.list().map(function(w) { return self.publicWiki(w, role) }), q)
    if (req.method === "POST") { WikiStudio.authorize(role, "admin"); return this.publicWiki(this.registry.add(body), role) }
  }
  if(read&&p.length===3&&p[2]==="search") {
    WikiStudio.assert(isString(q.q)&&q.q.length>0&&q.q.length<=1000,400,"invalid_query","A search query is required")
    var hits=[],coverage=[],wikis=this.registry.list()
    wikis.slice(0,20).forEach(function(w){
      try {
        var result=self.wikiRoute({method:"GET",query:{q:q.q,limit:100}},self.registry.verify(w),["search"],role)
        var items=isArray(result)?result:result.results||[]
        items.forEach(function(hit){var decorated=JSON.parse(JSON.stringify(hit));decorated.wikiId=w.id;decorated.sourceNamespace=w.id+":";hits.push(decorated)})
        coverage.push({wikiId:w.id,outcome:result.outcome||"not-reported",warning:result.warning||null,sources:result.sources||null,truncated:result.truncated===true})
      } catch(e){coverage.push({wikiId:w.id,outcome:"unavailable",warning:e.status?e.message:"Wiki search unavailable"})}
    })
    hits.sort(function(a,b){return Number(b.score||0)-Number(a.score||0)||a.wikiId.localeCompare(b.wikiId)||String(a.path).localeCompare(String(b.path))})
    var aggregate=WikiStudioServer.paginate(hits,q);aggregate.coverage=coverage;aggregate.warning="Coordinated per-wiki search; absence does not establish complete coverage.";aggregate.wikisOmitted=Math.max(0,wikis.length-20);return aggregate
  }
  if (p[2] === "audit" && p.length === 3 && read) {
    WikiStudio.authorize(role, "admin")
    var events = []
    io.listFiles(c.home + "/audit").files.filter(function(f) { return /\.ndjson$/.test(f.filename) }).sort(function(a, b) { return b.filename.localeCompare(a.filename) }).slice(0, 7).forEach(function(f) { io.readFileString(f.filepath).split("\n").filter(Boolean).forEach(function(l) { events.push(JSON.parse(l)) }) })
    return WikiStudioServer.paginate(events.reverse(), q)
  }
  if (p[2] === "wikis" && p.length >= 4) {
    var w = this.registry.verify(this.registry.get(p[3]))
    if (p.length === 4) {
      if (read) return this.publicWiki(w, role)
      WikiStudio.authorize(role, "admin")
      return WikiStudio.wikiLock(c.home, w.id, function() {
        if (req.method === "PATCH") return self.registry.update(w.id, body, false)
        if (req.method === "DELETE") return self.registry.update(w.id, {}, true)
        WikiStudio.fail(405, "method_not_allowed", "Method not allowed")
      })
    }
    if (p.length === 5 && p[4] === "test" && req.method === "POST") return this.testWiki(w, body, role)
    if (p.length === 5 && p[4] === "test" && (read || req.method === "DELETE")) {
      WikiStudio.authorize(role, "admin")
      return WikiStudio.lock(c.home, "test-" + w.id, function() {
        var servers = self.testServers || {}, items = []
        if (req.method === "DELETE") { WikiStudio.fields(body, ["advanced"]); WikiStudio.assert(isBoolean(body.advanced), 400, "invalid_options", "Advanced must be boolean") }
        ;[false, true].forEach(function(advanced) {
          var key = w.id + ":" + advanced, server = servers[key]
          if (!server) return
          if (req.method === "DELETE" && body.advanced === advanced) { server.process.destroy(); server.process.waitFor(); delete servers[key]; return }
          if (!server.process.isAlive()) { delete servers[key]; return }
          items.push({advanced:advanced,url:server.url})
        })
        return {items:items}
      })
    }
    if (this.wikiRoute) return this.wikiRoute(req, w, p.slice(4), role)
  }
  if (this.extraRoute) return this.extraRoute(req, p, role)
  WikiStudio.fail(405, "method_not_allowed", "Unknown route or method")
}
WikiStudioServer.paginate = function(items, q) {
  var offset = Number(q.offset || 0), limit = Number(q.limit || 100)
  WikiStudio.assert(isFinite(offset) && Math.floor(offset) === offset && offset >= 0 && isFinite(limit) && Math.floor(limit) === limit && limit > 0 && limit <= 200, 400, "invalid_paging", "Invalid offset/limit")
  return { items: items.slice(offset, offset + limit), total: items.length, offset: offset, limit: limit, truncated: offset + limit < items.length }
}
WikiStudioServer.prototype.start = function() {
  var self = this, c = this.config
  java.lang.System.setProperty("sun.net.httpserver.maxReqTime", "60")
  java.lang.System.setProperty("sun.net.httpserver.maxRspTime", "60")
  java.lang.System.setProperty("sun.net.httpserver.maxConnections", "64")
  var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress(c.host, c.port), 32)
  server.createContext("/", new com.sun.net.httpserver.HttpHandler({ handle: function(ex) { self.handle(ex) } }))
  this._httpExecutor=java.util.concurrent.Executors.newFixedThreadPool(8)
  server.setExecutor(this._httpExecutor); this.http = server
  if (this.startJobs) this.startJobs()
  server.start()
  var url = "http://127.0.0.1:" + c.port
  print("Wiki Studio: " + url)
  if (c.openBrowser) this.openBrowser(url + "/#token=" + encodeURIComponent(c.token))
}
WikiStudioServer.prototype.openBrowser = function(url) {
  // The token travels in the URL fragment, which browsers never send to the server.
  try {
    if (java.awt.Desktop.isDesktopSupported()) {
      java.awt.Desktop.getDesktop().browse(new java.net.URI(url))
      return
    }
  } catch(ignoreDesktop) {}
  logWarn("Could not open the browser automatically. Open " + "http://127.0.0.1:" + this.config.port + " and paste the access token.")
}
WikiStudioServer.prototype.stop = function() {
  var server=this.http;this.http=null
  if(server)server.stop(5)
  if(this._httpExecutor)this._httpExecutor.shutdown()
  if(this._lease){try{this._lease.lock.release()}finally{this._lease.channel.close();this._lease.file.close();this._lease=null}}
  // Workers retain their own wiki locks and durable records. Do not kill an
  // active engine or claim that shutting down the listener undoes its writes.
}
WikiStudioServer.prototype.handle = function(ex) {
  var id = WikiStudio.id(), status = 200, mime = "application/json; charset=utf-8", result, c = this.config, headers = {}, role
  var response = ex.getResponseHeaders()
  response.set("Cache-Control", "no-store"); response.set("X-Content-Type-Options", "nosniff"); response.set("Referrer-Policy", "no-referrer")
  response.set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'nonce-" + c.graphNonce + "'; style-src 'self' 'nonce-" + c.graphNonce + "'; connect-src 'self'; img-src 'self' data: blob:; frame-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors http://127.0.0.1:" + c.port + " http://localhost:" + c.port)
  response.set("X-Request-ID", id)
  try {
    var uri = ex.getRequestURI(), path = String(uri.getPath()), method = String(ex.getRequestMethod()), rawPath = String(uri.getRawPath())
    WikiStudio.assert(!/%|[\x00-\x1f]/.test(rawPath) && !/\/\//.test(path), 400, "invalid_route", "Encoded route paths are not accepted")
    var iterator = ex.getRequestHeaders().entrySet().iterator()
    while (iterator.hasNext()) { var item = iterator.next(); WikiStudio.assert(item.getValue().size() === 1, 400, "duplicate_header", "Duplicate headers are not accepted"); headers[String(item.getKey()).toLowerCase()] = String(item.getValue().get(0)) }
    if (path.indexOf("/api/") !== 0) {
      WikiStudio.assert(method === "GET", 405, "method_not_allowed", "Method not allowed")
      var assets = { "/": ["index.html", "text/html"], "/studio.js": ["studio.js", "text/javascript"], "/studio.css": ["studio.css", "text/css"], "/js/openafsigil.js": ["js/openafsigil.js", "text/javascript", 1], "/js/chart.js": ["js/chart.js", "text/javascript", 1], "/js/njsmap.js": ["js/njsmap.js", "text/javascript", 1] }, asset = assets[path]
      WikiStudio.assert(asset, 404, "not_found", "Asset not found")
      mime = asset[1] + "; charset=utf-8"; result = asset[2] ? io.readFileString(getOpenAFJar() + "::" + asset[0]) : io.readFileString(c.base + "/public/studio/" + asset[0])
    } else {
      role = this.auth(headers, method)
      var query = {}, rawQuery = String(uri.getRawQuery() || "")
      if (rawQuery !== "null" && rawQuery) rawQuery.split("&").forEach(function(pair) {
        var pos = pair.indexOf("="), key = decodeURIComponent(pos < 0 ? pair : pair.substring(0, pos)), value = decodeURIComponent(pos < 0 ? "" : pair.substring(pos + 1).replace(/\+/g, " "))
        WikiStudio.assert(!Object.prototype.hasOwnProperty.call(query, key) && ["__proto__", "constructor", "prototype", "token"].indexOf(key) < 0, 400, "invalid_query", "Duplicate or forbidden query key")
        query[key] = value
      })
      var req = { method: method, path: path, query: query, headers: headers, requestId: id, role: role }
      if (this.streamUpload && path === "/api/v1/uploads" && method === "POST") { this.audit(id,role,"POST /api/v1/uploads"); result = this.streamUpload(req, ex.getRequestBody()) }
      else if (this.streamExport && method === "GET" && /^\/api\/v1\/wikis\/[^/]+\/exports\/[a-f0-9-]{36}\/download$/.test(path)) { this.streamExport(req, ex, role); return }
      else if (this.streamEvents && /^\/api\/v1\/jobs\/[a-z0-9-]+\/events$/.test(path) && method === "GET") { this.streamEvents(req, ex); return }
      else {
        var stream = ex.getRequestBody(), out = new java.io.ByteArrayOutputStream(), buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192), n, size = 0
        try { while ((n = stream.read(buffer)) !== -1) { size += n; WikiStudio.assert(size <= c.maxBodyBytes, 413, "payload_limit", "Request exceeds byte limit"); out.write(buffer, 0, n) } } finally { stream.close() }
        if (size) {
          WikiStudio.assert(/^application\/json(?:;|$)/i.test(headers["content-type"] || ""), 415, "content_type", "Use application/json")
          try { req.body = JSON.parse(String(out.toString("UTF-8"))) } catch(e) { WikiStudio.fail(400, "invalid_json", "Malformed JSON") }
          WikiStudio.assert(isMap(req.body), 400, "invalid_body", "Expected JSON object")
        }
        if (method !== "GET") this.audit(id, role, method + " " + path, path.split("/")[4])
        result = this.dispatch(req)
      }
      if (result && result.studioHtml) { mime = "text/html; charset=utf-8"; result = result.studioHtml }
    }
  } catch(e) {
    status = e.status || 500
    mime = "application/json; charset=utf-8"
    result = { error: { code: e.code || "internal_error", message: e.status ? e.message : "Operation failed; inspect local state and job history", details: e.details }, requestId: id }
  }
  try {
    var bytes = WikiStudio.bytes(mime.indexOf("application/json") === 0 ? JSON.stringify(result) : result)
    if (bytes.length > 8388608) { status = 413; mime = "application/json"; bytes = WikiStudio.bytes('{"error":{"code":"result_limit","message":"Result exceeds byte limit"}}') }
    response.set("Content-Type", mime); ex.sendResponseHeaders(status, bytes.length); ex.getResponseBody().write(bytes)
  } finally { ex.close() }
}

// Test servers inherit model credentials through the environment, never the response.
WikiStudioServer.prototype.testWiki = function(w, body, role) {
  WikiStudio.authorize(role, "admin")
  WikiStudio.fields(body, ["advanced"])
  WikiStudio.assert(isBoolean(body.advanced), 400, "invalid_options", "Advanced must be boolean")
  WikiStudio.assert(String(getEnv("OAF_MODEL") || "").trim().length > 0, 422, "model_required", "Configure OAF_MODEL before testing a wiki")
  var self = this
  return WikiStudio.lock(this.config.home, "test-" + w.id, function() {
    self.testServers = self.testServers || {}
    var key = w.id + ":" + body.advanced, existing = self.testServers[key]
    if (existing && existing.process.isAlive()) return {url: existing.url}
    var socket = new java.net.ServerSocket(0), port = socket.getLocalPort(); socket.close()
    var token = WikiStudio.id() + WikiStudio.id(), command = new java.util.ArrayList()
    ;[String(getOpenAFPath()) + "/ojob", self.config.base + "/mini-a-web.yaml", "onport=" + port, "usewiki=true", "wikiroot=" + w.root, "wikiaccess=ro", "wikiretrievalv2=true", "useshell=false", "webadvanced=" + body.advanced, "webtoken=" + token].forEach(function(arg) { command.add(String(arg)) })
    var child = new java.lang.ProcessBuilder(command).directory(new java.io.File(self.config.base)).redirectOutput(java.lang.ProcessBuilder.Redirect.DISCARD).redirectError(java.lang.ProcessBuilder.Redirect.DISCARD).start()
    var url = "http://localhost:" + port + "/#token=" + encodeURIComponent(token), ready = false
    try {
      for (var i = 0; i < 120 && child.isAlive(); i++) {
        var probe = new java.net.Socket()
        try { probe.connect(new java.net.InetSocketAddress("127.0.0.1", port), 100); ready = true; break } catch(ignore) {} finally { probe.close() }
        java.lang.Thread.sleep(250)
      }
      WikiStudio.assert(ready, 503, "test_start_failed", "Test server did not start within 30 seconds")
      java.lang.Runtime.getRuntime().addShutdownHook(new java.lang.Thread(function() { child.destroy() }))
      self.testServers[key] = {process:child,url:url}
      return {url:url}
    } catch(e) { child.destroy(); throw e }
  })
}
