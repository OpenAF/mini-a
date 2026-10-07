// Browser UUID compatibility: node tests/webUuid.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const page = fs.readFileSync('public/index.md', 'utf8');
const advanced = fs.readFileSync('public/advanced.js', 'utf8');
const generator = page.slice(page.indexOf('    function generateNewSessionUuid() {'), page.indexOf('    function copyToClipboard'));
const session = page.slice(page.indexOf('    function getOrCreateSessionUuid() {'), page.indexOf('    function destroyRenderedCharts'));
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mutate = advanced.slice(advanced.indexOf('  async function mutate(data) {'), advanced.indexOf('  function setEnabled('));
const submitMatch = advanced.match(/submit:async \(([^)]*)\)=>\{([\s\S]*?)\n  \}\};/);
assert.ok(submitMatch, 'Advanced submit adapter is present');
const submit = 'async (' + submitMatch[1] + ')=>{' + submitMatch[2] + '\n}';
async function check(crypto) {
  const requests = [];
  const context = vm.createContext({ window: {}, URLSearchParams, Uint8Array,
    history: [], historyIndex: 0, composer: {value:'2+2'}, suggestions: {hidden:false},
    busy: false, api: async data => { requests.push(data); return {accepted:true}; }, poll: async () => {},
    previousSelections:{}, activeScreen:'activity', viewParams:{}, submittedView:null,
    filter:{value:'',oninput(){}},renderScreen(){},screen:{focus(){}}
  });
  if (crypto !== undefined) context.crypto = crypto;
  vm.runInContext(generator + session, context);
  const ids = new Set(Array.from({length:100}, () => context.generateNewSessionUuid()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, validUuid);
  const id = context.getOrCreateSessionUuid();
  assert.match(id, validUuid);
  assert.equal(context.getOrCreateSessionUuid(), id, 'session identity remains stable');
  context.bridge = {newRequestId: context.generateNewSessionUuid,uuid:()=>id};
  vm.runInContext(mutate, context);
  await context.mutate({action:'settings',values:{maxsteps:5}});
  const send = vm.runInContext('(' + submit + ')', context);
  await send('2+2');
  assert.equal(requests[0].action, 'settings');
  assert.equal(requests[1].command, '2+2');
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  requests.forEach(request => assert.match(request.requestId, validUuid));
  assert.equal(context.composer.value, '');
}
(async () => {
  assert.match(page, /newRequestId: generateNewSessionUuid/);
  await check(webcrypto);
  await check({getRandomValues: webcrypto.getRandomValues.bind(webcrypto)});
  await check({});
  await check(undefined);
  await check({randomUUID() { throw Error('unavailable'); }, getRandomValues() { throw Error('unavailable'); }});
  console.log('UUID compatibility checks passed (native, random bytes, absent and throwing APIs; sessions, branches, Advanced settings and prompts).');
})().catch(error => { console.error(error); process.exitCode = 1; });
