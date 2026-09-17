#!/usr/bin/env node
/*
 * index.html から単体版 pdf-koubou-single.html を作る。
 *
 * 単体版はライブラリまで1ファイルに収めたもので、共有フォルダやUSBメモリに
 * 置いてダブルクリックするだけで使える。index.html を直せば、こちらは
 * このスクリプトで作り直す。手で二重に直さない。
 *
 *   node build-single.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");

/* インライン化するJSに </script> が含まれていると、そこでタグが閉じてしまう */
const safe = (js) => js.replace(/<\/script/gi, "<\\/script");
const inline = (p) => "<script>\n" + safe(read(p)) + "\n</script>";

let html = read("index.html");
const before = html;

function replaceOnce(pattern, value, what) {
  if (!pattern.test(html)) throw new Error("見つかりません: " + what);
  html = html.replace(pattern, () => value);
}

/* 1) ライブラリを埋め込む */
replaceOnce(/<script src="vendor\/pdf\.min\.js"><\/script>/,
            inline("vendor/pdf.min.js"), "pdf.min.js の読み込み");
replaceOnce(/<script src="vendor\/pdf-lib\.min\.js"><\/script>/,
            inline("vendor/pdf-lib.min.js") + "\n" + inline("vendor/pdf.worker.min.js"),
            "pdf-lib.min.js の読み込み");

/* 2) ワーカーは本体に取り込み済みなので、外部ファイルを探しにいかせない。
      pdf.js は workerSrc が空でなければ、読み込み済みのワーカーを
      メインスレッドで使う。 */
replaceOnce(/GlobalWorkerOptions\.workerSrc = "vendor\/pdf\.worker\.min\.js";/,
            'GlobalWorkerOptions.workerSrc = "inline";', "workerSrc の設定");

/* 3) file:// で開くため、外部ファイルに頼る部分を外す */
replaceOnce(/\n<link rel="manifest"[^>]*>/, "", "manifest の link");
replaceOnce(/\n<link rel="apple-touch-icon"[^>]*>/, "", "apple-touch-icon の link");
replaceOnce(/<link rel="icon"[^>]*>/,
            '<link rel="icon" href="data:image/svg+xml;base64,' +
              fs.readFileSync(path.join(dir, "icon.svg")).toString("base64") + '" type="image/svg+xml">',
            "icon の link");
replaceOnce(/\n<script>\nif \("serviceWorker" in navigator[\s\S]*?<\/script>/,
            "", "Service Worker の登録");

if (html === before) throw new Error("何も置き換えられなかった");
if (/src="vendor\//.test(html) || /href="(manifest|icon-)/.test(html))
  throw new Error("外部ファイルへの参照が残っている");

const out = "pdf-koubou-single.html";
fs.writeFileSync(path.join(dir, out), html);
console.log(out + " を作成しました（" + (html.length / 1024 / 1024).toFixed(2) + " MB）");
