const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const source = fs.readFileSync('public/studio/studio.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function studioShellQuote'), source.indexOf('async function webCommandWizard')), context);
const wikis = [{id:'one',root:"/tmp/wiki's $(echo unwanted) `echo unwanted`"}, {id:'two',root:'/tmp/other wiki'}];
function argv(command) {
  return execFileSync('/bin/sh', ['-c', command.replace(/^ojob /, "printf '%s\\0' ")]).toString().split('\0').slice(0,-1);
}
const single = argv(context.studioWebCommand('/path with spaces/mini-a-web.yaml', [wikis[0]], 'webini', '8888', false));
assert(single.includes('mode=webini'));
assert(single.includes('webadvanced=false'));
assert(single.includes('wikiroot=' + wikis[0].root));
assert(single.includes('wikiaccess=ro'));
const multiple = argv(context.studioWebCommand('/mini-a-web.yaml', wikis, 'webini', '8889', true));
assert(multiple.includes('webadvanced=true'));
assert(!multiple.some(arg => arg.startsWith('wikiroot=')));
assert.deepEqual(JSON.parse(multiple.find(arg => arg.startsWith('wikimounts=')).slice(11)), wikis.map(w => ({name:w.id,backend:'fs',root:w.root})));
console.log('Wiki Studio command preview checks passed');
