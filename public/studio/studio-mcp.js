"use strict"

// Build a schema-driven editor. An optional field has a separate presence control.
function mcpArguments(host, schema) {
  var readers = Object.create(null)
  var properties = schema.properties || {}

  // A free-form object, schema composition or an open map can require arbitrary JSON.
  function editor(parent, title, value) {
    var input = el("textarea", undefined, el("label", title, parent))
    input.value = value === undefined ? "" : JSON.stringify(value, null, 2)
    return input
  }
  if (!Object.keys(properties).length || schema.oneOf || schema.anyOf || schema.allOf || schema.$ref) {
    var raw = editor(host, "Arguments (JSON object)", schema.default || {})
    return function() { return JSON.parse(raw.value) }
  }
  Object.keys(properties).forEach(function(key) {
    var spec = properties[key] || {}
    var required = (schema.required || []).includes(key)
    var group = el("div", undefined, host)
    var include = required ? null : check(group, "Include " + key)
    var initial = spec.default
    var title = key + (required ? " (required)" : " (optional)")
    var input, read
    if (Array.isArray(spec.enum) || spec.type === "boolean") {
      var values = spec.enum || [true, false]
      input = field(group, title, [])
      el("option", "Choose a value", input).value = ""
      values.forEach(function(value, i) {
        var option = el("option", typeof value === "string" ? value : JSON.stringify(value), input)
        option.value = String(i)
        if (initial !== undefined && JSON.stringify(initial) === JSON.stringify(value)) input.value = option.value
      })
      read = function() {
        if (input.value === "") throw Error("Choose a value for " + key)
        return values[Number(input.value)]
      }
    } else if (spec.type === "number" || spec.type === "integer") {
      input = field(group, title)
      input.type = "number"
      input.step = spec.type === "integer" ? "1" : "any"
      if (spec.minimum !== undefined) input.min = spec.minimum
      if (spec.maximum !== undefined) input.max = spec.maximum
      if (initial !== undefined) input.value = initial
      read = function() {
        if (input.value === "" || !input.checkValidity()) throw Error("Enter a valid number for " + key)
        return Number(input.value)
      }
    } else if (spec.type === "string") {
      input = field(group, title, null, initial)
      read = function() { return input.value }
    } else {
      input = editor(group, title + " · JSON", initial)
      read = function() {
        try { return JSON.parse(input.value) } catch (error) { throw Error("Enter valid JSON for " + key) }
      }
    }
    if (typeof spec.description === "string") el("p", spec.description, group).className = "muted"
    if (initial !== undefined) el("small", "Default: " + JSON.stringify(initial), group)
    if (include) {
      input.disabled = true
      include.onchange = function() { input.disabled = !include.checked }
    }
    readers[key] = function() { return !include || include.checked ? read() : undefined }
  })
  var extra
  if (schema.additionalProperties !== false) {
    extra = editor(advancedOptions(host), "Additional arguments (JSON object)", {})
  }
  return function() {
    var result = Object.create(null)
    if (extra) {
      var added = JSON.parse(extra.value)
      if (!added || Array.isArray(added) || typeof added !== "object") throw Error("Additional arguments must be a JSON object")
      Object.keys(added).forEach(function(key) {
        if (Object.hasOwn(readers, key)) throw Error("Use the named control for " + key)
        result[key] = added[key]
      })
    }
    Object.keys(readers).forEach(function(key) {
      var value = readers[key]()
      if (value !== undefined) result[key] = value
    })
    return result
  }
}

