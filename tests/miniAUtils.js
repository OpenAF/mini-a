(function() {
  load("mini-a-utils.js")

  // Helper to create a test directory
  var createTestDir = function() {
    var testDir = java.io.File.createTempFile("miniutils-test-", "").getCanonicalPath()
    io.rm(testDir)
    io.mkdir(testDir)
    return testDir
  }

  // Helper to cleanup test directory
  var cleanupTestDir = function(dir) {
    try {
      io.rm(dir)
    } catch(e) {
      // Ignore cleanup errors
    }
  }

  exports.testInit = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool()
      var result = tool.init(testDir)
      ow.test.assert(isMap(result), true, "Init should return the tool instance")
      ow.test.assert(tool._initialized === true, true, "Tool should be initialized")
      ow.test.assert(tool._root !== null, true, "Root should be set")

      // Test init with object
      var tool2 = new MiniUtilsTool()
      var result2 = tool2.init({ root: testDir, readwrite: true })
      ow.test.assert(tool2._readWrite === true, true, "Readwrite mode should be set")

      // Test init with invalid path
      var tool3 = new MiniUtilsTool()
      var result3 = tool3.init("/nonexistent/path/that/does/not/exist")
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should return error for invalid path")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testReadFile = function() {
    var testDir = createTestDir()
    try {
      var testFile = testDir + java.io.File.separator + "test.txt"
      io.writeFileString(testFile, "Hello World")

      var tool = new MiniUtilsTool(testDir)
      var result = tool.readFile({ path: "test.txt" })
      ow.test.assert(isMap(result), true, "Should return file info object")
      ow.test.assert(result.content === "Hello World", true, "Should read file content")
      ow.test.assert(result.relativePath === "test.txt", true, "Should include relative path")

      // Test reading non-existent file
      var result2 = tool.readFile({ path: "missing.txt" })
      ow.test.assert(isString(result2) && result2.indexOf("[ERROR]") === 0, true, "Should error for missing file")

      // Test without path
      var result3 = tool.readFile({})
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should error without path")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testReadFileRanges = function() {
    var testDir = createTestDir()
    try {
      var testFile = testDir + java.io.File.separator + "lines.txt"
      io.writeFileString(testFile, "line1\nline2\nline3")

      var tool = new MiniUtilsTool(testDir)

      // Count lines without reading full content
      var countResult = tool.readFile({ path: "lines.txt", countLines: true })
      ow.test.assert(countResult.linesTotal === 3, true, "Should report total line count")
      ow.test.assert(countResult.content === "", true, "Should omit content when only counting lines")

      // Read line window with total count
      var windowResult = tool.readFile({ path: "lines.txt", lineStart: 2, maxLines: 1, countLines: true })
      ow.test.assert(isMap(windowResult), true, "Should return map for line window (got: " + windowResult + ")")
      ow.test.assert(String(windowResult.content).trim() === "line2", true, "Should read line window (got: " + windowResult.content + ")")
      ow.test.assert(windowResult.linesRead === 1, true, "Should report lines read")
      ow.test.assert(windowResult.linesTotal === 3, true, "Should report total lines with window read")

      // Read byte range
      var byteFile = testDir + java.io.File.separator + "bytes.txt"
      io.writeFileString(byteFile, "HelloWorld")
      var byteResult = tool.readFile({ path: "bytes.txt", byteStart: 5, byteLength: 5 })
      ow.test.assert(isMap(byteResult), true, "Should return map for byte range (got: " + byteResult + ")")
      ow.test.assert(byteResult.content === "World", true, "Should read byte range (got: " + byteResult.content + ")")
      ow.test.assert(byteResult.bytesRead === 5, true, "Should report bytes read")
      ow.test.assert(byteResult.byteStart === 5, true, "Should report byteStart")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testWriteFile = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool({ root: testDir, readwrite: true })

      var result = tool.writeFile({ path: "new.txt", content: "Test content" })
      ow.test.assert(isMap(result), true, "Should return file info object")
      ow.test.assert(result.relativePath === "new.txt", true, "Should include relative path")

      var content = io.readFileString(testDir + java.io.File.separator + "new.txt")
      ow.test.assert(content === "Test content", true, "File should be written with correct content")

      // Test append mode
      var result2 = tool.writeFile({ path: "new.txt", content: " appended", append: true })
      var content2 = io.readFileString(testDir + java.io.File.separator + "new.txt")
      ow.test.assert(content2 === "Test content appended", true, "Append should work")

      // Test read-only mode
      var toolReadOnly = new MiniUtilsTool(testDir)
      var result3 = toolReadOnly.writeFile({ path: "readonly.txt", content: "test" })
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should error in read-only mode")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testListDirectory = function() {
    var testDir = createTestDir()
    try {
      io.writeFileString(testDir + java.io.File.separator + "file1.txt", "content1")
      io.writeFileString(testDir + java.io.File.separator + "file2.txt", "content2")
      io.mkdir(testDir + java.io.File.separator + "subdir")
      io.writeFileString(testDir + java.io.File.separator + "subdir" + java.io.File.separator + "file3.txt", "content3")
      io.writeFileString(testDir + java.io.File.separator + ".hidden", "hidden")

      var tool = new MiniUtilsTool(testDir)

      // Test basic listing
      var result = tool.listDirectory({})
      ow.test.assert(isArray(result), true, "Should return array")
      ow.test.assert(result.length >= 2, true, "Should list visible files and dirs")

      // Test with hidden files
      var result2 = tool.listDirectory({ includeHidden: true })
      ow.test.assert(result2.length > result.length, true, "Should include hidden files when requested")

      // Test recursive listing
      var result3 = tool.listDirectory({ recursive: true })
      ow.test.assert(isArray(result3), true, "Should return array for recursive")
      var hasSubdirFile = result3.some(function(entry) {
        return entry.filename === "file3.txt"
      })
      ow.test.assert(hasSubdirFile === true, true, "Recursive should include nested files")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testSearchContent = function() {
    var testDir = createTestDir()
    try {
      io.writeFileString(testDir + java.io.File.separator + "file1.txt", "Hello World\nFoo Bar")
      io.writeFileString(testDir + java.io.File.separator + "file2.txt", "No match here")
      io.mkdir(testDir + java.io.File.separator + "subdir")
      io.writeFileString(testDir + java.io.File.separator + "subdir" + java.io.File.separator + "file3.txt", "Hello again")

      var tool = new MiniUtilsTool(testDir)

      // Test basic search
      var result = tool.searchContent({ pattern: "Hello" })
      ow.test.assert(isArray(result), true, "Should return array")
      ow.test.assert(result.length === 2, true, "Should find pattern in multiple files")
      ow.test.assert(isDef(result[0].line), true, "Should include line number")
      ow.test.assert(isDef(result[0].preview), true, "Should include preview")

      // Test case-sensitive search
      var result2 = tool.searchContent({ pattern: "hello", caseSensitive: true })
      ow.test.assert(result2.length === 0, true, "Case-sensitive should not match different case")

      // Test regex search
      var result3 = tool.searchContent({ pattern: "H\\w+o", regex: true })
      ow.test.assert(result3.length === 2, true, "Regex should work")

      // Test maxResults
      var result4 = tool.searchContent({ pattern: "Hello", maxResults: 1 })
      ow.test.assert(result4.length === 1, true, "Should respect maxResults")

      // Test without pattern
      var result5 = tool.searchContent({})
      ow.test.assert(isString(result5) && result5.indexOf("[ERROR]") === 0, true, "Should error without pattern")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testGetFileInfo = function() {
    var testDir = createTestDir()
    try {
      var testFile = testDir + java.io.File.separator + "info.txt"
      io.writeFileString(testFile, "content")

      var tool = new MiniUtilsTool(testDir)
      var result = tool.getFileInfo({ path: "info.txt" })
      ow.test.assert(isMap(result), true, "Should return file info object")
      ow.test.assert(result.relativePath === "info.txt", true, "Should include relative path")
      ow.test.assert(result.isFile === true, true, "Should identify as file")

      // Test directory info
      io.mkdir(testDir + java.io.File.separator + "testdir")
      var result2 = tool.getFileInfo({ path: "testdir" })
      ow.test.assert(result2.isDirectory === true, true, "Should identify as directory")

      // Test non-existent path
      var result3 = tool.getFileInfo({ path: "missing" })
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should error for missing path")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testDeleteFile = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool({ root: testDir, readwrite: true })

      // Create test file
      io.writeFileString(testDir + java.io.File.separator + "delete.txt", "to delete")

      // Test delete without confirm
      var result1 = tool.deleteFile({ path: "delete.txt" })
      ow.test.assert(isString(result1) && result1.indexOf("[ERROR]") === 0, true, "Should error without confirm")

      // Test delete with confirm
      var result2 = tool.deleteFile({ path: "delete.txt", confirm: true })
      ow.test.assert(isMap(result2), true, "Should return delete info")
      ow.test.assert(result2.deleted === true, true, "Should confirm deletion")
      ow.test.assert(!io.fileExists(testDir + java.io.File.separator + "delete.txt"), true, "File should be deleted")

      // Test delete directory without recursive
      io.mkdir(testDir + java.io.File.separator + "testdir")
      var result3 = tool.deleteFile({ path: "testdir", confirm: true })
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should error for directory without recursive")

      // Test delete directory with recursive
      io.writeFileString(testDir + java.io.File.separator + "testdir" + java.io.File.separator + "nested.txt", "nested")
      var result4 = tool.deleteFile({ path: "testdir", confirm: true, recursive: true })
      ow.test.assert(result4.deleted === true, true, "Should delete directory recursively")
      ow.test.assert(!io.fileExists(testDir + java.io.File.separator + "testdir"), true, "Directory should be deleted")

      // Test read-only mode
      var toolReadOnly = new MiniUtilsTool(testDir)
      io.writeFileString(testDir + java.io.File.separator + "readonly.txt", "test")
      var result5 = toolReadOnly.deleteFile({ path: "readonly.txt", confirm: true })
      ow.test.assert(isString(result5) && result5.indexOf("[ERROR]") === 0, true, "Should error in read-only mode")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testFileOps = function() {
    var testDir = createTestDir()
    try {
      io.writeFileString(testDir + java.io.File.separator + "query.txt", "test content")

      var tool = new MiniUtilsTool(testDir)

      // Test read operation
      var result1 = tool.filesystemQuery({ operation: "read", path: "query.txt" })
      ow.test.assert(isMap(result1) && result1.content === "test content", true, "Should route to readFile")

      // Test list operation
      var result2 = tool.filesystemQuery({ operation: "list" })
      ow.test.assert(isArray(result2), true, "Should route to listDirectory")

      // Test info operation
      var result3 = tool.filesystemQuery({ operation: "info", path: "query.txt" })
      ow.test.assert(isMap(result3) && result3.isFile === true, true, "Should route to getFileInfo")

      // Test search operation
      var result4 = tool.filesystemQuery({ operation: "search", pattern: "test" })
      ow.test.assert(isArray(result4), true, "Should route to searchContent")

      // Test operation aliases
      var result5 = tool.filesystemQuery({ operation: "get", path: "query.txt" })
      ow.test.assert(isMap(result5) && result5.content === "test content", true, "Should support operation aliases")

      // Test unknown operation
      var result6 = tool.filesystemQuery({ operation: "unknown" })
      ow.test.assert(isString(result6) && result6.indexOf("[ERROR]") === 0, true, "Should error for unknown operation")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testFileModify = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool({ root: testDir, readwrite: true })

      // Test write operation
      var result1 = tool.filesystemModify({ operation: "write", path: "modify.txt", content: "initial" })
      ow.test.assert(isMap(result1), true, "Should route to writeFile")
      ow.test.assert(io.readFileString(testDir + java.io.File.separator + "modify.txt") === "initial", true, "File should be written")

      // Test append operation (should set append automatically)
      var result2 = tool.filesystemModify({ operation: "append", path: "modify.txt", content: " more" })
      ow.test.assert(io.readFileString(testDir + java.io.File.separator + "modify.txt") === "initial more", true, "Should append content")

      // Test delete operation
      var result3 = tool.filesystemModify({ operation: "delete", path: "modify.txt", confirm: true })
      ow.test.assert(result3.deleted === true, true, "Should route to deleteFile")

      // Test operation aliases
      io.writeFileString(testDir + java.io.File.separator + "alias.txt", "test")
      var result4 = tool.filesystemModify({ operation: "rm", path: "alias.txt", confirm: true })
      ow.test.assert(result4.deleted === true, true, "Should support operation aliases")

      // Test unknown operation
      var result5 = tool.filesystemModify({ operation: "unknown", path: "test" })
      ow.test.assert(isString(result5) && result5.indexOf("[ERROR]") === 0, true, "Should error for unknown operation")

      // Test missing operation
      var result6 = tool.filesystemModify({ path: "test", content: "test" })
      ow.test.assert(isString(result6) && result6.indexOf("[ERROR]") === 0, true, "Should error without operation")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testGlobQuery = function() {
    var testDir = createTestDir()
    try {
      io.writeFileString(testDir + java.io.File.separator + "alpha.txt", "alpha")
      io.writeFileString(testDir + java.io.File.separator + "beta.log", "beta")
      io.mkdir(testDir + java.io.File.separator + "nested")
      io.writeFileString(testDir + java.io.File.separator + "nested" + java.io.File.separator + "gamma.txt", "gamma")

      var tool = new MiniUtilsTool(testDir)
      var result = tool.filesystemQuery({ operation: "glob", pattern: "**/*.txt" })
      ow.test.assert(isArray(result), true, "Glob should return array")
      ow.test.assert(result.length === 2, true, "Glob should match txt files")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testEditFile = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool({ root: testDir, readwrite: true })
      io.writeFileString(testDir + java.io.File.separator + "edit.txt", "Hello World")

      var result = tool.filesystemModify({
        operation: "edit",
        path: "edit.txt",
        pattern: "World",
        replacement: "Mini-A"
      })
      ow.test.assert(isMap(result), true, "Edit should return result object")
      ow.test.assert(result.replacements === 1, true, "Edit should report replacements")
      var content = io.readFileString(testDir + java.io.File.separator + "edit.txt")
      ow.test.assert(content === "Hello Mini-A", true, "Edit should update file content")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testWebFetch = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool()
      var testFile = testDir + java.io.File.separator + "web.txt"
      io.writeFileString(testFile, "Web Fetch Content")
      var url = new java.io.File(testFile).toURI().toURL().toString()

      var result = tool.textUtilities({ operation: "webfetch", url: url })
      ow.test.assert(isMap(result), true, "Webfetch should return result object")
      ow.test.assert(result.body.indexOf("Web Fetch Content") >= 0, true, "Webfetch should read content")
    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testTodoOps = function() {
    var tool = new MiniUtilsTool()

    var writeResult = tool.kvStore({ operation: "todo-write", items: ["first", "second"] })
    ow.test.assert(writeResult.count === 2, true, "Should write todo items")

    var appendResult = tool.kvStore({ operation: "todo-write", item: "third", append: true })
    ow.test.assert(appendResult.count === 3, true, "Should append todo items")

    var readResult = tool.kvStore({ operation: "todo-read" })
    ow.test.assert(readResult.count === 3, true, "Should read todo items")
  }

  exports.testPathSecurity = function() {
    var testDir = createTestDir()
    var outsideDir = createTestDir()
    try {
      io.writeFileString(outsideDir + java.io.File.separator + "outside.txt", "outside")

      var tool = new MiniUtilsTool(testDir)

      // Test reading file outside root
      var absolutePath = outsideDir + java.io.File.separator + "outside.txt"
      var result1 = tool.readFile({ path: absolutePath })
      ow.test.assert(isString(result1) && result1.indexOf("[ERROR]") === 0, true, "Should block access outside root")

      // Test path traversal attempt
      var result2 = tool.readFile({ path: "../../etc/passwd" })
      ow.test.assert(isString(result2) && result2.indexOf("[ERROR]") === 0, true, "Should block path traversal")

      // Test listing outside root
      var result3 = tool.listDirectory({ path: absolutePath })
      ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should block listing outside root")
    } finally {
      cleanupTestDir(testDir)
      cleanupTestDir(outsideDir)
    }
  }

  exports.testMetadata = function() {
    var metadata = MiniUtilsTool.getMetadataByFn()
    ow.test.assert(isMap(metadata), true, "Should return metadata map")
    ow.test.assert(isDef(metadata.init), true, "Should include init metadata")
    ow.test.assert(isDef(metadata.filesystemQuery), true, "Should include filesystemQuery metadata")
    ow.test.assert(isDef(metadata.filesystemModify), true, "Should include filesystemModify metadata")
    ow.test.assert(isDef(metadata.mathematics), true, "Should include mathematics metadata")
    ow.test.assert(isDef(metadata.timeUtilities), true, "Should include timeUtilities metadata")

    var methods = MiniUtilsTool.getExposedMethodNames()
    ow.test.assert(isArray(methods), true, "Should return method names array")
    ow.test.assert(methods.indexOf("init") >= 0, true, "Should include init method")
    ow.test.assert(methods.indexOf("filesystemQuery") >= 0, true, "Should include filesystemQuery method")
    ow.test.assert(methods.indexOf("filesystemModify") >= 0, true, "Should include filesystemModify method")
    ow.test.assert(methods.indexOf("mathematics") >= 0, true, "Should include mathematics method")
    ow.test.assert(methods.indexOf("timeUtilities") >= 0, true, "Should include timeUtilities method")

    var queryOps = metadata.filesystemQuery.inputSchema.properties.operation.enum || []
    ow.test.assert(queryOps.indexOf("glob") >= 0, true, "Should include glob operation in filesystemQuery")
    var modifyOps = metadata.filesystemModify.inputSchema.properties.operation.enum || []
    ow.test.assert(modifyOps.indexOf("edit") >= 0, true, "Should include edit operation in filesystemModify")
    var textOps = metadata.textUtilities.inputSchema.properties.operation.enum || []
    ow.test.assert(textOps.indexOf("webfetch") >= 0, true, "Should include webfetch operation in textUtilities")
    var kvOps = metadata.kvStore.inputSchema.properties.operation.enum || []
    ow.test.assert(kvOps.indexOf("todo-write") >= 0, true, "Should include todo-write operation in kvStore")
  }

  exports.testMathOpsCalculate = function() {
    var tool = new MiniUtilsTool()

    // Test addition
    var result1 = tool.mathematics({ operation: "calculate", op: "add", values: [1, 2, 3, 4] })
    ow.test.assert(result1.result === 10, true, "Should add values correctly")

    // Test subtraction
    var result2 = tool.mathematics({ operation: "calculate", op: "subtract", values: [10, 3, 2] })
    ow.test.assert(result2.result === 5, true, "Should subtract values correctly")

    // Test multiplication
    var result3 = tool.mathematics({ operation: "calculate", op: "multiply", values: [2, 3, 4] })
    ow.test.assert(result3.result === 24, true, "Should multiply values correctly")

    // Test division
    var result4 = tool.mathematics({ operation: "calculate", op: "divide", values: [20, 2, 5] })
    ow.test.assert(result4.result === 2, true, "Should divide values correctly")

    // Test power
    var result5 = tool.mathematics({ operation: "calculate", op: "power", values: [2, 3] })
    ow.test.assert(result5.result === 8, true, "Should calculate power correctly")

    // Test square root
    var result6 = tool.mathematics({ operation: "calculate", op: "sqrt", values: [16] })
    ow.test.assert(result6.result === 4, true, "Should calculate square root correctly")

    // Test absolute value
    var result7 = tool.mathematics({ operation: "calculate", op: "abs", values: [-5] })
    ow.test.assert(result7.result === 5, true, "Should calculate absolute value correctly")

    // Test rounding
    var result8 = tool.mathematics({ operation: "calculate", op: "round", values: [3.7] })
    ow.test.assert(result8.result === 4, true, "Should round values correctly")

    // Test precision
    var result9 = tool.mathematics({ operation: "calculate", op: "divide", values: [10, 3], precision: 2 })
    ow.test.assert(result9.result === 3.33, true, "Should respect precision parameter")

    // Test empty values
    var result10 = tool.mathematics({ operation: "calculate", op: "add", values: [] })
    ow.test.assert(isString(result10) && result10.indexOf("[ERROR]") === 0, true, "Should error with empty values")

    // Test unknown operation
    var result11 = tool.mathematics({ operation: "calculate", op: "unknown", values: [1, 2] })
    ow.test.assert(isString(result11) && result11.indexOf("[ERROR]") === 0, true, "Should error with unknown operation")
  }

  exports.testMathOpsStatistics = function() {
    var tool = new MiniUtilsTool()

    // Test full statistics
    var result1 = tool.mathematics({ operation: "statistics", values: [1, 2, 3, 4, 5] })
    ow.test.assert(result1.count === 5, true, "Should calculate count correctly")
    ow.test.assert(result1.sum === 15, true, "Should calculate sum correctly")
    ow.test.assert(result1.mean === 3, true, "Should calculate mean correctly")
    ow.test.assert(result1.median === 3, true, "Should calculate median correctly")
    ow.test.assert(result1.min === 1, true, "Should calculate min correctly")
    ow.test.assert(result1.max === 5, true, "Should calculate max correctly")

    // Test median with even count
    var result2 = tool.mathematics({ operation: "statistics", values: [1, 2, 3, 4] })
    ow.test.assert(result2.median === 2.5, true, "Should calculate median correctly for even count")

    // Test specific metrics
    var result3 = tool.mathematics({ operation: "statistics", values: [10, 20, 30], metrics: ["mean", "max"] })
    ow.test.assert(result3.mean === 20, true, "Should include requested mean metric")
    ow.test.assert(result3.max === 30, true, "Should include requested max metric")
    ow.test.assert(isUnDef(result3.min), true, "Should not include unrequested min metric")

    // Test empty values
    var result4 = tool.mathematics({ operation: "statistics", values: [] })
    ow.test.assert(isString(result4) && result4.indexOf("[ERROR]") === 0, true, "Should error with empty values")
  }

  exports.testMathOpsConvert = function() {
    var tool = new MiniUtilsTool()

    // Test length conversion
    var result1 = tool.mathematics({ operation: "convert-unit", value: 1, fromUnit: "km", toUnit: "m" })
    ow.test.assert(result1.result === 1000, true, "Should convert km to m correctly")

    var result2 = tool.mathematics({ operation: "convert-unit", value: 100, fromUnit: "cm", toUnit: "m" })
    ow.test.assert(result2.result === 1, true, "Should convert cm to m correctly")

    // Test weight conversion
    var result3 = tool.mathematics({ operation: "convert-unit", value: 1, fromUnit: "kg", toUnit: "g" })
    ow.test.assert(result3.result === 1000, true, "Should convert kg to g correctly")

    // Test volume conversion
    var result4 = tool.mathematics({ operation: "convert-unit", value: 1, fromUnit: "l", toUnit: "ml" })
    ow.test.assert(result4.result === 1000, true, "Should convert l to ml correctly")

    // Test precision
    var result5 = tool.mathematics({ operation: "convert-unit", value: 1, fromUnit: "mi", toUnit: "km", precision: 2 })
    ow.test.assert(result5.result === 1.61, true, "Should respect precision in conversion")

    // Test unknown unit
    var result6 = tool.mathematics({ operation: "convert-unit", value: 1, fromUnit: "unknown", toUnit: "m" })
    ow.test.assert(isString(result6) && result6.indexOf("[ERROR]") === 0, true, "Should error with unknown unit")

    // Test convert alias
    var result7 = tool.mathematics({ operation: "convert", value: 1, fromUnit: "km", toUnit: "m" })
    ow.test.assert(result7.result === 1000, true, "Should support 'convert' operation alias")
  }

  exports.testMathOpsRandom = function() {
    var tool = new MiniUtilsTool()

    // Test random integer with seed (deterministic)
    var result1 = tool.mathematics({ operation: "random", type: "integer", min: 1, max: 10, seed: 12345 })
    ow.test.assert(isDef(result1.value), true, "Should generate random integer")
    ow.test.assert(result1.value >= 1 && result1.value <= 10, true, "Random integer should be in range")
    ow.test.assert(result1.seed === 12345, true, "Should include seed in result")

    // Test random integer without seed
    var result2 = tool.mathematics({ operation: "random", type: "integer", min: 0, max: 100 })
    ow.test.assert(result2.value >= 0 && result2.value <= 100, true, "Random integer should be in range")

    // Test random sequence
    var result3 = tool.mathematics({ operation: "random", type: "sequence", start: 1, end: 5, count: 3, seed: 67890 })
    ow.test.assert(isArray(result3.sequence), true, "Should return sequence array")
    ow.test.assert(result3.sequence.length === 3, true, "Should return requested count")

    // Test random choice
    var result4 = tool.mathematics({ operation: "random", type: "choice", items: ["a", "b", "c"], count: 2, seed: 11111 })
    ow.test.assert(isArray(result4.choices), true, "Should return choices array")
    ow.test.assert(result4.choices.length === 2, true, "Should return requested count of choices")

    // Test random choice with unique
    var result5 = tool.mathematics({ operation: "random", type: "choice", items: [1, 2, 3, 4, 5], count: 3, unique: true, seed: 22222 })
    ow.test.assert(result5.choices.length === 3, true, "Should return unique choices")
    var uniqueCheck = {}
    result5.choices.forEach(function(c) { uniqueCheck[c] = true })
    ow.test.assert(Object.keys(uniqueCheck).length === 3, true, "Choices should be unique")

    // Test random boolean
    var result6 = tool.mathematics({ operation: "random", type: "boolean", count: 10, probabilityTrue: 0.5, seed: 33333 })
    ow.test.assert(isArray(result6.values), true, "Should return boolean array")
    ow.test.assert(result6.values.length === 10, true, "Should return requested count of booleans")

    // Test random hex
    var result7 = tool.mathematics({ operation: "random", type: "hex", length: 16, seed: 44444 })
    ow.test.assert(isString(result7.value), true, "Should return hex string")
    ow.test.assert(result7.value.length === 16, true, "Hex string should have requested length")

    // Test random hex uppercase
    var result8 = tool.mathematics({ operation: "random", type: "hex", length: 8, uppercase: true, seed: 55555 })
    ow.test.assert(result8.value === result8.value.toUpperCase(), true, "Should generate uppercase hex")

    // Test error conditions
    var result9 = tool.mathematics({ operation: "random", type: "integer", min: 10, max: 5 })
    ow.test.assert(isString(result9) && result9.indexOf("[ERROR]") === 0, true, "Should error when min > max")

    var result10 = tool.mathematics({ operation: "random", type: "choice", items: [] })
    ow.test.assert(isString(result10) && result10.indexOf("[ERROR]") === 0, true, "Should error with empty items")

    var result11 = tool.mathematics({ operation: "random", type: "unknown" })
    ow.test.assert(isString(result11) && result11.indexOf("[ERROR]") === 0, true, "Should error with unknown type")
  }

  exports.testTimeOpsCurrentTime = function() {
    var tool = new MiniUtilsTool()

    // Test current time
    var result1 = tool.timeUtilities({ operation: "current-time" })
    ow.test.assert(isDef(result1.timezone), true, "Should return timezone")
    ow.test.assert(isDef(result1.iso8601), true, "Should return ISO8601 format")
    ow.test.assert(isDef(result1.formatted), true, "Should return formatted time")
    ow.test.assert(isDef(result1.unixEpochSeconds), true, "Should return unix epoch seconds")
    ow.test.assert(isDef(result1.unixEpochMilliseconds), true, "Should return unix epoch milliseconds")
    ow.test.assert(result1.unixEpochSeconds > 0, true, "Unix epoch should be positive")

    // Test with specific timezone
    var result2 = tool.timeUtilities({ operation: "current-time", timezone: "America/New_York" })
    ow.test.assert(result2.timezone === "America/New_York", true, "Should use specified timezone")

    // Test with custom format
    var result3 = tool.timeUtilities({ operation: "current-time", format: "yyyy-MM-dd" })
    ow.test.assert(isDef(result3.formatted), true, "Should format with custom pattern")
    ow.test.assert(result3.formatted.indexOf("-") > 0, true, "Formatted date should match pattern")

    // Test current alias
    var result4 = tool.timeUtilities({ operation: "current" })
    ow.test.assert(isDef(result4.iso8601), true, "Should support 'current' operation alias")
  }

  exports.testTimeOpsConvert = function() {
    var tool = new MiniUtilsTool()

    // Test timezone conversion
    var result1 = tool.timeUtilities({
      operation: "convert",
      targetTimezone: "Europe/London",
      sourceTimezone: "America/New_York"
    })
    ow.test.assert(isDef(result1.sourceTimezone), true, "Should return source timezone")
    ow.test.assert(isDef(result1.targetTimezone), true, "Should return target timezone")
    ow.test.assert(isDef(result1.sourceIso8601), true, "Should return source ISO8601")
    ow.test.assert(isDef(result1.targetIso8601), true, "Should return target ISO8601")
    ow.test.assert(result1.targetTimezone === "Europe/London", true, "Should convert to target timezone")

    // Test conversion with specific datetime
    var result2 = tool.timeUtilities({
      operation: "convert",
      datetime: "2024-01-01T12:00:00-05:00",
      targetTimezone: "UTC"
    })
    ow.test.assert(isDef(result2.targetIso8601), true, "Should convert specific datetime")

    // Test missing targetTimezone
    var result3 = tool.timeUtilities({ operation: "convert" })
    ow.test.assert(isString(result3) && result3.indexOf("[ERROR]") === 0, true, "Should error without targetTimezone")

    // Test timezone-convert alias
    var result4 = tool.timeUtilities({
      operation: "timezone-convert",
      targetTimezone: "UTC"
    })
    ow.test.assert(isDef(result4.targetIso8601), true, "Should support 'timezone-convert' operation alias")
  }

  exports.testTimeOpsSleep = function() {
    var tool = new MiniUtilsTool()

    // Test sleep
    var start = new Date().getTime()
    var result1 = tool.timeUtilities({ operation: "sleep", milliseconds: 100 })
    var elapsed = new Date().getTime() - start
    ow.test.assert(result1.sleptMilliseconds === 100, true, "Should return slept duration")
    ow.test.assert(elapsed >= 100, true, "Should actually sleep for requested duration")

    // Test negative sleep
    var result2 = tool.timeUtilities({ operation: "sleep", milliseconds: -1 })
    ow.test.assert(isString(result2) && result2.indexOf("[ERROR]") === 0, true, "Should error with negative milliseconds")
  }

  exports.testEncodingAndAdvancedParams = function() {
    var testDir = createTestDir()
    try {
      var tool = new MiniUtilsTool({ root: testDir, readwrite: true })

      // Test UTF-8 encoding (default)
      var utf8Content = "Hello UTF-8: こんにちは"
      tool.writeFile({ path: "utf8.txt", content: utf8Content })
      var result1 = tool.readFile({ path: "utf8.txt" })
      ow.test.assert(result1.content === utf8Content, true, "Should handle UTF-8 encoding")
      ow.test.assert(result1.encoding === "utf-8", true, "Should report UTF-8 encoding")

      // Test createMissingDirs (default true)
      var result2 = tool.writeFile({ path: "nested/deep/file.txt", content: "nested content" })
      ow.test.assert(isMap(result2), true, "Should create missing directories by default")
      ow.test.assert(io.fileExists(testDir + java.io.File.separator + "nested" + java.io.File.separator + "deep" + java.io.File.separator + "file.txt"), true, "File should exist in nested directory")

      // Test explicit createMissingDirs = true
      var result3 = tool.writeFile({ path: "another/nested/path/file.txt", content: "test", createMissingDirs: true })
      ow.test.assert(isMap(result3), true, "Should create missing directories when explicitly true")
      ow.test.assert(io.fileExists(testDir + java.io.File.separator + "another" + java.io.File.separator + "nested" + java.io.File.separator + "path" + java.io.File.separator + "file.txt"), true, "File should exist in nested directory")

      // Test contentLength in writeFile response
      var result4 = tool.writeFile({ path: "length.txt", content: "12345" })
      ow.test.assert(result4.contentLength === 5, true, "Should report content length")

      // Test append flag reporting
      var result5 = tool.writeFile({ path: "append-test.txt", content: "initial", append: false })
      ow.test.assert(result5.append === false, true, "Should report append=false")
      var result6 = tool.writeFile({ path: "append-test.txt", content: " more", append: true })
      ow.test.assert(result6.append === true, true, "Should report append=true")

    } finally {
      cleanupTestDir(testDir)
    }
  }

  exports.testMathOpsUnknownOperation = function() {
    var tool = new MiniUtilsTool()

    var result = tool.mathematics({ operation: "unknown-op" })
    ow.test.assert(isString(result) && result.indexOf("[ERROR]") === 0, true, "Should error with unknown operation")
  }
})()
