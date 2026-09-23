// 印刷と、日付印・名前印
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { openApp, loadPdf, exportPdf, screenColors, stubPrint } = require("./helpers");

/* page.pdf() で「印刷したらこうなる」を取り出し、各ページの大きさ（pt）を返す */
async function printed(page) {
  const buf = await page.pdf({ preferCSSPageSize: true });
  return page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      out.push([Math.round(vp.width), Math.round(vp.height)]);
    }
    return out;
  }, buf.toString("base64"));
}

test("印刷：アプリの画面ではなく、書類だけがページの向きのまま刷られる", async ({ page }) => {
  const errors = await openApp(page);
  // 準備なしにブラウザで印刷しても、案内が1枚出るだけ
  expect(await printed(page)).toHaveLength(1);

  await loadPdf(page, "src.pdf", 2);
  await page.locator(".thumb").last().click();
  await page.click("#opBlank");
  await page.click("#opRotR");                 // 3ページ目は横向き
  await stubPrint(page);
  await page.click("#btnPrint");
  await page.click('.modal [data-a="ok"]');    // 1ページ選択中なので範囲を聞かれる（すべて）
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  expect(await printed(page)).toEqual([[595, 842], [595, 842], [842, 595]]);

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#printArea > *")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("印刷：Ctrl+P は入力欄の中でも横取りし、選んだページだけも刷れる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await stubPrint(page);
  await page.locator(".thumb").nth(1).click();
  await page.focus("#findIn");
  await page.keyboard.press("Control+p");
  await page.waitForSelector("#prttl");
  await page.check('.modal input[value="sel"]');
  await page.click('.modal [data-a="ok"]');
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
  expect(await printed(page)).toEqual([[400, 560]]);
});

test("日付印：指定した大きさ（18mm）で置かれ、入れた内容は次回も残る", async ({ page }) => {
  const errors = await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  await page.click("#btnStamp");
  await page.waitForSelector("#sttl");
  await page.fill('[data-f="top"]', "総務課");
  await page.fill('[data-f="date"]', "2026-09-23");
  await page.fill('[data-f="name"]', "山田");
  await page.click('.modal [data-a="ok"]');
  await expect.poll(async () => (await screenColors(page)).red.n).toBeGreaterThan(100);

  const bytes = await exportPdf(page);
  // 画像の大きさ（cm の拡大率）を調べる。18mm = 51.02pt
  const sizes = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const ops = await (await doc.getPage(1)).getOperatorList();
    const out = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
        for (let j = i - 1; j >= 0; j--) {
          if (ops.fnArray[j] === pdfjsLib.OPS.transform) { const m = ops.argsArray[j]; if (m[0] !== 1) { out.push(m[0]); break; } }
        }
      }
    }
    return out;
  }, bytes.toString("base64"));
  expect(sizes.some((s) => Math.abs(s - 51.02) < 0.1)).toBe(true);

  await page.click("#btnStamp");
  await expect(page.locator('[data-f="top"]')).toHaveValue("総務課");
  await expect(page.locator('[data-f="name"]')).toHaveValue("山田");
  expect(errors).toEqual([]);
});

test("名前印：4文字でも作れ、回転したページにも丸いまま押せる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  await page.locator(".thumb").first().click();
  await page.click("#opRotR");
  await page.click("#btnStamp");
  await page.click('.modal .seg button[data-k="name"]');
  await page.fill('[data-f="name"]', "山田太郎");
  await page.selectOption('[data-f="nameMm"]', "15");
  await page.click('.modal [data-a="ok"]');
  for (let i = 0; i < 4; i++) await page.click("#zIn");   // 小さいと輪の画素が欠けて測りにくい
  await page.waitForTimeout(400);
  await expect.poll(async () => (await screenColors(page)).red.n).toBeGreaterThan(200);
  // 丸印なので、画面で見て縦横がほぼ同じ
  const s = await screenColors(page);
  const cw = (await page.locator(".sheet .anc").first().boundingBox());
  const w = (s.red.r - s.red.l) * cw.width, h = (s.red.b - s.red.t) * cw.height;
  expect(Math.abs(w - h)).toBeLessThan(3);
});
