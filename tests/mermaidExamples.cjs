// Check the progressive Mermaid catalogue; optionally create a real-browser fixture.
// node tests/mermaidExamples.cjs --browser-dir /tmp/mini-a-mermaid --bundle /path/to/mermaid.min.js
var assert = require('node:assert/strict')
var fs = require('node:fs')
var path = require('node:path')
var root = path.resolve(__dirname, '..')
var directory = path.join(root, 'skills/mini-a-visual-output')
var skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')
var index = fs.readFileSync(path.join(directory, 'references/mermaid.md'), 'utf8')
var groups = ['basics', 'structure', 'planning', 'data', 'analysis', 'grammars']
var examples = []

// Each family is discoverable without injecting its examples into the initial skill.
groups.forEach(function(group) {
  var reference = 'references/mermaid-' + group + '.md'
  var content = fs.readFileSync(path.join(directory, reference), 'utf8')
  assert.ok(skill.includes('@' + reference), 'Declare the progressive reference: ' + reference)
  assert.ok(index.includes(path.basename(reference)), 'Index the selected family: ' + reference)
  assert.ok(content.length < 4000, 'Fit one default read: ' + reference)
  assert.ok(skill.length + index.length + content.length < 12000, 'Fit the selected family in the shared budget')
  for (var match of content.matchAll(/```mermaid\n([\s\S]*?)\n```/g)) {
    examples.push({ group: group, source: match[1], keyword: match[1].trim().split(/\s/)[0] })
  }
})
var expected = [
  'flowchart', 'sequenceDiagram', 'gantt', 'classDiagram', 'stateDiagram-v2',
  'erDiagram', 'requirementDiagram', 'C4Context', 'C4Container', 'usecase-beta',
  'architecture-beta', 'journey', 'mindmap', 'gitGraph', 'timeline', 'kanban',
  'pie', 'quadrantChart', 'xychart-beta', 'sankey-beta', 'radar-beta', 'treemap-beta',
  'packet', 'block-beta', 'ishikawa-beta', 'eventmodeling', 'venn-beta', 'treeView-beta',
  'wardley-beta', 'cynefin-beta', 'railroad-beta', 'railroad-ebnf-beta',
  'railroad-abnf-beta', 'railroad-peg-beta'
]
assert.deepEqual(examples.map(example => example.keyword).sort(), expected.sort())
assert.ok(index.length < 4000)
assert.ok(!index.includes('```mermaid\n'), 'The capability index does not preload examples')
assert.ok(index.includes('12.0.0') && index.includes('not an allowlist'))
var core = fs.readFileSync(path.join(root, 'js/core/mini-a.js'), 'utf8')
assert.ok(!core.includes('Only use diagram types listed above'))
assert.ok(core.includes('syntax supported by the deployed Mermaid renderer'))
assert.ok(core.includes('If the version or support is uncertain, default to flowchart or sequenceDiagram'))
console.log('Mermaid catalogue: ' + examples.length + ' examples, six on-demand files, version guidance and context budgets passed.')

