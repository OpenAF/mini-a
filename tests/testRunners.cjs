// Provider-free regression checks for standalone runner discovery and exit status.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('tests/wikiRetrievalAssertions.js', 'utf8')
function run(configs, functions) {
  const calls = [], reports = []
  let code
  const original = (actual, expected) => assert.equal(actual, expected)
  const test = { assert: original }
  vm.runInNewContext(source, {
    ow: { loadTest() {}, test },
    io: { readFileYAML: path => { assert.ok(configs[path], path); return configs[path] } },
    getEnv: () => 'fixture', isString: value => typeof value === 'string',
    require: () => new Proxy({}, { get: (_, name) => () => {
      calls.push(name)
      test.assert(true, true)
      if (functions[name]) functions[name]()
    } }),
    stringify: JSON.stringify, __: undefined,
    print: value => reports.push(JSON.parse(value.replace('ASSERTION_REPORT=', ''))),
    exit: value => { code = value }
  })
  assert.equal(test.assert, original, 'restore assertion hook')
  return { calls, reports, code }
}
const job = name => ({ name, exec: `args.func = require("tests/fixture.js").${name}` })
const configs = {
  'tests/fixture.yaml': { include: ['oJobTest.yaml', 'tests/child.yaml'], jobs: [job('parent'), job('unused')], todo: ['parent', 'child'] },
  'tests/child.yaml': { include: ['tests/fixture.yaml'], jobs: [job('child')], todo: ['child'] }
}
let result = run(configs, {})
assert.deepEqual(result.calls, ['child', 'parent'], 'follow includes, deduplicate, and honor todo')
assert.equal(result.code, 0)
assert.equal(result.reports[0].assertions, 2)
result = run(configs, { child() { throw new Error('injected failure') } })
assert.equal(result.code, 1)
assert.equal(result.reports[0].failures.length, 1)
assert.deepEqual(result.calls, ['child', 'parent'], 'continue collecting failures')
assert.equal(run({ 'tests/fixture.yaml': { jobs: [], todo: [] } }, {}).code, 1, 'reject empty discovery')
const aggregate = fs.readFileSync('tests/autoTestAll.yaml', 'utf8')
const end = aggregate.slice(aggregate.indexOf('- name: End'), aggregate.indexOf('\ntodo:'))
const exitLine = end.match(/^\s*(exit\(.+\))$/m)[1]
for (const failures of [0, 1, 3]) {
  let code
  vm.runInNewContext(exitLine, { ow: { test: { getCountFail: () => failures } }, exit: value => { code = value } })
  assert.equal(code, failures ? 1 : 0)
}
console.log('PASS runner discovery, failure propagation, hook restoration, and aggregate exit status')
