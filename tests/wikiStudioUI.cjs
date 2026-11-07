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
run('StudioApi.request=api;StudioApi.background=api;studioSession={canTestWiki:false,adapters:{directory:[]}};');
(async()=>{
  // Ordinary buttons control disclosures without native summary activation.
  const disclosure = run('technical({status:"ok"}, document.getElementById("workspace"))');
  const summary = disclosure.querySelector('.disclosure-toggle');
  assert.equal(disclosure.tagName,'DIV');
  assert.equal(summary.tagName,'BUTTON');
  let prevented = false, stopped = false;
  await summary.fire('click', {preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(disclosure.open,true,'A disclosure opens on first activation');
  assert.equal(summary.getAttribute('aria-expanded'),'true');
  assert(prevented && stopped,'Native activation and bubbling are cancelled');
  await summary.fire('click',{detail:0});
  assert.equal(disclosure.open,false,'Keyboard-generated click closes the disclosure');
  const nested = run('technical({nested:true}, document.getElementById("workspace").querySelector(".studio-disclosure"))');
  disclosure.open = true;
  await nested.querySelector('.disclosure-toggle').fire('click');
  assert.equal(nested.open,true,'Nested disclosure opens independently');
  assert.equal(disclosure.open,true,'Parent disclosure remains open');
  await run('openWiki({id:"a",name:"Alpha",access:"rw"})');
  assert.equal(history.state.view,'Pages','Wiki starts in Pages');
  const view=document.getElementById('view');
  await run('SummaryCache.load("a")');
  const scans = () => calls.filter(c => /\/(overview|lint|graph\/stats)$/.test(c.path)).length;
  const gathered = scans();
  await run('navigate("Overview")');
  assert.equal(scans(),gathered,'Overview reuses the background snapshot');
  assert(view.textContent.includes('Cached for this session'),'Cached data is labelled');
  await run('navigate("Maintenance")');
  assert(find(view,'button','Dream · Check wiki'),'Maintenance defaults to Dream tasks');
  assert.equal(scans(),gathered,'Maintenance navigation does not rescan the wiki');
  await click(view,'Health');
  assert.equal(scans(),gathered,'Health shares the cached reports');
  await click(view,'Refresh health');
  assert.equal(scans(),gathered+3,'Explicit refresh gathers all reports once');
  run('SummaryCache.invalidate("a")');
  await run('SummaryCache.load("a")');
  assert.equal(scans(),gathered+6,'A change invalidates and refreshes the snapshot');
  await run('SummaryCache.load("b")');
  assert.equal(scans(),gathered+9,'Another wiki has its own snapshot');
  await run('SummaryCache.load("a")');
  assert.equal(scans(),gathered+9,'Another wiki does not replace the first cache');
  context.fetch = async () => ({ok:true,json:async()=>({})});
  await run('StudioApi.send("wikis/a/page","PUT",{})');
  await run('SummaryCache.load("a")');
  assert.equal(scans(),gathered+12,'Successful writes trigger background refresh');
  context.fetch = async () => ({ok:true,json:async()=>({id:"finished-job",wikiId:"a",status:"completed"})});
  await run('StudioApi.send("jobs/finished-job")');
  await run('SummaryCache.load("a")');
  assert.equal(scans(),gathered+15,'Job completion triggers background refresh');
  await run('StudioApi.send("jobs/finished-job")');
  assert.equal(scans(),gathered+15,'Repeated completed-job reads do not rescan');
  const backgroundApi = context.api;
  let releaseScan;
  context.delayedBackground = async path => path === 'wikis/a/overview' ? new Promise(resolve => {releaseScan=()=>resolve({studio:{pageCount:5,pendingRecovery:[]}});}) : backgroundApi(path);
  run('StudioApi.background=delayedBackground;SummaryCache.load("a",true);');
  await new Promise(resolve=>setImmediate(resolve));
  run('SummaryCache.invalidate("a");StudioApi.background=api;');
  releaseScan();
  await run('SummaryCache.entry("a").pending');
  await run('SummaryCache.load("a")');
  assert.equal(run('SummaryCache.entry("a").snapshot.reports[0].value.studio.pageCount'),2,'A write during collection discards that stale result and gathers again');
  let activeReads=0, maxReads=0;
  context.serialBackground=async path=>{
    activeReads++;maxReads=Math.max(maxReads,activeReads);
    await new Promise(resolve=>setImmediate(resolve));
    try{return await context.api(path);}finally{activeReads--;}
  };
  run('StudioApi.background=serialBackground;');
  await run('SummaryCache.load("a",true)');
  assert.equal(maxReads,1,'Snapshot reads never overlap the exclusive wiki lock');
  const lastGood=run('SummaryCache.entry("a").snapshot');
  context.busyBackground=async()=>{const error=new Error('Wiki is busy');error.status=423;throw error;};
  run('StudioApi.background=busyBackground;');
  await run('SummaryCache.load("a",true)');
  assert.equal(run('SummaryCache.entry("a").snapshot'),lastGood,'A busy refresh retains the last good snapshot');
  assert.match(run('SummaryCache.entry("a").error'),/busy/);
  run('StudioApi.background=api;');
  await run('navigate("Health")');
  const healthDisclosure=view.querySelector('.studio-disclosure');
  await healthDisclosure.querySelector('.disclosure-toggle').fire('click');
  assert.equal(healthDisclosure.open,true);
  await click(view,'Refresh health');
  assert.equal(view.querySelector('.studio-disclosure').open,true,'Refreshing data preserves expanded controls');
  await run('navigate("Pages")');
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
  assert.equal(field(view,'Destination section').value,'team-notes','Destination defaults to the stable source ID');
  assert(find(view,'button','4. Import into wiki').disabled,'Import starts disabled');
  const preview=click(view,'Preview changes');await new Promise(resolve=>setImmediate(resolve));
  resolvePreview({status:'completed',result:{ok:true,changes:[]}});await preview;
  assert(!find(view,'button','4. Import into wiki').disabled,'Successful preview enables import');
  const mode=field(view,'Processing');mode.value='raw';await mode.parentElement.parentElement.fire('input');
  assert(find(view,'button','4. Import into wiki').disabled,'Changed processing invalidates the preview');
  await run('navigate("Pages")');assert.equal(view.querySelector('[role="treeitem"]').getAttribute('aria-expanded'),'true','Expanded folders survive navigation');
  // Typing and repeated keyboard saves during an outstanding request retain the buffer.
  await click(view,'Edit');
  let releaseTypingSave, typingSaveCalls=0, savedBodies=[];
  context.typingApi=async(path,method,body)=>{
    if(method==='PUT'){typingSaveCalls++;savedBodies.push({...body});return new Promise(resolve=>{releaseTypingSave=resolve;});}
    return context.api(path,method,body);
  };
  run('StudioApi.request=typingApi;');
  const typingSource=view.querySelector('textarea');
  typingSource.value='# Submitted';await typingSource.fire('input');
  const firstTypingSave=typingSource.fire('keydown',{key:'s',ctrlKey:true});
  await new Promise(resolve=>setImmediate(resolve));
  typingSource.value='# Newer local typing';await typingSource.fire('input');
  const joinedSave=typingSource.fire('keydown',{key:'s',metaKey:true});
  assert.equal(typingSaveCalls,1,'Repeated keyboard saves join the in-flight request');
  releaseTypingSave({path:'Guides/intro.md',content:'# Submitted',revision:'saved-typing-1'});
  await Promise.all([firstTypingSave,joinedSave]);
  assert.equal(typingSource.value,'# Newer local typing','Save cannot replace newer text');
  assert.equal(run('dirty'),true,'Newer edits stay dirty');
  assert.equal(run('editing'),true,'Newer edits keep the editor open');
  assert.equal(run('activePage.revision'),'saved-typing-1','Server revision advances');
  const nextTypingSave=typingSource.fire('keydown',{key:'s',ctrlKey:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(savedBodies[1].expectedRevision,'saved-typing-1','Next save uses the accepted revision');
  assert.equal(savedBodies[1].content,'# Newer local typing');
  releaseTypingSave({path:'Guides/intro.md',content:'# Newer local typing',revision:'saved-typing-2'});
  await nextTypingSave;
  assert.equal(run('dirty'),false);assert.equal(run('editing'),false);
  run('StudioApi.request=api;');
  // Late save responses must not replace a page selected while the save was pending.
  await click(view,'Edit');
  let finishSave;context.saveApi=async(path,method,body)=>method==='PUT'?new Promise(resolve=>{finishSave=resolve;}):context.api(path,method,body);
  run('StudioApi.request=saveApi;');
  const saving=click(view,'Save ⌘/Ctrl+S');await new Promise(resolve=>setImmediate(resolve));
  run('activePage={path:"other.md",content:"# Other",revision:"other-revision"};editing=false;drawEditor();');
  finishSave({path:'Guides/intro.md',content:'# Saved',revision:'revision-2'});await saving;
  assert.equal(run('activePage.path'),'other.md','Late save cannot replace the current page');
  const chartHost=new Element('div');context.chartHost=chartHost;run('metricChart(chartHost,"Outcomes",{completed:2})');assert(descendants(chartHost).some(n=>n.tagName==='TABLE'),'Chart unavailable still gives data table');
  // Activity refreshes must not toggle the page-wide request banner behind the modal.
  const polls=[], refreshes=[];
  context.setTimeout=fn=>{refreshes.push(fn);return refreshes.length;};
  context.jobApi=async(path,method,body,options)=>{
    polls.push({path,options});
    return {id:'running-job',operation:'dream',status:'running',phase:'running',createdAt:'2026-11-06T00:00:00Z',progress:{stage:'enrichment',processed:7,cached:3,pending:9,failed:1,calls:2,estimatedTokens:4000,elapsedMs:6000,effective:{maxCalls:20,maxTokens:40000,maxMinutes:2},resumable:true}};
  };
  context.jobEvents=async(id,cursor,options)=>{polls.push({path:'events',options});return '';};
  run('StudioApi.request=jobApi;StudioApi.events=jobEvents;');
  await run('jobDetail("running-job")');
  const dialog=document.body.querySelector('.job-dialog');
  const progress=dialog.querySelector('progress');
  const details=descendants(dialog).find(n=>n.classList.contains('studio-disclosure')&&n.querySelector('button')?.textContent==='Technical details');
  details.open=true;details.querySelector('button').focus();
  const detailContent=details.children[1].children[0];
  await refreshes.shift()();
  assert.equal(dialog.querySelector('progress'),progress,'Polling retains the animated progress node');
  assert(progress.isConnected,'Progress stays mounted');
  assert(dialog.textContent.includes('7 processed · 3 cached · 9 pending · 1 failed · 2 / 20 calls'),'Graph counters and budgets remain visible');
  assert(dialog.textContent.includes('resumed explicitly'),'Graph progress explains pending work');
  assert(details.isConnected&&details.open,'Expanded details stay mounted and open');
  assert.equal(document.activeElement,details.querySelector('button'),'Polling retains disclosure focus');
  assert.equal(details.children[1].children[0],detailContent,'Unchanged job details are not redrawn');
  assert.equal(polls.length,4,'Initial and recurring refresh each read status and logs');
  assert(polls.every(p=>p.options?.silent===true),'All activity polling suppresses the page banner');
  document.body.querySelector('.job-dialog').close();
  await new Promise(resolve=>setImmediate(resolve));
  const count=polls.length;
  await refreshes.shift()();
  assert.equal(polls.length,count,'Closing activity stops further polling');
  const cancelHost=new Element('div');document.body.append(cancelHost);context.cancelHost=cancelHost;
  let finishCancellation;
  context.cancelApi=(path,method,body)=>{
    assert.equal(path,'jobs/cancel-me/cancel');assert.equal(method,'POST');
    assert.equal(JSON.stringify(body),'{}');
    return new Promise(resolve=>{finishCancellation=resolve;});
  };
  run('StudioApi.request=cancelApi;jobCancelButton(cancelHost,"cancel-me")');
  const cancelButton=find(cancelHost,'button','Request cancellation');
  const cancelling=cancelButton.fire('click');
  assert(cancelButton.disabled,'Duplicate cancellation is disabled while submitting');
  finishCancellation({status:'cancelled',cancelRequested:true});await cancelling;
  assert(cancelButton.disabled,'Acknowledged cancellation remains disabled');
  assert.equal(document.getElementById('message').textContent,'Job cancelled before it started.');
  cancelHost.replaceChildren();
  context.cancelApi=async()=>{throw Error('Cancellation unavailable');};
  run('StudioApi.request=cancelApi;jobCancelButton(cancelHost,"cancel-me")');
  await click(cancelHost,'Request cancellation');
  assert(!find(cancelHost,'button','Request cancellation').disabled,'A failed cancellation can be retried');
  assert.equal(document.getElementById('message').textContent,'Cancellation unavailable');
  const graphHost=new Element('div'), graphRequests=[];context.graphHost=graphHost;
  context.graphApi=async(path,method,body)=>{graphRequests.push({path,method,body});return {effective:{extraction:'semantic',modelHelp:'off',maxCalls:9,maxTokens:5000,maxMinutes:1},models:{main:false,lc:false},presets:{small:{maxCalls:20,maxTokens:40000,maxMinutes:2}},fallback:'Deterministic fallback; time limits stop new scheduling.'};};
  run('StudioApi.wiki=graphApi;currentWiki.access="rw";');await run('graphBuildControls(graphHost)');
  assert.equal(field(graphHost,'Maximum calls').value,'9','Graph saved defaults displayed');
  const extraction=field(graphHost,'Extraction'), assistance=field(graphHost,'Model assistance'), strategy=field(graphHost,'Build strategy');
  extraction.value='structural';await extraction.fire('change');assert(assistance.disabled,'Structural disables model assistance');
  extraction.value='semantic';await extraction.fire('change');strategy.value='resume';await strategy.fire('change');
  const force=descendants(graphHost).find(n=>n.tagName==='LABEL'&&n.textContent.includes('Force extraction')).querySelector('input');assert(force.disabled,'Resume disables force');
  await click(graphHost,'Save defaults');const saved=graphRequests.find(r=>r.method==='PUT').body;
  assert(!('strategy' in saved)&&!('force' in saved),'Save excludes per-run actions');
  const preset=field(graphHost,'Budget preset');preset.value='small';await preset.fire('change');assert.equal(Number(field(graphHost,'Maximum calls').value),20,'Preset changes budget');
  preset.value='reset';await preset.fire('change');assert.equal(field(graphHost,'Maximum calls').value,'100','Reset restores built-in budget');
  const readOnlyHost=new Element('div');context.readOnlyHost=readOnlyHost;run('currentWiki.access="ro"');await run('graphBuildControls(readOnlyHost)');assert(find(readOnlyHost,'button','Save defaults').disabled&&find(readOnlyHost,'button','Run graph build').disabled,'Read-only build controls disabled');
  const folderHost=new Element('div');document.body.append(folderHost);context.folderHost=folderHost;
  let folderName='Guides', folderAnswers=['Renamed'], folderJobs=[];
  context.folderApi=async(path,method,body)=>{
    if(path.startsWith('children?')){const parent=new URLSearchParams(path.split('?')[1]).get('path');return {items:parent||!folderName?[]:[{kind:'folder',name:folderName,path:folderName}]};}
    if(path==='folders/preview')return {ok:true,source:body.source,destination:body.destination,pages:2,files:3,folders:2,incomingLinks:[{path:'index.md',targets:['Guides/index.md']}],revision:'reviewed'};
    throw Error('Unexpected folder request: '+path);
  };
  context.folderDialog=async(title,initial,confirmation)=>confirmation?true:folderAnswers.shift();
  context.folderQueue=async(path,body)=>{folderJobs.push({path,body});folderName=body.destination;return {id:'folder-job',finished:Promise.resolve({status:'completed'})};};
  run('currentWiki={id:"folder-ui",name:"Folder UI",access:"rw"};studioSession={role:"admin"};dirty=false;StudioApi.wiki=folderApi;studioDialog=folderDialog;queue=folderQueue;');
  await run('pagesView(folderHost)');
  await folderHost.querySelector('[role="treeitem"]').fire('keydown',{key:'Enter'});
  assert(find(folderHost,'button','Move/rename folder')&&!find(folderHost,'button','Move/rename folder').disabled,'Folder actions visible for admins');
  await click(folderHost,'Move/rename folder');
  assert.equal(folderJobs[0].body.expectedRevision,'reviewed','Reviewed subtree revision submitted');
  assert.equal(folderJobs[0].body.destination,'Renamed');
  assert.equal(folderHost.querySelector('[role="treeitem"]').dataset.path,'Renamed','Explorer refreshes to moved folder');
  assert.equal(folderHost.querySelector('[role="treeitem"]').getAttribute('aria-selected'),'true','Moved folder selected');
  folderAnswers=['wrong'];await click(folderHost,'Delete folder');assert.equal(folderJobs.length,1,'Wrong exact path never queues deletion');
  folderAnswers=['Renamed'];await click(folderHost,'Delete folder');
  assert.equal(folderJobs[1].body.confirmation,'Renamed','Deletion forwards exact confirmation');
  assert.equal(run('pageState().folder'),'','Deleted folder selects parent');
  assert(folderHost.textContent.includes('Folder deleted.'),'Deletion feedback visible');
  console.log('PASS: Pages default, keyboard tree, read/edit, grouped downloads, retained drafts, preview gates, late-save race, chart fallback and recursive folder controls');
})().catch(error=>{console.error(error);process.exitCode=1;});
