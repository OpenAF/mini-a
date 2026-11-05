// Trusted control process; model programs run only inside the child sandbox.
var MiniAArtifactWorker = (function() {
  var active = null, ready = false, token = '', scratch = '', validatorLibraries = [], lock = new java.util.concurrent.locks.ReentrantLock()
  function fail(message) { throw new Error(message) }
  function bounded(path, maximum) {
    var value = io.readFileString(path).trim()
    if (!/^\d+$/.test(value) || Number(value) > maximum) fail('Required cgroup limit missing: ' + path)
  }
  function init(args) {
    ready = false
    token = String(getEnv('MINIA_ARTIFACT_WORKER_TOKEN') || '')
    if (token.length < 32) fail('MINIA_ARTIFACT_WORKER_TOKEN must contain at least 32 characters')
    if (String(java.lang.System.getProperty('os.name')).toLowerCase().indexOf('linux') < 0) fail('Linux required')
    bounded('/sys/fs/cgroup/memory.max', 512 * 1024 * 1024)
    bounded('/sys/fs/cgroup/memory.swap.max', 0)
    bounded('/sys/fs/cgroup/pids.max', 128)
    var cpu = io.readFileString('/sys/fs/cgroup/cpu.max').trim().split(/\s+/)
    if (cpu[0] === 'max' || Number(cpu[0]) / Number(cpu[1]) > 1) fail('One CPU cgroup limit required')
    scratch = '/jobs'
    var store = java.nio.file.Files.getFileStore(java.nio.file.Paths.get(scratch))
    if (String(store.type()) !== 'tmpfs' || Number(store.getTotalSpace()) > 128 * 1024 * 1024) fail('/jobs must be a tmpfs capped at 128 MiB')
    validatorLibraries = String(getEnv('MINIA_ARTIFACT_LIBS') || '').split(',').map(function(p) { return p.trim() }).filter(function(p) { return p.length > 0 })
    validatorLibraries.forEach(function(p) { if (p.indexOf('/openaf/') !== 0 || p.indexOf('..') >= 0) fail('Validator libraries must be in the immutable /openaf runtime'); loadLib(p) })
    // Execute a real probe; installed-but-unusable bubblewrap is not sufficient.
    var probe = launch(scratch, 'print("ready")', true)
    if (probe.exit !== 0) fail('Sandbox probe failed')
    ready = true
  }
  function kill(process) {
    if (!process) return
    try {
      var descendants = process.toHandle().descendants()
      try { descendants.forEach(function(handle) { handle.destroyForcibly() }) } finally { descendants.close() }
    } catch(ignore) {}
    process.destroyForcibly()
    try { process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS) } catch(ignoreWait) {}
  }
  function launch(root, code, probe, sourceOutput) {
    var dir = java.nio.file.Files.createTempDirectory(java.nio.file.Paths.get(root), 'job-').toFile(), path = String(dir.getCanonicalPath())
    var input = path + '/input', output = path + '/output'
    io.mkdir(input); io.mkdir(output)
    var process
    try {
      io.writeFileString(input + '/program.js', 'java.lang.System.setProperty("user.dir", "/work");\ntry { eval(' + stringify(code) + '); io.writeFileString("/work/.complete", "ok"); } catch(e) { java.lang.System.exit(1); }')
      var command = ['bwrap', '--die-with-parent', '--unshare-all', '--cap-drop', 'ALL', '--new-session', '--clearenv', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/home/worker']
      ;['/openaf', '/usr/lib/jvm', '/usr/lib', '/lib', '/lib64', '/etc/fonts', '/usr/share/fonts'].forEach(function(mount) {
        if (io.fileExists(mount)) command.push('--ro-bind', mount, mount)
      })
      if (sourceOutput) command.push('--ro-bind', sourceOutput, '/source')
      command = command.concat(['--ro-bind', input, '/input', '--bind', output, '/work', '--chdir', '/work', '--setenv', 'HOME', '/home/worker', '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8', '--', String(java.lang.System.getProperty('java.home')) + '/bin/java', '-Xmx192m', '-Djava.awt.headless=true', '-Djava.io.tmpdir=/tmp', '-jar', '/openaf/openaf.jar', '-f', '/input/program.js'])
      var list = new java.util.ArrayList()
      command.forEach(function(value) { list.add(String(value)) })
      var builder = new java.lang.ProcessBuilder(list)
      builder.environment().clear()
      builder.redirectOutput(java.lang.ProcessBuilder.Redirect.DISCARD)
      builder.redirectError(java.lang.ProcessBuilder.Redirect.DISCARD)
      process = builder.start()
      process.getOutputStream().close()
      if (!probe) active.process = process
      var deadline = probe ? Date.now() + 15000 : active.deadline
      while (!process.waitFor(100, java.util.concurrent.TimeUnit.MILLISECONDS)) {
        if (Date.now() > deadline || (!probe && active.cancelled)) { kill(process); fail('Generation cancelled or timed out') }
      }
      var exit = process.exitValue()
      if (!io.fileExists(output + '/.complete')) exit = 1
      kill(process)
      return { exit: exit, path: path, output: output }
    } catch(e) {
      kill(process)
      io.rm(path)
      throw e
    } finally {
      if (probe) io.rm(path)
    }
  }
  function request(request) {
    function reply(data, status) { return ow.server.httpd.reply(data, status || 200) }
    if (request.method !== 'POST') return reply({error:'method not allowed'},405)
    var supplied = request.header && request.header['x-mini-a-worker-token']
    if (!isString(supplied) || !java.security.MessageDigest.isEqual(new java.lang.String(supplied).getBytes('UTF-8'), new java.lang.String(token).getBytes('UTF-8'))) return reply({error:'unauthorized'}, 401)
    var job, owns = false
    try {
      var raw = request.files.postData
      if (!isString(raw) || raw.length > 2000000) fail('Worker request too large')
      var data = jsonParse(raw)
      if (data.action === 'health') return reply({ready:ready, protocol:1, formats:availableFormats()})
      if (data.action === 'cancel') {
        lock.lock()
        try { if (active && active.id === data.id) { active.cancelled = true; kill(active.process) } } finally { lock.unlock() }
        return reply({ok:true})
      }
      if (!ready || data.action !== 'generate' || !/^[a-f0-9-]{36}$/i.test(String(data.id))) fail('Worker unavailable or invalid operation')
      if (!isString(data.code) || data.code.length > 1000000 || !isArray(data.outputs) || data.outputs.length < 1 || data.outputs.length > 10) fail('Invalid generation request')
      var seen = {}
      data.outputs.forEach(function(name) { MiniAArtifactPolicy.name(name); if (seen[name.toLowerCase()]) fail('Duplicate output name'); seen[name.toLowerCase()] = true })
      lock.lock()
      try { if (active) fail('Worker busy'); active = { id:data.id, cancelled:false, deadline:Date.now()+120000 }; owns = true } finally { lock.unlock() }
      job = launch(scratch, data.code, false)
      if (job.exit !== 0 || active.cancelled) fail('Generation failed')
      // Parse untrusted formats only in a second, networkless sandbox. Generation
      // has exited and its PID namespace has been destroyed before this bind.
      var validationCode = validatorLibraries.map(function(p) { return 'loadLib(' + stringify(p) + ');' }).join('\n') +
        '\nloadLib("/openaf/mini-a/js/artifacts/mini-a-artifact-policy.js");\n' +
        stringify(data.outputs) + '.forEach(function(name) { MiniAArtifactPolicy.validate(name, MiniAArtifactPolicy.readRegular("/source/" + name)); });'
      var validation = launch(scratch, validationCode, false, job.output)
      try { if (validation.exit !== 0 || active.cancelled) fail('Output validation failed') }
      finally { io.rm(validation.path) }
      var total = 0, files = data.outputs.map(function(name) {
        var bytes = MiniAArtifactPolicy.readRegular(job.output + '/' + name)
        total += bytes.length
        if (total > MiniAArtifactPolicy.maxRun) fail('Run byte limit')
        return {name:name, size:bytes.length, data:String(java.util.Base64.getEncoder().encodeToString(bytes))}
      })
      return reply({files:files})
    } catch(e) { return reply({error:String(e.message || e)}, 400) }
    finally {
      if (job) io.rm(job.path)
      // Only the generating request releases ownership. Health/cancel never do.
      if (owns) {
        lock.lock(); try { active = null } finally { lock.unlock() }
      }
    }
  }
  function availableFormats() {
    var formats = ['txt','md','csv','json','png','jpg','jpeg','svg']
    if (getOPackPath('mdconvert')) formats.push('docx')
    if (getOPackPath('plugin-XLS')) formats = formats.concat(['xlsx','pptx'])
    try { if (getOPackPath('mdconvert') && typeof Packages.org.apache.pdfbox.Loader.loadPDF === 'function') formats.push('pdf') } catch(ignore) {}
    return formats
  }
  return {init:init, request:request}
})()
