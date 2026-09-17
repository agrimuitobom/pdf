/* PDF工房 — オフラインで使えるようにするキャッシュ */
const CACHE = "pdf-koubou-v2";
const ASSETS = [
  "./", "./index.html",
  "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js", "./vendor/pdf-lib.min.js",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"
];
self.addEventListener("install", e => {
  // 1つでも取得に失敗すると addAll は全体が失敗するので、個別に入れる
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const isDoc = req.mode === "navigate" || req.destination === "document";
  if (isDoc) {
    // 更新を取りこぼさないよう、本体は毎回ネットワークを試す
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
