import test from "node:test";
import assert from "node:assert/strict";
import { openXlsx, XlsxError } from "../src/xlsx-read.js";
import { readCostExcel, excelDate, excelNumber, pickSheets } from "../src/cost-excel-rows.js";
import { syntheticXlsx, zip } from "./fixtures/synthetic-xlsx.js";
const ledger = { month: "2026-10", categories: Array.from({ length: 9 }, (_, i) => ({ id: `cat-${i + 1}`, scCode: i + 1 })) };
const head = { A1: "26년 10월 사용내역", B2: "사용일자", C2: "사용내역" };

test("xlsx reader: shared and inline strings, numbers, entities, flags; macros are never opened", async () => {
  const book = await openXlsx(syntheticXlsx([{ name: "A&B <시트>", cells: { A1: "공유 & <문자>", B2: "inline:인라인 \"문자\"", C3: 12.5, AA10: 7 } }], { date1904: true, macros: true }));
  assert.deepEqual(book.sheetNames, ["A&B <시트>"]);
  assert.equal(book.hasMacros, true);
  assert.equal(book.date1904, true);
  const sheet = await book.sheet("A&B <시트>");
  assert.deepEqual(sheet.rows.get(1)!.get(1), { text: "공유 & <문자>", numeric: false }); // phonetic run left out
  assert.deepEqual(sheet.rows.get(2)!.get(2), { text: '인라인 "문자"', numeric: false });
  assert.deepEqual(sheet.rows.get(3)!.get(3), { text: "12.5", numeric: true });
  assert.deepEqual(sheet.rows.get(10)!.get(27), { text: "7", numeric: true });
  assert.equal(sheet.rows.has(99), false); // empty cell
  await assert.rejects(book.sheet("없는 시트"), XlsxError);
});

test("xlsx reader refuses non-zip, encrypted, ZIP64, oversized and lying archives", async () => {
  const xml = (s: string) => Buffer.from(s), ok = { name: "xl/_rels/workbook.xml.rels", data: xml("<Relationships/>") };
  await assert.rejects(openXlsx(new Uint8Array(Buffer.from("PK not a workbook"))), /손상|형식/);
  await assert.rejects(openXlsx(new Uint8Array(6 * 1024 * 1024)), /5MiB/);
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: xml("<workbook/>"), flags: 1 }, ok])), /암호/);
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: xml("<workbook/>"), declaredSize: 0xffffffff }, ok])), /ZIP64/);
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: Buffer.alloc(2 * 1024 * 1024) }, ok])), /한도/); // 2MiB of zeros: over 100:1
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: Buffer.alloc(21 * 1024 * 1024, "ab") }, ok])), /한도/);
  // Declared smaller than it really inflates to: cut off, never expanded past the declared size.
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: xml("<workbook>" + "x".repeat(5000) + "</workbook>"), declaredSize: 100 }, ok])), /한도/);
  await assert.rejects(openXlsx(zip([{ name: "xl/workbook.xml", data: xml("<workbook/>"), declaredSize: 500 }, ok])), /손상/);
  await assert.rejects(openXlsx(zip([{ name: "other.xml", data: xml("<a/>") }])), /손상/);
});

test("cell parsers: dates by serial, text and month only; numbers exact or refused", () => {
  const n = (text: string) => ({ text, numeric: true }), s = (text: string) => ({ text, numeric: false });
  assert.equal(excelDate(n("46300"), 0, false).date, "2026-10-05");
  assert.equal(excelDate(n("46300.75"), 0, false).date, "2026-10-05"); // time of day dropped, never rounded up a day
  assert.equal(excelDate(n("44838"), 0, true).date, "2026-10-05");
  for (const t of ["2026-10-05", "26.10.5", "2026/10/05", "2026-10-05T00:00:00", "26년 10월 5일"]) assert.equal(excelDate(s(t), 0, false).date, "2026-10-05", t);
  assert.equal(excelDate(s("10월 5일"), 2026, false).date, "2026-10-05");
  assert.deepEqual(excelDate(s("9월"), 2026, false), { date: "2026-09-30", monthOnly: true });
  for (const t of ["10월 5일", "13월"]) assert.equal(excelDate(s(t), t === "13월" ? 2026 : 0, false).date, "", t);
  assert.equal(excelDate(s("2026-02-30"), 0, false).date, "");
  assert.deepEqual(excelNumber(s(" 1,234,500 원")), { value: "1234500" });
  assert.deepEqual(excelNumber(n("12.50")), { value: "12.5" });
  assert.deepEqual(excelNumber(n("0.333333")), { value: "0.333333" });
  assert.deepEqual(excelNumber(s("-")), { value: null });
  assert.deepEqual(excelNumber(undefined), { value: null });
  for (const t of ["0.30000000000000004", "1E-3", "-5", "(100)", "#DIV/0!", "1.2.3"]) assert.ok("reason" in excelNumber(n(t)), t);
});

