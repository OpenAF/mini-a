// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

loadLib(__miniAPath("js/studio/wiki-studio-common.js"))
// Bounded outbound transport for Studio source adapters (webpage, YouTube captions).
// Every connection goes to an IP that this code resolved and validated itself, so
// DNS rebinding between "check" and "connect" cannot redirect a request to a
// private network. TLS still validates the certificate against the original host.
var WikiStudioOutbound = {
  maxBytes: 5242880, maxHeaderBytes: 65536, maxRedirects: 5, timeoutMs: 30000, ports: [80, 443]
}
WikiStudioOutbound.fail = function(code, message) { WikiStudio.fail(502, code, message) }
WikiStudioOutbound.publicAddress = function(addr) {
  if (addr.isAnyLocalAddress() || addr.isLoopbackAddress() || addr.isLinkLocalAddress() || addr.isSiteLocalAddress() || addr.isMulticastAddress()) return false
  var b = [], raw = addr.getAddress()
  for (var i = 0; i < raw.length; i++) b.push(raw[i] & 255)
  if (b.length === 4) {
    if (b[0] === 0 || b[0] >= 240) return false
    if (b[0] === 100 && b[1] >= 64 && b[1] <= 127) return false
    if (b[0] === 192 && b[1] === 0 && b[2] === 0) return false
    if (b[0] === 192 && b[1] === 0 && b[2] === 2 || b[0] === 198 && b[1] === 51 && b[2] === 100 || b[0] === 203 && b[1] === 0 && b[2] === 113) return false
    if (b[0] === 198 && (b[1] === 18 || b[1] === 19)) return false
    return true
  }
  if ((b[0] & 254) === 252) return false                                   // fc00::/7 unique local
  if (b[0] === 32 && b[1] === 1 && b[2] === 13 && b[3] === 184) return false // 2001:db8::/32 documentation
  if (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0 && b[10] === 255 && b[11] === 255) return false // v4-mapped
  if (b[0] === 100 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return false // NAT64
  return true
}
WikiStudioOutbound.parse = function(target) {
  var uri
  try { uri = new java.net.URI(String(target)) } catch(e) { WikiStudio.fail(400, "invalid_url", "Provide a valid absolute http(s) URL") }
  var scheme = String(uri.getScheme()).toLowerCase(), host = uri.getHost()
  WikiStudio.assert(["http", "https"].indexOf(scheme) >= 0 && host, 400, "invalid_url", "Only absolute http(s) URLs are accepted")
  WikiStudio.assert(uri.getUserInfo() === null, 400, "invalid_url", "Credentials in URLs are not accepted")
  var port = uri.getPort() < 0 ? (scheme === "https" ? 443 : 80) : Number(uri.getPort())
  WikiStudio.assert(this.ports.indexOf(port) >= 0, 400, "invalid_url", "Only ports 80 and 443 are allowed")
  var path = String(uri.getRawPath() || "/") || "/", query = uri.getRawQuery()
  return { uri: uri, scheme: scheme, host: String(host), port: port, path: path + (query ? "?" + query : ""), href: String(uri.toString()) }
}
WikiStudioOutbound.resolve = function(host) {
  var addrs
  try { addrs = java.net.InetAddress.getAllByName(host) } catch(e) { WikiStudioOutbound.fail("dns_failure", "Host could not be resolved") }
  var list = []
  for (var i = 0; i < addrs.length; i++) list.push(addrs[i])
  WikiStudio.assert(list.length > 0, 502, "dns_failure", "Host could not be resolved")
  var self = this
  // Strict: if any answer is non-public the whole host is refused (no mixed-answer tricks).
  WikiStudio.assert(list.every(function(a) { return self.publicAddress(a) }), 403, "outbound_blocked", "Host resolves to a non-public address")
  return list[0]
}
WikiStudioOutbound.once = function(p, method, body, headers, deadline) {
  var addr = this.resolve(p.host), remaining = function() { var r = deadline - new Date().getTime(); if (r <= 0) WikiStudioOutbound.fail("timeout", "Outbound request timed out"); return r }
  var socket = new java.net.Socket()
  try {
    socket.connect(new java.net.InetSocketAddress(java.net.InetAddress.getByAddress(p.host, addr.getAddress()), p.port), Math.min(remaining(), 10000))
    socket.setSoTimeout(Math.min(remaining(), 15000))
    var active = socket
    if (p.scheme === "https") {
      var ssl = javax.net.ssl.SSLSocketFactory.getDefault().createSocket(socket, p.host, p.port, true), params = ssl.getSSLParameters()
      params.setEndpointIdentificationAlgorithm("HTTPS")
      params.setServerNames(java.util.Collections.singletonList(new javax.net.ssl.SNIHostName(p.host)))
      ssl.setSSLParameters(params); ssl.startHandshake(); active = ssl
    }
    var payload = isDef(body) ? new java.lang.String(body).getBytes("UTF-8") : null
    var lines = [method + " " + p.path + " HTTP/1.1", "Host: " + p.host + (p.port === (p.scheme === "https" ? 443 : 80) ? "" : ":" + p.port),
      "User-Agent: Mozilla/5.0 (compatible; Mini-A-Wiki-Studio)", "Accept-Encoding: identity", "Connection: close"]
    Object.keys(headers || {}).forEach(function(k) { lines.push(k + ": " + String(headers[k]).replace(/[\r\n]/g, " ")) })
    if (payload) lines.push("Content-Length: " + payload.length)
    var out = active.getOutputStream()
    out.write(new java.lang.String(lines.join("\r\n") + "\r\n\r\n").getBytes("ISO-8859-1"))
    if (payload) out.write(payload)
    out.flush()
    var input = new java.io.BufferedInputStream(active.getInputStream()), head = new java.io.ByteArrayOutputStream(), tail = 0, c
    while ((c = input.read()) >= 0) {
      head.write(c); tail = (c === 13 || c === 10) ? (tail + 1) : 0
      if (tail === 4) break
      WikiStudio.assert(head.size() <= this.maxHeaderBytes, 502, "response_too_large", "Response headers exceed limit")
    }
    WikiStudio.assert(tail === 4, 502, "bad_response", "Malformed HTTP response")
    var rows = String(head.toString("ISO-8859-1")).split(/\r\n/), status = Number((rows[0].match(/^HTTP\/1\.[01] (\d{3})/) || [])[1])
    WikiStudio.assert(status > 0, 502, "bad_response", "Malformed HTTP status line")
    var hdr = {}
    rows.slice(1).forEach(function(r) { var i = r.indexOf(":"); if (i > 0) hdr[r.substring(0, i).trim().toLowerCase()] = r.substring(i + 1).trim() })
    var data = new java.io.ByteArrayOutputStream(), buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192), max = this.maxBytes
    var append = function(n) { WikiStudio.assert(data.size() + n <= max, 413, "response_too_large", "Response exceeds the " + max + " byte limit") }
    if (method !== "HEAD" && status !== 204 && status !== 304) {
      if (/chunked/i.test(hdr["transfer-encoding"] || "")) {
        for (;;) {
          remaining()
          var size = "", ch
          while ((ch = input.read()) >= 0 && ch !== 10) if (ch !== 13) size += String.fromCharCode(ch)
          var len = parseInt(size.split(";")[0].trim(), 16)
          WikiStudio.assert(isFinite(len) && len >= 0, 502, "bad_response", "Malformed chunk")
          if (len === 0) break
          append(len)
          while (len > 0) { var n = input.read(buf, 0, Math.min(8192, len)); WikiStudio.assert(n > 0, 502, "bad_response", "Truncated chunk"); data.write(buf, 0, n); len -= n }
          input.read(); input.read()
        }
      } else {
        var expected = isDef(hdr["content-length"]) ? Number(hdr["content-length"]) : -1, got = 0, n
        WikiStudio.assert(expected < 0 || isFinite(expected) && expected >= 0, 502, "bad_response", "Malformed Content-Length")
        append(Math.max(expected, 0))
        while ((n = input.read(buf, 0, 8192)) > 0) { remaining(); append(n); data.write(buf, 0, n); got += n; if (expected >= 0 && got >= expected) break }
      }
    }
    return { status: status, headers: hdr, bytes: data.toByteArray(), url: p.href }
  } catch(e) {
    if (e && e.status) throw e
    var m = String(e && e.javaException ? e.javaException : e)
    if (/Timeout/i.test(m)) WikiStudioOutbound.fail("timeout", "Outbound request timed out")
    WikiStudioOutbound.fail("network_error", "Outbound request failed (network or TLS error)")
  } finally { try { socket.close() } catch(ignore) {} }
}
// GET/POST with manual redirect following; every hop is re-parsed, re-resolved and re-validated.
WikiStudioOutbound.request = function(target, opts) {
  opts = opts || {}
  var deadline = new Date().getTime() + (opts.timeout || this.timeoutMs), method = opts.body !== undefined ? "POST" : "GET", url = target
  for (var hop = 0; hop <= this.maxRedirects; hop++) {
    var res = this.once(this.parse(url), method, opts.body, opts.headers, deadline)
    if ([301, 302, 303, 307, 308].indexOf(res.status) >= 0 && res.headers.location) {
      var next
      try { next = new java.net.URI(url).resolve(new java.net.URI(res.headers.location)).toString() } catch(e) { WikiStudioOutbound.fail("bad_redirect", "Invalid redirect location") }
      if (opts.sameHost) WikiStudio.assert(new java.net.URI(next).getHost() === new java.net.URI(url).getHost(), 403, "outbound_blocked", "Cross-host redirect refused")
      url = next
      if (res.status === 303 || (res.status !== 307 && res.status !== 308)) method = "GET"
      if (method === "GET") opts = { timeout: opts.timeout, headers: opts.headers, sameHost: opts.sameHost }
      continue
    }
    res.finalUrl = url
    return res
  }
  WikiStudioOutbound.fail("too_many_redirects", "Too many redirects")
}
WikiStudioOutbound.text = function(res, fallbackCharset) {
  var type = String(res.headers["content-type"] || ""), cs = (type.match(/charset=["']?([\w.:-]+)/i) || [])[1]
  var head = String(new java.lang.String(res.bytes, 0, Math.min(res.bytes.length, 4096), "ISO-8859-1"))
  if (!cs) cs = (head.match(/<meta[^>]+charset=["']?([\w.:-]+)/i) || [])[1]
  var set = "UTF-8"
  try { set = String(java.nio.charset.Charset.forName(cs || fallbackCharset || "UTF-8").name()) } catch(e) {}
  return String(new java.lang.String(res.bytes, set))
}
WikiStudioOutbound.ok = function(res, stage) {
  WikiStudio.assert(res.status >= 200 && res.status < 300, 502, "upstream_error", stage + " returned HTTP " + res.status + (res.status === 429 ? " (rate limited; retry later)" : ""))
  return res
}
WikiStudioOutbound.htmlToMarkdown = function(html) {
  try { loadLib("mdconvert.js"); var md = mdconvert.html2md(html); if (isString(md) && md.trim().length) return md } catch(e) {}
  return String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function(_, l, t) { return "\n" + new Array(Number(l) + 1).join("#") + " " + t.replace(/<[^>]+>/g, "").trim() + "\n" })
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<(br|\/p|\/div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}
// Webpage → { name, markdown, origin }
WikiStudioOutbound.webpage = function(target) {
  var res = this.ok(this.request(target, { headers: { Accept: "text/html,application/xhtml+xml,text/markdown,text/plain;q=0.8", "Accept-Language": "en-US,en;q=0.9" } }), "Page")
  var type = String(res.headers["content-type"] || "text/html").toLowerCase()
  WikiStudio.assert(/^(text\/(html|plain|markdown)|application\/xhtml\+xml)/.test(type), 415, "unsupported_content", "Only HTML, text or Markdown pages can be converted")
  var raw = this.text(res), isHtml = /html/.test(type), title = ((isHtml ? raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null) || [])[1]
  title = title ? title.replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim() : ""
  var md = isHtml ? this.htmlToMarkdown(raw) : raw
  WikiStudio.assert(md.trim().length > 0, 422, "empty_conversion", "The page produced no Markdown text")
  var p = this.parse(res.finalUrl), slug = (p.host + p.path.split("?")[0]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 80) || "page"
  var front = "# " + (title || p.host) + "\n\nSource: " + res.finalUrl.replace(/[()\s]/g, encodeURIComponent) + "\nRetrieved: " + WikiStudio.now() + "\n\n"
  return { name: slug + ".md", markdown: front + md.trim() + "\n", origin: res.finalUrl }
}
// YouTube captions (existing tracks only) → { name, markdown, origin }. Mirrors personal/ytTranscript.yaml.
WikiStudioOutbound.videoId = function(video) {
  video = String(video || "").trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(video)) return video
  var uri
  try { uri = new java.net.URI(video) } catch(e) { WikiStudio.fail(400, "invalid_video", "Provide a YouTube URL or 11-character video ID") }
  var host = String(uri.getHost()).toLowerCase(), path = String(uri.getPath()), id = ""
  WikiStudio.assert(["http", "https"].indexOf(String(uri.getScheme()).toLowerCase()) >= 0 && uri.getUserInfo() === null && uri.getPort() === -1, 400, "invalid_video", "Provide a YouTube HTTP(S) video URL or ID")
  if (host === "youtu.be" || host === "www.youtu.be") id = path.replace(/^\//, "").replace(/\/$/, "")
  else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].indexOf(host) >= 0) {
    if (path === "/watch") { var q = String(uri.getRawQuery()).match(/(?:^|&)v=([^&]+)/); id = q ? decodeURIComponent(q[1]) : "" }
    else { var m = path.match(/^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})\/?$/); id = m ? m[1] : "" }
  } else WikiStudio.fail(400, "invalid_video", "Only YouTube video URLs are supported")
  WikiStudio.assert(/^[a-zA-Z0-9_-]{11}$/.test(id), 400, "invalid_video", "Invalid YouTube video ID; playlists are not supported")
  return id
}
WikiStudioOutbound.youtube = function(video, lang) {
  var self = this, id = this.videoId(video); lang = String(lang || "en").trim()
  WikiStudio.assert(/^[a-zA-Z0-9_-]{1,20}$/.test(lang), 400, "invalid_language", "Invalid caption language code")
  var url = "https://www.youtube.com/watch?v=" + id
  var json = function(res, stage) { try { return JSON.parse(self.text(res)) } catch(e) { WikiStudio.fail(502, "bad_response", stage + " returned invalid JSON") } }
  var page = this.text(this.ok(this.request(url, { sameHost: true, headers: { "Accept-Language": "en-US,en;q=0.9" } }), "Watch page"))
  var key = page.match(/"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"/)
  WikiStudio.assert(key, 502, "youtube_unavailable", "YouTube player configuration is unavailable (consent page, bot check or changed page format)")
  var info = json(this.ok(this.request("https://www.youtube.com/youtubei/v1/player?key=" + key[1], { sameHost: true, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } }, videoId: id }) }), "Player"), "Player")
  WikiStudio.assert(isMap(info) && (info.playabilityStatus || {}).status === "OK", 502, "youtube_unavailable", "YouTube cannot serve this video: " + ((info.playabilityStatus || {}).reason || "unknown status"))
  var details = info.videoDetails || {}
  WikiStudio.assert(details.videoId === id, 502, "youtube_unavailable", "YouTube returned unexpected video metadata")
  var tracks = []
  var renderer = (info.captions || {}).playerCaptionsTracklistRenderer || {}
  ;(isArray(renderer.captionTracks) ? renderer.captionTracks : []).forEach(function(t) {
    if (isString(t.languageCode) && isString(t.baseUrl)) tracks.push({ language: t.languageCode, source: t.kind === "asr" ? "automatic" : "manual", url: t.baseUrl })
  })
  var low = lang.toLowerCase(), candidates = tracks.filter(function(t) { var l = t.language.toLowerCase(); return l === low || l.indexOf(low + "-") === 0 })
  candidates.sort(function(a, b) { var r = function(t) { return (t.source === "manual" ? 0 : 10) + (t.language.toLowerCase() === low ? 0 : 1) }; return r(a) - r(b) })
  WikiStudio.assert(candidates.length, 404, "no_captions", "No captions for language '" + lang + "'. This adapter retrieves existing captions; it does not transcribe audio.")
  var sel = candidates[0], cu
  try { cu = new java.net.URI(sel.url) } catch(e) { WikiStudio.fail(502, "bad_response", "Unexpected caption URL") }
  var ch = String(cu.getHost()).toLowerCase()
  WikiStudio.assert(String(cu.getScheme()) === "https" && (ch === "youtube.com" || /\.youtube\.com$/.test(ch)) && cu.getUserInfo() === null && cu.getPort() === -1 && String(cu.getPath()) === "/api/timedtext", 502, "bad_response", "YouTube returned an unexpected caption URL")
  var capUrl = sel.url.replace(/([?&])fmt=[^&]*&?/g, "$1").replace(/[?&]$/, ""); capUrl += (capUrl.indexOf("?") >= 0 ? "&" : "?") + "fmt=json3"
  var caps = json(this.ok(this.request(capUrl, { sameHost: true }), "Captions"), "Captions"), lines = []
  WikiStudio.assert(isMap(caps) && isArray(caps.events), 502, "bad_response", "Invalid caption response")
  caps.events.forEach(function(e) {
    if (!isArray(e.segs)) return
    var text = e.segs.map(function(s) { return isString(s.utf8) ? s.utf8 : "" }).join("").replace(/\s+/g, " ").trim()
    if (text) lines.push(text)
  })
  WikiStudio.assert(lines.length, 422, "empty_conversion", "The selected caption track contains no text")
  var title = String(details.title || id).replace(/\s+/g, " ").trim()
  var md = "# " + title + "\n\nChannel: " + String(details.author || "").replace(/\s+/g, " ") + "\nSource: " + url + "\nCaptions: " + sel.language + " (" + sel.source + ")\nRetrieved: " + WikiStudio.now() + "\n\n## Transcript\n\n" + lines.join("\n") + "\n"
  return { name: "youtube-" + id + ".md", markdown: md, origin: url }
}
