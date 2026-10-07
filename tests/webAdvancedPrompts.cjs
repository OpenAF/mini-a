// Prompt workspace behavior fixtures; no provider requests or live browser required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
function all(node) { return [node, ...node.children.flatMap(all)]; }
function el(tag, text = '', className) {
  return {tag, textContent:text, className, children:[], dataset:{}, listeners:{}, value:'', isConnected:true,
    append(...nodes) { nodes.forEach(node => { node.remove(); node.parentElement = this; this.children.push(node); }); },
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); },
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; },
    replaceChildren(...nodes) { this.children.forEach(n => n.parentElement = null); this.children = []; this.append(...nodes); },
    insertBefore(node, next) { node.remove(); node.parentElement = this; const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, node); },
    get nextSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    emit(type, event = {}) { this.listeners[type]?.forEach(listener => listener(event)); },
    querySelector(selector) { return all(this).slice(1).find(node => selector === '[data-prompt-expand]' && node.dataset.promptExpand); },
    showModal() { this.open = true; }, close() { this.open = false; this.emit('close'); }, focus() { this.focused = true; }
  };
}
const requests = [], bindings = [];
let uuid = 'first', serial = 0, reject = false, overlap = false;
const context = vm.createContext({
  el, button:(text, onclick) => Object.assign(el('button',text),{onclick}),
  presetRequest: data => context.api(data),
  tabIcon:() => el('svg'),
  input:(placeholder, value = '') => Object.assign(el('input'),{placeholder,value}),
  asText:value => typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  activityText:String,
  bridge:{uuid:() => uuid, newRequestId:() => 'prompt-' + ++serial}, busy:false,
  screen:el('section'), document:{body:el('body')}, newConversation() {}, poll:async () => {},
  window:{MiniADataEditor:{bind(field, options) { bindings.push({field,...options}); }}},
  api:async data => { requests.push(data); if (reject) throw Error('Request failed'); return overlap ? {busy:true} : {accepted:true}; }
});
vm.runInContext(source.slice(source.indexOf('  const promptFields ='), source.indexOf('  let subtaskRefresh =')),context);
vm.runInContext(source.slice(source.indexOf('  function promptText('), source.indexOf('  function commandForm(')),context);
const evaluate = code => vm.runInContext(code,context);
const names = ['youare','chatyouare','rules','knowledge','goalprefix','chatbotmode','promptprofile','systempromptbudget','noagentsmd','format'];
context.snapshot = {uuid,closed:false,events:[],presets:['Example'],settings:names.map(name => ({
  name,type:['chatbotmode','noagentsmd'].includes(name) ? 'boolean' : name === 'systempromptbudget' ? 'number' : 'string',
  value:name === 'chatbotmode' ? false : name === 'youare' ? 'Inherited role' : undefined,
  inheritedValue:name === 'youare' ? 'Inherited role' : undefined, source:'server',dataEditor:name === 'rules' ? 'array' : undefined
}))};
const setting = name => context.snapshot.settings.find(s => s.name === name);
const field = name => all(context.screen).find(n => n.id === 'advanced-prompt-' + name);
const button = text => all(context.screen).find(n => n.tag === 'button' && n.textContent === text);
const dirty = name => evaluate('promptDirty(promptDrafts[' + JSON.stringify(name) + '])');
const edit = (name, value) => { const target = field(name); target.value = value; target.emit('input'); };
function render() { context.screen.replaceChildren(); context.promptWorkspace(); }
function complete(data, failed = false) {
  const pending = evaluate('promptPending');
  Object.entries(data).forEach(([name,value]) => { setting(name).value = value; setting(name).source = 'session'; });
  context.snapshot.events = [
    ...(failed ? [{type:'error',runId:pending.requestId,value:'Validation failed'}] : []),
    {type:'complete',value:{requestId:pending.requestId}}
  ];
  context.busy = false;
  context.syncPromptDrafts(context.snapshot); evaluate('promptRefresh()');
}
(async () => {
  render();
  assert.equal(all(context.screen).filter(n => n.tag === 'textarea').length,5);
  assert.equal(bindings.length,1); assert.equal(bindings[0].label,'rules');
  assert.ok(all(context.screen).some(n => n.textContent.includes('Inactive: chatbot mode is off')));
  const literal = '  "Quoted text"\n\n  - Keep indentation\n[do not convert]\n';
  edit('knowledge',literal);
  assert.equal(button('Apply changes').disabled,false);
  context.syncPromptDrafts(context.snapshot); render();
  assert.equal(field('knowledge').value,literal,'view changes and polls retain unsent text');
  const originalField = field('knowledge'), holder = originalField.parentElement;
  const expand = holder.querySelector('[data-prompt-expand]');
  assert.ok(expand, 'expand control sits inside the text entry area');
  assert.equal(expand['aria-expanded'],'false');
  assert.match(expand.innerHTML,/M15 4h5v5M9 20H4v-5/);
  expand.onclick();
  assert.equal(evaluate('promptPopup').children.includes(holder),true);
  assert.equal(expand['aria-expanded'],'true');
  assert.match(expand.innerHTML,/M20 9h-5V4M4 15h5v5/);
  assert.equal(all(evaluate('promptPopup')).filter(n => n.tag === 'button').length,1,'the same top-right control collapses the editor');
  originalField.value = literal + 'Expanded'; originalField.emit('input');
  expand.onclick();
  assert.equal(evaluate('promptPopup'),null);
  assert.equal(expand['aria-expanded'],'false');
  assert.equal(expand.focused,true,'collapse returns focus to the original control');
  expand.onclick();
  const beforeEscape = requests.length;
  const popup = evaluate('promptPopup');
  let prevented = false, stopped = false;
  popup.emit('cancel',{preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.ok(prevented && stopped);
  assert.equal(expand['aria-expanded'],'false','Escape restores the expand icon and state');
  assert.equal(requests.length,beforeEscape,'Escape never submits Stop or a settings action');
  assert.equal(field('knowledge'),originalField,'expansion retains the same textarea');
  assert.equal(field('knowledge').value,literal + 'Expanded');
  await button('Apply changes').onclick();
  assert.equal(requests.at(-1).values.knowledge,literal + 'Expanded');
  assert.equal(dirty('knowledge'),true,'accepted receipt does not mark draft applied');
  assert.equal(button('Apply changes').disabled,true);
  edit('knowledge',literal + 'Later edit');
  complete({knowledge:literal + 'Expanded'});
  assert.equal(field('knowledge').value,literal + 'Later edit','edits made during submission survive completion');
  assert.equal(dirty('knowledge'),true);
  button('Discard edits').onclick();
  assert.equal(field('knowledge').value,literal + 'Expanded');
  edit('youare','New persona');
  await button('Apply changes').onclick(); complete({},true);
  assert.ok(all(context.screen).some(n => n.textContent.includes('Validation failed')),'worker errors stay visible in the workspace');
  assert.equal(field('youare').value,'New persona','failed validation retains draft');
  assert.equal(dirty('youare'),true);
  reject = true;
  await assert.rejects(button('Apply changes').onclick(),/Request failed/);
  assert.equal(evaluate('promptPending'),null); assert.equal(dirty('youare'),true);
  reject = false; overlap = true;
  await assert.rejects(button('Apply changes').onclick(),/busy/);
  assert.equal(evaluate('promptPending'),null); overlap = false;
  const personaRow = field('youare').parentElement.parentElement;
  const reset = all(personaRow).find(n => n.textContent === 'Reset to inherited value');
  reset.onclick();
  assert.equal(field('youare').value,'Inherited role');
  assert.equal(evaluate('promptDrafts.youare.reset'),true);
  const requestCount = requests.length;
  render(); assert.equal(requests.length,requestCount,'reset stays staged across view changes');
  await button('Apply changes').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).reset)),['youare']);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).values)),{});
  complete({youare:'Inherited role'});
  assert.equal(dirty('youare'),false); assert.equal(evaluate('promptDrafts.youare.reset'),false);
  setting('knowledge').value='External settings update'; context.syncPromptDrafts(context.snapshot); evaluate('promptRefresh()');
  assert.equal(field('knowledge').value,'External settings update','clean editors follow Settings and preset changes');
  edit('rules','[ "Keep spacing" ]');
  assert.equal(button('Save preset').disabled,true,'presets only save applied settings');
  await button('Apply changes').onclick(); complete({rules:'[ "Keep spacing" ]'});
  assert.equal(button('Save preset').disabled,false);
  await button('Apply preset').onclick(); complete({youare:'Preset role'});
  assert.equal(field('youare').value,'Preset role');
  const mode = all(context.screen).find(n => n.tag === 'input' && n['aria-label'] === 'chatbotmode');
  mode.checked = true; mode.oninput();
  await button('Apply changes').onclick(); assert.equal(requests.at(-1).values.chatbotmode,true);
  complete({chatbotmode:true});
  setting('rules').readOnly=true; render();
  assert.equal(field('rules').disabled,true);
  assert.equal(bindings.at(-1).field.disabled,false,'read-only fields receive no new structured editor');
  // Execute the actual reset hook, including collapse and draft cleanup on UUID changes.
  Object.assign(context,{dialog:el('dialog'),previousSelections:{},events:el('div'),resultGeneration:0});
  vm.runInContext(source.slice(source.indexOf('  function resetSessionView() {'),source.indexOf('  async function mutate(')),context);
  uuid='second'; context.resetSessionView();
  assert.equal(evaluate('Object.keys(promptDrafts).length'),0,'drafts cannot leak to another conversation');
  assert.equal(evaluate('promptPending'),null);
  console.log('Prompt workspace fixtures passed: drafts, expansion, literal text, apply/reset, retries, presets and session isolation.');
})().catch(error => { console.error(error); process.exitCode=1; });
