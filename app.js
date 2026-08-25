const enableButton = document.getElementById("enable-push");
const saveProfileButton = document.getElementById("save-profile");
const guardianFullNameInput = document.getElementById("guardian-full-name");
const deviceNameInput = document.getElementById("device-name");
const profileState = document.getElementById("profile-state");
const statusElement = document.getElementById("status");
const linkCard = document.getElementById("link-card");
const deviceCodeElement = document.getElementById("device-code");
const outputElement = document.getElementById("subscription-output");
const downloadButton = document.getElementById("download-link");
const copyButton = document.getElementById("copy-link");
const historyList = document.getElementById("history-list");
const historySummary = document.getElementById("history-summary");
const lastNotificationTitle = document.getElementById("last-notification-title");
const lastNotificationMeta = document.getElementById("last-notification-meta");
const clearHistoryButton = document.getElementById("clear-history");

const DB_NAME = "modec-familia-db";
const DB_VERSION = 1;
const NOTIFICATION_STORE = "notifications";

let linkPayload = null;

function setStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`.trim();
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function getProfile() {
  return {
    guardianFullName: normalizeName(
      localStorage.getItem("modecGuardianFullName")
    ),
    deviceName: normalizeName(
      localStorage.getItem("modecDeviceName")
    ),
  };
}

function updateProfileState() {
  const profile = getProfile();
  const saved = Boolean(profile.guardianFullName && profile.deviceName);

  profileState.textContent = saved ? "Guardado" : "Sin guardar";
  profileState.classList.toggle("success", saved);
}

function saveProfile({ silent = false } = {}) {
  const guardianFullName = normalizeName(guardianFullNameInput.value);
  const deviceName = normalizeName(deviceNameInput.value);

  if (guardianFullName.length < 5 || !guardianFullName.includes(" ")) {
    if (!silent) {
      setStatus(
        "Ingrese el nombre y los apellidos del apoderado. Ejemplo: Sandra Díaz Uribe.",
        "warning"
      );
      guardianFullNameInput.focus();
    }
    return null;
  }

  if (!deviceName) {
    if (!silent) {
      setStatus("Ingrese un nombre para identificar este dispositivo.", "warning");
      deviceNameInput.focus();
    }
    return null;
  }

  localStorage.setItem("modecGuardianFullName", guardianFullName);
  localStorage.setItem("modecDeviceName", deviceName);
  updateProfileState();

  if (!silent) {
    setStatus("Perfil guardado correctamente.", "success");
  }

  return { guardianFullName, deviceName };
}

function withTimeout(promise, milliseconds, message) {
  let timerId;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timerId);
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((char) => char.charCodeAt(0))
  );
}

function createRandomId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  const values = new Uint8Array(16);
  crypto.getRandomValues(values);

  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function getOrCreateDeviceUid() {
  const saved = localStorage.getItem("modecDeviceUid");
  if (saved) {
    return saved;
  }

  const randomPart = createRandomId().slice(0, 10).toUpperCase();
  const uid = `DEV-${randomPart.slice(0, 5)}-${randomPart.slice(5)}`;
  localStorage.setItem("modecDeviceUid", uid);

  return uid;
}

function detectPlatform() {
  const ua = navigator.userAgent;

  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";

  return "Otro";
}

async function loadPublicKey() {
  setStatus("Cargando la clave pública...");

  const response = await withTimeout(
    fetch("./vapid-public-key.json", { cache: "no-store" }),
    10000,
    "La clave pública tardó demasiado en cargar."
  );

  if (!response.ok) {
    throw new Error(
      `No se pudo cargar vapid-public-key.json (HTTP ${response.status}).`
    );
  }

  const data = await response.json();
  const publicKey = String(data.publicKey || "").trim();

  if (!publicKey || publicKey.startsWith("GENERAR_")) {
    throw new Error(
      "La clave VAPID todavía no fue generada o no se subió a GitHub."
    );
  }

  return publicKey;
}

async function registerAndWaitForServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Este navegador no admite service workers.");
  }

  setStatus("Registrando el servicio de notificaciones...");

  const registration = await navigator.serviceWorker.register("./sw.js?v=4", {
    scope: "./",
    updateViaCache: "none",
  });

  try {
    await registration.update();
  } catch (error) {
    console.warn("No se pudo forzar la actualización del service worker.", error);
  }

  setStatus("Activando el servicio de notificaciones...");

  return withTimeout(
    navigator.serviceWorker.ready,
    15000,
    "El service worker no pudo activarse. Actualice la página o borre los datos del sitio."
  );
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    throw new Error("Este navegador no admite notificaciones.");
  }

  if (Notification.permission === "denied") {
    throw new Error(
      "Las notificaciones están bloqueadas. Habilítelas desde la configuración del sitio en Chrome."
    );
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  setStatus("Esperando autorización de notificaciones...");
  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("El permiso de notificaciones no fue concedido.");
  }

  return permission;
}

function buildLinkPayload(subscription, profile) {
  const deviceUid = getOrCreateDeviceUid();

  return {
    version: 2,
    createdAt: new Date().toISOString(),
    guardianFullName: profile.guardianFullName,
    deviceUid,
    deviceName: profile.deviceName,
    platform: detectPlatform(),
    userAgent: navigator.userAgent,
    subscription: subscription.toJSON(),
  };
}

function renderLinkPayload(payload) {
  linkPayload = payload;
  deviceCodeElement.textContent = payload.deviceUid;
  outputElement.textContent = JSON.stringify(payload, null, 2);
  linkCard.classList.remove("hidden");
}

async function activatePush() {
  const profile = saveProfile({ silent: true });

  if (!profile) {
    setStatus(
      "Complete y guarde correctamente el nombre del apoderado y del dispositivo.",
      "warning"
    );
    return;
  }

  if (!window.isSecureContext) {
    setStatus(
      "Abra esta aplicación mediante HTTPS para activar Web Push.",
      "error"
    );
    return;
  }

  if (!("PushManager" in window)) {
    setStatus("Este navegador no admite notificaciones Web Push.", "error");
    return;
  }

  enableButton.disabled = true;
  linkCard.classList.add("hidden");
  setStatus("Preparando el dispositivo...");

  try {
    await requestNotificationPermission();

    const publicKey = await loadPublicKey();
    const registration = await registerAndWaitForServiceWorker();

    setStatus("Creando la suscripción del dispositivo...");

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }),
        20000,
        "La suscripción Push tardó demasiado. Revise Google Play Services y la conexión a internet."
      );
    }

    renderLinkPayload(buildLinkPayload(subscription, profile));

    if (navigator.storage?.persist) {
      try {
        await navigator.storage.persist();
      } catch (error) {
        console.warn("No se pudo solicitar almacenamiento persistente.", error);
      }
    }

    setStatus(
      "Notificaciones activadas. Descargue el archivo de vinculación actualizado.",
      "success"
    );
  } catch (error) {
    console.error("Error activando Web Push:", error);
    setStatus(error.message || "No se pudieron activar las notificaciones.", "error");
  } finally {
    enableButton.disabled = false;
  }
}

function downloadLinkFile() {
  if (!linkPayload) {
    setStatus("Primero active las notificaciones.", "warning");
    return;
  }

  const blob = new Blob([JSON.stringify(linkPayload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `modec-device-${linkPayload.deviceUid}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyLinkJson() {
  if (!linkPayload) {
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(linkPayload, null, 2));
    setStatus("Datos de vinculación copiados.", "success");
  } catch (error) {
    console.error(error);
    setStatus("No se pudo copiar. Use Descargar vinculación.", "error");
  }
}

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

