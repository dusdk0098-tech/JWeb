import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

test("print routes keep maximum valid headings and cost columns within A4 width", async ({ page }, testInfo) => {
  const artifactDir = process.env.PRINT_LAYOUT_ARTIFACT_DIR
    ? resolve(process.env.PRINT_LAYOUT_ARTIFACT_DIR)
    : testInfo.outputPath("print-layout");
  await mkdir(artifactDir, { recursive: true });
  // Optional local baseline/fix probe before rebuilding. Normal runs consume the
  // real dist/print.css served by the application, including final build checks.
  if (process.env.PRINT_LAYOUT_SOURCE_CSS === "1") {
    await page.route("**/print.css", (route) => route.fulfill({
      path: resolve("public/print.css"), contentType: "text/css",
    }));
  }
  await page.goto("/");
  await page.getByLabel("이메일 또는 아이디", { exact: true }).fill("test@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, {
      headers: {
        Origin: "http://127.0.0.1:3107",
        "x-csrf-token": session.csrf,
        "idempotency-key": randomUUID(),
      }, data,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const site = await post("/api/sites", { name: "Synthetic print layout" });
  const base = `/api/sites/${site.id}`;
  const category = "C".repeat(100);
  const planAmount = "999999999999999.999999";
  const openingAmount = "444444444444444.444444";
  const cost = await post(`${base}/cost-periods`, {
    month: "2026-10", openingNote: "Synthetic exact-decimal layout",
    categories: [{ label: category, plan: planAmount, opening: openingAmount }],
  });
  const planTitle = "W".repeat(200);
  const plan = await post(`${base}/work-plans`, { body: {
    title: planTitle, date: "2026-10-30", startTime: "09:00", endTime: "10:00",
    location: "Synthetic", workDescription: "Synthetic layout only",
    emergencyProcedure: "Synthetic response", verificationNote: "PRINT-END-WORKPLAN",
    steps: [{ task: "Synthetic step", procedure: "Line of synthetic procedure.\n".repeat(40), precaution: "Synthetic precaution" }],
    equipmentIds: [], duties: [],
  } });
  const inspectionHeading = "I".repeat(500);
  const template = await post(`${base}/inspection-templates`, {
    title: "Synthetic print inspection", instructions: "Synthetic layout only",
    items: [inspectionHeading],
  });
  const published = await post(`${base}/inspection-templates/${template.id}/publish`, { version: template.version });
  const inspection = await post(`${base}/inspections`, {
    templateId: published.id,
    body: {
      date: "2026-10-30", location: "Synthetic", performedBy: "Synthetic operator",
      answers: [{ itemId: published.body.items[0].id, result: "pass", comment: "PRINT-END-INSPECTION" }],
    },
  });
  // The bare /cost-periods/:id/print route was removed; current-ledger print goes through output prepare.
  const costOutput = await (await page.request.get(`${base}/cost-periods/${cost.id}/output/prepare`)).json();
  const reports: Record<string, unknown> = {};
  const documents = [
    { name: "cost", url: `${base}/cost-periods/${cost.id}/output/print?expectedFingerprint=${costOutput.fingerprint}`, texts: [category, planAmount, openingAmount, "555555555555555.555555"] },
    { name: "work-plan", url: `${base}/work-plans/${plan.id}/print`, texts: [planTitle, "PRINT-END-WORKPLAN"] },
    { name: "inspection", url: `${base}/inspections/${inspection.id}/print`, texts: [inspectionHeading, "PRINT-END-INSPECTION"] },
  ];
  for (const documentCase of documents) {
    await page.goto(documentCase.url);
    await page.setViewportSize({ width: 673, height: 1000 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    for (const text of documentCase.texts) await expect(page.locator("body")).toContainText(text);
    const geometry = await printGeometry(page);
    reports[documentCase.name] = geometry;
    await page.screenshot({ path: resolve(artifactDir, `${documentCase.name}.png`), fullPage: true });
    await page.pdf({ path: resolve(artifactDir, `${documentCase.name}.pdf`), preferCSSPageSize: true, printBackground: true });
    expect.soft(geometry.scrollWidth, `${documentCase.name}: document overflows A4 printable width`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect.soft(geometry.overflowingText, `${documentCase.name}: printed text extends outside its content box`).toEqual([]);
    if (documentCase.name === "cost") {
      expect.soft(geometry.tableWidth, "cost table must fit main content").toBeLessThanOrEqual(geometry.mainWidth + 1);
    }
  }
  await writeFile(resolve(artifactDir, "geometry.json"), JSON.stringify(reports, null, 2));
});

async function printGeometry(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main")!.getBoundingClientRect();
    const overflowingText = Array.from(document.querySelectorAll("h1,h2,h3,p,th,td"))
      .map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, sample: element.textContent?.slice(0, 40), textRight: text.right, boxRight: box.right, textLeft: text.left, boxLeft: box.left };
      })
      .filter((value) => value.textRight > value.boxRight + 1 || value.textLeft < value.boxLeft - 1);
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainWidth: main.width,
      tableWidth: document.querySelector("table")?.getBoundingClientRect().width ?? 0,
      overflowingText,
    };
  });
}
