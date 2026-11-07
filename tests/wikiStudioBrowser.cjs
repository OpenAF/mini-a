// Exercise browser dispatch without opening a real desktop browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/studio/wiki-studio-api.js', 'utf8');
const body = source.slice(source.indexOf('WikiStudioServer.prototype.openBrowser ='), source.indexOf('WikiStudioServer.prototype.stop ='));
function launch(desktop) {
  const urls = [], warnings = [];
  const context = {WikiStudioServer: function() {}, logWarn: message => warnings.push(message), java: {
    awt: {Desktop: {isDesktopSupported: () => desktop !== false, getDesktop: () => ({browse: url => {
      if (desktop === 'throw') throw Error('Desktop unavailable');
      urls.push(String(url));
    }})}},
    net: {URI: function(url) {this.toString = () => url;}}
  }};
  vm.runInNewContext(body, context);
  context.WikiStudioServer.prototype.openBrowser.call({config: {port: 8890}}, 'http://127.0.0.1:8890/#token=test');
  return {urls, warnings};
}
const desktop = launch(true);
assert.deepEqual(desktop.urls, ['http://127.0.0.1:8890/#token=test']);
assert.equal(desktop.warnings.length, 0);
for (const state of [false, 'throw']) {
  const failed = launch(state);
  assert.equal(failed.urls.length, 0);
  assert.equal(failed.warnings.length, 1);
  assert(!failed.warnings[0].includes('#token='));
}
console.log('Wiki Studio browser launch checks passed');
