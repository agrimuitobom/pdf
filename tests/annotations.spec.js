// 書き込み：画面と同じ位置に書き出されるか、白塗りで文字が消えるか、回転したページでも正立か
const { test, expect } = require("@playwright/test");
const {
  openApp, loadPdf, exportPdf, inspectPdf, screenColors, pdfColors, boxDiff, handlePos, drag, fixture,
} = require("./helpers");

async function sheetBox(page, i = 0) {
  await page.evaluate((i) => document.querySelectorAll(".sheet")[i].scrollIntoView({ block: "start" }), i);
  await page.waitForTimeout(300);
  return page.locator(".sheet").nth(i).boundingBox();
}

test("四角・ペンは画面と同じ位置に、図形のまま書き出される", async ({ page }) => {
  const errors = await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  const sh = await sheetBox(page);
  await page.keyboard.press("r");
  await drag(page, sh.x + sh.width * 0.6, sh.y + sh.height * 0.1, sh.x + sh.width * 0.85, sh.y + sh.height * 0.25);
  await page.keyboard.press("p");
  await drag(page, sh.x + sh.width * 0.2, sh.y + sh.height * 0.5, sh.x + sh.width * 0.4, sh.y + sh.height * 0.55);
  await page.keyboard.press("Escape");
  const scr = await screenColors(page);
  const bytes = await exportPdf(page);
  const pdf = await pdfColors(page, bytes);
  expect(boxDiff(scr.red, pdf.red)).toBeLessThan(0.01);
  // 画像ではなく図形として入っている（元の文字も文字のまま残る）
  const info = await inspectPdf(page, bytes);
  expect(info.pages[0].text).toContain("MY-SECRET-NUMBER-12345");
  expect(errors).toEqual([]);
});

test("白塗りしたページは、下の文字データごと消える", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  const sh = await sheetBox(page);
  await page.keyboard.press("w");
  await drag(page, sh.x + sh.width * 0.05, sh.y + sh.height * 0.05, sh.x + sh.width * 0.95, sh.y + sh.height * 0.3);
  const info = await inspectPdf(page, await exportPdf(page));
  expect(info.pages[0].text).not.toContain("SECRET");
  expect(info.pages[1].text).toContain("KEEP-THIS-LINE");   // ほかのページはそのまま
});

