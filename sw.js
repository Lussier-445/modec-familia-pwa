const CACHE_NAME = "modec-familia-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js?v=2",
  "./manifest.webmanifest",
  "./vapid-public-key.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Un archivo faltante no debe impedir que el service worker se instale.
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });

          if (!response.ok) {
            console.warn(`[SW] No se pudo precargar ${url}: HTTP ${response.status}`);
            return;
          }

          await cache.put(url, response);
        })
      );
    })()
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);

        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }

        return response;
      } catch (error) {
        const cached = await caches.match(event.request);

        if (cached) {
          return cached;
        }

        throw error;
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "MODEC Familia",
    body: "Tiene un nuevo aviso de asistencia.",
    url: "./",
    tag: "modec-attendance",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: payload.tag,
      renotify: true,
      data: {
        url: payload.url || "./",
        ...payload.data,
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./",
    self.registration.scope
  ).href;

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if (
            client.url.startsWith(self.registration.scope) &&
            "focus" in client
          ) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        return clients.openWindow
          ? clients.openWindow(targetUrl)
          : undefined;
      })
  );
});