// The fixture uses the actual Mini-A diagram and theme functions with an explicit local bundle.
if (process.argv.includes('--browser-dir')) {
  var output = process.argv[process.argv.indexOf('--browser-dir') + 1]
  var bundleFlag = process.argv.indexOf('--bundle')
  assert.ok(output && bundleFlag >= 0 && process.argv[bundleFlag + 1], 'Supply --browser-dir and --bundle')
  var bundle = fs.readFileSync(process.argv[bundleFlag + 1], 'utf8')
  assert.ok(/version:\s*"12\.0\.0"/.test(bundle), 'Use the documented 12.0.0 baseline bundle')
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'mermaid.js'), bundle)
  var page = fs.readFileSync(path.join(root, 'public/index.md'), 'utf8')

  // Extract named source sections so the fixture follows the shipped renderer.
  function between(start, end) {
    var from = page.indexOf(start)
    var to = page.indexOf(end, from + start.length)
    assert.ok(from >= 0 && to > from, 'Find renderer boundary: ' + start)
    return page.slice(from, to)
  }
  var theme = between('    function __refreshDarkMode() {', '</script>')
  var renderer = between('    function openMermaidFullscreen(', '    // File bytes are fetched') +
    between('    function diagramActionIcon(', '    async function exportSvgDiagram(') +
    between('    function bindDiagramMenu(', '    function renderMermaidPreview(')
  var css = page.match(/<style>([\s\S]*?)<\/style>/)[1]
  var data = JSON.stringify(examples).replace(/</g, '\\u003c')
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Mini-A Mermaid 12 catalogue</title>
<style>${css}
body { display:block; padding:24px; font:16px system-ui; }
#report { position:sticky; top:0; z-index:10; background:white; color:black; white-space:pre-wrap; padding:12px; border:2px solid green; }
.mermaid-diagram svg { max-width:100%; max-height:600px; }
</style>
<h1>Mini-A Mermaid 12 catalogue</h1><pre id="report">Running...</pre>
<button id="light">Show light</button><button id="dark">Show dark</button><main id="results"></main>
<script src="mermaid.js"></script><script>
var _isD = false
var __isDark = false
var resultsDiv = document.getElementById('results')
var examples = ${data}
var report = document.getElementById('report')
var renderCalls = 0
var render = mermaid.render.bind(mermaid)
mermaid.render = function(id, code) { renderCalls++; return render(id, code) }
${theme}
${renderer}
function check(condition, message) { if (!condition) throw new Error(message) }
function markup() {
  return examples.map(function(example) {
    return '<h2>' + example.keyword + '</h2><pre><code class="language-mermaid">' +
      example.source.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</code></pre>'
  }).join('')
}
async function show(dark) {
  __isDark = dark
  __refreshDarkMode()
  replaceResultsPreservingMermaid(markup())
  await renderMermaidDiagrams()
}
async function verify(dark) {
  resultsDiv.replaceChildren()
  report.textContent = 'Rendering ' + examples.length + ' diagrams in ' + (dark ? 'dark' : 'light') + ' mode...'
  await show(dark)
  var diagrams = Array.from(resultsDiv.querySelectorAll('.mermaid-diagram'))
  var missing = Array.from(resultsDiv.querySelectorAll('pre code')).map(function(code) { return code.textContent.trim().split(/\\s/)[0] })
  check(missing.length === 0, 'Unrendered diagrams: ' + missing.join(', '))
  check(diagrams.length === examples.length, 'Expected every diagram to render')
  diagrams.forEach(function(diagram) {
    var svg = diagram.querySelector('svg')
    check(svg && svg.getBoundingClientRect().height > 0, 'Visible SVG required')
  })
  var calls = renderCalls
  for (var i = 0; i < 5; i++) {
    replaceResultsPreservingMermaid(markup() + '<p>Answer update ' + i + '</p>')
    await renderMermaidDiagrams()
    __refreshDarkMode()
    var current = resultsDiv.querySelectorAll('.mermaid-diagram')
    diagrams.forEach(function(diagram, n) { check(diagram === current[n], 'Preserve diagram nodes') })
    await new Promise(requestAnimationFrame)
  }
  check(renderCalls === calls, 'No extra Mermaid renders during answer updates')
  return (dark ? 'Dark' : 'Light') + ': ' + diagrams.length + ' rendered; five updates, zero extra renders'
}
document.getElementById('light').onclick = function() { show(false) }
document.getElementById('dark').onclick = function() { show(true) }
;(async function() {
  try {
    var results = [await verify(false), await verify(true)]
    report.textContent = 'PASS\\n' + results.join('\\n')
    document.body.dataset.testResult = 'passed'
  } catch (error) {
    report.textContent = 'FAIL: ' + error.message
    document.body.dataset.testResult = 'failed'
    throw error
  }
})()
</script>`)
  console.log('Browser fixture: ' + path.join(output, 'index.html'))
}
