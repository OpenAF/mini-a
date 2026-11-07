// node tests/visualOutputExamples.cjs [--browser-dir /tmp/mini-a-visual-examples]
// The optional fixture uses the shipped web renderer functions and CDN loaders.
// Serve that directory over localhost and open index.html to check both themes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const skill = path.join(root, 'skills/mini-a-visual-output');
const names = ['chartjs', 'mermaid', 'latex-math', 'leaflet'];
const references = names.map(name => fs.readFileSync(path.join(skill, 'references', name + '.md'), 'utf8'));
const blocks = references.flatMap(text => [...text.matchAll(/```(chart|mermaid|leaflet)\n([\s\S]*?)\n```/g)]
  .map(match => ({ language: match[1], source: match[2] })));
const charts = blocks.filter(block => block.language === 'chart').map(block => JSON.parse(block.source));
const maps = blocks.filter(block => block.language === 'leaflet').map(block => JSON.parse(block.source));
assert.deepEqual(charts.map(config => config.type), ['bar', 'line', 'scatter', 'bar']);
assert.equal(blocks.filter(block => block.language === 'mermaid').length, 3);
assert.equal(maps.length, 1);
const page = fs.readFileSync(path.join(root, 'public/index.md'), 'utf8');
function between(start, end) {
  const from = page.indexOf(start), to = page.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Web renderer boundary missing: ${start}`);
  return page.slice(from, to);
}
const parser = {};
vm.createContext(parser);
vm.runInContext(between('    function tryParseChartConfig(', '    function layoutChartContainer('), parser);
charts.forEach(config => {
  assert.equal(JSON.stringify(parser.tryParseChartConfig(JSON.stringify(config))), JSON.stringify(config));
  assert.ok(config.data.datasets.length);
  config.data.datasets.forEach(dataset => {
    if (config.data.labels) assert.equal(dataset.data.length, config.data.labels.length);
    dataset.data.forEach(value => {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
      else {
        assert.ok(Number.isFinite(value.y));
        assert.ok(typeof value.x === 'number' ? Number.isFinite(value.x) : Number.isFinite(Date.parse(value.x)));
      }
    });
  });
});
function coordinates(point) {
  assert.equal(point.length, 2);
  assert.ok(Number.isFinite(point[0]) && Math.abs(point[0]) <= 90);
  assert.ok(Number.isFinite(point[1]) && Math.abs(point[1]) <= 180);
}
maps.forEach(config => {
  coordinates(config.center);
  config.markers.forEach(marker => coordinates([marker.lat, marker.lon]));
  config.layers.forEach(layer => {
    if (layer.type === 'circle') { coordinates(layer.center); assert.ok(layer.radius > 0); }
    else { assert.equal(layer.type, 'polyline'); layer.points.forEach(coordinates); }
  });
  assert.ok(Object.keys(config.options).every(key => ['scrollWheelZoom', 'dragging'].includes(key)));
});
const math = references[2].split('## Inline formula\n')[1].split('## Checks and fallback')[0];
assert.equal((math.match(/^\$\$[^\n]+\$\$$/gm) || []).length, 3);
const expressions = [...math.matchAll(/\$\$([^$]+)\$\$|\$([^$]+)\$/g)].map(match => (match[1] || match[2]).trim());
assert.equal(expressions.length, 5);
references.forEach(text => assert.ok(text.length < 4000, 'Reference fits one default read'));
const body = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
assert.ok(body.length + references.reduce((sum, text) => sum + text.length, 0) < 12000);
console.log('Visual references: four chart configs, three diagrams, math examples, map coordinates, and content budgets checked.');

if (process.argv[2] === '--browser-dir') {
  assert.ok(process.argv[3], '--browser-dir requires a destination');
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(root, 'public/showdown.min.js'), path.join(output, 'showdown.min.js'));
  const markdown = blocks.map((block, i) => `## Example ${i + 1}: ${block.language}\n\n\`\`\`${block.language}\n${block.source}\n\`\`\``).join('\n\n') + '\n\n## Math examples\n\n' + math;
  const loaders = between('<script src="showdown.min.js?raw=true">', '<script>\n    document.title');
  const css = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const renderer = [
    between('    let converter;', '    const PREVIEW_ID'),
    between('    function openMermaidFullscreen(', '    // File bytes are fetched'),
    between('    function addLeafletMarkers(', '    /**\n     * Attempts to force')
  ].join('\n');
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Visual skill examples</title>
<style>${css}\nbody {display:block; padding:24px; font:16px system-ui;} #examples {max-width:960px; margin:auto;} #report {white-space:pre-wrap;} .markdown-body-dark {background:#0f1115;color:#e6e6e6;} .leaflet-map {height:400px;}</style>
</head><body><h1>Visual skill examples</h1><p>Actual reference examples and Mini-A web renderers. CDN access is required.</p>
<pre id="report">Running browser checks…</pre><button id="light">Show light theme</button> <button id="dark">Show dark theme</button><main id="examples"></main>
${loaders}<script>
var _isD = false, chartResizeTimer = null, chartResizeHandlerBound = false;
const resultsDiv = document.getElementById('examples');
const markdown = ${JSON.stringify(markdown).replace(/</g, '\\u003c')};
const expectedExpressions = ${JSON.stringify(expressions).replace(/</g, '\\u003c')};
${renderer}
const report = document.getElementById('report');
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function waitFor(predicate, message, timeout = 45000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function showTheme(dark) {
  resultsDiv.querySelectorAll('.chartjs-chart').forEach(el => el.__chartInstance?.destroy());
  resultsDiv.querySelectorAll('.leaflet-map').forEach(el => el.__leafletInstance?.remove());
  _isD = dark;
  document.body.classList.toggle('markdown-body-dark', dark);
  resultsDiv.innerHTML = converter.makeHtml(markdown);
  renderChartBlocks();
  await renderMermaidDiagrams();
  renderLeafletMaps();
  await waitFor(() => resultsDiv.querySelector('.leaflet-map')?.__leafletInstance, 'Map initialization failed');
  check(resultsDiv.querySelectorAll('.chartjs-chart canvas').length === 4, 'Expected four rendered charts');
  check(resultsDiv.querySelectorAll('.mermaid-diagram svg').length === 3, 'Expected three rendered diagrams');
  check(resultsDiv.querySelectorAll('.leaflet-map').length === 1, 'Expected one rendered map');
  check(resultsDiv.querySelectorAll('.katex').length === 5, 'Expected five rendered math expressions');
  const renderedExpressions = [...resultsDiv.querySelectorAll('.katex annotation')].map(el => el.textContent.trim());
  check(JSON.stringify(renderedExpressions) === JSON.stringify(expectedExpressions), 'Math source changed during Markdown rendering: ' + JSON.stringify(renderedExpressions));
  check(!resultsDiv.querySelector('.katex-error'), 'Math rendering error');
  check(!resultsDiv.querySelector('pre code'), 'An example was left as unrendered source');
  await waitFor(() => resultsDiv.querySelectorAll('.leaflet-tile-loaded').length > 0, 'No visible map tiles loaded');
  return (dark ? 'Dark' : 'Light') + ': 4 charts, 3 diagrams, 5 math expressions, 1 map and loaded tiles.';
}
document.getElementById('light').onclick = () => showTheme(false).catch(error => { report.textContent = error.stack; });
document.getElementById('dark').onclick = () => showTheme(true).catch(error => { report.textContent = error.stack; });
(async () => {
  await waitFor(() => window.ChartJSLoaded && window.mermaid && window.L, 'Browser libraries unavailable');
  await ensureMathRenderingSupport();
  const results = [await showTheme(false), await showTheme(true)];
  report.textContent = 'PASS\\n' + results.join('\\n');
  document.body.dataset.testResult = 'passed';
})().catch(error => { report.textContent = 'FAIL: ' + error.stack; document.body.dataset.testResult = 'failed'; });
</script></body></html>`);
  console.log('Browser fixture:', path.join(output, 'index.html'));
}
