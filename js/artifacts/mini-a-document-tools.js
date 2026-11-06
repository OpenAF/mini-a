// Apache-2.0. Optional deterministic document tools; no browser or model dependency.
// Callers provide a trusted store and an explicit, per-run document scope.
var MiniADocumentTools = (function() {
  var maxBytes = 8 * 1024 * 1024, maxCells = 10000, maxPages = 64, maxNodes = 30000
  var own = function(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
  function fail(code, message) { var error = new Error(message); error.code = code; throw error }
  function map(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
  function keys(value, allowed) {
    if (!map(value) || Object.keys(value).some(function(key) { return allowed.indexOf(key) < 0 || ['__proto__', 'constructor', 'prototype'].indexOf(key) >= 0 })) fail('invalid_request', 'Unexpected document operation field')
  }
  function string(value, limit, name) {
    if (typeof value !== 'string' || value.length > limit) fail('invalid_request', 'Invalid ' + name)
    return value
  }
  function utf8(value) { return new java.lang.String(value).getBytes('UTF-8') }
  function text(bytes) {
    return String(java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)))
  }
  function documentText(content) {
    keys(content, ['encoding', 'text', 'data'])
    var value
    if (content.encoding === 'utf8') value = string(content.text, maxBytes, 'document content')
    else if (content.encoding === 'base64') {
      var encoded = string(content.data, Math.ceil(maxBytes / 3) * 4, 'document content')
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('invalid_request', 'Invalid document encoding')
      value = text(java.util.Base64.getDecoder().decode(encoded))
    } else fail('invalid_request', 'Unsupported document encoding')
    if (utf8(value).length > maxBytes || value.indexOf('\u0000') >= 0) fail('size_limit', 'Document exceeds its limit or contains NUL bytes')
    return value
  }
  function complexity(doc) {
    var count = 0
    function walk(node, depth) {
      if (++count > maxNodes || depth > 64 || node.getNodeType() === 7 || node.getNodeType() === 10) fail('size_limit', 'XML complexity limit')
      var children = node.getChildNodes()
      for (var i = 0; i < children.getLength(); i++) walk(children.item(i), depth + 1)
    }
    walk(doc, 0)
  }
  function xml(value) {
    if (typeof value !== 'string' || utf8(value).length > maxBytes || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(value)) fail('invalid_document', 'Unsafe or oversized XML')
    var factory = javax.xml.parsers.DocumentBuilderFactory.newDefaultInstance()
    factory.setNamespaceAware(true)
    factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true)
    factory.setFeature('http://apache.org/xml/features/disallow-doctype-decl', true)
    factory.setFeature('http://xml.org/sax/features/external-general-entities', false)
    factory.setFeature('http://xml.org/sax/features/external-parameter-entities', false)
    factory.setXIncludeAware(false); factory.setExpandEntityReferences(false)
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalDTD', '')
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalSchema', '')
    var builder = factory.newDocumentBuilder()
    builder.setErrorHandler(new JavaAdapter(org.xml.sax.ErrorHandler, { warning: function(e) { throw e }, error: function(e) { throw e }, fatalError: function(e) { throw e } }))
    var doc = builder.parse(new java.io.ByteArrayInputStream(utf8(value)))
    complexity(doc)
    return doc
  }
  function serialize(node) {
    var factory = javax.xml.transform.TransformerFactory.newInstance()
    factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true)
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalDTD', '')
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalStylesheet', '')
    var transformer = factory.newTransformer(), writer = new java.io.StringWriter()
    transformer.setOutputProperty(javax.xml.transform.OutputKeys.OMIT_XML_DECLARATION, 'yes')
    transformer.transform(new javax.xml.transform.dom.DOMSource(node), new javax.xml.transform.stream.StreamResult(writer))
    return String(writer.toString())
  }
  function children(node, name) {
    var out = [], nodes = node.getChildNodes()
    for (var i = 0; i < nodes.getLength(); i++) if (nodes.item(i).getNodeType() === 1 && (!name || String(nodes.item(i).getNodeName()) === name)) out.push(nodes.item(i))
    return out
  }
  function attributes(node) {
    var out = {}, attrs = node.getAttributes(), allowed = ['x', 'y', 'width', 'height', 'relative', 'as']
    for (var i = 0; i < attrs.getLength(); i++) {
      var key = String(attrs.item(i).getNodeName())
      if (allowed.indexOf(key) >= 0) out[key] = String(attrs.item(i).getNodeValue()).substring(0, 64)
    }
    return out
  }
  function references(doc) {
    var nodes = doc.getElementsByTagName('*')
    for (var i = 0; i < nodes.getLength(); i++) {
      var node = nodes.item(i)
      if (/^(script|iframe|embed|foreignObject)$/i.test(String(node.getNodeName()))) fail('invalid_document', 'Active diagram content is unsupported')
      var attrs = node.getAttributes()
      for (var j = 0; j < attrs.getLength(); j++) {
        var key = String(attrs.item(j).getNodeName()), value = String(attrs.item(j).getNodeValue())
        if (/^on/i.test(key) || /javascript\s*:|vbscript\s*:|<\s*(?:script|iframe|object|embed|style|link|meta|base|a)\b|\bon[a-z]+\s*=/i.test(value)) fail('invalid_document', 'Active diagram attribute is unsupported')
        if (/^(href|xlink:href|src|link)$/i.test(key) && value && value.charAt(0) !== '#') fail('invalid_document', 'External diagram links are unsupported')
        if (key === 'style' && /(?:^|;)(?:image|fontSource|fontUrl)=/i.test(value) || /<\s*img\b|url\s*\(/i.test(value)) fail('invalid_document', 'External image/font content is unsupported')
      }
    }
  }
  function inflate(value, remaining) {
    value = value.replace(/\s/g, '')
    if (value.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('invalid_document', 'Invalid compressed diagram')
    var compressed = java.util.Base64.getDecoder().decode(value), inflater = new java.util.zip.Inflater(true)
    var output = new java.io.ByteArrayOutputStream(), buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
    try {
      inflater.setInput(compressed)
      while (!inflater.finished()) {
        var count = inflater.inflate(buffer)
        if (count <= 0) fail('invalid_document', 'Invalid or truncated compressed diagram')
        if (output.size() + count > remaining) fail('size_limit', 'Expanded diagram exceeds the size limit')
        output.write(buffer, 0, count)
      }
      if (inflater.getRemaining() !== 0) fail('invalid_document', 'Trailing compressed diagram data')
      return decodeURIComponent(text(output.toByteArray()))
    } finally { inflater.end(); output.close() }
  }
  function parse(value) {
    var doc = xml(value), root = doc.getDocumentElement(), pages = [], expanded = utf8(value).length, totalCells = 0
    function page(node, id, name) {
      var model = node
      if (String(node.getNodeName()) === 'diagram') {
        var contents = children(node)
        if (!contents.length) {
          var decoded = inflate(String(node.getTextContent()), maxBytes - expanded)
          expanded += utf8(decoded).length
          var decodedDoc = xml(decoded)
          model = doc.importNode(decodedDoc.getDocumentElement(), true)
          while (node.hasChildNodes()) node.removeChild(node.getFirstChild())
          node.appendChild(model)
          complexity(doc)
        } else {
          if (contents.length !== 1) fail('invalid_document', 'Invalid diagram model count')
          model = contents[0]
        }
      }
      if (String(model.getNodeName()) !== 'mxGraphModel') fail('invalid_document', 'Invalid diagram graph model')
      var roots = children(model, 'root')
      if (roots.length !== 1) fail('invalid_document', 'Invalid diagram root')
      var nodes = model.getElementsByTagName('mxCell'), index = Object.create(null), cells = []
      totalCells += nodes.getLength()
      if (totalCells > maxCells) fail('size_limit', 'Too many diagram cells')
      for (var c = 0; c < nodes.getLength(); c++) {
        var cell = nodes.item(c), parent = cell.getParentNode(), holder = cell
        var cellId = String(cell.getAttribute('id'))
        if (!cellId && parent.getNodeType() === 1 && parent !== roots[0]) { cellId = String(parent.getAttribute('id')); holder = parent }
        if (!cellId || cellId.length > 256 || own(index, cellId)) fail('invalid_document', 'Missing or duplicate diagram cell ID')
        index[cellId] = { node: cell, holder: holder, id: cellId }; cells.push(index[cellId])
      }
      pages.push({ node: node, model: model, root: roots[0], id: id, name: name, index: index, cells: cells })
    }
    if (String(root.getNodeName()) === 'mxGraphModel') page(root, 'page-1', 'Page-1')
    else if (String(root.getNodeName()) === 'mxfile') {
      var pageNodes = children(root, 'diagram'), seen = Object.create(null)
      if (!pageNodes.length || pageNodes.length > maxPages) fail('invalid_document', 'Invalid diagram page count')
      for (var p = 0; p < pageNodes.length; p++) {
        var id = String(pageNodes[p].getAttribute('id')) || 'page-' + (p + 1)
        if (id.length > 256 || own(seen, id)) fail('invalid_document', 'Invalid or duplicate diagram page ID')
        seen[id] = true
        page(pageNodes[p], id, String(pageNodes[p].getAttribute('name')) || id)
      }
    } else fail('invalid_document', 'Expected a .drawio document')
    if (expanded > maxBytes) fail('size_limit', 'Expanded diagram exceeds the size limit')
    references(doc)
    return { doc: doc, pages: pages, totalCells: totalCells }
  }
  function summary(parsed) {
    var remaining = 200, out = { pages: [], totalCells: parsed.totalCells, truncated: parsed.totalCells > remaining }
    parsed.pages.forEach(function(page) {
      var row = { id: page.id, name: page.name.substring(0, 256), cellCount: page.cells.length, cells: [] }
      page.cells.forEach(function(cell) {
        if (remaining-- <= 0) return
        var node = cell.node, geometry = children(node, 'mxGeometry')
        row.cells.push({ id: cell.id, label: String(cell.holder === node ? node.getAttribute('value') : cell.holder.getAttribute('label')).substring(0, 256),
          parent: String(node.getAttribute('parent')).substring(0, 256), source: String(node.getAttribute('source')).substring(0, 256), target: String(node.getAttribute('target')).substring(0, 256),
          vertex: String(node.getAttribute('vertex')) === '1', edge: String(node.getAttribute('edge')) === '1', geometry: geometry.length ? attributes(geometry[0]) : {} })
      })
      out.pages.push(row)
    })
    for (var p = out.pages.length - 1; p >= 0 && utf8(JSON.stringify(out)).length > 65536; p--) {
      while (out.pages[p].cells.length && utf8(JSON.stringify(out)).length > 65536) { out.pages[p].cells.pop(); out.truncated = true }
    }
    if (utf8(JSON.stringify(out)).length > 65536) fail('size_limit', 'Diagram metadata exceeds the inspection limit')
    return out
  }
  var styleKeys = ['fillColor', 'strokeColor', 'fontColor', 'fontSize', 'fontStyle', 'rounded', 'dashed', 'strokeWidth', 'opacity', 'align', 'verticalAlign', 'shape', 'edgeStyle', 'endArrow', 'startArrow']
  function styleValues(value) {
    keys(value, styleKeys)
    Object.keys(value).forEach(function(key) {
      string(value[key], 128, 'style value')
      if (!/^[A-Za-z0-9#., _-]*$/.test(value[key])) fail('invalid_request', 'Unsafe style value')
    })
    return value
  }
  function geometryValues(value) {
    keys(value, ['x', 'y', 'width', 'height'])
    Object.keys(value).forEach(function(key) {
      if (typeof value[key] !== 'number' || !isFinite(value[key]) || Math.abs(value[key]) > 10000000 || /^(width|height)$/.test(key) && value[key] < 0) fail('invalid_request', 'Invalid geometry value')
    })
    return value
  }
  function edit(value, operations) {
    var parsed = parse(value)
    if (!Array.isArray(operations) || operations.length > 100) fail('invalid_request', 'At most 100 structural operations are allowed')
    if (!operations.length) return { text: value, metadata: summary(parsed) }
    operations.forEach(function(op) {
      keys(op, ['op', 'pageId', 'cellId', 'label', 'style', 'geometry', 'parent', 'source', 'target'])
      var fields = { setLabel: ['label'], setStyle: ['style'], setGeometry: ['geometry'], removeCell: [], addVertex: ['label', 'style', 'geometry', 'parent'], addEdge: ['label', 'style', 'geometry', 'parent', 'source', 'target'] }
      if (!own(fields, op.op)) fail('invalid_request', 'Unsupported structural operation')
      keys(op, ['op', 'pageId', 'cellId'].concat(fields[op.op]))
      var page = parsed.pages.filter(function(p) { return p.id === op.pageId })[0]
      if (!page && !own(op, 'pageId') && parsed.pages.length === 1) page = parsed.pages[0]
      if (!page) fail('invalid_request', 'Specify an existing diagram page ID')
      var id = string(op.cellId, 256, 'cell ID'), cell = page.index[id], node
      if (!id || ['__proto__', 'constructor', 'prototype'].indexOf(id) >= 0) fail('invalid_request', 'Invalid cell ID')
      if (op.op === 'addVertex' || op.op === 'addEdge') {
        if (cell || !page.index[op.parent || '1']) fail('invalid_request', 'Cell already exists or parent does not exist')
        if (op.op === 'addEdge' && (!page.index[op.source] || !page.index[op.target])) fail('invalid_request', 'Edge endpoints must exist')
        node = parsed.doc.createElement('mxCell'); node.setAttribute('id', id); node.setAttribute('parent', op.parent || '1')
        node.setAttribute(op.op === 'addVertex' ? 'vertex' : 'edge', '1')
        if (op.op === 'addEdge') { node.setAttribute('source', op.source); node.setAttribute('target', op.target) }
        cell = { node: node, holder: node, id: id }; page.index[id] = cell; page.cells.push(cell); page.root.appendChild(node)
        var geometry = parsed.doc.createElement('mxGeometry'); geometry.setAttribute('as', 'geometry')
        if (op.op === 'addEdge') geometry.setAttribute('relative', '1')
        node.appendChild(geometry)
      } else {
        if (!cell) fail('not_found', 'Diagram cell does not exist')
        node = cell.node
      }
      if (op.op === 'removeCell') {
        if (id === '0' || id === '1') fail('invalid_request', 'Root and base-layer cells cannot be removed')
        var referenced = page.cells.some(function(other) {
          return other.id !== id && ['parent', 'source', 'target'].some(function(key) { return String(other.node.getAttribute(key)) === id })
        })
        if (referenced) fail('invalid_request', 'Remove connected edges and child cells explicitly before removing this cell')
        cell.holder.getParentNode().removeChild(cell.holder); delete page.index[id]
        page.cells = page.cells.filter(function(other) { return other.id !== id })
        return
      }
      if (['setLabel', 'setStyle', 'setGeometry', 'addVertex', 'addEdge'].indexOf(op.op) < 0) fail('invalid_request', 'Unsupported structural operation')
      var adding = op.op === 'addVertex' || op.op === 'addEdge'
      if (op.op === 'setLabel' || adding && own(op, 'label')) {
        var label = string(op.label, 4096, 'label')
        if (/[<>]/.test(label)) fail('invalid_request', 'Structural labels must be plain text')
        cell.holder.setAttribute(cell.holder === node ? 'value' : 'label', label)
      }
      if (op.op === 'setStyle' || adding && own(op, 'style')) {
        var values = styleValues(op.style), parts = String(node.getAttribute('style')).split(';').filter(function(part) { return part.length > 0 })
        Object.keys(values).forEach(function(key) { parts = parts.filter(function(part) { return part.substring(0, part.indexOf('=')) !== key }); parts.push(key + '=' + values[key]) })
        node.setAttribute('style', parts.join(';') + ';')
      }
      if (op.op === 'setGeometry' || adding && own(op, 'geometry')) {
        var geo = geometryValues(op.geometry), nodes = children(node, 'mxGeometry'), target = nodes[0]
        if (!target) { target = parsed.doc.createElement('mxGeometry'); target.setAttribute('as', 'geometry'); node.appendChild(target) }
        Object.keys(geo).forEach(function(key) { target.setAttribute(key, String(geo[key])) })
      }
    })
    if (String(parsed.doc.getDocumentElement().getNodeName()) === 'mxfile') parsed.doc.getDocumentElement().setAttribute('compressed', 'false')
    var result = serialize(parsed.doc), checked = parse(result)
    return { text: result, metadata: summary(checked) }
  }
  function createTools(options) {
    options = options || {}
    if (!options.store || typeof options.store.read !== 'function' || typeof options.store.save !== 'function') fail('invalid_configuration', 'A trusted document store is required')
    var ids = Object.create(null)
    ;(options.allowedIds || []).forEach(function(id) { ids[String(id)] = true })
    function live() { if (typeof options.live === 'function' && options.live() !== true) fail('revoked', 'Document scope is no longer active') }
    function read(params) {
      keys(params, ['artifactId']); live()
      var id = string(params.artifactId, 128, 'artifact ID')
      if (!own(ids, id)) fail('permission_denied', 'Document is outside the current run scope')
      return options.store.read(id)
    }
    function native(item) {
      if (!item.artifact || item.artifact.native.mimeType !== 'application/vnd.jgraph.mxfile') fail('unsupported_format', 'Structural operations require a .drawio document')
      return documentText(item.content)
    }
    function inspect(params) {
      var item = read(params)
      return { artifact: item.artifact, metadata: item.artifact.native.mimeType === 'application/vnd.jgraph.mxfile' ? summary(parse(native(item))) : { byteLength: item.artifact.native.byteLength, mimeType: item.artifact.native.mimeType } }
    }
    function create(params) {
      keys(params, ['title', 'mimeType', 'filename', 'artifactType', 'content']); live()
      if (options.allowCreate !== true) fail('permission_denied', 'Creating documents is not allowed in this run')
      if (params.mimeType === 'application/vnd.jgraph.mxfile') parse(documentText(params.content))
      var saved = options.store.save({ expectedRevision: 0, title: params.title, mimeType: params.mimeType, filename: params.filename, artifactType: params.artifactType, content: params.content, uuid: options.uuid })
      ids[saved.id] = true
      return { artifact: saved }
    }
    function patch(params) {
      keys(params, ['artifactId', 'expectedRevision', 'operations']); live()
      var item = read({ artifactId: params.artifactId })
      if (typeof params.expectedRevision !== 'number' || !isFinite(params.expectedRevision) || Math.floor(params.expectedRevision) !== params.expectedRevision || params.expectedRevision < 1 || params.expectedRevision > 9007199254740991 || params.expectedRevision !== item.artifact.revision) fail('revision_conflict', 'The document changed; inspect its current revision before editing')
      var changed = edit(native(item), params.operations)
      if (options.allowWrite !== true) return { kind: 'document-edit-proposal', artifactId: item.artifact.id, expectedRevision: item.artifact.revision, operations: JSON.parse(JSON.stringify(params.operations)), metadata: changed.metadata }
      live()
      var saved = options.store.save({ id: item.artifact.id, expectedRevision: params.expectedRevision, title: item.artifact.title, mimeType: item.artifact.native.mimeType, filename: item.artifact.native.filename,
        artifactType: item.artifact.artifactType, content: { encoding: 'utf8', text: changed.text }, uuid: options.uuid })
      return { artifact: saved, metadata: changed.metadata }
    }
    return { read: read, inspect: inspect, create: create, patch: patch }
  }
  return { create: createTools, decodeContent: documentText, drawio: { validate: function(value) { return summary(parse(value)) }, inspect: function(value) { return summary(parse(value)) }, patch: edit } }
})()
