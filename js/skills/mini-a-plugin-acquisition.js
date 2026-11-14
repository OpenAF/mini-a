// Bound background acquisition work within this process.
if (typeof __miniAPluginAcquisitionSlots === 'undefined') var __miniAPluginAcquisitionSlots = new java.util.concurrent.Semaphore(2)

// Reject credentials and non-HTTPS artifact locations before DNS resolution.
function __miniAPluginPublicUrl(value) {
  var uri = new java.net.URI(String(value))
  if (String(uri.getScheme()) !== 'https' || uri.getUserInfo() !== null || uri.getHost() === null || uri.getFragment() !== null) throw new Error('Use a public HTTPS URL without credentials or fragments')
  return uri
}

// Validate the actual addresses returned to the HTTP client's connection resolver.
function __miniAPluginPublicAddresses(host) {
  var addresses = java.net.InetAddress.getAllByName(host)
  for (var i = 0; i < addresses.length; i++) {
    var address = addresses[i]
    var bytes = address.getAddress()
    if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) throw new Error('Download destination must be public')
    if (bytes.length === 16 && (bytes[0] & 254) === 252) throw new Error('Download destination must be public')
    if (bytes.length === 4 && ((bytes[0] & 255) === 0 || (bytes[0] & 255) >= 224 || (bytes[0] & 255) === 100 && ((bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127))) throw new Error('Download destination must be public')
  }
  return java.util.Arrays.asList(addresses)
}

// Stream bounded responses using OpenAF's bundled HTTP client and validated DNS.
MiniAPluginManager.prototype.fetchPublic = function(source, file, limit) {
  var resolver = new JavaAdapter(Packages.okhttp3.Dns, { lookup: __miniAPluginPublicAddresses })
  var client = new Packages.okhttp3.OkHttpClient.Builder()
    .dns(resolver)
    .proxy(java.net.Proxy.NO_PROXY)
    .followRedirects(false)
    .followSslRedirects(false)
    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
    .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
    .callTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
    .build()
  var current = String(source)
  var started = now()
  var self = this
  try {
    for (var redirects = 0; redirects <= 5; redirects++) {
      __miniAPluginPublicUrl(current)
      var response = client.newCall(new Packages.okhttp3.Request.Builder().url(current).header('User-Agent', 'Mini-A-Plugin-Manager').build()).execute()
      try {
        var code = Number(response.code())
        if ([301, 302, 303, 307, 308].indexOf(code) >= 0) {
          var location = response.header('Location')
          if (location === null) throw new Error('Redirect has no destination')
          current = String(new java.net.URI(current).resolve(String(location)))
          continue
        }
        if (code !== 200) throw new Error('Public source returned HTTP ' + code)
        var input = response.body().byteStream()
        var output = file ? new java.io.FileOutputStream(file) : new java.io.ByteArrayOutputStream()
        try {
          var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
          var total = 0
          var count
          while ((count = input.read(buffer)) !== -1) {
            if (self._publicJob && io.fileExists(self._publicJob + '/cancel')) throw new Error('Acquisition cancelled')
            total += count
            if (total > limit || now() - started > 60000) throw new Error('Download exceeds size or time limit')
            output.write(buffer, 0, count)
          }
          return file ? { resolvedUrl: current, bytes: total } : String(new java.lang.String(output.toByteArray(), 'UTF-8'))
        } finally {
          input.close()
          output.close()
        }
      } finally { response.close() }
    }
    throw new Error('Too many download redirects')
  } finally {
    client.connectionPool().evictAll()
    client.dispatcher().executorService().shutdown()
  }
}

// Read bounded public metadata without invoking vendor tools or package scripts.
MiniAPluginManager.prototype.publicJson = function(url) {
  return jsonParse(this.fetchPublic(url, null, 4 * 1024 * 1024))
}

// Keep source identities independent of package display names.
MiniAPluginManager.prototype.publicSources = function() {
  var defaults = [
    { id: 'claude', provider: 'claude', repo: 'anthropics/claude-plugins-official', catalog: '.claude-plugin/marketplace.json' },
    { id: 'codex', provider: 'codex', repo: 'openai/plugins', catalog: '.agents/plugins/marketplace.json' },
    { id: 'copilot', provider: 'copilot', repo: 'github/awesome-copilot', ref: 'marketplace', catalog: '.github/plugin/marketplace.json' }
  ]
  var file = this.root + '/.public-sources.json'
  return io.fileExists(this.access.assert(file)) ? io.readFileJSON(file) : defaults
}

