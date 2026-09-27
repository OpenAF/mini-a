(function() {
  load("mini-a-common.js")

  // Run the production menu with an isolated store and scripted answers. No
  // terminal initialization, credential access, or model request is performed.
  var runMenu = function(definitions, choices, answers) {
    var store = clone(definitions), writes = [], errors = []
    var source = io.readFileString("mini-a-modelman.js")
    var body = source.substring(source.indexOf("function mainOAFModel("), source.indexOf("\nvar _result = mainOAFModel(args)"))
    var sec = {
      list: function() { return Object.keys(store) },
      get: function(name) { return clone(store[name]) },
      set: function(name, value) { writes.push("set:" + name); store[name] = clone(value) },
      unset: function(name) { writes.push("unset:" + name); delete store[name] }
    }
    var menu = new Function("$sec", "askChoose", "ask", "askEncrypt", "print", "printErr", "ansiColor", "Console", body + "\nreturn mainOAFModel;")(
      function() { return sec },
      function(prompt, options) {
        if (choices.length === 0) throw new Error("Unexpected menu prompt: " + prompt)
        var choice = choices.shift()
        for (var i = 0; i < options.length; i++) if (options[i].indexOf(choice) >= 0) return i
        throw new Error("Missing choice: " + choice)
      },
      function() { if (!answers.length) throw new Error("Unexpected text prompt"); return answers.shift() },
      function() { return "" }, function() {}, function(e) { errors.push(e) }, function(style, text) { return text },
      function() { this.getConsoleReader = function() { return { getTerminal: function() { return { getWidth: function() { return 20 } } } } } }
    )
    var result = menu({ __noprint: true })
    return { store: store, writes: writes, errors: errors, result: result }
  }

  exports.testRenamePreservesDefinitions = function() {
    var definitions = { alpha: { type: "ollama", model: "first" }, beta: { type: "ollama", model: "second" } }
    var same = runMenu(definitions, ["Rename definition", "alpha", "Go back"], ["alpha"])
    ow.test.assert(same.store, definitions, "Renaming to the same name must not delete the definition")
    ow.test.assert(same.writes.length, 0, "Same-name rename is a no-op")
    var collision = runMenu(definitions, ["Rename definition", "alpha", "Go back"], ["beta"])
    ow.test.assert(collision.store, definitions, "Rename must not overwrite another saved definition")
    ow.test.assert(collision.errors.length, 1, "Name collision is reported")
    var renamed = runMenu(definitions, ["Rename definition", "alpha", "Go back"], ["gamma"])
    ow.test.assert(renamed.store.gamma, definitions.alpha, "Renaming to an unused name succeeds")
    ow.test.assert(isUnDef(renamed.store.alpha), true, "Successful rename removes the old name")
    ow.test.assert(renamed.store.beta, definitions.beta, "Other definitions remain untouched")
  }

  exports.testImportDoesNotSelectModel = function() {
    var imported = { type: "ollama", model: "imported" }
    var result = runMenu({}, ["Import definition", "Go back"], ["new", stringify(imported, __, "")])
    ow.test.assert(result.store["new"], imported, "Import stores the model")
    ow.test.assert(isUnDef(result.result), true, "Going back after import must not select a replacement session model")
    var selected = runMenu({}, ["Import definition", "🤖 new"], ["new", stringify(imported, __, "")])
    ow.test.assert(selected.result, imported, "Explicit selection returns the imported definition")
  }
})()
