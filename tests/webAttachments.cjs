const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = vm.createContext({global:{__useattach:true},__ : undefined,
  isDef:x=>x!=null,isUnDef:x=>x==null,isArray:Array.isArray,isString:x=>typeof x==='string',isMap:x=>x!=null&&typeof x==='object'&&!Array.isArray(x)});
vm.runInContext(fs.readFileSync('mini-a-web-attachments.js','utf8'),c);
const a = c.MiniAWebAttachments;
const upload = {name:'picture.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')};
assert.equal(a.validate([upload],'Inspect')[0].size,8);
assert.equal(a.validate([{...upload,name:'../evil.png'}],'Inspect')[0].name,'.._evil.png');
assert.equal(a.signature([137,80,78,71,13,10,26,10],'png'),true);
assert.equal(a.signature([255,216,255],'png'),false);
for (const [items,prompt,pattern] of [
  [[upload],'',/prompt/], [[upload,upload,upload,upload,upload],'Read',/four/],
  [[{...upload,name:'x.exe'}],'Read',/unsupported/], [[{...upload,base64:'%%%%'}],'Read',/base64/],
  [[{...upload,base64:'AA=A'}],'Read',/base64/], [[{...upload,base64:'AAA'}],'Read',/base64/],
  [[{...upload,base64:'AAAA'.repeat(4*1024*1024)}],'Read',/oversized/]
]) assert.throws(()=>a.validate(items,prompt),pattern);
c.global.__useattach=false;
assert.throws(()=>a.validate([upload],'Read'),/disabled/);
assert.equal(a.validate(undefined,'Read').length,0);
c.global.__useattach=true;
const large = {name:'report.pdf',base64:'AAAA'.repeat(3*1024*1024)};
assert.throws(()=>a.validate([large,large,large],'Read'),/combined/);

// Execute the shared prompt builder to keep binary content separate from text.
const page = fs.readFileSync('public/index.md','utf8');
function fn(name) {
  const start = page.indexOf('    function '+name+'(');
  const end = page.indexOf('\n    function ',start+1);
  return page.slice(start,end);
}
vm.runInContext(fn('sanitizeAttachmentName'),c);
vm.runInContext(fn('buildPromptWithAttachments'),c);
const text = c.buildPromptWithAttachments('Question',[{name:'a.txt',content:'text'},{...upload,binary:true}]);
assert.match(text,/a.txt/);assert.doesNotMatch(text,/picture.png|iVBOR/);
console.log('Web attachment payload and prompt checks passed.');

