// Optional format smoke test; use a fresh OpenAF process for each format.
// MINIA_ARTIFACT_TEST_FORMAT=docx oaf -f tests/artifactFormats.js
loadLib('js/artifacts/mini-a-artifact-policy.js')
var format = String(getEnv('MINIA_ARTIFACT_TEST_FORMAT')), bytes, out = new java.io.ByteArrayOutputStream()
try {
  if (format === 'docx') { loadLib('mdconvert.js'); bytes = new MDConvert().toDOCXBytes('# Report\n\nHello') }
  if (format === 'pptx') { loadExternalJars(getOPackPath('plugin-XLS')); var slides = new Packages.org.apache.poi.xslf.usermodel.XMLSlideShow(); slides.createSlide(); slides.write(out); slides.close();bytes=out.toByteArray() }
  if (format === 'xlsx') { loadExternalJars(getOPackPath('plugin-XLS')); var workbook = new Packages.org.apache.poi.xssf.usermodel.XSSFWorkbook();workbook.createSheet('Report').createRow(0).createCell(0).setCellValue('hello');workbook.write(out);workbook.close();bytes=out.toByteArray() }
  if (format === 'pdf') { loadExternalJars(String(getEnv('MINIA_ARTIFACT_PDFBOX_LIBS') || getOPackPath('Tika')));var document = new Packages.org.apache.pdfbox.pdmodel.PDDocument(); document.addPage(new Packages.org.apache.pdfbox.pdmodel.PDPage());document.save(out);document.close();bytes=out.toByteArray() }
  if (format === 'png') { javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2,2,1),'png',out);bytes=out.toByteArray() }
  if (MiniAArtifactPolicy.validate('report.'+format,bytes)!==format) throw new Error('Format mismatch')
  if (format === 'pdf') {
    var active = new Packages.org.apache.pdfbox.pdmodel.PDDocument(), malicious = new java.io.ByteArrayOutputStream()
    active.addPage(new Packages.org.apache.pdfbox.pdmodel.PDPage())
    active.getDocumentCatalog().setOpenAction(new Packages.org.apache.pdfbox.pdmodel.interactive.action.PDActionJavaScript('app.alert(1)'))
    active.save(malicious);active.close()
    var rejected = false
    try { MiniAArtifactPolicy.validate('active.pdf', malicious.toByteArray()) } catch(e) { rejected = true }
    if (!rejected) throw new Error('Active PDF accepted')
  }
  print(format+' generation and validation passed')
} catch(e) {printErr(e);exit(1)}
