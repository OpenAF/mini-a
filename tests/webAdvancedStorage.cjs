const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const stored = new Map();
let failWrites = false;
const localStorage = {
  getItem: key => stored.get(key) || null,
  setItem(key, value) { if (failWrites) throw Error('Quota exceeded'); stored.set(key, value); }
};
function fixture() {
  const requests = [];
  const context = vm.createContext({localStorage, snapshot:{presets:['Server']}, busy:false, promptPending:null,
    toolbar:{append() {}}, button:(_label, onclick) => ({onclick,setAttribute() {}}),
    api:async data => { requests.push(data); return data.action === 'preset-export' ? {values:{knowledge:'  "literal"\n',goalprefix:null}} : {accepted:true}; },
    poll:async () => {}, renderScreen() {}
  });
  vm.runInContext(source.slice(source.indexOf('  const storageChoiceKey ='), source.indexOf('  const toolbar =')), context);
  vm.runInContext(source.slice(source.indexOf('  const storageToggle ='), source.indexOf('  const status =')), context);
  return {context,requests,run:code => vm.runInContext(code,context)};
}
(async () => {
  let f = fixture();
  assert.equal(f.run('storageMode'),'current');
  await f.run('storageToggle.onclick()');
  assert.equal(f.run('storageMode'),'browser');
  await f.context.presetRequest({action:'preset',op:'save',name:'Personal'});
  assert.deepEqual(Array.from(f.context.snapshot.presets),['Personal']);
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].action,'preset-export');
  await f.context.presetRequest({action:'preset',op:'default',name:'Personal'});
  f = fixture(); // A fresh UI instance uses the stored selection and library.
  assert.equal(f.run('storageMode'),'browser');
  assert.equal(f.run('browserPresets().defaultPreset'),'Personal');
  await f.context.presetRequest({action:'preset',op:'apply',name:'Personal',requestId:'apply'});
  assert.equal(f.requests[0].values.knowledge,'  "literal"\n');
  assert.equal(f.requests[0].values.goalprefix,null);
  failWrites = true;
  await assert.rejects(f.context.presetRequest({action:'preset',op:'delete',name:'Personal'}), /Quota exceeded/);
  assert.ok(f.run('browserPresets().presets.Personal'));
  await assert.rejects(f.run('storageToggle.onclick()'), /Quota exceeded/);
  assert.equal(f.run('storageMode'),'browser');
  failWrites = false;
  await f.context.presetRequest({action:'preset',op:'delete',name:'Personal'});
  assert.equal(f.run('browserPresets().defaultPreset'),undefined);
  await f.run('storageToggle.onclick()');
  await f.context.presetRequest({action:'preset',op:'save',name:'Server'});
  assert.equal(f.requests.at(-1).action,'preset');
  stored.set('mini-a-advanced-presets','broken');
  await assert.rejects(f.run('storageToggle.onclick()'));
  assert.equal(f.run('storageMode'),'current');
  assert.equal(stored.get('mini-a-advanced-storage'),'current');
  console.log('Advanced browser storage: selection persistence, preset roundtrip, library isolation and write failures passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
