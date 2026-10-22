const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {el, all} = require('./webAdvancedFixture.cjs');
const source = fs.readFileSync('public/advanced.js','utf8');
const session = fs.readFileSync('mini-a-session.js','utf8');
const start = session.indexOf('  var parameterDefinitions = {');
const definitions = vm.runInNewContext(session.slice(start,session.indexOf('\n  }',start)+4)+';parameterDefinitions',{__:undefined});
const bindings = [], requests = [];
const context = vm.createContext({
  el, input:(placeholder,value='') => Object.assign(el('input'),{placeholder,value}),
  button:(text,onclick) => Object.assign(el('button',text),{onclick}),tabIcon:()=>el('svg'),
  asText:value=>typeof value === 'string' ? value : JSON.stringify(value,null,2),activityText:String,
  busy:false, storageMode:'current', activeScreen:'settings',viewParams:{},screen:el('section'),
  document:{body:el('body')}, bridge:{uuid:()=> 'first',newRequestId:()=> 'request'},poll:async()=>{},
  presetRequest:async data=>{requests.push(data);return {accepted:true};},
  window:{MiniADataEditor:{bind(field,options){bindings.push({field,...options});}}},
  snapshot:{uuid:'first',settings:Object.entries(definitions).map(([name,def])=>({...def,name,value:def.default,source:'server'})),presets:[],events:[]}
});
vm.runInContext(source.slice(source.indexOf('  const promptFields ='),source.indexOf('  let subtaskRefresh =')),context);
vm.runInContext(source.slice(source.indexOf('  function promptText('),source.indexOf('  function commandForm(')),context);
const evalIn = code=>vm.runInContext(code,context);
const named = name=>all(context.screen).find(node=>node['aria-label']===name);
const click = name=>all(context.screen).find(node=>node.tag==='button' && node.textContent===name).onclick();
const render=()=>{context.screen.replaceChildren();context.settingsWorkspace();};
(async()=>{
  render();
  for (const name of ['absorboutput','policyfile','dreamreport','wikiroot','debugfile','outfile','conversation','format','goal']) assert.ok(!bindings.some(b=>b.label===name),name+' stays plain text');
  for (const name of ['policy','model','modellc','modelval','modeldec','wikimounts','memorych','auditch','rules','subtasks']) assert.ok(bindings.some(b=>b.label===name),name+' supports structured editing');
  assert.equal(named('adaptiverouting').type,'checkbox');
  const max = named('maxsteps'); max.value='17';max.emit('input');
  const search = named('Search settings'); search.value='dream';search.oninput();search.value='maxsteps';search.oninput();
  assert.equal(named('maxsteps').value,'17','draft survives search rebuild');
  context.screen.replaceChildren();context.promptWorkspace();
  assert.ok(all(context.screen).some(n=>n.textContent==='1 pending · Settings + Prompt workspace'));
  const knowledge=named('Knowledge / context (knowledge)');knowledge.value='Shared draft';knowledge.emit('input');
  await click('Apply changes');
  assert.equal(requests.at(-1).values.maxsteps,'17');assert.equal(requests.at(-1).values.knowledge,'Shared draft');
  context.busy=false;evalIn('promptPending = null');
  const setting=context.snapshot.settings.find(s=>s.name==='maxsteps');setting.value=22;
  context.syncPromptDrafts(context.snapshot);
  assert.equal(evalIn('promptDrafts.maxsteps.value'),'17');assert.equal(evalIn('promptDrafts.maxsteps.conflict'),true);
  assert.throws(()=>context.applyDrafts(),/Review changed/);
  context.reviewDrafts();
  const dialog=evalIn('draftDialog');all(dialog).find(n=>n.textContent==='Keep my draft').onclick();
  assert.equal(evalIn('promptDrafts.maxsteps.conflict'),false);
  evalIn('draftDialog.close()');
  context.discardDrafts();render();assert.equal(named('maxsteps').value,'22');
  named('Settings category').value='Knowledge';named('Settings category').onchange();assert.ok(named('knowledge'));assert.equal(named('model'),undefined);
  named('Settings category').value='All categories';named('Settings category').onchange();
  context.snapshot.settings.find(s=>s.name==='knowledge').source='session';
  named('Settings filter').value='Overrides';named('Settings filter').onchange();assert.ok(named('knowledge'));assert.equal(named('maxsteps'),undefined);
  named('Settings filter').value='Pending changes';named('Settings filter').onchange();
  assert.equal(named('maxsteps'),undefined,'pending filter excludes clean fields');
  evalIn("draftFor(snapshot.settings.find(s=>s.name==='maxsteps')).value='31'");evalIn("settingsRefresh()");
  assert.equal(named('maxsteps').value,'31','pending filter updates when draft membership changes');
  context.discardDrafts();assert.equal(named('maxsteps'),undefined,'discard refreshes the pending filter');
  context.snapshot.settings.forEach(s=>s.readOnly=true);bindings.length=0;render();assert.equal(bindings.length,0);assert.equal(named('model').disabled,true);
  console.log('Settings: categories, filters, structured controls, shared apply, search persistence, conflicts and read-only fields passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
