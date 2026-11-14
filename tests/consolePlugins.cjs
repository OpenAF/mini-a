const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('js/session/mini-a-session.js', 'utf8')
const start = source.indexOf('  function managePlugins(')
const end = source.indexOf('\n    // Run plugin management', start)
// Exercise adapter choices and cancellation through the shared guided manager.
function run(answers) {
  const requests = []
  const context = { adapter: { ask() { return answers.shift() } }, host: {},
    askChoose() { return answers.shift() }, isUnDef: v => v === undefined,
    isNumber: v => typeof v === 'number', print() {}, printTree: v => v,
    logErr(error) { throw new Error(error) },
    manager: { list: () => [{ id: 'sample', enabled: false }], request: r => requests.push(r) }
  }
  vm.runInNewContext(source.slice(start, end) + '\nmanagePlugins(manager)', context)
  return JSON.parse(JSON.stringify(requests))
}
assert.deepEqual(run(['inspect', '/cancel', 'exit']), [])
assert.deepEqual(run(['enable', 0, 'exit']), [{ op: 'enable', id: 'sample' }])
assert.deepEqual(run(['remove', 0, 0, 'exit']), [])
assert.deepEqual(run(['convert', '/tmp/source', '/tmp/out', 7, 'exit']), [])
console.log('Console plugin selection and cancellation passed')
