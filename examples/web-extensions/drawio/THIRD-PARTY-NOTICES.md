# Diagram adapter third-party notices

The original Mini-A adapter is Apache-2.0. It does not contain the draw.io editor,
fonts, templates, stencils, icons, compiled editor bundles or Docker/desktop code.
It communicates with an operator-provided local editor through its embed API.

The supported source baseline is draw.io v32.6.10, commit
`c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3`. A separate editor installation keeps
its own licenses. Do not describe the complete editor asset set as Apache-2.0.

Verified at that baseline:

| Component | License / distribution concern |
| --- | --- |
| [Main source](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/LICENSE) | Apache-2.0; retain its notices and identify modifications. |
| [Stencils](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/stencils/LICENSE), [images](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/img/LICENSE), [shapes](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/shapes/LICENSE) | Additional restrictions concerning software assets in the Atlassian ecosystem. End-user diagram output is excepted. |
| [Templates](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/templates/LICENSE) | CC-BY-4.0. Preserve attribution and reconcile README asset wording before redistribution. |
| [libavoid-js](https://github.com/jgraph/drawio/blob/c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3/src/main/webapp/js/libavoid-js/LICENSE) | LGPL-2.1. Copies may also be present in generated bundles. |
| Fonts and generated bundles | A complete file-level licensing inventory has not been established by this adapter. System fonts only are used by the supported profile; math and optional fonts are disabled. |

The upstream README describes a test distribution and paid production offering.
The [published terms](https://www.drawio.com/trust/terms-of-use/) explicitly
preserve the Apache source rights, separately from hosted-service/product terms.
That distinction does not remove the licenses of bundled assets or libraries.

draw.io and diagrams.net are upstream marks. This package uses neutral branding
and does not claim endorsement. No upstream logo is included.

A future redistributed permissive-only editor requires a complete inventory,
review/removal/replacement of restricted or copyleft components, regenerated
bundles, notices and browser validation. This package is not such a bundle.
