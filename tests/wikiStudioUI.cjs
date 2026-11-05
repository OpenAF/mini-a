const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Small DOM fixture: test user flows without adding a production dependency.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.hidden = false; this._text = ''; this.className = ''; this.classList = {add: (...names) => this.className += ' ' + names.join(' '), contains: n => this.className.split(' ').includes(n), toggle: (n,on) => { this.className = this.className.split(' ').filter(x => x !== n).concat(on ? [n] : []).join(' '); }}; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get isConnected() { return this.tagName === 'BODY' || !!this.parentElement?.isConnected; }
  append(...nodes) { for (const n of nodes) { n.remove(); n.parentElement = this; this.children.push(n); if (this.tagName === 'SELECT' && this.children.length === 1) this.value = n.value || n.textContent; } }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.remove(); n.parentElement = this; this.children.unshift(n); } }
  replaceChildren(...nodes) { this.children.forEach(n => n.parentElement = null); this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
  insertBefore(n,before) { n.remove(); n.parentElement = this; this.children.splice(this.children.indexOf(before),0,n); }
  setAttribute(k,v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,fn) { (this.listeners[k] ||= []).push(fn); }
  async fire(k,event={}) { event.target ||= this; event.preventDefault ||= ()=>{}; event.stopPropagation ||= ()=>{}; await this['on'+k]?.(event); for (const fn of this.listeners[k] || []) await fn(event); }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
  select() {}
  showModal() { this.open = true; }
  close(value) { this.returnValue = value; this.open = false; this.fire('close'); }
  closest(selector) { let n=this; while(n){if(matches(n,selector))return n;n=n.parentElement;} return null; }
  querySelectorAll(selector) { const parts=selector.split(' ');return descendants(this).filter(n=>matches(n,parts.at(-1))&&(parts.length===1||n.parentElement?.closest(parts[0]))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function descendants(node) { return node.children.flatMap(n => [n,...descendants(n)]); }
function matches(n,s) {
  if(s.startsWith('#')) return n.id===s.slice(1);
  if(s.startsWith('.')) return n.classList.contains(s.slice(1));
  if(s==='[hidden]')return n.hidden;
  const attr=s.match(/^\[([^=]+)="([^"]+)"\]$/);if(attr)return n.attributes[attr[1]]===attr[2];
  return n.tagName===s.toUpperCase();
}
const document={body:new Element('body'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),createTextNode:text=>Object.assign(new Element('text'),{textContent:text}),getElementById:id=>descendants(document.body).find(n=>n.id===id),querySelector:s=>document.body.querySelector(s),querySelectorAll:s=>document.body.querySelectorAll(s)};
for(const id of ['login','workspace','message','background-jobs','studio-activity','studio-activity-text','token']){const n=new Element(id==='login'?'form':'div');n.id=id;document.body.append(n);if(id==='login')n.append(new Element('button'));}
const history={entries:[],pushState(state){this.entries.push(state);this.state=state;},replaceState(){}};
const context=vm.createContext({document,history,location:{hash:'',pathname:'/'},window:{addEventListener(){},Chart:undefined},URL:{revokeObjectURL(){}},URLSearchParams,Intl,Date,Map,Set,Promise,crypto:{randomUUID:()=> 'test-request'},matchMedia:()=>({matches:false}),setTimeout,console});
vm.runInContext(fs.readFileSync('public/studio/studio.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
const find=(root,tag,text)=>descendants(root).find(n=>n.tagName===tag.toUpperCase()&&n.textContent===text);
const field=(root,name)=>descendants(root).find(n=>n.tagName==='LABEL'&&n._text===name)?.children.find(n=>['INPUT','SELECT'].includes(n.tagName));
const click=async(root,title)=>{const b=find(root,'button',title);assert(b,'Missing button: '+title);assert(!b.disabled,'Disabled button: '+title);await b.fire('click');};
const calls=[];
context.api=async(path,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='session')return {canTestWiki:false,adapters:{directory:[]}};
  if(path.includes('/children')) {const q=new URLSearchParams(path.split('?')[1]);return q.get('path')==='Guides'?{items:[{name:'intro.md',path:'Guides/intro.md',kind:'page'}]}:{items:[{name:'Guides',path:'Guides',kind:'folder'},{name:'index.md',path:'index.md',kind:'page'}]};}
  if(path.includes('/page?'))return {path:'Guides/intro.md',content:'# Introduction\nSafe text',revision:'revision-1'};
  if(path.includes('/backlinks'))return {links:[]};
  if(path.includes('/overview'))return {studio:{pageCount:2,pendingRecovery:[]}};
  if(path.includes('/sources')&&method==='POST')return {id:body.id,name:body.name,revision:'revision-2'};
  if(path.includes('/sources'))return {items:[],truncated:false};
  if(path.includes('/lint'))return {issues:[],total_issues:0};
  if(path.includes('/graph/stats'))return {freshness:'Markdown links'};
  if(path.startsWith('jobs'))return {items:[],truncated:false};
  throw Error('Unexpected API call: '+path);
};
run('StudioApi.request=api;studioSession={canTestWiki:false,adapters:{directory:[]}};');
(async()=>{
  await run('openWiki({id:"a",name:"Alpha",access:"rw"})');
  assert.equal(history.state.view,'Pages','Wiki starts in Pages');
  const view=document.getElementById('view');
  assert.equal(view.querySelector('[role="tree"]').getAttribute('aria-label'),'Folders and pages');
  const folder=view.querySelector('[role="treeitem"]');await folder.fire('keydown',{key:'ArrowRight'});
  assert.equal(folder.getAttribute('aria-expanded'),'true','Right arrow expands a folder');
  const page=descendants(view).find(n=>n.dataset.path==='Guides/intro.md');await page.fire('keydown',{key:'Enter'});
  assert(find(view,'button','Edit'),'Opening a file offers Edit');assert(!descendants(view).some(n=>n.tagName==='TEXTAREA'),'Reading view has no editor');
  await click(view,'Edit');assert(descendants(view).some(n=>n.tagName==='TEXTAREA'),'Explicit editing works');await click(view,'Cancel editing');
  await run('navigate("Import")');await click(view,'Add your first source');
  const method=field(view,'Source method');method.value='YouTube captions';await method.fire('change');
  const video=field(view,'YouTube URL or video ID'),language=field(view,'Caption language'),download=find(view,'button','Download captions');
  assert.equal(video.parentElement.parentElement,download.parentElement,'Download belongs to its URL field group');assert.equal(language.parentElement.parentElement,download.parentElement);
  const sourceName=field(view,'Source name');sourceName.value='Team notes';await sourceName.fire('input');assert.equal(field(view,'Stable source ID').value,'team-notes');
  await run('navigate("Activity")');await run('navigate("Import")');assert.equal(field(view,'Source name').value,'Team notes','Import draft survives navigation');
  // A prepared source requires a preview. Changing options invalidates approval.
  video.value='sample-video';let resolvePreview;
  context.queueFixture=async()=>({id:'preview-job',finished:new Promise(resolve=>{resolvePreview=resolve;})});
  run('queue=queueFixture;');await click(view,'Download captions');
  assert(find(view,'button','4. Import into wiki').disabled,'Import starts disabled');
  const preview=click(view,'Preview changes');await new Promise(resolve=>setImmediate(resolve));
  resolvePreview({status:'completed',result:{ok:true,changes:[]}});await preview;
  assert(!find(view,'button','4. Import into wiki').disabled,'Successful preview enables import');
  const mode=field(view,'Processing');mode.value='raw';await mode.parentElement.parentElement.fire('input');
  assert(find(view,'button','4. Import into wiki').disabled,'Changed processing invalidates the preview');
  await run('navigate("Pages")');assert.equal(view.querySelector('[role="treeitem"]').getAttribute('aria-expanded'),'true','Expanded folders survive navigation');
  // Late save responses must not replace a page selected while the save was pending.
  await click(view,'Edit');
  let finishSave;context.saveApi=async(path,method,body)=>method==='PUT'?new Promise(resolve=>{finishSave=resolve;}):context.api(path,method,body);
  run('StudioApi.request=saveApi;');
  const saving=click(view,'Save ⌘/Ctrl+S');await new Promise(resolve=>setImmediate(resolve));
  run('activePage={path:"other.md",content:"# Other",revision:"other-revision"};editing=false;drawEditor();');
  finishSave({path:'Guides/intro.md',content:'# Saved',revision:'revision-2'});await saving;
  assert.equal(run('activePage.path'),'other.md','Late save cannot replace the current page');
  const chartHost=new Element('div');context.chartHost=chartHost;run('metricChart(chartHost,"Outcomes",{completed:2})');assert(descendants(chartHost).some(n=>n.tagName==='TABLE'),'Chart unavailable still gives data table');
  console.log('PASS: Pages default, keyboard tree, read/edit, grouped downloads, retained drafts, preview gates, late-save race and chart fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
