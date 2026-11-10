// Completion ordering checks: node tests/webAdvancedCompletion.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '../public/index.md'), 'utf8');
const stopStart = page.indexOf('    function stopProcessing(');
const pollStart = page.indexOf('    async function pollOnce(');
const stopSource = page.slice(stopStart, page.indexOf('    /* ========== API FUNCTIONS', stopStart));
const pollSource = page.slice(pollStart, page.indexOf('    function hasVisibleStreamText(', pollStart));
const trackSource = page.match(/trackRun: data => \{([\s\S]*?)\n            \},/)[1];
const answer = '# Answer\n\nThe final answer belongs in the main conversation.';
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(advanced = true) {
  const requests = [], renders = [], saved = [], timers = [];
  const control = { disabled: true, classList: { remove() {} } };
  const context = vm.createContext({
    advancedUI: advanced ? {} : null, currentSessionUuid: 'session', isProcessing: true,
    pollInFlight: false, pollQueued: false, pollingInterval: null, transcriptPollUuid: null, transcriptRevision: null, transcriptContent: "",
    streamActive: true, streamBuffer: 'Partial preview', conversationFinished: false,
    promptInput: control, submitBtn: control, clearBtn: control, attachBtn: null, fileInput: null,
    planPanel: null, attachmentsEnabled: false, console,
    lastRawContent: 'Prompt', lastKnownHistory: [], lastSubmittedPrompt: 'Explain',
    lastFinishedPrompt: '', sawNonFinishedForActiveSubmission: false,
    historyEnabled: true, activeHistoryId: null, activeSubmissionStartedAt: 1, activeSubmissionRunId: 'active-run',
    fetch(url, options) {
      let resolve;
      const pending = new Promise(done => { resolve = done; });
      requests.push({ url, body: JSON.parse(options.body), resolve });
      return pending;
    },
    resolveAppUrl: route => '/' + route,
    sanitizeHistoryEvents: events => events,
    extractLastUserPromptFromEvents: events => events.find(e => e.event === 'user')?.message || '',
    hasServerAcknowledgedPrompt: events => events.some(e => e.event === 'user'),
    normalizePromptForComparison: value => value,
    ensurePromptVisibleUntilAcknowledged: value => value,
    renderRawContent: async value => { renders.push(value); },
    addConversationToHistory: (uuid, prompt, data) => { saved.push({ uuid, content: data.content, history: data.history }); return { id: uuid }; },
    stopStream() { context.streamActive = false; context.streamBuffer = ''; },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setSubmitIcon() {}, setPlanningMode() {}, removePreview() {}, addPreview() {},
    resetSubagentPanel() {}, updateCopyActionsVisibility() {}, forceRenderChartBlocks() {},
    updatePlanPanel() {}, updateSubagentPanel() {}, scheduleImmediatePoll() {}
  });
  vm.runInContext(stopSource + '\n' + pollSource + '\nfunction trackRun(data) {' + trackSource + '\n}', context);
  function finish(request) {
    request.resolve({ ok: true, json: async () => ({
      status: 'finished', content: answer,
      history: [{ event: 'user', message: 'Explain' }, { event: 'final', message: answer }]
    }) });
  }
  return { context, requests, renders, saved, timers, finish };
}

