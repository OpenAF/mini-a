// Deterministic clock coverage for the production limiter, without provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a.js', 'utf8');
const start = source.indexOf('MiniA.prototype._createRateLimiter =');
const end = source.indexOf('\n/**', start);
function fixture(limits) {
  let timestamp = 0, locked = false;
  const sleeps = [], messages = [];
  const context = {
    MiniA: function() {}, isNumber: value => typeof value === 'number',
    isFunction: value => typeof value === 'function', genUUID: () => 'fixture',
    now: () => timestamp,
    sync(fn) {
      assert.equal(locked, false);
      locked = true;
      try { fn(); } finally { locked = false; }
    },
    sleep(delay) { assert.equal(locked, false, 'wait outside admission lock'); sleeps.push(delay); timestamp += delay; }
  };
  vm.runInNewContext(source.slice(start, end), context);
  return {
    limiter: context.MiniA.prototype._createRateLimiter.call({fnI: (_, message) => messages.push(message)}, limits),
    sleeps, messages, time: () => timestamp, advance: delay => { timestamp += delay; }
  };
}

let f = fixture({rpm: 1});
assert.equal(f.limiter.beforeCall(), true);
assert.equal(f.limiter.beforeCall(), true);
assert.equal(f.time(), 60000, 'unfinished first call reserves RPM');
f.limiter.afterCall(0);
f.advance(60000);
assert.equal(f.limiter.tryBeforeCall(), false, 'second call is still in flight');
f.limiter.afterCall(0);
assert.equal(f.limiter.tryBeforeCall(), true, 'completion does not create another RPM entry');

f = fixture({rpm: 1});
f.limiter.beforeCall(); f.advance(1000); f.limiter.afterCall(0);
f.advance(59000);
assert.equal(f.limiter.tryBeforeCall(), true, 'window expires from admission, not completion');
f.limiter.afterReservedCall(0);
f.limiter.beforeCall();
assert.equal(f.time(), 120000, 'normal and optional calls share RPM reservations');

for (const reserved of [false, true]) {
  f = fixture({tpm: 10});
  if (reserved) { assert.equal(f.limiter.tryBeforeCall(), true); f.limiter.afterReservedCall(10); }
  else { f.limiter.beforeCall(); f.limiter.afterCall(10); }
  assert.equal(f.limiter.tryBeforeCall(), false, 'reported usage limits optional calls');
  f.limiter.beforeCall();
  assert.equal(f.time(), 60000, 'reported usage limits normal calls');
}

f = fixture({rpm: 1});
assert.equal(f.limiter.beforeCall(() => true), false, 'cancel before admission');
assert.equal(f.limiter.tryBeforeCall(), true, 'pre-admission cancellation consumes no RPM');
assert.equal(f.limiter.beforeCall(() => f.time() >= 250), false, 'cancel during wait');
assert.equal(f.time(), 300);
assert.ok(f.sleeps.every(delay => delay <= 100), 'cancellable wait checks at most every 100ms');
assert.equal(f.messages.length, 1, 'polling does not flood rate messages');
f.advance(60000);
assert.equal(f.limiter.tryBeforeCall(), true, 'cancelled wait leaves no in-flight guard');

f = fixture({});
assert.equal(f.limiter.beforeCall(), true);
assert.equal(f.limiter.beforeCall(() => true), false, 'disabled limits still honor cancellation');
assert.equal(f.limiter.tryBeforeCall(), true);
console.log('PASS limiter RPM admission, mixed calls, token usage, completion and cancellation');
