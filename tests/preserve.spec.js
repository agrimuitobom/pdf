// 元のPDFのしおり（目次）と入力フォームが、書き出した後も残るか
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { openApp, loadPdf, exportPdf, inspectPdf, fixture } = require("./helpers");

test("しおりはそのまま引き継がれる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "ol3.pdf", 3);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.outline).toEqual([
    { title: "第1章 行事予定", depth: 0, page: 1 },
    { title: "1-1 付録", depth: 1, page: 3 },
    { title: "第2章 収穫祭（名前付き）", depth: 0, page: 2 },
  ]);
});

test("並べ替えるとしおりは新しいページを指し、消したページのしおりは外れる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "ol3.pdf", 3);
  await page.locator(".thumb").nth(0).click();
  await page.click("#opDown");                 // [2, 1, 3]
  await page.locator(".thumb").nth(2).click();
  await page.click("#opDel");                  // [2, 1]
  await expect(page.locator(".sheet")).toHaveCount(2);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.outline).toEqual([
    { title: "第1章 行事予定", depth: 0, page: 2 },
    { title: "第2章 収穫祭（名前付き）", depth: 0, page: 1 },
  ]);
});

test("入力フォームは記入できる状態で残り、ページを複製すると記入欄も別になる", async ({ page }) => {
  await openApp(page);
  const src = await inspectPdf(page, fs.readFileSync(fixture("form3.pdf")));
  expect(src.fields.length).toBeGreaterThan(0);
  await loadPdf(page, "form3.pdf", 2);

  const plain = await inspectPdf(page, await exportPdf(page));
  expect(plain.fields).toEqual(src.fields);

  await page.locator(".thumb").nth(0).click();
  await page.click("#opDup");
  await expect(page.locator(".sheet")).toHaveCount(3);
  const dup = await inspectPdf(page, await exportPdf(page));
  for (const f of src.fields) expect(dup.fields).toContain(f);
  expect(dup.fields.length).toBeGreaterThan(src.fields.length);   // 複製した欄は別の名前になる
});
