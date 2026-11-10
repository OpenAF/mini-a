// Shared, dependency-free validation for the iframe and OpenAF HTTP boundary.
var MiniAEmbedContext = (function() {
  var own = function(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
  var map = function(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]" }
  var fail = function(message) { throw new Error(message) }
  var keyOK = function(key) { return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && ["constructor", "prototype", "__proto__"].indexOf(key) < 0 }
  function keys(value, allowed) {
    if (!map(value) || Object.keys(value).some(function(key) { return allowed.indexOf(key) < 0 })) fail("Invalid embedding object")
  }
  function revision(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 && value <= 9007199254740991 && Math.floor(value) === value
  }
  function bytes(text) {
    // JSON.stringify escapes lone surrogates in modern engines; count them safely on Rhino too.
    var total = 0
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i)
      if (c < 128) total++
      else if (c < 2048) total += 2
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { total += 4; i++ }
      else total += 3
    }
    return total
  }
  function fields(value) {
    if (!map(value) || Object.keys(value).length > 32) fail("webembedfields must be an object with at most 32 fields")
    var out = {}
    Object.keys(value).forEach(function(key) {
      if (!keyOK(key)) fail("Invalid embedding field name")
      var field = value[key]
      keys(field, ["type", "required"])
      if (["string", "number", "boolean", "string[]", "number[]", "boolean[]"].indexOf(field.type) < 0 || own(field, "required") && typeof field.required !== "boolean") fail("Invalid embedding field definition: " + key)
      out[key] = { type: field.type, required: field.required === true }
    })
    return out
  }
  function context(value, config) {
    if (value === null) {
      if (config.contextRequired) fail("Parent app context is required before sending a goal")
      return null
    }
    if (!map(value) || Object.keys(value).length > 32) fail("Invalid parent app context")
    var out = {}, names = Object.keys(value)
    if (config.contextRequired && !names.length) fail("Parent app context is required before sending a goal")
    names.forEach(function(key) {
      if (!keyOK(key) || !own(config.fields, key)) fail("Unknown parent app context field")
      var field = config.fields[key], item = value[key], array = /\[\]$/.test(field.type), type = field.type.replace(/\[\]$/, "")
      function scalar(v) {
        if (typeof v !== type || type === "number" && (!isFinite(v) || Math.abs(v) > 9007199254740991) || type === "string" && v.length > 1024) fail("Invalid parent app context value: " + key)
        if (field.required && type === "string" && !v.trim()) fail("Required parent app context field is empty: " + key)
        return v
      }
      if (array) {
        if (!Array.isArray(item) || item.length > 64 || field.required && !item.length) fail("Invalid parent app context list: " + key)
        out[key] = []
        for (var i = 0; i < item.length; i++) {
          if (!own(item, i)) fail("Invalid sparse parent app context list: " + key)
          out[key].push(scalar(item[i]))
        }
      } else out[key] = scalar(item)
    })
    Object.keys(config.fields).forEach(function(key) {
      if (config.fields[key].required && !own(value, key)) fail("Missing parent app context field: " + key)
    })
    if (bytes(JSON.stringify(out)) > 16384) fail("Parent app context exceeds 16 KiB")
    return out
  }
  function envelope(value, config) {
    if (!config || config.enabled !== true) fail("Embedding is disabled")
    keys(value, ["version", "revision", "context"])
    if (value.version !== 1 || !revision(value.revision) || !own(value, "context")) fail("Invalid embedding envelope")
    return { version: 1, revision: value.revision, context: context(value.context, config) }
  }
  return { own: own, map: map, keys: keys, revision: revision, bytes: bytes, fields: fields, context: context, envelope: envelope }
})()
if (typeof module !== "undefined" && module.exports) module.exports = MiniAEmbedContext
