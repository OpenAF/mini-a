// History/reload references are independent of streamed Markdown and session switches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/index.md', 'utf8');
const extract = name => {
  const start = source.search(new RegExp('    (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n    }', start) + 6);
};
const rendered = [], pending = [];
let replacements = 0;
const context = vm.createContext({
  console, extensionsUI: { renderArtifacts: (_, items) => rendered.push(items) },
  extensionArtifactCards: { replaceChildren: () => replacements++ }, extensionArtifactDigest: '',
  currentSessionUuid: 'session-a', resolveAppUrl: value => value,
  fetch: (_, options) => new Promise(resolve => pending.push({ uuid: JSON.parse(options.body).uuid, resolve }))
});
vm.runInContext(extract('renderExtensionArtifacts') + '\n' + extract('refreshExtensionArtifacts'), context);
(async () => {
  const first = context.refreshExtensionArtifacts('session-a');
  context.currentSessionUuid = 'session-b';
  pending.shift().resolve({ ok: true, json: async () => ({ artifacts: [{ id: 'old-document', revision: 1 }] }) });
  await first;
  assert.equal(rendered.length, 0, 'late prior-session reply cannot repopulate cards');
  const second = context.refreshExtensionArtifacts('session-b');
  pending.shift().resolve({ ok: true, json: async () => ({ artifacts: [{ id: 'saved-document', revision: 2 }] }) });
  await second;
  assert.equal(rendered[0][0].id, 'saved-document');
  context.renderExtensionArtifacts({ artifacts: [{ id: 'saved-document', revision: 2 }] });
  assert.equal(replacements, 1, 'ordinary transcript polling does not remount unchanged cards');
  context.renderExtensionArtifacts({ artifacts: [{ id: 'saved-document', revision: 3 }] });
  assert.equal(replacements, 2, 'revision updates replace the reference');
  context.extensionsUI = null;
  await context.refreshExtensionArtifacts('session-b');
  assert.equal(pending.length, 0, 'disabled extension UI makes no additional history request');
  assert.match(extract('loadConversationEntry'), /refreshExtensionArtifacts\(entry\.uuid\)/);
  assert.match(extract('refreshCurrentConversationView'), /renderExtensionArtifacts\(data\)/);
  console.log('PASS saved artifact references on history/reload, stale-session isolation and disabled overhead');
})().catch(error => { console.error(error); process.exitCode = 1; });
