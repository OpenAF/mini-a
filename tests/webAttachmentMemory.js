// Run with OAF_JARGS=-Xmx256m oaf -f tests/webAttachmentMemory.js.
load('mini-a-web-attachments.js')
global.__useattach = true
function check(value, message) { if (!value) throw new Error(message) }
function rejects(value, name) {
  var failed = false
  try { MiniAWebAttachments.validate([{name:name || 'image.png',base64:value}], 'Inspect') } catch(e) { failed = true }
  check(failed, 'Expected rejection')
}
try {
  // Each boundary has different padding; retain only one large payload at a time.
  ;[10 * 1024 * 1024 - 2, 10 * 1024 * 1024 - 1, 10 * 1024 * 1024].forEach(function(size) {
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, size)
    var value = String(java.util.Base64.getEncoder().encodeToString(bytes))
    bytes = null
    var result = MiniAWebAttachments.validate([{name:'image.png',base64:value}], 'Inspect')
    check(result[0].size === size, 'Image boundary and padding accepted')
    rejects(value.substring(0, value.length - 4) + 'AA=A')
    rejects(value.substring(0, value.length - 4) + 'AAA%')
    result = null; value = null
    java.lang.System.gc()
  })
  ;['', 'A', 'AAA', '====', 'A===', 'AA=A', '=AAA', 'AA==AAAA', 'AAA\n', 'AAA_'].forEach(function(value) { rejects(value) })
  ;['AAAA', 'AAA=', 'AA==', '/+/+'].forEach(function(value) { check(MiniAWebAttachments.validBase64(value), 'Valid alphabet/padding') })
  var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 10 * 1024 * 1024 + 1)
  rejects(String(java.util.Base64.getEncoder().encodeToString(bytes)))
  bytes = null
  java.lang.System.gc()
  bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 20 * 1024 * 1024)
  var document = String(java.util.Base64.getEncoder().encodeToString(bytes))
  bytes = null
  check(MiniAWebAttachments.validate([{name:'report.pdf',base64:document}], 'Read')[0].size === 20 * 1024 * 1024, 'Document limit accepted')
  var combinedRejected = false
  try { MiniAWebAttachments.validate([{name:'report.pdf',base64:document},{name:'image.png',base64:'AAAA'}], 'Read') } catch(e) { combinedRejected = /combined/.test(String(e)) }
  check(combinedRejected, 'Combined limit enforced')
  print('Rhino attachment memory regression passed')
} catch(e) { printErr(e); exit(1) }
