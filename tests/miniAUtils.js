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

  exports.testFileQuery = function() {
    var testDir = createTestDir()
    try {
      io.writeFileString(testDir + java.io.File.separator + "query.txt", "test content")

      var tool = new MiniUtilsTool(testDir)

      // Test read operation
      var result1 = tool.fileQuery({ operation: "read", path: "query.txt" })
      ow.test.assert(isMap(result1) && result1.content === "test content", true, "Should route to readFile")

      // Test list operation
      var result2 = tool.fileQuery({ operation: "list" })
      ow.test.assert(isArray(result2), true, "Should route to listDirectory")

      // Test info operation
      var result3 = tool.fileQuery({ operation: "info", path: "query.txt" })
      ow.test.assert(isMap(result3) && result3.isFile === true, true, "Should route to getFileInfo")

      // Test search operation
      var result4 = tool.fileQuery({ operation: "search", pattern: "test" })
      ow.test.assert(isArray(result4), true, "Should route to searchContent")

      // Test operation aliases
      var result5 = tool.fileQuery({ operation: "get", path: "query.txt" })
      ow.test.assert(isMap(result5) && result5.content === "test content", true, "Should support operation aliases")

      // Test unknown operation
      var result6 = tool.fileQuery({ operation: "unknown" })
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
      var result1 = tool.fileModify({ operation: "write", path: "modify.txt", content: "initial" })
      ow.test.assert(isMap(result1), true, "Should route to writeFile")
      ow.test.assert(io.readFileString(testDir + java.io.File.separator + "modify.txt") === "initial", true, "File should be written")

      // Test append operation (should set append automatically)
      var result2 = tool.fileModify({ operation: "append", path: "modify.txt", content: " more" })
      ow.test.assert(io.readFileString(testDir + java.io.File.separator + "modify.txt") === "initial more", true, "Should append content")

      // Test delete operation
      var result3 = tool.fileModify({ operation: "delete", path: "modify.txt", confirm: true })
      ow.test.assert(result3.deleted === true, true, "Should route to deleteFile")

      // Test operation aliases
      io.writeFileString(testDir + java.io.File.separator + "alias.txt", "test")
      var result4 = tool.fileModify({ operation: "rm", path: "alias.txt", confirm: true })
      ow.test.assert(result4.deleted === true, true, "Should support operation aliases")

      // Test unknown operation
      var result5 = tool.fileModify({ operation: "unknown", path: "test" })
      ow.test.assert(isString(result5) && result5.indexOf("[ERROR]") === 0, true, "Should error for unknown operation")

      // Test missing operation
      var result6 = tool.fileModify({ path: "test", content: "test" })
      ow.test.assert(isString(result6) && result6.indexOf("[ERROR]") === 0, true, "Should error without operation")
    } finally {
      cleanupTestDir(testDir)
    }
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
    ow.test.assert(isDef(metadata.fileQuery), true, "Should include fileQuery metadata")
    ow.test.assert(isDef(metadata.fileModify), true, "Should include fileModify metadata")

    var methods = MiniUtilsTool.getExposedMethodNames()
    ow.test.assert(isArray(methods), true, "Should return method names array")
    ow.test.assert(methods.indexOf("init") >= 0, true, "Should include init method")
    ow.test.assert(methods.indexOf("fileQuery") >= 0, true, "Should include fileQuery method")
    ow.test.assert(methods.indexOf("fileModify") >= 0, true, "Should include fileModify method")
  }
})()
