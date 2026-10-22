// OpenAF integration: real wiki readers, real dummy-MCP transport and model setup.
// No provider requests. Run: oaf -f tests/startupPreparation.js
load('mini-a.js')
function check(value, message) { if (!value) throw new Error(message) }
var root = String(java.nio.file.Files.createTempDirectory('mini-a-startup-').toAbsolutePath())
var agents = []
function agent() { var a = new MiniA(); a.fnI = function() {}; agents.push(a); return a }
try {
  io.writeFileString(root + '/index.md', '# Startup fixture\n\nOriginal evidence')
  var options = { model: '(type: openai, model: fixture, key: fixture)', usewiki: true, wikiroot: root,
    useskillswiki: true, wikiretrievalv2: false, useutils: false, usememory: false, usedecide: false,
    goal: 'Read the startup fixture', __interaction_source: 'mini-a-web' }
  var warm = agent()
  warm.prepareSession(options)
  warm._startupEntries.forEach(function(entry) { check(warm._awaitStartupEntry(entry), 'Preparation completed') })
  check(!warm._isInitialized && !warm.llm && !warm._sessionMemoryManager, 'Preparation does not initialize model or memory')
  var prepared = warm._startupEntries[0].wiki
  warm._beginStartupTiming({})
  warm.init(merge({}, options))
  check(warm._wikiManager === prepared, 'Full init adopts the real wiki reader')
  check(warm._skillWikiManager === prepared, 'Skill wiki retains shared primary identity')
  check(warm.getStartupTimings().wiki_reused === true, 'Wiki reuse is observable')
  check(stringify(warm._wikiManager.read('index.md')).indexOf('Original evidence') >= 0, 'Adopted reader returns evidence')
  var cold = agent(); cold.init(merge({}, options))
  check(cold._systemInst === warm._systemInst, 'Prepared and cold agents generate identical system instructions')
  check(stringify(cold.mcpToolNames) === stringify(warm.mcpToolNames), 'Prepared and cold agents expose identical tools')

  var stale = agent(); stale.prepareSession(options)
  stale._startupEntries.forEach(function(entry) { stale._awaitStartupEntry(entry) })
  var staleReader = stale._startupEntries[0].wiki
  io.mkdir(root + '/.mini-a-wiki-graph')
  io.writeFileString(root + '/.mini-a-wiki-graph/graph.json', '{}')
  stale.init(merge({}, options))
  check(stale._wikiManager !== staleReader, 'Changed graph is rebuilt during full init')

  var owner = agent(), before = 0, after = 0
  var client = owner._newStartupMcpClient({ type: 'dummy', options: {
    fns: { echo: function(params) { return {content:[{type:'text',text:params.text}]} } },
    fnsMeta: { echo: { name: 'echo', description: 'Echo', inputSchema: {type:'object',properties:{text:{type:'string'}}} } }
  } }, {})
  try {
    client.initialize()
    client.__miniAStartupHooks.preFn = function() { before++ }
    client.__miniAStartupHooks.posFn = function() { after++ }
    check(client.listTools().tools[0].name === 'echo', 'Real transport lists tools')
    check(client.callTool('echo',{text:'hello'}).content[0].text === 'hello', 'Real transport calls tool')
    check(before === 1 && after === 1, 'Deferred callbacks work with the OpenAF MCP client')
  } finally { client.destroy() }

  var neverSubmitted = agent(); neverSubmitted.prepareSession(options); neverSubmitted._stopAgentResources()
  neverSubmitted._startupEntries.forEach(function(entry) { while(entry.done.getCount()) sleep(10, true) })
  check(neverSubmitted._startupEntries[0].disposed === true, 'Abandoned preparation closes late resources')
  print('OpenAF startup preparation integration passed (no provider requests).')
} finally {
  agents.forEach(function(a) { a._stopAgentResources() })
  io.rm(root)
}
