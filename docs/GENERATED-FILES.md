# Generated-file downloads

Simple and Advanced can offer files produced by an LLM through a private Linux
worker. Enable this only in a dedicated instance for one authenticated user. An
external authenticated TLS gateway must provision and route users to separate
instances, storage and workers; this feature does not turn the shared web token
into multi-user identity.

## Configuration

```sh
export MINIA_ARTIFACT_WORKER_TOKEN='<random secret of at least 32 characters>'
./mini-a-web.sh usesandbox=true webartifacts=true \
  webtoken='<independent random instance token of at least 32 characters>' \
  artifactworkerurl=http://user-artifact-worker:8091/artifact-worker \
  artifactdir=/private-instance-storage/artifacts
```

Do not put tokens in download URLs. Supply the web token through the existing
browser token configuration. Use a private durable artifact directory outside
static web content, owned exclusively by the instance. Do not share Advanced
state/history directories between users or reuse trusted-administrator state.

The sibling `openaf-dockers/mini-a-artifact-worker` Dockerfile and README describe
building the worker and its mandatory runtime flags. Match package versions in
both images. No document-generation oPacks are installed automatically. See the
optional-library table in the main README and the worker README, including the
separate PDFBox 3 validation requirement for PDF.

The worker requires cgroup v2 ceilings of 512 MiB memory, one CPU and 128 processes,
a `/jobs` tmpfs no larger than 128 MiB, and a working unprivileged bubblewrap probe.
Generation programs receive a cleared environment, isolated PID/user/network
namespaces, immutable runtime files, bounded scratch/output storage and explicitly
supplied code/data. They cannot use the control process's token or environment.
No Docker socket or host/user directories may be mounted. The private control
port must not be exposed to browsers, other users or the internet.

If namespace creation or any required limit is unavailable, the worker reports
`ready:false`, and Mini-A refuses artifact-profile authentication/readiness. It
never falls back to host execution. Do not use privileged containers to bypass a
failed probe. Deploy on a host with a reviewed user-namespace/security policy.

## Model tools and publication

The restricted instance exposes three tools:

- `create_download({name, content})` creates a UTF-8 text candidate in the worker.
- `generate_downloads({code, outputs})` executes OpenAF JavaScript. `outputs` is an
  explicit list of simple filenames written in the current directory. Put input
  data directly in the supplied program; this profile disables web attachments
  and host file retrieval.
- `publish_generated({ids})` selects returned candidate IDs for publication.

For example, ask: “Create a CSV containing these rows and offer it for download.”
The model should create the candidate, then select its ID. Candidates do not
become downloadable until the goal completes successfully. Unselected candidates,
failed goals and cancelled runs are revoked. The model should describe the file
in its answer rather than constructing a download URL or host path.

Generation and validation run in separate networkless sandboxes. The generating
process tree has stopped before validation mounts its outputs read-only. The
control process only transfers bounded regular-file bytes. Symbolic/hard links,
traversal, special files, duplicate names and undeclared outputs cannot be
published. The server stores immutable copies under opaque IDs.

The restricted profile disables host shell, filesystem utilities, plugins,
external MCP, delegation, file-backed context/memory, program-call bridges,
Advanced settings/presets and slash commands. It locks the server's model-provider
configuration against restored overrides. Plain Advanced goals, readers, history
and stop controls remain available. Use plain OpenAI, Ollama, Anthropic or Gemini
adapters; adapters with native host execution are not supported. Normal trusted
instances without `webartifacts=true` retain their existing capabilities.

## Formats, quotas and lifecycle

Text, Markdown, CSV, JSON, PNG/JPEG and static SVG are supported without optional
generation oPacks. DOCX requires `mdconvert`, XLSX/PPTX require `plugin-XLS`, and PDF
requires `mdconvert` plus a loaded PDFBox 3 validator. Formats are advertised by
worker health only when their prerequisites are present. Validators reject
malformed/uninspectable or encrypted content, macros, embedded executables,
Office external references and fields/formulas, PDF actions, and active/external
SVG content. Plain-text downloads do not execute in the web page. These checks
reduce risk; they do not certify every document as harmless.

Limits are enforced in server/worker code and cannot be widened by a model or
Advanced setting: 25 MiB/file, 100 MiB/run, ten candidates/run, 500 MiB/instance,
one concurrent generation, and 120 seconds shared between generation and
validation. Storage admission reserves a full run's maximum before dispatch, so
it can reject a small generation near the instance limit. The worker's bounded
scratch tmpfs and memory limit can reject complex jobs before nominal file limits.

Published files expire after 24 hours and survive server restarts. Pending and
selected candidates are invalidated on restart. Deleting a conversation revokes
its files. Expired/deleted metadata remains visible for up to seven additional
days; bytes are removed. Cleanup runs on startup, periodic session maintenance and
artifact requests. Audit events contain identifiers and metadata, not file bytes.

Both views show a “Generated files” area with filename, size, expiry and an
explicit download button. Downloads use POST `/artifacts` with the existing token
header and conversation UUID. They are attachments with `no-store` and `nosniff`;
there are no inline previews or automatic downloads. File IDs alone confer no
access. Browser-only SVG answer downloads remain available regardless of sandbox
settings and do not enter this retention/storage lifecycle.

## Verification

```sh
MINIA_ARTIFACT_WORKER_TOKEN=fixture-only-worker-token-000000000 oaf -f tests/webArtifacts.js
node tests/webArtifactDownloads.cjs
node tests/webSessions.cjs
node tests/webSvgDownloads.cjs
node tests/modulePaths.cjs
python3 tests/modulePaths.py
```

Optional library smoke tests run in separate processes, e.g.
`MINIA_ARTIFACT_TEST_FORMAT=pptx oaf -f tests/artifactFormats.js`. Supported test
formats are `docx`, `xlsx`, `pptx`, `pdf` and `png`; PDF needs Tika/PDFBox 3 JARs
(`MINIA_ARTIFACT_PDFBOX_LIBS` can select their directory). Do not mix PDFBox 2/3
JARs in one test process.

The OpenAF protocol test requires permission to bind a temporary loopback server;
it uses a fixture worker and does not prove OS isolation. Test the actual worker
separately: required limits and sandbox readiness, allowed generation, disallowed
host/network access, timeout/resource exhaustion, invalid document rejection,
publication/cancellation and restart persistence. Confirm download behavior in
both browsers/views before deployment. Do not infer a working deployed sandbox
from fixture tests or an installed bubblewrap executable.
