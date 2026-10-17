document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("performerPasswordChangeToggle");
  const form = document.getElementById("performerPasswordChangeForm");
  const allowanceMessage = document.getElementById(
    "performerPasswordChangeAllowance",
  );
  const feedback = document.getElementById("performerPasswordChangeFeedback");
  const submitButton = document.getElementById("performerPasswordChangeSubmit");
  const signOutButton = document.getElementById(
    "performerPasswordChangeRequestApproval",
  );
  const currentPasswordInput = document.getElementById(
    "performerCurrentPassword",
  );
  const newPasswordInput = document.getElementById("performerNewPassword");
  const confirmPasswordInput = document.getElementById(
    "performerConfirmPassword",
  );

  let account = null;
  try {
    account = JSON.parse(
      localStorage.getItem("karaoke_logged_in_user") || "null",
    );
  } catch (error) {
    account = null;
  }

  if (!account || account.role !== "user") {
    toggle.hidden = true;
    form.hidden = true;
    return;
  }

  async function updateAllowance() {
    try {
      const allowance = await KaraokeAccountRequests.getPasswordChangeAllowance(
        account.username,
        account.role,
      );
      const approvalRequired = allowance.remaining === 0;
      allowanceMessage.textContent = approvalRequired
        ? allowance.limit === 0
          ? "Password changes require administrator approval. Sign out and use Forgot password."
          : "Your self-service password change limit has been reached."
        : `${allowance.remaining} of ${allowance.limit} self-service password changes remaining.`;
      submitButton.disabled = approvalRequired;
      signOutButton.hidden = !approvalRequired;
      return allowance;
    } catch (error) {
      console.error("Could not load password change allowance:", error.message);
      allowanceMessage.textContent =
        "Could not check password change access. Check your connection.";
      submitButton.disabled = true;
      signOutButton.hidden = true;
      return null;
    }
  }

  toggle.addEventListener("click", async () => {
    const isOpening = form.hidden;
    form.hidden = !isOpening;
    toggle.setAttribute("aria-expanded", String(isOpening));
    if (isOpening) {
      feedback.textContent = "";
      await updateAllowance();
      if (!submitButton.disabled) currentPasswordInput.focus();
    }
  });

  document
    .getElementById("performerPasswordChangeClose")
    .addEventListener("click", () => {
      form.reset();
      form.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    });

  signOutButton.addEventListener("click", async () => {
    if (typeof window.logoutFromPerformerSession === "function") {
      await window.logoutFromPerformerSession();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    if (newPassword !== confirmPasswordInput.value) {
      feedback.textContent = "The new passwords do not match.";
      feedback.dataset.state = "error";
      return;
    }

    submitButton.disabled = true;
    feedback.textContent = "Updating password...";
    feedback.dataset.state = "pending";
    try {
      if (
        typeof window.KaraokeAccountRequests?.getPasswordChangeAllowance !==
        "function"
      ) {
        throw new Error("POLICY_API_UNAVAILABLE");
      }
      const allowance =
        await KaraokeAccountRequests.changePasswordWithCurrentPassword(
          account.username,
          currentPassword,
          newPassword,
        );
      account.password = newPassword;
      localStorage.setItem("karaoke_logged_in_user", JSON.stringify(account));
      form.reset();
      feedback.textContent = "Password updated successfully.";
      feedback.dataset.state = "success";
      allowanceMessage.textContent =
        allowance.remaining === 0
          ? "Your self-service password change limit has been reached."
          : `${allowance.remaining} of ${allowance.limit} self-service password changes remaining.`;
      signOutButton.hidden = allowance.remaining > 0;
      submitButton.disabled = allowance.remaining === 0;
    } catch (error) {
      const messages = {
        ACCOUNT_NOT_FOUND: "This account is no longer available.",
        CURRENT_PASSWORD_INVALID: "The current password is incorrect.",
        PASSWORD_CHANGE_APPROVAL_REQUIRED:
          "The self-service limit is reached. Sign out and use Forgot password to request admin approval.",
        PASSWORD_CHANGE_LIMIT_UNAVAILABLE:
          "Could not check the password change limit. Try again.",
        PASSWORD_TOO_LONG: "Use no more than 128 characters.",
        PASSWORD_TOO_SHORT: "Use at least 6 characters.",
        PASSWORD_UNCHANGED: "Choose a password different from the current one.",
      };
      feedback.textContent =
        messages[error.message] || "Could not update your password. Try again.";
      feedback.dataset.state = "error";
      await updateAllowance();
    }
  });
});
