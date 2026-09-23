// テストで共通に使う操作と、書き出したPDFの調べ方。
// PDFの中身は、アプリが読み込んでいる pdf.js（window.pdfjsLib）で調べる。
const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

const fixture = (name) => path.join(__dirname, "fixtures", name);

/* アプリを開く。ページ上のエラーは配列に集め、各テストの最後に空であることを確かめる */
async function openApp(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/index.html");
  await page.waitForSelector("#btnSample");
  return errors;
}

/* PDFを開いて、最初のページが描かれるまで待つ */
async function loadPdf(page, name, count) {
  await page.setInputFiles("#fileIn", fixture(name));
  await expect(page.locator(".sheet")).toHaveCount(count);
  await page.waitForFunction(() => {
    const c = document.querySelector(".sheet .anc");
    return c && c.width > 0;
  });
}

/* 書き出して、そのファイルの中身（Buffer）を返す */
async function exportPdf(page, { selection = false } = {}) {
  await page.click("#btnExport");
  await page.waitForSelector("#exttl");
  if (selection) await page.check('.modal input[value="sel"]');
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click('.modal [data-a="ok"]'),
  ]);
  return fs.readFileSync(await dl.path());
}

/* PDFのページ数・大きさ・回転・文字・しおり・入力欄を調べる */
async function inspectPdf(page, bytes, { password } = {}) {
  return page.evaluate(
    async ({ b64, password }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjsLib.getDocument({ data, password, isEvalSupported: false }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        const tc = await pg.getTextContent();
        pages.push({
          w: Math.round(vp.width),
          h: Math.round(vp.height),
          rotate: pg.rotate,
          text: tc.items.map((x) => x.str).join(""),
        });
      }
      const outline = [];
      async function walk(items, depth) {
        for (const it of items || []) {
          let dest = it.dest, pageNo = null;
          if (typeof dest === "string") dest = await doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) pageNo = (await doc.getPageIndex(dest[0])) + 1;
          outline.push({ title: it.title, depth, page: pageNo });
          await walk(it.items, depth + 1);
        }
      }
      await walk(await doc.getOutline(), 0);
      const fo = await doc.getFieldObjects();
      const fields = fo ? Object.keys(fo).sort() : [];
      await doc.destroy();
      return { numPages: pages.length, pages, outline, fields };
    },
    { b64: bytes.toString("base64"), password }
  );
}

/* 色ごとに、画素の外接箱（0〜1の割合）と重心の高さを返す関数（ページ内で eval する） */
const SCAN = `(c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const cls = {
    red:   (r, g, b) => r > 150 && g < 90 && b < 90,
    blue:  (r, g, b) => b > 170 && r < 80 && g < 110,
    green: (r, g, b) => g > 100 && r < 90 && b < 90,
  };
  const res = {};
  for (const k in cls) {
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sy = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 200 && cls[k](d[i], d[i + 1], d[i + 2])) {
        n++; sy += y;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    res[k] = n ? { n, l: x0 / c.width, t: y0 / c.height, r: x1 / c.width, b: y1 / c.height, cy: sy / n / c.height } : { n: 0 };
  }
  return res;
}`;

/* 画面上の書き込み（i番目のページ）の色の位置 */
async function screenColors(page, sheetIndex = 0) {
  return page.evaluate(
    ({ SCAN, i }) => eval("(" + SCAN + ")")(document.querySelectorAll(".sheet")[i].querySelector(".anc")),
    { SCAN, i: sheetIndex }
  );
}

/* PDFの n ページ目を描いて、色の位置を返す */
async function pdfColors(page, bytes, pageNo = 1) {
  return page.evaluate(
    async ({ b64, SCAN, pageNo }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      const pg = await doc.getPage(pageNo);
      const vp = pg.getViewport({ scale: 0.8 });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      await doc.destroy();
      return eval("(" + SCAN + ")")(c);
    },
    { b64: bytes.toString("base64"), SCAN, pageNo }
  );
}

/* 2つの外接箱のずれ（割合）の最大 */
function boxDiff(a, b) {
  return Math.max(Math.abs(a.l - b.l), Math.abs(a.t - b.t), Math.abs(a.r - b.r), Math.abs(a.b - b.b));
}

/* 選択中の書き込みの、右下のつまみの位置（画面座標） */
async function handlePos(page, sheetIndex = 0) {
  return page.evaluate((i) => {
    const c = document.querySelectorAll(".sheet")[i].querySelector(".anc");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let bx = -1, by = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const k = (y * c.width + x) * 4;
      if (d[k] === 47 && d[k + 1] === 93 && d[k + 2] === 143 && d[k + 3] === 255 && x + y > bx + by) { bx = x; by = y; }
    }
    if (bx < 0) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + (bx * r.width) / c.width - 2, y: r.top + (by * r.height) / c.height - 2 };
  }, sheetIndex);
}

/* ドラッグ（マウス） */
async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
}

/* window.print を差し替えて、呼ばれた回数を数える */
async function stubPrint(page) {
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => { window.__printed++; };
  });
}

module.exports = {
  fixture, openApp, loadPdf, exportPdf, inspectPdf, screenColors, pdfColors,
  boxDiff, handlePos, drag, stubPrint,
};
