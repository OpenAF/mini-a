// Execute startup job bodies with OS browser calls stubbed; never open a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const yaml = fs.readFileSync('mini-a-web.yaml', 'utf8');
function job(name) {
  return yaml.split('- name : ' + name + '\n')[1].split('  exec : | #js\n')[1]
    .split(/\n(?=[^ \n])/)[0].replace(/^    /gm, '');
}
function fixture(args, os = 'Mac OS X', desktop = false, exitCode = 0) {
  const printed = [], warnings = [], commands = [], urls = [];
  let draws = 0;
  function ProcessBuilder(command) {
    if (exitCode === 'throw') throw Error('Browser launcher unavailable');
    commands.push(command);
    this.redirectErrorStream = this.redirectOutput = () => this;
    this.start = () => ({ waitFor: () => true, exitValue: () => exitCode });
  }
  ProcessBuilder.Redirect = { DISCARD: {} };
  const c = { args, global: { __advanced: {} }, print: x => printed.push(x), logWarn: x => warnings.push(x),
    isDef: x => x !== undefined && x !== null, isUnDef: x => x === undefined || x === null,
    isString: x => typeof x === 'string', isMap: x => !!x && typeof x === 'object',
    toBoolean: x => x === true || x === 'true', getEnv: () => 'fixture', encodeURIComponent,
    java: { math: { BigInteger: function(bits) { assert.equal(bits, 256); draws++; this.toString = () => 'abc'; } },
      security: { SecureRandom: function() {} }, awt: { Desktop: { isDesktopSupported: () => desktop,
        getDesktop: () => ({ browse: url => urls.push(String(url)) }) } },
      net: { URI: function(url) { this.toString = () => url; } },
      lang: { System: { getProperty: () => os }, ProcessBuilder }, util: { concurrent: { TimeUnit: { SECONDS: 1 } } } } };
  vm.createContext(c);
  const run = name => vm.runInContext('(function(){\n' + job(name) + '\n})()', c);
  run('CheckEnv');
  c.global.__webtoken = args.webtoken;
  run('Open Advanced browser');
  return { c, printed, warnings, commands, urls, draws };
}
for (const token of [undefined, '', '   ']) {
  const f = fixture({ webadvanced: 'true', webtoken: token, onport: 9099 });
  assert.match(f.c.args.webtoken, /^[0-9a-f]{64}$/);
  assert.equal(f.draws, 1);
  assert.equal(f.commands[0][0], 'open');
  assert.equal(f.commands[0][1], 'http://localhost:9099/#token=' + f.c.args.webtoken);
  assert.equal(f.printed.length, 1);
}
for (const args of [{ webadvanced: true, webtoken: ' supplied ' }, { webadvanced: false }, {}]) {
  const f = fixture(args);
  assert.equal(f.draws, 0);
  assert.equal(f.commands.length, 0);
  assert.equal(f.printed.length, 0);
}
assert.equal(fixture({ webadvanced: true }, 'Linux').commands[0][0], 'xdg-open');
assert.equal(fixture({ webadvanced: true }, 'Windows 11').commands[0][0], 'rundll32');
const desktop = fixture({ webadvanced: true }, 'Mac OS X', true);
assert.equal(desktop.commands.length, 0);
assert.match(desktop.urls[0], /^http:\/\/localhost:8888\/#token=/);
assert.equal(fixture({ webadvanced: true }, 'Linux', false, 1).warnings.length, 1);
assert.equal(fixture({ webadvanced: true }, 'Linux', false, 'throw').warnings.length, 1);
// Browser launch follows the final route registration, outside the route body.
assert(yaml.indexOf('\n- Open Advanced browser\n') > yaml.indexOf('((uri          )): /load'));
console.log('Advanced startup fixtures passed.');
