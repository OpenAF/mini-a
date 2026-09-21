// Focused completion checks: node tests/webStreamCompletion.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '../public/index.md'), 'utf8');
const start = page.indexOf('                // Only update content if it has actually changed');
const end = page.indexOf('                    // Force close and hide plan panel', start);
assert.ok(start >= 0 && end > start);
// Run the actual polling path through rendering and local history persistence.
const polling = '(async () => {\n' + page.slice(start, end) + '\n}\n})()';

async function check({ status = 'finished', streaming = true, stale = false, preview }) {
  const content = '# Answer\n\nFirst passage.\n\nAdditional context.\n\nLast passage.';
  const renders = [];
  const saved = [];
  const context = vm.createContext({
    data: { status, content }, lastRawContent: 'Previous transcript',
    streamActive: streaming, streamBuffer: preview, conversationFinished: false,
    lastSubmittedPrompt: 'Explain', promptAcknowledged: !stale,
    sawNonFinishedForActiveSubmission: false, currentSessionUuid: 'session',
    historyEnabled: true, activeHistoryId: null, lastFinishedPrompt: '',
    activeSubmissionStartedAt: 1,
    ensurePromptVisibleUntilAcknowledged: value => value,
    normalizePromptForComparison: value => value,
    mergeFinalContentWithStream: (base, stream) => {
      assert.notEqual(status, 'finished', 'Completed content must bypass preview merging');
      return base + stream;
    },
    renderRawContent: async value => { renders.push(value); },
    addConversationToHistory: (uuid, prompt, data) => { saved.push(data.content); return { id: uuid }; },
    setPlanningMode: () => {}, removePreview: () => {}, addPreview: () => {},
    scheduleImmediatePoll: () => {}
  });
  context.stopStream = () => { context.streamActive = false; context.streamBuffer = ''; };
  await vm.runInContext(polling, context);
  if (stale) {
    assert.deepEqual(renders, []);
    assert.deepEqual(saved, []);
    assert.equal(context.streamBuffer, preview, 'A stale result must preserve the current preview');
  } else if (status === 'finished') {
    assert.deepEqual(renders, [content], 'Render only the authoritative answer, without a duplicate flash');
    assert.deepEqual(saved, [content], 'Save only the authoritative answer');
    assert.equal(context.lastRawContent, content);
    assert.equal(context.streamBuffer, '');
    assert.equal(context.streamActive, false);
  } else {
    assert.deepEqual(renders, [content + preview], 'In-progress answers retain their stream preview');
    assert.deepEqual(saved, []);
  }
}

(async () => {
  for (const streaming of [true, false]) {
    for (const preview of ['# Answer\n\nFirst passage.\n\nLast passage.', 'Different wording', '']) {
      await check({ streaming, preview });
    }
  }
  await check({ stale: true, preview: 'Current answer' });
  await check({ status: 'processing', preview: 'Partial answer' });
  console.log('Web stream completion checks passed (rendering, history, stale results, preview).');
})().catch(error => { console.error(error); process.exitCode = 1; });
