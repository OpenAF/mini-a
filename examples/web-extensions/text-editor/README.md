# Text editor example

This standalone Apache-2.0 package demonstrates the Mini-A Web Extensions 1.0
API without an Agent Plugin, MCP server, LLM provider, build step or dependency.

Start a model-free workspace from the repository:

```sh
ojob mini-a-web.yaml webextensions=true webextensionsonly=true plugins=examples/web-extensions/text-editor
```

Open the token-bearing access URL printed by Mini-A. In **Extensions**, enable
**Text editor** after reviewing its permissions. Create a document or import a
UTF-8 `.txt` file, edit it, Save, close it and reopen it from saved documents.
Export uses the host's download controls. Cancel/Discard never writes a revision.

Only `web/` becomes public. Mini-A supplies `_contract.js` and `_sdk.js` at the
package asset root; those files are part of the versioned host SDK. The adapter
does not use Mini-A internal functions, tokens, filesystem paths or browser
storage. `plugin.json` is intentionally absent.

The `save` handler returns a snapshot and edit sequence. A later `commit` event
acknowledges server persistence; edits made after the snapshot remain dirty.
