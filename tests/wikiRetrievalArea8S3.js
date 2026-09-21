// Run only against a disposable S3-compatible endpoint and bucket. This is a
// live transport check, not a public-cloud IAM or durability test.
(function() {
  load("mini-a-common.js"); load("mini-a-wiki.js"); loadLib("s3.js")
  var env = java.lang.System.getenv(), endpoint = String(env.get("WIKI_AREA8_S3_URL") || "")
  var bucket = String(env.get("WIKI_AREA8_S3_BUCKET") || "")
  var access = String(env.get("WIKI_AREA8_S3_ACCESS_KEY") || "")
  var secret = String(env.get("WIKI_AREA8_S3_SECRET_KEY") || "")
  if (!endpoint || !bucket || !access || !secret) throw new Error("Area 8 S3 endpoint, bucket and credentials are required")
  var dir = java.io.File.createTempFile("wiki-area8-s3-", "").getCanonicalPath()
  io.rm(dir); io.mkdir(dir); io.mkdir(dir + "/source"); io.mkdir(dir + "/cache")
  var runPrefix = "area8/" + String(java.util.UUID.randomUUID()) + "/"
  var sourceKey = runPrefix + "wiki/answer.md", bundleKey = runPrefix + "artifacts/mini-a-wiki-index.zip"
  var bundlePath = dir + "/serving.zip", checks = [], audits = [], builder, reader
  var client = new S3(endpoint, access, secret, "us-east-1", false, false)
  var check = function(name, valid) { if (!valid) throw new Error(name); checks.push(name) }
  var upload = function(raw, path) {
    client.putObjectStream(bucket, sourceKey, af.fromString2InputStream(raw), {}, "text/markdown")
    client.putObjectStream(bucket, bundleKey, new java.io.FileInputStream(path), {}, "application/zip")
  }
  var pointer = function() { return io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json") }
  try {
    builder = new MiniAWikiManager({ backend: "fs", root: dir + "/source", access: "rw",
      wikiretrievalv2: true, wikiretrievalconfig: { passageChars: 256, bundlePath: bundlePath } }, function() {})
    builder.write("answer.md", { title: "Answer" }, "# Answer\nareaeightinitialparameter is current.")
    var result = builder.reindex()
    check("initial publication and bundle", result.ok === true && result.bundle && result.bundle.ok === true)
    upload(builder.read("answer.md").raw, bundlePath)
    reader = new MiniAWikiManager({ backend: "s3", url: endpoint, bucket: bucket, prefix: runPrefix + "wiki/",
      accessKey: access, secret: secret, region: "us-east-1", access: "ro",
      indexdir: dir + "/cache", s3artifactprefix: runPrefix + "artifacts/", s3artifactbundle: true,
      wikiretrievalv2: true }, function() {}, function(event) { audits.push(event) })
    check("live S3 hydration and citation", reader.retrieve("areaeightinitialparameter", { chunks: 1 }).evidence.length === 1)
    var initial = pointer(), initialEtag = String(client.statObject(bucket, bundleKey).etag)
    check("unchanged ETag skips refresh", reader._hydrateS3Artifacts() === false && pointer() === initial)

    var badClient = new S3(endpoint, access, "invalid-area8-secret", "us-east-1", false, false)
    reader._backend.client = badClient
    try { check("live credential denial retains pointer", reader._hydrateS3Artifacts() === false && pointer() === initial) }
    finally { reader._backend.client = client; badClient.close() }

    client.putObjectStream(bucket, bundleKey, af.fromString2InputStream("not a ZIP"), {}, "application/zip")
    check("corrupt object changes live ETag", String(client.statObject(bucket, bundleKey).etag) !== initialEtag)
    var auditCount = audits.length
    check("live corrupt replacement retains pointer", reader._hydrateS3Artifacts() === false && pointer() === initial &&
      audits.slice(auditCount).some(function(event) { return event.backend === "s3-artifact" && event.operation === "hydrate" && event.ok === false && event.bytes > 0 }))
    check("prior evidence survives failed refresh", reader.retrieve("areaeightinitialparameter", { chunks: 1 }).evidence.length === 1)

    builder.write("answer.md", { title: "Answer" }, "# Answer\nareaeightupdatedparameter is current.")
    result = builder.reindex()
    check("replacement publication and bundle", result.ok === true && result.bundle && result.bundle.ok === true)
    upload(builder.read("answer.md").raw, bundlePath)
    check("live replacement hydrates", reader._hydrateS3Artifacts() === true && pointer() !== initial)
    check("replacement evidence served", reader.retrieve("areaeightupdatedparameter", { chunks: 1 }).evidence.length === 1)
    check("retired evidence omitted", reader.retrieve("areaeightinitialparameter", { chunks: 1 }).evidence.length === 0)
    print(stringify({ ok: true, endpointKind: "S3-compatible", checks: checks }, __, ""))
  } finally {
    try { if (reader) reader.close() } catch(ignoreReaderClose) {}
    try { if (builder) builder.close() } catch(ignoreBuilderClose) {}
    try { client.removeObject(bucket, bundleKey) } catch(ignoreBundleCleanup) {}
    try { client.removeObject(bucket, sourceKey) } catch(ignoreSourceCleanup) {}
    try { client.close() } catch(ignoreClientClose) {}
    io.rm(dir)
  }
})()
