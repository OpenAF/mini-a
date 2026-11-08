// Verify answer refreshes do not redraw diagrams, while theme changes still do.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const page = fs.readFileSync('public/index.md', 'utf8')
const classes = new Set()
let redraws = 0
const context = vm.createContext({
  document: {
    body: { classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name))
    } },
    querySelectorAll: () => [],
    getElementById: () => null
  },
  __isDark: false,
  reRenderMermaidDiagrams: async () => { redraws++ }
})
const start = page.indexOf('    function __refreshDarkMode() {')
vm.runInContext(page.slice(start, page.indexOf('</script>', start)), context)
for (let i = 0; i < 10; i++) context.__refreshDarkMode()
assert.equal(redraws, 0)
context.__isDark = true
context.__refreshDarkMode()
assert.equal(redraws, 1)
for (let i = 0; i < 10; i++) context.__refreshDarkMode()
assert.equal(redraws, 1)
context.__isDark = false
context.__refreshDarkMode()
assert.equal(redraws, 2)
console.log('Mermaid theme: repeated answer refreshes retain diagrams; theme changes redraw once.')
