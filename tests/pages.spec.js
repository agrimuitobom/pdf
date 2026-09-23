// 開く・ページの操作・書き出し
const { test, expect } = require("@playwright/test");
const { openApp, loadPdf, exportPdf, inspectPdf, fixture } = require("./helpers");

test("PDFを開くと、全ページと一覧が並ぶ", async ({ page }) => {
  const errors = await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await expect(page.locator(".thumb")).toHaveCount(4);
  await expect(page.locator("#pcount")).toHaveText("/ 4");
  expect(errors).toEqual([]);
});

test("回転・複製・白紙・削除・並べ替えが、書き出したPDFに反映される", async ({ page }) => {
  const errors = await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  const thumbs = page.locator(".thumb");

  await thumbs.nth(0).click();
  await page.click("#opRotR");                   // 1ページ目を右に回す
  await thumbs.nth(1).click();
  await page.click("#opDup");                    // 2ページ目を複製 → 5ページ
  await expect(page.locator(".sheet")).toHaveCount(5);
  await thumbs.nth(4).click();
  await page.click("#opBlank");                  // 最後に白紙 → 6ページ
  await expect(page.locator(".sheet")).toHaveCount(6);
  await thumbs.nth(3).click();
  await page.click("#opDel");                    // 4ページ目（元の3ページ目）を削除 → 5ページ
  await expect(page.locator(".sheet")).toHaveCount(5);
  await thumbs.nth(0).click();
  await page.click("#opDown");                   // 回したページを2番目へ

  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.numPages).toBe(5);
  expect(info.pages.map((p) => p.text)).toEqual(["PAGE-2", "PAGE-1", "PAGE-2", "PAGE-4", ""]);
  expect(info.pages[1].rotate).toBe(90);
  expect(info.pages[1]).toMatchObject({ w: 560, h: 400 });
  expect(errors).toEqual([]);
});

test("元に戻す・やり直す", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await page.locator(".thumb").nth(2).click();
  await page.click("#opDel");
  await expect(page.locator(".sheet")).toHaveCount(3);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".sheet")).toHaveCount(4);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".sheet")).toHaveCount(3);
});

test("選んだページだけを書き出せる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await page.locator(".thumb").nth(1).click();
  await page.locator(".thumb").nth(3).click({ modifiers: ["Control"] });
  const info = await inspectPdf(page, await exportPdf(page, { selection: true }));
  expect(info.pages.map((p) => p.text)).toEqual(["PAGE-2", "PAGE-4"]);
});

test("PDFを追加すると後ろにつながる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btnAdd")]);
  await chooser.setFiles(fixture("four.pdf"));
  await expect(page.locator(".sheet")).toHaveCount(6);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.numPages).toBe(6);
  expect(info.pages[5].text).toBe("PAGE-4");
});

test("パスワード付きPDFを開いて書き出せる", async ({ page }) => {
  const errors = await openApp(page);
  await page.setInputFiles("#fileIn", fixture("enc.pdf"));
  await page.waitForSelector("#pwttl");
  await page.fill('.modal input[type="password"]', "himitsu");
  await page.click('.modal [data-a="ok"]');
  await expect(page.locator(".sheet")).toHaveCount(2);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.numPages).toBe(2);
  expect(errors).toEqual([]);
});

test("ページ整理モードで回転・削除でき、書き込みモードに戻っても反映されている", async ({ page }) => {
  const errors = await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await page.click("#modeOrg");
  await expect(page.locator("#orgGrid .ocard")).toHaveCount(4);
  await page.locator("#orgGrid .ocard").nth(0).click();
  await page.click("#oRotR");
  await page.locator("#orgGrid .ocard").nth(3).click();
  await page.click("#oDel");
  await expect(page.locator("#orgGrid .ocard")).toHaveCount(3);
  await page.click("#modeEdit");
  await expect(page.locator(".sheet")).toHaveCount(3);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.pages.map((p) => [p.text, p.rotate])).toEqual([["PAGE-1", 90], ["PAGE-2", 0], ["PAGE-3", 0]]);
  expect(errors).toEqual([]);
});

test("単体版（1ファイル）を直接開いても、PDFを開いて書き出せる", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + require("path").join(__dirname, "..", "pdf-koubou-single.html"));
  await page.waitForSelector("#btnSample");
  await loadPdf(page, "four.pdf", 4);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.numPages).toBe(4);
  expect(errors).toEqual([]);
});
