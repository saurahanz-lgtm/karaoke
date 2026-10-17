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
    toast.textContent = String(message != null ? message : "");
    toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      toast.addEventListener("transitionend", () => toast.remove(), {
        once: true
      });
      window.setTimeout(() => toast.remove(), 350);
    }, 4200);
  }
  function openActionDialog(options) {
    var _a;
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
    const input = options.mode === "prompt" ? document.createElement("input") : null;
    if (input) {
      input.className = "app-action-dialog__input";
      input.type = options.inputType || "text";
      input.value = (_a = options.defaultValue) != null ? _a : "";
      input.autocomplete = options.inputType === "password" ? "current-password" : "off";
      input.setAttribute("aria-label", options.inputLabel || options.title);
      if (options.maxLength) input.maxLength = options.maxLength;
    }
    const actions = document.createElement("div");
    actions.className = "app-action-dialog__actions";
    const cancelButton = document.createElement("button");
    cancelButton.className = "app-action-dialog__button app-action-dialog__button--cancel";
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
      cancelButton.addEventListener(
        "click",
        () => finish(options.mode === "prompt" ? null : false)
      );
      confirmButton.addEventListener(
        "click",
        () => finish(input ? input.value : true)
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
      input == null ? void 0 : input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        finish(input.value);
      });
      dialog.showModal();
      (input || cancelButton).focus();
      input == null ? void 0 : input.select();
    });
  }
  window.showAppToast = showAppToast;
  window.showAppConfirm = (message, options = {}) => openActionDialog({
    mode: "confirm",
    title: options.title || "Please confirm",
    message: String(message != null ? message : ""),
    confirmLabel: options.confirmLabel || "Continue",
    cancelLabel: options.cancelLabel || "Cancel",
    danger: options.danger === true
  });
  window.showAppPrompt = (message, defaultValue = "", options = {}) => openActionDialog({
    mode: "prompt",
    title: options.title || "Enter a value",
    message: String(message != null ? message : ""),
    defaultValue,
    inputType: options.inputType || "text",
    inputLabel: options.inputLabel,
    maxLength: options.maxLength,
    confirmLabel: options.confirmLabel || "Save",
    cancelLabel: options.cancelLabel || "Cancel",
    danger: false
  });
  document.querySelectorAll("form").forEach((form) => {
    form.noValidate = true;
  });
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const invalidField = [...form.elements].find(
        (field) => field.willValidate && !field.validity.valid
      );
      if (!invalidField) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const label = [...form.querySelectorAll("label")].find(
        (candidate) => candidate.htmlFor === invalidField.id || candidate.contains(invalidField)
      );
      const fieldName = (label == null ? void 0 : label.textContent.trim()) || invalidField.getAttribute("aria-label") || invalidField.name || "This field";
      const validity = invalidField.validity;
      let message = `Check the value in ${fieldName}.`;
      if (validity.valueMissing) {
        message = `${fieldName} is required.`;
      } else if (validity.tooShort) {
        message = `${fieldName} must be at least ${invalidField.minLength} characters.`;
      } else if (validity.tooLong) {
        message = `${fieldName} must be no more than ${invalidField.maxLength} characters.`;
      } else if (validity.typeMismatch || validity.patternMismatch || validity.badInput) {
        message = `Enter a valid value for ${fieldName}.`;
      } else if (validity.rangeUnderflow || validity.rangeOverflow) {
        message = `Enter a value within the allowed range for ${fieldName}.`;
      }
      showAppToast(message, "warning");
      invalidField.focus();
    },
    true
  );
})();
