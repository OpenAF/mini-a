// Browser-only export lifecycle and strict SVG policy regression checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.md'), 'utf8');
function element(tag) {
  return { tag, style: {}, children: [], attributes: [], listeners: {},
    appendChild(n) { this.children.push(n); },
    querySelector(selector) { for (const child of this.children) { if (selector === 'img' ? child.tag === 'img' : child.className === selector.slice(1)) return child; const match = child.querySelector(selector); if (match) return match; } },
    getBoundingClientRect() { return { width: 200 }; },
    setAttribute(name, value) { this.attributes.push({name,value}); },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    click() { this.clicked = true; }, remove() { this.removed = true; }
  };
}
let blob, revoked, timer;
const body = element('body');
const ctx = vm.createContext({document:{body,createElement:element}, Blob,
  URL:{createObjectURL(b){blob=b;return 'blob:svg';},revokeObjectURL(u){revoked=u;}},
  setTimeout(fn){timer=fn;}
});
vm.runInContext(source.slice(source.indexOf('    function addSvgDownloadControl('), source.indexOf('    function sanitizeSvgContent(')), ctx);
const wrapper = element('div');
const picture = element('img'); wrapper.appendChild(picture);
const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Olá</text></svg>';
ctx.addSvgDownloadControl(wrapper,safe);
ctx.addSvgDownloadControl(wrapper,safe);
assert.equal(wrapper.children.length,2,'Rerenders do not duplicate controls');
const toolbar=wrapper.children[1];
const button=toolbar.children[0];
const [smaller, larger, reset] = toolbar.children.slice(1);
larger.listeners.click(); assert.equal(picture.style.width, '250px');
for (let i=0;i<20;i++) larger.listeners.click();
assert.equal(picture.style.width,'600px'); assert.equal(larger.disabled,true);
for (let i=0;i<20;i++) smaller.listeners.click();
assert.equal(picture.style.width,'50px'); assert.equal(smaller.disabled,true);
reset.listeners.click(); assert.equal(picture.style.width,''); assert.equal(picture.style.maxWidth,'100%');
assert.equal(smaller.disabled,false); assert.equal(larger.disabled,false);
assert.equal(button.attributes.find(a=>a.name==='aria-label').value,'Download SVG');
button.listeners.click();
assert.equal(blob.type,'image/svg+xml;charset=utf-8');
const link=body.children[0];
assert.equal(link.download,'diagram.svg');assert.equal(link.href,'blob:svg');
assert.ok(link.clicked && link.removed);assert.equal(revoked,undefined);timer();assert.equal(revoked,'blob:svg');
(async()=>{
  assert.equal(await blob.text(),safe,'Export uses the exact sanitized preview, including Unicode and dimensions');
  // Supply parsed XML nodes to exercise policy after the compatibility preprocessor.
  const attr=(name,value)=>({name,localName:name.split(':').pop(),value});
  function parsed(attributes=[], children=[]) {
    const node={localName:'svg',namespaceURI:'http://www.w3.org/2000/svg',attributes,
      querySelectorAll:()=>children,removeAttributeNode(a){this.attributes=this.attributes.filter(x=>x!==a)},
      setAttribute(name,value){this.attributes.push(attr(name,value))}};
    return {documentElement:node,querySelector:()=>null};
  }
  let doc;
  ctx.DOMParser=class{parseFromString(){return doc}};
  ctx.XMLSerializer=class{serializeToString(){return '<svg/>'}};
  vm.runInContext(source.slice(source.indexOf('    function sanitizeSvgContent('),source.indexOf('    function validateSvgXmlContent(')),ctx);
  doc=parsed([attr('fill','url(https://attacker.invalid/x)')]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'');
  doc=parsed([attr('href','https://attacker.invalid/x')]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'');
  doc=parsed([attr('fill','url(#gradient)')]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'<svg/>');
  doc=parsed([attr('style','fill:red;font-size:12px')]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'<svg/>');
  assert.ok(doc.documentElement.attributes.some(a=>a.name==='fill'&&a.value==='red'));
  doc=parsed([attr('style','fill:u\\72l(https://attacker.invalid)')]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'');
  doc=parsed([], [{localName:'animate',namespaceURI:'http://www.w3.org/2000/svg',attributes:[]}]);assert.equal(ctx.sanitizeSvgContent('<svg/>'),'');
  assert.equal(ctx.sanitizeSvgContent('<!DOCTYPE svg><svg/>'),'');
  assert.equal(ctx.sanitizeSvgContent('<?xml-stylesheet href="https://attacker.invalid"?><svg/>'),'');
  assert.ok(source.includes('.svg-rendered-block:focus-within .svg-controls'));
  assert.ok(source.includes('@media (hover: none)'));
  assert.ok(source.includes('body.markdown-body-dark .svg-rendered-block { --svg-control-bg: #252b36'));
  assert.ok(source.includes('.svg-image-stage img { margin-inline: auto; }'));
  const advanced=fs.readFileSync(require('node:path').join(__dirname,'../public/advanced.js'),'utf8');
  assert.ok(advanced.includes('bridge.renderSvgBlocks(node)'));
  console.log('SVG export lifecycle, Unicode, strict policy and shared-view checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
