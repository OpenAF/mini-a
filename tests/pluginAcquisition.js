// Verify public acquisition using deterministic transport fixtures without running packages.
load('js/skills/mini-a-plugins.js')
var root = String(new java.io.File(io.createTempDir()).getCanonicalPath())
// Fail the suite immediately when a contract is broken.
function check(value, label) {
  if (!value) throw new Error(label)
}
try {
  var manager = new MiniAPluginManager({ homedir: root })
  var archive = root + '/fixture.zip'
  var zip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(archive))
  zip.putNextEntry(new java.util.zip.ZipEntry('repo/plugins/demo/.claude-plugin/plugin.json'))
  zip.write(new java.lang.String('{"name":"demo"}').getBytes('UTF-8'))
  zip.closeEntry()
  zip.close()
  // Substitute only transport; exercise resolution, extraction and management unchanged.
  manager.fetchPublic = function(url, file) {
    if (file) {
      this.copy(archive, file)
      return { bytes: new java.io.File(file).length(), resolvedUrl: url }
    }
    if (url.indexOf('/commits/') >= 0) return '{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    return '{"plugins":[{"name":"demo","source":"./plugins/demo"}]}'
  }
  var search = manager.request({ op: 'search', source: 'claude', query: 'demo' })
  check(search.items.length === 1 && search.errors.length === 0, 'Catalog search')
  var record = manager.request({ op: 'acquire', source: search.items[0].source })
  check(record.id && record.revision.length === 40 && record.compatibility === 'compatible', 'Pinned acquisition')
  check(record.files.indexOf('.claude-plugin/plugin.json') >= 0, 'File inventory')
  var original = manager.request({ op: 'export-original', acquisition: record.id })
  check(original.base64 && original.filename === 'plugin-original.zip', 'Original export')
  manager.request({ op: 'install', acquisition: record.id })
  check(manager.list()[0].enabled === false, 'Install disabled')
  var denied = false
  try { manager.request({ op: 'status', acquisition: '../escape' }) } catch (error) { denied = true }
  check(denied, 'Acquisition containment')
  denied = false
  try { __miniAPluginPublicAddresses('127.0.0.1') } catch (error) { denied = true }
  check(denied, 'Loopback blocked at resolver')
  denied = false
  try { __miniAPluginPublicUrl('https://secret@example.com/a.zip') } catch (error) { denied = true }
  check(denied, 'Embedded credentials blocked')
  // Inspect a VSIX archive as files while preserving its original bytes.
  var vsix = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(root + '/extension.vsix'))
  ;['[Content_Types].xml', 'extension/package.json'].forEach(function(name) {
    vsix.putNextEntry(new java.util.zip.ZipEntry(name))
    vsix.write(new java.lang.String(name.indexOf('json') >= 0 ? '{"name":"extension-fixture"}' : '<Types/>').getBytes('UTF-8'))
    vsix.closeEntry()
  })
  vsix.close()
  archive = root + '/extension.vsix'
  var extension = manager.acquire('https://example.com/extension.vsix')
  check(extension.compatibility === 'inspect-export-only' && extension.metadata.name === 'extension-fixture', 'VSIX metadata inspection')
  // Extract public npm tarballs without executing package lifecycle scripts.
  var tar = new org.apache.commons.compress.archivers.tar.TarArchiveOutputStream(new java.util.zip.GZIPOutputStream(new java.io.FileOutputStream(root + '/package.tgz')))
  var body = new java.lang.String('{"name":"npm-fixture","scripts":{"postinstall":"exit 99"}}').getBytes('UTF-8')
  var entry = new org.apache.commons.compress.archivers.tar.TarArchiveEntry('package/package.json')
  entry.setSize(body.length)
  tar.putArchiveEntry(entry)
  tar.write(body)
  tar.closeArchiveEntry()
  tar.close()
  archive = root + '/package.tgz'
  var npm = manager.acquire('https://example.com/package.tgz')
  check(npm.files.indexOf('package.json') >= 0 && npm.compatibility === 'inspect-export-only', 'npm inspection without execution')
  archive = root + '/fixture.zip'
  // Background jobs expose actionable failure without blocking the management request.
  var job = manager.request({ op: 'acquire', source: 'http://localhost/blocked.zip', background: true })
  var deadline = now() + 5000
  var state
  do {
    java.lang.Thread.sleep(20)
    state = manager.request({ op: 'status', job: job.job })
  } while (['queued', 'running'].indexOf(state.state) >= 0 && now() < deadline)
  check(state.state === 'failed' && state.error.indexOf('HTTPS') >= 0, 'Background failure state')
  var record2 = manager.request({ op: 'acquire', source: { repo: 'example/demo', path: '../escape' } })
  throw new Error('Escaping subdirectory accepted')
} catch (error) {
  if (String(error).indexOf('Package subdirectory escapes repository') < 0) throw error
  print('Plugin acquisition tests passed')
} finally { io.rm(root) }
