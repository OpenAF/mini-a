ow.loadTest()
var count = 0, original = ow.test.assert, failures = [], passed = 0
ow.test.assert = function() { count++; return original.apply(ow.test, arguments) }
var suite = String(getEnv("WIKI_COUNT_SUITE") || "wiki")
var yaml = io.readFileString("tests/" + suite + ".yaml")
var funcs = [], re = /args\.func\s*=\s*require\("([^"]+)"\)\.([A-Za-z0-9_]+)/g, m
while ((m = re.exec(yaml)) !== null) funcs.push({ file: m[1], name: m[2] })
if (suite === "graph") { var gr = /args\.func\s*=\s*args\.tests\.([A-Za-z0-9_]+)/g; while ((m = gr.exec(yaml)) !== null) funcs.push({file:"tests/graph.js",name:m[1]}) }
funcs.forEach(function(f) { try { require(f.file)[f.name](); passed++ } catch(e) { failures.push({name:f.name,error:String(e)}) } })
print("ASSERTION_REPORT=" + stringify({suite:suite,assertions:count,passedFunctions:passed,failures:failures},__,""))
