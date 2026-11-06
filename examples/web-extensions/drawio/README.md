# Local diagram editor adapter

This optional Apache-2.0 package connects Mini-A Web Extensions 1.0 to a pinned,
operator-supplied draw.io editor. It does not download or include the editor.
Native `.drawio` files remain editable independently of SVG/PNG exports.

The reference is **release-gated**: it is unavailable until the operator records
browser conformance for the exact installed asset digest. Source inspection and
adapter fixture tests are not proof that a particular editor build works in an
opaque-origin sandbox. Never add `allow-same-origin` or enable network access to
bypass the gate.

## Prepare a local editor

Use an independently obtained checkout at the commit in `editor-lock.json`.
Read `THIRD-PARTY-NOTICES.md` and retain upstream licenses. The helper below only
reads that existing checkout and writes a new local directory; it performs no
downloads, package installation or changes to the checkout:

```sh
python3 examples/web-extensions/drawio/prepare-editor.py \
  --checkout /opt/source/drawio \
  --output /opt/local-editors/drawio-mini-a
```

It requires the exact commit and an unchanged tracked webapp. It copies regular
public assets, excludes server-side `WEB-INF`/`META-INF` and version-control data,
preserves licenses, extracts inline bootstrap scripts if present, and appends
documented local-only configuration. The generated inventory describes local
bytes, not a legal certification or browser approval. The supported profile has
no remote exporter, proxy, cloud storage, icon search, AI, plugins, PWA, math or
custom fonts.

Add this extension directory and an administrator-owned `editor` mount to
`webextensionsconfig`:

```json
{
  "directories": ["/path/to/mini-a/examples/web-extensions/drawio"],
  "mounts": {
    "org.openaf.drawio": {
      "editor": {
        "path": "/opt/local-editors/drawio-mini-a",
        "sha256": "<mount digest printed by prepare-editor.py>"
      }
    }
  }
}
```

Start `ojob mini-a-web.yaml webextensions=true webextensionsonly=true
webextensionsconfig=/private/config/extensions.json`. There is no LLM
requirement. Mini-A snapshots the approved public assets and reports a digest.
After completing conformance, add a server-side `conformance` record:

```json
{
  "conformance": {
    "org.openaf.drawio": {
      "digest": "<exact Mini-A registry package digest>",
      "gates": ["drawio-opaque-v1"]
    }
  }
}
```

This record is an operator attestation tied to the immutable package digest,
not a browser-switch or permission escalation. Refresh/restart discovery as
documented by the host, review requested permissions and explicitly enable the
extension. Changed adapter/editor bytes invalidate the attestation and grant.

## Supported behavior

- Create a blank diagram; open a native `.drawio` file; edit; Save; close; reopen.
- Export PNG, or passive SVG with plain-text labels. Rich SVG labels, images or
  unsupported elements return a clear error; use PNG without loosening policy.
  SVG uses the light fallback palette and discards adaptive CSS and style attributes.
- Native save returns XML to Mini-A. Autosave events only mark the document dirty;
  they do not persist a server revision. Edits made during Save remain dirty.
- Fullscreen is provided by the Mini-A dialog. The editor cannot navigate the
  host, open external windows or download files itself.
- Compressed native input is bounded before loading. The browser needs raw
  DEFLATE `DecompressionStream`; otherwise import an uncompressed `.drawio` file.
- Multi-page graph data, cell IDs, styles and geometry are preserved. No automatic
  layout is requested. Native XML is stored independently of exports.
- External diagram images, fonts, links and active XML/HTML are rejected by this
  constrained profile. Read-only editor sessions are currently rejected; use a
  passive preview or a viewer extension for that case.

The embed adapter accepts only events from its exact opaque child window and
serializes upstream operations. It ignores `remoteInvoke`, link opening and
unsolicited exports. After a cancelled/timed-out upstream operation, close and
reopen the editor before retrying, so an uncorrelated late response cannot become
the result of a new request.

## Browser conformance gate

For Chromium, Firefox and WebKit, with external networking blocked, exercise:

1. Blank create, edit, native save, close and reopen.
2. Compressed and uncompressed existing `.drawio` import, including multiple pages.
3. SVG and PNG export, native layout/ID preservation and Unicode labels.
4. An artifact produced by scoped document tools; update a persisted document
   while the editor is closed and reopen the new revision.
5. Save failure, revision conflict, dirty close/cancel and edits made during Save.
6. Wrong-window/null-origin impostors, late responses, navigation and disposal.
7. Host DOM/token/storage and sibling-instance isolation.
8. Blocked fetch/XHR/beacon/WebSocket/images/fonts/forms/popups/downloads/RTC and
   absence of external requests from this extension's complete workflow.
9. Large diagrams and decompression/format limits; malformed SVG/XML and DTDs.
10. Keyboard and mobile viewport operation; actual iPad/Safari separately.

The existing Mini-A shell may still attempt its pre-existing renderer CDN loads;
that behavior is separate from extension-originated requests. Do not certify a
wholly network-silent Mini-A deployment from this adapter's tests.

Run the real-editor browser workflow after preparing a local editor and installing
Playwright in a separate development environment:

```sh
NODE_PATH=/path/to/development/node_modules \
PLAYWRIGHT_BROWSERS_PATH=/path/to/development/browsers \
python3 tests/webDrawioHttp.py --editor /opt/local-editors/drawio-mini-a --browser chromium
```

Use `--browser firefox` or `--browser webkit` for the other engines. An optional
`MINIA_CHROME_PATH` points to an existing Chrome executable. The test starts a
temporary no-LLM Mini-A server, verifies that the production gate rejects the
unattested editor, then supplies an attestation only in its disposable config.
It retains diagnostics in a temporary directory and never changes production
configuration. Its automated checks cover native save/reopen, layout fidelity,
compressed Unicode input, passive exports, dirty close/cancel and unloading;
the remaining conformance items above still need deployment-specific review.

## Optional agent operations

The framework's separate `webextensionsagent` option exposes scoped document
tools. `MiniADocumentTools` supports deterministic `setLabel`, `setStyle`,
`setGeometry`, `addVertex`, `addEdge` and `removeCell` operations with an expected
revision. Read-only scopes return proposals. Writes require a run grant and work
against persisted documents without a browser. Connected edges/children must be
removed explicitly; unknown attributes, untouched geometry and waypoints remain.

No `mcp.json` or Agent Plugin is required. A separately installed native MCP
server is trusted server code and is not sandboxed by these browser permissions.

References: [embed protocol](https://www.drawio.com/docs/reference/embed-mode/),
[native format](https://github.com/jgraph/drawio/wiki/File-format),
[security](https://github.com/jgraph/drawio/wiki/Security),
[self-hosting](https://github.com/jgraph/drawio/wiki/Self-hosting).
