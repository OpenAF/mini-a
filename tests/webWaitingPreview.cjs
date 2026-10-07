// The waiting preview must follow prompt processing, not transcript polling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('public/index.md', 'utf8');
const previewSource = page.slice(page.indexOf('    function addPreview() {'), page.indexOf('    function getPlannerPreviewText() {'));
const trackSource = 'data => {' + page.match(/trackRun: data => \{([\s\S]*?)\n            \},/)[1] + '\n}';
let preview = null;
const context = vm.createContext({
  isProcessing: false, PREVIEW_ID:'waiting', currentSessionUuid:'session', streamEnabled:false,
  document:{getElementById:()=>preview, createElement:()=>({appendChild(){},remove(){preview=null;}})},
  resultsDiv:{appendChild:element=>{preview=element;}},
  syncPreviewText(){},scrollResultsToBottom(){},startPolling(){},pollOnce(){},
  startStream(){},lastSubmittedPrompt:'',activeSubmissionStartedAt:0,sawNonFinishedForActiveSubmission:false
});
vm.runInContext(previewSource, context);
context.startProcessing = () => { context.isProcessing=true; context.addPreview(); };
context.stopProcessing = () => { context.isProcessing=false; context.removePreview(); };
const track = vm.runInContext('(' + trackSource + ')', context);
// Advanced's initial transcript refresh may return a non-finished, empty result.
track({busy:false}); context.addPreview();
assert.equal(preview,null,'new conversation stays idle');
track({busy:true,kind:'command'}); context.addPreview();
assert.equal(preview,null,'settings and slash commands do not show LLM waiting');
track({busy:true,kind:'prompt'});
assert.ok(preview,'submitted prompt displays waiting feedback');
track({busy:false,kind:'prompt'});
assert.equal(preview,null,'completion removes waiting feedback');
context.addPreview();
assert.equal(preview,null,'late poll or planner callback cannot restore idle preview');
context.startProcessing();
assert.ok(preview,'Simple mode retains its normal waiting preview');
context.stopProcessing(); context.addPreview();
assert.equal(preview,null,'stopped work stays idle');
console.log('Waiting preview checks passed: new session, commands, active prompt, completion, late callbacks and Simple mode.');
