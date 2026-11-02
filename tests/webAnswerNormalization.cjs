// node tests/webAnswerNormalization.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '../public/index.md'), 'utf8');
const context = vm.createContext({ normalizeReasoningDisplayLine: line => line });
vm.runInContext(page.slice(page.indexOf('    function tryParseAssistantJson('),
  page.indexOf('    function extractFirstUserPromptFromEvents(')), context);
const normalize = context.normalizeRenderedConversationText;
const olderAnswer = '# Avenger\n\nEarlier answer with a brace } and a "quote".';
const envelope = JSON.stringify({ thought: 'Ready', action: 'final', answer: olderAnswer });
const firstTurn = '<div>First prompt 👤</div>\nResearch commentary.' + envelope;
const followUp = '\n<div>What does it defend against? 👤</div>\nAn Avenger deployed near Mar-a-Lago defends against small drones.';
assert.equal(normalize(firstTurn + followUp),
  '<div>First prompt 👤</div>\nResearch commentary.' + olderAnswer + followUp,
  'Unwrapping an older answer must preserve the follow-up prompt and final answer');
assert.equal(normalize(firstTurn + '\nassistant\n' + JSON.stringify({ action: 'final', answer: 'Second answer' })),
  '<div>First prompt 👤</div>\nResearch commentary.' + olderAnswer + '\nassistant\nSecond answer',
  'Multiple envelopes retain both answers');
for (const text of [envelope, '```json\n' + envelope + '\n```', '```\n' + envelope + '\n```']) {
  assert.equal(normalize(text), olderAnswer, 'Standalone JSON answers still unwrap');
}
for (const text of ['', 'Plain Markdown\n\nStill visible.', '{"data":{"count":2}}',
  'A malformed { example followed by text.', '```json\n{"data":1}\n```']) {
  assert.equal(normalize(text), text, 'Ordinary content is preserved');
}
assert.equal(normalize('final\n' + envelope + '\nLater text'), 'final\n' + olderAnswer + '\nLater text');
console.log('Web answer normalization checks passed (follow-up turns, multiple envelopes, escaped strings, standalone answers).');
