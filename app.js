const enableButton = document.getElementById("enable-push");
const deviceNameInput = document.getElementById("device-name");
const statusElement = document.getElementById("status");
const linkCard = document.getElementById("link-card");
const deviceCodeElement = document.getElementById("device-code");
const outputElement = document.getElementById("subscription-output");
const downloadButton = document.getElementById("download-link");
const copyButton = document.getElementById("copy-link");

let linkPayload = null;

function setStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`.trim();
}

function withTimeout(promise, milliseconds, message) {
  let timerId;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(message));
    }, milliseconds);
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

  const randomPart = createRandomId()
    .slice(0, 10)
    .toUpperCase();

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

  const registration = await navigator.serviceWorker.register(
    "./sw.js?v=2",
    {
      scope: "./",
      updateViaCache: "none",
    }
  );

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

async function activatePush() {
  const deviceName = deviceNameInput.value.trim();

  if (!deviceName) {
    setStatus(
      "Ingrese un nombre para identificar este dispositivo.",
      "warning"
    );
    deviceNameInput.focus();
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
    setStatus(
      "Este navegador no admite notificaciones Web Push.",
      "error"
    );
    return;
  }

  enableButton.disabled = true;
  linkCard.classList.add("hidden");
  setStatus("Preparando el dispositivo...");

  try {
    // Debe solicitarse directamente desde el clic del usuario.
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

    const deviceUid = getOrCreateDeviceUid();

    linkPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      deviceUid,
      deviceName,
      platform: detectPlatform(),
      userAgent: navigator.userAgent,
      subscription: subscription.toJSON(),
    };

    deviceCodeElement.textContent = deviceUid;
    outputElement.textContent = JSON.stringify(linkPayload, null, 2);
    linkCard.classList.remove("hidden");

    setStatus(
      "Notificaciones activadas. Descargue el archivo de vinculación.",
      "success"
    );
  } catch (error) {
    console.error("Error activando Web Push:", error);

    setStatus(
      error.message || "No se pudieron activar las notificaciones.",
      "error"
    );
  } finally {
    enableButton.disabled = false;
  }
}

function downloadLinkFile() {
  if (!linkPayload) {
    return;
  }

  const blob = new Blob(
    [JSON.stringify(linkPayload, null, 2)],
    { type: "application/json" }
  );

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
    await navigator.clipboard.writeText(
      JSON.stringify(linkPayload, null, 2)
    );

    setStatus("Datos de vinculación copiados.", "success");
  } catch (error) {
    console.error(error);

    setStatus(
      "No se pudo copiar. Use el botón Descargar vinculación.",
      "error"
    );
  }
}

enableButton.addEventListener("click", activatePush);
downloadButton.addEventListener("click", downloadLinkFile);
copyButton.addEventListener("click", copyLinkJson);

window.addEventListener("load", () => {
  if (!window.isSecureContext) {
    setStatus(
      "Abra esta aplicación mediante HTTPS para activar Web Push.",
      "error"
    );
    enableButton.disabled = true;
    return;
  }

  setStatus("Listo para activar las notificaciones.");
});
