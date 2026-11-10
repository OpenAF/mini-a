// Browser-only export lifecycle and strict SVG policy regression checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/index.md'), 'utf8');
function element(tag) {
  return { tag, style: {}, children: [], attributes: [], listeners: {},
    insertBefore(n) { this.children.unshift(n); },
    appendChild(n) { this.children.push(n); },
    querySelector(selector) { for (const child of this.children) { if (selector === 'img' ? child.tag === 'img' : child.className === selector.slice(1)) return child; const match = child.querySelector(selector); if (match) return match; } },
    getBoundingClientRect() { return { width: 200 }; },
    setAttribute(name, value) { this.attributes.push({name,value}); },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    contains(node) { return node === this || this.children.includes(node); },
    focus() { this.focused = true; },
    click() { this.clicked = true; }, remove() { this.removed = true; }
  };
}
let blob, revoked, timer;
const body = element('body');
const ctx = vm.createContext({document:{body,createElement:element,addEventListener(){}}, Blob,
  URL:{createObjectURL(b){blob=b;return 'blob:svg';},revokeObjectURL(u){revoked=u;}},
  setTimeout(fn){timer=fn;}
});
vm.runInContext(source.slice(source.indexOf('    function addSvgDownloadControl('), source.indexOf('    function sanitizeSvgContent(')), ctx);
const wrapper = element('div');
const picture = element('img'); wrapper.appendChild(picture);
const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Olá</text></svg>';
ctx.addSvgDownloadControl(wrapper,safe);
ctx.addSvgDownloadControl(wrapper,safe);
assert.equal(wrapper.children.length,3,'Rerenders do not duplicate controls');
const menu = wrapper.children[1];
menu.open = true;
menu.listeners.focusout({relatedTarget: null});
assert.equal(menu.open, true, 'Safari blur leaves the action available for its pending click');
menu.listeners.focusout({relatedTarget: body});
assert.equal(menu.open, false);
const toolbar=wrapper.children[1].children[1];
const [smaller, larger, reset, button, png, fullscreen] = toolbar.children;
for (const action of toolbar.children) assert.match(action.innerHTML, /class="diagram-action-icon"/);
let fullscreenArgs;
ctx.DOMParser = class { parseFromString(text) {
  assert.equal(text, safe);
  return {documentElement: {getAttribute(name) { return name === 'viewBox' ? '0 0 10 10' : null; }}};
}};
ctx.openMermaidFullscreen = (...args) => { fullscreenArgs = args; };
fullscreen.listeners.click();
assert.equal(fullscreenArgs[3], safe, 'Full screen receives the exact sanitized SVG');
assert.equal(fullscreenArgs[1], '0 0 10 10');
assert.equal(wrapper.children[1].open, false);
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
  let canvas, failLoad = false, failEncode = false;
  ctx.Image = class {
    constructor() { this.naturalWidth = 400; this.naturalHeight = 200; }
    set src(value) { failLoad ? this.onerror() : this.onload(); }
  };
  ctx.document.createElement = tag => {
    const node = element(tag);
    if (tag === 'canvas') {
      canvas = node;
      node.getContext = () => ({drawImage(...args) { node.drawArgs = args; }});
      node.toBlob = callback => callback(failEncode ? null : new Blob(['png'], {type: 'image/png'}));
    }
    return node;
  };
  await png.listeners.click();
  assert.equal(canvas.width, 800); assert.equal(canvas.height, 400);
  assert.equal(blob.type, 'image/png');
  assert.equal(body.children.at(-1).download, 'diagram.png');
  assert.equal(png.disabled, false);
  assert.equal(wrapper.children.at(-1).textContent, '');
  failLoad = true;
  await png.listeners.click();
  assert.match(wrapper.children.at(-1).textContent, /PNG export failed/);
  assert.equal(png.disabled, false);
  failLoad = false; failEncode = true;
  await png.listeners.click();
  assert.match(wrapper.children.at(-1).textContent, /PNG export failed/);
  failEncode = false;
  ctx.Image = class {
    constructor() { this.naturalWidth = 20000; this.naturalHeight = 10000; }
    set src(value) { this.onload(); }
  };
  await png.listeners.click();
  assert.ok(canvas.width <= 8192 && canvas.height <= 8192);
  assert.ok(canvas.width * canvas.height <= 16785000);
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
  assert.equal(wrapper.children[1].tag, 'details');
  assert.equal(wrapper.children[1].children[0].tag, 'summary');
  assert.ok(source.includes('body.markdown-body-dark .svg-rendered-block { --svg-control-bg: #252b36'));
  assert.ok(source.includes('.svg-image-stage img { margin-inline: auto; }'));
  const advanced=fs.readFileSync(require('node:path').join(__dirname,'../public/advanced.js'),'utf8');
  assert.ok(advanced.includes('bridge.renderSvgBlocks(node)'));
  console.log('SVG export lifecycle, Unicode, strict policy and shared-view checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
