// Read-only .xlsx/.xlsm reader with no dependency: ZIP central directory + deflate-raw, cached cell values only.
// Never runs macros or formulas (vbaProject.bin is not opened). Works in the browser and in Node (tests).
export class XlsxError extends Error {}
const MiB = 1024 * 1024;
export const XLSX_LIMITS = { file: 5 * MiB, entries: 2000, entry: 20 * MiB, total: 50 * MiB, ratio: 100, cells: 200_000 };
export type XlsxCell = { text: string; numeric: boolean };
export type XlsxSheet = { name: string; rows: Map<number, Map<number, XlsxCell>> };
export type Workbook = { sheetNames: string[]; hasMacros: boolean; date1904: boolean; sheet: (name: string) => Promise<XlsxSheet> };
type Entry = { method: number; compressed: number; size: number; offset: number };
const broken = () => new XlsxError("엑셀 파일이 손상됐거나 .xlsx/.xlsm 형식이 아닙니다. 암호가 걸린 파일은 읽을 수 없습니다.");
const tooBig = () => new XlsxError("엑셀 파일 안의 자료가 너무 큽니다(압축 해제 한도 초과).");

function directory(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw broken();
  const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new XlsxError("ZIP64 형식의 엑셀 파일은 지원하지 않습니다.");
  if (count > XLSX_LIMITS.entries) throw tooBig();
  if (start + size > end) throw broken();
  const entries = new Map<string, Entry>(), utf8 = new TextDecoder();
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50) throw broken();
    const flags = v.getUint16(p + 8, true), n = v.getUint16(p + 28, true),
      entry = { method: v.getUint16(p + 10, true), compressed: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), offset: v.getUint32(p + 42, true) };
    if (flags & 1) throw new XlsxError("암호가 걸린 엑셀 파일은 읽을 수 없습니다.");
    if (entry.compressed === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw new XlsxError("ZIP64 형식의 엑셀 파일은 지원하지 않습니다.");
    entries.set(utf8.decode(b.subarray(p + 46, p + 46 + n)), entry);
    p += 46 + n + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return entries;
}
async function inflate(b: Uint8Array, e: Entry, budget: { left: number }) {
  if (e.method !== 0 && e.method !== 8) throw broken();
  // The declared size is only a first gate: the stream below is cut off at that size, so a lying header cannot expand further.
  if (e.size > XLSX_LIMITS.entry || (e.size > MiB && e.size > e.compressed * XLSX_LIMITS.ratio)) throw tooBig();
  budget.left -= e.size;
  if (budget.left < 0) throw tooBig();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (e.offset + 30 > b.length || v.getUint32(e.offset, true) !== 0x04034b50) throw broken();
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  if (start + e.compressed > b.length) throw broken();
  const data = b.slice(start, start + e.compressed);
  if (e.method === 0) {
    if (data.length !== e.size) throw broken();
    return data;
  }
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(),
    out = new Uint8Array(e.size);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > e.size) {
        await reader.cancel().catch(() => {});
        throw tooBig();
      }
      out.set(value, n);
      n += value.length;
    }
  } catch (error) {
    throw error instanceof XlsxError ? error : broken();
  }
  if (n !== e.size) throw broken();
  return out;
}
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (all, k: string) => {
    if (k[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[k]!;
    const code = k[1] === "x" ? parseInt(k.slice(2), 16) : Number(k.slice(1));
    return code > 0x10ffff ? all : String.fromCodePoint(code);
  });
const attr = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
// Rich text: every <t> run joined, phonetic guides (<rPh>) left out.
const richText = (inner: string) =>
  [...inner.replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => unescape(m[1] ?? "")).join("");
function column(letters: string) {
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}
export async function openXlsx(bytes: Uint8Array): Promise<Workbook> {
  if (bytes.length > XLSX_LIMITS.file) throw new XlsxError("엑셀 파일은 5MiB까지 읽습니다.");
  const entries = directory(bytes), budget = { left: XLSX_LIMITS.total }, utf8 = new TextDecoder();
  const xml = async (path: string) => {
    const e = entries.get(path);
    if (!e) throw broken();
    return utf8.decode(await inflate(bytes, e, budget));
  };
  const workbook = await xml("xl/workbook.xml"), rels = await xml("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : "xl/" + target);
  }
  const paths = new Map<string, string>();
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name"), path = targets.get(attr(m[0], "r:id") ?? "");
    if (name !== undefined && path?.includes("worksheets/")) paths.set(unescape(name), path);
  }
  let strings: string[] | undefined;
  return {
    sheetNames: [...paths.keys()],
    hasMacros: entries.has("xl/vbaProject.bin"),
    date1904: /<workbookPr\b[^>]*\sdate1904="(?:1|true)"/.test(workbook),
    async sheet(name) {
      const path = paths.get(name);
      if (!path) throw new XlsxError(`시트를 찾을 수 없습니다: ${name}`);
      strings ??= entries.has("xl/sharedStrings.xml") ? [...(await xml("xl/sharedStrings.xml")).matchAll(/<si\/>|<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1] ?? "")) : [];
      const rows: XlsxSheet["rows"] = new Map();
      let cells = 0;
      for (const m of (await xml(path)).matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /^([A-Z]{1,3})(\d{1,7})$/.exec(attr(m[1], "r") ?? "");
        if (!ref) throw new XlsxError("셀 위치가 없는 형식의 엑셀 파일은 읽을 수 없습니다. Excel에서 다시 저장해 보세요.");
        if (++cells > XLSX_LIMITS.cells) throw tooBig();
        const inner = m[2] ?? "", type = attr(m[1], "t") ?? "n", v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const text = type === "inlineStr" ? richText(inner) : v === undefined ? "" : type === "s" ? strings[Number(v)] ?? "" : unescape(v);
        if (!text) continue;
        const r = Number(ref[2]);
        if (!rows.has(r)) rows.set(r, new Map());
        rows.get(r)!.set(column(ref[1]), { text, numeric: type === "n" });
      }
      return { name, rows };
    },
  };
}