// Resolve GitHub repositories to a fixed commit before reading catalogs or packages.
MiniAPluginManager.prototype.resolvePublic = function(source) {
  var value = isString(source) ? { url: source } : merge({}, source)
  var url = String(value.url || '')
  var match = /^(?:github:|https:\/\/github.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url)
  if (isString(value.repo)) match = [value.repo, value.repo]
  if (match) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(match[1])) throw new Error('Invalid repository')
    var ref = value.sha || value.ref || 'HEAD'
    var commit = /^[a-f0-9]{40}$/i.test(ref) ? ref : this.publicJson('https://api.github.com/repos/' + match[1] + '/commits/' + encodeURIComponent(ref)).sha
    if (!isString(commit) || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Repository did not resolve to a commit')
    return { kind: 'zip', repo: match[1], revision: commit, subdir: value.path || '', url: 'https://codeload.github.com/' + match[1] + '/zip/' + commit }
  }
  if (url.indexOf('npm:') === 0) {
    var spec = url.substring(4)
    var split = spec.lastIndexOf('@')
    var name = split > 0 ? spec.substring(0, split) : spec
    var version = split > 0 ? spec.substring(split + 1) : 'latest'
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) throw new Error('Invalid npm package')
    var metadata = this.publicJson('https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + encodeURIComponent(version))
    if (!isMap(metadata.dist) || !isString(metadata.dist.tarball)) throw new Error('npm package has no artifact')
    return { kind: 'tgz', url: metadata.dist.tarball, version: metadata.version, integrity: metadata.dist.integrity, shasum: metadata.dist.shasum, subdir: '' }
  }
  __miniAPluginPublicUrl(url)
  return { kind: /\.vsix(?:\?|$)/i.test(url) ? 'vsix' : /\.(tgz|tar.gz)(?:\?|$)/i.test(url) ? 'tgz' : 'zip', url: url, subdir: value.path || '' }
}

// Normalize marketplace entries while preserving unsupported source diagnostics.
MiniAPluginManager.prototype.searchPublic = function(request) {
  var sources = this.publicSources()
  if (request.source === 'opencode' || request.source === 'npm') {
    var registry = this.publicJson('https://registry.npmjs.org/-/v1/search?size=50&text=' + encodeURIComponent(request.query || 'opencode-plugin'))
    return { items: registry.objects.map(function(item) {
      return { id: 'npm:' + item.package.name, name: item.package.name, description: item.package.description, provider: 'npm', source: { url: 'npm:' + item.package.name + '@' + item.package.version }, compatibility: 'not-inspected' }
    }), total: registry.total, errors: [] }
  }
  var selected = sources.filter(function(item) { return !request.source || item.id === request.source })
  var results = []
  var errors = []
  var self = this
  selected.forEach(function(source) {
    try {
      var resolved = self.resolvePublic({ repo: source.repo, ref: source.ref })
      var catalog = self.publicJson('https://raw.githubusercontent.com/' + resolved.repo + '/' + resolved.revision + '/' + source.catalog)
      if (!isArray(catalog.plugins)) throw new Error('Catalog must contain plugins')
      catalog.plugins.forEach(function(entry) {
        if (!isString(entry.name)) return
        var descriptor = entry.source
        var normalized
        if (isString(descriptor)) normalized = !/^https:\/\//.test(descriptor) ? { repo: resolved.repo, sha: resolved.revision, path: descriptor } : { url: descriptor }
        else if (isMap(descriptor)) {
          if (descriptor.source === 'local' || descriptor.source === 'relative') normalized = { repo: resolved.repo, sha: resolved.revision, path: descriptor.path }
          else if (descriptor.source === 'github') normalized = { repo: descriptor.repo, ref: descriptor.ref, sha: descriptor.sha, path: descriptor.path }
          else if (descriptor.source === 'npm') normalized = { url: 'npm:' + descriptor.package + (descriptor.version ? '@' + descriptor.version : '') }
          else normalized = { url: descriptor.url, ref: descriptor.ref, sha: descriptor.sha, path: descriptor.path }
        }
        var item = { id: source.id + ':' + entry.name, name: entry.name, description: entry.description || '', provider: source.provider, source: normalized, compatibility: 'not-inspected' }
        if (String(item.name + ' ' + item.description).toLowerCase().indexOf(String(request.query || '').toLowerCase()) >= 0) results.push(item)
      })
    } catch (error) { errors.push({ source: source.id, error: String(error) }) }
  })
  var offset = Math.max(0, Number(request.offset) || 0)
  return { items: results.slice(offset, offset + 50), total: results.length, errors: errors }
}

