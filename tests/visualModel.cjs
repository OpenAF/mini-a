const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
for (const visual of ['', '(type: ollama, model: environment)']) {
  const env = {...process.env, OAF_MODEL:'(type: openai, model: fixture, key: fixture, url: "https://fixture.invalid/v1")', OAF_LC_MODEL:'', OAF_VAL_MODEL:'', OAF_DECIDE_MODEL:'', OAF_VISUAL_MODEL:visual};
  const result = spawnSync('oaf', ['-f','tests/visualModel.js'], {env, encoding:'utf8', timeout:60000});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Visual model tests passed/);
  process.stdout.write(result.stdout);
}
