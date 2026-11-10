const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const validation = require('../public/embed-context.js');
const config = {enabled:true,origins:['https://app.example','https://other.example'],prompt:true,contextRequired:true,maxPromptChars:120000,
  fields:validation.fields({customerId:{type:'string',required:true},selectedIds:{type:'string[]'},count:{type:'number'},active:{type:'boolean'}})};
const envelope = context => ({version:1,revision:1,context});
assert.deepEqual(validation.envelope(envelope({customerId:'@secret.txt',selectedIds:['a','b']}),config).context,
  {customerId:'@secret.txt',selectedIds:['a','b']});
for (const context of [null,{},[],{customerId:''},{customerId:1},{customerId:'a',extra:'x'},
  {customerId:'a',count:Infinity},{customerId:'a',count:9007199254740992},{customerId:'a',selectedIds:[{}]},{customerId:'a',selectedIds:Array(2)},
  {customerId:'x'.repeat(1025)},{customerId:'a',selectedIds:Array(65).fill('a')},
  JSON.parse('{"customerId":"a","__proto__":{"admin":true}}'),{customerId:'a',constructor:'x'}]) {
  assert.throws(()=>validation.envelope(envelope(context),config));
}
assert.throws(()=>validation.envelope({...envelope({customerId:'a'}),version:2},config));
assert.throws(()=>validation.envelope(envelope({customerId:'a'}),{...config,enabled:false}));
assert.throws(()=>validation.envelope(envelope({customerId:'a',selectedIds:Array(20).fill('é'.repeat(1000))}),config),/16 KiB/);
assert.equal(validation.bytes('aé😀'),7);
assert.equal(validation.envelope(envelope(null),{...config,contextRequired:false}).context,null);
for (const fields of [{bad:{type:'object'}},{bad:{type:'string',required:'true'}},JSON.parse('{"constructor":{"type":"string"}}')]) assert.throws(()=>validation.fields(fields));

// Execute the actual web-job wrapper, preserving authentication/query fields while
// avoiding oJob-common's directory redirect loop on the embedded root URL.
const yaml=fs.readFileSync('mini-a-web.yaml','utf8');
const headerJob=yaml.split('- name : Apply embedding headers\n')[1].split('  exec : | #js\n')[1].split(/\n(?=[^ \n])/)[0].replace(/^    /gm,'');
let seenRequest,applied=0;
const staticRoute=request=>{seenRequest=request;return {mimetype:'text/html',header:{'X-Test':'kept'}};};
const routes={'/':staticRoute};
const serverContext=vm.createContext({args:{onport:8888},global:{__ojobRoutes:{8888:routes},__ojobHttp:{8888:{}}},
  isString:x=>typeof x==='string',merge:(a,b)=>({...a,...b}),ow:{server:{httpd:{route(){applied++;}}}}});
vm.runInContext(fs.readFileSync('js/web/mini-a-web-embed.js','utf8'),serverContext);
serverContext.MiniAWebEmbed.config=config;
vm.runInContext(headerJob,serverContext);
const original={originalURI:'/?embed=1',uri:'/',params:{embed:'1'},header:{'x-mini-a-token':'fixture'}};
assert.match(routes['/'](original).header['Content-Security-Policy'],/^frame-ancestors https:\/\/app.example https:\/\/other.example$/);
assert.equal(seenRequest.originalURI,'/');assert.equal(original.originalURI,'/?embed=1');
assert.equal(seenRequest.params,original.params);assert.equal(seenRequest.header,original.header);assert.equal(applied,1);

