// Optional web-only tool binding. Never loaded by ordinary CLI or disabled web sessions.
// The browser host grants a bounded scope per run; model arguments cannot widen it.
var MiniAWebDocumentAgent = (function() {
  function fail(message) { throw new Error(message) }
  function uuid(value) {
    if (!isString(value) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) fail("Invalid document identifier")
    return value.toLowerCase()
  }
  function prepare(request, data, session) {
    var requested = isDef(data.artifactReferences) || isDef(data.artifactPermissions)
    if (global.maArgs.webextensionsagent !== true) {
      if (requested) fail("Document agent tools are disabled")
      return null
    }
    if (!MiniAWebExtensions.enabled() || global.maArgs.webextensionsonly === true) fail("Document agent tools are unavailable")
    session = uuid(session)
    if (!request.header || request.header["x-mini-a-token"] !== global.__webtoken) fail("Document access requires header authentication")
    var refs = isDef(data.artifactReferences) ? data.artifactReferences : []
    var permissions = isDef(data.artifactPermissions) ? data.artifactPermissions : {}
    MiniAWebExtensionContract.keys(permissions, ["create", "write"])
    Object.keys(permissions).forEach(function(key) { if (typeof permissions[key] !== "boolean") fail("Invalid document permissions") })
    if (!isArray(refs) || refs.length > 8) fail("Select at most eight saved documents")
    var seen = {}, ids = [], descriptions = []
    refs.forEach(function(ref) {
      MiniAWebExtensionContract.keys(ref, ["id", "revision"], ["id", "revision"])
      var id = uuid(ref.id)
      MiniAWebExtensionContract.integer(ref.revision, 1, 9007199254740991)
      if (seen[id]) fail("Duplicate document reference")
      var document = MiniAWebDocuments.read(id).artifact
      if (document.revision !== ref.revision) fail("A selected document changed. Select its current revision before submitting.")
      seen[id] = true; ids.push(id)
      descriptions.push({ id: id, revision: document.revision, title: document.title, mimeType: document.native.mimeType })
    })
    ids.forEach(function(id) { MiniAWebDocuments.link(id, session) })
    return { uuid: uuid(session), allowedIds: ids, allowCreate: permissions.create === true, allowWrite: permissions.write === true, references: descriptions }
  }
  function bind(agent, scope, live) {
    if (!scope) return
    var binding = agent._webDocumentBinding || { tools: null }
    binding.live = live
    binding.scope = scope
    // Each run gets a fresh tool scope. Existing MCP closures follow this binding,
    // so reusing an agent never retains permissions from a previous prompt.
    var store = {
      read: function(id) { if (!live()) fail("Document grant expired"); return MiniAWebDocuments.read(id) },
      save: function(params) {
        if (!live()) fail("Document grant expired")
        var result = MiniAWebDocuments.save(merge(params, { uuid: scope.uuid, authorize: live }))
        if (isFunction(global._mini_a_web_transcript)) global._mini_a_web_transcript(scope.uuid, "append", {
          event: "artifact", message: stringify({ kind: "mini-a.artifact", version: 1, artifactId: result.id, revision: result.revision }, __, "")
        })
        return result
      }
    }
    binding.tools = MiniADocumentTools.create({ store: store, allowedIds: scope.allowedIds.slice(), allowCreate: scope.allowCreate, allowWrite: scope.allowWrite, live: live })
    agent._webDocumentBinding = binding
    return binding
  }
  function config(binding) {
    var fns = {}, meta = {}
    var common = { artifactId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 } }
    var patchOperation = { type: "object", additionalProperties: false, required: ["op", "cellId"], properties: {
      op: { type: "string", enum: ["setLabel", "setStyle", "setGeometry", "addVertex", "addEdge", "removeCell"] },
      pageId: { type: "string", description: "Required for multi-page documents; use an ID returned by inspect." },
      cellId: { type: "string" }, label: { type: "string", description: "Plain text, no HTML." },
      parent: { type: "string" }, source: { type: "string" }, target: { type: "string" },
      style: { type: "object", additionalProperties: false, properties: {} },
      geometry: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number", minimum: 0 }, height: { type: "number", minimum: 0 } } }
    } }
    ;["fillColor", "strokeColor", "fontColor", "fontSize", "fontStyle", "rounded", "dashed", "strokeWidth", "opacity", "align", "verticalAlign", "shape", "edgeStyle", "endArrow", "startArrow"].forEach(function(key) { patchOperation.properties.style.properties[key] = { type: "string", maxLength: 128 } })
    var specs = {
      read: { description: "Read native content of an explicitly authorized saved document. No filesystem paths or browser access.", properties: { artifactId: common.artifactId }, required: ["artifactId"] },
      inspect: { description: "Inspect bounded metadata and draw.io structure of an authorized saved document, including when the editor is closed.", properties: { artifactId: common.artifactId }, required: ["artifactId"] },
      create: { description: "Create a saved document only when the user granted creation for this run. Native draw.io XML preserves editability. Supply UTF-8 text in content.text.", properties: { title: { type: "string" }, mimeType: { type: "string" }, filename: { type: "string" }, artifactType: { type: "string" }, content: { type: "object", additionalProperties: false, properties: { encoding: { type: "string", enum: ["utf8"] }, text: { type: "string" } }, required: ["encoding", "text"] } }, required: ["title", "mimeType", "filename", "content"] },
      patch: { description: "Apply deterministic draw.io edits by cell/page ID. setLabel requires label; setStyle requires style; setGeometry requires geometry. addEdge requires existing source/target; additions may include parent, label, style, geometry. Remove connected edges/children explicitly before removeCell. Requires expectedRevision. Without a write grant returns a proposal. Preserve unrelated geometry; never run browser JavaScript.", properties: { artifactId: common.artifactId, expectedRevision: common.expectedRevision, operations: { type: "array", items: patchOperation, maxItems: 100 } }, required: ["artifactId", "expectedRevision", "operations"] }
    }
    Object.keys(specs).forEach(function(method) {
      var name = "web_document_" + method, spec = specs[method]
      fns[name] = function(params) {
        try {
          if (!binding.live || !binding.live() || !binding.tools) fail("Document grant expired")
          return binding.tools[method](params || {})
        } catch(error) { return { error: "document_operation_rejected", message: String(error.message || error).substring(0, 500) } }
      }
      meta[name] = { name: name, description: spec.description, cacheable: false, inputSchema: { type: "object", additionalProperties: false, properties: spec.properties, required: spec.required } }
    })
    return { id: "mini-a-web-documents", type: "dummy", options: { name: "mini-a-web-documents", fns: fns, fnsMeta: meta } }
  }
  return { prepare: prepare, bind: bind, config: config }
})()
