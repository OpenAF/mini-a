// Pure MCP helpers shared by the agent (mini-a-mcp-features.js) and the MCP tester.
// Nothing here depends on the MiniA class.

// Keep protocol control responses out of tool output, caches and traces.
function __miniAMcpPending(result) {
  return isMap(result) && ["task", "input_required"].indexOf(result.resultType) >= 0
}

// Return an actionable error without echoing protocol state or elicitation data.
function __miniAMcpFailure(message) {
  return { error: message, content: [{ type: "text", text: message }], isError: true, retryable: false }
}

// Display server-supplied text as plain text without terminal control sequences.
function __miniAMcpLabel(value) {
  return String(value || "").replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g, " ").substring(0, 1200)
}

// Match OpenAF's transport default for descriptors containing only a URL.
function __miniAMcpType(config) {
  var type = String(config.type || "stdio").toLowerCase()
  return type === "stdio" && isDef(config.url) && isUnDef(config.cmd) ? "remote" : type
}

// Decode one supported flat-schema field, preserving typed and optional values.
function __miniAMcpField(schema) {
  var choices, labels
  var list = schema.type === "array" ? schema.items : schema
  if (isMap(list) && isArray(list.enum)) {
    choices = list.enum
    labels = choices.map(String)
  } else if (isMap(list) && isArray(schema.type === "array" ? list.anyOf : list.oneOf)) {
    var items = schema.type === "array" ? list.anyOf : list.oneOf
    choices = items.map(function(item) { return item.const })
    labels = items.map(function(item) { return __miniAMcpLabel(item.title || item.const) })
  } else if (schema.type === "boolean") {
    choices = [true, false]
    labels = ["Yes", "No"]
  }
  if (["string", "boolean", "number", "integer", "array"].indexOf(schema.type) < 0 ||
      schema.type === "array" && (!choices || choices.some(function(value) { return !isString(value) }))) {
    throw new Error("Unsupported MCP form field")
  }
  return { choices: choices, labels: labels }
}

// Serialize with sorted keys so equal structures compare equal regardless of key order.
function __miniAMcpStable(value) {
  if (isArray(value)) return "[" + value.map(__miniAMcpStable).join(",") + "]"
  if (isMap(value)) {
    return "{" + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ":" + __miniAMcpStable(value[key])
    }).join(",") + "}"
  }
  return JSON.stringify(value)
}

// Describe what a connection negotiated and, for each feature, whether the runtime or the server is missing it.
// opts.prompt tells whether the caller registered an elicitation handler.
function __miniAMcpFeatureSummary(client, opts) {
  opts = opts || {}
  var info = isFunction(client.getInfo) ? client.getInfo() : {}
  var caps = isFunction(client.getCapabilities) ? client.getCapabilities() : {}
  if (!isMap(caps)) caps = {}
  if (!isMap(info)) info = {}
  var ext = isMap(caps.extensions) ? caps.extensions : {}
  return {
    version: info.protocolVersion || "",
    server: isMap(info.serverInfo) ? info.serverInfo : {},
    tasks: { runtime: isFunction(client.getTask), server: isMap(ext["io.modelcontextprotocol/tasks"]) },
    skills: { runtime: isFunction(client.listSkills), server: isMap(ext["io.modelcontextprotocol/skills"]) },
    elicitation: { runtime: isFunction(client.onElicitationRequest), enabled: !!opts.prompt },
    resources: { runtime: isFunction(client.listResources), server: isMap(caps.resources) },
    prompts: { runtime: isFunction(client.listPrompts), server: isMap(caps.prompts) },
    tools: { runtime: isFunction(client.listTools), server: isMap(caps.tools) }
  }
}

// Validate a skill manifest and return its files, total size and a stable revision.
// stringify is an optional stable serializer; without it the revision is order-independent over the file list.
function __miniAMcpVerifySkillManifest(entry, stringify) {
  var manifest = entry.resources
  if (!isArray(manifest) || !manifest.length || manifest.length > 512) throw new Error("remote-skill-manifest-required")
  var total = 0
  var files = Object.create(null)
  manifest.forEach(function(file) {
    if (!isMap(file) || !isString(file.uri) || files[file.uri] || !/^sha256:[a-f0-9]{64}$/.test(file.digest) ||
        !isNumber(file.size) || file.size < 0 || Math.floor(file.size) !== file.size) throw new Error("invalid-remote-skill-manifest")
    files[file.uri] = file
    total += file.size
  })
  if (total > 16 * 1024 * 1024 || !files[entry.uri]) throw new Error("invalid-remote-skill-manifest")
  var serialize = isFunction(stringify) ? stringify : __miniAMcpStable
  var revision = sha256(serialize(Object.keys(files).sort().map(function(uri) { return files[uri] })))
  return { files: files, total: total, revision: revision }
}

// Check one resource read against its manifest entry. Returns the text or throws.
function __miniAMcpVerifySkillResource(file, resource, target) {
  if (!isMap(resource) || resource.uri !== target || !isString(resource.text)) throw new Error("remote-skill-text-resource-unavailable")
  var bytes = new java.lang.String(resource.text).getBytes("UTF-8")
  if (bytes.length !== file.size || "sha256:" + sha256(bytes) !== file.digest) throw new Error("remote-skill-integrity-check-failed")
  return resource.text
}

// Check SKILL.md frontmatter against the listed metadata and return the body without it.
function __miniAMcpCheckSkillFrontmatter(entry, name, body, stringify) {
  var serialize = isFunction(stringify) ? stringify : __miniAMcpStable
  var uri = new java.net.URI(entry.uri)
  var head = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!head || serialize(af.fromYAML(head[1])) !== serialize(entry.frontmatter) ||
      String(uri.getPath()).split("/").slice(-2).join("/") !== name + "/SKILL.md" &&
      !(String(uri.getPath()) === "/SKILL.md" && String(uri.getHost()) === name)) {
    throw new Error("remote-skill-frontmatter-mismatch")
  }
  return body.substring(head[0].length)
}

// Derive the source-qualified skill handle shown to users and models.
function __miniAMcpSkillId(identity, uri) {
  return "mcp:" + identity.substring(0, 12) + ":" + sha256(uri).substring(0, 16)
}
