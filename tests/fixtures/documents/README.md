Small synthetic document fixtures for `tests/documentReading.js`. DOCX and PDF
were copied from the sibling OpenAF Tika oPack regression fixtures; XLSX is a
minimal OOXML workbook with a Budget sheet, text, and the numeric value 42.
No personal or external document content is included.

Run from the Mini-A checkout with an installed Tika oPack (or permit the standard
`includeOPack` installation):

```sh
OAF_JARGS=-Djava.awt.headless=true oaf -f tests/documentReading.js
```

To use the sibling Tika checkout without installing it:

```sh
MINI_A_TEST_TIKA_PATH=../openaf-opacks/Tika OAF_JARGS=-Djava.awt.headless=true oaf -f tests/documentReading.js
```

The default utility/core suites mock dependency loading and model responses; this
optional test exercises real document parsers and requires Tika's runtime versions.
