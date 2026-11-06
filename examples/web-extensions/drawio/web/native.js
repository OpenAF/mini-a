// Apache-2.0. Bounded, inert XML admission; no HTML is inserted into the host.
var MiniADrawioNative = (function() {
  var maxBytes = 8 * 1024 * 1024, maxNodes = 30000, maxCells = 10000, maxPages = 64
  function fail(message) { throw new Error(message) }
  function bytes(value) { return new TextEncoder().encode(value).length }
  function complexity(document) {
    var count = 0
    function walk(node, depth) {
      if (++count > maxNodes || depth > 64 || node.nodeType === 7 || node.nodeType === 10) fail('Diagram complexity limit')
      for (var child = node.firstChild; child; child = child.nextSibling) walk(child, depth + 1)
    }
    walk(document, 0)
  }
  function xml(text) {
    if (typeof text !== 'string' || bytes(text) > maxBytes || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(text)) fail('Unsafe or oversized diagram XML')
    var document = new DOMParser().parseFromString(text, 'application/xml')
    if (document.querySelector('parsererror')) fail('Invalid diagram XML')
    complexity(document)
    return document
  }
  function checkReferences(document) {
    var nodes = document.getElementsByTagName('*')
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]
      if (/^(script|iframe|embed|foreignObject)$/i.test(node.nodeName)) fail('Active diagram content is unsupported')
      for (var j = 0; j < node.attributes.length; j++) {
        var key = node.attributes[j].name, value = node.attributes[j].value
        if (/^on/i.test(key) || /javascript\s*:|vbscript\s*:|<\s*(?:script|iframe|object|embed|style|link|meta|base|a)\b|\bon[a-z]+\s*=/i.test(value)) fail('Active diagram attribute is unsupported')
        if (/^(href|xlink:href|src|link)$/i.test(key) && value && value.charAt(0) !== '#') fail('External diagram links are unsupported')
        if ((key === 'style' && /(?:^|;)(?:image|fontSource|fontUrl)=/i.test(value)) || /<\s*img\b|url\s*\(/i.test(value)) fail('External or embedded image/font content is unsupported')
      }
    }
  }
  async function inflate(text, remaining) {
    if (typeof DecompressionStream !== 'function') fail('This browser cannot safely open compressed diagrams; save an uncompressed .drawio file first')
    if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(text)) fail('Invalid compressed diagram')
    var decoded = atob(text.replace(/\s/g, '')), input = new Uint8Array(decoded.length)
    for (var i = 0; i < decoded.length; i++) input[i] = decoded.charCodeAt(i)
    var stream
    try { stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader() }
    catch (error) { fail('This browser cannot safely open compressed diagrams; save an uncompressed .drawio file first') }
    var chunks = [], length = 0
    try {
      while (true) {
        var item = await stream.read()
        if (item.done) break
        length += item.value.length
        if (length > remaining) fail('Expanded diagram exceeds the size limit')
        chunks.push(item.value)
      }
    } finally { await stream.cancel().catch(function() {}) }
    var output = new Uint8Array(length), offset = 0
    chunks.forEach(function(chunk) { output.set(chunk, offset); offset += chunk.length })
    return decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(output))
  }
  async function normalize(text) {
    var document = xml(text), root = document.documentElement, expanded = bytes(text)
    if (root.nodeName === 'mxGraphModel') {
      checkReferences(document)
      if (document.getElementsByTagName('mxCell').length > maxCells) fail('Too many diagram cells')
      return text
    }
    if (root.nodeName !== 'mxfile') fail('Expected a .drawio document')
    var pages = root.getElementsByTagName('diagram'), cells = 0, changed = false
    if (!pages.length || pages.length > maxPages) fail('Invalid diagram page count')
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p], model = page.firstElementChild
      if (page.parentNode !== root) fail('Invalid diagram page nesting')
      if (!model) {
        var source = await inflate(page.textContent, maxBytes - expanded), parsed = xml(source)
        expanded += bytes(source)
        if (expanded > maxBytes || parsed.documentElement.nodeName !== 'mxGraphModel') fail('Invalid expanded diagram')
        while (page.firstChild) page.removeChild(page.firstChild)
        model = document.importNode(parsed.documentElement, true)
        page.appendChild(model); changed = true
        complexity(document)
      }
      if (model.nodeName !== 'mxGraphModel' || model.nextElementSibling) fail('Invalid diagram model')
      cells += model.getElementsByTagName('mxCell').length
      if (cells > maxCells) fail('Too many diagram cells')
    }
    checkReferences(document)
    if (changed) root.setAttribute('compressed', 'false')
    var result = changed ? new XMLSerializer().serializeToString(document) : text
    if (bytes(result) > maxBytes) fail('Expanded diagram exceeds the size limit')
    return result
  }
  function decodeContent(content) {
    if (content && content.encoding === 'utf8' && typeof content.text === 'string') return content.text
    if (!content || content.encoding !== 'base64' || typeof content.data !== 'string') fail('Unsupported diagram representation')
    var raw = atob(content.data), buffer = new Uint8Array(raw.length)
    if (raw.length > maxBytes) fail('Diagram exceeds the size limit')
    for (var i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  }
  function safeSvg(text) {
    var document = xml(text), root = document.documentElement
    if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') fail('Invalid SVG export')
    var tags = ' svg g defs title desc path rect circle ellipse line polyline polygon text tspan textPath clipPath mask linearGradient radialGradient stop pattern marker symbol use '
    var attrs = ' xmlns xmlns:xlink id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline dx dy rotate textLength lengthAdjust preserveAspectRatio gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits href xlink:href '
    var all = Array.prototype.slice.call(document.getElementsByTagName('*'))
    for (var i = 0; i < all.length; i++) {
      var node = all[i]
      // draw.io emits adaptive palette CSS alongside fallback presentation attributes.
      // Drop the stylesheet entirely; exported SVG only retains validated attributes.
      if (node.namespaceURI === root.namespaceURI && node.localName === 'style') { node.remove(); continue }
      if (node.namespaceURI !== root.namespaceURI || tags.indexOf(' ' + node.localName + ' ') < 0) fail('SVG element ' + node.localName + ' is unsupported; export PNG or use plain text labels')
      for (var j = node.attributes.length - 1; j >= 0; j--) {
        var a = node.attributes[j], key = a.name, value = a.value
        if (attrs.indexOf(' ' + key + ' ') < 0) { node.removeAttribute(key); continue }
        if (key === 'xmlns' || key === 'xmlns:xlink') continue
        if ((/href$/.test(key) && !/^#[\w.-]+$/.test(value)) || (/url\s*\(/i.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/.test(value)) || /[\\\u0000-\u001f]|javascript:|data:|https?:/i.test(value)) fail('Unsafe SVG export reference')
      }
    }
    return new XMLSerializer().serializeToString(document)
  }
  return {
    normalize: normalize, decodeContent: decodeContent, safeSvg: safeSvg,
    blank: '<mxfile compressed="false"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
  }
})()
