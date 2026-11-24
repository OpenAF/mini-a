// Licensed under the Apache License, Version 2.0.

import java.io.IOException;
import java.io.RandomAccessFile;
import java.io.UncheckedIOException;
import org.apache.poi.openxml4j.opc.OPCPackage;
import org.apache.poi.openxml4j.opc.PackageAccess;
import org.apache.poi.openxml4j.opc.PackagePart;
import org.apache.poi.openxml4j.opc.TargetMode;
import org.apache.poi.util.XMLHelper;
import org.apache.poi.xssf.eventusermodel.XSSFReader;
import org.xml.sax.InputSource;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import org.apache.poi.hssf.eventusermodel.HSSFEventFactory;
import org.apache.poi.hssf.eventusermodel.HSSFRequest;
import org.apache.poi.hssf.record.BOFRecord;
import org.apache.poi.hssf.record.BoolErrRecord;
import org.apache.poi.hssf.record.BoundSheetRecord;
import org.apache.poi.hssf.record.CellRecord;
import org.apache.poi.hssf.record.FilePassRecord;
import org.apache.poi.hssf.record.FormulaRecord;
import org.apache.poi.hssf.record.LabelRecord;
import org.apache.poi.hssf.record.LabelSSTRecord;
import org.apache.poi.hssf.record.MulRKRecord;
import org.apache.poi.hssf.record.NumberRecord;
import org.apache.poi.hssf.record.RKRecord;
import org.apache.poi.hssf.record.SSTRecord;
import org.apache.poi.hssf.record.StringRecord;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;
import org.apache.poi.ss.usermodel.FormulaError;
import org.apache.poi.ss.util.CellReference;
import java.util.Locale;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.apache.tika.config.loader.TikaLoader;
import org.apache.tika.extractor.EmbeddedDocumentExtractor;
import org.apache.tika.io.TikaInputStream;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.metadata.TikaCoreProperties;
import org.apache.tika.sax.BodyContentHandler;
import org.apache.tika.parser.ParseContext;
import org.xml.sax.Attributes;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

// Runs in a separate JVM so parser allocations cannot exhaust the wiki process.
class MiniAOfficeParts extends DefaultHandler {
    private static final int PART_CHARS = 16000;
    private static final int MAX_PART_CHARS = 21000;
    private final Path root;
    private final long maximum;
    private final String format;
    private final StringBuilder text = new StringBuilder();
    private final StringBuilder heading = new StringBuilder();
    private final StringBuilder inventory = new StringBuilder();
    private String label = "Document";
    private long bytes;
    private int parts, slide, row, firstRow, depth, headingDepth, headingLevel, paragraph;
    private final String[] headings = new String[6];
    private String header;
    private int headerRow;
    private boolean checkedHeader;

    MiniAOfficeParts(Path root, long maximum, String format) {
        this.root = root;
        this.maximum = maximum;
        this.format = format;
    }

    private void write(String name, String content) throws IOException {
        byte[] data = content.getBytes(StandardCharsets.UTF_8);
        if (data.length > maximum - bytes) throw new IOException("Office staging byte limit exceeded");
        Files.write(root.resolve(name), data);
        bytes += data.length;
    }

