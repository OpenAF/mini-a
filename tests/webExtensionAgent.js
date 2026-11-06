// Provider-free deterministic document/diagram tests. Run: oaf -f tests/webExtensionAgent.js
loadLib('js/artifacts/mini-a-document-tools.js', true)
var assertions = 0
function check(condition, message) { assertions++; if (!condition) throw new Error(message) }
function rejects(fn, code) {
  var error
  try { fn() } catch (e) { error = e }
  check(!!error, 'Expected rejection: ' + code)
  if (code) check(error.code === code, 'Expected ' + code + ', received ' + error)
}
var model = '<mxGraphModel custom="kept"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<object id="n1" label="Before" custom="metadata"><mxCell vertex="1" parent="1" style="rounded=1;unknown=preserved;"><mxGeometry x="20" y="30" width="100" height="60" as="geometry"><Array as="points"><mxPoint x="7" y="9"/></Array></mxGeometry></mxCell></object>' +
  '<mxCell id="n2" value="Untouched" parent="1" vertex="1"><mxGeometry x="400" y="100" width="90" height="40" as="geometry"/></mxCell>' +
  '<mxCell id="e1" edge="1" source="n1" target="n2" parent="1"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="250" y="70"/></Array></mxGeometry></mxCell></root></mxGraphModel>'
