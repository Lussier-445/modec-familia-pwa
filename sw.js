const CACHE_NAME = "modec-familia-v4";
const DB_NAME = "modec-familia-db";
const DB_VERSION = 1;
const NOTIFICATION_STORE = "notifications";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=4",
  "./app.js?v=4",
  "./manifest.webmanifest",
  "./vapid-public-key.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });

          if (response.ok) {
            await cache.put(url, response);
          }
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
  if (event.request.method !== "GET") return;

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
        if (cached) return cached;
        throw error;
      }
    })()
  );
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(NOTIFICATION_STORE)) {
        const store = db.createObjectStore(NOTIFICATION_STORE, {
          keyPath: "notificationId",
        });
        store.createIndex("receivedAt", "receivedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createFallbackId(payload) {
  const base = [
    payload.attendanceId || "attendance",
    payload.type || payload.attendanceType || "event",
    payload.date || "date",
    payload.time || Date.now(),
  ].join("-");

  return `NOT-${base}`.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function storeNotification(payload) {
  const record = {
    notificationId: payload.notificationId || createFallbackId(payload),
    attendanceId: payload.attendanceId ?? null,
    studentName: payload.studentName || payload.data?.studentName || "Estudiante",
    type: payload.type || payload.attendanceType || payload.data?.attendanceType || "INGRESO",
    date: payload.date || payload.data?.date || new Date().toISOString().slice(0, 10),
    time:
      payload.time ||
      payload.data?.time ||
      new Intl.DateTimeFormat("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
      }).format(new Date()),
    title: payload.title || "Asistencia escolar",
    message: payload.message || payload.body || "Tiene un nuevo aviso de asistencia.",
    receivedAt: new Date().toISOString(),
  };

  const db = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(NOTIFICATION_STORE, "readwrite");
      transaction.objectStore(NOTIFICATION_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }

  return record;
}

async function notifyOpenClients(record) {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clientList) {
    client.postMessage({
      type: "MODEC_NOTIFICATION_STORED",
      notification: record,
    });
  }
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "Asistencia escolar",
    body: "Tiene un nuevo aviso de asistencia.",
    url: "./",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    (async () => {
      const record = await storeNotification(payload);
      await notifyOpenClients(record);

      await self.registration.showNotification(record.title, {
        body: record.message,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: record.notificationId,
        renotify: false,
        data: {
          url: payload.url || "./",
          notificationId: record.notificationId,
          attendanceId: record.attendanceId,
        },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./",
    self.registration.scope
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.registration.scope) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        return self.clients.openWindow
          ? self.clients.openWindow(targetUrl)
          : undefined;
      })
  );
});
