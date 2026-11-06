const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const node = () => ({textContent:'',hidden:false,children:[],append(...children){this.children.push(...children);},remove(){},replaceChildren(){}});
const nodes = new Map();
let active = 0, maximum = 0;
const attempts = new Map();
const visibility = [];
const banner = node();
Object.defineProperty(banner, "hidden", {set(value){visibility.push(value);},get(){return visibility.at(-1) ?? true;}});
nodes.set("studio-activity", banner);
const fetchOptions = [];
const context = vm.createContext({
  document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},
  Date, Set, Promise, AbortController, crypto:{randomUUID:()=> 'test'},
  setTimeout:fn=>setImmediate(fn), setInterval:()=>1, clearInterval(){},
  fetch:async (url, options)=>{
    fetchOptions.push(options);
    active++; maximum=Math.max(maximum,active);
    const count=(attempts.get(url)||0)+1;attempts.set(url,count);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    const busy=url.endsWith('/retry')&&count<3 || url.endsWith('/busy');
    const failed=url.endsWith('/failed');
    return {text:async()=>"",ok:!busy&&!failed,status:busy?423:failed?500:200,json:async()=>busy||failed?{error:{message:busy?'busy':'failed'}}:{ok:true}};
  }
});
const source=fs.readFileSync('public/studio/studio.js','utf8');
vm.runInContext(source.slice(0,source.indexOf('// Session-only snapshots'))+';globalThis.api=StudioApi;globalThis.activity=StudioActivity;',context);
(async()=>{
  await context.api.background('quiet-summary');
  assert.deepEqual(visibility, [], 'Background summary collection does not toggle the banner');
  await Promise.all([context.api.background('retry'),context.api.background('other'),context.api.request('foreground')]);
  assert.equal(maximum,1,'Background and interactive reads share one queue');
  assert.equal(attempts.get('/api/v1/retry'),3,'Temporary busy responses are retried');
  await assert.rejects(context.api.background('busy'),error=>error.status===423);
  assert.equal(attempts.get('/api/v1/busy'),4,'Busy retries are bounded');
  await assert.rejects(context.api.background('failed'),error=>error.status===500);
  assert.equal(attempts.get('/api/v1/failed'),1,'Other errors are not retried');
  await context.api.request('after-error');
  assert.equal(context.activity.requests.size,0,'Failed requests clear activity and leave the queue usable');
  visibility.length=0;
  await context.api.request('poll', 'GET', undefined, {silent:true});
  await context.api.events('poll', 4, {silent:true});
  await assert.rejects(context.api.request('failed', 'GET', undefined, {silent:true}));
  await assert.rejects(context.api.raw('failed', {silent:true}));
  assert.deepEqual(visibility, [], 'Automatic status/log reads and failures never toggle the page banner');
  assert(fetchOptions.every(options=>!Object.hasOwn(options, 'silent')), 'UI options do not leak into fetch');
  const foreground=context.api.request('foreground-visible');
  const quiet=context.api.request('poll', 'GET', undefined, {silent:true});
  assert.equal(banner.hidden,false,'Foreground activity stays visible beside a quiet poll');
  assert.equal(context.activity.requests.size,1,'Only foreground work is tracked');
  await Promise.all([foreground,quiet]);
  assert.equal(maximum,1,'Quiet reads still use the shared queue');
  assert.equal(banner.hidden,true,'Foreground completion clears its banner');

  const pending = new Map();
  const originalFetch=context.fetch;
  context.fetch=(url,options)=>new Promise((resolve,reject)=>{
    pending.set(url,{resolve,options});
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  });
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const aborted=promise=>assert.rejects(promise,error=>error.name==='AbortError');
  const running=context.api.request('slow');
  const runningRejected=aborted(running);
  await tick();
  const queued=context.api.request('never-send');
  const queuedRejected=aborted(queued);
  const queuedActivity=[...context.activity.requests].find(request=>request.path==='never-send');
  queuedActivity.item.children.at(-1).onclick();
  await queuedRejected;
  assert.equal(context.activity.requests.size,1,'Queued cancellation settles without waiting for the running request');
  assert(!pending.has('/api/v1/never-send'),'Cancelled queued work is never sent');
  nodes.get('studio-activity-cancel').onclick();
  await runningRejected;
  assert(pending.get('/api/v1/slow').options.signal.aborted,'Running cancellation aborts fetch');
  assert.equal(context.activity.requests.size,0);
  context.fetch=originalFetch;
  await context.api.request('after-cancel');
  assert(!pending.has('/api/v1/never-send'),'Cancelled work remains skipped when the queue drains');

  // Keep cancellation available while downloading/decoding a response body.
  context.fetch=async(url,{signal})=>({ok:true,text:()=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  const graph=context.api.graphHtml('a');
  const graphRejected=aborted(graph);
  await tick();
  assert.equal(context.activity.requests.size,1,'Graph body consumption remains visible and cancellable');
  nodes.get('studio-activity-cancel').onclick();
  await graphRejected;

  context.fetch=(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  const upload=context.api.upload('upload-id','page.md','contents');
  const uploadRejected=aborted(upload);
  await tick();
  [...context.activity.requests][0].cancel();
  await uploadRejected;
  assert.equal(banner.hidden,true,'Cancelled uploads clear activity');

  const controller=new AbortController();
  controller.abort();
  await aborted(context.api.request('already-cancelled','GET',undefined,{signal:controller.signal}));
  context.fetch=originalFetch;
  await context.api.request('final');
  assert.equal(context.activity.requests.size,0);
  console.log('PASS: serialized requests, bounded retries, queued/fetch/body/upload cancellation and queue recovery');
})().catch(error=>{console.error(error);process.exitCode=1;});
