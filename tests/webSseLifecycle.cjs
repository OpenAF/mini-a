const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const yaml = fs.readFileSync('mini-a-web.yaml', 'utf8');
const source = yaml.split('  ((uri          )): /stream\n')[1].split('  ((execSSE      )): | #js\n')[1].split('\n# Convert markdown')[0].replace(/^    /gm, '');
function run(queue, onWrite, onSleep) {
  const g = {__sseQueues:{session:queue}, _mini_a_web_checkToken:()=>true, _mini_a_web_isValidUuid:()=>true};
  const writes = [];
  let ticks = 0;
  vm.runInNewContext('(function(){' + source + '})()', {
    global:g, request:{params:{uuid:'session'}}, __:undefined,
    isDef:x=>x != null, isUnDef:x=>x == null, Date, log(){},
    writer:{write(event,data){writes.push({event,data}); onWrite?.(event,g);}},
    sleep(){assert.ok(++ticks < 5, 'stream must finish'); onSleep?.(g);}
  });
  return {g,writes};
}
const live = {events:[{event:'stream',data:{message:'first'}}],closed:false,updated:1};
const disconnected = run(live, event => {if(event === 'stream') throw Error('client disconnected');});
assert.equal(disconnected.g.__sseQueues.session, live, 'a reader cannot delete the producer queue');
assert.equal(live.closed, false, 'a disconnect cannot end the agent stream');

const replacement = {events:[{event:'stream',data:{message:'new run'}}],closed:true,updated:2};
const switched = run(live, undefined, g => {g.__sseQueues.session = replacement;});
assert.deepEqual(switched.writes.filter(x=>x.event === 'stream').map(x=>x.data.message), ['first','new run'], 'replacement queues need a fresh cursor');
assert.equal(switched.g.__sseQueues.session, replacement, 'completed queues remain available to other readers');
const replay = run(replacement);
assert.equal(replay.writes[1].data.message, 'new run', 'another reader can drain the completed queue');
const newer = {events:[],closed:false,updated:3};
const lateDisconnect = run(replacement, (event,g) => {
  if (event === 'stream') {g.__sseQueues.session = newer; throw Error('old reader disconnected');}
});
assert.equal(lateDisconnect.g.__sseQueues.session, newer, 'an old reader cannot delete a newer run');
assert.equal(newer.closed, false);
console.log('SSE disconnect, queue replacement and multiple-reader regressions passed.');
