// Browser input rendering and submissions; layout is verified separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
function all(node) { return [node, ...node.children.flatMap(all)]; }
function el(tag, text, className) {
  return { tag, textContent:text || '', className, children:[], style:{}, value:'', checked:false,
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children=items; },
    setAttribute(key, value) { this[key]=value; }, focus() { this.focused=true; },
    querySelector(selector) { return all(this).slice(1).find(n => selector[0]==='.' ? n.className===selector.slice(1) : selector.split(',').includes(n.tag)); },
    showModal() { this.open=true; }, close() { this.open=false; },
    requestSubmit() { return this.onsubmit({preventDefault(){}}); }
  };
}
let current='session-a', requests=[], fail=false;
const ctx=vm.createContext({el, button:(text, onclick)=>Object.assign(el('button',text),{onclick}),
  asText:String, bridge:{uuid:()=>current}, dialog:el('dialog'), dialogId:null,
  api:async data=>{requests.push(data);if(fail)throw Error('Retry this reply');return {};},
  window:{MiniADataEditor:{bind(){throw Error('Input fields must not open data editor');}}}
});
vm.runInContext(source.slice(source.indexOf('  function showDialog('),source.indexOf('  function commandForm(')),ctx);
const fields=[
  {type:'text',label:'Text',choices:[]}, {type:'password',label:'Secret',choices:[]},
  {type:'choose',label:'Choose',choices:['<script>','B'],descriptions:['First','Second'],max:1},
  {type:'multiple',label:'Many',choices:['A','B']}, {type:'char',label:'Char',choices:['y','n']}
];
(async()=>{
  ctx.showDialog({id:'input',type:'input',label:'Input requested',choices:fields});
  const form=ctx.dialog.children[1];
  const controls=all(form).filter(n=>['input','textarea'].includes(n.tag));
  assert.equal(controls[0].focused,true);assert.equal(controls[1].type,'password');
  assert.equal(controls[1].autocomplete,'off');
  assert.ok(all(form).some(n=>n.textContent==='<script>'),'Option text stays text');
  assert.ok(all(form).some(n=>n.tag==='small' && n.textContent==='Second'));
  await form.requestSubmit();assert.equal(requests.length,0,'Unselected required choice stays open');
  controls[0].value='multi\nline';controls[1].value='private';controls[3].checked=true;
  controls[4].checked=true;controls[5].checked=true;controls[7].checked=true;
  fail=true;await form.requestSubmit();assert.equal(ctx.dialog.open,true);assert.equal(controls[0].value,'multi\nline');
  assert.equal(form.children.at(-2).textContent,'Retry this reply');
  assert.equal(form.children.at(-1).disabled,false);
  fail=false;await form.requestSubmit();assert.equal(ctx.dialog.open,false);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).answer)),['multi\nline','private',1,[0,1],1]);
  ctx.showDialog({id:'stale',type:'input',label:'Old',choices:[fields[0]]});
  const stale=ctx.dialog.children[1];current='session-b';const before=requests.length;
  await stale.requestSubmit();assert.equal(requests.length,before,'Old dialog cannot reply to another session');
  console.log('Advanced browser input fixtures passed: controls, grouped replies, validation, retry and session isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