test("sheet choice: this month's sheet, else 사용내역, else category sheets", () => {
  assert.deepEqual(pickSheets(["총괄", "26년 9월 사용내역", "26년 10월 사용내역", "사용내역"], "2026-10"), { kind: "monthly", names: ["26년 10월 사용내역"] });
  assert.throws(() => pickSheets(["26년 9월 사용내역"], "2026-10"), /이 원장 월\(2026-10\)/);
  assert.deepEqual(pickSheets(["총괄", "사용내역(을)"], "2026-10"), { kind: "own", names: ["사용내역(을)"] });
  assert.deepEqual(pickSheets(["감시자", "물품", "기타"], "2026-10"), { kind: "category", names: ["감시자", "물품"] });
  assert.throws(() => pickSheets(["Sheet1"], "2026-10"), /가져올 수 있는 사용내역 시트가 없습니다/);
});

test("monthly sheet → TSV: headings set the category, 예상 skipped, direct items become 1 × 금액", async () => {
  const file = syntheticXlsx([{ name: "26년 10월 사용내역", cells: {
    ...head,
    A3: "1. 안전관리자 인건비", B3: 46300, C3: "10월 급여 (합성)", H3: 3500000,
    A4: "2. 안전시설비", B4: "10월 7일", C4: "안전난간  설치", D4: "H1200", E4: "m", F4: 120.5, G4: 18300, H4: 2205150,
    B5: "2026-10-08", C5: "=수식처럼 보이는 내역", F5: 2, G5: 1000,
    A6: "3. 보호구", B6: 46303, C6: "안전모", F6: 12.5, G6: 1999, H6: 24987.5,
    A7: "예상 사용", B7: 46310, C7: "예상 내역은 넣지 않음", F7: 1, G7: 1,
    A8: "5. 교육비 기사용", B8: 46305, C8: "특별교육", F8: 15, H8: 300000,
    A9: "3. 보호구", B9: 46304, C9: "수식 금액의 부동소수 꼬리", F9: 0.1, G9: 3, H9: 0.30000000000000004,
  } }, { name: "총괄", cells: { A1: "무시" } }], { macros: true });
  const r = await readCostExcel(file, ledger);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows, 6);
  assert.deepEqual(r.chunks, [[
    "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon",
    "cat-1\t2026-10-05\t10월 급여 (합성)\t1\t3500000",
    "cat-2\t2026-10-07\t안전난간 설치\t120.5\t18300",
    "cat-2\t2026-10-08\t=수식처럼 보이는 내역\t2\t1000",
    "cat-3\t2026-10-08\t안전모\t12.5\t1999",
    "cat-5\t2026-10-10\t특별교육\t1\t300000",
    "cat-3\t2026-10-09\t수식 금액의 부동소수 꼬리\t0.1\t3", // 금액 cell is only compared, never stored
  ].join("\n")]);
  assert.match(r.notes[0], /매크로는 실행하지 않고/);
  assert.ok(r.notes.some((n) => /8행: 수량·단가가 금액과 맞지 않아 수량 1 × 금액 300000원/.test(n)));
});

