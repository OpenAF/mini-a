# Embedded web conversations

The opt-in iframe bridge supplies application parameters to each goal in Simple
or Advanced mode. A separate option lets a same-origin parent prefill or submit
the first plain goal, so an input box can expand into a conversation.

## Configuration

```sh
./mini-a-web.sh onport=8888 webembed=true \
  webembedorigins='https://app.example.com' \
  webembedfields='(customerId: (type: string, required: true), selectedIds: (type: "string[]"))' \
  webembedprompt=true
```

Configure `OAF_MODEL` as usual. Use your existing authenticated reverse proxy or
Mini-A authentication. For example, proxy Mini-A under `/mini-a/` on the main
application origin. The bridge does not log users in, bypass `webtoken`, issue
credentials, or introduce user/tenant isolation. Advanced mode retains its
existing authentication requirements. Do not distribute a privileged shared
Advanced token to untrusted users.

| Option | Default | Meaning |
| --- | --- | --- |
| `webembed` | `false` | Enable the bridge for `?embed=1`. |
| `webembedorigins` | unset | Required exact origins, comma-separated or a JSON/SLON array. No wildcards, paths, credentials, queries, or fragments. |
| `webembedfields` | `{}` | JSON/SLON object of allowed fields. Each definition has `type` and optional boolean `required` (default `false`). |
| `webembedcontextrequired` | `true` | Require nonempty valid context before embedded goals. Requires at least one configured field. |
| `webembedprompt` | `false` | Permit one same-origin initial plain-goal handoff per iframe load. |

For a handoff without IDs, use `webembedcontextrequired=false` and omit fields.
Cross-origin parents may provide context but cannot hand off a goal. An origin
includes scheme, host, and port; different subdomains or ports are different origins.

Field types are `string`, `number`, `boolean`, and homogeneous arrays `string[]`,
`number[]`, `boolean[]`. Required strings must contain non-whitespace text and
required lists must be nonempty. Limits: 32 fields, 64 items per list, 1,024 UTF-16
code units per string, and 16 KiB of UTF-8 serialized JSON. Numbers must be finite
and within JavaScript's safe numeric range; send long IDs as strings. Unknown
fields, nested objects, and prototype-related names fail validation. Types are
never coerced.

The normal web URL remains standalone chat. Embedded mode starts fresh rather
than automatically restoring a URL UUID or previous Advanced session.

## Parent integration

See the [complete parent example](examples/embed-parent.html). Serve it through
your application origin and adjust the iframe URL. It supports updating/clearing
context and an initial editable draft or automatic submission.

Use `?embed=1` in the iframe URL. Never put context or goal text in URL parameters.
Use HTTPS outside local development. If using an iframe `sandbox` attribute,
allow scripts and preserve the real origin; opaque/null origins cannot connect.

Messages have this shape:

```js
{
  type: 'mini-a:embed', version: 1, action: 'set-context',
  requestId: crypto.randomUUID(), channelId, revision: 1,
  context: { customerId: 'C-123', selectedIds: ['R-1', 'R-2'] }
}
```

1. Send `hello` with only `type`, `version`, `action`, and `requestId`. Retry while
   the iframe initializes. Always use its exact origin as `targetOrigin`, and
   check response origin and `event.source`.
2. `ready` returns `channelId`, `contextRequired`, and `prompt` (whether this parent
   can hand off a goal). The channel is valid only for this iframe load.
3. `set-context` includes a strictly increasing revision and replaces all fields.
   Wait for its `ack`. `clear-context` includes a revision but no context property.
4. `start` includes `text`, `mode: 'draft' | 'submit'`, and the latest acknowledged
   revision (zero if no context has been supplied). It requires a same-origin
   parent, a fresh idle conversation, an empty composer, and no attachments.

All post-hello messages include the channel and a request ID of 1–80 ASCII
letters, digits, or hyphens. Responses are `ready`, `ack`, or `error`; errors have
`message`. Start acknowledgements have status `pending`, `draft`, or `submitted`.
Submitted means HTTP admission, not model completion. Repeating the same start
request ID and payload cannot submit twice within that iframe load. The bridge
does not automatically retry uncertain HTTP submissions: inspect the iframe
before retrying manually. No model answers or transcripts are sent to the parent.

Invalid context updates from the bound parent block goals until corrected or
cleared. Unauthorized senders and stale revisions leave accepted context intact.
Clearing blocks goals when context is required. Active runs keep their snapshot;
retries, edited drafts, new conversations, and resumed conversations use current
context. Reload requires a fresh handshake and context delivery.

The handoff cannot overwrite drafts, interrupt runs, or send later goals. Its text
stays a plain goal in Advanced mode, including after editing a handed-off draft;
it does not run slash commands or expand implicit file/skill references. Normal
subsequent Advanced input retains its existing behavior.

## Trust, retention, and framing

Parameters are background data, not authenticated identity or authorization.
Tools and application backends must independently authorize record access.
The existing prompt and Advanced command APIs accept an optional
`embed: { version: 1, revision, context }` envelope. The embedded UI always sends
it; standalone clients omit it. The marker is not an authentication assertion.

Context is validated on both sides and added as labelled untrusted data after
configured knowledge files are resolved. It does not replace knowledge, mutate
settings/permissions, or add a UI panel. It counts against prompt budgets; lack
of space produces an error instead of silently dropping it. Clean delegation
does not inherit the private field; relevant data can be passed in explicit tasks.

The bridge adds no browser storage, preset persistence, or payload logging.
Values reach the model and may appear in answers, retained conversations, or
enabled diagnostic traces. Hidden UI is not secrecy. Updated IDs do not erase
earlier discussion of other records. Same-origin pages already share browser
origin privileges; the bridge is not an isolation mechanism between those pages.

Mini-A adds an HTTP `frame-ancestors` CSP policy using the allowed origins when
embedding is enabled. Existing policies are retained and intersect with it. A
reverse proxy must preserve this header and avoid conflicting `X-Frame-Options`
or `frame-ancestors` policies. All ancestors of a nested iframe must be permitted.
The parent must allow Mini-A through its `frame-src` policy. No CORS relaxation is needed.

## Verification

Run `node tests/webEmbed.cjs`, `node tests/webEmbedUI.cjs`,
`node tests/webSessions.cjs`, `oaf -f tests/webEmbed.js`, and
`oaf -f tests/webAdvanced.js`. These use fixtures, with no live model calls.
Run the existing composer, attachment, Advanced prompt/settings and module-path
suites when changing the integration.

In a browser, check context replacement during an active run, clearing, both
handoff modes, follow-ups, Advanced mode, and a prefixed reverse proxy. Repeat
with a permitted cross-origin parent (context succeeds, start fails) and an
unauthorized origin (framing is blocked).
