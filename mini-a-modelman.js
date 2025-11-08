plugin("Console")
// Get command line arguments
var args = isDef(global._args) ? global._args : processExpr(" ")

// Initialize OAF module
__initializeCon()

// Load additional libraries if specified
if (isDef(args.libs) && args.libs.length > 0) {
    args.libs.split(",").map(r => r.trim()).filter(r => r.length > 0).forEach(lib => {
    log(`Loading library: ${lib}...`)
    try {
        if (lib.startsWith("@")) {
        if (/^\@([^\/]+)\/(.+)\.js$/.test(lib)) {
            var _ar = lib.match(/^\@([^\/]+)\/(.+)\.js$/)
            var _path = getOPackPath(_ar[1])
            var _file = _path + "/" + _ar[2] + ".js"
            if (io.fileExists(_file)) {
            loadLib(_file)
            } else {
            logErr(`Library '${lib}' not found.`)
            }
        } else {
            logErr(`Library '${lib}' does not have the correct format (@oPack/library.js).`)
        }
        } else {
        loadLib(lib)
        }
    } catch(e) {
        logErr(`Failed to load library ${lib}: ${e.message}`)
    }
    })
}

function buildOAFModelInit(args) {
    args.init = {
    "providers": [
      "openai",
      "ollama",
      "anthropic",
      "gemini",
      "bedrock"
    ],
    "options": {
      "openai": [
        "model",
        "timeout",
        "temperature",
        "key",
        "url"
      ],
      "gemini": [
        "model",
        "timeout",
        "key",
        "temperature",
        "url"
      ],
      "bedrock": [
        "timeout",
        "options.model",
        "options.temperature",
        "options.region",
        "options.params.max_tokens"
      ],
      "ollama": [
        "model",
        "url",
        "timeout",
        "temperature"
      ],
      "anthropic": [
        "model",
        "key",
        "timeout",
        "temperature",
        "url"
      ]
    }
  }
}