// Exercise actual browser submission logic for acceptance and rejection in both modes.
const submitStart = page.indexOf('    async function handleSubmit()');
const submitEnd = page.indexOf('    async function pollOnce()',submitStart);
async function browser(advanced, response) {
  let sent, cleared=0, started=0, warning, optimistic;
  const b = vm.createContext({
    isProcessing:false,attachmentsEnabled:true,attachments:[{...upload,binary:true},{name:'notes.txt',content:'notes'}],
    promptInput:{value:'Inspect'},advancedUI:advanced?{enabled:()=>true,submit:async(prompt,attachments)=>{sent={prompt,attachments};if(response.error)throw Error(response.error);}}:null,
    currentSessionUuid:'session',lastRawContent:'',lastKnownHistory:[],lastSubmittedPrompt:'',lastFinishedPrompt:'',activeHistoryId:null,
    activeSubmissionStartedAt:0,sawNonFinishedForActiveSubmission:false,lastRenderedRaw:'',streamEnabled:false,
    notifyAttachmentWarning:message=>{warning=message;},alert:message=>{warning=message;},console:{error(){}},
    clearAttachments:()=>{cleared++;},startProcessing:()=>{started++;cleared++;},startPolling(){},collectBrowserContext:()=>({}),
    buildOptimisticUserPromptBlock:value=>{optimistic=value;return '<user/>';},renderRawContent:async()=>{},forceRenderChartBlocks(){},resolveAppUrl:x=>x,
    fetch:async(url,opts)=>{sent=JSON.parse(opts.body);return {ok:true,json:async()=>response};},
    updateResultsContent:async message=>{warning=message;},escapeHtml:x=>x
  });
  vm.runInContext(fn('sanitizeAttachmentName'),b);vm.runInContext(fn('buildPromptWithAttachments'),b);vm.runInContext(fn('buildAttachmentDisplayPrompt'),b);
  vm.runInContext(page.slice(submitStart,submitEnd),b);
  await b.handleSubmit();
  assert.equal(sent.attachments.length,1);assert.equal(sent.attachments[0].base64,upload.base64);
  assert.match(sent.prompt,/notes.txt/);assert.doesNotMatch(sent.prompt,/iVBOR/);
  if (!advanced) { assert.match(optimistic,/📎 picture.png/);assert.doesNotMatch(optimistic,/iVBOR/); }
  assert.equal(cleared,response.error||response.busy?0:1);
  if (!advanced) assert.equal(started,response.error||response.busy?0:1);
  if (response.error) assert.match(warning,/rejected/);
  b.promptInput.value='';sent=undefined;await b.handleSubmit();assert.equal(sent,undefined);assert.match(warning,/question/);
}
async function historyDisplay() {
  let saved, uploaded;
  Object.assign(c,{window:{},historyEnabled:true,activeHistoryId:null,crypto:undefined,
    loadStoredHistory:()=>[],persistHistory:entries=>{saved=entries[0];},formatHistoryTitle:x=>x,refreshHistoryPanel(){},
    resolveAppUrl:x=>x,fetch:async(url,opts)=>{uploaded=JSON.parse(opts.body);return {ok:true,json:async()=>({})};}
  });
  for (const name of ['sanitizeHistoryEvents','extractFirstUserPromptFromEvents','extractLastUserPromptFromEvents','addConversationToHistory']) vm.runInContext(fn(name),c);
  const start=page.indexOf('    async function sendHistoryToServer(');
  const end=page.indexOf('    async function loadConversationEntry(',start);
  vm.runInContext(page.slice(start,end),c);
  const source={event:'👤',message:'Inspect\nExtracted content',displayMessage:'Inspect\n\n📎 picture.png'};
  const events=c.sanitizeHistoryEvents([source,{event:'final',message:'Answer'}]);
  assert.equal(events[0].displayMessage,source.displayMessage);
  assert.equal(c.extractLastUserPromptFromEvents(events),source.displayMessage);
  const entry=c.addConversationToHistory('session','Inspect',{history:events,content:'Answer'});
  assert.equal(saved.prompt,source.displayMessage);assert.doesNotMatch(saved.title,/Extracted/);
  assert.match(saved.events[0].message,/Extracted content/);
  await c.sendHistoryToServer(entry);
  assert.equal(uploaded.history[0].displayMessage,source.displayMessage);
  assert.equal(uploaded.history[0].message,source.message);
}
async function picker() {
  const warnings=[];
  Object.assign(c,{attachmentsEnabled:true,attachments:[],MAX_ATTACHMENT_SIZE:512*1024,TEXT_FILE_EXTENSIONS:new Set(['txt']),
    notifyAttachmentWarning:message=>warnings.push(message),renderAttachments(){},detectAttachmentLanguage:()=> 'text',
    FileReader:class {readAsDataURL(file){this.result='data:image/png;base64,'+file.base64;this.onload();}}
  });
  vm.runInContext(fn('isAllowedTextFile'),c);
  const start=page.indexOf('    async function handleFileInputChange(');
  const end=page.indexOf('    function handleAttachClick(',start);
  vm.runInContext(page.slice(start,end),c);
  vm.runInContext(fn('removeAttachment'),c);
  const event={target:{value:'selected',files:[{name:'image.png',size:8,type:'image/png',base64:upload.base64},{name:'notes.txt',size:5,type:'text/plain',text:async()=> 'notes'}]}};
  await c.handleFileInputChange(event);
  assert.equal(c.attachments.length,2);assert.equal(c.attachments[0].binary,true);assert.equal(c.attachments[1].content,'notes');
  assert.equal(event.target.value,'');c.removeAttachment(c.attachments[0].id);assert.equal(c.attachments.length,1);
  await c.handleFileInputChange({target:{files:[{name:'large.png',size:11*1024*1024,type:'image/png'},{name:'bad.exe',size:5,type:'application/octet-stream'}]}});
  assert.equal(c.attachments.length,1);assert.equal(warnings.length,2);
}
(async()=>{
  await picker();
  await historyDisplay();
  await browser(false,{uuid:'session'});await browser(false,{error:'rejected'});await browser(false,{busy:true});
  await browser(true,{accepted:true});await browser(true,{error:'rejected'});
  console.log('Simple and Advanced browser submission checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
