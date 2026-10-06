// Passive Markdown and editor behavior fixtures. Real-browser layout is checked separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source=fs.readFileSync('public/advanced.js','utf8');
const elements=[];
function node(tag,text='') {
  return {tag,tagName:tag.toUpperCase(),textContent:text,children:[],attributes:[],
    append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes},
    setAttribute(name,value){this.attributes.push({name,value})},
    removeAttribute(name){this.attributes=this.attributes.filter(a=>a.name!==name)},
    replaceWith(value){this.replacement=value},focus(){this.focused=true},
    querySelectorAll(){return []},querySelector(){return this.children.find(n=>n.tag==='textarea'||n.tag==='button')},
    showModal(){this.open=true},close(){this.open=false},
  };
}
function input(tag, attrs={}, text='') {const n=node(tag,text);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));elements.push(n);return n}
const script=input('script',{},'attack()');
const image=input('img',{src:'https://example.invalid/tracker',onerror:'attack()'});
const badLink=input('a',{href:'javascript:attack()',onclick:'attack()'},'unsafe');
const goodLink=input('a',{href:'https://example.invalid/path',target:'_top',style:'color:red'},'safe');
const code=input('code',{class:'language-mermaid',onclick:'attack()'},'graph TD; A-->B');
const codeInjection=input('code',{class:'language-mermaid extra'},'code');
const frame=input('iframe',{srcdoc:'<script>attack()</script>'});
const svg=input('svg',{onload:'attack()'});
const template={content:{querySelectorAll:()=>elements}};
const requests=[];
const ctx=vm.createContext({
  el:node, button:(text,onclick)=>Object.assign(node('button',text),{onclick}),
  bridge:{uuid:()=> 'reader-session',renderMarkdown:text=>text},window:{MiniADataEditor:{bind(){throw Error('Goal/wiki editor is not a data editor')}}},
  document:{createElement:()=>template,createTextNode:text=>({tag:'text',textContent:text}),body:{classList:{contains:()=>false}}},
  api:async data=>{requests.push(data);return {}},dialog:node('dialog'),dialogId:null,
});
vm.runInContext(source.slice(source.indexOf('  function markdown('),source.indexOf('  function reader(')),ctx);
ctx.markdown('<script>attack()</script>');
assert.equal(script.replacement.tag,'text');assert.equal(image.replacement.tag,'text');assert.equal(frame.replacement.tag,'text');assert.equal(svg.replacement.tag,'text');
assert.deepEqual(badLink.attributes,[{name:'rel',value:'noopener noreferrer'}]);
assert.deepEqual(goodLink.attributes,[{name:'href',value:'https://example.invalid/path'},{name:'rel',value:'noopener noreferrer'}]);
assert.deepEqual(code.attributes,[{name:'class',value:'language-mermaid'}]);assert.equal(codeInjection.attributes.length,0);
vm.runInContext(source.slice(source.indexOf('  function showDialog('),source.indexOf('  function commandForm(')),ctx);
(async()=>{
  ctx.showDialog({id:'edit',type:'editor',label:'Edit goal',value:'old\ngoal'});
  const field=ctx.dialog.children.find(n=>n.tag==='textarea');assert.equal(field.value,'old\ngoal');assert.ok(field.focused);assert.ok(ctx.dialog.open);
  field.value='new\ngoal';await ctx.dialog.children.find(n=>n.textContent==='Submit goal').onclick();
  assert.equal(requests[0].action,'reply');assert.equal(requests[0].answer,'new\ngoal');assert.equal(ctx.dialog.open,false);
  ctx.showDialog({id:'wiki',type:'wiki-editor',label:'Write page',value:''});
  assert.ok(ctx.dialog.children.some(n=>n.textContent==='Write page'));assert.ok(ctx.dialog.children.some(n=>n.textContent==='Preview'));
  await ctx.dialog.children.find(n=>n.textContent==='Cancel operation').onclick();assert.equal(requests[1].action,'stop');
  console.log('Advanced reader/editor fixtures passed: passive markup, unsafe links/attributes, goal submission, focus, preview and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1});
