import { deflateRawSync } from "node:zlib";
// Builds a small synthetic .xlsx in memory for tests (no real workbook is ever stored in the repo).
// Strings go to sharedStrings except those starting with "inline:", numbers are numeric cells.
export type SyntheticSheet = { name: string; cells: Record<string, string | number> };
type ZipFile = { name: string; data: Buffer; store?: boolean; flags?: number; declaredSize?: number };
export function zip(files: ZipFile[]) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), body = f.store ? f.data : deflateRawSync(f.data), size = f.declaredSize ?? f.data.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(f.flags ?? 0, 6); head.writeUInt16LE(f.store ? 0 : 8, 8);
    head.writeUInt32LE(body.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(f.flags ?? 0, 8); entry.writeUInt16LE(f.store ? 0 : 8, 10);
    entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(head, name, body);
    central.push(entry, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function syntheticXlsx(sheets: SyntheticSheet[], options: { date1904?: boolean; macros?: boolean; extra?: ZipFile[] } = {}) {
  const shared: string[] = [];
  const sheetXml = (s: SyntheticSheet) =>
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="3" width="12"/></cols><sheetData>${Object.entries(s.cells)
      .map(([ref, v]) =>
        typeof v === "number" ? `<c r="${ref}" s="1"><v>${v}</v></c>`
          : v.startsWith("inline:") ? `<c r="${ref}" t="inlineStr"><is><t>${esc(v.slice(7))}</t></is></c>`
          : `<c r="${ref}" t="s"><v>${shared.push(v) - 1}</v></c>`)
      .join("")}<c r="Z99"/></sheetData></worksheet>`;
  const bodies = sheets.map(sheetXml);
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "xl/workbook.xml", data: Buffer.from(`<workbook xmlns:r="r"><workbookPr${options.date1904 ? ' date1904="1"' : ""}/><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`) },
    { name: "xl/sharedStrings.xml", data: Buffer.from(`<sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t><rPh sb="0" eb="1"><t>phonetic</t></rPh></si>`).join("")}</sst>`) },
    ...bodies.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(b) })),
    ...(options.macros ? [{ name: "xl/vbaProject.bin", data: Buffer.from("not a real macro") }] : []),
    ...(options.extra ?? []),
  ]);
}
