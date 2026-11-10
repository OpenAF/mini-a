// Exercise live-chart controls, export, modal lifecycle and streaming identity.
var assert = require('node:assert/strict')
var fs = require('node:fs')
var vm = require('node:vm')
var page = fs.readFileSync('public/index.md', 'utf8')

// Model the DOM operations used by chart controls and visual-node preservation.
class Element {
  constructor(tag) {
    this.tagName = tag
    this.childNodes = []
    this.style = {}
    this.attrs = {}
    this.listeners = {}
    this.className = ''
    this.dataset = {}
    this.scrollLeft = 0
    this.scrollTop = 0
    this.clientWidth = 800
    this.clientHeight = 400
    this.classList = { contains: name => this.className.split(' ').includes(name) }
  }
  get isConnected() {
    return this.tagName === 'body' || Boolean(this.parentElement && this.parentElement.isConnected)
  }
  setAttribute(key, value) { this.attrs[key] = value }
  getAttribute(key) { return this.attrs[key] }
  appendChild(node) {
    node.remove()
    this.childNodes.push(node)
    node.parentElement = this
    return node
  }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  remove() {
    if (!this.parentElement) return
    var siblings = this.parentElement.childNodes
    siblings.splice(siblings.indexOf(this), 1)
    this.parentElement = null
  }
  replaceWith(node) {
    var parent = this.parentElement
    var index = parent.childNodes.indexOf(this)
    node.remove()
    parent.childNodes[index] = node
    node.parentElement = parent
    this.parentElement = null
  }
  replaceChildren(...nodes) {
    this.childNodes.slice().forEach(node => node.remove())
    this.append(...nodes)
  }
  set innerHTML(html) {
    this.replaceChildren()
    for (var match of html.matchAll(/<pre><code class="([^"]+)">([\s\S]*?)<\/code><\/pre>/g)) {
      var pre = new Element('pre')
      var code = new Element('code')
      code.className = match[1]
      code.textContent = match[2]
      pre.appendChild(code)
      this.appendChild(pre)
    }
  }
  matches(selector) {
    if (selector === 'summary') return this.tagName === 'summary'
    if (selector.startsWith('button') || selector.startsWith('[data-action')) {
      var action = selector.match(/data-action="([^"]+)"/)
      return this.tagName === 'button' && (!action || this.getAttribute('data-action') === action[1])
    }
    if (selector.startsWith('.chartjs-chart')) return this.className === 'chartjs-chart'
    if (selector.startsWith('.mermaid-diagram')) return false
    return selector.includes('pre code') && this.tagName === 'code' && this.parentElement.tagName === 'pre' &&
      (!selector.includes('mermaid') || this.className.includes('mermaid'))
  }
  querySelectorAll(selector) {
    var result = []
    this.childNodes.forEach(function(node) {
      if (node.matches(selector)) result.push(node)
      result.push(...node.querySelectorAll(selector))
    })
    return result
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] }
  closest(selector) { return this.matches(selector) ? this : this.parentElement && this.parentElement.closest(selector) }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler) }
  emit(type, event) { (this.listeners[type] || []).forEach(handler => handler(event)) }
  focus() { document.activeElement = this }
  showModal() { this.open = true }
  close() {
    this.open = false
    this.emit('close', {})
  }
}
var document = { body: new Element('body'), createElement: tag => new Element(tag) }
var resultsDiv = new Element('div')
document.body.appendChild(resultsDiv)
var downloads = []
var context = vm.createContext({
  document, resultsDiv, Map, Math, console, window: { devicePixelRatio: 2 },
  diagramActionIcon: () => '', bindDiagramMenu: () => {},
  downloadDiagramBlob: (blob, name) => downloads.push({ blob, name })
})
var start = page.indexOf('    function destroyChartContainer(')
vm.runInContext(page.slice(start, page.indexOf('    function layoutChartContainer(', start)), context)
start = page.indexOf('    function replaceResultsPreservingMermaid(')
vm.runInContext(page.slice(start, page.indexOf('    // Render new diagrams', start)), context)