function fixture(overrides={},startHook) {
  const sent=[],starts=[],listeners={},parent={},other={};
  const win={parent,location:{origin:'https://app.example'},crypto:webcrypto,
    addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
  parent.postMessage=(message,target)=>sent.push({message,target});
  const sandbox=vm.createContext({window:win,Uint8Array,MiniAEmbedContext:validation});
  vm.runInContext(fs.readFileSync('public/embed.js','utf8'),sandbox);
  let canStart=true;
  const bridge=sandbox.MiniAEmbedBridge({config:{...config,...overrides},canStart:()=>canStart,
    start:async(text,mode,context)=>{starts.push({text,mode,context});if(startHook)await startHook();}});
  const emit=async(data,origin='https://app.example',source=parent)=>listeners.message?.({data,origin,source});
  const hello=async(origin)=>{await emit({type:'mini-a:embed',version:1,action:'hello',requestId:'hello'},origin);return sent.at(-1)?.message.channelId;};
  const message=(action,extra={})=>({type:'mini-a:embed',version:1,action,requestId:'request',channelId:sent[0]?.message.channelId,...extra});
  return {sent,starts,bridge,emit,hello,message,parent,other,block:()=>canStart=false};
}
(async()=>{
  const f=fixture();
  await f.emit({type:'mini-a:embed',version:1,action:'hello',requestId:'hello'},'https://evil.example');
  await f.emit({type:'mini-a:embed',version:1,action:'hello',requestId:'hello'},undefined,f.other);
  assert.equal(f.sent.length,0);
  await f.hello();assert.equal(f.sent[0].target,'https://app.example');assert.equal(f.sent[0].message.prompt,true);
  assert.throws(()=>f.bridge.snapshot(),/required/);
  await f.emit(f.message('set-context',{revision:1,context:{customerId:'first'}}));
  const first=f.bridge.snapshot();
  await f.emit(f.message('set-context',{revision:2,context:{customerId:'second'}}));
  assert.equal(first.context.customerId,'first','a running submission owns an immutable copy');
  assert.equal(f.bridge.snapshot().context.customerId,'second');
  await f.emit(f.message('set-context',{revision:1,context:{customerId:'stale'}}));
  await f.emit(f.message('set-context',{channelId:'old-load',revision:3,context:{customerId:'stale'}}));
  await f.emit(f.message('set-context',{revision:3,context:{customerId:'other'}}),'https://other.example');
  assert.equal(f.bridge.snapshot().context.customerId,'second');
  await f.emit(f.message('set-context',{revision:3,context:{unknown:'x'}}));
  assert.throws(()=>f.bridge.snapshot(),/invalid/);
  await f.emit(f.message('clear-context',{revision:4}));assert.throws(()=>f.bridge.snapshot(),/required/);
  await f.emit(f.message('set-context',{revision:5,context:{customerId:'new',selectedIds:['x']}}));
  await f.emit(f.message('set-context',{revision:6,context:{customerId:'newer'}}));
  assert.equal(f.bridge.snapshot().context.selectedIds,undefined,'replace rather than merge');
  const start=f.message('start',{requestId:'handoff',mode:'submit',text:'/set knowledge @file',revision:6});
  await Promise.all([f.emit(start),f.emit(start)]);assert.equal(f.starts.length,1);
  await f.emit(start);assert.equal(f.starts.length,1);
  await f.emit({...start,text:'different'});assert.equal(f.sent.at(-1).message.action,'error');
  await f.emit({...start,requestId:'second'});assert.equal(f.starts.length,1);
  assert.equal(f.starts[0].text,'/set knowledge @file','bridge hands off literal text');
  f.bridge.dispose();assert.throws(()=>f.bridge.snapshot(),/unavailable/);
  const cross=fixture({contextRequired:false});await cross.hello('https://other.example');
  assert.equal(cross.sent[0].message.prompt,false);
  await cross.emit(cross.message('start',{mode:'submit',text:'hello',revision:0}),'https://other.example');assert.equal(cross.starts.length,0);
  const optional=fixture({contextRequired:false});await optional.hello();
  await optional.emit(optional.message('start',{mode:'draft',text:'hello',revision:0}));
  assert.equal(optional.starts[0].mode,'draft');assert.equal(optional.starts[0].context.context,null);
  const disabled=fixture({prompt:false,contextRequired:false});await disabled.hello();
  await disabled.emit(disabled.message('start',{mode:'submit',text:'hello',revision:0}));assert.equal(disabled.starts.length,0);
  const busy=fixture({contextRequired:false});await busy.hello();busy.block();
  await busy.emit(busy.message('start',{mode:'submit',text:'hello',revision:0}));assert.equal(busy.starts.length,0);
  const second=fixture();await second.hello();assert.throws(()=>second.bridge.snapshot(),/required/);
  assert.notEqual(second.sent[0].message.channelId,f.sent[0].message.channelId);
  let finish;
  const pending=fixture({contextRequired:false},()=>new Promise(resolve=>{finish=resolve;}));await pending.hello();
  const pendingStart=pending.message('start',{requestId:'in-flight',mode:'submit',text:'One goal',revision:0});
  const running=pending.emit(pendingStart);
  await pending.emit({...pendingStart,text:'Mismatched duplicate'});
  assert.equal(pending.sent.at(-1).message.action,'error');
  await pending.emit(pendingStart);assert.equal(pending.sent.at(-1).message.status,'pending');
  finish();await running;await pending.emit(pendingStart);
  assert.equal(pending.sent.at(-1).message.status,'submitted','a rejected duplicate must not poison the in-flight receipt');
  assert.equal(pending.starts.length,1);
  console.log('Embedding schema, message boundaries, lifecycle, isolation and handoff tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
