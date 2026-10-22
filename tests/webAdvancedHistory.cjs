const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {el,all} = require('./webAdvancedFixture.cjs');
const source=fs.readFileSync('public/advanced.js','utf8');
async function render(sessions,error,storageMode='current') {
  let uuid='current-session';const requests=[];
  const context=vm.createContext({el,storageMode,screen:el('section'),busy:false,resultGeneration:0,
    input:(placeholder,value='')=>Object.assign(el('input'),{placeholder,value}),
    button:(text,onclick)=>Object.assign(el('button',text),{onclick}),
    bridge:{uuid:()=>uuid,browserHistory:()=>sessions,resume:value=>uuid=value,openBrowserHistory:async entry=>{uuid=entry.uuid;context.loaded=entry;},refresh(){context.refreshed=uuid;}},
    api:async data=>{requests.push(data);if(error)throw error;return data.action==='sessions'?{sessions:sessions.slice(0,50),nextOffset:sessions.length>50?50:null}:{title:'Preview title',messages:[{role:'user',content:'<script>plain text</script>'}]};},
    resolvePendingChanges:async()=>context.allowSwitch,
    resetSessionView(){context.reset=true;},renderScreen(){context.rendered=context.activeScreen;},poll:async()=>{context.polled=uuid;},
    filter:{oninput(){}},actions(){},commandForm(){},setTimeout,clearTimeout,
    showError(e){context.error=e.message;},allowSwitch:true
  });
  vm.runInContext(source.slice(source.indexOf('  function historyWorkspace('),source.indexOf('  function commandForm(')),context);
  context.historyWorkspace();await new Promise(resolve=>setImmediate(resolve));context.requests=requests;return context;
}
const control=(ctx,text)=>all(ctx.screen).find(n=>n.tag==='button'&&n.textContent===text);
const entries=ctx=>all(ctx.screen).filter(n=>n.className==='advanced-history-open');
(async()=>{
  const ctx=await render([{uuid:'saved-session',updated:1000,title:'Saved title'},{uuid:'current-session',updated:500}]);
  assert.equal(entries(ctx).length,2);assert.equal(entries(ctx)[1]['aria-current'],'true');
  await entries(ctx)[0].onclick();
  assert.equal(ctx.bridge.uuid(),'current-session');assert.equal(ctx.reset,undefined,'preview never resets current session');
  assert.ok(all(ctx.screen).some(n=>n.tag==='pre'&&n.textContent==='<script>plain text</script>'));
  const preview=all(ctx.screen).find(n=>n.className==='advanced-history-preview');
  assert.equal(preview.focused,true);
  assert.equal(preview.scrollRequests.length,2,'loading and completed previews jump into view');
  assert.equal(preview.scrollRequests[1].block,'start');
  await control(ctx,'Back to conversations').onclick();
  assert.equal(preview.hidden,true);assert.equal(entries(ctx)[0].focused,true);
  assert.equal(entries(ctx)[0].scrollRequests[0].block,'center','return to the selected entry');
  await entries(ctx)[0].onclick();
  ctx.allowSwitch=false;await control(ctx,'Open conversation').onclick();assert.equal(ctx.bridge.uuid(),'current-session');
  ctx.allowSwitch=true;ctx.busy=true;await assert.rejects(control(ctx,'Open conversation').onclick(),/Finish/);ctx.busy=false;
  await control(ctx,'Open conversation').onclick();assert.equal(ctx.polled,'saved-session');assert.equal(ctx.rendered,'activity');
  const browser=await render([{uuid:'browser',timestamp:1000,title:'Local',content:'Browser transcript'}],null,'browser');
  await entries(browser)[0].onclick();assert.equal(browser.requests.length,0);assert.equal(browser.bridge.uuid(),'current-session');
  await control(browser,'Open conversation').onclick();assert.equal(browser.loaded.uuid,'browser');
  const empty=await render([]);assert.ok(all(empty.screen).some(n=>n.textContent==='No saved conversations yet.'));
  const failed=await render([],Error('Offline'));assert.equal(failed.error,'Offline');
  const pages=await render(Array.from({length:51},(_,i)=>({uuid:'saved-'+i,updated:1000})));assert.equal(entries(pages).length,50);assert.equal(control(pages,'Load more').hidden,false);
  await control(pages,'Load more').onclick();assert.equal(pages.requests.at(-1).offset,50);
  let complete;
  pages.api=()=>new Promise(resolve=>complete=resolve);
  const loading=entries(pages)[0].onclick();
  const pendingPreview=all(pages.screen).find(n=>n.className==='advanced-history-preview');
  assert.equal(pendingPreview.scrollRequests.length,1,'jump before the network returns');
  await control(pages,'Back to conversations').onclick();
  complete({messages:[]});await loading;
  assert.equal(pendingPreview.hidden,true);assert.equal(pendingPreview.scrollRequests.length,1,'late results cannot reopen a dismissed preview');
  pages.api=async()=>{throw Error('Preview offline');};
  await entries(pages)[0].onclick();
  assert.equal(pendingPreview.hidden,false);assert.ok(control(pages,'Retry preview'));
  assert.equal(pendingPreview.scrollRequests.length,3,'errors also remain visible');
  console.log('History: read-only previews, explicit opening, draft/busy guards, browser storage, pagination and errors passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
