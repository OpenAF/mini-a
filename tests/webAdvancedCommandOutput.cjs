const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const start = source.indexOf('  async function mutate(data) {');
const end = source.indexOf('  function setEnabled(value)', start);
async function run(action, response) {
  const context = vm.createContext({
    activeScreen: 'stats', busy: false, history: [], historyIndex: 0,
    bridge: {newRequestId: () => 'request'},
    filter: {value: 'old search', oninput() { this.applied = this.value; }},
    api: async () => response,
    renderScreen() { context.rendered = context.activeScreen; },
    poll: async () => { context.screenAtPoll = context.activeScreen; }
  });
  vm.runInContext(source.slice(start, end), context);
  if (response.busy) {
    await assert.rejects(context.command('/stats'), /busy/);
    assert.equal(context.activeScreen, 'stats');
    assert.equal(context.filter.value, 'old search');
  } else if (action === 'command') {
    for (const cmd of ['/stats', '/stats detailed', '/stats tools', '/stats memory', '/stats wiki']) {
      context.activeScreen = 'stats';
      await context.command(cmd);
      assert.equal(context.rendered, 'activity', cmd);
      assert.equal(context.screenAtPoll, 'activity', 'show output before polling');
      assert.equal(context.filter.applied, '', 'stale filters cannot hide command results');
    }
  } else {
    await context.mutate({action});
    assert.equal(context.activeScreen, 'stats', 'settings edits do not navigate');
  }
}
(async () => {
  await run('command', {});
  await run('command', {busy: true});
  await run('settings', {});
  console.log('Advanced command output checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