// Bind this form to its original wiki, even when a slow response arrives after navigation.
async function renderMcpSource(host, existing, name, id, adhoc, review) {
  host.className = "mcp-source"
  var wiki = currentWiki.id
  var base = wikiPath("mcp/")
  var saved = existing?.type === "mcp" ? existing.origin : null
  var active = function(node) { return node.isConnected && currentWiki?.id === wiki }
  var status = el("p", "Loading connections…", host)
  status.setAttribute("role", "status")
  var connections = (await StudioApi.request(base + "connections")).items
  if (!active(host)) return
  if (!connections.length) {
    status.textContent = "Start Studio with mcp= or enable a plugin that provides an MCP server."
    return
  }
  status.textContent = ""
  var connection = field(host, "Connection", [])
  el("option", "Choose a connection", connection).value = ""
  connections.forEach(function(entry) { el("option", entry.label, connection).value = entry.id })
  var catalog = el("div", undefined, host)

  // Each selection owns a distinct DOM subtree so obsolete requests cannot repaint it.
  async function loadTools() {
    catalog.replaceChildren()
    status.textContent = ""
    if (!connection.value) return
    var target = el("div", undefined, catalog)
    var hint = el("p", "Loading tools…", target)
    hint.setAttribute("role", "status")
    var key = connection.value
    var label = connection.selectedOptions[0].textContent
    try {
      var discovered = await StudioApi.request(base + "tools?connection=" + encodeURIComponent(key))
      var tools = discovered.items
      if (!active(target)) return
      if (discovered.label) {
        label = discovered.label
        connection.selectedOptions[0].textContent = label
      }
      hint.textContent = tools.length ? "" : "This connection advertises no tools."
      if (saved?.connection === key && !tools.some(t => t.name === saved.tool)) hint.textContent = "Saved tool “" + saved.tool + "” is no longer available. Choose another tool or connection."
      if (!tools.length) return
      var tool = field(target, "Tool", [])
      el("option", "Choose a tool", tool).value = ""
      tools.forEach(function(t) {
        el("option", label + " · " + t.name + (t.description ? " — " + t.description : ""), tool).value = t.name
      })
      var toolHost = el("div", undefined, target)
      tool.onchange = function() {
        toolHost.replaceChildren()
        var selected = tools.find(t => t.name === tool.value)
        if (!selected) return
        var form = el("div", undefined, toolHost)
        el("p", selected.description, form)
        var args = el("fieldset", undefined, form)
        el("legend", "Tool arguments", args)
        var read = mcpArguments(args, selected.inputSchema)
        el("p", "Calling this tool runs it immediately. It can change the connected system before you import anything.", form)
        var call = button(form, "Call tool", async function() {
          if (call.disabled) return
          call.disabled = true
          args.disabled = true
          output.replaceChildren()
          notice.textContent = "Calling tool…"
          try {
            var data = await StudioApi.request(base + "call", "POST", { connection: key, tool: selected.name, arguments: read() })
            if (!active(form)) {
              notice.textContent = "The tool call finished after you left this form. Call explicitly for a fresh result."
              return
            }
            notice.textContent = ""
            var restore = saved?.connection === key && saved.tool === selected.name ? saved.selection : null
            showResult(output, data, restore)
          } catch (error) {
            if (active(form)) notice.textContent = error.message
          } finally {
            args.disabled = false
            call.disabled = active(form) && !!writeReason()
          }
        }, "play")
        disable(call, writeReason())
        var notice = el("p", "", form)
        notice.setAttribute("role", "status")
        var output = el("div", undefined, form)
      }
      if (saved?.connection === key && tools.some(t => t.name === saved.tool)) {
        tool.value = saved.tool
        tool.onchange()
      }
    } catch (error) {
      if (!active(target)) return
      hint.textContent = error.message
      button(target, "Retry tool discovery", loadTools)
    }
  }

  // Only the capture ID and selected field paths are sent after the explicit call.
  function showResult(output, data, restore) {
    var panel = el("section", undefined, output)
    el("h4", "Choose content", panel)
    if (data.unsupported.length) el("p", "Skipped unsupported blocks: " + data.unsupported.join(", "), panel)
    if (data.limited) el("p", "Field list limited. The whole result includes all usable content.", panel)
    var whole = check(panel, "Whole result")
    whole.checked = !Array.isArray(restore)
    var controls = el("div", undefined, panel)
    var paths = new Map()
    var selected = new Set((restore || []).map(path => JSON.stringify(path)))
    var containers = new Map()
    data.fields.forEach(function(path) {
      var key = JSON.stringify(path)
      var parent = containers.get(JSON.stringify(path.slice(0, -1))) || controls
      var group = el("div", undefined, parent)
      group.className = "mcp-field"
      var input = check(group, path.length === 1 ? "Block " + (path[0] + 1) : path[path.length - 1])
      input.checked = selected.has(key)
      input.onchange = function() {
        whole.checked = false
        // Selecting a branch includes its children. Selecting an individual child refines the branch.
        if (input.checked) paths.forEach(function(other, otherKey) {
          if (otherKey !== key && (otherKey.startsWith(key.slice(0, -1) + ",") || key.startsWith(otherKey.slice(0, -1) + ","))) other.checked = false
        })
        refresh()
      }
      containers.set(key, group)
      paths.set(key, input)
    })
    var missing = [...selected].filter(key => !paths.has(key))
    var warning = el("p", "", panel)
    if (missing.length) warning.textContent = "Saved fields are missing: " + missing.join(", ") + ". Review and confirm your revised selection."
    var confirm = missing.length ? check(panel, "Use revised selection") : null
    var preview = el("article", undefined, panel)
    preview.className = "mcp-preview"
    preview.setAttribute("aria-label", "Markdown document")
    var note = el("p", "", panel)
    note.setAttribute("role", "status")
    var version = 0
    var selection, ready = false, staging = false
    var use = button(panel, "Use this result", async function() {
      if (use.disabled) return
      staging = true
      use.disabled = true
      try {
        if (!name.value.trim() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id.value)) throw Error("Enter a source name and a valid lower-case source ID.")
        var source = await StudioApi.request(base + "stage", "POST", { resultId: data.resultId, selection: selection,
          id: id.value, name: name.value.trim(), adhoc: adhoc?.checked === true || existing?.adhoc === true, expectedRevision: existing?.revision || null })
        if (active(panel)) await review(source)
      } catch (error) {
        if (active(panel)) note.textContent = error.message
        if (error.status === 410) ready = false
      } finally {
        staging = false
        enableUse()
      }
    }, "check")

    // Ignore superseded previews and require a valid displayed document before staging.
    function enableUse() { use.disabled = staging || !ready || !!writeReason() || (confirm && !confirm.checked) }
    async function refresh() {
      var current = ++version
      ready = false
      enableUse()
      selection = whole.checked ? null : [...paths].filter(pair => pair[1].checked).map(pair => JSON.parse(pair[0]))
      if (whole.checked) paths.forEach(function(input) { input.checked = false })
      preview.textContent = ""
      if (selection && !selection.length) {
        note.textContent = "Choose a field or the whole result."
        return
      }
      if (whole.checked && data.warning) {
        note.textContent = data.warning
        return
      }
      try {
        note.textContent = "Preparing document…"
        var markdown = whole.checked ? data.markdown : (await StudioApi.request(base + "preview", "POST", { resultId: data.resultId, selection: selection })).markdown
        if (current !== version || !active(panel)) return
        renderMarkdown(markdown, preview)
        note.textContent = ""
        ready = true
        enableUse()
      } catch (error) {
        if (current === version && active(panel)) note.textContent = error.message
      }
    }
    whole.onchange = refresh
    if (confirm) confirm.onchange = enableUse
    refresh()
  }
  connection.onchange = loadTools
  if (saved) {
    if (connections.some(c => c.id === saved.connection)) {
      connection.value = saved.connection
      await loadTools()
    } else status.textContent = "The saved connection is no longer configured. Choose another connection."
  }
}
