const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {el:base,all} = require('./webAdvancedFixture.cjs');
const source = fs.readFileSync('public/advanced.js','utf8');
function el(tag,text='',cls) {
  const node=base(tag,text,cls); let own=text;
  Object.defineProperty(node,'textContent',{get(){return own+this.children.map(n=>n.textContent).join('');},set(value){own=value;this.children=[];}});
  Object.defineProperty(node,'firstChild',{get(){return this.children[0];}});
  return node;
}
const context=vm.createContext({el,button:(text,onclick)=>Object.assign(el('button',text),{onclick}),
  input:text=>Object.assign(el('input'),{placeholder:text}),applySplit(){},requestAnimationFrame:fn=>fn(),
  document:{createTextNode:text=>el('text',text)},activityText:String,structuredOutput:value=>el('pre',value),
  activityEventEmojis:{},liveFloor:0,liveClearRun:null,
});
vm.runInContext(source.slice(source.indexOf("  const activity = el("),source.indexOf('  shell.append(paneHeader')),context);
vm.runInContext(source.slice(source.indexOf('  function appendEvent('),source.indexOf('  async function poll(')),context);
const get=code=>vm.runInContext(code,context);
const follow=get('follow'),events=get('events'),filter=get('filter'),type=get('eventTypeFilter'),badge=get('newEvents');
function append(sequence,type,value,navigate=true) {context.appendEvent({sequence,type,value,timestamp:'2026-10-21T10:00:00'},navigate);}
append(1,'info','Ready');append(2,'error','Failed');
assert.equal(type.children.length,3);
type.value='error';type.onchange();assert.equal(events.children[0].hidden,true);assert.equal(events.children[1].hidden,false);
filter.value='ready';filter.oninput();assert.ok(events.children.every(n=>n.hidden),'type and text filters combine');
filter.value='';filter.oninput();follow.checked=false;follow.onchange();events.scrollTop=12;
append(3,'error','More');append(4,'info','Other');context.followActivity();
assert.equal(events.scrollTop,12,'paused activity retains scroll position');assert.equal(badge.hidden,false);assert.match(badge.textContent,/2 new events/);
assert.equal(events.children[3].hidden,true,'arriving records honor filters');assert.equal(type.children.length,3,'types do not duplicate');
append(5,'info','Replay',false);assert.match(badge.textContent,/2 new events/,'initial replay does not count as new');
events.scrollHeight=400;badge.onclick();assert.equal(follow.checked,true);assert.equal(events.scrollTop,400);assert.equal(badge.hidden,true);
follow.checked=false;append(6,'warn','New type');assert.equal(type.children.length,4);
context.appendEvent({type:'view',value:'clear',sequence:7,runId:'clear'});
assert.equal(events.children.length,0);assert.equal(badge.hidden,true);assert.equal(type.value,'');assert.equal(type.children.length,1);
append(8,'info','Next');context.resetActivity();assert.equal(events.children.length,0);assert.equal(badge.hidden,true);
console.log('Activity: combined filters, paused arrival count, resume, replay and reset passed.');
