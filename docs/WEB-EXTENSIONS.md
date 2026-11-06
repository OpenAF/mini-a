# Web Extensions

Web Extensions add local viewers and editors to the Simple and Advanced web interfaces. They are disabled by default. Enabling a web extension does not enable a package's Agent Plugin, skills or MCP servers.

The first API supports artifact viewers/editors in isolated iframes. It does not provide host DOM injection, arbitrary browser execution, remote editors or a marketplace. The framework and original examples use Apache-2.0.

## Start a model-free workspace

Create an operator-owned JSON file (use absolute paths):

```json
{
  "directories": ["/opt/mini-a/examples/web-extensions/text-editor"]
}
```

Start the checked-out web job:

```sh
ojob mini-a-web.yaml webextensions=true webextensionsonly=true webextensionsconfig=/private/config/extensions.json
```

No `OAF_MODEL` is required in this mode. The existing Simple shell displays an Extensions button; agent submission is disabled. Mini-A generates a strong web token when none is supplied. Keep its access URL private.

Open **Extensions**, review the installed package and permissions, and explicitly enable it. Create or import a document, edit it, and use **Save** to persist it. Native downloads and exports are deliberate host actions. Nothing is saved just because a guest emits an autosave notification.

For normal chat, configure a model as usual and omit `webextensionsonly`. Both Simple and Advanced views use the same extension host.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `webextensions` | `false` | Discover local extensions and enable the authenticated services/UI. |
| `webextensionsconfig` | unset | Operator-owned JSON configuration. |
| `webextensionsonly` | `false` | Model-free workspace; requires `webextensions=true`. |
| `webextensionsagent` | `false` | Allow scoped document tools for ordinary agent prompts. |

Extensions require a token of at least 32 characters. New APIs accept only `x-mini-a-token`, never a URL token. The existing web authentication remains unchanged elsewhere.

The initial implementation rejects combining Web Extensions with `webartifacts=true`, whose worker profile deliberately excludes ordinary plugins/tools. Workspace-only mode also excludes Advanced mode, worker registration and agent tools.

## Installation and independent activation

A package contains `mini-a-web.json` and `web/`. It may also contain `plugin.json`, `skills/` and `mcp.json`, but web discovery never loads those agent capabilities.

Configuration accepts explicit `directories` and parent `roots`. When omitted, discovery reuses `plugins`, `pluginsroot(s)` and the default `<homedir>/.openaf-mini-a/plugins` directory. No package is enabled simply because it was discovered. Duplicate IDs are rejected instead of choosing an arbitrary copy.

Install by placing reviewed files in a configured local directory. Use **Refresh** after replacing a package. Executable assets are identified by a digest; a changed package needs new approval. Running code is not hot-replaced. Disable or remove a package independently of other packages.

Saved documents survive disabling/removing their editor and remain downloadable. Removing a package does not remove its separately enabled native MCP/skills surface.

## Persistence and conflicts

The private state directories are below `<homedir>/.openaf-mini-a`:

```text
web-extensions/     grants and immutable public asset snapshots
web-documents/      saved native documents and revision metadata
```

New/imported documents stay in browser memory until Save. Saved documents use opaque IDs and revision checks. A concurrent modification returns a conflict; preserve your current work and choose reload or save a copy. Closing an editor or expiring a conversation does not delete saved documents. Delete documents explicitly in the document library.

Conversation history stores references rather than full native payloads. Document files are local; the existing history S3 setting does not mirror them. Back up the private document directory separately. Unsaved browser memory is not crash recovery.

Defaults: 8 MiB native documents, 16 MiB exports and 512 MiB saved content. Operator limits can reduce these ceilings. Guest requests cannot raise them.

## Optional agent assistance

Use `webextensionsagent=true` with a configured model. Choose **Use in next prompt** for saved documents. Access is read-only by default. The prompt controls separately grant creation or editing for that run. Grant only the documents needed by the task.

The agent receives bounded document metadata and scoped tools, not a browser bridge, token or arbitrary path. Deterministic draw.io edits work on saved native XML while the editor is closed. An open dirty editor must reconcile before reloading an externally saved revision.

## Offline and deployment boundaries

Extension assets are local, and v1 grants no external network origins. The text example needs no external service. The existing Mini-A shell still has its original Chart.js/Leaflet/CDN behavior; Web Extensions does not change those loaders or make the entire shell network-free.

This retains Mini-A's **single trusted user per instance** model. A shared token is not a multi-user identity system. Use separate instances for mutually untrusted users. For reverse proxies, configure the external `publicOrigin` in the extension configuration and enforce upload-size limits at the proxy.

The initial deployment profile serves Mini-A at the origin root. A proxy that strips
an external URL prefix must expose the extension workspace at `/`; forwarded-prefix
headers are not a trusted configuration mechanism in this version.

See [API](WEB-EXTENSIONS-API.md), [security](WEB-EXTENSIONS-SECURITY.md), [developer quickstart](WEB-EXTENSIONS-DEVELOPMENT.md), and the [draw.io reference](WEB-EXTENSIONS-DRAWIO.md).
