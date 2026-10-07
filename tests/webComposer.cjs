// Shared composer behavior with the actual page functions; browser layout checked separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('public/index.md', 'utf8');
const advanced = fs.readFileSync('public/advanced.js', 'utf8');
const elements = {};
function element(id) {
  return elements[id] = {value:'draft\ntext', selectionStart:2, selectionEnd:5, selectionDirection:'backward', scrollTop:12,
    style:{setProperty(k,v){this[k]=v}}, attributes:{}, listeners:{}, open:false,
    setAttribute(k,v){this.attributes[k]=v}, addEventListener(k,fn){this.listeners[k]=fn},
    before(anchor){this.anchor=anchor}, append(child){child.parent=this}, replaceWith(child){child.parent='original'},
    focus(){this.focused=true}, setSelectionRange(a,b,c){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=c},
    dispatchEvent(){}, showModal(){this.open=true}, close(){this.open=false}};
}
['composerDialog','expandPromptBtn','inputSection','composerNotice'].forEach(element);
const input = element('promptInput');
let submissions=0, resized=0, confirmed=false;
const context = vm.createContext({
  document:{getElementById:id=>elements[id],createComment:()=>element('anchor'),body:{style:{overflow:'auto'}}},
  window:{innerWidth:390,innerHeight:700,addEventListener(){},confirm:()=>confirmed,
    visualViewport:{width:390,height:400,offsetTop:15,offsetLeft:0,addEventListener(){}}},
  promptInput:input, composerDialog:elements.composerDialog, Event:class {}, autoResizeTextarea:()=>resized++, handleSubmit:()=>submissions++,
});
vm.runInContext(page.slice(page.indexOf('    // Shared composer:'),page.indexOf('    function autoResizeTextarea()')),context);
context.setComposerExpanded(true);
assert.equal(input.value,'draft\ntext');
assert.equal(elements.inputSection.parent,elements.composerDialog);
assert.equal(elements.composerDialog.style['--composer-height'],'400px');
assert.equal(elements.composerDialog.style['--composer-top'],'15px');
assert.equal(elements.expandPromptBtn.attributes['aria-expanded'],'true');
assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(input.scrollTop,12);
context.setComposerExpanded(false);
assert.equal(elements.inputSection.parent,'original');assert.equal(context.document.body.style.overflow,'auto');
assert.equal(input.value,'draft\ntext');assert.equal(resized,1);
assert.equal(context.openComposer('history goal'),false);assert.equal(input.value,'draft\ntext');
confirmed=true;assert.equal(context.openComposer('history goal'),true);assert.equal(input.value,'history goal');
let prevented=0,stopped=0;
elements.composerDialog.listeners.keydown({key:'Escape',preventDefault(){prevented++},stopPropagation(){stopped++}});
assert.equal(context.composerExpanded(),false);assert.equal(prevented,1);assert.equal(stopped,1);
context.openComposer();elements.composerDialog.listeners.cancel({preventDefault(){}});
assert.equal(context.composerExpanded(),false);
input.disabled=true;assert.equal(context.openComposer('replacement'),false);assert.equal(input.value,'history goal');input.disabled=false;
const keyStart=page.indexOf("        promptInput.addEventListener('keydown', (e) => {");
vm.runInContext(page.slice(keyStart,page.indexOf('\n        });',keyStart)+12),context);
function key(extra={}){let prevented=false;input.listeners.keydown({key:'Enter',preventDefault(){prevented=true},...extra});return prevented;}
assert.equal(key(),true);assert.equal(submissions,1);
assert.equal(key({shiftKey:true}),false);
context.openComposer();assert.equal(key(),false);assert.equal(submissions,1);
assert.equal(key({ctrlKey:true}),true);assert.equal(key({metaKey:true}),true);assert.equal(submissions,3);
assert.equal(key({isComposing:true,ctrlKey:true}),false);assert.equal(key({keyCode:229,ctrlKey:true}),false);
input.disabled=true;assert.equal(key({ctrlKey:true}),false);input.disabled=false;
// Exercise actual submit branches with transport fixtures, without any model requests.
const submitSource=page.slice(page.indexOf('    async function handleSubmit()'),page.indexOf('    async function pollOnce()'));
Object.assign(context, {
  isProcessing:false, attachmentsEnabled:true,attachments:[{binary:true,name:'test.png',mediaType:'image/png',base64:'fixture'}],
  advancedUI:null, currentSessionUuid:'fixture',activeHistoryId:null,lastRawContent:'',lastSubmittedPrompt:'',lastFinishedPrompt:'',
  activeSubmissionStartedAt:0,sawNonFinishedForActiveSubmission:false,lastRenderedRaw:'',streamEnabled:false,
  buildPromptWithAttachments:value=>value,buildAttachmentDisplayPrompt:value=>value,buildOptimisticUserPromptBlock:()=>'<p>draft</p>',
  renderRawContent:async()=>{},updateResultsContent:async()=>{},forceRenderChartBlocks(){},startPolling(){},
  collectBrowserContext:()=>null,lastKnownHistory:[],resolveAppUrl:value=>value,escapeHtml:value=>value,
  clearAttachments(){},notifyAttachmentWarning(){},console:{error(){}},alert(){},
  startProcessing(){input.value='';input.disabled=true},
});
vm.runInContext(submitSource,context);
(async()=>{
  input.value='draft';context.fetch=async()=>({ok:true,json:async()=>({busy:true})});
  await context.handleSubmit();assert.equal(context.composerExpanded(),true);assert.equal(input.value,'draft');
  context.fetch=async()=>({ok:false});await context.handleSubmit();assert.equal(context.composerExpanded(),true);assert.equal(input.value,'draft');
  input.value='';await context.handleSubmit();assert.equal(context.composerExpanded(),true);assert.match(elements.composerNotice.textContent,/question/);
  input.value='draft';context.fetch=async()=>({ok:true,json:async()=>({})});await context.handleSubmit();assert.equal(context.composerExpanded(),false);assert.equal(input.value,'');
  input.disabled=false;input.value='advanced draft';context.openComposer();
  context.advancedUI={enabled:()=>true,submit:async()=>{throw Error('busy')}};
  await context.handleSubmit();assert.equal(context.composerExpanded(),true);assert.equal(input.value,'advanced draft');
  context.advancedUI.submit=async()=>{input.value=''};await context.handleSubmit();assert.equal(context.composerExpanded(),false);
  assert.match(advanced,/if\(!enabled \|\| e.isComposing \|\| bridge.composerExpanded\(\)\)return/);
  assert.doesNotMatch(advanced,/function goalEditor|\['editor', 'Goal editor'/);
  // Parse all inline scripts to catch integration syntax errors.
  for(const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script('(async function() {\n' + match[1] + '\n})');
  console.log('Composer: draft, selection, focus, viewport, history replacement, keyboard, IME, validation, busy/failure and accepted submission checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
