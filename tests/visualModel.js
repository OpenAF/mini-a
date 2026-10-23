// Run: node tests/visualModel.cjs (no provider requests).
load('mini-a.js')
global.__mini_a_ingest_lib_mode = true
load('mini-a-ingest.js')
function check(value, message) { if (!value) throw new Error(message) }
var originalEnv = getEnv
var env = {}, configs = [], paths = [], closed = 0, debugChannels = [], imageMimeCapability = false
var channel = 'visual-test-' + genUUID()
var debugFile = String(io.createTempFile('mini-visual-debug-', '.json'))
io.rm(debugFile)
try {
  var main = {type:'openai',model:'main',key:'fixture',url:'https://fixture.invalid/v1'}
  var visual = {type:'ollama',model:'visual',params:{tools:[{}],tool_choice:'required'}}
  var agent = new MiniA()
  var args = {model:stringify(main),modelvisual:stringify(visual),debugvisualch:stringify({name:channel,type:"simple"}),usememory:false,usetools:false,raw:true}
  agent.init(args)
  check(agent._debugvisualchConfig === args.debugvisualch, 'debug setting initializes')
  check(agent._oaf_visual_model.model === 'visual', 'explicit visual model initializes')
  delete args.modelvisual
  delete args.debugvisualch
  agent._isInitialized = false
  agent.init(args)
  var expectedEnv = originalEnv('OAF_VISUAL_MODEL')
  check(expectedEnv ? agent._oaf_visual_model.model === 'environment' : isUnDef(agent._oaf_visual_model), 'reinitialization replaces stale override with environment or fallback')
  check(isUnDef(agent._debugvisualchConfig), 'reinitialization clears debug setting')
  agent._debugvisualchConfig = stringify({name:channel,type:'simple'})
  agent._oaf_visual_model = __
  var mock = function(config, debugConfig, defaultName, label) {
    configs.push(clone(config))
    var debugName
    var client = {setDebugCh:function(name){debugName=name;debugChannels.push(name)},promptImage:function(prompt,path) {
      paths.push(path)
      if (debugName) $ch(debugName).set({id:paths.length},{prompt:prompt,response:'description'})
      return 'description'
    },getGPT:function(){return {model:{supportsImageMimeTypes:imageMimeCapability},cleanPrompt:function(){closed++}}}}
    if (debugConfig) agent._configureDebugChannel(client,debugConfig,defaultName,label)
    return client
  }
  agent._createBareLlmInstance = mock
  agent._inspectImageWithModel({path:'fixture.jpg',prompt:'Describe',mediaType:'image/jpeg'})
  check(configs.pop().model === 'main', 'inspection falls back to main')
  agent._oaf_visual_model = visual
  agent._inspectImageWithModel({path:'fixture.png',prompt:'Describe',mediaType:'image/png'})
  var used = configs.pop()
  check(used.model === 'visual' && isUnDef(used.params.tools), 'inspection uses isolated visual configuration')
  check(paths.pop() === 'fixture.png', 'image conversion uses visual provider, not main provider')
  check(visual.params.tools.length === 1, 'original config unchanged')
  check(debugChannels.length === 2 && $ch(channel).size() === 2, 'debug channel attaches to each visual and fallback call')
  var ingest = new MiniAIngest({model:main,modelvisual:visual,debugvisualch:debugFile})
  ingest._describeImage = new Function('$llm', 'return (' + String(MiniAIngest.prototype._describeImage) + ')')(mock)
  ingest._getEnv = function(name) {return env[name] || ''}
  var req = {path:'fixture.jpg',prompt:'Describe',mediaType:'image/jpeg'}
  env.OAF_VISUAL_MODEL = stringify({type:'ollama',model:'environment'})
  ingest._describeImage(req)
  check(configs.pop().model === 'visual', 'ingestion parameter beats environment')
  delete ingest._args.modelvisual
  ingest._describeImage(req)
  check(configs.pop().model === 'environment', 'ingestion uses visual environment')
  delete env.OAF_VISUAL_MODEL
  ingest._describeImage(req)
  check(configs.pop().model === 'main', 'ingestion falls back to main map')
  ingest._setLlm({promptImage:function(){return 'injected'}})
  check(ingest._describeImage(req) === 'injected', 'existing injected model fallback preserved')
  ingest._args.modelvisual = stringify(visual)
  check(ingest._describeImage(req) === 'description', 'visual override replaces injected main model')
  check(configs.pop().model === 'visual', 'JSON visual config parsed')
  check(closed === 6, 'temporary image conversations cleaned')
  check(debugChannels.length === 6, 'ingestion debug channel attaches on each fresh client')
  check(io.readFileString(debugFile).indexOf('description') >= 0, 'native file debug channel persists records')
  var warnings = []
  __miniAConfigureDebugChannel({}, debugFile, channel, 'Visual', function(level, message){warnings.push(message)})
  check(warnings.length === 1 && warnings[0].indexOf('setDebugCh') >= 0, 'unsupported runtime warns without failing')
  var pngFile = String(io.createTempFile('mini-visual-png-', '.png'))
  try {
    var bitmap = new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_ARGB)
    javax.imageio.ImageIO.write(bitmap, 'png', new java.io.File(pngFile))
    bitmap.flush()
    var pngRequest = {path:pngFile,prompt:'Describe',mediaType:'image/png',width:2,height:2}
    agent._oaf_visual_model = main
    ingest._args.modelvisual = main
    ;[false, true].forEach(function(capability) {
      imageMimeCapability = capability
      agent._inspectImageWithModel(pngRequest)
      var image = paths.pop()
      check(capability ? image === pngFile : image.indexOf('/9j/') === 0, 'Inspection preserves PNG with new runtime and converts for older runtime')
      ingest._describeImage(pngRequest)
      image = paths.pop()
      check(capability ? image === pngFile : image.indexOf('/9j/') === 0, 'Ingestion preserves PNG with new runtime and converts for older runtime')
    })
  } finally { io.rm(pngFile) }
  print('Visual model tests passed: precedence, fallback, reinitialization, provider routing and isolation.')
} catch(e) { printErr(e); exit(1) } finally {
  try { $ch(channel).destroy() } catch(ignore) {}
  try { $ch('__mini_a_visual_llm_debug').destroy() } catch(ignore) {}
  io.rm(debugFile)
}
