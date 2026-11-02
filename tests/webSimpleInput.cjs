// Exercise the real polling and authorization dialog while Advanced stays unopened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {el:base, all} = require('./webAdvancedFixture.cjs');
const source = fs.readFileSync('public/advanced.js', 'utf8');
function el(tag, text, cls) {
  const node = base(tag, text, cls);
  node.querySelector = selector => all(node).slice(1).find(child =>
    selector.startsWith('.') ? child.className === selector.slice(1) : selector.split(',').includes(child.tag));
  return node;
}
const requests = [];
let session = 'simple-a', fail = false;
let data = {uuid:session, busy:true, kind:'prompt', events:[], pending:null};
const context = vm.createContext({
  enabled:false, snapshot:null, polling:false, after:0, busy:false, dialogId:null,
  el, button:(text, onclick) => Object.assign(el('button', text), {onclick}), asText:String,
  bridge:{uuid:()=>session, trackRun(){}, refresh(){}},
  api:async request => {
    requests.push(request);
    if (request.action === 'snapshot') return data;
    if (fail) throw Error('Reply failed');
    return {};
  },
  dialog:el('dialog'), paneStatus:el('span'), status:el('span'), activeScreen:'activity',
  screen:el('div'), promptRefresh:null, settingsRefresh:null, resultRefresh:null,
  usePresetLibrary(){}, syncPromptDrafts(){}, appendEvent(){}, followActivity(){}, renderScreen(){},
  resetSessionView(){ context.snapshot = null; context.dialogId = null; context.dialog.close(); },
  showError(error){ throw error; }
});
vm.runInContext(source.slice(source.indexOf('  async function poll('), source.indexOf('  function promptText(')), context);
const choice = id => ({id, type:'choice', label:'Authorize shell command: touch output.txt?', choices:['Deny','Allow once']});
(async () => {
  data.pending = choice('deny');
  await context.poll();
  assert.equal(context.enabled, false, 'Advanced remains unopened');
  assert.equal(context.dialog.open, true, 'First Simple poll displays authorization');
  assert.match(context.dialog.children[0].textContent, /touch output.txt/);
  await context.dialog.children.find(n => n.textContent === 'Deny').onclick();
  assert.equal(requests.at(-1).answer, 0);
  assert.equal(context.dialog.open, false);

  data.pending = choice('allow');
  await context.poll();
  const allow = context.dialog.children.find(n => n.textContent === 'Allow once');
  fail = true; await allow.onclick();
  assert.equal(context.dialog.open, true, 'Failed reply stays open for retry');
  assert.equal(context.dialog.querySelector('.advanced-input-error').textContent, 'Reply failed');
  fail = false; await allow.onclick();
  assert.equal(requests.at(-1).answer, 1);
  assert.equal(context.dialog.open, false);

  data.pending = choice('cancel'); await context.poll();
  await context.dialog.children.find(n => n.textContent === 'Cancel operation').onclick();
  assert.equal(requests.at(-1).action, 'stop');
  assert.equal(context.dialog.open, false);

  data.pending = choice('stale'); await context.poll();
  const stale = context.dialog.children.find(n => n.textContent === 'Allow once');
  session = 'simple-b';
  const count = requests.length; await stale.onclick();
  assert.equal(requests.length, count, 'Old authorization cannot reply in a new conversation');
  data = {...data, uuid:session, pending:choice('new-session')}; await context.poll();
  assert.equal(context.dialog.open, true, 'Simple polls input in the next conversation');
  data.pending = null; await context.poll();
  assert.equal(context.dialog.open, false, 'Resolved authorization closes');
  console.log('Simple input: first poll, deny, allow once, retry, cancel and session isolation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
