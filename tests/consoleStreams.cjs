const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a-session.js', 'utf8');
const helper = source.slice(source.indexOf('function __miniAConsoleStreams('), source.indexOf('function MiniAInteractiveSession('));
const context = vm.createContext({});
vm.runInContext(helper, context);
const mux = context.__miniAConsoleStreams(100);
assert.equal(mux.push('stream', 'Parent ').visible, true);
assert.equal(mux.push('stream', '[subtask:one] Child ').visible, false);
assert.equal(mux.push('stream', '[subtask:two] Other ').visible, false);
assert.equal(mux.multiple(), true);
let view = mux.next(-1);
assert.equal(view.id, 'two');
assert.equal(view.text, 'Other ');
view = mux.next(1);
assert.equal(view.id, 'main');
assert.equal(view.text, 'Parent ');
view = mux.next(1);
assert.equal(view.id, 'one');
assert.equal(view.text, 'Child ');
assert.equal(mux.push('stream', '[subtask:one]  indented\n').text, ' indented\n');
assert.equal(mux.push('stream', 'hidden parent').visible, false);
assert.equal(mux.next(-1).text, 'Parent hidden parent');
assert.equal(mux.push('stream', '[subtask:one] [subtask:nested] nested').id, 'one/nested');
const bounded = context.__miniAConsoleStreams(5);
bounded.push('stream', '123456789');
assert.equal(bounded.next().text, '56789');
mux.close();
assert.equal(mux.isClosed(), true);
assert.equal(mux.push('stream', 'late output'), undefined);
assert.match(source, /if \(code === 9\) _nextConsoleStream\(\)/);
assert.match(source, /Number\(sequenceCode\) === 90[\s\S]*?_nextConsoleStream\(-1\)/);
assert.match(source, /if \(!_args.usestream \|\| \(_consoleStreams && _consoleStreams.multiple\(\)\)\)/);
console.log('Console stream isolation, forward/reverse cycling, buffering, and closure passed');

assert.match(source, /_consoleStreams.multiple\(\) && event !== "error" && event !== "warn"/);

// Exercise the actual viewport lifecycle and switching functions with a terminal sink.
const output = [];
const screenContext = vm.createContext({
  _consoleStreams: context.__miniAConsoleStreams(),
  _consoleScreenActive: false, _consoleScreenDrawnAt: 0,
  _consoleScreenSignature: '', _consoleScreenNotices: [],
  _consoleStreamLock: 'fixture', __conAnsi: true, __: undefined,
  _streamRenderer: undefined, _streamPreviewLines: 0, _streamNeedsTerminator: false,
  _prevEventRenderLines: undefined, _prevEventAnimatedRenderer: undefined,
  width: 80, height: 8,
  now: () => Date.now(),
  sync: fn => fn(),
  _flushStreamRemainder() {}, _resetStreamRenderState() {},
  printnl: text => output.push(text), print: text => output.push(text),
  _renderConsoleAnswerMarkdown: (text, kind, width) => { assert.equal(width, 79); return text; },
  ow: { format: { string: { wordWrap: text => text } } },
});
vm.runInContext(helper, screenContext);
vm.runInContext(`
  function _getConsoleRenderWidth() { return width }
  var __con = { getTerminal: function() { return { getHeight: function() { return height } } } }
`, screenContext);
const screens = source.slice(source.indexOf('  function _drawConsoleStreamScreen('), source.indexOf('  function _parseDelegateSubtaskMessage('));
vm.runInContext(screens, screenContext);
vm.runInContext(`
  _consoleStreams.push('stream', 'Main line 1\\nMain line 2');
  _consoleStreams.push('stream', '[subtask:child] Child line 1');
  _openConsoleStreamScreen();
`, screenContext);
assert.equal(output[0], '\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H', 'Save the normal screen before opening stream views');
const mainFrame = output.at(-1);
assert.match(mainFrame, /Main line 1/);
assert.doesNotMatch(mainFrame, /Child line 1/);
vm.runInContext('_nextConsoleStream(1)', screenContext);
assert.match(output.at(-1), /Child line 1/);
assert.doesNotMatch(output.at(-1), /Main line 1/);
vm.runInContext("_consoleStreams.push('stream', '[subtask:child] updated'); _nextConsoleStream(-1)", screenContext);
assert.equal(output.at(-1), mainFrame, 'Returning to main restores exactly its undisturbed viewport');
vm.runInContext('_nextConsoleStream(1)', screenContext);
assert.match(output.at(-1), /Child line 1updated/, 'Hidden stream updates remain in that view');
vm.runInContext("height = 4; _consoleScreenNotices = ['WARN: child delayed']; _drawConsoleStreamScreen(true)", screenContext);
assert.equal(output.at(-1).split('\r\n').length, 4, 'Resize keeps the frame within terminal height');
assert.match(output.at(-1), /WARN: child delayed/);
vm.runInContext('_closeConsoleStreamScreen()', screenContext);
assert.equal(output.at(-2), '\x1b[?25h\x1b[?1049l', 'Restore normal screen and cursor before final output');
const closedLength = output.length;
vm.runInContext('_closeConsoleStreamScreen()', screenContext);
assert.equal(output.length, closedLength, 'Cleanup is idempotent across normal completion and finally');
console.log('Independent stream screens, round-trip restoration, resize, warnings, and terminal cleanup passed');

// The Markdown helper forwards geometry to withMD's third argument, not style.
const common = fs.readFileSync('mini-a-common.js', 'utf8');
const renderHelper = common.slice(common.indexOf('function __miniAMarkdownRender('), common.indexOf('function __miniAMarkdownPreviewRows('));
const markdownCalls = [];
const markdownContext = vm.createContext({
  __: undefined, __flags: { WITHMD: { htmlFilter: true } },
  isDef: value => value !== undefined, isObject: value => value !== null && typeof value === 'object',
  ow: { format: { withMD: (...args) => { markdownCalls.push(args); return args[0]; } } }
});
vm.runInContext(renderHelper, markdownContext);
markdownContext.__miniAMarkdownRender('**Viewport**', 79, { ansi: true });
assert.deepEqual(markdownCalls.pop(), ['**Viewport**', undefined, 79]);
assert.equal(markdownContext.__flags.WITHMD.htmlFilter, true);
markdownContext.__flags = {};
markdownContext.__miniAMarkdownRender('**Narrow viewport**', 39, { ansi: true });
assert.deepEqual(markdownCalls.pop(), ['**Narrow viewport**', undefined, 39]);
console.log('Viewport width reaches Markdown and the withMD line-width argument');
