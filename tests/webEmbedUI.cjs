// Exercise the real page integration, not just the independent message bridge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const page = fs.readFileSync('public/index.md','utf8');
const sent=[],requests=[],advanced=[],listeners={};
let releaseRender;
const win={location:{origin:'https://app.example',search:'?embed=1&uuid=old'},crypto:webcrypto,
  addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
win.parent={postMessage:(data,origin)=>sent.push({data,origin})};
const c=vm.createContext({window:win,Uint8Array,URLSearchParams,console,embeddedMode:true,embedBridge:null,
  embedInitialDraft:false,embedConversationUsed:false,isProcessing:false,attachmentsEnabled:false,attachments:[],
  currentSessionUuid:'fresh',lastRawContent:'',lastKnownHistory:[],promptInput:{value:'',focus(){}},
  advancedUI:{enabled:()=>true,busy:()=>false,submit:async(...args)=>advanced.push(args)},
  lastSubmittedPrompt:'',lastFinishedPrompt:'',activeHistoryId:null,lastRenderedRaw:'',streamEnabled:false,
  activeSubmissionStartedAt:0,sawNonFinishedForActiveSubmission:false,resolveAppUrl:p=>p,
  autoResizeTextarea(){},composerNotice:message=>{c.notice=message;},setComposerExpanded(){},clearAttachments(){},
  buildPromptWithAttachments:text=>text,buildAttachmentDisplayPrompt:text=>text,
  buildOptimisticUserPromptBlock:text=>'<user>'+text+'</user>',
  collectBrowserContext:()=>null,renderRawContent:()=>new Promise(resolve=>{releaseRender=resolve;}),
  fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({uuid:'fresh'})};},
  startProcessing(){c.isProcessing=true;c.promptInput.value='';},startPolling(){},
  updateResultsContent:async()=>{},forceRenderChartBlocks(){},escapeHtml:x=>x,
  alert:message=>{throw Error(message);},generateNewSessionUuid:()=> 'new-iframe-session',
});
c.document={createElement:()=>({}),head:{append(script){vm.runInContext(fs.readFileSync('public/'+script.src.split('?')[0],'utf8'),c);script.onload();}}};
vm.runInContext(page.slice(page.indexOf('    function captureEmbedContext()'),page.indexOf('    // Optional shared-token auth')),c);
vm.runInContext(page.slice(page.indexOf('    async function handleSubmit()'),page.indexOf('    async function pollOnce()')),c);
vm.runInContext(page.slice(page.indexOf('    async function handleRetryLastAnswer()'),page.indexOf('    function captureActivityDisclosures()')),c);
vm.runInContext(page.slice(page.indexOf('    function getOrCreateSessionUuid()'),page.indexOf('    function destroyRenderedCharts')),c);
const config={enabled:true,prompt:true,contextRequired:true,origins:['https://app.example'],fields:{customerId:{type:'string',required:true}},maxPromptChars:120000};
const message=(action,extra={})=>({type:'mini-a:embed',version:1,action,requestId:'id',channelId:sent[0]?.data.channelId,...extra});
const emit=data=>listeners.message({data,source:win.parent,origin:win.location.origin});
(async()=>{
  c.promptInput.value='early';await c.handleSubmit();assert.match(c.notice,/not ready/);assert.equal(requests.length,0);c.promptInput.value='';
  await c.configureEmbedding(config);
  await emit({type:'mini-a:embed',version:1,action:'hello',requestId:'hello'});
  await emit(message('set-context',{revision:1,context:{customerId:'A'}}));
  await emit(message('start',{mode:'draft',text:'/set useshell true @secret $skill',revision:1}));
  assert.equal(c.promptInput.value,'/set useshell true @secret $skill');assert.equal(requests.length,0);
  const submit=c.handleSubmit();
  await emit(message('set-context',{revision:2,context:{customerId:'B'}}));
  releaseRender();assert.equal(await submit,true);
  assert.equal(advanced.length,0,'handed-off draft bypasses Advanced command parsing');
  assert.equal(requests[0].url,'prompt');assert.equal(requests[0].body.prompt,'/set useshell true @secret $skill');
  assert.equal(requests[0].body.embed.context.customerId,'A','snapshot precedes awaited rendering');
  c.isProcessing=false;c.promptInput.value='follow-up';await c.handleSubmit();
  assert.equal(advanced[0][2].context.customerId,'B','subsequent normal Advanced goal receives latest context');
  await emit(message('clear-context',{revision:3}));c.promptInput.value='blocked';await c.handleSubmit();
  assert.match(c.notice,/required/);assert.equal(advanced.length,1);
  c.notice='';c.lastRawContent='Retained conversation';let replaced=false;
  c.updateResultsContent=async()=>{replaced=true;};
  await c.handleRetryLastAnswer();assert.match(c.notice,/required/);
  assert.equal(requests.length,1);assert.equal(replaced,false,'blocked retry keeps the existing conversation visible');
  assert.equal(c.getOrCreateSessionUuid(),'new-iframe-session','embedded URL UUID cannot restore old conversation');
  c.embeddedMode=false;assert.equal(c.getOrCreateSessionUuid(),'old','standalone URL behavior retained');
  console.log('Embedding UI: readiness, plain Advanced draft, capture timing, follow-ups, clearing and fresh sessions passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
