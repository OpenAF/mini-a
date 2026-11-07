// Shared fail-closed publication policy. No generation libraries are installed here.
var MiniAArtifactPolicy = (function() {
  var Files = java.nio.file.Files, Paths = java.nio.file.Paths
  var maxFile = 25 * 1024 * 1024, maxRun = 100 * 1024 * 1024
  var formats = ['txt', 'md', 'csv', 'json', 'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'svg']
  function fail(message) { throw new Error(message) }
  function name(value) {
    if (!isString(value) || value.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/.test(value) || value.indexOf('..') >= 0) fail('Invalid output filename')
    var ext = value.split('.').pop().toLowerCase()
    if (formats.indexOf(ext) < 0) fail('Unsupported output format')
    return value
  }
  function xml(bytes) {
    var factory = javax.xml.parsers.DocumentBuilderFactory.newDefaultInstance()
    factory.setNamespaceAware(true)
    factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true)
    factory.setFeature('http://apache.org/xml/features/disallow-doctype-decl', true)
    factory.setFeature('http://xml.org/sax/features/external-general-entities', false)
    factory.setFeature('http://xml.org/sax/features/external-parameter-entities', false)
    factory.setXIncludeAware(false)
    factory.setExpandEntityReferences(false)
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalDTD', '')
    factory.setAttribute('http://javax.xml.XMLConstants/property/accessExternalSchema', '')
    var builder = factory.newDocumentBuilder()
    builder.setErrorHandler(new JavaAdapter(org.xml.sax.ErrorHandler, {warning:function(e){throw e},error:function(e){throw e},fatalError:function(e){throw e}}))
    return builder.parse(new java.io.ByteArrayInputStream(bytes))
  }
  function utf8(bytes) {
    return String(java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)))
  }
  function svg(bytes) {
    var doc = xml(bytes), root = doc.getDocumentElement()
    if (String(root.getLocalName()) !== 'svg') fail('Invalid SVG')
    var tags = ' svg g defs title desc path rect circle ellipse line polyline polygon text tspan textPath clipPath mask linearGradient radialGradient stop pattern marker symbol use '
    var attrs = ' xmlns xmlns:xlink id class viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline dx dy rotate textLength lengthAdjust preserveAspectRatio gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits href xlink:href '
    var all = doc.getElementsByTagName('*')
    if (all.getLength() > 10000) fail('SVG complexity limit')
    for (var i = 0; i < all.getLength(); i++) {
      var node = all.item(i)
      if (String(node.getNamespaceURI()) !== 'http://www.w3.org/2000/svg' || tags.indexOf(' ' + node.getLocalName() + ' ') < 0) fail('Unsupported SVG element')
      var attributes = node.getAttributes()
      for (var j = 0; j < attributes.getLength(); j++) {
        var a = attributes.item(j), key = String(a.getNodeName()), value = String(a.getNodeValue()).trim()
        if (attrs.indexOf(' ' + key + ' ') < 0) fail('Unsupported SVG attribute')
        if (key === 'xmlns' || key === 'xmlns:xlink') continue
        if ((/href$/.test(key) && !/^#[\w.-]+$/.test(value)) || (/url\s*\(/i.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/.test(value)) || /[\\\u0000-\u001f]|javascript:|data:|https?:/i.test(value)) fail('Unsafe SVG reference')
      }
    }
    // Processing instructions, including stylesheets, are never accepted.
    var walk = function(node) {
      if (node.getNodeType() === 7) fail('SVG processing instruction')
      var children = node.getChildNodes()
      for (var n = 0; n < children.getLength(); n++) walk(children.item(n))
    }
    walk(doc)
  }
  function office(bytes, ext) {
    var zip = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes)), count = 0, total = 0, seen = {}, types = false, main = false
    var expected = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[ext]
    try {
      var entry
      while ((entry = zip.getNextEntry()) !== null) {
        var path = String(entry.getName())
        if (++count > 2000 || seen[path.toLowerCase()] || path.indexOf('..') >= 0 || path.charAt(0) === '/' || /\\|vba|activex|embeddings|oleobject|externalLinks/i.test(path)) fail('Unsafe Office package')
        seen[path.toLowerCase()] = true
        if (entry.isDirectory()) continue
        var out = new java.io.ByteArrayOutputStream(), buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192), read
        while ((read = zip.read(buffer)) !== -1) {
          total += read
          if (total > maxRun || out.size() + read > maxFile) fail('Office expansion limit')
          out.write(buffer, 0, read)
        }
        if (!/\.(xml|rels)$/i.test(path) && !/^\[Content_Types\]\.xml$/.test(path)) {
          if (!/^(?:(word|xl|ppt)\/media\/[^/]+|docProps\/thumbnail)\.(png|jpe?g)$/i.test(path)) fail('Unsupported embedded Office content')
          validate(path.split('/').pop(), out.toByteArray())
          continue
        }
        var payload = out.toByteArray(), text = utf8(payload)
        var document = xml(payload), nodes = document.getElementsByTagName('*')
        if (nodes.getLength() > 100000) fail('Office XML complexity limit')
        for (var k = 0; k < nodes.getLength(); k++) {
          var node = nodes.item(k), local = String(node.getLocalName())
          if (/^(f|formula|definedName|fldSimple|fldChar|instrText|oleObject|altChunk|attachedTemplate)$/.test(local)) fail('Active Office field')
          var attributes = node.getAttributes()
          for (var a = 0; a < attributes.getLength(); a++) {
            var attribute = attributes.item(a), key = String(attribute.getLocalName()), value = String(attribute.getNodeValue())
            if ((key === 'TargetMode' && value !== 'Internal') || (key === 'Target' && /^(?:[a-z]+:|\/|\\)/i.test(value))) fail('External Office reference')
            if (/macroEnabled|vbaProject|oleObject|activeX/i.test(value)) fail('Active Office content type')
          }
        }
        if (path === '[Content_Types].xml') {
          if (String(document.getDocumentElement().getLocalName()) !== 'Types' || String(document.getDocumentElement().getNamespaceURI()) !== 'http://schemas.openxmlformats.org/package/2006/content-types') fail('Invalid Office content types')
          types = true
        }
        if (path === expected) {
          var roots = {docx:'document',xlsx:'workbook',pptx:'presentation'}, namespaces = {docx:'wordprocessingml',xlsx:'spreadsheetml',pptx:'presentationml'}
          if (String(document.getDocumentElement().getLocalName()) !== roots[ext] || String(document.getDocumentElement().getNamespaceURI()) !== 'http://schemas.openxmlformats.org/' + namespaces[ext] + '/2006/main') fail('Office document format mismatch')
          main = true
        }
      }
    } finally { zip.close() }
    if (!types || !main) fail('Office format mismatch')
  }
  function pdf(bytes) {
    var document
    try { document = Packages.org.apache.pdfbox.Loader.loadPDF(bytes) } catch(e) { fail('PDF validation unavailable or invalid document') }
    try {
      if (document.isEncrypted() || document.getNumberOfPages() > 500) fail('Unsupported PDF')
      var visited = new java.util.IdentityHashMap(), count = 0
      var dangerous = /^(AA|OpenAction|JS|JavaScript|Launch|EmbeddedFiles|EmbeddedFile|EF|XFA|AcroForm|RichMedia|URI|GoToR|SubmitForm|ImportData|GoToE|Rendition|Movie|Sound|Screen|Filespec|URL)$/
      function inspect(object, depth) {
        if (!object || visited.containsKey(object)) return
        if (++count > 100000 || depth > 256) fail('PDF complexity limit')
        visited.put(object, true)
        if (object instanceof Packages.org.apache.pdfbox.cos.COSObject) return inspect(object.getObject(), depth + 1)
        if (object instanceof Packages.org.apache.pdfbox.cos.COSName && dangerous.test(String(object.getName()))) fail('Active PDF name')
        if (object instanceof Packages.org.apache.pdfbox.cos.COSStream && object.containsKey(Packages.org.apache.pdfbox.cos.COSName.F)) fail('External PDF stream')
        if (object instanceof Packages.org.apache.pdfbox.cos.COSDictionary) {
          var keys = object.keySet().iterator()
          while (keys.hasNext()) {
            var key = keys.next()
            if (dangerous.test(String(key.getName()))) fail('Active PDF content')
            inspect(object.getItem(key), depth + 1)
          }
        } else if (object instanceof Packages.org.apache.pdfbox.cos.COSArray) {
          for (var index = 0; index < object.size(); index++) inspect(object.get(index), depth + 1)
        }
      }
      inspect(document.getDocumentCatalog().getCOSObject(), 0)
      inspect(document.getDocument().getTrailer(), 0)
    } finally { document.close() }
  }
  function validate(filename, bytes) {
    name(filename)
    if (bytes.length > maxFile) fail('File size limit')
    var ext = filename.split('.').pop().toLowerCase()
    if (['docx','xlsx','pptx'].indexOf(ext) >= 0) office(bytes, ext)
    else if (ext === 'pdf') pdf(bytes)
    else if (['png','jpg','jpeg'].indexOf(ext) >= 0) {
      var stream = javax.imageio.ImageIO.createImageInputStream(new java.io.ByteArrayInputStream(bytes))
      try {
        var readers = javax.imageio.ImageIO.getImageReaders(stream)
        if (!readers.hasNext()) fail('Invalid image')
        var reader = readers.next()
        try {
          reader.setInput(stream)
          var format = String(reader.getFormatName()).toLowerCase()
          if ((ext === 'png' && format !== 'png') || (ext !== 'png' && ['jpeg','jpg'].indexOf(format) < 0) || reader.getWidth(0) * reader.getHeight(0) > 40000000) fail('Image format or size limit')
          if (reader.read(0) === null) fail('Invalid image')
        } finally { reader.dispose() }
      } finally { if (stream) stream.close() }
    } else if (ext === 'svg') svg(bytes)
    else {
      var text = utf8(bytes)
      if (text.indexOf('\u0000') >= 0) fail('Binary data in text file')
      if (ext === 'json') JSON.parse(text)
      if (ext === 'csv' && /(?:^|[,;\t\r\n])\s*"?\s*(?:[=+@]|-(?!\d))/m.test(text)) fail('Potential spreadsheet formula in CSV')
    }
    return ext
  }
  function readRegular(path) {
    var p = Paths.get(String(path)), nofollow = java.nio.file.LinkOption.NOFOLLOW_LINKS
    if (!Files.isRegularFile(p, nofollow) || Files.isSymbolicLink(p) || Number(Files.getAttribute(p, 'unix:nlink', nofollow)) !== 1) fail('Output must be a regular unlinked file')
    if (Number(Files.size(p)) > maxFile) fail('File size limit')
    return Files.readAllBytes(p)
  }
  return { name: name, validate: validate, readRegular: readRegular, maxFile: maxFile, maxRun: maxRun, utf8: utf8 }
})()
