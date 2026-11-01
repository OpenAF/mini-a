const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a-session.js', 'utf8');
const start = source.indexOf('  function printHelp(');
const end = source.indexOf('\n  var __skillWikiSubcommands', start);
let output;
const context = vm.createContext({
  repeat: (n, s) => s.repeat(n), adapter: undefined, isString: x => typeof x === 'string', isObject: x => x !== null && typeof x === 'object',
  isArray: Array.isArray, isDef: x => x !== undefined, __conAnsi: false, __: undefined,
  colorifyText: x => x, promptColor: '', hintColor: '', accentColor: '',
  getConversationPath: () => '/conversation', conversationHistoryDirPath: '/history', historyFilePath: '/history.txt',
  customCommandsDirPath: '/commands', customSkillsDirPath: '/skills', hooksDirPath: '/hooks',
  customSlashCommands: {example: {file: 'example.md', description: 'Custom example'}},
  customSkillSlashCommands: {review: {file: 'SKILL.md', description: 'Review skill'}},
  loadedHooks: {before: [{}]}, commandHelpRows: () => [{command: '/help [custom]', description: 'Show help'}],
  ow: {format: {withSideLine: x => x, withSideLineThemes: () => ({})}}, print: x => { output = x; }
});
vm.runInContext(source.slice(start, end), context);
vm.runInContext('printHelp()', context);
assert.match(output, /Type a goal/);
assert.match(output, /\/help \[custom\]/);
assert.doesNotMatch(output, /Custom commands from|Skills from|Hooks from|Custom example|Review skill/);
vm.runInContext('printHelp(true)', context);
assert.match(output, /Custom example/);
assert.match(output, /Review skill/);
assert.match(output, /1 hook\(s\) loaded/);
assert.doesNotMatch(output, /Type a goal|\/help \[custom\]/);
context.customSlashCommands = {}; context.customSkillSlashCommands = {}; context.loadedHooks = {};
vm.runInContext('printHelp(true)', context);
assert.match(output, /No custom commands, skills or hooks loaded/);
console.log('Console help: regular, custom and empty custom views passed.');