// Track the same canvas and options across zoom, full-screen movement and reset.
function makeChart(source) {
  var container = new Element('div')
  container.className = 'chartjs-chart'
  container.setAttribute('data-chart-source', source)
  var canvas = new Element('canvas')
  canvas.toBlob = callback => callback({ png: true })
  var chart = { canvas, currentDevicePixelRatio: 2, options: { scales: { x: { min: 2, max: 8 } } }, sizes: [], destroyed: 0,
    resize: function(width, height) { this.sizes.push([width, height]) },
    destroy: function() { this.destroyed++ }
  }
  container.appendChild(canvas)
  container.__chartInstance = chart
  resultsDiv.appendChild(container)
  context.addChartControls(container, chart)
  return { container, canvas, chart }
}

// Dispatch only toolbar clicks; the canvas has no interception overlay or handlers.
function action(item, name, fullscreen) {
  var menu = fullscreen ? item.container.__chartFullscreenMenu : item.container.__chartMenu
  menu.emit('click', { target: menu.querySelector('[data-action="' + name + '"]') })
}
var first = makeChart('{"type":"bar"}')
var originalOptions = JSON.stringify(first.chart.options)
action(first, 'zoom-in')
assert.equal(first.container.__chartZoom, 1.25)
assert.equal(first.container.__chartInstance, first.chart)
assert.equal(first.container.__chartStage.childNodes[0], first.canvas)
assert.deepEqual(first.canvas.listeners, {})
assert.equal(JSON.stringify(first.chart.options), originalOptions)
context.resizeChartView(first.container, 100)
var size = first.chart.sizes.at(-1)
assert.ok(size[0] * 2 <= 8192 && size[1] * 2 <= 8192 && size[0] * size[1] * 4 <= 16777216)
action(first, 'reset')
assert.equal(first.container.__chartZoom, 1)
assert.equal(first.container.__chartViewport.scrollLeft, 0)
action(first, 'download-png')
assert.equal(downloads[0].name, 'chart.png')
first.canvas.toBlob = callback => callback(null)
action(first, 'download-png')
assert.match(first.container.__chartStatus.textContent, /failed/)
first.canvas.toBlob = () => { throw Error('tainted canvas') }
action(first, 'download-png')
assert.match(first.container.__chartStatus.textContent, /failed/)

// Full-screen mode moves the original canvas and closes cleanly on removal.
action(first, 'fullscreen')
var dialog = first.container.__chartDialog
assert.equal(dialog.open, true)
assert.equal(first.container.__chartViewport.parentElement, dialog)
action(first, 'zoom-in', true)
action(first, 'close', true)
assert.equal(first.container.__chartDialog, undefined)
assert.equal(first.container.__chartViewport.parentElement, first.container)
assert.equal(first.container.__chartInstance, first.chart)
assert.equal(document.body.style.overflow, undefined)

// Repeated identical sources retain separate live instances and their state.
var duplicate = makeChart('{"type":"bar"}')
var source = '<pre><code class="language-chart">{"type":"bar"}</code></pre>'
action(first, 'fullscreen')
var activeDialog = first.container.__chartDialog
context.replaceResultsPreservingMermaid(source + source)
assert.equal(resultsDiv.childNodes[0], first.container)
assert.equal(resultsDiv.childNodes[1], duplicate.container)
assert.equal(first.chart.destroyed, 0)
assert.equal(first.container.__chartDialog.open, true)
context.replaceResultsPreservingMermaid(source)
assert.equal(duplicate.chart.destroyed, 1)
context.replaceResultsPreservingMermaid('<pre><code class="language-chart">{"type":"line"}</code></pre>')
assert.equal(first.chart.destroyed, 1)
assert.equal(first.container.__chartDialog, undefined)
assert.equal(activeDialog.parentElement, null)
console.log('Chart controls: live canvas/options, bounded zoom, reset, PNG success/failure, modal restoration and streaming cleanup passed.')
