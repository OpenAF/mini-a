// Focused web rendering checks: node tests/webActivity.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public/index.md'), 'utf8');
const yaml = fs.readFileSync(path.join(root, 'mini-a-web.yaml'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'mini-a.js'), 'utf8');
const showdown = require(path.join(root, 'public/showdown.min.js'));
const converter = new showdown.Converter({ tables: true });
assert.match(page, /\.answer-activity > summary\s*\{[\s\S]*?color: #737373;[\s\S]*?font-style: italic;/);
assert.match(page, /\.activity-body\s*\{[\s\S]*?color: #737373;/);
assert.match(agent, /_pendingProxyDisplayTool/);
assert.match(yaml, /pendingProxyThought/);
const route = yaml.split('# Get results of a prompt')[1].split('# Stream events via SSE')[0]
  .split('((execURI      )): | #js\n')[1].replace(/^    /gm, '');
function result(events, showexecs = true) {
  const context = {
    request: { files: { postData: '{"uuid":"test"}' } },
    global: {
      _mini_a_web_checkToken: () => true, _mini_a_web_isValidUuid: () => true,
      __res: { test: events }, __lastActivity: {}, __showexecs: showexecs
    },
    ow: { server: { httpd: { reply: value => value } } },
    isDef: x => x !== undefined && x !== null, isUnDef: x => x === undefined || x === null,
    isArray: Array.isArray, isFunction: x => typeof x === 'function',
    jsonParse: JSON.parse, printErr: error => { throw error; }, __: undefined
  };
  return vm.runInNewContext('(function() {' + route + '})()', context);
}
const events = [
  { event: '👤', message: 'First <prompt>' },
  { event: '💭', message: 'Thinking <script>alert(1)</script>' },
  { event: '⚙️', message: "Using tool 'http-request'" },
  { event: '⬅️', message: 'Tool output\nsecond line' },
  { event: '🗺️', message: 'Plan: fetch, compare' },
  { event: '🤝', message: '❌ Child failed' },
  { event: '⚠️', message: 'Partial results' }
];
const active = result(events);
assert.equal(active.status, 'processing');
assert.match(active.content, /data-complete="false" open/);
assert.doesNotMatch(active.content, /warning\/error event/);
assert.ok(!active.content.includes('<script>'));
for (const hidden of ['Tool output', 'Plan: fetch, compare', 'Child failed', 'Partial results']) {
  assert.ok(!active.content.includes(hidden), 'Previously hidden event stays hidden: ' + hidden);
}
assert.equal((active.content.match(/class="activity-event"/g) || []).length, 2);
assert.ok(!result(events, false).content.includes("Using tool"));
const finishedEvents = [...events, { event: 'final', message: '## Answer\n\nA **useful** answer.' }];
const finished = result(finishedEvents);
assert.equal(finished.status, 'finished');
assert.match(finished.content, /data-complete="true">/);
const html = converter.makeHtml(finished.content);
assert.ok(html.indexOf('</details>') < html.indexOf('<h2'));
assert.match(html, /<strong>useful<\/strong>/);
const followup = result([...finishedEvents, { event: '👤', message: 'Next' }, { event: '💡', message: 'Working' }]);
assert.equal((followup.content.match(/class="answer-activity"/g) || []).length, 2);
assert.match(followup.content, /data-activity-id="8" data-complete="false" open/);
assert.equal(followup.status, 'processing');
const twoAnswers = result([...finishedEvents, { event: '👤', message: 'Next' },
  { event: '💡', message: 'Working' }, { event: 'final', message: 'Second answer' }]);
assert.equal((twoAnswers.content.match(/data-complete="true"/g) || []).length, 2);

// Run the actual interaction normalization, including the numbered thoughts
// produced by repeated native calls and diagnostics before the dispatch event.
const proxyStart = yaml.indexOf('              var isGenericProxyThought =');
const proxyEnd = yaml.indexOf('              if (global.__usestream', proxyStart);
const proxyContext = vm.createContext({
  global: { __res: { test: [] } }, uuid: 'test', lma: {},
  isString: value => typeof value === 'string',
  isDef: value => value !== undefined && value !== null, __: undefined
});
vm.runInContext('var pendingProxyThought;', proxyContext);
const normalizeInteraction = vm.runInContext('(function(_e, m) {' +
  yaml.slice(proxyStart, proxyEnd) + '})', proxyContext);
for (const suffix of ['', ' #2', ' #3', ' #4']) {
  normalizeInteraction('💭', "Using tool 'proxy-dispatch'" + suffix);
  normalizeInteraction('⚠️', 'Hidden diagnostic');
  normalizeInteraction('💡', 'Search each module separately');
  proxyContext.lma._pendingProxyDisplayTool = 'search';
  normalizeInteraction('⚙️', 'Dispatch');
  proxyContext.lma._pendingProxyDisplayTool = undefined;
}
let proxyEvents = proxyContext.global.__res.test;
assert.deepEqual(Array.from(proxyEvents.filter(ev => ev.event === '💭'), ev => ev.message),
  ['', ' #2', ' #3', ' #4'].map(suffix => "Using tool 'search'" + suffix));
const proxyResult = result(proxyEvents, false);
assert.doesNotMatch(proxyResult.content, /proxy-dispatch|warning\/error event|Hidden diagnostic/);
assert.match(proxyResult.content, /search&#39; #4/);
normalizeInteraction('💭', "Using tool 'proxy-dispatch' #5");
normalizeInteraction('💭', "Using tool 'get-url' #2");
normalizeInteraction('⚙️', 'Dispatch');
assert.equal(proxyEvents.filter(ev => ev.event === '💭').length, 5,
  'Canonical translated thoughts replace pending generic thoughts without duplication');
normalizeInteraction('💭', "Using tool 'proxy-dispatch' #6");
normalizeInteraction('⚙️', 'List proxy tools');
assert.equal(proxyEvents.filter(ev => ev.event === '💭').at(-1).message,
  "Using tool 'proxy-dispatch' #6", 'Management calls retain their real tool name');
normalizeInteraction('💭', "Using tool 'get-url' #3");
assert.equal(proxyEvents.at(-1).message, "Using tool 'get-url' #3");

// Compile every inline browser script, then exercise disclosure state across DOM replacements.
for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  new vm.Script(/type="module"/.test(match[1]) ? '(async function() {' + match[2] + '})' : match[2]);
}
function functionSource(name) {
  const start = page.indexOf('    function ' + name + '(');
  const end = page.indexOf('\n    }', start) + '\n    }'.length;
  assert.ok(start >= 0 && end > start, name);
  return page.slice(start, end);
}
// Use the real browser converter and rendering pipeline for long activity lists.
const rendering = vm.createContext({ showdown });
for (const name of ['createMarkdownConverter', 'escapeHtml', 'preprocessChartBlocks',
  'preprocessSvgBlocks', 'renderConversationMarkdown']) {
  vm.runInContext(functionSource(name), rendering);
}
vm.runInContext('const converter = createMarkdownConverter(false);', rendering);
const longEvents = Array.from({ length: 40 }, (_, index) => ({
  event: '💭', message: "Using tool 'wiki' #" + index
}));
longEvents.push({ event: '💭', message: '<script>alert(1)</script> & `skills`\n```chart\n{}\n```' });
for (const transcript of [
  result(longEvents).content,
  result([...longEvents, { event: 'final', message: '## Answer\n\nA **useful** answer.' }]).content
]) {
  const rendered = rendering.renderConversationMarkdown(transcript);
  const activity = transcript.match(/<details class="answer-activity"[\s\S]*?<\/details>/)[0];
  assert.ok(rendered.includes(activity), 'All escaped activity text survives conversion unchanged');
  assert.doesNotMatch(rendered, /¨C\d+C/);
  assert.equal((rendered.match(/class="activity-event"/g) || []).length, 41);
  assert.ok(!rendered.includes('<script>'));
  if (transcript.includes('## Answer')) assert.match(rendered, /<strong>useful<\/strong>/);
}
const renderedFollowup = rendering.renderConversationMarkdown(twoAnswers.content);
assert.equal((renderedFollowup.match(/class="answer-activity"/g) || []).length, 2);
assert.match(renderedFollowup, /<strong>useful<\/strong>/);
assert.ok(renderedFollowup.includes('Second answer'));

let panels = [];
const context = vm.createContext({
  resultsDiv: { querySelectorAll: () => panels }, currentSessionUuid: 'test',
  activityDisclosureState: new Map(), resetActivityDisclosure: false,
  streamCompletedActivities: new Set(), showExecsEnabled: true,
  buildOptimisticUserPromptBlock: message => '<div>' + message + '</div>'
});
for (const name of ['captureActivityDisclosures', 'restoreActivityDisclosures',
  'completeStreamActivity',
  'escapeHtml', 'upgradeActivityTranscript', 'hasVisibleStreamText', 'appendWithOverlap',
  'mergeFinalContentWithStream', 'extractLastAnswerFromText', 'isEventMarkerLine',
  'removeEventMarkerLines']) vm.runInContext(functionSource(name), context);
context.EVENT_MARKERS = ['💭', '⚙️', '⚠️', '🤝'];
context.extractAssistantAnswerText = () => null;
context.normalizeRenderedConversationText = value => value;
function panel(complete, id = '0') {
  return { dataset: { activityId: id, complete: String(complete) }, open: !complete };
}
panels = [panel(false)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, true);
context.captureActivityDisclosures();
panels = [panel(true)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, false, 'Completion collapses an open active section');
panels[0].open = true;
context.captureActivityDisclosures();
panels = [panel(true), panel(false, '8')];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, true, 'A manual expansion survives refresh and a follow-up');
assert.equal(panels[1].open, true);
panels[0].open = false;
context.captureActivityDisclosures();
panels = [panel(true)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, false, 'Manual collapse survives refresh');
panels[0].open = true;
context.resetActivityDisclosure = true;
context.captureActivityDisclosures();
panels = [panel(true)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, false, 'Reopening saved history resets expansion');
const upgraded = context.upgradeActivityTranscript('old content', finishedEvents);
assert.match(upgraded, /data-complete="true">/);
assert.doesNotMatch(upgraded, /warning\/error event/);
assert.ok(!upgraded.includes('Tool output'));
assert.ok(!upgraded.includes('Child failed'));
context.showExecsEnabled = false;
assert.ok(!context.upgradeActivityTranscript('old content', finishedEvents).includes('Using tool'));
context.showExecsEnabled = true;
const preview = context.mergeFinalContentWithStream(active.content, 'Partial answer');
assert.ok(preview.indexOf('</details>') < preview.indexOf('Partial answer'));
assert.equal(context.mergeFinalContentWithStream(finished.content, 'A **useful** answer.'), finished.content);
assert.ok(!context.extractLastAnswerFromText(finished.content).includes('answer-activity'));
assert.ok(!context.extractLastAnswerFromText(finished.content).includes('Child failed'));
assert.ok(!yaml.includes('global.__res[uuid].push({ event: "🤝", message: _subtaskMessage })'));

// Exercise the real SSE done callback before a final /result response is available.
context.activityDisclosureState.clear();
panels = [panel(false)];
context.restoreActivityDisclosures();
const handlers = {};
Object.assign(context, {
  streamSource: { addEventListener: (name, handler) => { handlers[name] = handler; } },
  lastRawContent: active.content, streamBuffer: 'A streamed answer',
  setPlanningMode: () => {}, closeStreamConnectionKeepBuffers: () => {},
  renderRawContent: () => Promise.resolve(), scheduleImmediatePoll: () => {}
});
const doneStart = page.indexOf("        streamSource.addEventListener('done',");
const doneEnd = page.indexOf("        streamSource.addEventListener('error',", doneStart);
vm.runInContext(page.slice(doneStart, doneEnd), context);
handlers.done({ data: '{"status":"error"}' });
assert.equal(panels[0].open, true, 'Failed streams do not imply a completed answer');
handlers.done({ data: '{"status":"finished"}' });
assert.equal(panels[0].open, false, 'Stream completion collapses immediately without polling');
context.captureActivityDisclosures();
panels = [panel(false)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, false, 'Stale poll/render does not reopen stream-completed activity');
panels[0].open = true;
context.captureActivityDisclosures();
panels = [panel(true)];
context.restoreActivityDisclosures();
assert.equal(panels[0].open, true, 'Manual expansion survives final poll after stream completion');
console.log('Web activity checks passed (server route, Markdown, history, streaming, disclosure state).');

// Optional local browser fixture using the actual CSS and disclosure functions.
if (process.argv.includes('--serve')) {
  const fixtures = [active.content, finished.content, twoAnswers.content].map(value => converter.makeHtml(value));
  const styles = Array.from(page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g), match => match[1]).join('\n');
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --text:#222; --border:#ccc; --panel-bg:#f8f8f8; }
    ${styles}
    body { margin: 30px auto; max-width: 850px; padding: 20px; font-family: sans-serif; }
    #fixture-controls { display:flex; gap:10px; margin-bottom:20px; }
    </style></head><body><h1>Activity rendering check</h1>
    <div id="fixture-controls"><button onclick="show(0)">Working</button><button onclick="show(1)">Finish</button><button onclick="show(2)">Two answers</button><button onclick="show(current)">Refresh</button><button onclick="resetActivityDisclosure=true;show(current)">Reopen history</button></div>
    <main id="fixture-results"></main><script>
    const fixtures=${JSON.stringify(fixtures).replace(/</g, '\\u003c')};
    const resultsDiv=document.getElementById('fixture-results');
    let currentSessionUuid='test', activityDisclosureState=new Map(), streamCompletedActivities=new Set(), resetActivityDisclosure=false, current=0;
    ${functionSource('captureActivityDisclosures')}
    ${functionSource('restoreActivityDisclosures')}
    function show(index) { captureActivityDisclosures(); current=index; resultsDiv.innerHTML=fixtures[index]; restoreActivityDisclosures(); }
    show(0);
    </script></body></html>`;
  require('node:http').createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixture);
  }).listen(8899, '127.0.0.1', () => console.log('Browser fixture: http://127.0.0.1:8899'));
}
