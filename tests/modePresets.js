// Run with: openaf -f tests/modePresets.js
// Exercise the production launcher resolver with OpenAF's actual merge semantics.
var source = io.readFileString("mini-a-con.js")
var start = source.indexOf("    (function(args, explicitKeys) {")
var endMarker = "    })(args, explicitCLIArgKeys)"
var end = source.indexOf(endMarker, start)
if (start < 0 || end < 0) throw "Launcher mode resolver not found"
var resolve = new Function("args", "explicitCLIArgKeys", "io", "__gHDir", "miniABasePath", "log", "logWarn",
  source.substring(start, end + endMarker.length))
var presets = {
  a: { params: { useshell: true, maxsteps: 10, mcp: "first", rules: { first: true } } },
  b: { include: "base", params: { maxsteps: 20, mcp: "second" } },
  base: { params: { useutils: true, rules: { second: true } } },
  c: { params: [{ maxsteps: 30 }, { knowledge: "last" }] },
  combined: { include: ["a", "b", "c"] },
  broken: { include: "missing" },
  cycle: { include: "cycle" },
  inline: { description: "Inline preset", maxsteps: 7 }
}
var warnings = []
var fakeIO = {
  readFileYAML: function() { return { modes: presets } },
  fileInfo: function(path) { return { canonicalPath: path } },
  fileExists: function() { return false }
}
function run(mode, overrides) {
  var args = merge({ mode: mode }, overrides || {})
  var explicit = {}
  Object.keys(args).forEach(function(key) { explicit[key.toLowerCase()] = true })
  warnings = []
  resolve(args, explicit, fakeIO, function() { return "/unused" }, "/repo", function() {}, function(msg) { warnings.push(msg) })
  return args
}
function assert(value, message) { if (!value) throw message }
function values(args) {
  var result = {}
  Object.keys(args).sort().forEach(function(key) { if (key !== "mode") result[key] = args[key] })
  return stringify(result)
}
var combined = run("combined")
var direct = run("a,b,c")
assert(values(direct) === values(combined), "List must match include inheritance, including nested values and provenance")
assert(direct.maxsteps === 30 && direct.mcp === "second" && direct.useutils === true, "Later presets must win and includes must resolve")
assert(direct.mode === "a,b,c", "Canonical list must be retained")
assert(values(run(" A, , B,c, ")) === values(combined), "Names must trim, ignore empty entries and resolve case-insensitively")
assert(run("c,b,a").maxsteps === 10, "Reversed order must change precedence")
assert(run("a,b,a").maxsteps === 10, "Repeated names must apply in order")
var explicit = run("a,b,c", { maxsteps: 99, useshell: false })
assert(explicit.maxsteps === 99 && explicit.useshell === false, "Explicit CLI values must win")
assert(!explicit.__modeargkeys.maxsteps && explicit.__modeargkeys.useutils, "Only applied values must have mode provenance")
assert(run("inline").maxsteps === 7, "Single inline presets must remain supported")
assert(run(" B ").mode === "b", "Single preset names must remain canonical")
for (var invalid of ["a,unknown", "a,broken", "a,cycle"]) {
  var failed = run(invalid)
  assert(isUnDef(failed.useshell) && isUnDef(failed.maxsteps), "Invalid list must not partially apply: " + invalid)
  assert(warnings.length === 1, "Invalid list must report a warning: " + invalid)
}
assert(warnings[0].indexOf("Circular mode include") >= 0, "Cycle diagnostic must be preserved")
assert(isUnDef(run(", ,").maxsteps), "Empty lists must not apply defaults")
resolve(direct, {}, fakeIO, function() { return "/unused" }, "/repo", function() { throw "Applied twice" }, function() {})
print("Mode preset checks passed")
