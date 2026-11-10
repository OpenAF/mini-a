(function() {
  var descriptor = io.readFileYAML("mcps/mcp-web.yaml")
  function job(name) {
    return descriptor.jobs.filter(function(entry) { return entry.name === name })[0]
  }
  var init = new Function("args", "global", job("Init web context").exec)
  var getUrl = new Function("args", "global", "WebSearch", "$rest", job("Get URL").exec)
  // Inject only the HTTP client into the installed, unchanged helper. Its Jsoup
  // parsing and cleaning run normally, and no fixture request reaches the network.
  var makeWebSearch = new Function("$rest", io.readFileString(getOPackPath("Jsoup") + "/webSearch.js") + "\nreturn WebSearch")
  var fixtureUrl = "https://192.0.2.10/fixture?one=1&two=2"
  var html = '<!doctype html><html><head><title>Fixture</title><script>removeMe()</script></head><body><p>Café &amp; 東京 <b>bold</b> &lt;safe&gt; &#169;</p><a href="https://example.org/path?a=1&amp;b=2" onclick="bad()">link</a><script>removeMeToo()</script></body></html>'
  var styles = [ __, "html", "basic", "text", "map" ]

  function check(actual, expected, message) {
    ow.test.assert(actual, expected, message)
  }
  function fixture(response, readwrite, failure) {
    var state = { calls: [] }, context = {}
    init({ readwrite: readwrite === true }, context)
    var rest = function() {
      return {
        get: function(url) {
          state.calls.push(url)
          if (isDef(failure)) throw failure
          return response
        }
      }
    }
    var WebSearch = makeWebSearch(rest)
    state.call = function(style, url) {
      var args = { url: isDef(url) ? url : fixtureUrl }
      if (isDef(style)) args.style = style
      return getUrl(args, context, WebSearch, rest)
    }
    return state
  }
  function fetch(style, response) {
    var f = fixture(response), result = f.call(style)
    check(f.calls, [ fixtureUrl ], String(style) + " fetches the original URL exactly once")
    return result
  }
  function normalized(value) {
    return jsonParse(stringify(value))
  }

  exports.testRawResponses = function() {
    [ __, "html" ].forEach(function(style) {
      check(fetch(style, html), html, String(style) + " preserves the exact HTML response")
      var response = { message: "Café & 東京", values: [ 1, 2 ] }
      check(fetch(style, response) === response, true, String(style) + " preserves raw response identity")
    })
  }

  exports.testStyledResponses = function() {
    check(fetch("basic", html), 'Fixture\n<p>Café &amp; 東京 <b>bold</b> &lt;safe&gt; ©</p>\n<a href="https://example.org/path?a=1&amp;b=2" rel="nofollow">link</a>', "basic retains allowed HTML and removes scripts and event handlers")
    // simpleText is Jsoup's existing safelist; allowed inline markup survives.
    check(fetch("text", html), 'FixtureCafé &amp; 東京 <b>bold</b> &lt;safe&gt; ©link', "text preserves the existing simpleText representation")
    check(normalized(fetch("map", html)), [ {
      id: "", tag: "html", isBlock: true, hasText: true, attrs: [], text: "", val: "",
      childs: [ [], [
        {
          id: "", tag: "p", isBlock: true, hasText: true, attrs: [],
          text: "Café & 東京  <safe> ©", val: "", childs: [ [] ], childsSize: 1
        },
        {
          id: "", tag: "a", isBlock: false, hasText: true,
          attrs: [ { href: "https://example.org/path?a=1&b=2" }, { rel: "nofollow" } ],
          text: "link", val: "", childs: [], childsSize: 0
        }
      ] ],
      childsSize: 2
    } ], "map preserves the helper's nested child arrays and decoded entities")
  }

  exports.testEmptyResponses = function() {
    styles.forEach(function(style) {
      var result = fetch(style, "")
      if (style === "map") {
        check(normalized(result), [ {
          id: "", tag: "html", isBlock: true, hasText: false, attrs: [], text: "", val: "",
          childs: [ [], [] ], childsSize: 2
        } ], "empty map retains the parsed HTML document structure")
      } else {
        check(result, "", String(style) + " preserves an empty response")
      }
    })
  }

  exports.testUrlPolicy = function() {
    [ "http://localhost/fixture", "http://127.0.0.1/fixture", "http://10.0.0.1/fixture", "http://169.254.1.1/fixture", "file:///tmp/fixture", "not a URL" ].forEach(function(url) {
      styles.forEach(function(style) {
        var f = fixture(html)
        check(f.call(style, url), "[ERROR] Read-only mode blocks localhost/private/non-http URLs", "URL policy blocks " + url + " with " + String(style))
        check(f.calls, [], "Blocked URL triggers zero requests")
      })
    })
    var f = fixture(html, true), url = "http://127.0.0.1/fixture"
    check(f.call("html", url), html, "readwrite retains local fixture opt-in")
    check(f.calls, [ url ], "Opted-in URL is fetched exactly once")
  }

  exports.testFetchErrors = function() {
    styles.forEach(function(style) {
      var failure = new Error("fixture fetch failed"), caught
      var f = fixture(html, false, failure)
      try { f.call(style) } catch(e) { caught = e }
      check(caught === failure, true, String(style) + " propagates the original fetch error")
      check(f.calls, [ fixtureUrl ], String(style) + " does not retry a failed fetch")
    })
  }

  exports.testSchema = function() {
    var httpSteps = descriptor.todo.filter(function(step) { return isDef(step["((then))"]) })[0]["((then))"]
    var metadata = httpSteps.filter(function(step) { return isDef(step["((fnsMeta))"]) })[0]["((fnsMeta))"]["get-url"]
    check(metadata.inputSchema.properties.style.default, "html", "Schema advertises the raw HTML default")
    check(metadata.inputSchema.required, [ "url" ], "style remains optional")
    check(metadata.inputSchema.properties.style.enum, [ "html", "basic", "text", "map" ], "Supported styles stay compatible")
  }
})()
