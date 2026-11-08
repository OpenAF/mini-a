// Exercise streaming DOM replacement with delayed Mermaid renders.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const page = fs.readFileSync('public/index.md', 'utf8')

// Minimal DOM supporting node movement, identity and source-block parsing.
class Element {
  constructor(tag) {
    this.tag = tag
    this.childNodes = []
    this.style = {}
    this.dataset = {}
    this.attrs = {}
    this.className = ''
    this.classList = { contains: value => this.className.split(' ').includes(value) }
  }
  setAttribute(key, value) { this.attrs[key] = value }
  getAttribute(key) { return this.attrs[key] }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.childNodes
      siblings.splice(siblings.indexOf(this), 1)
      this.parentElement = null
    }
  }
  append(node) {
    node.remove()
    node.parentElement = this
    this.childNodes.push(node)
  }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) child.remove()
    for (const node of nodes) this.append(node)
  }
  replaceWith(node) {
    const parent = this.parentElement
    const index = parent.childNodes.indexOf(this)
    node.remove()
    parent.childNodes[index] = node
    node.parentElement = parent
    this.parentElement = null
  }
  contains(node) {
    return node === this || this.childNodes.some(child => child.contains(node))
  }
  set innerHTML(html) {
    this.replaceChildren()
    for (const match of html.matchAll(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g)) {
      const pre = new Element('pre')
      const code = new Element('code')
      code.className = 'language-mermaid'
      code.textContent = match[1]
      pre.append(code)
      this.append(pre)
    }
  }
  querySelectorAll(selector) {
    const found = []
    for (const child of this.childNodes) {
      if ((selector.includes('.mermaid-diagram[') && child.className === 'mermaid-diagram') ||
          (selector.includes('pre code') && child.tag === 'code' && child.parentElement.tag === 'pre')) found.push(child)
      found.push(...child.querySelectorAll(selector))
    }
    return found
  }
}
const resultsDiv = new Element('div')
const calls = []
let release
const context = vm.createContext({
  resultsDiv, Map, Date, _isD: false,
  console: { warn() {}, error() {} },
  document: { createElement: tag => new Element(tag), body: new Element('body') },
  addMermaidPanZoomLayer: node => { node.controls = { zoom: 1, open: false } },
  destroyChartContainer: () => {},
  window: { mermaid: {
    initialize() {},
    parse: async source => source !== 'invalid',
    render: async (id, source) => {
      calls.push(source)
      if (source === 'slow') await new Promise(resolve => { release = resolve })
      if (source === 'error') throw new Error('render failed')
      return { svg: '<svg/>' }
    }
  } }
})
vm.runInContext(page.slice(page.indexOf('    function replaceResultsPreservingMermaid('),
  page.indexOf('    async function reRenderMermaidDiagrams(')), context)
const html = (...sources) => sources.map(source => `<pre><code class="language-mermaid">${source}</code></pre>`).join('')
const replace = (...sources) => context.replaceResultsPreservingMermaid(html(...sources))
const render = () => context.renderMermaidDiagrams()

// Bound the deferred-render wait so regressions fail instead of hanging the suite.
async function waitForRender() {
  for (var i = 0; i < 100; i++) {
    if (release) return
    await Promise.resolve()
  }
  assert.fail('Expected a pending Mermaid render')
}

async function run() {
  replace('A', 'A', 'B')
  assert.ok(resultsDiv.childNodes.every(pre => pre.style.visibility === 'hidden'))
  await render()
  const original = [...resultsDiv.childNodes]
  original[0].controls = { zoom: 2, open: true }
  replace('A', 'A', 'B', 'C')
  assert.deepEqual(resultsDiv.childNodes.slice(0, 3), original, 'Reuse each duplicate independently')
  await render()
  assert.deepEqual(calls, ['A', 'A', 'B', 'C'])
  assert.equal(original[0].controls.zoom, 2)
  assert.equal(original[0].controls.open, true)

  replace('slow')
  const pending = render()
  await waitForRender()
  const pendingPre = resultsDiv.childNodes[0]
  replace('slow', 'D')
  assert.equal(resultsDiv.childNodes[0], pendingPre)
  await render()
  assert.equal(calls.filter(source => source === 'slow').length, 1, 'Overlapping updates share pending work')
  release()
  await pending
  assert.equal(resultsDiv.childNodes[0].className, 'mermaid-diagram')

  release = null
  replace('discard previous diagram')
  replace('slow')
  const stale = render()
  await waitForRender()
  replace('new source')
  release()
  await stale
  await render()
  assert.equal(resultsDiv.childNodes[0].getAttribute('data-mermaid-source'), 'new source', 'Stale work cannot replace changed content')

  replace('invalid', 'error')
  await render()
  assert.ok(resultsDiv.childNodes.every(pre => pre.style.visibility === ''), 'Failures retain readable source')
  const failedCalls = calls.length
  replace('invalid', 'error')
  await render()
  assert.equal(calls.length, failedCalls, 'Unchanged failures do not retry on every update')

  context.window.mermaid.initialize = () => { throw new Error('initialization failed') }
  replace('initialization error')
  await render()
  assert.equal(resultsDiv.childNodes[0].style.visibility, '', 'Initialization errors retain readable source')

  context.window.mermaid = undefined
  replace('no library')
  assert.notEqual(resultsDiv.childNodes[0].style.visibility, 'hidden')
  console.log('Mermaid streaming: node reuse, duplicate sources, pending/stale renders and failure fallbacks passed.')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
