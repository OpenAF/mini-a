// Advanced's real Markdown conversion must reach the isolated diagram renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const showdown = require('../public/showdown.min.js');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const converter = new showdown.Converter({ghCodeBlocks:true});
const all = node => [node, ...(node.children || []).flatMap(all)];
function element(tag, text = '', className) {
  return {tagName:tag.toUpperCase(), textContent:text, className, attributes:[], children:[], isConnected:true,
    append(...nodes) { nodes.forEach(n => { this.children.push(n); n.parentElement = this; }); },
    setAttribute(name,value) { const a=this.attributes.find(a=>a.name===name); if(a)a.value=value; else this.attributes.push({name,value}); },
    removeAttribute(name) { this.attributes=this.attributes.filter(a=>a.name!==name); },
    querySelectorAll(selector) { return all(this).slice(1).filter(n=>selector==='*'||(n.tagName==='CODE'&&n.attributes.some(a=>a.name==='class'&&a.value==='language-mermaid'))); },
    after(node) { this.parentElement.append(node); },
    replaceWith() { throw Error('Unexpected markup in this fixture'); }
  };
}
const templates=[];
let renderCalls=[], previewCalls=[], rejectRender=false, pauseRender;
const context=vm.createContext({
  el:element,
  document:{body:{classList:{contains:()=>false}},createTextNode:text=>element('text',text),createElement(tag) {
    assert.equal(tag,'template'); const content=element('fragment'); templates.push(content);
    return {content,set innerHTML(html) {
      // Parse the actual fenced-code markup emitted by the bundled Showdown.
      const match=html.match(/<pre><code class="([^"]+)">([\s\S]*?)<\/code><\/pre>/);
      assert.ok(match,html); const pre=element('pre'),code=element('code',match[2]);
      code.setAttribute('class',match[1]);pre.append(code);content.append(pre);
    }};
  }},
  bridge:{renderMarkdown:text=>converter.makeHtml(text),newRequestId:()=> 'test-diagram',
    renderMermaidPreview:(node,svg)=>previewCalls.push({node,svg})},
  window:{mermaid:{initialize(){},async render(id,code) {
    renderCalls.push({id,code}); if(rejectRender)throw Error('Invalid Mermaid');
    if(pauseRender)await pauseRender;
    return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>'};
  }}}
});
vm.runInContext(source.slice(source.indexOf('  function markdown('),source.indexOf('  function reader(')),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const markdown='```mermaid\nflowchart LR\n A-->B\n```';
  const result=context.markdown(markdown);await flush();
  assert.equal(renderCalls.length,1,'Showdown language classes survive sanitization and trigger Mermaid');
  assert.equal(previewCalls.length,1,'Advanced attaches the shared image controls');
  assert.equal(previewCalls[0].node.parentElement,templates[0]);
  assert.ok(all(result).some(n=>n.tagName==='CODE'),'Original source remains readable');
  assert.ok(!all(result).some(n=>n.tagName==='IFRAME'),'Shared previews use image isolation');
  rejectRender=true;context.markdown(markdown);await flush();
  assert.equal(previewCalls.length,1,'Render failure keeps source without a broken preview');
  rejectRender=false;let release;pauseRender=new Promise(resolve=>release=resolve);
  const stale=context.markdown(markdown);await Promise.resolve();stale.isConnected=false;release();await flush();
  assert.equal(previewCalls.length,1,'Detached readers do not receive late diagrams');
  console.log('Advanced Mermaid language normalization, shared preview, failure and stale-render checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
