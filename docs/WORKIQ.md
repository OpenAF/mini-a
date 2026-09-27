# Microsoft WorkIQ MCP

The WorkIQ connector connects directly to `https://workiq.svc.cloud.microsoft/mcp`
using delegated Microsoft sign-in. It needs OpenAF with the new `$mcp`
`authenticate()`, `getAuthStatus()`, `clearAuth()`, `auth.callback`, and
`auth.tokenStore` features, plus `ow.server.mcpStdio`'s `rawToolResults` option.
An older installed OpenAF is not upgraded automatically by this connector.

All connector code is contained in `mcps/mcp-workiq.yaml`. It can be copied and
run independently with OpenAF and oJob-common installed; no Mini-A installation
or JavaScript helper is required. The default credential-store name is retained
so existing sign-ins continue to work.

## Sign in and connect

From the Mini-A checkout, using the updated OpenAF runtime:

```sh
ojob mcps/mcp-workiq.yaml op=login
opack exec mini-a mcp="(cmd: 'ojob mcps/mcp-workiq.yaml', pwd: '$(pwd)')" useshell=false goal="List my upcoming meetings"
```

The first command opens a browser and waits up to five minutes for sign-in.
The normal `serve` operation uses cached credentials and refreshes them without
prompts. A missing or revoked session requires another explicit `op=login`.
Configure `OAF_MODEL` as usual for Mini-A; the login command needs no model.

```sh
ojob mcps/mcp-workiq.yaml op=status
ojob mcps/mcp-workiq.yaml op=logout
# Independent account/configuration profile:
ojob mcps/mcp-workiq.yaml op=login profile=work tenant=YOUR_TENANT_ID
# Local HTTP transport:
ojob mcps/mcp-workiq.yaml profile=work tenant=YOUR_TENANT_ID onport=8888
```

Repeat the same tenant/client/store options for login, status, logout and serving.
HTTP listens on `127.0.0.1`; its MCP endpoint is `/mcp`. It represents one user's
credentials and is intended for local clients. It is not a multi-user sign-in
service. Logout deletes the selected local credential record, not Microsoft-side
consent or tokens already copied elsewhere.

## Authentication and storage

Defaults:

- Public client ID: `ba081686-5d24-4bc6-a0d6-d034ecffed87`.
- Tenant: `organizations`; override with `tenant` or `WORKIQ_TENANT`.
- Redirect URI: `http://127.0.0.1:12798/`; override with `redirecturi` for your own registered callback.
- Scope: `api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask offline_access`.
- SBucket repository: `mini-a-workiq`; bucket: `default`; profile/key: `default`.
- Request and login timeout: `300000` milliseconds; override with `timeout`.

The client ID and port follow [Microsoft's published WorkIQ plugin](https://github.com/microsoft/work-iq/blob/main/plugins/workiq/.mcp.json).
The scope follows [Microsoft's delegated OAuth instructions](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/foundry).
Tenant consent and Microsoft service eligibility still apply. The live endpoint's
protected-resource metadata also advertises the equivalent API application-ID
scope, `fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask`.

Tokens are encrypted using OpenAF `$sec`/SBuckets and survive process restarts.
The default file is `~/.openaf-sec-mini-a-workiq.yml`, protected using the normal
OpenAF main secret. `secrepo`, `secbucket`, and `secfile` select another dedicated
store; the file's parent directory must already exist. Optional
`WORKIQ_SEC_MAIN_SECRET` and `WORKIQ_SEC_LOCK_SECRET` supply existing SBucket
unlock material. Never put secrets in tool arguments or checked-in configuration.

The selected profile is bound to endpoint, authority, client and scope configuration.
Changing these requires a separate profile or logout using the original settings.
A file lock coordinates refresh and updates across processes sharing the store.

For an organization-owned Entra registration, use `clientid` or `WORKIQ_CLIENT_ID`,
`tenant`, and `redirecturi`. Confidential clients can supply `WORKIQ_CLIENT_SECRET`.
`nobrowser=true` prints the URL for manual opening; the callback must still reach
the connector's loopback listener. An occupied port produces an error instead of
silently selecting another callback port.

Alternatively, set `WORKIQ_ACCESS_TOKEN` and run with `auth=token`. This mode uses
an externally obtained delegated token, does not persist it, and does not refresh
it. Login/status/logout operations apply only to OAuth mode.

## Tools and permissions

The MCP exposes one `workiq` tool:

```json
{"action":"list"}
```

This returns permitted upstream tool names and their input schemas. Invoke an
exact listed name with its matching arguments:

```json
{"action":"call","tool":"fetch","arguments":{"entityUrls":["/me/messages?$top=5"]}}
```

By default, only documented query/read tool names are permitted: `ask`, `fetch`,
`fetch_blob`, `get_schema`/`getSchema`, `search_paths`, `call_function`, and
`list_agents`. Unknown names are blocked even if marked read-only upstream.
Custom `ask.agentId` routing is blocked in this mode. This is a connector tool
policy; Microsoft permissions and upstream semantics still govern access.

`readwrite=true` explicitly exposes the full discovered catalog, including create,
update, delete and action tools. This is an operator setting, not a tool argument.
The same policy is checked at execution time. Content blocks, structured results
and MCP tool error status are preserved. Failed calls are not replayed by the
connector.

## Verification

Run `ojob tests/workiq.yaml` from the Mini-A checkout. With the updated runtime,
`ojob tests/workiqIntegration.yaml` also exercises the descriptor's unchanged production jobs over
real STDIO and HTTP against a local fixture from a temporary directory containing
only the descriptor and test runner. An injected test job redirects the upstream
client to the fixture and blocks Mini-A package lookup. OpenAF's `tests/autoTestAll.MCPOAuth.yaml`
covers OAuth and temporary encrypted stores, including two independent JVMs
sharing a refresh token.

These tests do not prove tenant consent, the public client's registered callback,
or successful Microsoft sign-in. Live acceptance requires login, a harmless read,
process restart/cache reuse, refresh and logout in an eligible tenant.

### Local validation (2026-09-27)

An isolated OpenAF build completed successfully. The eight new OAuth tests passed,
including actual loopback callbacks, encrypted cache reuse, two JVMs sharing one
refresh, occupied ports and cancellation. The three SBucket tests also passed.
Mini-A's three policy/configuration tests passed (28 assertions), as did the
STDIO/HTTP integration test (37 assertions).

One existing MCP test, `testMCPAutoClientNegotiatesModernEraWithDualEraServer`,
fails because `tools/list` loses `resultType`. It fails on the unchanged OpenAF
JAR too; this integration does not change that behavior. The other ten existing
MCP tests passed. The installed OpenAF runtime was not replaced.

The live WorkIQ endpoint and advertised OAuth resource metadata were checked
without credentials. An anonymous OAuth `prompt=none` request returned
`login_required` to `http://127.0.0.1:12798/`, confirming that the public client
accepts the configured callback. Tenant sign-in and Microsoft data access remain
unverified.

After embedding the client in the MCP descriptor, the policy/configuration suite
passed again (28 assertions). The standalone-copy STDIO/HTTP integration also
passed (37 assertions), using the isolated updated OpenAF build.
