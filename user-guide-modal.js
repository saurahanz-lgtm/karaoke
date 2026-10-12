(() => {
  const dialog = document.getElementById("userGuideDialog");
  if (!dialog) return;

  const closeButton = dialog.querySelector("[data-close-user-guide]");
  const frame = dialog.querySelector(".guide-dialog-frame");
  let lastOpener = null;

  frame.addEventListener("load", () => {
    frame.contentDocument.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !dialog.open) return;
        event.preventDefault();
        dialog.close();
      },
      true,
    );
  });

  document.querySelectorAll("[data-open-user-guide]").forEach((button) => {
    button.addEventListener("click", () => {
      if (dialog.open) return;
      lastOpener = button;
      frame.src = frame.dataset.guideSrc;
      dialog.showModal();
    });
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => lastOpener?.focus());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
