// Check local loading and the pinned CDN fallback without making network requests.
var assert = require('node:assert/strict')
var fs = require('node:fs')
var vm = require('node:vm')
var page = fs.readFileSync('public/index.md', 'utf8')
var start = page.indexOf('    // The Mermaid oPack')
var source = page.slice(start, page.indexOf('</script>', start))
  .replace('await import(', 'await importModule(')

// Exercise both the installed browser bundle and its failure path.
async function run(local) {
  var loaded = []
  var imports = []
  var configs = []
  var lib = { initialize: config => configs.push(config) }
  var context = {
    URL,
    window: {},
    document: {
      baseURI: 'http://localhost:12346/prefix/',
      body: { classList: { contains: () => true } },
      createElement: () => ({}),
      head: {
        append: function(script) {
          loaded.push(script.src)
          if (local) {
            context.window.mermaid = lib
            script.onload()
          } else {
            script.onerror()
          }
        }
      }
    },
    console: { warn: function() {} },
    importModule: async function(url) {
      imports.push(url)
      return { default: lib }
    }
  }
  await vm.runInNewContext('(async function() {' + source + '})()', context)
  assert.equal(loaded[0], 'http://localhost:12346/prefix/js/mermaid.js')
  assert.equal(context.window.mermaid, lib)
  assert.equal(configs[0].securityLevel, 'strict')
  assert.equal(configs[0].theme, 'dark')
  assert.deepEqual(imports, local ? [] : ['https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs'])
}

// Report asynchronous failures to the test runner.
async function main() {
  await run(true)
  await run(false)
  console.log('Mermaid: local classic bundle, prefixed URL, pinned 12.0.0 CDN fallback and strict rendering passed.')
}
main().catch(function(error) {
  console.error(error)
  process.exitCode = 1
})