for (const turns of [0, 1, 2, 3]) {
  test(`${turns * 90}°回したページでも、文字と画像はまっすぐ置かれ、書き出しと一致する`, async ({ page }) => {
    const errors = await openApp(page);
    await loadPdf(page, "src.pdf", 2);
    await page.locator(".thumb").first().click();
    for (let i = 0; i < turns; i++) await page.click("#opRotR");
    await page.click("#zOut"); await page.click("#zOut");
    const sh = await sheetBox(page);

    // 緑の文字
    await page.keyboard.press("t");
    await page.click('.sw[data-color="#1d7a4b"]');
    await page.selectOption("#selSize", "32");
    await page.mouse.click(sh.x + sh.width * 0.1, sh.y + sh.height * 0.1);
    await expect(page.locator("#ted")).toBeVisible();
    expect(await page.$eval("#ted", (e) => e.style.transform)).toBe("rotate(0deg)");
    await page.keyboard.type("ＷＷＷＷＷＷ");
    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("v");

    // 上が赤・下が青の画像
    await page.setInputFiles("#imgIn", fixture("updown.png"));
    await expect.poll(async () => (await screenColors(page)).blue.n).toBeGreaterThan(100);
    const s1 = await screenColors(page);
    const cw = (await page.locator(".sheet .anc").first().boundingBox()).width;
    expect((s1.green.r - s1.green.l) * cw).toBeGreaterThan((s1.green.b - s1.green.t) * cw * 1.5); // 横書き
    expect(s1.red.cy).toBeLessThan(s1.blue.cy);                                                   // 正立

    // 右下のつまみで広げると、画面の左上は動かずに大きくなる
    const h = await handlePos(page);
    await drag(page, h.x, h.y, h.x + 60, h.y + 30);
    await page.keyboard.press("Escape");
    const s2 = await screenColors(page);
    expect(s2.red.r - s2.red.l).toBeGreaterThan((s1.red.r - s1.red.l) * 1.2);
    expect(Math.abs(s2.red.l - s1.red.l)).toBeLessThan(0.01);
    expect(Math.abs(s2.red.t - s1.red.t)).toBeLessThan(0.01);

    const ex = await pdfColors(page, await exportPdf(page));
    expect(boxDiff(ex.green, s2.green)).toBeLessThan(0.01);
    expect(boxDiff(ex.red, s2.red)).toBeLessThan(0.01);
    expect(boxDiff(ex.blue, s2.blue)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
}

for (const kind of ["rect", "pen", "text"]) {
  test(`90°回したページで、${kind} を右下のつまみで大きさを変えられる`, async ({ page }) => {
    await openApp(page);
    await loadPdf(page, "src.pdf", 2);
    await page.locator(".thumb").first().click();
    await page.click("#opRotR");
    const sh = await sheetBox(page);
    if (kind === "rect") {
      await page.keyboard.press("r");
      await drag(page, sh.x + 300, sh.y + 300, sh.x + 400, sh.y + 360);
    } else if (kind === "pen") {
      await page.keyboard.press("p");
      await drag(page, sh.x + 300, sh.y + 300, sh.x + 400, sh.y + 330);
      await page.keyboard.press("v");
      await page.mouse.click(sh.x + 350, sh.y + 315);
    } else {
      await page.keyboard.press("t");
      await page.selectOption("#selSize", "24");
      await page.mouse.click(sh.x + 300, sh.y + 300);
      await expect(page.locator("#ted")).toBeVisible();
      await page.keyboard.type("あいうえおかきくけこさしすせそ");
      await page.keyboard.press("Control+Enter");
      await page.keyboard.press("v");
      await page.mouse.click(sh.x + 310, sh.y + 312);
    }
    await page.keyboard.press("v");
    const a = await screenColors(page);
    const h = await handlePos(page);
    expect(h).not.toBeNull();
    await drag(page, h.x, h.y, h.x + (kind === "text" ? -120 : 80), h.y + 40);
    await page.keyboard.press("Escape");
    const z = await screenColors(page);
    const w0 = a.red.r - a.red.l, w1 = z.red.r - z.red.l, h0 = a.red.b - a.red.t, h1 = z.red.b - z.red.t;
    if (kind === "text") {
      expect(w1).toBeLessThan(w0 * 0.8);   // 幅を狭めると折り返して
      expect(h1).toBeGreaterThan(h0);      // 高さが増える
    } else {
      expect(w1).toBeGreaterThan(w0 * 1.3);
    }
    expect(Math.abs(z.red.t - a.red.t)).toBeLessThan(0.01);
  });
}

test("スマホの写真のような大きな画像は、縮めてから埋め込む", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  // 4000×3000 の写真らしい画像（約3MB以上の JPEG）をページの中で作る
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 4000; c.height = 3000;
    const g = c.getContext("2d"), img = g.createImageData(4000, 3000);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 120 + ((i / 16000) % 120)) | 0;
      img.data[i] = v; img.data[i + 1] = 255 - v; img.data[i + 2] = (v * 3) & 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const photo = Buffer.from(b64, "base64");
  expect(photo.length).toBeGreaterThan(3_000_000);
  await page.setInputFiles("#imgIn", { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.locator("#toast")).toContainText("画像を置きました");
  const out = await exportPdf(page);
  expect(out.length).toBeLessThan(photo.length / 2);
});

test("何も変えずに書き出すと、元のPDFとほぼ同じ大きさになる", async ({ page }) => {
  const fs = require("fs");
  await openApp(page);
  await loadPdf(page, "ol3.pdf", 3);
  const out = await exportPdf(page);
  expect(out.length).toBeLessThan(fs.statSync(fixture("ol3.pdf")).size * 1.2);
});
