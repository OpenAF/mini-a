// Server configuration stays separate from per-request embedding data.
var MiniAWebEmbed = {
  init: function(args) {
    loadLib(__miniAPath("public/embed-context.js"))
    var enabled = toBoolean(args.webembed) === true
    var config = { enabled: enabled, origins: [], fields: {}, contextRequired: args.webembedcontextrequired !== false, prompt: args.webembedprompt === true, maxPromptChars: args.maxpromptchars || 120000 }
    if (enabled) {
      var origins = args.webembedorigins
      if (isString(origins)) origins = origins.trim().charAt(0) === "[" ? af.fromJSSLON(origins) : origins.split(",").map(function(o) { return o.trim() })
      if (!isArray(origins) || !origins.length || origins.length > 32) throw new Error("webembedorigins must contain 1 to 32 exact HTTP(S) origins")
      config.origins = origins.map(function(origin) {
        if (!isString(origin) || !/^https?:\/\//.test(origin) || /[\s*'"<>]/.test(origin)) throw new Error("Invalid webembedorigins origin")
        var uri = new java.net.URI(origin), host = uri.getHost(), port = uri.getPort()
        if (host === null || uri.getRawUserInfo() !== null || uri.getRawQuery() !== null || uri.getRawFragment() !== null || String(uri.getRawPath() || "") !== "" || port > 65535 || port === 0) throw new Error("webembedorigins requires origins without paths or credentials")
        var scheme = String(uri.getScheme()), normalized = scheme + "://" + String(host).toLowerCase()
        if (port !== -1 && !(scheme === "https" && port === 443) && !(scheme === "http" && port === 80)) normalized += ":" + port
        return normalized
      }).filter(function(origin, index, list) { return list.indexOf(origin) === index })
      var fields = isString(args.webembedfields) ? af.fromJSSLON(args.webembedfields) : args.webembedfields
      config.fields = MiniAEmbedContext.fields(isUnDef(fields) ? {} : fields)
      if (config.contextRequired && !Object.keys(config.fields).length) throw new Error("webembedfields is required when webembedcontextrequired=true")
    }
    this.config = config
    return config
  },
  validate: function(data) {
    if (!Object.prototype.hasOwnProperty.call(data, "embed")) return null
    return MiniAEmbedContext.envelope(data.embed, this.config)
  },
  protectResponse: function(response) {
    if (!this.config || !this.config.enabled || !response || !/text\/html/i.test(String(response.mimetype))) return response
    var headers = response.header || {}, policy = "frame-ancestors " + this.config.origins.join(" "), existing
    Object.keys(headers).forEach(function(key) { if (key.toLowerCase() === "content-security-policy") existing = key })
    // Multiple policies intersect; retain any existing policy rather than weakening it.
    headers[existing || "Content-Security-Policy"] = existing ? String(headers[existing]) + ", " + policy : policy
    response.header = headers
    return response
  }
}
