const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const openaf = process.env.OPENAF_SOURCE || '../openaf';
const context = vm.createContext({
  document: {body: {classList: {contains: () => false}}},
  el: (tag, text) => ({tag, text, children: [], append(...nodes) { this.children.push(...nodes); }})
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(openaf, 'js/openafsigil.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(openaf, 'js/njsmap.js'), 'utf8'), context);
vm.runInContext(source.slice(source.indexOf('  function activityText('), source.indexOf('  const toolbar =')), context);
vm.runInContext(source.slice(source.indexOf('  function structuredOutput('), source.indexOf('  function renderStats(')), context);
for (const payload of [
  {type:'table', value:[{name:'search', calls:3}, {name:'read', calls:2}]},
  {type:'tree', value:{enabled:true, nested:{count:4}, values:[1,2]}},
  {nested:[{value:'hello'}]},
  '[{"name":"search","calls":3}]'
]) {
  const result = context.structuredOutput(payload);
  assert.match(result.innerHTML, /njsmap_table/);
  assert.doesNotMatch(result.innerHTML, /\[object Object\]/);
}
const escaped = context.structuredOutput({'<img src=x onerror=alert(1)>': 'http://example.com/" onclick="alert(1)', value:'\x1b[32m<script>x</script>\x1b[0m', empty:null});
assert.doesNotMatch(escaped.innerHTML, /<img|<script|\x1b|href="[^"]*" onclick=/);
assert.match(escaped.innerHTML, /&lt;script&gt;/);
const longText = 'x'.repeat(16000) + '<img src=x onerror=alert(1)>';
const fullRecord = context.structuredMap({sequence: 7, timestamp: '2026-10-02T10:00:00Z', kind: 'tool_result', payload: {nested: [{text: longText}]}});
assert.match(fullRecord.innerHTML, /sequence/);
assert.match(fullRecord.innerHTML, /2026-10-02 10:00:00/);
assert.match(fullRecord.innerHTML, /tool_result/);
assert.ok(fullRecord.innerHTML.includes('x'.repeat(16000)));
assert.match(fullRecord.innerHTML, /&lt;img/);
assert.doesNotMatch(fullRecord.innerHTML, /<img/);
assert.equal(context.structuredOutput('ordinary text').tag, 'pre');
context.nJSMap = undefined;
assert.equal(context.structuredOutput({count:2}).children[0].tag, 'pre');
console.log('Advanced map rendering passed with bundled OpenAF nJSMap: tables, trees, arrays, JSON, escaping and fallback.');
