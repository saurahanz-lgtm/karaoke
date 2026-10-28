const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
const isIOS =
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
  (window.navigator.platform === "MacIntel" &&
    window.navigator.maxTouchPoints > 1);
const isKaraokeDisplay =
  window.location.pathname.endsWith("/karaoke-display.html") ||
  window.location.pathname === "/display";

let installButton = document.getElementById("installAppButton");

if (!installButton && !isKaraokeDisplay && !isStandalone) {
  installButton = document.createElement("button");
  installButton.className = "pwa-install-button";
  installButton.id = "installAppButton";
  installButton.type = "button";
  installButton.innerHTML =
    '<i class="bi bi-download" aria-hidden="true"></i><span>Install app</span>';
  document.body.append(installButton);
}

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
};

if (document.readyState === "complete") {
  registerServiceWorker();
} else {
  window.addEventListener("load", registerServiceWorker, { once: true });
}

if (installButton) {
  let installPrompt = null;
  if (!isStandalone) installButton.hidden = false;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      const message = isIOS
        ? "To install SD Karaoke, tap Share in Safari, then choose Add to Home Screen."
        : "Use your browser menu and choose Install app or Add to Home Screen.";
      if (typeof window.showAppToast === "function") {
        window.showAppToast(message);
      } else {
        window.alert(message);
      }
      return;
    }

    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") installButton.hidden = true;
    installPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
  });
}
