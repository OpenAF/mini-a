# Historical source snapshots

These snapshots are preserved at Git revision `6179d05a775ce9568aea9c3bf9c66a7fdc55461b`. They are historical
benchmark/recovery evidence, not inputs loaded by current tests. Links below identify
the exact bytes removed from the working tree on 2026-09-17. Historical report
`sourceArchive` fields retain their original names and resolve through this index.

Recover any file locally with:

```sh
git show 6179d05a775ce9568aea9c3bf9c66a7fdc55461b:tests/fixtures/wiki-retrieval-v2/FILE > /tmp/FILE
```

| Snapshot | Bytes | SHA-256 |
| --- | ---: | --- |
| [adaptive-buffer-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/adaptive-buffer-runtime-snapshot.zip) | 180272 | `3238fe632c143d7d1cfd09069a923105c32d9f5bb1227db6e5b331b04cc447ad` |
| [catalogue-sharing-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/catalogue-sharing-runtime-snapshots.zip) | 57874 | `7f1ac153761b56a95102b312a9986ba619a93c9ed6cab7e6986f05cd5bbf0100` |
| [catalogue-sharing-runtime.patch](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/catalogue-sharing-runtime.patch) | 3792 | `a6f08c39fb33eddbaeb48dee4e294a402676b35001c50a617f4c73d6b8aff666` |
| [catalogue-stream-recovery-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/catalogue-stream-recovery-runtime-snapshot.zip) | 181435 | `e05dc3a1e9d25dbb9479afd35e7810ea175225420bcd4e53c51f365b099ea62d` |
| [eviction-close-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/eviction-close-runtime-snapshots.zip) | 60738 | `807ce04d15fea30d71e0868debac43491704b08c817e57b5fd73d2368036d2cc` |
| [immutable-catalogue-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/immutable-catalogue-runtime-snapshot.zip) | 140446 | `c07e7ac31e8dd2b7bd772fe5bf8172f2d7da7fc19977a188c8f1d7c8dda2a87d` |
| [managed-close-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/managed-close-runtime-snapshots.zip) | 60455 | `310a54832ac1b874eeb12741bc9cc9f30e3d1c14a8e404a07ee16a2f7bb2b83b` |
| [parser-v5-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/parser-v5-runtime-snapshot.zip) | 68825 | `eaa5c50afafc80dce4a2655daa4edf61c98b90f5d5675fe219bd2031817e1443` |
| [publication-sync-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/publication-sync-runtime-snapshot.zip) | 73277 | `da7c9d961015ad285b31116a49521dab0c0006d1a2117c6c1c673d7d5a72237b` |
| [publication-timing-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/publication-timing-runtime-snapshots.zip) | 59412 | `13697e11b2f9ea869cf2469f9e1cae077a1b42de6ee84d48e46f2f67a0a7d11c` |
| [retained-block-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/retained-block-runtime-snapshots.zip) | 59746 | `bf9f21c8f79b6189d03081371259f05166e944409a92d3b396d268ca8aa5e860` |
| [retirement-measured-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/retirement-measured-runtime-snapshots.zip) | 59774 | `9be9c0afb90fefab837bf512f272347365d00c0af102dc1505380e62fc881c80` |
| [same-revision-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/same-revision-runtime-snapshots.zip) | 60101 | `976a1dc3bc8bb2eb57c17b8ff317f965a30faca58dcc75471ace3bae9d552eef` |
| [single-read-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/single-read-runtime-snapshot.zip) | 178564 | `14907dac816fed689ac3dc516f64ae7f7ecd2664ad1ddc0aa1576c7134a8b1ae` |
| [streamed-catalogue-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/streamed-catalogue-runtime-snapshot.zip) | 207634 | `6f7ef6f6cc9783b429e7eba03bf26b5fe3d46999afc8e0b69ad748054d92477d` |
| [synchronized-crash-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/synchronized-crash-runtime-snapshot.zip) | 71676 | `29ced33363737a61b37af3ae53ef9f0016aa9e2029d177cf027ca6fb875e5e6a` |
| [unmanaged-resource-runtime-snapshots.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/unmanaged-resource-runtime-snapshots.zip) | 61260 | `4192964263aa129ec4e0831780d1401fa73b216ddee3654c3a2d51ca53433c0a` |
| [validity-runtime-snapshot.zip](https://github.com/openaf/mini-a/blob/6179d05a775ce9568aea9c3bf9c66a7fdc55461b/tests/fixtures/wiki-retrieval-v2/validity-runtime-snapshot.zip) | 69698 | `477244738fc30951ffce7a0ec2d19ec379d01adc52f5527e10a759452fbf6d83` |
