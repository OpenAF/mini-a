// Verify answer refreshes do not redraw diagrams, while theme changes still do.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const page = fs.readFileSync('public/index.md', 'utf8')
const classes = new Set()
let redraws = 0

// Model renderer-owned labels with transparent, edge-label and custom backgrounds.
function makeDiv(inSvg, style) {
  return {
    id: '',
    style: { ...style },
    classList: { contains: () => false },
    closest: selector => inSvg && selector === 'svg' ? {} : null
  }
}
const labelStyles = [
  { color: '#123456', backgroundColor: 'transparent' },
  { color: '#654321', backgroundColor: '#eeeeee' },
  { color: '#abcdef', backgroundColor: '#663399', borderColor: '#ff0000' }
]
const labels = labelStyles.map(style => makeDiv(true, style))
const ordinary = makeDiv(false, {})
const context = vm.createContext({
  document: {
    body: { classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name))
    } },
    querySelectorAll: selector => selector === 'div' ? [...labels, ordinary] : [],
    getElementById: () => null
  },
  getComputedStyle: () => ({ borderColor: '#cccccc' }),
  __isDark: false,
  reRenderMermaidDiagrams: async () => { redraws++ }
})
const start = page.indexOf('    function __refreshDarkMode() {')
vm.runInContext(page.slice(start, page.indexOf('</script>', start)), context)

// Repeated answer updates retain label styling and never trigger a diagram redraw.
function refreshAndCheck() {
  context.__refreshDarkMode()
  labels.forEach((label, index) => {
    assert.deepEqual(label.style, labelStyles[index], 'SVG labels retain their own colors and backgrounds')
  })
  assert.equal(ordinary.style.backgroundColor, context.__isDark ? '#0f1115' : '#f8f9fa')
  assert.equal(ordinary.style.color, context.__isDark ? '#e6e6e6' : '#000000')
}
for (let i = 0; i < 10; i++) refreshAndCheck()
assert.equal(redraws, 0)
context.__isDark = true
refreshAndCheck()
assert.equal(redraws, 1)
for (let i = 0; i < 10; i++) refreshAndCheck()
assert.equal(redraws, 1)
context.__isDark = false
refreshAndCheck()
assert.equal(redraws, 2)
console.log('Mermaid theme: SVG label colors preserved; repeated answer refreshes retain diagrams; theme changes redraw once.')
