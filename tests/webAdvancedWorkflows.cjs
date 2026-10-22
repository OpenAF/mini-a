const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {el,all}=require('./webAdvancedFixture.cjs');
const source=fs.readFileSync('public/advanced.js','utf8');
const commands=[];
const context=vm.createContext({el,screen:el('section'),workflowDrafts:{},snapshot:{settings:[]},settingsRefresh:null,resultGeneration:1,
  busy:false,window:{},bridge:{uuid:()=> 'fixture'},input:label=>Object.assign(el('input'),{placeholder:label}),quote:JSON.stringify,
  button:(text,onclick)=>Object.assign(el('button',text),{onclick}),command:async text=>commands.push(text),actions(){},resultPanel(){}});
vm.runInContext(source.slice(source.indexOf('  function secondarySection('),source.indexOf('  function commandForm(')),context);
function field(name){return all(context.screen).find(n=>n['aria-label']===name);}
function button(name){return all(context.screen).find(n=>n.tag==='button'&&n.textContent===name);}
function edit(name,value){const n=field(name);if(n.type==='checkbox')n.checked=value;else n.value=value;n.oninput();}
function submit(name){const b=button(name);return b.onclick?b.onclick():b.parentElement.parentElement.onsubmit({preventDefault(){}});}
function render(kind='ingest'){context.screen.replaceChildren();context.settingsRefresh=null;if(kind==='ingest')context.ingestWorkspace();else context.planningWorkspace(kind);}
(async()=>{
  render();await submit('Preview ingestion');assert.equal(commands.length,0);assert.ok(all(context.screen).some(n=>n.textContent==='Enter a source to ingest.'));
  edit('Source','/tmp/My "Docs"');edit('Destination section','Team Docs');edit('Source ID (optional)','docs id');edit('Layout','source');edit('Prune removed source pages',true);
  await submit('Preview ingestion');assert.equal(commands.pop(),'/ingest "/tmp/My \\"Docs\\"" "Team Docs" prune dryrun "sourceid=docs id" layout=source'.replaceAll('\\\\','\\'));
  await submit('Ingest source');assert.ok(!commands.pop().includes(' dryrun'));
  render();assert.equal(field('Source').value,'/tmp/My "Docs"','source survives view rebuilds');assert.equal(field('Prune removed source pages').checked,true);
  edit('Prune removed source pages',false);edit('Allow pruning from an empty source',true);await submit('Ingest source');assert.equal(commands.length,0,'invalid empty prune is caught before submission');
  edit('Recovery ID','a "quoted" id');edit('Recovery action','discard');await submit('Run recovery action');assert.equal(commands.pop(),'/ingest recovery discard '+JSON.stringify('a "quoted" id'));
  render('absorb');edit('Spec file or inline JSON/SLON','{"source":"docs folder"}');await submit('Create plan');assert.equal(commands.pop(),'/absorb plan '+JSON.stringify('{"source":"docs folder"}'));
  edit('Plan ID','plan id');await submit('Run plan action');assert.equal(commands.pop(),'/absorb show "plan id"');
  render('dream');assert.equal(field('Dry run').checked,true);await submit('Run maintenance');assert.equal(commands.pop(),'/dream wiki plan dryrun');
  edit('Target','memory');await submit('Run maintenance');assert.equal(commands.pop(),'/dream memory dryrun','wiki mode is not passed to memory');
  context.busy=true;context.settingsRefresh();assert.equal(button('Run maintenance').disabled,true);await submit('Run maintenance');assert.equal(commands.length,0);
  context.busy=false;context.settingsRefresh();context.command=async()=>{throw Error('Offline');};await submit('Run maintenance');assert.ok(all(context.screen).some(n=>n.textContent==='Offline'));assert.equal(field('Target').value,'memory');
  let finish;context.command=()=>new Promise(resolve=>finish=resolve);const pending=submit('Run maintenance');assert.equal(button('Run maintenance').disabled,true);await submit('Run maintenance');context.resultGeneration++;finish();await pending;
  console.log('Workflows: quoted commands, preview/run, draft retention, validation, recovery, busy/error/stale handling passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
