// Unlinked page mentions, edit-stable grounded edges, reconciliation backfill and auto-reconcile.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-wiki.js")
load("js/wiki/mini-a-graph.js")
var checks = 0
var root = String(new java.io.File(String(io.createTempDir("graph-implicit-"))).getCanonicalPath())
var managers = []

// Count assertions so a prematurely terminated harness is visible.
function assert(value, message) {
  if (!value) throw new Error(message)
  checks++
}

// Create a filesystem wiki with the given {path: [title, body]} pages and an open manager.
function wikiWith(name, pages, extra) {
  var dir = root + "/" + name
  io.mkdir(dir)
  Object.keys(pages).forEach(function(path) {
    io.mkdir(String(new java.io.File(dir + "/" + path).getParent()))
    io.writeFileString(dir + "/" + path, "---\ntitle: " + pages[path][0] + "\n---\n" + pages[path][1])
  })
  var manager = new MiniAWikiManager(merge({ backend: "fs", root: dir, access: "rw", usegraph: true, skipBootstrap: true }, extra || {}), function() {})
  managers.push(manager)
  return manager
}

// Live edges of a type touching a document.
function edgesOf(manager, path, type) {
  return (manager._graph._adj["doc:" + path] || []).filter(function(e) { return e._deleted !== true && e.type === type })
}

// Live edges a page owns, by type.
function owned(manager, path, type) {
  return (manager._graph._edgesByOwner[path] || []).filter(function(e) { return e._deleted !== true && e.type === type })
}

