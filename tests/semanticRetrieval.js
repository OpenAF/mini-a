// Exercise cache reuse, budgets, fallbacks and branch isolation without provider traffic.
load("mini-a.js")
ow.loadAI()
loadLib(__miniAPath("js/memory/mini-a-embeddings.js"))
loadLib(__miniAPath("js/memory/mini-a-history-vm.js"))
var originalEnv = global.getEnv
var originalGpt = global.$gpt
var directory = String(io.createTempDir("mini-a-semantic-tests-"))
var calls = 0
var broken = false
var assert = function(value, message) { if (!value) throw new Error(message) }
try {
  global.getEnv = function(name) { return name === "OAF_EMBED_MODEL" ? '(type: mock, model: semantic-test)' : originalEnv(name) }
  global.$gpt = function(chat, embedding) {
    return { getEmbeddingsWithStats: function(text) {
      calls++
      if (broken) throw new Error("offline")
      return { response: text.indexOf("heap") >= 0 || text.indexOf("allocation") >= 0 ? [1, 0] : [0, 1], stats: {} }
    } }
  }
  var docs = []
  for (var i = 0; i < 12; i++) docs.push({ id: "d" + i, key: "d" + i, text: i === 0 ? "heap leak" : "certificate " + i })
  var options = { path: directory + "/vectors.db" }
  var first = MiniASemanticRetrieve("allocation", docs, [], options)
  assert(first.status.mode === "hybrid", "hybrid activation")
  assert(first.status.calls === 9 && first.status.indexed === 8, "cold budget")
  assert(first.ids[0] === "d0", "paraphrase candidate")
  var second = MiniASemanticRetrieve("allocation", docs, [], options)
  assert(second.status.indexed === 12 && second.status.calls === 4, "progressive indexing")
  assert(MiniASemanticRetrieve("allocation", docs, [], options).status.calls === 0, "persistent reuse")
  var before = calls
  assert(MiniASemanticRetrieve("", docs, ["d1"], options).ids[0] === "d1", "empty browsing")
  MiniASemanticRetrieve("allocation", docs, [], { path: options.path, mode: "off" })
  assert(calls === before, "disabled requests")
  broken = true
  for (var failure = 0; failure < 3; failure++) assert(MiniASemanticRetrieve("uncached " + failure, docs, ["d2"], options).ids[0] === "d2", "fallback")
  before = calls
  assert(MiniASemanticRetrieve("more", docs, [], options).status.reason === "provider-cooldown", "cooldown status")
  assert(calls === before, "cooldown requests")
  broken = false
  global.__miniASemanticFailures = {}
  var vm = new MiniAHistoryVM({ enabled: true, conversationPath: directory + "/conversation", branchId: "main" })
  vm.objects = [
    { id: "mine", branchId: "main", summary: "heap leak", content: "heap leak", kind: "message", type: "user" },
    { id: "other", branchId: "other", summary: "heap leak", content: "heap leak", kind: "message", type: "user" }
  ]
  assert(vm.search("allocation", 1, 0).results[0].id === "mine", "branch isolated recall")
  before = calls
  assert(vm.search("allocation", 1, 0, { mode: "exact" }).results.length === 0, "exact mode")
  assert(calls === before, "exact mode requests")
  print("Semantic retrieval tests passed")
} finally {
  global.getEnv = originalEnv
  global.$gpt = originalGpt
  global.__miniASemanticFailures = {}
  io.rm(directory)
}
