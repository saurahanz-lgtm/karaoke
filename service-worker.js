const CACHE_NAME = "sdkaraoke-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./performer-portal.html",
  "./karaoke-display.html",
  "./admin-dashboard.html",
  "./user-guide.html",
  "./styles.css",
  "./app-dialogs.js",
  "./pwa-install.js",
  "./manifest.webmanifest",
  "./firebase-config.js",
  "./karaoke-sessions.js",
  "./account-requests.js",
  "./youtube-api.js",
  "./assets/compat/app-dialogs.js",
  "./assets/compat/firebase-config.js",
  "./assets/compat/admin-presence.js",
  "./assets/compat/karaoke-display.js",
  "./assets/compat/karaoke-sessions.js",
  "./assets/sd-karaoke-apple-touch-icon.png",
  "./assets/sd-karaoke-icon-192.png",
  "./assets/sd-karaoke-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
