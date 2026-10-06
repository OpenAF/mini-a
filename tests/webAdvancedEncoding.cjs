const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/advanced.js'), 'utf8');
const requests = [];
const context = vm.createContext({
  bridge: {uuid: () => 'encoding-fixture', url: route => '/' + route},
  enabled: false,
  fetch: async (url, options) => {
    requests.push({url, ...options});
    // Match NanoHTTPD's charset selection for raw POST bodies.
    const charset = /charset=([^;]+)/i.exec(options.headers['Content-Type']);
    const decoder = new TextDecoder(charset ? charset[1] : 'utf-8', {fatal: true});
    const bytes = Buffer.from(options.body, 'utf8');
    const body = charset ? decoder.decode(bytes) : Array.from(bytes, byte => byte < 128 ? String.fromCharCode(byte) : '\ufffd').join('');
    return {ok: true, json: async () => JSON.parse(body)};
  }
});
vm.runInContext(source.slice(source.indexOf('  async function api(data) {'), source.indexOf('  function showError(')), context);

(async () => {
  const prompt = 'Mostra-me um gráfico da evolução da temperatura — Braga 🌧️ 中文';
  const result = await context.api({action: 'command', command: prompt});
  assert.equal(result.command, prompt, 'prompt must survive UTF-8 request decoding');
  const settings = await context.api({action: 'settings', values: {goal: prompt}});
  assert.equal(settings.values.goal, prompt, 'settings must preserve Unicode too');
  for (const request of requests) {
    assert.equal(request.url, '/advanced');
    assert.match(request.headers['Content-Type'], /application\/json; charset=utf-8/i);
  }
  console.log('Advanced request encoding: Unicode prompts and settings passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
