// 自動保存と復元、画面の作り（1行に収まるか・文字の読みやすさ・スマホ）
const { test, expect, devices } = require("@playwright/test");
const { openApp, loadPdf, screenColors, drag } = require("./helpers");

test("自動保存：再読み込みしても、書き込みごと続きから開ける", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  const sh = await page.locator(".sheet").first().boundingBox();
  await page.keyboard.press("r");
  await drag(page, sh.x + 200, sh.y + 200, sh.x + 300, sh.y + 260);
  await page.locator(".thumb").nth(1).click();
  await page.click("#opDel");
  await page.waitForTimeout(2500);           // 保存は操作の1.5秒後
  await page.reload();
  await page.waitForSelector("#rsttl");
  await page.click('.modal [data-a="yes"]');
  await expect(page.locator(".sheet")).toHaveCount(1);
  await expect.poll(async () => (await screenColors(page)).red.n).toBeGreaterThan(100);
});

test("自動保存：「新しく始める」を選ぶと、保存した内容は消える", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  await page.locator(".thumb").nth(1).click();
  await page.click("#opDel");
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForSelector("#rsttl");
  await page.click('.modal [data-a="no"]');
  await expect(page.locator("#emptyStage")).toBeVisible();
  await page.reload();
  await page.waitForSelector("#btnSample");
  await expect(page.locator("#rsttl")).toHaveCount(0);
});

test("文字を探す", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "four.pdf", 4);
  await page.fill("#findIn", "PAGE-3");
  await expect(page.locator("#findCount")).toHaveText("1 / 1");
  await page.fill("#findIn", "PAGE");
  await expect(page.locator("#findCount")).toHaveText("1 / 4");
});

test("拡大・縮小（Ctrl + / - / 0）", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  const z0 = await page.locator("#zLabel").textContent();
  await page.keyboard.press("Control+=");
  await expect(page.locator("#zLabel")).not.toHaveText(z0);
  await page.keyboard.press("Control+0");
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const s = document.querySelector(".sheet").getBoundingClientRect();
    const st = document.querySelector(".stage").getBoundingClientRect();
    return s.width / st.width;
  });
  expect(fit).toBeGreaterThan(0.85);
  expect(fit).toBeLessThan(1.0);
});

test("上の帯は、どの画面幅でも1行に収まる", async ({ page }) => {
  await openApp(page);
  await loadPdf(page, "src.pdf", 2);
  for (const w of [761, 820, 900, 1024, 1180, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(100);
    const h = (await page.locator(".appbar").boundingBox()).height;
    expect(h, `${w}px`).toBeLessThan(60);
  }
});

/* 画面の文字がすべて、背景に対して 4.5:1（大きな文字は 3:1）以上か */
const AUDIT = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) c = blend(stack[i], c);
    return c;
  };
  const bad = [], seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const t = w.currentNode, el = t.parentElement;
    if (!t.textContent.trim() || !el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden") continue;
    if (el.closest("[hidden],#printArea,#printNote,.textLayer,:disabled,.off")) continue;
    let op = 1;
    for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const fg = parse(cs.color), bg = bgOf(el);
    if (!fg || !bg) continue;
    const f = blend({ ...fg, a: fg.a * op }, bg);
    const a = lum(f), b = lum(bg), cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), big = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    if (cr < (big ? 3 : 4.5)) bad.push(`${cr.toFixed(2)} "${t.textContent.trim().slice(0, 16)}"`);
  }
  return bad;
};

for (const scheme of ["light", "dark"]) {
  test(`文字のコントラスト（${scheme === "light" ? "ライト" : "ダーク"}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    expect(await page.evaluate(AUDIT)).toEqual([]);
    await loadPdf(page, "src.pdf", 2);
    await page.keyboard.press("t");
    expect(await page.evaluate(AUDIT)).toEqual([]);
    await page.click("#btnStamp");
    expect(await page.evaluate(AUDIT)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.locator(".thumb").first().click({ button: "right" });
    expect(await page.evaluate(AUDIT)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.click("#modeOrg");
    expect(await page.evaluate(AUDIT)).toEqual([]);
  });
}

// 画面の大きさとタッチ操作だけ iPhone に合わせる（ブラウザは Chromium のまま）
const { defaultBrowserType, ...iphone } = devices["iPhone 13"];
test.describe("スマートフォン", () => {
  test.use(iphone);

  test("ページ一覧は引き出しで開き、「⋯」から印刷や印も使える", async ({ page }) => {
    const errors = await openApp(page);
    await loadPdf(page, "four.pdf", 4);
    await expect(page.locator("#btnPages")).toBeVisible();
    await page.tap("#btnPages");
    await expect(page.locator(".thumb").first()).toBeVisible();
    const sc = await page.locator("#scrim").boundingBox();
    await page.tap("#scrim", { position: { x: sc.width - 12, y: sc.height / 2 } });   // 引き出しの外を触ると閉じる
    await expect(page.locator("#scrim")).toBeHidden();
    await page.tap("#btnMore");
    for (const label of ["開く", "PDFを追加", "印刷", "日付印・名前印を押す", "使い方とショートカット"]) {
      await expect(page.locator(".menu").getByText(label, { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(AUDIT)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
