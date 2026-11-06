# Develop a Web Extension

Start with `examples/web-extensions/text-editor`. It is a standalone extension; `plugin.json`, skills and MCP are optional and independently enabled.

```text
my-extension/
  mini-a-web.json
  web/
    index.html
    adapter.js
    style.css
  README.md
  LICENSE
```

Use external script/style files. Mini-A snapshots approved public assets and supplies `_contract.js` and `_sdk.js` in each asset namespace. Reference those locally; do not fetch an SDK from a CDN or copy host internals.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My editor</title>
  <script src="_contract.js" defer></script>
  <script src="_sdk.js" defer></script>
  <script src="adapter.js" defer></script>
</head>
<body><textarea aria-label="Document"></textarea></body>
</html>
```

## Implement the protocol

```javascript
var input = document.querySelector('textarea');
var sequence = 0;
var extension = MiniAWebExtensionSDK.connect({
  versions: ['1.0'],
  handlers: {
    initialize: function() { return { initialized: true }; },
    open: function(params) {
      input.value = params.content.text;
      return { opened: true, revision: params.artifact.revision };
    },
    save: function() {
      return {
        mimeType: 'text/plain',
        filename: 'document.txt',
        content: { encoding: 'utf8', text: input.value },
        editSequence: sequence
      };
    },
    dispose: function() { input.value = ''; return {}; }
  }
});
input.addEventListener('input', function() {
  extension.emit('dirtyChanged', { dirty: true, editSequence: ++sequence });
});
```

This fragment illustrates messaging; use the complete text example for base64 decoding, read-only behavior, creation, export and commit handling. Implement every handler required by declared capabilities. The SDK is optional; equivalent conforming messages work without it.

Do not access `parent.document`, localStorage, Mini-A URLs, auth tokens or user files. Opaque origins deliberately deny those features. Return content through the protocol and let the host save/download. A save response is not a server commit. Preserve dirty edits until the host sends `commit` for the matching edit sequence.

## Format resolution

Declare exact MIME types, filename extensions and optional artifact types. The resolver considers only enabled compatible packages. Explicit choice, user preferences and configured defaults take precedence; otherwise matching candidates appear in deterministic order. Claiming a MIME type does not activate an extension. Admit the actual native content before rendering it.

Ordinary Markdown and existing Mermaid/Chart.js/Leaflet/SVG output keep their existing handlers. The extension API uses validated artifact references, not executable Markdown fences.

## Versions and packaging

Give your package an independent semantic version and stable namespaced ID. Keep `mini-a-web.json` separate from the Agent Plugins specification. An unsupported API or malformed sidecar disables that web surface without changing the package's valid Agent Plugin behavior.

Every executable resource, including mapped editor files and the SDK, participates in the approval digest. Update files locally, refresh discovery, review changes and enable the new digest. Do not hot-update running scripts or use service workers. Saved documents must remain useful after uninstall through native downloads or another handler.

## Tests

Provider-free checks:

```sh
node tests/webExtensionProtocol.cjs
node tests/webExtensionHost.cjs
node tests/webExtensionContainment.cjs
node tests/webExtensionBindings.cjs
node tests/webExtensionAdvanced.cjs
node tests/webExtensionHistory.cjs
oaf -f tests/webExtensionsBackend.js
oaf -f tests/webExtensionAgent.js
node tests/webDrawioAdapter.cjs
python3 tests/webDrawioPrepare.py
python3 tests/webExtensionsHttp.py
python3 tests/webExtensionsPackage.py
```

An independent Draft 2020-12 check is available as `python3 tests/webExtensionSchemas.py`.
It requires the development-only `jsonschema>=4,<5` package; it is not a Mini-A runtime dependency.

The HTTP harness starts a temporary model-free server and deletes its own test state afterward. It requires localhost socket access. Browser acceptance uses an installed development copy of Playwright:

```sh
NODE_PATH=/path/to/development/node_modules \
MINIA_CHROME_PATH=/path/to/chrome \
python3 tests/webExtensionsHttp.py --browser chromium
```

For Playwright-managed browsers omit `MINIA_CHROME_PATH`; use `--browser firefox` or `--browser webkit` for those installed engines. Browser tools are not Mini-A runtime dependencies. Tests use new disposable profiles and block external requests; they never reuse your browser profile.

Regression commands include `ojob tests/agentPlugins.yaml`, `node tests/modulePaths.cjs`, `python3 tests/modulePaths.py`, and the existing `tests/web*.cjs` suites. Run each Node file separately; passing several filenames to `node` does not run all of them.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No Extensions button | `webextensions=true`, authenticated `/info`, browser loading errors. |
| Package unavailable | Manifest/schema version, duplicate IDs, missing local mount or conformance gate. |
| Enable rejected after update | Refresh discovery and approve the current digest. |
| Editor remains loading | SDK script URLs, CSP console messages, exact message source and initialization response. |
| Guest storage errors | Remove browser-storage dependency; do not grant same-origin. |
| Save conflict | Reload the saved revision or save a copy; the current working content is retained. |
| Quota/size error | Reduce content or explicitly lower workflow size; the guest cannot raise server ceilings. |
| Proxy deployment fails | Exact `publicOrigin`, URL prefix, CSP asset paths and JSON UTF-8 content type. |
| Model-free startup fails | Use the web job, both opt-in flags, and no conflicting Advanced/worker/artifact profile. |

Keep performance and security claims tied to actual browsers and pinned package bytes. Record unsupported cases instead of silently changing permissions.
