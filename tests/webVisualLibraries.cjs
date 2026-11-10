// Exercise pinned chart loading and the math bridge without network requests.
var assert = require('node:assert/strict')
var fs = require('node:fs')
var vm = require('node:vm')
var page = fs.readFileSync('public/index.md', 'utf8')
var chartStart = page.indexOf('    (function() {')
var chartSource = page.slice(chartStart, page.indexOf('</script>', chartStart))
var chartUrl = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js'
var plugins = {
  '@sgratzl/chartjs-chart-boxplot': '4.4.5',
  'chartjs-chart-treemap': '4.2.2',
  'chartjs-chart-sankey': '0.19.1',
  'chartjs-chart-matrix': '3.1.0',
  'chartjs-chart-graph': '4.3.5',
  'chartjs-chart-geo': '4.3.6'
}

// Ready is emitted only after the pinned engine, adapter and plugin set load.
async function charts(localVersion, failSource) {
  var loaded = []
  var complete
  var finished = new Promise(resolve => { complete = resolve })
  var context = {
    window: {},
    console: { log: function() {}, warn: function() {}, error: () => complete(false) },
    CustomEvent: function(type) { this.type = type },
    document: {
      createElement: () => ({}),
      dispatchEvent: () => complete(true),
      head: {
        appendChild: function(script) {
          loaded.push(script.src)
          if (script.src === failSource || script.src === 'js/chart.js' && !localVersion) {
            script.onerror()
            return
          }
          if (script.src === 'js/chart.js' || script.src === chartUrl) {
            context.window.Chart = {
              version: script.src === chartUrl ? '4.6.1' : localVersion,
              register: function() {}
            }
          }
          script.onload()
        }
      }
    }
  }
  vm.runInNewContext(chartSource, context)
  var success = await finished
  assert.equal(success, !failSource)
  assert.equal(context.window.ChartJSLoaded, success)
  if (success) {
    assert.equal(context.window.Chart.version, '4.6.1')
    assert.equal(loaded.filter(url => url === chartUrl).length, localVersion === '4.6.1' ? 0 : 1)
    assert.ok(loaded[loaded.indexOf('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js') + 1].includes('chartjs-chart-boxplot'))
    for (var name in plugins) assert.ok(loaded.some(url => url.includes(name + '@' + plugins[name] + '/')))
    assert.equal(context.window.__chartjs_plugins_loaded, true)
  }
}

// Keep engine, CSS and official auto-render helper on the same KaTeX release.
async function math() {
  var loaded = []
  var css
  var rendered
  var version = '0.19.1'
  var context = {
    window: {},
    console,
    showdown: { Converter: function(options) { this.options = options } },
    DOMParser: function() {
      this.parseFromString = html => ({ body: { innerHTML: html } })
    },
    document: {
      getElementById: () => css,
      createElement: () => ({}),
      head: {
        appendChild: function(node) {
          if (node.rel === 'stylesheet') {
            css = node
            return
          }
          loaded.push(node.src)
          if (node.src.endsWith('/katex.min.js')) context.window.katex = { version: version }
          else context.window.renderMathInElement = function(body, options) {
            rendered = options
            body.innerHTML = 'rendered by ' + context.window.katex.version
          }
          node.onload()
        }
      }
    }
  }
  var start = page.indexOf('    let converter;')
  vm.createContext(context)
  vm.runInContext(page.slice(start, page.indexOf('    const PREVIEW_ID', start)), context)
  await context.ensureMathRenderingSupport()
  await context.ensureMathRenderingSupport()
  assert.equal(css.href, 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css')
  assert.deepEqual(loaded, [
    'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js',
    'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/contrib/auto-render.min.js'
  ])
  var extension = vm.runInContext('converter.options.extensions[0]()', context)[0]
  assert.equal(extension.filter('<p>$x$</p>'), 'rendered by 0.19.1')
  assert.equal(rendered.trust, false)
  assert.equal(rendered.throwOnError, false)
  assert.equal(rendered.delimiters.length, 2)
}

// Leaflet stays on the stable release across scripts, CSS and icon resources.
async function main() {
  for (var local of ['4.6.1', '4.5.1', '3.9.1', undefined]) await charts(local)
  await charts(undefined, chartUrl)
  await charts('4.6.1', 'https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@3.1.0/dist/chartjs-chart-matrix.min.js')
  await math()
  var leaflet = [...page.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet@([^/'"\s]+)/g)]
  assert.equal(leaflet.length, 5)
  leaflet.forEach(match => assert.equal(match[1], '1.9.4'))
  console.log('Visual libraries: pinned Chart.js 4.6.1 and plugins, local upgrades/failures, KaTeX 0.19.1 bridge and Leaflet 1.9.4 passed.')
}
main().catch(function(error) {
  console.error(error)
  process.exitCode = 1
})