    private void flush() throws IOException {
        String content = text.toString().strip();
        text.setLength(0);
        int start = firstRow;
        firstRow = 0;
        if (content.isEmpty()) return;
        if (header != null && start > headerRow) content = "Header (row " + headerRow + "): " + header + "\n" + content;
        if (++parts > 16384) throw new IOException("Office staging part limit exceeded");
        String locator = start > 0 ? label + (format.startsWith("doc") ? ", paragraphs " : ", rows ") +
            start + "–" + Math.max(start, row) : label;
        String encoded = Base64.getEncoder().encodeToString(locator.getBytes(StandardCharsets.UTF_8));
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8)));
            inventory.append(parts).append('\t').append(encoded).append('\t').append(hash).append('\n');
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        write(parts + ".txt", content);
    }

    private void boundary(String next) throws IOException {
        flush();
        label = next;
        header = null;
        headerRow = 0;
        checkedHeader = false;
        row = 0;
        firstRow = 0;
    }

    // Repeat a short first row of textual column names in subsequent sheet parts.
    private void considerHeader() {
        if (checkedHeader) return;
        checkedHeader = true;
        String line = text.toString().strip();
        if (line.length() > 512 || firstRow != row || !line.contains("\t")) return;
        for (String cell : line.split("\t")) {
            int equals = cell.indexOf('=');
            if (equals < 0 || cell.substring(equals + 1).codePoints().noneMatch(Character::isLetter)) return;
        }
        header = line;
        headerRow = row;
    }

    @Override
    public void startElement(String uri, String name, String qname, Attributes attributes) throws SAXException {
        depth++;
        String css = attributes.getValue("class");
        try {
            if ("slide".equals(css)) {
                boundary("Slide " + (++slide));
            }
            if ("notes".equals(css)) append("\n\nSpeaker notes\n");
            if (format.startsWith("doc")) {
                if (name.length() == 2 && name.charAt(0) == 'h' && name.charAt(1) >= '1' && name.charAt(1) <= '6') {
                    headingDepth = depth;
                    headingLevel = name.charAt(1) - '1';
                    heading.setLength(0);
                }
                if ("p".equals(name)) row = ++paragraph;
            }
        } catch (IOException e) {
            throw new SAXException(e);
        }
    }

    @Override
    public void endElement(String uri, String name, String qname) throws SAXException {
        try {
            if (depth == headingDepth) {
                String title = heading.toString().replaceAll("\\s+", " ").strip();
                headingDepth = 0;
                if (!title.isEmpty()) {
                    headings[headingLevel] = title;
                    java.util.Arrays.fill(headings, headingLevel + 1, headings.length, null);
                    var path = new ArrayList<String>();
                    for (String part : headings) if (part != null) path.add(part);
                    boundary(String.join(" / ", path));
                }
            }
            if ("td".equals(name) || "th".equals(name)) append("\t");
            if ("p".equals(name) || "tr".equals(name) || "li".equals(name)) append("\n");
            if (text.length() >= PART_CHARS && ("p".equals(name) || "tr".equals(name))) flush();
        } catch (IOException e) {
            throw new SAXException(e);
        } finally {
            depth--;
        }
    }

    private void append(String value) throws IOException {
        int offset = 0;
        while (offset < value.length()) {
            if (text.length() >= MAX_PART_CHARS) flush();
            int end = Math.min(value.length(), offset + MAX_PART_CHARS - text.length());
            if (end < value.length() && Character.isHighSurrogate(value.charAt(end - 1))) {
                if (end - offset == 1) {
                    flush();
                    continue;
                }
                end--;
            }
            if (row > 0 && firstRow == 0) firstRow = row;
            text.append(value, offset, end);
            offset = end;
        }
    }

    @Override
    public void characters(char[] chars, int start, int count) throws SAXException {
        try {
            if (headingDepth > 0) {
                int remaining = 512 - heading.length();
                if (remaining > 0) heading.append(chars, start, Math.min(count, remaining));
            } else append(new String(chars, start, count));
        } catch (IOException e) {
            throw new SAXException(e);
        }
    }

    // Store offsets and UTF-8 values on disk to keep unique strings out of the heap.
    private final class DiskStrings implements AutoCloseable {
        private final RandomAccessFile values, offsets;
        private int count;

        DiskStrings() throws IOException {
            values = new RandomAccessFile(root.resolve("scratch/strings").toFile(), "rw");
            offsets = new RandomAccessFile(root.resolve("scratch/offsets").toFile(), "rw");
        }

        private void add(String value) throws IOException {
            byte[] encoded = value.getBytes(StandardCharsets.UTF_8);
            long record = 12L + encoded.length;
            if (record > maximum - bytes) throw new IOException("Office staging byte limit exceeded");
            offsets.writeLong(values.getFilePointer());
            values.writeInt(encoded.length);
            values.write(encoded);
            bytes += record;
            count++;
        }

        void load(java.io.InputStream input) throws Exception {
            if (input == null) return;
            var parser = XMLHelper.newXMLReader();
            parser.setContentHandler(new DefaultHandler() {
                StringBuilder value = new StringBuilder();
                boolean readingText;
                int phonetic;
                public void startElement(String uri, String name, String qname, Attributes attributes) {
                    if ("si".equals(name)) value.setLength(0);
                    if ("rPh".equals(name)) phonetic++;
                    if ("t".equals(name) && phonetic == 0) readingText = true;
                }
                public void characters(char[] buffer, int start, int size) throws SAXException {
                    if (!readingText) return;
                    if (size > 32767 - value.length()) throw new SAXException("Spreadsheet string exceeds Excel cell limits");
                    value.append(buffer, start, size);
                }
                public void endElement(String uri, String name, String qname) throws SAXException {
                    if ("t".equals(name)) readingText = false;
                    if ("rPh".equals(name)) phonetic--;
                    if ("si".equals(name)) {
                        try { add(value.toString()); }
                        catch (IOException e) { throw new SAXException(e); }
                    }
                }
            });
            parser.parse(new InputSource(input));
        }

        String get(int index) {
            if (index < 0 || index >= count) throw new IndexOutOfBoundsException("Invalid spreadsheet string index");
            try {
                offsets.seek(8L * index);
                values.seek(offsets.readLong());
                byte[] encoded = new byte[values.readInt()];
                values.readFully(encoded);
                return new String(encoded, StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        public void close() throws IOException {
            try { offsets.close(); }
            finally { values.close(); }
        }
    }

    private void readXlsx(Path original) throws Exception {
        Files.createDirectories(root.resolve("scratch"));
        try (var pkg = OPCPackage.open(original.toFile(), PackageAccess.READ); var strings = new DiskStrings()) {
            var reader = new XSSFReader(pkg);
            try (var input = reader.getSharedStringsData()) { strings.load(input); }
            var sheets = reader.getSheetIterator();
            while (sheets.hasNext()) {
                try (var input = sheets.next()) {
                    boundary("Sheet " + sheets.getSheetName());
                    var parser = XMLHelper.newXMLReader();
                    parser.setContentHandler(new DefaultHandler() {
                        final StringBuilder value = new StringBuilder();
                        String address, type;
                        boolean reading, hasValue, hasCell;

                        public void startElement(String uri, String name, String qname, Attributes attributes) {
                            if ("row".equals(name)) {
                                String number = attributes.getValue("r");
                                row = number == null ? row + 1 : Integer.parseInt(number);
                                hasCell = false;
                            } else if ("c".equals(name)) {
                                address = attributes.getValue("r");
                                type = attributes.getValue("t");
                                hasValue = false;
                                value.setLength(0);
                            } else if ("v".equals(name) || "t".equals(name) && "inlineStr".equals(type)) {
                                reading = true;
                                hasValue = true;
                            }
                        }

                        public void characters(char[] chars, int start, int len) throws SAXException {
                            if (!reading) return;
                            if (len > 32767 - value.length()) throw new SAXException("Spreadsheet cell exceeds Excel text limits");
                            value.append(chars, start, len);
                        }

                        public void endElement(String uri, String name, String qname) throws SAXException {
                            try {
                                if ("v".equals(name) || "t".equals(name)) reading = false;
                                if ("c".equals(name) && hasValue) {
                                    String cell = value.toString();
                                    if ("s".equals(type)) cell = strings.get(Integer.parseInt(cell.strip()));
                                    if ("b".equals(type)) cell = "1".equals(cell) ? "TRUE" : "FALSE";
                                    if (hasCell) append("\t");
                                    append((address == null ? "" : address + "=") + cell.replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n"));
                                    hasCell = true;
                                }
                                if ("row".equals(name) && hasCell) {
                                    considerHeader();
                                    append("\n");
                                    if (text.length() >= PART_CHARS) flush();
                                }
                            } catch (IOException e) { throw new SAXException(e); }
                        }
                    });
                    parser.parse(new InputSource(input));
                    flush();
                }
            }
        }
    }

    private void spreadsheetCell(int number, int column, String value) throws IOException {
        if (row != number + 1 && row > 0) {
            considerHeader();
            append("\n");
            if (text.length() >= PART_CHARS) flush();
        } else if (firstRow > 0 && text.length() > 0) {
            append("\t");
        }
        row = number + 1;
        append(CellReference.convertNumToColString(column) + row + "=" +
            value.replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n"));
    }

    private void readXls(Path original) throws IOException {
        var request = new HSSFRequest();
        var workbook = new Object() {
            final ArrayList<BoundSheetRecord> sheets = new ArrayList<>();
            BoundSheetRecord[] ordered;
            SSTRecord strings;
            FormulaRecord formula;
            int sheetNumber;
            boolean inSheet;
        };
        request.addListenerForAllRecords(record -> {
            try {
                if (record instanceof FilePassRecord) throw new IOException("Encrypted spreadsheet");
                if (record instanceof BoundSheetRecord bound) workbook.sheets.add(bound);
                if (record instanceof SSTRecord strings) workbook.strings = strings;
                if (record instanceof StringRecord string && workbook.formula != null) {
                    spreadsheetCell(workbook.formula.getRow(), workbook.formula.getColumn(), string.getString());
                    workbook.formula = null;
                }
                if (record instanceof BOFRecord bof && bof.getType() == BOFRecord.TYPE_WORKSHEET) {
                    if (workbook.ordered == null) workbook.ordered = BoundSheetRecord.orderByBofPosition(workbook.sheets);
                    if (workbook.sheetNumber >= workbook.ordered.length) throw new IOException("Spreadsheet sheet index is invalid");
                    boundary("Sheet " + workbook.ordered[workbook.sheetNumber++].getSheetname());
                    workbook.inSheet = true;
                }
                if (!workbook.inSheet) return;
                if (record instanceof MulRKRecord group) {
                    for (int col = group.getFirstColumn(); col <= group.getLastColumn(); col++) {
                        spreadsheetCell(group.getRow(), col, Double.toString(group.getRKNumberAt(col - group.getFirstColumn())));
                    }
                }
                if (!(record instanceof CellRecord cell)) return;
                String value = null;
                if (record instanceof NumberRecord number) value = Double.toString(number.getValue());
                if (record instanceof RKRecord number) value = Double.toString(number.getRKNumber());
                if (record instanceof LabelRecord label) value = label.getValue();
                if (record instanceof LabelSSTRecord label) value = workbook.strings.getString(label.getSSTIndex()).getString();
                if (record instanceof BoolErrRecord flag) {
                    value = flag.isBoolean() ? String.valueOf(flag.getBooleanValue()).toUpperCase(Locale.ROOT) :
                        FormulaError.forInt(flag.getErrorValue()).getString();
                }
                if (record instanceof FormulaRecord formula) {
                    switch (formula.getCachedResultTypeEnum()) {
                        case STRING -> workbook.formula = formula;
                        case NUMERIC -> value = Double.toString(formula.getValue());
                        case BOOLEAN -> value = String.valueOf(formula.getCachedBooleanValue()).toUpperCase(Locale.ROOT);
                        case ERROR -> value = FormulaError.forInt(formula.getCachedErrorValue()).getString();
                        default -> { }
                    }
                }
                if (value != null) spreadsheetCell(cell.getRow(), cell.getColumn(), value);
            } catch (IOException e) { throw new UncheckedIOException(e); }
        });
        try (var filesystem = new POIFSFileSystem(original.toFile(), true)) {
            new HSSFEventFactory().processWorkbookEvents(request, filesystem);
        }
    }

    // Follow the presentation's slide order and keep notes attached to their slide.
    private void readPptx(Path original) throws Exception {
        try (var pkg = OPCPackage.open(original.toFile(), PackageAccess.READ)) {
            PackagePart presentation = null;
            for (var relation : pkg.getRelationships()) {
                if (relation.getRelationshipType().endsWith("/officeDocument") && relation.getTargetMode() == TargetMode.INTERNAL) {
                    presentation = pkg.getPart(relation);
                    break;
                }
            }
            if (presentation == null || !presentation.getContentType().endsWith("presentation.main+xml")) {
                throw new IOException("Input is not a supported pptx document");
            }
            var document = presentation;
            var parser = XMLHelper.newXMLReader();
            parser.setContentHandler(new DefaultHandler() {
                public void startElement(String uri, String name, String qname, Attributes attributes) throws SAXException {
                    if (!"sldId".equals(name)) return;
                    String id = null;
                    for (int i = 0; i < attributes.getLength(); i++) {
                        if ("id".equals(attributes.getLocalName(i)) && attributes.getURI(i).endsWith("/relationships")) id = attributes.getValue(i);
                    }
                    var relation = id == null ? null : document.getRelationship(id);
                    if (relation == null || relation.getTargetMode() != TargetMode.INTERNAL ||
                        !relation.getRelationshipType().endsWith("/slide")) throw new SAXException("Invalid presentation slide relationship");
                    try {
                        var page = document.getRelatedPart(relation);
                        boundary("Slide " + (++slide));
                        readSlideText(page);
                        for (var related : page.getRelationships()) {
                            if (related.getRelationshipType().endsWith("/notesSlide") && related.getTargetMode() == TargetMode.INTERNAL) {
                                append("\n\nSpeaker notes\n");
                                readSlideText(page.getRelatedPart(related));
                            }
                        }
                    } catch (Exception e) { throw new SAXException(e); }
                }
            });
            try (var stream = document.getInputStream()) { parser.parse(new InputSource(stream)); }
        }
    }

    private void readSlideText(PackagePart part) throws Exception {
        var parser = XMLHelper.newXMLReader();
        parser.setContentHandler(new DefaultHandler() {
            boolean readingText;

            public void startElement(String uri, String name, String qname, Attributes attributes) {
                if ("t".equals(name) && uri.contains("/drawingml/")) readingText = true;
            }

            public void characters(char[] chars, int start, int count) throws SAXException {
                if (!readingText) return;
                try { append(new String(chars, start, count)); }
                catch (IOException e) { throw new SAXException(e); }
            }

            public void endElement(String uri, String name, String qname) throws SAXException {
                if ("t".equals(name)) readingText = false;
                if ("p".equals(name) || "tr".equals(name)) {
                    try {
                        append("\n");
                        if (text.length() >= PART_CHARS) flush();
                    } catch (IOException e) { throw new SAXException(e); }
                }
            }
        });
        try (var stream = part.getInputStream()) { parser.parse(new InputSource(stream)); }
    }

    public static void main(String[] args) throws Exception {
        Path original = Path.of(args[0]);
        String name = original.getFileName().toString();
        String format = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        var parts = new MiniAOfficeParts(Path.of(args[1]), Long.parseLong(args[2]), format);
        if ("xlsx".equals(format)) parts.readXlsx(original);
        else if ("xls".equals(format)) parts.readXls(original);
        else if ("pptx".equals(format)) parts.readPptx(original);
        else parts.readTika(original, name);
        parts.flush();
        if (parts.parts == 0) throw new IOException("Office document yielded no text");
        parts.write("parts.tsv", parts.inventory.toString());
    }
    private void readTika(Path original, String name) throws Exception {
        var loader = TikaLoader.loadDefault();
        var context = loader.loadParseContext();
        context.set(EmbeddedDocumentExtractor.class, new EmbeddedDocumentExtractor() {
            public boolean shouldParseEmbedded(Metadata metadata, ParseContext context) { return false; }
            public void parseEmbedded(TikaInputStream input, org.xml.sax.ContentHandler handler, Metadata meta, ParseContext context, boolean html) {}
        });
        context.setJsonConfig("tesseract-ocr-parser", "{\"skipOcr\":true}");
        var metadata = new Metadata();
        metadata.set(TikaCoreProperties.RESOURCE_NAME_KEY, name);
        try (var input = TikaInputStream.get(original)) {
            loader.loadAutoDetectParser().parse(input, new BodyContentHandler(this), metadata, context);
        }
        String expected = switch (format) {
            case "doc" -> "application/msword";
            case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "ppt" -> "application/vnd.ms-powerpoint";
            default -> "";
        };
        if (!expected.equals(metadata.get("Content-Type"))) throw new IOException("Input is not a supported " + format + " document");
    }

}