try {
  // Unlinked title mentions become grounded page edges; explicit links and self-mentions do not.
  var m = wikiWith("implicit", {
    "rag.md": ["Retrieval Augmented Generation", "RAG pipelines query stores."],
    "notes.md": ["Notes", "Our Retrieval Augmented Generation setup links to [Kafka](kafka.md) and Kafka."],
    "kafka.md": ["Kafka", "Kafka streams. Retrieval Augmented Generation is unrelated."],
    "self.md": ["Self Reference Page", "This Self Reference Page names itself."]
  })
  var built = m.graph("build", {})
  assert(built.reconciliation.complete === true, "lexical reconciliation completes")
  var notesOut = owned(m, "notes.md", "MENTIONS_PAGE")
  assert(notesOut.length === 1 && notesOut[0].to === "doc:rag.md", "unlinked title mention connects notes to rag, linked kafka is skipped")
  var edge = notesOut[0]
  assert(edge.props.method === "reconcile-implicit" && edge.props.evidenceLayer === "grounded" && edge.props.evidence.quote === "Retrieval Augmented Generation", "implicit link carries grounded literal evidence")
  assert(m._graph._implicitCurrent(edge), "implicit link is current")
  assert(owned(m, "self.md", "MENTIONS_PAGE").length === 0, "a page never mentions itself")
  var related = m._graph.relatedFor(["notes.md"], { cap: 5 })
  var rag = related.filter(function(r) { return r.path === "rag.md" })[0]
  var kafka = related.filter(function(r) { return r.path === "kafka.md" })[0]
  assert(rag && rag.connection.indexOf("MENTIONS_PAGE") >= 0, "related pages include the mentioned page")
  assert(kafka && kafka.score > rag.score, "an explicit link outranks an unlinked mention")
  var stats = m.graph("stats", { detailed: true })
  assert(stats.implicitLinks === 2 && stats.connectivity.implicitDocumentEdges === 2, "stats report implicit links separately")
  var candidates = m._graph.expansionCandidates("rag.md", {})
  assert(candidates.some(function(c) { return c.path === "notes.md" && c.relation === "mentions_page" && c.evidenceLayer === "grounded" }), "expansion follows incoming unlinked mentions")
  assert(isDef(m._graph.proximity(["notes.md"], {})["rag.md"]), "proximity traverses unlinked mentions")

  // An edit keeps grounded edges whose quote survives, with rebased evidence; others are dropped.
  m._lastAutoReconcileAt = now()
  m.write("notes.md", { title: "Notes" }, "Prefix added. Our Retrieval Augmented Generation setup links to [Kafka](kafka.md).")
  var rebased = owned(m, "notes.md", "MENTIONS_PAGE")
  assert(rebased.length === 1 && m._graph._implicitCurrent(rebased[0]), "edit keeps the current implicit link without reconciliation")
  var body = m.read("notes.md").body
  assert(body.substring(rebased[0].props.evidence.start, rebased[0].props.evidence.end) === "Retrieval Augmented Generation", "rebased evidence offsets point at the quote")
  var kafkaMention = (m._graph._semanticByPage["kafka.md"] || []).filter(function(e) { return e.props.method === "reconcile-deterministic" && m._graph._currentEvidence(e) })
  assert(kafkaMention.length > 0, "fixture has a reconciled concept mention")
  m.write("kafka.md", { title: "Kafka" }, "Edited, still about Kafka streams.")
  assert((m._graph._semanticByPage["kafka.md"] || []).some(function(e) { return e.props.method === "reconcile-deterministic" && m._graph._currentEvidence(e) }), "edit keeps reconciled concept mentions whose term remains")
  m.write("notes.md", { title: "Notes" }, "Nothing about that topic now.")
  assert(owned(m, "notes.md", "MENTIONS_PAGE").length === 0, "edit drops an implicit link whose quote is gone")

  // Retitling or deleting the target drops incoming mentions immediately.
  m._lastAutoReconcileAt = 0
  m.write("notes.md", { title: "Notes" }, "Back to Retrieval Augmented Generation.")
  assert(owned(m, "notes.md", "MENTIONS_PAGE").length === 1, "auto-reconciliation after a write adds the new implicit link")
  m._lastAutoReconcileAt = now()
  m.write("rag.md", { title: "RAG Pipelines" }, "RAG pipelines query stores.")
  assert(edgesOf(m, "rag.md", "MENTIONS_PAGE").length === 0, "retitled target drops mentions of its old title")
  m._lastAutoReconcileAt = 0
  m.write("rag.md", { title: "Retrieval Augmented Generation" }, "RAG pipelines query stores.")
  assert(edgesOf(m, "rag.md", "MENTIONS_PAGE").length > 0, "restored title is mentioned again after reconciliation")
  m._lastAutoReconcileAt = now()
  m.delete("rag.md")
  assert(edgesOf(m, "rag.md", "MENTIONS_PAGE").length === 0, "deleted target drops incoming mentions")
  assert(m._graph._state.reconciliation.dirtyCount > 0, "mention owners are queued for reconciliation")

  // Opting out removes existing implicit links on the next reconciliation and adds none.
  var off = wikiWith("optout", {
    "a.md": ["Alpha Service Guide", "Alpha."],
    "b.md": ["Beta", "Read the Alpha Service Guide first."]
  })
  off.graph("build", {})
  assert(owned(off, "b.md", "MENTIONS_PAGE").length === 1, "default enables implicit links")
  off._graph._cfg.implicitLinks = false
  off.graph("build", {})
  assert(owned(off, "b.md", "MENTIONS_PAGE").length === 0, "wikigraphimplicitlinks=false removes implicit links")
  var offManager = wikiWith("optout-arg", { "a.md": ["Alpha Service Guide", "Alpha."], "b.md": ["Beta", "Read the Alpha Service Guide first."] }, { wikigraphimplicitlinks: false })
  var previewOff = offManager.graph("build", { preview: true, reconcileMaxPages: 1 })
  var builtOff = offManager.graph("build", { reconcileMaxPages: 1 })
  assert(owned(offManager, "b.md", "MENTIONS_PAGE").length === 0, "the manager option disables implicit links")
  var previewOn = wikiWith("preview-on", { "a.md": ["Alpha Service Guide", "Alpha."], "b.md": ["Beta", "Read the Alpha Service Guide first."] })
  var preview = previewOn.graph("build", { preview: true, reconcileMaxPages: 1 })
  assert(preview.reconciliation.complete && preview.reconciliation.runs > 1 && preview.reconciliation.implicitAdded === 1, "preview settles bounded lexical batches")
  assert(previewOff.reconciliation.complete && !previewOff.reconciliation.implicitAdded && !builtOff.reconciliation.implicitAdded, "preview respects the implicit-link opt-out")
  assert(preview.previewChanges.relationshipsToAdd === previewOff.previewChanges.relationshipsToAdd + 1, "preview reports the implicit relationship only when enabled")
  assert(owned(previewOn, "b.md", "MENTIONS_PAGE").length === 0, "preview leaves the live graph untouched")

  // A single plain word naming a page only links while few pages use it.
  var common = { "notes.md": ["Notes", "Index of notes."] }
  for (var i = 0; i < 30; i++) common["p" + i + ".md"] = ["Page " + i, "Some Notes about item " + i + "."]
  var df = wikiWith("df", common)
  df.graph("build", {})
  var noteLinks = edgesOf(df, "notes.md", "MENTIONS_PAGE").length
  assert(noteLinks === 0, "a widely used single-word title does not link every page (" + noteLinks + ")")

  // Frequency changes invalidate unchanged source pages and keep independent aliases eligible.
  var falconPages = { "target.md": ["Falcon", "Migration checklist."], "sixth.md": ["Extra", "Unrelated."], "alias.md": ["Alias Example", "Falcon and Harbor are mentioned here."] }
  for (var f = 0; f < 4; f++) falconPages["falcon" + f + ".md"] = ["Observer " + f, "Falcon appeared."]
  var falcon = wikiWith("frequency", falconPages, { wikigraphautoreconcile: false })
  falcon.write("target.md", { title: "Falcon", aliases: ["Harbor"] }, "Migration checklist.")
  falcon.graph("build", {})
  assert(edgesOf(falcon, "target.md", "MENTIONS_PAGE").length === 5, "five sources qualify at the frequency cap")
  falcon.write("sixth.md", { title: "Extra" }, "Falcon appeared.")
  falcon.graph("build", {})
  var aliasEdges = edgesOf(falcon, "target.md", "MENTIONS_PAGE")
  assert(aliasEdges.length === 1 && aliasEdges[0].props.evidence.quote === "Harbor", "crossing the cap drops title links and switches to independently eligible alias evidence")
  falcon.write("sixth.md", { title: "Extra" }, "Unrelated again.")
  falcon.graph("build", {})
  assert(edgesOf(falcon, "target.md", "MENTIONS_PAGE").length === 5, "falling below the cap restores links on unchanged pages")

  // A delimiter inside a nested path must not redirect a mention to a flat page.
  var nested = wikiWith("nested", { "t.md": ["Flat Page", "Flat."], "t.md:archive/more.md": ["Quiet Harbor", "Nested."], "source.md": ["Source Page", "See Quiet Harbor."] })
  nested.graph("build", {})
  var nestedEdges = owned(nested, "source.md", "MENTIONS_PAGE")
  assert(nestedEdges.length === 1 && nestedEdges[0].to === "doc:t.md:archive/more.md", "implicit evidence points to the exact nested target")

  // One build backfills reconciliation beyond reconcileMaxPages instead of stopping at one run.
  var many = {}
  // Distinct leading words: the mention scanner bounds candidate names per first token.
  for (var j = 0; j < 260; j++) many["n" + j + ".md"] = ["N" + j + " Runbook", j === 0 ? "Start." : "Continues from N" + (j - 1) + " Runbook with `sharedToken`."]
  var large = wikiWith("backfill", many)
  var backfill = large.graph("build", {})
  assert(backfill.reconciliation.complete === true && backfill.reconciliation.runs > 1, "build loops reconciliation runs until complete (" + backfill.reconciliation.runs + " runs)")
  assert(owned(large, "n200.md", "MENTIONS_PAGE").length === 1, "pages beyond the first run's cap are linked")

  // Auto-reconciliation can be disabled, leaving edited pages queued for the next build.
  var manual = wikiWith("manual", { "a.md": ["Gamma Runbook", "Gamma."], "b.md": ["Delta", "Plain."] }, { wikigraphautoreconcile: false })
  manual.graph("build", {})
  manual.write("b.md", { title: "Delta" }, "See the Gamma Runbook.")
  assert(owned(manual, "b.md", "MENTIONS_PAGE").length === 0 && manual._graph._state.reconciliation.dirtyCount > 0, "wikigraphautoreconcile=false defers to the next build")
  manual.graph("build", {})
  assert(owned(manual, "b.md", "MENTIONS_PAGE").length === 1, "the next build reconciles queued pages")
  manual.write("b.md", { title: "Delta" }, "See the [Gamma Runbook](a.md).")
  assert(edgesOf(manual, "b.md", "LINKS_TO").some(function(edge) { return edge.to === "doc:a.md" }) &&
    owned(manual, "b.md", "MENTIONS_PAGE").length === 0, "an explicit link replaces the carried implicit edge immediately")

  // The first eligible edit initializes automatic reconciliation.
  var fresh = wikiWith("fresh", { "a.md": ["Gamma Runbook", "Gamma."] })
  assert(!fresh._graph._state.reconciliation, "fresh graph has no reconciliation state")
  fresh.write("b.md", { title: "Delta" }, "See the Gamma Runbook.")
  assert(owned(fresh, "b.md", "MENTIONS_PAGE").length === 1, "the first edit reconciles before any manual build")

  // Invalid graph settings cannot make a committed write look like a failure.
  var broken = wikiWith("broken-settings", { "a.md": ["Gamma Runbook", "Gamma."] })
  broken.graph("build", {})
  broken.graphBuildSettings({}, true)
  io.writeFileJSON(broken._getIndexRoot() + "/.mini-a-wiki-state/config.json", { graphBuild: { reconcile: "invalid" } })
  var written = broken.write("b.md", { title: "Delta" }, "Committed content.")
  assert(written.ok === true && broken.read("b.md").body.indexOf("Committed content.") >= 0, "write reports success even when saved graph settings are invalid")
  print("PASS graph implicit links: " + checks + " assertions")
} finally {
  managers.forEach(function(manager) { try { manager.close() } catch(ignoreClose) {} })
  io.rm(root)
}
