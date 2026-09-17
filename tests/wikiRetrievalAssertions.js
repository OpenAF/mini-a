ow.loadTest()
var count = 0, original = ow.test.assert, failures = [], passed = 0
ow.test.assert = function() { count++; return original.apply(ow.test, arguments) }
var suite = String(getEnv("WIKI_COUNT_SUITE") || "wiki")
var jobs = {}, todo = [], visited = {}, funcs = [], seen = {}
function collectSuite(path) {
  if (visited[path]) return
  visited[path] = true
  var config = io.readFileYAML(path)
  ;(config.include || []).forEach(function(child) {
    if (isString(child) && child.indexOf("tests/") === 0) collectSuite(child)
  })
  ;(config.jobs || []).forEach(function(job) { jobs[job.name] = job })
  ;(config.todo || []).forEach(function(job) { todo.push(isString(job) ? job : job.name) })
}
try {
  collectSuite("tests/" + suite + ".yaml")
  todo.forEach(function(name) {
    var job = jobs[name], exec = job && job.exec || ""
    var match = /args\.func\s*=\s*require\("([^"]+)"\)\.([A-Za-z0-9_]+)/.exec(exec)
    if (!match && suite === "graph") {
      var graph = /args\.func\s*=\s*args\.tests\.([A-Za-z0-9_]+)/.exec(exec)
      if (graph) match = [graph[0], "tests/graph.js", graph[1]]
    }
    if (match && !seen[match[1] + ":" + match[2]]) {
      seen[match[1] + ":" + match[2]] = true
      funcs.push({ file: match[1], name: match[2] })
    }
  })
  if (funcs.length === 0) throw new Error("No registered test functions for suite " + suite)
  funcs.forEach(function(f) {
    try { require(f.file)[f.name](); passed++ }
    catch(e) { failures.push({ name: f.name, error: String(e) }) }
  })
} catch(e) {
  failures.push({ name: suite, error: String(e) })
} finally {
  ow.test.assert = original
}
print("ASSERTION_REPORT=" + stringify({suite:suite,assertions:count,passedFunctions:passed,failures:failures},__,""))
exit(failures.length > 0 ? 1 : 0)
