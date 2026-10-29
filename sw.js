/* Lane 4 service worker: makes Lane 4 open and work without Wi-Fi, and shows race-day reminders sent by the
   Lane 4 Worker, even when the app is closed.
   Offline: Lane 4's own files are fetched fresh whenever there's a connection (so updates show right away) and
   the last copy is used when there isn't. Fonts and versioned libraries are kept once downloaded.
   Accounts, cloud save, and Rankings are never cached here; Lane 4 keeps your data on the device itself. */
const CACHE = "lane4-v1";
const CORE = ["./", "index.html", "lane4-firebase.js", "firebase-config.js", "manifest.webmanifest", "lane4-icon-192.png", "lane4-icon-512.png", "favicon-32.png", "apple-touch-icon.png"];
const KEEP = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs\/|cdn\.jsdelivr\.net\/npm\/|cdnjs\.cloudflare\.com\/ajax\/libs\/)/;
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin === self.location.origin) {
    // network first, so a new version shows as soon as you're online; the saved copy when you're not
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === "navigate" ? caches.match("index.html") : Response.error()))));
  } else if (KEEP.test(r.url)) {
    // fonts and pinned library versions don't change: use the saved copy, download it once
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    })));
  }
});
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification("Lane 4: " + (d.title || "Race day"), {
    body: d.body || "", icon: "lane4-icon-192.png", badge: "favicon-32.png", tag: "lane4-meet", renotify: true, data: { url: self.registration.scope + "#meet" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(e.notification.data.url);
  }));
});
