(() => {
  let activeDialog = null;
  let toastRegion = null;

  function showAppToast(message, type = "info") {
    if (!document.body) return;
    if (!toastRegion) {
      toastRegion = document.createElement("div");
      toastRegion.className = "app-toast-region";
      toastRegion.setAttribute("aria-live", "polite");
      toastRegion.setAttribute("aria-relevant", "additions text");
      document.body.appendChild(toastRegion);
    }

    const toast = document.createElement("div");
    toast.className = `app-toast app-toast--${type}`;
    toast.setAttribute("role", type === "danger" ? "alert" : "status");
    toast.textContent = String(message ?? "");
    toastRegion.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      toast.addEventListener("transitionend", () => toast.remove(), {
        once: true,
      });
      window.setTimeout(() => toast.remove(), 350);
    }, 4200);
  }

  function openActionDialog(options) {
    if (activeDialog)
      return Promise.resolve(options.mode === "prompt" ? null : false);

    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "app-action-dialog";
    dialog.setAttribute("aria-labelledby", "appActionDialogTitle");

    const heading = document.createElement("h2");
    heading.className = "app-action-dialog__title";
    heading.id = "appActionDialogTitle";
    heading.textContent = options.title;

    const message = document.createElement("p");
    message.className = "app-action-dialog__message";
    message.textContent = options.message;

    const input =
      options.mode === "prompt" ? document.createElement("input") : null;
    if (input) {
      input.className = "app-action-dialog__input";
      input.type = options.inputType || "text";
      input.value = options.defaultValue ?? "";
      input.autocomplete =
        options.inputType === "password" ? "current-password" : "off";
      input.setAttribute("aria-label", options.inputLabel || options.title);
      if (options.maxLength) input.maxLength = options.maxLength;
    }

    const actions = document.createElement("div");
    actions.className = "app-action-dialog__actions";

    const cancelButton = document.createElement("button");
    cancelButton.className =
      "app-action-dialog__button app-action-dialog__button--cancel";
    cancelButton.type = "button";
    cancelButton.textContent = options.cancelLabel;

    const confirmButton = document.createElement("button");
    confirmButton.className = `app-action-dialog__button${options.danger ? " app-action-dialog__button--danger" : " app-action-dialog__button--primary"}`;
    confirmButton.type = "button";
    confirmButton.textContent = options.confirmLabel;

    actions.append(cancelButton, confirmButton);
    dialog.append(heading, message);
    if (input) dialog.appendChild(input);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    activeDialog = dialog;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        activeDialog = null;
        resolve(value);
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
          window.setTimeout(() => previousFocus.focus(), 0);
        }
      };

      cancelButton.addEventListener("click", () =>
        finish(options.mode === "prompt" ? null : false),
      );
      confirmButton.addEventListener("click", () =>
        finish(input ? input.value : true),
      );
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(options.mode === "prompt" ? null : false);
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          finish(options.mode === "prompt" ? null : false);
        }
      });
      input?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        finish(input.value);
      });

      dialog.showModal();
      (input || cancelButton).focus();
      input?.select();
    });
  }

  window.showAppToast = showAppToast;
  window.showAppConfirm = (message, options = {}) =>
    openActionDialog({
      mode: "confirm",
      title: options.title || "Please confirm",
      message: String(message ?? ""),
      confirmLabel: options.confirmLabel || "Continue",
      cancelLabel: options.cancelLabel || "Cancel",
      danger: options.danger === true,
    });
  window.showAppPrompt = (message, defaultValue = "", options = {}) =>
    openActionDialog({
      mode: "prompt",
      title: options.title || "Enter a value",
      message: String(message ?? ""),
      defaultValue,
      inputType: options.inputType || "text",
      inputLabel: options.inputLabel,
      maxLength: options.maxLength,
      confirmLabel: options.confirmLabel || "Save",
      cancelLabel: options.cancelLabel || "Cancel",
      danger: false,
    });
})();
