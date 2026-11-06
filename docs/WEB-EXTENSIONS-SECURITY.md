# Web Extensions security model

Web Extensions remain opt-in. The trust model is one authenticated operator/user per Mini-A instance, not a multi-tenant service. Extension code and documents are untrusted with respect to the host. Installing or enabling native Agent Plugins is a separate trust decision.

## Boundaries

The main document owns the web token, conversation UI and authenticated fetches. A small first-party containment document owns the guest iframe and applies package-specific frame navigation policy. Every third-party document uses an opaque origin (`sandbox="allow-scripts"`); HTTP CSP sandbox also applies when an asset is opened directly in a tab. No third-party code executes in the main page or containment origin.

The guest receives only the artifact explicitly opened in that instance and bounded presentation context. It receives no web token, server filesystem path, conversation, model settings, privileged object or arbitrary endpoint proxy. A nonce/window-validated bootstrap transfers a dedicated message port. A fresh instance/generation replaces that channel after navigation, reload or remount.

## Enforced controls

| Threat | Control |
| --- | --- |
| Malicious guest JavaScript | Opaque origin, HTTP sandbox, bounded protocol and host-owned controls. |
| Message spoofing/replay | Exact window, nonce, port, instance, version and request ID validation; no trust in `origin:null` alone. |
| Host XSS | Names, titles and errors use text nodes; no guest HTML or SVG is inserted into the host. |
| Active SVG/XML | Sandboxed asset documents; native XML validation; existing host SVG sanitization and PNG signature/dimension checks before export. |
| Traversal and symlinks | Opaque IDs, contained paths, regular-file/no-follow reads and immutable snapshot hashes. |
| Unauthorized document access | Header-only bearer authentication and server-held editor/document/session binding. |
| Token leakage | No credential in guest messages, URLs or storage; no-referrer policy; public assets contain no private data. |
| Network access | Local asset-only CSP, declared child paths, no remote editor fallback or guest proxy. |
| Resource exhaustion | Native/export/request/decompression limits, quotas, rate limits, deadlines and forced unmount. |
| Privilege escalation | Manifest capabilities intersect approved permissions and current instance binding. |
| Unexpected upload/download | User file input and downloads are host actions; guest sandbox excludes downloads/forms/popups. |
| Cross-instance access | Separate opaque origin and channel for every mount, even for identical package URLs. |
| Supply-chain replacement | Digest-bound grants, immutable snapshots and reapproval after changed code or editor assets. |
| Lost or stale writes | Explicit Save, revision compare-and-swap, dirty edit sequences and conflict handling. |

Extension assets alone may return anonymous CORS headers for fonts/modules/XHR. Authenticated APIs never grant CORS to opaque origins. New API mutations reject cross-origin browser requests and accept no query-string credential. Existing Mini-A routes retain their previous authentication behavior.

## What these controls do not promise

An iframe is not an operating-system sandbox. Browser CPU/memory cannot be hard-limited per frame; timeouts and removal are recovery mechanisms. CSP does not justify a blanket guarantee against every browser egress channel. Browser-dependent self-navigation/redirect and WebRTC behavior must be tested. Strong confidentiality against malicious code also requires operator-controlled browser/device networking or keeping that code disabled.

Guest responses also disable DNS prefetch, declare `webrtc 'block'` and send a
snapshot-scoped `Connection-Allowlist`. These are additional controls, not a
cross-browser guarantee: browsers that do not implement a directive ignore it.
See Chrome's [outbound connection guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/restrict-outbound-connections).

Installed native MCP servers may inherit process environment and execute server code. The browser permission manifest does not constrain those processes. The optional built-in document tools enforce their own per-run document scope and revision checks; the LLM cannot grant itself more access.

No protection can revoke bytes already supplied to an enabled extension. Disabling stops new operations and closes local instances; other tabs discover revocation through their active-instance heartbeat. Do not open sensitive content in a package you do not trust to receive it.

## Deployment

- Use TLS at the gateway for non-local deployments and keep the generated token private.
- Configure `publicOrigin` to the exact externally visible origin behind a proxy. Do not infer trusted origin from arbitrary forwarded headers.
- Keep private state outside public static content. Do not share a writable state directory between processes; process locks reject competing writers.
- Apply a request-body ceiling at the reverse proxy. OpenAF route handlers validate bodies after transport parsing, so handler limits alone are not an early allocation limit.
- Back up saved documents separately from conversation history. Deleting history or uninstalling an editor must not erase explicitly saved work.
- Do not enable the restricted `webartifacts` worker profile and Web Extensions together in this release.

## Review and browser acceptance

Fixtures verify protocol logic but do not prove browser enforcement. Real-browser tests must cover wrong-window/null-origin messages, host/sibling DOM and storage access, direct SVG/XML navigation, redirects, CSP violations, fetch/XHR/beacon/WebSocket/EventSource, images/fonts/styles, nested frames, forms, popups and downloads. Exercise WebRTC separately where available. Observe requests, not merely JavaScript exceptions.

Test Chromium, Firefox and WebKit; physical iPad/Safari interaction is a separate check. draw.io remains gated by an operator conformance record for the exact package digest. Never add `allow-same-origin`, `unsafe-eval` or remote origins to get a failing test to pass.
