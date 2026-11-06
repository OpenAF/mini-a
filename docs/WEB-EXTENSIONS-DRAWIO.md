# draw.io reference extension

The separately packageable adapter is in `examples/web-extensions/drawio`. Its original code is Apache-2.0. It does not contain or download draw.io. Follow that package's [README](../examples/web-extensions/drawio/README.md) for local preparation, digest configuration and browser conformance.

The compatibility baseline is draw.io **32.6.10**, commit `c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3`. Keep the exact commit and file inventory in deployment records. The editor is an administrator-supplied local static mount, not a hosted SaaS fallback.

## Adapter behavior

The adapter translates Web Extensions 1.0 to the official JSON embed protocol: configure → init → load; native XML retrieval; SVG/PNG export. Only its exact child window is accepted. Both the adapter and editor have opaque origins and `sandbox="allow-scripts"`. Pending upstream operations are serialized because not every upstream event has reliable correlation.

The supported profile disables cloud storage, plugins, PWA, remote export/proxy, custom fonts, math and AI. It uses `local=1`, `pwa=0`, `plugins=0`, `ui=atlas`, `themes=0`, `offline=1`, `stealth=1`, `lockdown=1` and suppressed new windows. Configuration is a compatibility aid; CSP and the host protocol enforce authority.

Native XML is saved independently of previews/exports. The adapter tracks dirty edits without auto-committing. Save is acknowledged only after the host persists a new revision. Cancel preserves the last committed document. Closing removes the editor and channel.

The constrained SVG exporter permits passive shapes/plain labels. Unsupported rich labels/images return a clear error; PNG is the visual-fidelity fallback. Native `.drawio` remains the editable source. Do not weaken the shared SVG sanitizer or execute exported HTML.

## Deterministic agent edits

With separately enabled document tools, inspect page/cell IDs and apply `setLabel`, `setStyle`, `setGeometry`, `addVertex`, `addEdge` or `removeCell`. Every write requires the expected revision and a run-specific grant. Without a write grant, patch returns a proposal.

Example operation:

```json
{
  "artifactId": "authorized-document-uuid",
  "expectedRevision": 4,
  "operations": [{"op": "setLabel", "pageId": "overview", "cellId": "api", "label": "Public API"}]
}
```

Untouched geometry, IDs, waypoints, grouping, styles and unknown attributes are retained. Connected edges/children must be removed explicitly. The tools operate on persisted native files without an open editor; they do not require a browser automation API. Browser exports still require an editor.

## Licensing and distribution

Do not describe the entire upstream webapp as Apache-2.0:

| Component | Verified source/license |
| --- | --- |
| Main source | [Apache-2.0](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/LICENSE). |
| Stencils/images/shapes | Additional [asset restrictions](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/stencils/LICENSE), including Atlassian ecosystem use; end-user outputs are excepted. |
| Templates | [CC-BY-4.0](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/templates/LICENSE). |
| libavoid-js | [LGPL-2.1](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/js/libavoid-js/LICENSE); inspect generated bundles too. |
| Fonts/generated bundles | No blanket license conclusion; inventory before redistributing. |

Upstream's [README](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/README.md) describes a test distribution and paid production offering. Its [Terms](https://www.drawio.com/trust/terms-of-use/) preserve Apache source rights; hosted applications/support have separate conditions. Apache source rights support commercial use subject to license conditions, but do not erase asset-level licenses or trademark restrictions.

Use neutral branding, retain notices and identify modifications. The local preparation helper is not a legal certification. A permissive-only bundled edition would require a full asset/dependency review and rebuild; it is not shipped here. Do not copy the GPL-licensed Docker/desktop wrappers into Mini-A.

## Release gate

Source inspection and adapter fixtures are not browser proof. The package is unavailable until the operator attests the exact package digest against `drawio-opaque-v1`. Use a disposable test instance to perform acceptance; only record production approval after the browser suite and deployment checks pass.

Required workflows: blank create, native import/edit/save/reopen, SVG/PNG export, agent-generated document, closed-editor structural edit, dirty-close cancellation, revision conflicts, large/malformed XML, Unicode, unload, wrong-window messages, sibling/host isolation and blocked external requests. Validate Chromium, Firefox and WebKit; physical iPad/Safari separately. A failure must not enable same-origin, eval or remote-service fallback.

Official references: [embed protocol](https://www.drawio.com/docs/reference/embed-mode/), [native format](https://github.com/jgraph/drawio/wiki/File-format), [security](https://github.com/jgraph/drawio/wiki/Security), [self-hosting](https://github.com/jgraph/drawio/wiki/Self-hosting).
