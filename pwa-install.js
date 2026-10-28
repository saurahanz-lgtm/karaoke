const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
};

if (document.readyState === "complete") {
  registerServiceWorker();
} else {
  window.addEventListener("load", registerServiceWorker, { once: true });
}

const installButton = document.getElementById("installAppButton");

if (installButton) {
  let installPrompt = null;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isIOS =
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1);

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
