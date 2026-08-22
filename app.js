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

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function getOrCreateDeviceUid() {
  const saved = localStorage.getItem("modecDeviceUid");
  if (saved) return saved;

  const randomPart = crypto.randomUUID()
    .replaceAll("-", "")
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
  const response = await fetch("./vapid-public-key.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar la clave pública VAPID.");
  }
  const data = await response.json();
  const publicKey = String(data.publicKey || "").trim();
  if (!publicKey || publicKey.startsWith("GENERAR_")) {
    throw new Error("Primero genere las claves VAPID con npm run generate-keys.");
  }
  return publicKey;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Este navegador no admite service workers.");
  }
  return navigator.serviceWorker.register("./sw.js", { scope: "./" });
}

async function activatePush() {
  const deviceName = deviceNameInput.value.trim();
  if (!deviceName) {
    setStatus("Ingrese un nombre para identificar este dispositivo.", "warning");
    deviceNameInput.focus();
    return;
  }

  if (!("PushManager" in window)) {
    setStatus("Este navegador no admite notificaciones Web Push.", "error");
    return;
  }

  enableButton.disabled = true;
  setStatus("Preparando el dispositivo...");

  try {
    const publicKey = await loadPublicKey();
    await registerServiceWorker();
    const registration = await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("El permiso de notificaciones no fue concedido.");
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
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
    setStatus("Notificaciones activadas. Descargue el archivo de vinculación.", "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "No se pudieron activar las notificaciones.", "error");
  } finally {
    enableButton.disabled = false;
  }
}

function downloadLinkFile() {
  if (!linkPayload) return;
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
  if (!linkPayload) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(linkPayload, null, 2));
    setStatus("Datos de vinculación copiados.", "success");
  } catch (error) {
    setStatus("No se pudo copiar. Use el botón Descargar vinculación.", "error");
  }
}

enableButton.addEventListener("click", activatePush);
downloadButton.addEventListener("click", downloadLinkFile);
copyButton.addEventListener("click", copyLinkJson);

window.addEventListener("load", async () => {
  if (!window.isSecureContext) {
    setStatus("Abra esta aplicación mediante HTTPS para activar Web Push.", "error");
    enableButton.disabled = true;
    return;
  }

  try {
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    setStatus("No se pudo registrar el service worker.", "error");
  }
});
