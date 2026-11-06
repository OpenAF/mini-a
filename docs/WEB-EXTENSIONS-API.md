# Web Extensions API 1.0

The normative manifest and protocol schemas are packaged at `schemas/mini-a-web-1.0.schema.json` and `schemas/mini-a-web-protocol-1.0.schema.json`. Runtime semantic validation also checks path containment, capability/permission relationships and size/depth limits. No remote schema is fetched during startup.

## Manifest

```json
{
  "$schema": "https://openaf.io/schemas/mini-a/web-extension/1.0/schema.json",
  "id": "org.example.notes",
  "name": "Notes",
  "version": "1.0.0",
  "apiVersions": ["1.0"],
  "entry": "index.html",
  "rendering": "iframe",
  "category": "editor",
  "activation": ["command", "open-with", "artifact"],
  "formats": [{"mimeTypes": ["text/plain"], "extensions": [".txt"]}],
  "capabilities": ["render", "edit", "create", "export"],
  "permissions": ["artifact.read", "artifact.propose-write", "artifact.propose-export"],
  "exports": [{"mimeType": "text/plain", "extension": ".txt"}],
  "network": {"origins": []},
  "offline": true,
  "license": "Apache-2.0"
}
```

`entry` is relative to `web/`; it must be local HTML. Manifests cannot contain filesystem roots, executable configuration expressions or remote entry URLs. `assetMounts` names optional administrator-configured static resources; `childFrames` declares local child HTML. `licenseFiles` is package metadata and does not automatically expose files through HTTP.

Unknown fields fail closed except inert, bounded metadata under `extensions` with `x-...` keys. Unsupported API versions make only that package unavailable. Manifest versions and package versions are separate. API major versions may break compatibility; supported minor versions must be explicitly negotiated. The initial host negotiates `1.0` only. Future categories require a supported contract version; no generic panel API is implied.

## Permissions

| Permission | Authority |
| --- | --- |
| `artifact.read` | Receive the document explicitly opened in this instance. |
| `artifact.propose-write` | Return native content to a host-initiated save/create action. |
| `artifact.propose-export` | Return a declared export for a host-controlled download. |
| `selection.report` | Report bounded element IDs or a region. |
| `ui.fullscreen` | Use the host's fullscreen presentation control. |

These do not grant filesystem access, HTTP API credentials, conversation access, agent tools or browser storage. Effective authority is the intersection of manifest, approved package digest, host policy and current instance binding.

## Connection and envelopes

The guest SDK connects to a first-party containment frame. The frame authenticates the exact guest window and a fresh mount nonce, then hands a private `MessagePort` to the main host. Each instance has a separate ID and channel. Origin `null` alone is never proof of identity. The only wildcard-target message is the opaque-origin bootstrap; no artifact bytes are sent until the bound channel is ready.

```json
{
  "protocol": "mini-a:web-extension",
  "version": "1.0",
  "kind": "request",
  "instanceId": "random-instance-id",
  "id": "request-17",
  "method": "save",
  "params": {}
}
```

Responses repeat the instance and request IDs and have exactly one `result` or `error`. Errors have `{code,message,retryable}`; they contain no stack trace or host paths. Events use `{kind:"event",event,params}` with the same protocol/version/instance fields.

Content uses `{encoding:"utf8",text:"..."}` or `{encoding:"base64",data:"..."}`. The native ceiling is 8 MiB, export ceiling 16 MiB and control-message ceiling 64 KiB; UTF-8 byte counts, not JavaScript string lengths, govern content limits. Content has a separate ceiling from its metadata envelope.

## Operations and lifecycle

| Operation | Direction | Requirement |
| --- | --- | --- |
| `initialize` | Host request | Negotiate version, capabilities, limits and presentation context. Mandatory. |
| `open` | Host request | Load an authorized representation. Required by renderers. |
| `create` | Host request | Start an unsaved document. Required for creation. |
| `update` | Host request | Replace representation after host dirty/revision checks. Editors. |
| `save` | Host request | Return native content and edit sequence; does not itself persist. Editors. |
| `export` | Host request | Return one declared MIME representation. Optional. |
| `inspect` | Host request | Bounded structured metadata. Optional. |
| `resize`, `focus` | Host request | Control operations; SDK supplies safe defaults. |
| `cancel` | Host request | Cancel an outstanding request by ID. |
| `dispose` | Host request | Best-effort cleanup before forced unmount. |
| `dirtyChanged` | Guest event | Dirty flag and monotonically increasing `editSequence`. |
| `selectionChanged` | Guest event | Optional bounded selection. |
| `saveRequested`, `closeRequested` | Guest event | Ask the host to show its normal controls/confirmation. |
| `commit` | Host event | Successful persistence: new revision and saved edit sequence. |
| `error` | Guest event | Bounded diagnostic. |

Lifecycle: discovered → disabled/available → mounting → initializing → ready → disposing → disposed. Failures terminate the individual instance. Updates never replace an active iframe's executable bytes.

Only one document-changing operation runs at a time. Requests have IDs, timeouts and a bounded pending set. Disposal, reload, disabled grants and stale generations invalidate pending requests. Late responses cannot commit data. A failed save leaves the editor dirty. A commit for sequence 12 must not clear sequence 13.

## Document descriptors

```json
{
  "id": "server-generated-uuid",
  "artifactType": "diagram/drawio",
  "title": "Architecture",
  "revision": 4,
  "persistence": "saved",
  "native": {
    "representationId": "native",
    "mimeType": "application/vnd.jgraph.mxfile",
    "filename": "architecture.drawio",
    "byteLength": 18492,
    "sha256": "content-hash"
  },
  "metadata": {}
}
```

Descriptors contain references, not full payloads. Editability is computed from grants/handlers. Native data remains authoritative; derived exports never replace it. Saves use `expectedRevision`. A mismatch returns 409 without overwriting either version. New imports remain in memory until Save.

Typed agent results use `{kind:"mini-a.artifact",version:1,artifactId,revision}`. The host validates server references; Markdown and claimed MIME types cannot install/enable extensions or inject HTML.

## HTTP services

All privileged services require header-only `x-mini-a-token` and bounded JSON. Browser mutations must come from the configured host origin; opaque guest requests are denied. No CORS access is granted to document APIs.

| Route | Actions |
| --- | --- |
| `GET /web-extensions` | Registry, statuses, defaults and limits. |
| `POST /web-extensions` | `enable`, `disable`, `refresh`, `bind`, `release`, `heartbeat`. |
| `POST /web-documents` | `list`, `read`, `save`, `delete`, `link`, `download`. |
| `/web-extension-assets/<digest>/<path>` | GET/HEAD of immutable public resources only. |
| `/web-extension-frame/<digest>` | First-party containment document and package-specific CSP. |

`enable` takes `{extensionId,digest,permissions}`. `bind` takes `{extensionId,digest,uuid,documentId?}` and returns a host-only binding. Document actions use `{uuid,id}`; save additionally takes metadata, `expectedRevision`, content and the editor binding. Internal guest handles are not API credentials.

Status codes distinguish invalid requests (400), authentication (401), denial (403), unavailable resources (404), conflicts (409), oversized content (413), limits (429) and unavailable features (503).
