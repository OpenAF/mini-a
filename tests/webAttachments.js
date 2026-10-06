// OpenAF filesystem and reader integration; no provider calls or dependency installs.
load('mini-a-web-attachments.js')
load('mini-a-utils.js')
function check(value, message) { if (!value) throw new Error(message) }
function rejects(fn, pattern) {
  var error
  try { fn() } catch(e) { error = String(e) }
  check(isString(error) && pattern.test(error), 'Expected error ' + pattern + ', got ' + error)
}
var source = MiniAWebAttachments.open(), tempPaths = [], questions = []
var originalOpen = MiniAWebAttachments.open, originalExtractor = MiniUtilsTool.prototype._createDocumentExtractor
var originalAttach = global.__useattach
try {
  global.__useattach = true
  var image = new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_RGB)
  javax.imageio.ImageIO.write(image, 'png', new java.io.File(source.path + '/image.png'))
  image.flush()
  var pdf = source.path + '/report.pdf'
  io.writeFileString(pdf, '%PDF-1.4\nfixture')
  var office = source.path + '/report.docx'
  var zip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(office))
  ;['[Content_Types].xml', 'word/document.xml'].forEach(function(name) {
    zip.putNextEntry(new java.util.zip.ZipEntry(name))
    zip.write(new java.lang.String('<fixture/>').getBytes('UTF-8'))
    zip.closeEntry()
  })
  zip.close()
  function attachment(name, path) { return { name: name, base64: String(java.util.Base64.getEncoder().encodeToString(java.nio.file.Files.readAllBytes(new java.io.File(path).toPath()))) } }
  var uploads = [attachment('image.png', source.path + '/image.png'), attachment('report.docx', office), attachment('report.pdf', pdf)]
  MiniUtilsTool.prototype._createDocumentExtractor = function(maxChars) {
    check(maxChars === 30000, 'Default text bound')
    check(this._readWrite === false, 'Upload readers are read-only')
    var root = this._root
    return { extractFile: function(path) {
      check(String(path).indexOf(root) === 0, 'Uploaded files stay in reader root')
      return { mediaType: 'fixture', text: 'Document fixture text', metadata: {}, truncated: /pdf$/.test(path) }
    } }
  }
  MiniAWebAttachments.open = function() { var temp = originalOpen.call(this); tempPaths.push(temp.path); return temp }
  var agent = { _inspectImageWithModel: function(request) { questions.push(request.prompt); return 'A black square' } }
  var progress = []
  var result = MiniAWebAttachments.process(MiniAWebAttachments.validate(uploads, 'Compare these'), 'Compare these', agent, function() { return true }, function(message) { progress.push(message) })
  check(result.indexOf('image analysis') >= 0 && result.indexOf('Document fixture text') >= 0 && result.indexOf('truncated') >= 0, 'Reader results and truncation reach goal')
  check(questions[0] === 'Compare these' && progress.length === 3, 'Question and progress reach readers')
  check(!io.fileExists(tempPaths[0]), 'Success removes temporary originals')
  var wrong = attachment('bad.jpg', source.path + '/image.png')
  rejects(function() { MiniAWebAttachments.process(MiniAWebAttachments.validate([wrong], 'Inspect'), 'Inspect', agent, function() { return true }, function() {}) }, /bad.jpg.*format/)
  check(!io.fileExists(tempPaths[1]), 'Invalid signature cleans files')
  rejects(function() { MiniAWebAttachments.process(MiniAWebAttachments.validate(uploads, 'Inspect'), 'Inspect', agent, function() { return false }, function() {}) }, /cancelled/)
  check(!io.fileExists(tempPaths[2]), 'Cancellation cleans files')
  MiniUtilsTool.prototype._createDocumentExtractor = function() { throw new Error('Tika unavailable') }
  rejects(function() { MiniAWebAttachments.process(MiniAWebAttachments.validate([uploads[1]], 'Read'), 'Read', agent, function() { return true }, function() {}) }, /report.docx.*Tika/)
  check(!io.fileExists(tempPaths[3]), 'Reader failure cleans files')
  var orphan = originalOpen.call(MiniAWebAttachments)
  orphan.lock.release(); orphan.file.close()
  MiniAWebAttachments.cleanup()
  check(!io.fileExists(orphan.path), 'Startup recovers abandoned directory')
  check(io.fileExists(source.path), 'Startup keeps active locked directories')
  print('Web attachment OpenAF reader and cleanup checks passed')
} finally {
  MiniAWebAttachments.open = originalOpen
  MiniUtilsTool.prototype._createDocumentExtractor = originalExtractor
  global.__useattach = originalAttach
  MiniAWebAttachments.close(source)
}