// Extract npm tarballs with the same containment and expansion limits as ZIPs.
MiniAPluginManager.prototype.extractPublicTar = function(file, root) {
  var stream = new org.apache.commons.compress.archivers.tar.TarArchiveInputStream(new java.util.zip.GZIPInputStream(new java.io.FileInputStream(file)))
  var total = 0
  var count = 0
  var seen = {}
  try {
    var entry
    while ((entry = stream.getNextTarEntry()) !== null) {
      var name = String(entry.getName())
      var target = __miniAPluginResolveContained(root, name)
      if (++count > 10000 || !target.ok || seen[target.path] || /(^\/|\\|(^|\/)\.\.($|\/))/.test(name) || (!entry.isDirectory() && !entry.isFile())) throw new Error('Unsafe tar entry')
      seen[target.path] = true
      if (entry.isDirectory()) { io.mkdir(target.path); continue }
      io.mkdir(String(new java.io.File(target.path).getParent()))
      var output = new java.io.FileOutputStream(target.path)
      try {
        var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
        var length
        while ((length = stream.read(buffer)) !== -1) {
          total += length
          if (total > 100 * 1024 * 1024) throw new Error('Archive exceeds 100 MiB expanded')
          output.write(buffer, 0, length)
        }
      } finally { output.close() }
    }
  } finally { stream.close() }
  return io.fileExists(root + '/package') ? root + '/package' : root
}

// Retrieve immutable acquisition records without accepting client-controlled paths.
MiniAPluginManager.prototype.acquisition = function(id) {
  if (!isString(id) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid acquisition ID')
  var root = this.access.assert(this.root + '/.acquisitions/' + id)
  var record = io.readFileJSON(root + '/provenance.json')
  record.path = root + '/original.' + record.kind
  record.packagePath = root + '/package'
  return record
}

// Preserve downloaded bytes and inspect portable components without executing code.
MiniAPluginManager.prototype.acquire = function(source) {
  var resolved = this.resolvePublic(source)
  var id = String(java.util.UUID.randomUUID())
  var cache = this.access.assert(this.root + '/.acquisitions')
  if (io.fileExists(cache) && io.listFiles(cache).files.length >= 20) throw new Error('Acquisition cache is full; list acquisitions and remove unused artifacts')
  var destination = this.access.assert(cache + '/' + id)
  io.mkdir(destination)
  var extracted = null
  try {
    var file = destination + '/original.' + resolved.kind
    var transfer = this.fetchPublic(resolved.url, file, 25 * 1024 * 1024)
    var bytes = io.readFileBytes(file)
    if (resolved.integrity) {
      var integrity = /^(sha512|sha256)-([A-Za-z0-9+/=]+)$/.exec(resolved.integrity)
      if (!integrity) throw new Error('Unsupported registry integrity')
      var digest = java.security.MessageDigest.getInstance(integrity[1] === 'sha512' ? 'SHA-512' : 'SHA-256').digest(bytes)
      if (String(java.util.Base64.getEncoder().encodeToString(digest)) !== integrity[2]) throw new Error('Registry integrity mismatch')
    } else if (resolved.shasum && sha1(bytes) !== resolved.shasum) throw new Error('Registry checksum mismatch')
    var packagePath
    if (resolved.kind === 'tgz') {
      io.mkdir(destination + '/unpack')
      packagePath = this.extractPublicTar(file, destination + '/unpack')
    } else {
      extracted = this.extract(file, resolved.kind === 'vsix')
      packagePath = extracted.path
    }
    var contained = __miniAPluginResolveContained(packagePath, resolved.subdir || '.')
    if (!contained.ok) throw new Error('Package subdirectory escapes repository')
    this.copy(contained.path, destination + '/package')
    var record = merge(merge(resolved, transfer), { id: id, source: source, bytes: bytes.length, retrievedAt: now(), sha256: sha256(bytes), compatibility: 'inspect-export-only' })
    try {
      record.report = this.buildPackage({ op: 'inspect', source: destination + '/package', target: 'minia' })
      record.compatibility = record.report.blockers.length ? 'partially-compatible' : 'compatible'
    } catch (error) { record.diagnostic = String(error) }
    if (resolved.kind === 'vsix' && io.fileExists(destination + '/package/extension/package.json')) record.metadata = this.readConfig(destination + '/package/extension/package.json')
    record.files = []
    var inventory = function(path, prefix) {
      io.listFiles(path).files.forEach(function(entry) {
        if (entry.isDirectory) inventory(path + '/' + entry.filename, prefix + entry.filename + '/')
        else record.files.push(prefix + entry.filename)
      })
    }
    inventory(destination + '/package', '')
    io.writeFileJSON(destination + '/provenance.json', record)
    return record
  } catch (error) {
    io.rm(destination)
    throw error
  } finally {
    if (extracted !== null) io.rm(extracted.root)
    if (io.fileExists(destination + '/unpack')) io.rm(destination + '/unpack')
  }
}

// Dispatch public acquisition and reuse the local manager for compatible packages.
MiniAPluginManager.prototype.request = (function(previous) {
  return function(request) {
    if (request.op === 'acquisitions') {
      var cache = this.access.assert(this.root + '/.acquisitions')
      return io.fileExists(cache) ? io.listFiles(cache).files.filter(function(entry) { return entry.isDirectory && io.fileExists(cache + '/' + entry.filename + '/provenance.json') }).map(function(entry) { return this.acquisition(entry.filename) }, this) : []
    }
    if (request.op === 'acquisition-remove') {
      var removed = this.acquisition(request.acquisition)
      io.rm(String(new java.io.File(removed.path).getParent()))
      return { removed: removed.id }
    }
    if (request.op === 'sources') return this.publicSources()
    if (request.op === 'search') return this.searchPublic(request)
    if (request.op === 'resolve') return this.resolvePublic(request.source)
    if (request.op === 'acquire') return request.background === true ? this.startAcquisition(request.source) : this.acquire(request.source)
    if (request.job && (request.op === 'status' || request.op === 'cancel')) {
      var jobPath = this.publicJobPath(request.job)
      if (request.op === 'cancel') io.writeFileString(jobPath + '/cancel', 'cancel')
      return io.readFileJSON(jobPath + '/state.json')
    }
    if (request.op === 'source-add' || request.op === 'source-remove') {
      var sources = this.publicSources().filter(function(item) { return item.id !== request.id })
      if (!/^[a-z0-9-]+$/.test(String(request.id))) throw new Error('Invalid source ID')
      if (request.op === 'source-add') {
        if (!isMap(request.source) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(request.source.repo)) || !isString(request.source.catalog) || !__miniAPluginResolveContained('/catalog', request.source.catalog).ok) throw new Error('Source requires repository and contained catalog path')
        sources.push(merge(request.source, { id: request.id }))
      }
      this.access.assert(this.root)
      io.mkdir(this.root)
      this.writeState(this.root + '/.public-sources.json', sources)
      return sources
    }
    if (request.acquisition) {
      var record = this.acquisition(request.acquisition)
      if (request.op === 'status' || request.op === 'inspect') return record
      if (request.op === 'export-original') {
        if (request.out) {
          this.access.assert(request.out)
          if (io.fileExists(request.out)) throw new Error('Destination already exists')
          this.copy(record.path, request.out)
          return { out: request.out, sha256: record.sha256 }
        }
        return { filename: 'plugin-original.' + record.kind, base64: String(java.util.Base64.getEncoder().encodeToString(io.readFileBytes(record.path))) }
      }
      if (['install', 'convert', 'export'].indexOf(request.op) >= 0) {
        var result = previous.call(this, merge(request, { source: record.packagePath }))
        if (request.op === 'install' && request.dryRun !== true) {
          this.writeState(this.access.assert(this.root + '/' + result.id + '/acquisition.json'), { source: record.source, revision: record.revision, version: record.version, sha256: record.sha256, retrievedAt: record.retrievedAt })
        }
        return result
      }
    }
    if (['inspect', 'convert', 'export', 'install'].indexOf(request.op) >= 0 && isString(request.source) && /^(https:\/\/|github:|npm:)/i.test(request.source)) {
      var artifact = this.acquire(request.source)
      if (request.op === 'inspect') return artifact
      return this.request(merge(request, { acquisition: artifact.id, source: undefined }))
    }
    return previous.call(this, request)
  }
})(MiniAPluginManager.prototype.request)

