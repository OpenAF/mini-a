# Wiki runtime memory

Retrieval suppression checks stream the ingest manifest and journals, retaining
page status and operation paths while skipping chunk payloads. Current OpenAF
runtimes use `io.scanJSON` and `io.copyJSONRange`; older runtimes use the bundled
Gson streaming reader. Existing artifacts need no rebuild. Corrupt or changing
state conservatively suppresses retrieval until a stable check succeeds.

Local read-only graph readers load on first use and share parsed data and derived
indexes for the same canonical file, file identity, timestamp, size and community
algorithm. Calls serialize derived-index changes and return detached results.
Updated files acquire a new snapshot; closing the last owner drops the old one.
Writable graphs, archive graphs and FalkorDB retain their separate implementations.
Custom similarity callbacks also retain private graphs.

Run `ojob tests/wikiMemory.yaml`, `ojob tests/graph.yaml` and
`ojob tests/wiki.yaml` for streaming, ownership and functional regressions.
The memory test is also included in the wiki suite.

During local verification on 2026-11-11, an incident manifest containing 631 sources
and 27.7 MiB of JSON used about 88 MiB peak heap with selective streaming versus
258 MiB with full parsing. The cold scan took about 1.1 seconds versus 0.26 seconds;
unchanged files reuse the existing suppression cache. These are single-run JVM
pool peak measurements, not retained-object sizes or latency guarantees.

A replay with four sets of 13 local wiki graph readers retained about 141 MiB
while loaded, compared with about 505 MiB for four independent eager graph sets.
It returned to about 16 MiB and zero shared entries after closure
across three cycles. The JVM was explicitly started with `OAF_JARGS=-Xmx980m`.
This exercises graph ownership using the incident artifacts; it does not establish
full HTTP session soak behavior or deployment acceptance. The running service
must be rebuilt and observed separately.