var native = '<mxfile host="preserved" custom="root"><diagram id="p1" name="Main" custom="page">' + model + '</diagram></mxfile>'
try {
  var overview = MiniADocumentTools.drawio.inspect(native)
  check(overview.totalCells === 5, 'Inspect cell count')
  check(overview.pages[0].cells[2].label === 'Before', 'Inspect wrapped cell labels')
  check(MiniADocumentTools.drawio.patch(native, []).text === native, 'No-op keeps original bytes')
  var changed = MiniADocumentTools.drawio.patch(native, [
    { op: 'setLabel', pageId: 'p1', cellId: 'n1', label: 'After & safe' },
    { op: 'setGeometry', cellId: 'n1', geometry: { x: 22 } },
    { op: 'setStyle', cellId: 'n1', style: { fillColor: '#abcdef' } }
  ])
  check(changed.text.indexOf('custom="metadata"') >= 0 && changed.text.indexOf('custom="page"') >= 0 && changed.text.indexOf('host="preserved"') >= 0, 'Unknown metadata survives')
  check(changed.text.indexOf('unknown=preserved') >= 0, 'Unknown styles survive')
  check(changed.text.indexOf('x="250"') >= 0 && changed.text.indexOf('y="70"') >= 0 && changed.text.indexOf('x="7"') >= 0, 'Waypoints survive')
  check(changed.metadata.pages[0].cells[2].label === 'After & safe', 'Wrapped cell label updated')
  check(changed.metadata.pages[0].cells[2].geometry.x === '22' && changed.metadata.pages[0].cells[2].geometry.y === '30', 'Only targeted geometry changes')
  check(changed.metadata.pages[0].cells[3].geometry.x === '400', 'Unrelated layout remains unchanged')
  var added = MiniADocumentTools.drawio.patch(native, [
    { op: 'addVertex', cellId: 'n3', label: 'Added', geometry: { x: 10, y: 20, width: 80, height: 30 } },
    { op: 'addEdge', cellId: 'e2', source: 'n2', target: 'n3' }
  ])
  check(added.metadata.totalCells === 7, 'Add vertex and edge without relayout')
  rejects(function() { MiniADocumentTools.drawio.patch(native, [{ op: 'removeCell', cellId: 'n1' }]) }, 'invalid_request')
  var removed = MiniADocumentTools.drawio.patch(native, [{ op: 'removeCell', cellId: 'e1' }, { op: 'removeCell', cellId: 'n1' }])
  check(removed.metadata.totalCells === 3, 'Explicit connected removals')
  rejects(function() { MiniADocumentTools.drawio.patch(native, [{ op: 'setGeometry', cellId: 'n1', geometry: { x: Infinity } }]) }, 'invalid_request')
  rejects(function() { MiniADocumentTools.drawio.patch(native, [{ op: 'setLabel', cellId: 'n1', label: 'plain', style: {} }]) }, 'invalid_request')
  rejects(function() { MiniADocumentTools.drawio.patch(native, [{ op: 'setStyle', cellId: 'n1', style: { image: 'https://example.test/x' } }]) }, 'invalid_request')
  rejects(function() { MiniADocumentTools.drawio.validate('<!DOCTYPE mxfile [<!ENTITY e SYSTEM "file:///etc/passwd">]><mxfile>&e;</mxfile>') }, 'invalid_document')
  rejects(function() { MiniADocumentTools.drawio.validate(native.replace('Before', '&lt;img src=&quot;https://example.test/a&quot;&gt;')) }, 'invalid_document')
  rejects(function() { MiniADocumentTools.drawio.validate(native.replace('Before', '&lt;script&gt;alert(1)&lt;/script&gt;')) }, 'invalid_document')
  rejects(function() { MiniADocumentTools.drawio.validate(native.replace('id="n2"', 'id="n1"')) }, 'invalid_document')
  rejects(function() { MiniADocumentTools.drawio.validate('<mxfile><diagram id="p">not-base64!</diagram></mxfile>') }, 'invalid_document')
  function compressDiagramFixture(value) {
    var deflater = new java.util.zip.Deflater(6, true), out = new java.io.ByteArrayOutputStream(), buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
    try {
      deflater.setInput(new java.lang.String(encodeURIComponent(value)).getBytes('UTF-8')); deflater.finish()
      while (!deflater.finished()) { var length = deflater.deflate(buffer); out.write(buffer, 0, length) }
      return String(java.util.Base64.getEncoder().encodeToString(out.toByteArray()))
    } finally { deflater.end(); out.close() }
  }
  var packed = '<mxfile><diagram id="compressed" name="Compressed">' + compressDiagramFixture(model) + '</diagram></mxfile>'
  check(MiniADocumentTools.drawio.inspect(packed).totalCells === 5, 'Read compressed page')
  check(MiniADocumentTools.drawio.patch(packed, [{ op: 'setLabel', cellId: 'n1', label: 'Edited' }]).text.indexOf('compressed="false"') >= 0, 'Patch compressed page safely')
  var bomb = '<mxfile><diagram id="bomb">' + compressDiagramFixture('x'.repeat(8 * 1024 * 1024 + 1)) + '</diagram></mxfile>'
  rejects(function() { MiniADocumentTools.drawio.validate(bomb) }, 'size_limit')
  var nodeFlood = compressDiagramFixture('<mxGraphModel><root>' + '<x/>'.repeat(16000) + '</root></mxGraphModel>')
  rejects(function() { MiniADocumentTools.drawio.validate('<mxfile><diagram id="a">' + nodeFlood + '</diagram><diagram id="b">' + nodeFlood + '</diagram></mxfile>') }, 'size_limit')
  var item = { artifact: { id: 'doc-1', revision: 1, title: 'Test', artifactType: 'diagram/drawio', native: { mimeType: 'application/vnd.jgraph.mxfile', filename: 'test.drawio', byteLength: native.length } }, content: { encoding: 'utf8', text: native } }, reads = 0, saves = 0, live = true
  var store = {
    read: function(id) { reads++; if (id !== item.artifact.id) throw new Error('Missing'); return item },
    save: function(value) {
      saves++
      if (value.id && value.expectedRevision !== item.artifact.revision) throw new Error('Conflict')
      item = { artifact: { id: value.id || 'created', revision: value.id ? item.artifact.revision + 1 : 1, title: value.title, native: { mimeType: value.mimeType, filename: value.filename } }, content: value.content }
      return item.artifact
    }
  }
  var tools = MiniADocumentTools.create({ store: store, allowedIds: ['doc-1'], live: function() { return live } })
  rejects(function() { tools.read({ artifactId: 'other' }) }, 'permission_denied')
  check(reads === 0, 'Permission check precedes store access')
  check(tools.inspect({ artifactId: 'doc-1' }).metadata.totalCells === 5, 'Inspect works without an editor')
  var proposal = tools.patch({ artifactId: 'doc-1', expectedRevision: 1, operations: [{ op: 'setLabel', cellId: 'n1', label: 'Proposal' }] })
  check(proposal.kind === 'document-edit-proposal' && saves === 0, 'Read-only scope proposes without saving')
  rejects(function() { tools.patch({ artifactId: 'doc-1', expectedRevision: 2, operations: [] }) }, 'revision_conflict')
  var writer = MiniADocumentTools.create({ store: store, allowedIds: ['doc-1'], allowWrite: true, live: function() { return live } })
  check(writer.patch({ artifactId: 'doc-1', expectedRevision: 1, operations: proposal.operations }).artifact.revision === 2 && saves === 1, 'Authorized CAS commit works while editor closed')
  live = false
  rejects(function() { writer.inspect({ artifactId: 'doc-1' }) }, 'revoked')
  rejects(function() { tools.create({ title: 'No', mimeType: 'text/plain', filename: 'no.txt', content: { encoding: 'utf8', text: '' } }) }, 'revoked')
  var creator = MiniADocumentTools.create({ store: store, allowCreate: true })
  check(creator.create({ title: 'Created', mimeType: 'text/plain', filename: 'new.txt', content: { encoding: 'utf8', text: 'Hello' } }).artifact.id === 'created', 'Explicit create permission')
  check(creator.read({ artifactId: 'created' }).content.text === 'Hello', 'Created ID joins only this scope')
  print('PASS ' + assertions + ' document scope and deterministic draw.io assertions')
} catch (error) { printErr(error); exit(1) }
