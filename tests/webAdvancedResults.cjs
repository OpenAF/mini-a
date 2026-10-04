// UI behavior fixtures; no live browser or model required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js','utf8');
function node(tag, text = '', cls) {
  return {tag, textContent:text, className:cls, children:[], attributes:{}, dataset:{},
    append(...nodes){this.children.push(...nodes)}, replaceChildren(...nodes){this.children=nodes},
    setAttribute(k,v){this.attributes[k]=v}, addEventListener(){},
    get childElementCount(){return this.children.length},
    get value(){return this._value ?? (this.tag==='select'?this.children[0]?.value || '':'')},set value(v){this._value=v},
    get firstChild(){return this.children[0]},
  };
}
const commands=[], inserted=[], reads=[], downloads=[];
const context=vm.createContext({
  el:node, button:(text,onclick)=>Object.assign(node('button',text),{onclick}),
  input:(label,value='')=>Object.assign(node('input'),{value,placeholder:label}), quote:JSON.stringify,
  asText:JSON.stringify, structuredOutput:value=>node('pre',JSON.stringify(value)), structuredMap:value=>node('pre',JSON.stringify(value)),
  command:async value=>commands.push(value), screen:node('section'), viewParams:{}, snapshot:{commandMetadata:[]},
  bridge:{openComposer:value=>{context.editedGoal=value},uuid:()=>context.uuid,newRequestId:()=>String(Math.random())}, uuid:'first',
  navigator:{clipboard:{writeText:text=>inserted.push(text)}},
  window:{}, document:{querySelector:()=>context.composer,body:{classList:{contains:()=>false}}},
  Event:class {}, URL:{createObjectURL:()=>'',revokeObjectURL(){}}, Blob:class {}, setTimeout(){},
  activeScreen:'wiki', resultGeneration:1, previousSelections:{}, events:node('div'), submittedView:null,
  api:async data=>{reads.push(data);if(data.action==='results')return {results:[],before:1,hasMore:false};return {}},
  showError:assert.fail, renderScreen(){context.renders=(context.renders||0)+1},
});
vm.runInContext(source.slice(source.indexOf('  function insertCommand('),source.indexOf('  function renderStats(')),context);
context.markdown=text=>node('markdown',text);
context.download=(text,name)=>downloads.push({text,name});
context.composer={value:'',focus(){this.focused=true},dispatchEvent(){}};
function all(n){return [n,...n.children.flatMap(all)]}
function find(n,text){return all(n).find(x=>x.tag==='button'&&x.textContent===text)}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  context.snapshot.commandMetadata=[{command:'/custom',syntax:'/custom [args]',description:'Custom fixture',source:'/commands/custom.md',examples:['/custom test'],aliases:[],destination:'activity'}];
  context.helpScreen(); const help=context.screen;
  find(help,'Insert command').onclick();assert.equal(context.composer.value,'/custom ');assert.equal(commands.length,0,'insertion never executes');
  const answer=context.renderBlock({type:'answer',value:{goal:'Goal',answer:'# Answer\n\n  raw  \n'},meta:{raw:true}});
  find(answer,'Copy').onclick();find(answer,'Download').onclick();assert.equal(inserted[0],'# Answer\n\n  raw  \n');assert.equal(downloads[0].text,inserted[0]);
  assert.ok(all(answer).some(n=>n.tag==='pre'&&n.textContent===inserted[0]),'raw reader');
  find(answer,'Rendered / Raw').onclick();assert.ok(all(answer).some(n=>n.tag==='markdown'),'rendered reader');
  const history=context.renderBlock({type:'history',value:{goals:['multi\nline']}});
  find(history,'Insert').onclick();assert.equal(context.composer.value,'multi\nline');
  find(history,'Edit').onclick();assert.equal(context.editedGoal,'multi\nline');assert.equal(context.activeScreen,'wiki');assert.equal(commands.length,0);
  const pages=context.renderBlock({type:'wiki-search',value:{partial:true,hits:[{path:'@team/a file.md',snippet:'Match'}],sources:[{id:'team'}]}});
  assert.ok(all(pages).some(n=>n.textContent.includes('Partial search coverage')));
  await find(pages,'@team/a file.md').onclick();assert.equal(commands.pop(),'/wiki read "@team/a file.md"');
  const lint=context.renderBlock({type:'lint',value:{summary:{errors:1,warnings:1},issues:[{page:'a.md',severity:'error',type:'broken'},{page:'b.md',severity:'warning',type:'orphan'}]}});
  const severity=all(lint).find(n=>n.tag==='select');severity.value='error';severity.onchange();assert.ok(find(lint,'a.md'));assert.ok(!find(lint,'b.md'));
  const recovery=context.renderBlock({type:'recoveries',value:{recoveries:[{id:'saved-id'}]}});
  await find(recovery,'Discard').onclick();assert.equal(commands.pop(),'/ingest recovery discard "saved-id"','discard stays in shared confirmation handler');
  const plans=context.renderBlock({type:'absorb',value:{plans:['plan-id']}});await find(plans,'show').onclick();assert.equal(commands.pop(),'/absorb show "plan-id"');
  const task=context.renderBlock({type:'subtask',value:{id:'child',answer:'# Child answer'}});await find(task,'Result').onclick();assert.equal(commands.pop(),'/subtask result child');
  assert.ok(all(task).some(n=>n.tag==='markdown'),'child answer reader');
  context.activeScreen='wiki';context.screen=node('section');context.resultPanel();await flush();
  assert.equal(reads[0].action,'results');assert.equal(reads[0].view,'wiki');assert.equal(context.activeScreen,'wiki');
  // Result pagination keeps selection, fetches full data on demand and ignores stale requests.
  let pending=[];context.api=data=>new Promise(resolve=>pending.push({data,resolve}));context.resultGeneration++;context.screen=node('section');context.resultPanel();
  const panel=context.screen.children[0];pending.shift().resolve({results:[{sequence:12,command:'/wiki read a.md',status:'completed',timestamp:'now'}],before:12,hasMore:true});await flush();
  assert.equal(pending[0].data.action,'result');pending.shift().resolve({timestamp:'now',value:{command:'/wiki read a.md',status:'completed',blocks:[{type:'markdown',value:'# Page'}],messages:[]}});await flush();
  assert.ok(all(panel).some(n=>n.tag==='markdown'));
  find(panel,'Older results').onclick();assert.equal(pending[0].data.before,12);pending.shift().resolve({results:[{sequence:6,command:'/wiki list',status:'completed',timestamp:'before'}],before:6,hasMore:false});await flush();
  const selector=all(panel).find(n=>n.attributes['aria-label']==='Previous results');selector.value='6';selector.onchange();assert.equal(context.previousSelections.wiki,6);
  context.uuid='other';pending.shift().resolve({timestamp:'old',value:{blocks:[{type:'markdown',value:'STALE'}]}});await flush();assert.ok(!all(panel).some(n=>n.textContent==='STALE'));
  // Live inspection does not submit commands and updates stable cards even with focus inside.
  context.activeScreen='subtasks';context.screen=node('section');context.snapshot={busy:true};
  let tasks=[{id:'child',goal:'Research',status:'running',startedAt:Date.now()-2000,attempt:1}];
  context.api=async data=>{assert.equal(data.action,'subtasks');return {tasks}};
  context.subtaskScreen();await flush();
  const liveCard=all(context.screen).find(n=>n.className==='advanced-subtask-card');
  const sections=liveCard.children.filter(n=>n.tag==='details');sections.forEach(n=>n.open=true);
  const cancel=find(liveCard,'Cancel task');assert.equal(cancel.disabled,true);
  assert.ok(all(liveCard).some(n=>n.textContent==='Result will appear here when the task finishes.'));
  const commandCount=commands.length;
  context.document.activeElement=cancel;
  tasks=[{...tasks[0],status:'completed',result:{answer:'# Finished'}}];
  await context.subtaskRefresh();
  assert.equal(all(context.screen).find(n=>n.className==='advanced-subtask-card'),liveCard);
  assert.ok(sections.every(n=>n.open),'open details survive polling');
  assert.equal(cancel.hidden,true,'terminal tasks cannot be cancelled');
  assert.ok(all(liveCard).some(n=>n.tag==='markdown'&&n.textContent==='# Finished'));
  assert.equal(commands.length,commandCount,'inspection bypasses busy command route');
  const taskFilter=all(context.screen).find(n=>n.attributes['aria-label']==='Filter subtasks');
  taskFilter.value='active';taskFilter.onchange();assert.equal(liveCard.hidden,true);
  taskFilter.value='all';taskFilter.onchange();assert.equal(liveCard.hidden,false);
  context.api=async()=>{throw new Error('offline')};await context.subtaskRefresh();
  assert.ok(all(context.screen).includes(liveCard),'refresh failure preserves the last snapshot');
  assert.ok(all(context.screen).some(n=>n.textContent.includes('Showing the last received state.')));
  let resolveTasks;context.api=()=>new Promise(resolve=>resolveTasks=resolve);
  const stale=context.subtaskRefresh();context.uuid='new-session';
  resolveTasks({tasks:[{id:'stale',status:'running',goal:'STALE TASK'}]});await stale;
  assert.ok(!all(context.screen).some(n=>n.textContent==='STALE TASK'));
  // String and structured view events are retained-compatible, never replay navigation.
  context.events=node('div');context.activeScreen='wiki';context.liveFloor=0;context.liveClearRun=null;
  vm.runInContext(source.slice(source.indexOf('  function appendEvent('),source.indexOf('  async function poll(')),context);
  context.appendEvent({type:'view',value:'models',sequence:4},true);assert.equal(context.activeScreen,'wiki');
  context.appendEvent({type:'view',value:{name:'settings'},sequence:5},true);assert.equal(context.activeScreen,'wiki');
  context.events.append(node('details'));context.appendEvent({type:'view',value:'clear',sequence:8,runId:'cls-request'});assert.equal(context.events.children.length,0);assert.equal(context.liveFloor,8);
  context.appendEvent({type:'output',value:'old',sequence:7});assert.equal(context.events.children.length,0,'cleared output stays cleared');
  context.appendEvent({type:'complete',value:{},sequence:9,runId:'cls-request'});assert.equal(context.events.children.length,0,'cls completion does not repopulate activity');
  console.log('Advanced result UI fixtures passed: help, readers, actions, pagination, replay, clearing and session isolation.');
})().catch(error=>{console.error(error);process.exitCode=1});