test("any problem row means no TSV at all, with a reason per row", async () => {
  const r = await readCostExcel(syntheticXlsx([{ name: "26년 10월 사용내역", cells: {
    ...head,
    A3: "2. 안전시설비", B3: 46300, C3: "금액 불일치", F3: 2, G3: 1000, H3: 2001,
    B4: 46300, C4: "단가 소수", F4: 1, G4: 1000.5,
    B5: 46300, C5: "수량 소수 과다", F5: 0.30000000000000004, G5: 1000,
    B6: 46300, C6: "금액만 있음", H6: 5000,
    B7: 46335, C7: "다음 달 날짜", F7: 1, G7: 1000,
    B8: "어제", C8: "날짜 아님", F8: 1, G8: 1000,
    B9: 46300, C9: "정상", F9: 1, G9: 1000,
    A10: "4. 진단비", B10: 46300, C10: "원 미만 금액", H10: 1000.5,
    A11: "3. 보호구", B11: 46300, C11: "꼬리가 아닌 차이", F11: 0.1, G11: 3, H11: 0.31000000000000005,
  } }]), ledger);
  assert.deepEqual(r.chunks, []);
  const expected: [number, string][] = [
    [3, "금액 2001원이 수량 2 × 단가 1000와 다릅니다"], [4, "단가가 원 단위 양의 정수가 아닙니다"], [5, "수량: 소수 6자리를 넘습니다"], [6, "수량 또는 단가가 비어 있습니다"],
    [7, "지출일 2026-11-09이 원장 월(2026-10) 이후입니다"], [8, "사용일자를 날짜로 읽을 수 없습니다"], [10, "금액이 비어 있거나 원 단위 양의 정수가 아닙니다"], [11, "금액: 소수 6자리를 넘습니다"],
  ];
  assert.deepEqual(r.problems.map((p) => p.row), expected.map((e) => e[0]));
  r.problems.forEach((p, i) => assert.ok(p.message.startsWith(expected[i][1]), p.message));
});

test("사용내역 sheet uses fixed row ranges; category sheets keep only the ledger month; missing category is refused", async () => {
  let r = await readCostExcel(syntheticXlsx([{ name: "사용내역", cells: { B5: 46300, C5: "급여", F5: 1000000, B13: 46301, C13: "난간", D13: 2, E13: 500, F13: 1000, B40: 46301, C40: "범위 밖 행", D40: 1, E40: 1 } }]), ledger);
  assert.deepEqual(r.chunks[0].split("\n").slice(1), ["cat-1\t2026-10-05\t급여\t1\t1000000", "cat-2\t2026-10-06\t난간\t2\t500"]);
  r = await readCostExcel(syntheticXlsx([
    { name: "신호수", cells: { A1: "25년", B2: "12월 31일", C2: "작년 신호수", H2: 100, A3: "26년", B3: "9월", C3: "9월 신호수", H3: 200, B4: "10월", C4: "10월 신호수", H4: 300 } },
    { name: "물품", cells: { A1: "26년", B2: "10월 3일", C2: "장갑", F2: 10, G2: 1200, H2: 12000 } },
  ]), ledger);
  assert.deepEqual(r.chunks[0].split("\n").slice(1), ["cat-1\t2026-10-31\t10월 신호수\t1\t300", "cat-3\t2026-10-03\t장갑\t10\t1200"]);
  assert.match(r.notes[0], /원장 월\(2026-10\)이 아닌 2행은 넣지 않았습니다/);
  assert.ok(r.notes.some((n) => /일자가 없어 그 달 말일\(2026-10-31\)/.test(n)));
  r = await readCostExcel(syntheticXlsx([{ name: "물품", cells: { A1: "26년", B2: "10월 3일", C2: "장갑", F2: 10, G2: 1200 } }]), { month: "2026-10", categories: [{ id: "only-1", scCode: 1 }] });
  assert.deepEqual(r.chunks, []);
  assert.match(r.problems[0].message, /3번 항목이 없습니다/);
  await assert.rejects(readCostExcel(syntheticXlsx([{ name: "물품", cells: {} }]), { month: "2026-10", categories: [{ id: "free" }] }), /SC 9개 항목/);
  await assert.rejects(readCostExcel(syntheticXlsx([{ name: "물품", cells: { A1: "26년" } }]), ledger), /가져올 사용내역을 찾지 못했습니다/);
});

test("more than 100 rows are split into chunks of 100", async () => {
  const cells: Record<string, string | number> = { ...head, A3: "3. 보호구" };
  for (let i = 0; i < 230; i++) Object.assign(cells, { [`B${i + 3}`]: 46300, [`C${i + 3}`]: `대량 ${i + 1}`, [`F${i + 3}`]: 1, [`G${i + 3}`]: 100 + i });
  const r = await readCostExcel(syntheticXlsx([{ name: "26년 10월 사용내역", cells }]), ledger);
  assert.deepEqual(r.chunks.map((c) => c.split("\n").length - 1), [100, 100, 30]);
  assert.equal(r.rows, 230);
  assert.ok(r.chunks.every((c) => Buffer.byteLength(c) <= 102400));
});
