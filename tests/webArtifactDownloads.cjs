const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../public/index.md'),'utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.connected=true;}
  get isConnected(){return this.connected && (!this.parent||this.parent.isConnected)}
  appendChild(child){this.children.push(child);child.parent=this;return child;}
  setAttribute(k,v){this.attrs[k]=v} getAttribute(k){return this.attrs[k]} removeAttribute(k){delete this.attrs[k]}
  querySelector(selector){return this.children.find(n=>n.className===selector.slice(1))}
  addEventListener(event,fn){this.events[event]=fn}
  remove(){this.connected=false;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  click(){this.clicked=true}
}
const body=new Element('body'),requests=[],timers=[];
let response,blob,revoked;
const ctx=vm.createContext({document:{body,createElement:t=>new Element(t)},Date,JSON,Math,Array,
  resolveAppUrl:p=>'/prefix/'+p,fetch:async(url,init)=>{requests.push({url,init});return response;},
  URL:{createObjectURL:value=>{blob=value;return 'blob:download'},revokeObjectURL:url=>{revoked=url}},
  setTimeout:fn=>timers.push(fn)
});
vm.runInContext(page.slice(page.indexOf('    async function renderGeneratedFiles('),page.indexOf('    setInterval(() => {',page.indexOf('    async function renderGeneratedFiles('))),ctx);
(async()=>{
 const root=new Element('div');
 response={ok:true,json:async()=>({files:[{id:'opaque-id',name:'report.csv',size:14,status:'published',expires:Date.now()+10000},{name:'old.txt',size:3,status:'expired',expires:0}]})};
 await ctx.renderGeneratedFiles(root,'conversation-id');
 const panel=root.children[0];
 assert.equal(panel.children[0].textContent,'Generated files');
 assert.match(panel.children[1].children[0].textContent,/report.csv/);
 assert.equal(panel.children[2].children.length,1,'Expired files have no download action');
 const download=panel.children[1].children[1];
 const payload=new Blob(['safe bytes'],{type:'application/octet-stream'});
 response={ok:true,blob:async()=>payload};
 await download.events.click();
 assert.equal(blob,payload);assert.equal(download.disabled,false);
 assert.equal(body.children.length,0,'Temporary anchor removed');
 assert.equal(revoked,undefined);timers.shift()();assert.equal(revoked,'blob:download');
 assert.equal(requests[1].url,'/prefix/artifacts');
 assert.equal(requests[1].init.method,'POST');
 assert.deepEqual(JSON.parse(requests[1].init.body),{uuid:'conversation-id',id:'opaque-id'});
 assert.ok(!requests.some(r=>r.url.includes('token')||r.url.includes('opaque-id')),'No credentials or capability IDs in URLs');
 response={ok:false};await download.events.click();assert.equal(download.textContent,'Unavailable');
 await ctx.renderGeneratedFiles(root,'conversation-id');assert.equal(root.getAttribute('data-artifact-session'),undefined,'Disabled endpoint stops polling');
 assert.equal(root.children.length,0);
 const advanced=fs.readFileSync(path.join(__dirname,'../public/advanced.js'),'utf8');
 assert.ok(advanced.includes('bridge.renderGeneratedFiles(container, bridge.uuid())'));
 console.log('Artifact UI listing, expiry, explicit binary download, URL hygiene and disabled-mode checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
