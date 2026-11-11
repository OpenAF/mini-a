const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const records = new Map()
const context = vm.createContext({
  global: {}, java: { util: { concurrent: { locks: { ReentrantLock: function() { this.lock = () => {}; this.unlock = () => {} } } } } },
  isMap: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  isNumber: value => typeof value === 'number', isString: value => typeof value === 'string',
  isArray: Array.isArray, isFunction: value => typeof value === 'function', isUnDef: value => value === undefined,
  clone: value => JSON.parse(JSON.stringify(value)), sha256: value => value,
  $ch: () => ({ get: key => records.get(JSON.stringify(key)), set: (key, value) => records.set(JSON.stringify(key), value) }),
  ow: { ai: {} }, $gpt: function(unused, config) { return { getEmbeddingsWithStats() {
    if (config.fail) throw new Error('provider failure')
    return { stats: { tokens: { prompt: 7, total: 7 } }, response: [1, 2] }
  } } }, __: undefined
})
vm.runInContext(fs.readFileSync('js/memory/mini-a-embeddings.js', 'utf8'), context)
vm.runInContext(`
  var cache = Object.create(MiniAEmbeddings.prototype)
  cache.lock = new java.util.concurrent.locks.ReentrantLock()
  cache.name = 'test'
  cache.identity = 'test'
  cache.config = {}
  cache.stats = { calls: 0, hits: 0, failures: 0 }
  cache.get('one')
  cache.get('one')
  cache.peek('one')
  cache.get('two')
`, context)
let metrics = JSON.parse(vm.runInContext('JSON.stringify(MiniAEmbeddings.metrics())', context))
assert.equal(metrics.calls, 2)
assert.equal(metrics.hits, 2)
assert.equal(metrics.input_tokens, 14)
assert.equal(metrics.total_tokens, 14)
assert.equal(metrics.usage_reports, 2)
vm.runInContext(`cache.client = undefined; cache.config = { fail: true }; try { cache.get('bad') } catch(e) {}`, context)
metrics = JSON.parse(vm.runInContext('JSON.stringify(MiniAEmbeddings.metrics())', context))
assert.equal(metrics.calls, 3)
assert.equal(metrics.failures, 1)
assert.equal(metrics.total_tokens, 14)
vm.runInContext(`MiniAEmbeddings.metrics({ called: true }); var snapshot = MiniAEmbeddings.metrics(); snapshot.calls = 99`, context)
assert.equal(vm.runInContext('MiniAEmbeddings.metrics().calls', context), 4)
assert.equal(vm.runInContext('MiniAEmbeddings.metrics().usage_reports', context), 2)
console.log('Embedding statistics: accumulation, cache reuse, failures, missing usage and snapshots passed.')