// Resolve opaque job IDs within the managed acquisition area.
MiniAPluginManager.prototype.publicJobPath = function(id) {
  if (!isString(id) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid job ID')
  return this.access.assert(this.root + '/.acquisition-jobs/' + id)
}

// Run web acquisition independently so progress and cancellation requests remain responsive.
MiniAPluginManager.prototype.startAcquisition = function(source) {
  if (!__miniAPluginAcquisitionSlots.tryAcquire()) throw new Error('Acquisition workers are busy; retry shortly')
  var id = String(java.util.UUID.randomUUID())
  var path = this.publicJobPath(id)
  io.mkdir(path)
  this.writeState(path + '/state.json', { job: id, state: 'queued' })
  var worker = new MiniAPluginManager(this.options)
  worker._publicJob = path
  $doV(function() {
    try {
      worker.writeState(path + '/state.json', { job: id, state: 'running' })
      if (io.fileExists(path + '/cancel')) throw new Error('Acquisition cancelled')
      var result = worker.acquire(source)
      if (io.fileExists(path + '/cancel')) {
        worker.request({ op: 'acquisition-remove', acquisition: result.id })
        throw new Error('Acquisition cancelled')
      }
      worker.writeState(path + '/state.json', { job: id, state: 'complete', result: result })
    } catch (error) {
      worker.writeState(path + '/state.json', { job: id, state: io.fileExists(path + '/cancel') ? 'cancelled' : 'failed', error: String(error) })
    } finally { __miniAPluginAcquisitionSlots.release() }
  })
  return { job: id, state: 'queued' }
}
