// Environment-backed model restore integration; no model requests.
// Run: node tests/webAdvancedModelRestore.cjs
load('mini-a-session.js')
load('mini-a-web-attachments.js')
load('mini-a-advanced.js')
var testRoot = String(io.createTempFile('mini-a-model-restore-', '.dir'))
io.rm(testRoot); io.mkdir(testRoot)
testRoot = String(new java.io.File(testRoot).getCanonicalPath())
var originalHome = __gHDir
__gHDir = function() { return testRoot }
function check(value, message) { if (!value) throw new Error(message) }
var jobs = []
global.__busy = {}; global.__runTokens = {}; global.__conversations = {}; global.__lastActivity = {}
global._mini_a_web_isValidUuid = function(id) { return /^[a-z0-9-]+$/.test(id) }
global._mini_a_web_reserve = function(id) { if (global.__busy[id]) return __; global.__busy[id] = true; return global.__runTokens[id] = genUUID() }
global._mini_a_web_release = function(id, token) { if (global.__runTokens[id] === token) { delete global.__busy[id]; delete global.__runTokens[id] } }
global._mini_a_web_dispose = function(id) { delete global.__conversations[id] }
try {
  // Supply fixture credentials through the real environment lookup boundary.
  // No model requests are made and the actual environment is left untouched.
  var fixtureModels = {}, slots = {model:'OAF_MODEL',modellc:'OAF_LC_MODEL',modelval:'OAF_VAL_MODEL',modeldec:'OAF_DECIDE_MODEL'}
  Object.keys(slots).forEach(function(key) { fixtureModels[slots[key]] = '(type: openai, model: fixture, url: "https://fixture.invalid/v1", key: ENV-' + key + ')' })
  Object.keys(fixtureModels).forEach(function(key) { check(getEnv(key) === fixtureModels[key], 'Run this test with the documented fixture model environment: ' + key) })
  var models = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false})
  models.schedule = function(fn) { jobs.push(fn); return {catch:function(){}} }
  var modelValues = {}
  Object.keys(slots).forEach(function(key) { modelValues[key] = stringify({type:'openai',model:'edited-' + key,url:'https://fixture.invalid/v1',key:'[redacted]'}, __, '') })
  models.request({uuid:'model-reload',action:'settings',values:modelValues,requestId:'saved-models'});jobs.shift()()
  var modelState = models.get('model-reload')
  Object.keys(slots).forEach(function(key) { check(af.fromJSSLON(modelState.runtime.options()[key]).key === 'ENV-' + key, key + ' edits resolve environment credentials') })
  check(io.readFileString(modelState.file).indexOf('ENV-') < 0, 'persisted model overrides omit credentials')
  models.request({uuid:'model-reload',action:'preset',op:'save',name:'Environment models',requestId:'save-env-preset'});jobs.shift()()
  check(io.readFileString(models.presetPath).indexOf('ENV-') < 0, 'saved model presets omit credentials')
  modelState.runtime.dispose()
  models = new MiniAAdvanced({homedir:testRoot,webadvancedpath:testRoot,usehistory:false})
  models.schedule = function(fn) { jobs.push(fn); return {catch:function(){}} }
  modelState = models.get('model-reload')
  Object.keys(slots).forEach(function(key) {
    var config = af.fromJSSLON(modelState.runtime.options()[key])
    check(config.key === 'ENV-' + key && config.model === 'edited-' + key, key + ' resume restores credentials and selected model')
  })
  check(stringify(models.snapshot(modelState,0)).indexOf('ENV-') < 0, 'resumed snapshot still redacts environment credentials')
  models.request({uuid:'model-preset',action:'preset',op:'apply',name:'Environment models',requestId:'apply-env-preset'});jobs.shift()()
  Object.keys(slots).forEach(function(key) { check(af.fromJSSLON(models.get('model-preset').runtime.options()[key]).key === 'ENV-' + key, key + ' preset resolves environment credentials') })
  var otherEndpoint = models.mergeOptions({}, {model:'(type: openai, model: fixture, url: "https://other.invalid/v1")'})
  check(isUnDef(af.fromJSSLON(otherEndpoint.model).key), 'credentials do not cross endpoint boundaries')
  var otherProvider = models.mergeOptions({}, {model:'(type: anthropic, model: fixture, url: "https://fixture.invalid/v1")'})
  check(isUnDef(af.fromJSSLON(otherProvider.model).key), 'credentials do not cross provider boundaries')
  var explicitModel = models.mergeOptions({model:'(type: openai, model: fixture, url: "https://fixture.invalid/v1", key: SERVER-FIXTURE)'}, {model:'(type: openai, model: changed, url: "https://fixture.invalid/v1")'})
  check(af.fromJSSLON(explicitModel.model).key === 'SERVER-FIXTURE', 'explicit server credentials take precedence over environment')
  modelState.runtime.dispose();models.get('model-preset').runtime.dispose()
  print('Advanced environment model restore checks passed: credentials, selected models, presets, redaction and provider/endpoint boundaries.')
} catch(e) { printErr(e); exit(1) } finally { __gHDir = originalHome; io.rm(testRoot) }