// Build OAF model
function buildOAFModel(args) {
    buildOAFModelInit(args)
    var iProvider = args.type, _out = {}
    if (isUnDef(args.type)) {
      iProvider = askChoose("Choose a provider: ", args.init.providers.sort())
    }
    _out.type = args.init.providers[iProvider]

    // Does it have a key?
    if (isDef(args.key)) _out.key = args.key
    if (isUnDef(args.key) && args.init.options[args.init.providers[iProvider]].includes("key")) {
      _out.key = askEncrypt("Enter your API key (it will be stored encrypted): ")
      if (_out.key == null || _out.key == "") delete _out.key
    }

    // Does it have a url?
    if (isDef(args.url)) _out.url = args.url
    if (isUnDef(args.url) && args.init.options[args.init.providers[iProvider]].includes("url")) {
      _out.url = ask("Enter the API base URL (or leave blank for default): ")
      if (_out.url == null || _out.url == "") delete _out.url
    }
    
    if (isDef(args.model)) _out.model = args.model
    if (isUnDef(args.model) && args.init.options[args.init.providers[iProvider]].includes("model")) {
      try {
        var _models = $llm( clone(_out) ).getModels()
        if (_models != null && _models.length > 0) {
          if (isDef(_models[0].id)) {
            var _m = _models.map(r => r.id).sort()
            var _id = askChoose( "Choose a model: ", _m )
            _out.model = _m[_id]
          }
          if (isDef(_models[0].name)) {
            var _m = _models.map(r => r.name).map(r => r.replace(/^models\//, "")).sort()
            var _name = askChoose( "Choose a model: ", _m )
            _out.model = _m[_name]
          }
        }
      } catch(e) {
          $err(e)
      }
    }

    // Does it have a model?
    if (isUnDef(_out.model) && args.init.options[args.init.providers[iProvider]].includes("model")) {
      _out.model = ask("Enter the model to use (or leave blank for default): ")
      if (_out.model == "") delete _out.model
    }

    // Does it have a options model?
    if (args.init.providers[iProvider] == "bedrock" && isUnDef(_out.model) && (_out.model == null || _out.model == "")) {
      if (isUnDef(_out)) _out = {}
      if (isUnDef(_out.options)) _out.options = {}

      // Region
      if (args.init.options[args.init.providers[iProvider]].includes("options.region")) {
        _out.options.region = ask("Enter the AWS region (or leave blank for default): ")
        if (_out.options.region == "") delete _out.options.region
      }

      var _models = $llm( clone(_out) ).getModels()
      if (_models != null && _models.length > 0) {
        if (isDef(_models[0].modelId)) {
          var _m = _models.map(r => r.modelId).sort()
          var _modelId = askChoose( "Choose a model: ", _m )
          _out.options.model = _m[_modelId]
        }
        if (isDef(_models[0].name)) {
          var _m = _models.map(r => r.name).map(r => r.replace(/^models\//, "")).sort()
          var _name = askChoose( "Choose a model: ", _m )
          _out.options.model = _m[_name]
        }
      }

      if (isUnDef(_out.options.model) && args.init.options[args.init.providers[iProvider]].includes("options.model")) {
        _out.options.model = ask("Enter the model to use (or leave blank for default): ")
        if (_out.options.model == "") delete _out.options.model
      }
    }

    // Timeout
    _out.timeout = 900000

    // Temperature
    if (isDef(args.temperature) && args.init.providers[iProvider] != "bedrock") _out.temperature = args.temperature
    if (isUnDef(args.temperature) && args.init.options[args.init.providers[iProvider]].includes("temperature")) {
      var temp = ask("Enter the temperature (leave blank for default): ")
      if (temp != "") {
        _out.temperature = parseFloat(temp)
      }
    }

    if (args.init.providers[iProvider] == "bedrock" && _out.temperature == null) {
      if (isUnDef(_out.options)) _out.options = {}
      if (args.init.options[args.init.providers[iProvider]].includes("options.temperature")) {
        if (isDef(args.temperature)) {
          _out.options.temperature = args.temperature
        } else {
          var temp = ask("Enter the temperature (leave blank for default): ")
          if (temp != "") {
            _out.options.temperature = parseFloat(temp)
          }
        }
      }
    }

    // max tokens for bedrock
    if (args.init.providers[iProvider] == "bedrock") {
      if (isUnDef(_out.options)) _out.options = {}
      if (args.init.options[args.init.providers[iProvider]].includes("options.params.max_tokens")) {
        var maxTokens = ask("Enter the max tokens (leave blank for default): ")
        if (maxTokens != "") {
          _out.options.params = {}
          _out.options.params.max_tokens = parseInt(maxTokens)
        }
      }
    }

    return _out
}

function mainOAFModel(args) {
    var accentColor  = "FG(218)"
    var promptColor  = "FG(41)"

    if (!args.__noprint) {
        const miniaLogo = ` ._ _ ${ansiColor(promptColor, "o")}._ ${ansiColor(promptColor, "o")}   _ 
 | | ||| ||~~(_|`
        print(ansiColor("BOLD", miniaLogo) + ansiColor(accentColor, " LLM Model definitions management"))
        print()
    }

    var _sec = $sec("mini-a", "models", __, askEncrypt("Enter the password securing LLM models definitions (or leave blank for no password): "))

    var _shouldExit = false, _obj = __
    while(!_shouldExit) {
        var _lst
        try {
            _lst = _sec.list("models")
        } catch(e) {
            printErr("❌ Error accessing secure storage: " + (e.message.indexOf("BadPaddingException") >= 0 ? "access denied" : e.message))
            break
        }
        if (isMap(_lst)) _lst = _lst.models
        if (isUnDef(_lst)) _lst = []
        var _options = _lst.sort().map(r => "'" + r + "'").concat([ "✨ New definition", "📥 Import definition", "✏️  Rename definition", "🗑️  Delete definitions", "🔙 Go back" ])
        var _action = askChoose("Choose a definition or an action: ", _options)

        switch(_action) {
        case _options.length - 5: // New definition
            print()
            var _name = ask("✨ Name of the new definition: ")
            if (isDef(_name) && _name.length > 0) {
                var _newDef = buildOAFModel(args)
                if (isMap(_newDef)) {
                    print("💾 Storing new definition '" + _name + "'...")
                    _sec.set(_name, _newDef, "models")
                }
            }
            break
        case _options.length - 4: // Import definition
            print()
            var _name = ask("📥 Name of the definition to import: ")
            var _obj  = ask("📥 Paste the definition content (in SLON/JSON format): ")
            var _obj = af.fromJSSLON(_obj)
            if (isMap(_obj)) {
              print("💾 Importing definition '" + _name + "'...")
              _sec.set(_name, _obj, "models")
            } else {
              printErr("❌ Invalid definition format.")
            }
            break
        case _options.length - 3: // Rename existing definition
            print()
            var _oldName = askChoose("✏️ Choose a definition to rename: ", _lst.sort().concat([ "🔙 Go back" ]))
            if (_oldName < _lst.length) {
            var _newName = ask("✨ New name for the definition '" + _lst[_oldName] + "': ")
                if (isDef(_newName) && _newName.length > 0) {
                    print("💾 Renaming definition '" + _lst[_oldName] + "' to '" + _newName + "'...")
                    var _def = _sec.get( _lst[_oldName], "models" )
                    _sec.set( _newName, _def, "models" )
                    _sec.unset( _lst[_oldName], "models" )
                }
            }
            break
        case _options.length - 2: // Delete existing definitions
            selectedIndexes = askChooseMultiple("🗑️  Choose definitions to delete (use space to select, enter to confirm): ", _lst.sort())
            if (selectedIndexes.length > 0) {
                print("✖️ Deleting definitions...")
                selectedIndexes.forEach(defName => {
                    _sec.unset(defName, "models")
                    print("   definition '" + defName + "' deleted!")
                })
            }
            
            break
        case _options.length - 1: // Go back
            if (!args.__noprint) print("Exiting...")
            _shouldExit = true
            break
        default                :
            _obj = _sec.get( _lst[_action], "models" )
            if (!args.__noprint) {
                var _prefix = ow.format.isWindows() ? "set " : "export "
                print(`${ansiColor("FAINT", "-----\nUse one of the following commands to set the model definition in your environment:")}\n`)
                print(`${ansiColor("FAINT,ITALIC", _prefix + "OAF_MODEL=")}"${af.toCSLON(_obj)}"`)
                print(`or`)
                print(`${ansiColor("FAINT,ITALIC", _prefix + "OAF_LC_MODEL=")}"${af.toCSLON(_obj)}"`)
                print(`\n${ansiColor("FAINT", "-----")}`)
            } else {
                print(`🤖 Model definition '${_lst[_action]}' loaded.`)
            }

            _shouldExit = true
        }

        if (!_shouldExit) print(ansiColor("FAINT", repeat((new Console()).getConsoleReader().getTerminal().getWidth(), "─")))
    }

    return _obj
}

var _result = mainOAFModel(args)
// Support for being called from mini-a-con.js
if (isDef(global.__mini_a_con_capture_model)) {
    global.__mini_a_con_model_result = _result
}