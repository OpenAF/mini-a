// Optional integration: OAF_JARGS=-Djava.awt.headless=true oaf -f tests/documentReading.js
// Set MINI_A_TEST_TIKA_PATH to an existing checkout to test without installation.
load("mini-a-utils.js")
ow.loadTest()
try {
  var tikaPath = getEnv("MINI_A_TEST_TIKA_PATH")
  if (isString(tikaPath) && tikaPath.length > 0) {
    loadExternalJars(tikaPath)
    load(tikaPath + "/tika.js")
  } else {
    includeOPack("Tika")
    loadLib("tika.js")
  }
  var tool = new MiniUtilsTool({ root: "tests/fixtures/documents" })
  ;["docx", "xlsx", "pdf"].forEach(function(ext) {
    var result = tool.readDocument({ path: "sample." + ext })
    ow.test.assert(isMap(result), true, "Read " + ext + ": " + stringify(result))
    ow.test.assert(result.text.indexOf("Hello OpenAF " + ext.toUpperCase()) >= 0, true, "Extract " + ext + " content")
    ow.test.assert(result.truncated, false, "Complete small document")
    ow.test.assert(isMap(result.metadata), true, "Preserve metadata")
    var limited = tool.readDocument({ path: "sample." + ext, maxChars: 5 })
    ow.test.assert(limited.truncated, true, "Report " + ext + " truncation")
    ow.test.assert(limited.text.length <= 5, true, "Bound " + ext + " text")
  })
  print("PASS: DOCX, XLSX and PDF extraction and truncation")
} catch(e) {
  printErr(e)
  exit(1)
}
