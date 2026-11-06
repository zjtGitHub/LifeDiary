const CACHE_NAME = "riji-shell-v5";
const fromScope = (path) => new URL(path, self.registration.scope).toString();
const SHELL_URL = fromScope("./");

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(SHELL_URL, { cache: "reload" });
  if (!response.ok) throw new Error("Could not preload LifeDiary");
  const html = await response.clone().text();
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[a-zA-Z0-9._-]+\.(?:js|css))"/g)].map(match => match[1]);
  await cache.addAll([...new Set(paths), fromScope("manifest.webmanifest"), fromScope("icons/icon.svg")]);
  await cache.put(SHELL_URL, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(SHELL_URL)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (!response.ok || !url.pathname.startsWith("/assets/")) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
