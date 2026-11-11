// Store-only ZIP writer (no compression, no dependency): JPEGs are already compressed, so storing them is enough.
// UTF-8 file names (general purpose bit 11). Used for the 보드판 사진 묶음 download.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipStore(files: { name: string; data: Uint8Array }[]) {
  const utf8 = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8.encode(f.name), crc = crc32(f.data), local = new Uint8Array(30 + name.length), entry = new Uint8Array(46 + name.length),
      lv = new DataView(local.buffer), ev = new DataView(entry.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true); ev.setUint16(8, 0x0800, true);
    ev.setUint32(16, crc, true); ev.setUint32(20, f.data.length, true); ev.setUint32(24, f.data.length, true); ev.setUint16(28, name.length, true); ev.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, f.data);
    central.push(entry);
    offset += local.length + f.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true); dv.setUint32(12, size, true); dv.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}
