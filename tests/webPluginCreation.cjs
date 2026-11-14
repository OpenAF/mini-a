const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// Exercise the guided form's actual request construction without a browser dependency.
const elements = []
function element(tag, text) {
  const value = { tag, textContent: text || '', value: '', children: [], files: [], checked: false,
    append(...children) { this.children.push(...children) },
    prepend(child) { this.children.unshift(child) },
    replaceChildren(...children) { this.children = children },
    setAttribute(key, value) { this[key] = value }
  }
  elements.push(value)
  return value
}
const requests = []
const context = vm.createContext({
  el: element,
  input(label) { const value = element('input'); value.label = label; return value },
  button(label, callback) { const value = element('button', label); value.callback = callback; return value },
  structuredMap(value) { const view = element('div'); view.payload = value; return view },
  screen: element('main'), bridge: { url: name => '/' + name },
  fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { json: async () => ({ ok: true }) } },
  console
})
const source = fs.readFileSync('public/advanced.js', 'utf8')
const start = source.indexOf('  function pluginScreen()')
const end = source.indexOf('  function renderScreen', start)
vm.runInContext(source.slice(start, end) + '\npluginScreen()', context)
const field = label => elements.find(value => value.label === label || value['aria-label'] === label)
const click = label => elements.find(value => value.tag === 'button' && value.textContent === label).callback()
;(async () => {
  field('Plugin name').value = 'guided-fixture'
  field('Component kind').value = 'skills'
  field('Component server path').value = '/tmp/example-skill'
  field('Packaged component name').value = 'example'
  click('Add component')
  field('MCP server name (optional)').value = 'docs'
  field('Remote MCP URL').value = 'https://example.com/mcp'
  field('Hook event').value = 'PreToolUse'
  field('Hook command').value = 'python3 guard.py'
  field('Plugin destination').value = 'minia'
  await click('create')
  const request = requests.at(-1)
  assert.ok(elements.some(value => value.payload?.ok === true), 'results use structured map rendering')
  assert.equal(request.spec.metadata.name, 'guided-fixture')
  assert.equal(request.spec.components[0].source, '/tmp/example-skill')
  assert.equal(request.spec.mcp.docs.type, 'streamable-http')
  assert.equal(request.spec.hooks.PreToolUse[0].hooks[0].command, 'python3 guard.py')
  const advanced = elements.find(value => value.tag === 'details')
  assert.equal(advanced.open, undefined, 'advanced is collapsed by default')
  field('Use JSON specification instead of guided fields').checked = true
  field('Creation specification JSON').value = '{invalid'
  await click('create')
  assert.equal(requests.length, 1, 'invalid advanced JSON must not submit')
  console.log('Guided plugin creation tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
