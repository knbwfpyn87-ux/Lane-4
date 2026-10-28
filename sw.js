/* Lane 4 service worker: shows race-day reminders sent by the Lane 4 Worker, even when the app is closed.
   It does not cache pages, so the site always loads fresh from GitHub Pages. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
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
