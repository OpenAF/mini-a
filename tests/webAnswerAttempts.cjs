// Exercise the actual draft lifecycle listeners without a live provider.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const page = fs.readFileSync('public/index.md', 'utf8')
const start = page.indexOf("        streamSource.addEventListener('answer_attempt'")
const end = page.indexOf("        streamSource.addEventListener('planner_stream'", start)
const handlers = {}
const context = vm.createContext({
  streamSource: { addEventListener: (name, fn) => { handlers[name] = fn } },
  activeSubmissionRunId: 'run', answerEventSequence: 0, answerAttemptId: null, answerAttemptLabel: '', streamBuffer: '',
  scheduleStreamRender() {}, setPlanningMode() {}
})
vm.runInContext(page.slice(start, end), context)
function event(name, data) { handlers[name]({ data: JSON.stringify({ runId: 'run', ...data }) }) }
event('answer_attempt', { attemptId: 'one', status: 'started' })
event('stream', { attemptId: 'one', message: 'First draft' })
event('answer_attempt', { attemptId: 'one', status: 'rejected', reason: 'task t5' })
assert.equal(context.streamBuffer, 'First draft')
assert.match(context.answerAttemptLabel, /task t5/)
event('answer_attempt', { attemptId: 'two', status: 'started' })
assert.equal(context.streamBuffer, '')
event('stream', { attemptId: 'one', message: 'stale' })
event('stream', { runId: 'old', attemptId: 'two', message: 'stale' })
event('stream', { attemptId: 'two', message: 'Second draft' })
assert.equal(context.streamBuffer, 'Second draft')
event('answer_attempt', { attemptId: 'one', status: 'accepted' })
assert.equal(context.answerAttemptLabel, 'Draft')
event('answer_attempt', { attemptId: 'two', status: 'checking' })
assert.equal(context.answerAttemptLabel, 'Checking answer')
console.log('Answer attempt replacement, retention and stale-event checks passed.')

event('answer_attempt', { sequence: 10, attemptId: 'three', status: 'started' })
event('stream', { sequence: 11, attemptId: 'three', message: 'Current' })
event('answer_attempt', { sequence: 9, attemptId: 'old', status: 'started' })
event('stream', { sequence: 11, attemptId: 'three', message: 'Current' })
assert.equal(context.streamBuffer, 'Current', 'Replayed deltas and old attempt starts are ignored')

// Completed workers remain distinct from accepted deliverables in the Simple summary.
const summaryNode = { textContent: '' }
const panelContext = vm.createContext({
  subagentPanel: { removeAttribute() {} }, subagentSummaryText: summaryNode, subagentList: null,
  lastSubagentDigest: '', resetSubagentPanel() {}
})
const panelStart = page.indexOf('    function updateSubagentPanel(payload)')
const panelEnd = page.indexOf('    function updatePlanPanel', panelStart)
vm.runInContext(page.slice(panelStart, panelEnd), panelContext)
panelContext.updateSubagentPanel({ items: [
  { status: 'accepted', acceptance: 'accepted' },
  { status: 'completed', acceptance: 'rejected' },
  { status: 'timeout', acceptance: 'pending' }
] })
assert.equal(summaryNode.textContent, '3 sub-agents · 1 accepted · 1 acceptance incomplete · 1 issues')
console.log('Simple sub-agent summary retains acceptance and failure status.')
