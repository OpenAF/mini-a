// Run the real OpenAF transport with isolated dummy model environment values.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = {...process.env};
for (const [slot, name] of Object.entries({model:'OAF_MODEL',modellc:'OAF_LC_MODEL',modelval:'OAF_VAL_MODEL',modeldec:'OAF_DECIDE_MODEL'})) {
  env[name] = '(type: openai, model: fixture, url: "https://fixture.invalid/v1", key: ENV-' + slot + ')';
}
const result = spawnSync('oaf', ['-f', 'tests/webAdvancedModelRestore.js'], {
  cwd:path.resolve(__dirname, '..'), env, encoding:'utf8', timeout:60000
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stdout + result.stderr);
assert.match(result.stdout, /Advanced environment model restore checks passed/);
process.stdout.write(result.stdout);
