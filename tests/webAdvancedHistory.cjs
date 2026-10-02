const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const branch = source.slice(source.indexOf("      const notice=el('p','Loading saved conversations"), source.indexOf("      actions([['History'"));
const node = (tag, text, className) => ({tag, textContent: text, className, children: [], attributes: {},
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; },
  setAttribute(name, value) { this.attributes[name] = value; }
});
async function render(sessions, error) {
  let uuid = 'current-session';
  const context = vm.createContext({
    el: node, screen: node('section'), busy: false, snapshot: {}, after: 42, dialogId: 'old',
    events: node('div'), activeScreen: 'history', resultGeneration: 0, previousSelections: {}, viewParams: {},
    resetSessionView() { context.snapshot=null;context.after=0;context.dialogId=null;context.events.replaceChildren(); },
    filter: {value: 'old search', oninput() { this.applied = this.value; }},
    button: (text, onclick) => Object.assign(node('button', text), {onclick}),
    api: async () => { if (error) throw error; return {sessions}; },
    bridge: {uuid: () => uuid, resume: value => { uuid = value; }, refresh() { context.refreshed = uuid; }},
    renderScreen() { context.rendered = context.activeScreen; },
    poll: async () => { context.polled = uuid; },
    showError(error) { context.error = error.message; }
  });
  vm.runInContext(branch, context);
  await new Promise(resolve => setImmediate(resolve));
  return context;
}
(async () => {
  const context = await render([{uuid: 'saved-session', updated: 1000}, {uuid: 'current-session', updated: 500}]);
  const list = context.screen.children[2];
  assert.equal(list.tag, 'ul');
  assert.equal(list.attributes['aria-label'], 'Saved conversations');
  assert.equal(list.children.length, 2);
  assert.ok(list.children.every(row => row.tag === 'li'));
  assert.equal(list.children[1].children[0].attributes['aria-current'], 'true');
  const open = list.children[0].children[0];
  context.busy = true;
  await assert.rejects(open.onclick(), /Finish the current operation/);
  assert.equal(context.bridge.uuid(), 'current-session');
  context.busy = false;
  await open.onclick();
  assert.equal(context.refreshed, 'saved-session');
  assert.equal(context.polled, 'saved-session');
  assert.equal(context.rendered, 'activity');
  assert.equal(context.snapshot, null);
  assert.equal(context.after, 0);
  assert.equal(context.dialogId, null);
  assert.equal(context.filter.applied, '');
  const empty = await render([]);
  assert.equal(empty.screen.children[1].textContent, 'No saved conversations yet.');
  const failed = await render([], new Error('Offline'));
  assert.match(failed.screen.children[1].textContent, /Refresh list/);
  assert.equal(failed.error, 'Offline');
  console.log('Advanced history: list, session opening, busy guard, empty and error states passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