async function getHistory() {
  const db = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(NOTIFICATION_STORE, "readonly");
      const store = transaction.objectStore(NOTIFICATION_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = Array.isArray(request.result) ? request.result : [];
        records.sort((a, b) =>
          String(b.receivedAt || "").localeCompare(String(a.receivedAt || ""))
        );
        resolve(records);
      };

      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function clearHistory() {
  const records = await getHistory();

  if (records.length === 0) {
    setStatus("El historial ya está vacío.");
    return;
  }

  if (!window.confirm("¿Desea borrar el historial guardado en este dispositivo?")) {
    return;
  }

  const db = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(NOTIFICATION_STORE, "readwrite");
      transaction.objectStore(NOTIFICATION_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }

  await renderHistory();
  setStatus("Historial local borrado.", "success");
}

function formatDateLabel(value) {
  if (!value) return "Fecha no disponible";

  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function normalizeAttendanceType(value) {
  return String(value || "").toUpperCase() === "SALIDA" ? "SALIDA" : "INGRESO";
}

function renderHistoryItem(record) {
  const type = normalizeAttendanceType(record.type || record.attendanceType);
  const wrapper = document.createElement("article");
  wrapper.className = "history-item";

  const marker = document.createElement("span");
  marker.className = `history-marker ${type === "SALIDA" ? "exit" : "entry"}`;

  const content = document.createElement("div");
  content.className = "history-content";

  const title = document.createElement("strong");
  title.textContent = record.studentName || "Estudiante";

  const meta = document.createElement("span");
  meta.textContent = `${type === "SALIDA" ? "Salida" : "Ingreso"} · ${record.time || "--:--"}`;

  const body = document.createElement("small");
  body.textContent = record.message || record.body || "Aviso de asistencia recibido.";

  content.append(title, meta, body);
  wrapper.append(marker, content);

  return wrapper;
}

async function renderHistory() {
  try {
    const records = await getHistory();
    historyList.innerHTML = "";

    if (records.length === 0) {
      historySummary.classList.add("hidden");
      const empty = document.createElement("div");
      empty.className = "empty-history";
      empty.textContent = "Todavía no hay avisos recibidos en este dispositivo.";
      historyList.appendChild(empty);
      return;
    }

    const last = records[0];
    historySummary.classList.remove("hidden");
    lastNotificationTitle.textContent = last.studentName || "Estudiante";
    lastNotificationMeta.textContent = `${
      normalizeAttendanceType(last.type || last.attendanceType) === "SALIDA"
        ? "Salida"
        : "Ingreso"
    } · ${last.time || "--:--"} · ${formatDateLabel(last.date)}`;

    let currentDate = null;

    for (const record of records) {
      const date = record.date || "sin-fecha";

      if (date !== currentDate) {
        currentDate = date;
        const groupTitle = document.createElement("h3");
        groupTitle.className = "history-date";
        groupTitle.textContent = formatDateLabel(record.date);
        historyList.appendChild(groupTitle);
      }

      historyList.appendChild(renderHistoryItem(record));
    }
  } catch (error) {
    console.error("No se pudo cargar el historial:", error);
    historyList.innerHTML = '<div class="empty-history error-text">No se pudo cargar el historial local.</div>';
  }
}

async function restoreExistingSubscription() {
  const profile = getProfile();

  if (!("serviceWorker" in navigator) || !profile.guardianFullName || !profile.deviceName) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration("./");
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    renderLinkPayload(buildLinkPayload(subscription, profile));
  } catch (error) {
    console.warn("No se pudo restaurar la vinculación existente.", error);
  }
}

saveProfileButton.addEventListener("click", () => saveProfile());
enableButton.addEventListener("click", activatePush);
downloadButton.addEventListener("click", downloadLinkFile);
copyButton.addEventListener("click", copyLinkJson);
clearHistoryButton.addEventListener("click", clearHistory);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "MODEC_NOTIFICATION_STORED") {
      renderHistory();
    }
  });
}

window.addEventListener("load", async () => {
  const profile = getProfile();
  guardianFullNameInput.value = profile.guardianFullName;
  deviceNameInput.value = profile.deviceName;
  updateProfileState();

  if (!window.isSecureContext) {
    setStatus("Abra esta aplicación mediante HTTPS para activar Web Push.", "error");
    enableButton.disabled = true;
  } else {
    setStatus("Listo para configurar.");
  }

  await renderHistory();
  await restoreExistingSubscription();
});