(async () => {
  for (const order of ['advanced-first', 'poll-in-flight', 'result-first']) {
    const f = fixture();
    let pending;
    if (order !== 'advanced-first') pending = f.context.pollOnce();
    if (order === 'result-first') { f.finish(f.requests[0]); await pending; }
    f.context.trackRun({ busy: false, kind: 'prompt' });
    assert.equal(f.context.currentSessionUuid, 'session', 'Completion retains the Advanced session');
    if (order !== 'result-first') {
      assert.equal(f.requests.length, 1, 'Fetch final content even when Advanced completes first');
      assert.equal(f.requests[0].body.uuid, 'session');
      f.finish(f.requests[0]);
      if (pending) await pending;
      await flush();
    }
    assert.equal(f.renders.at(-1), answer, order + ': main pane receives the final answer');
    assert.equal(f.saved.at(-1).content, answer, order + ': history stores the final answer');
    assert.equal(f.context.isProcessing, false);
    assert.equal(f.context.pollInFlight, false);
    assert.equal(f.context.streamBuffer, '');
    // Follow-up polls and queued refreshes remain attached to the same conversation.
    const refresh = f.context.pollOnce();
    assert.equal(f.requests.at(-1).body.uuid, 'session');
    f.finish(f.requests.at(-1)); await refresh;
    assert.equal(f.renders.at(-1), answer);
  }
  const stopped = fixture();
  stopped.context.stopProcessing(true);
  assert.deepEqual(stopped.requests[0].body, { uuid: 'session', request: 'stop' });
  assert.equal(stopped.context.currentSessionUuid, 'session', 'Explicit Stop retains the Advanced conversation');
  const simple = fixture(false);
  simple.context.stopProcessing(false);
  assert.equal(simple.context.currentSessionUuid, null, 'Simple mode retains its existing completion lifecycle');
  await simple.context.pollOnce();
  assert.equal(simple.requests.length, 0);
  const stale = fixture();
  stale.context.activeSubmissionRunId = 'new-run';
  const stalePoll = stale.context.pollOnce();
  stale.requests[0].resolve({ok:true,json:async()=>({status:'finished',runId:'old-run',transcriptRevision:'old',content:'Old answer',history:[{event:'user',message:'Explain'}]})});
  await stalePoll;
  assert.equal(stale.renders.length,0,'Reject a different run even when prompt text matches');
  assert.equal(stale.context.transcriptRevision,null,'Stale runs cannot advance transcript revision');
  const revisions = fixture();
  revisions.context.streamActive = false;
  let poll = revisions.context.pollOnce();
  const history = [{event:'user',message:'Explain'}];
  revisions.requests.at(-1).resolve({ok:true,json:async()=>({status:'processing',runId:'active-run',transcriptRevision:'r1',content:answer,history})});
  await poll;
  poll = revisions.context.pollOnce();
  assert.equal(revisions.requests.at(-1).body.ifTranscriptRevision,'r1');
  revisions.requests.at(-1).resolve({ok:true,json:async()=>({status:'finished',outcome:'success',runId:'active-run',transcriptRevision:'r1'})});
  await poll;
  assert.equal(revisions.saved.at(-1).content,answer);
  assert.deepEqual(revisions.saved.at(-1).history,history,'Unchanged terminal polls retain full history for persistence');
  const retry = fixture(false);
  Object.assign(retry.context, {
    isProcessing:false, lastKnownHistory:history, window:{}, streamEnabled:false,
    captureEmbedContext:()=>null, getCurrentConversationEvents:()=>history,
    removeLastAssistantFromEvents:events=>events, getOrCreateSessionUuid:()=> 'session',
    sendHistoryToServer:async()=>{}, renderRawContent:async()=>{}, forceRenderChartBlocks:()=>{},
    resetPlanPanel:()=>{}, resetSubagentPanel:()=>{}, hljs:{highlightAll(){}},
    fetch:async()=>({ok:true,json:async()=>({uuid:'session',runId:'retry-run'})}),
    startProcessing(){retry.context.startedRun=retry.context.activeSubmissionRunId;}, startPolling(){}
  });
  const retryStart = page.indexOf('    async function handleRetryLastAnswer()');
  const retryEnd = page.indexOf('    function captureActivityDisclosures()',retryStart);
  vm.runInContext(page.slice(retryStart,retryEnd),retry.context);
  await retry.context.handleRetryLastAnswer();
  assert.equal(retry.context.startedRun,'retry-run','Retry binds the newly accepted run before polling');
  console.log('Advanced completion ordering checks passed (final rendering, history, refresh, Stop and Simple mode).');
})().catch(error => { console.error(error); process.exitCode = 1; });
