const CACHE_NAME = "sdkaraoke-v4";
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
  "./onboarding-tour.js",
  "./manifest.webmanifest",
  "./firebase-config.js",
  "./karaoke-sessions.js",
  "./account-requests.js",
  "./account-request-ui.js",
  "./performer-room-status.js",
  "./admin-dashboard.js",
  "./youtube-api.js",
  "./assets/compat/app-dialogs.js",
  "./assets/compat/firebase-config.js",
  "./assets/compat/admin-presence.js",
  "./assets/compat/karaoke-display.js",
  "./assets/compat/karaoke-sessions.js",
  "./assets/sd-karaoke-apple-touch-icon.png",
  "./assets/sd-karaoke-icon-192.png",
  "./assets/sd-karaoke-icon-512.png",
];
const OPTIONAL_EXTERNAL_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/js/bootstrap.bundle.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
  "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.0/firebase-database-compat.js",
  "https://www.youtube.com/iframe_api",
];
function isCacheableExternal(url) {
  if (
    (url.hostname === "cdnjs.cloudflare.com" ||
      url.hostname === "cdn.jsdelivr.net" ||
      url.hostname === "fonts.googleapis.com" ||
      url.hostname === "fonts.gstatic.com") &&
    /\.(?:css|js|woff2?)$/i.test(url.pathname)
  ) {
    return true;
  }
  if (
    url.hostname === "www.gstatic.com" &&
    url.pathname.startsWith("/firebasejs/10.7.0/") &&
    url.pathname.endsWith(".js")
  ) {
    return true;
  }
  return (
    url.hostname === "www.youtube.com" && url.pathname === "/iframe_api"
  );
}

async function cacheResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    console.warn("Could not cache offline resource:", error);
  }
}

async function cacheOptionalAsset(cache, asset) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const request = new Request(asset, {
    mode: "no-cors",
    signal: controller.signal,
  });
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response);
    }
  } catch (error) {
    console.warn("Could not cache optional offline asset:", asset, error);
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await Promise.all(
        OPTIONAL_EXTERNAL_ASSETS.map((asset) =>
          cacheOptionalAsset(cache, asset),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("sdkaraoke-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin && !isCacheableExternal(url)) return;

  if (request.mode === "navigate" && isSameOrigin) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await cacheResponse(request, response);
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request, { ignoreSearch: true });
          return cachedPage || caches.match("./index.html");
        }),
    );
    return;
  }

  if (
    isSameOrigin &&
    !/\.(?:css|html|js|json|png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(
      url.pathname,
    )
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      const response = await fetch(request);
      if (response.ok || response.type === "opaque") {
        await cacheResponse(request, response);
      }
      return response;
    }),
  );
});
