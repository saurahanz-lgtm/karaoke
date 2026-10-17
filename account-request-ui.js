document.addEventListener("DOMContentLoaded", () => {
  const performerOptions = document.getElementById("performerSignInOptions");
  const openRequestButton = document.getElementById("showAccountRequestButton");
  const requestForm = document.getElementById("accountRequestPanel");
  const usernameInput = document.getElementById("requestedAccountUsername");
  const submitButton = document.getElementById("submitAccountRequestButton");
  const feedback = document.getElementById("accountRequestFeedback");
  const accountAdminContactNotice = document.getElementById(
    "accountAdminContactNotice",
  );
  const credentials = document.getElementById("accountRequestCredentials");
  const anotherRequestButton = document.getElementById(
    "anotherAccountRequestButton",
  );
  let stopWatchingRequest = null;
  let currentRequestStatus = null;
  let requestApprovalAudioContext = null;
  let pendingRequestApprovalSoundId = null;
  let requestCooldownTimeout = null;
  const requestLimitStorageKey = "karaoke_account_request_limit_v1";
  const maxAccountRequestsPerDevice = 3;
  const accountRequestCooldownMs = 24 * 60 * 60 * 1000;

  function getAccountRequestLimit() {
    const now = Date.now();
    try {
      const state = JSON.parse(
        localStorage.getItem(requestLimitStorageKey) || "null",
      );
      if (!state || typeof state !== "object") {
        return { count: 0, blockedUntil: 0, windowStartedAt: 0 };
      }
      if (state.blockedUntil > now) {
        return { ...state, blocked: true };
      }
      if (
        (state.blockedUntil && state.blockedUntil <= now) ||
        (state.windowStartedAt &&
          now - state.windowStartedAt >= accountRequestCooldownMs)
      ) {
        localStorage.removeItem(requestLimitStorageKey);
        return { count: 0, blockedUntil: 0, windowStartedAt: 0 };
      }
      return { ...state, blocked: false };
    } catch (error) {
      console.warn("Could not read account request limit:", error.message);
      return { count: 0, blockedUntil: 0, windowStartedAt: 0 };
    }
  }

  function formatCooldown(remainingMs) {
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
  }

  function updateAnotherRequestButton() {
    const limit = getAccountRequestLimit();
    anotherRequestButton.disabled = Boolean(limit.blocked);
    anotherRequestButton.textContent = limit.blocked
      ? `Try again in ${formatCooldown(limit.blockedUntil - Date.now())}`
      : "Submit another request";
    if (requestCooldownTimeout) {
      clearTimeout(requestCooldownTimeout);
      requestCooldownTimeout = null;
    }
    if (limit.blocked) {
      const remainingMs = limit.blockedUntil - Date.now();
      showFeedback(
        `This device has reached 3 account requests. Try again in ${formatCooldown(remainingMs)}.`,
        "error",
      );
      requestCooldownTimeout = setTimeout(
        updateAnotherRequestButton,
        remainingMs + 50,
      );
    }
    return Boolean(limit.blocked);
  }

  function recordSuccessfulAccountRequest() {
    const now = Date.now();
    const current = getAccountRequestLimit();
    if (current.blocked) return;
    const count = (current.count || 0) + 1;
    const state = {
      count,
      windowStartedAt: current.windowStartedAt || now,
      blockedUntil:
        count >= maxAccountRequestsPerDevice
          ? now + accountRequestCooldownMs
          : 0,
    };
    try {
      localStorage.setItem(requestLimitStorageKey, JSON.stringify(state));
    } catch (error) {
      console.warn("Could not save account request limit:", error.message);
    }
  }

  function enableRequestApprovalSound() {
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;

    try {
      requestApprovalAudioContext ??= new AudioContextConstructor();
      const resumePromise =
        requestApprovalAudioContext.state === "suspended"
          ? requestApprovalAudioContext.resume()
          : Promise.resolve();
      resumePromise
        .then(() => {
          if (
            pendingRequestApprovalSoundId &&
            requestApprovalAudioContext.state === "running"
          ) {
            const requestId = pendingRequestApprovalSoundId;
            pendingRequestApprovalSoundId = null;
            playRequestApprovalSound(requestId);
          }
          if (requestApprovalAudioContext.state === "running") {
            document.removeEventListener(
              "pointerdown",
              enableRequestApprovalSound,
            );
            document.removeEventListener("keydown", enableRequestApprovalSound);
          }
        })
        .catch(() => {});
    } catch (error) {
      console.warn("Could not enable account approval sound:", error.message);
    }
  }

  function playRequestApprovalSound(requestId) {
    const playedKey = `karaoke_account_approval_sound_${requestId}`;
    if (sessionStorage.getItem(playedKey)) return;
    if (
      !requestApprovalAudioContext ||
      requestApprovalAudioContext.state !== "running"
    ) {
      pendingRequestApprovalSoundId = requestId;
      enableRequestApprovalSound();
      return;
    }

    sessionStorage.setItem(playedKey, "1");
    const startAt = requestApprovalAudioContext.currentTime;
    [784, 1046].forEach((frequency, index) => {
      const oscillator = requestApprovalAudioContext.createOscillator();
      const volume = requestApprovalAudioContext.createGain();
      const toneStart = startAt + index * 0.14;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      volume.gain.setValueAtTime(0.0001, toneStart);
      volume.gain.exponentialRampToValueAtTime(0.3, toneStart + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.2);
      oscillator.connect(volume);
      volume.connect(requestApprovalAudioContext.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.22);
    });
  }

  document.addEventListener("pointerdown", enableRequestApprovalSound);
  document.addEventListener("keydown", enableRequestApprovalSound);

  function setDefaultRequestButtonText() {
    if (currentRequestStatus === "approved") {
      openRequestButton.textContent = "Account approved. View your credentials";
    } else if (currentRequestStatus === "rejected") {
      openRequestButton.textContent = "Submit another request";
    } else if (sessionStorage.getItem("karaoke_account_request_id")) {
      openRequestButton.textContent = "Check account request status";
    } else {
      openRequestButton.textContent = "Don’t have an account? Request access";
    }
  }

  function resetRequestDetails() {
    credentials.hidden = true;
    anotherRequestButton.hidden = true;
    document.getElementById("approvedAccountUsername").textContent = "";
    document.getElementById("approvedAccountPassword").textContent = "";
  }

  if (sessionStorage.getItem("karaoke_account_request_id")) {
    setDefaultRequestButtonText();
    openRequestButton.setAttribute("aria-live", "polite");
  }

  function showFeedback(message, state = "info") {
    accountAdminContactNotice.hidden = true;
    feedback.textContent = message;
    feedback.dataset.state = state;
  }

  function watchRequest(requestId) {
    stopWatchingRequest?.();
    stopWatchingRequest = KaraokeAccountRequests.listen(
      requestId,
      (request) => {
        if (!request) {
          stopWatchingRequest?.();
          stopWatchingRequest = null;
          sessionStorage.removeItem("karaoke_account_request_id");
          currentRequestStatus = null;
          resetRequestDetails();
          showFeedback("This account request could not be found.", "error");
          return;
        }

        const previousStatus = currentRequestStatus;
        currentRequestStatus = request.status;
        if (request.status === "approved" && previousStatus !== "approved") {
          playRequestApprovalSound(requestId);
        }
        usernameInput.value = request.username || usernameInput.value;
        usernameInput.disabled = true;
        submitButton.disabled = true;
        anotherRequestButton.hidden = !["approved", "rejected"].includes(
          request.status,
        );
        if (request.status !== "rejected") {
          anotherRequestButton.disabled = false;
          anotherRequestButton.textContent = "Submit another request";
          if (requestCooldownTimeout) {
            clearTimeout(requestCooldownTimeout);
            requestCooldownTimeout = null;
          }
        }
        credentials.hidden = request.status !== "approved";

        if (request.status === "pending") {
          showFeedback(
            "Request received. You will see the administrator’s decision here.",
            "pending",
          );
        } else if (request.status === "approving") {
          showFeedback("Your account is being prepared.", "pending");
        } else if (request.status === "approved") {
          showFeedback("Your account request was approved.", "success");
          document.getElementById("approvedAccountUsername").textContent =
            request.username;
          document.getElementById("approvedAccountPassword").textContent =
            request.password || "Password unavailable";
        } else if (request.status === "rejected") {
          const requestLimitReached = updateAnotherRequestButton();
          if (!requestLimitReached) {
            showFeedback(
              request.resolutionMessage ||
                "Your account request was not approved. Please contact an administrator.",
              "error",
            );
          }
        }

        if (requestForm.hidden && request.status === "approved") {
          openRequestButton.textContent =
            "Account approved. View your credentials";
        } else if (requestForm.hidden && request.status === "rejected") {
          openRequestButton.textContent = "Submit another request";
        }
      },
      (error) => {
        console.error("Could not watch account request:", error.message);
        showFeedback(
          "Could not check your request status. Check your connection and try again.",
          "error",
        );
      },
    );
  }

  openRequestButton.addEventListener("click", () => {
    stopRoomQrScanner();
    performerOptions.hidden = true;
    openRequestButton.hidden = true;
    requestForm.hidden = false;
    const requestId = sessionStorage.getItem("karaoke_account_request_id");
    if (requestId) {
      watchRequest(requestId);
    } else {
      usernameInput.focus();
    }
  });

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const requestedUsername = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(requestedUsername)) {
      showFeedback(
        "Use 3-30 letters, numbers, dots, dashes, or underscores for the username.",
        "error",
      );
      return;
    }

    submitButton.disabled = true;
    showFeedback("Submitting your account request...", "pending");
    try {
      const createSelfServiceAccount =
        window.KaraokeAccountRequests?.createSelfServiceAccount;
      let request =
        typeof createSelfServiceAccount === "function"
          ? await createSelfServiceAccount(requestedUsername)
          : null;
      if (!request) {
        const requestLimit = getAccountRequestLimit();
        if (requestLimit.blocked) {
          submitButton.disabled = false;
          showFeedback(
            `This device has reached 3 account requests. Try again in ${formatCooldown(requestLimit.blockedUntil - Date.now())}.`,
            "error",
          );
          return;
        }
        if (!(await KaraokeAdminPresence.hasActiveAdmin())) {
          submitButton.disabled = false;
          showFeedback("No admin is online right now.", "error");
          accountAdminContactNotice.hidden = false;
          return;
        }
        request = await KaraokeAccountRequests.create(requestedUsername);
      }
      if (request.selfService !== true) recordSuccessfulAccountRequest();
      sessionStorage.setItem("karaoke_account_request_id", request.id);
      watchRequest(request.id);
    } catch (error) {
      submitButton.disabled = false;
      const messages = {
        ACCOUNT_ALREADY_EXISTS:
          "That username already has an account. Return to sign in instead.",
        SELF_SERVICE_ACCOUNT_LIMIT_UNAVAILABLE:
          "Could not check account access limits. Check your connection and try again.",
        ACCOUNT_REQUEST_ALREADY_PENDING:
          "A request for that username is already awaiting review.",
        ADMIN_PRESENCE_UNAVAILABLE:
          "Could not check admin availability. Check your connection and try again.",
        FIREBASE_UNAVAILABLE:
          "Account requests are temporarily unavailable. Please try again later.",
      };
      showFeedback(
        messages[error.message] ||
          "Your request could not be submitted. Check your connection and try again.",
        "error",
      );
    }
  });

  document
    .getElementById("backToPerformerSignInButton")
    .addEventListener("click", () => {
      stopWatchingRequest?.();
      stopWatchingRequest = null;
      requestForm.hidden = true;
      performerOptions.hidden = false;
      openRequestButton.hidden = false;
      setDefaultRequestButtonText();
    });

  anotherRequestButton.addEventListener("click", () => {
    const requestLimit = getAccountRequestLimit();
    if (requestLimit.blocked) {
      updateAnotherRequestButton();
      return;
    }
    stopWatchingRequest?.();
    stopWatchingRequest = null;
    sessionStorage.removeItem("karaoke_account_request_id");
    currentRequestStatus = null;
    requestForm.reset();
    usernameInput.disabled = false;
    submitButton.disabled = false;
    resetRequestDetails();
    anotherRequestButton.disabled = false;
    anotherRequestButton.textContent = "Submit another request";
    showFeedback("", "info");
    setDefaultRequestButtonText();
    usernameInput.focus();
  });

  const passwordResetModal = document.getElementById("passwordResetModal");
  const passwordResetRequestForm = document.getElementById(
    "passwordResetRequestForm",
  );
  const passwordResetPasswordForm = document.getElementById(
    "passwordResetNewPasswordForm",
  );
  const passwordResetUsername = document.getElementById(
    "passwordResetUsername",
  );
  const passwordResetFeedback = document.getElementById(
    "passwordResetFeedback",
  );
  const passwordResetAdminContactNotice = document.getElementById(
    "passwordResetAdminContactNotice",
  );
  const passwordResetRequestButton = document.getElementById(
    "passwordResetRequestButton",
  );
  const passwordResetSaveButton = document.getElementById(
    "passwordResetSaveButton",
  );
  const passwordResetRetryButton = document.getElementById(
    "passwordResetRetryButton",
  );
  const passwordResetStorageKey = "karaoke_password_reset_v1";
  let passwordResetState = null;
  let stopWatchingPasswordReset = null;
  let passwordResetRole = null;

  function readPasswordResetState() {
    try {
      return JSON.parse(
        localStorage.getItem(passwordResetStorageKey) || "null",
      );
    } catch (error) {
      console.warn("Could not read password reset state:", error.message);
      return null;
    }
  }

  function savePasswordResetState(state) {
    passwordResetState = state;
    try {
      if (state) {
        localStorage.setItem(passwordResetStorageKey, JSON.stringify(state));
      } else {
        localStorage.removeItem(passwordResetStorageKey);
      }
    } catch (error) {
      console.warn("Could not save password reset state:", error.message);
    }
  }

  function setPasswordResetFeedback(message, state = "info") {
    passwordResetAdminContactNotice.hidden = true;
    passwordResetFeedback.textContent = message;
    passwordResetFeedback.dataset.state = state;
  }

  function showPasswordResetRequestAgain() {
    stopWatchingPasswordReset?.();
    stopWatchingPasswordReset = null;
    savePasswordResetState(null);
    passwordResetRequestForm.hidden = false;
    passwordResetPasswordForm.hidden = true;
    passwordResetUsername.disabled = false;
    passwordResetRequestButton.disabled = false;
    passwordResetRetryButton.hidden = true;
    setPasswordResetFeedback("", "info");
    passwordResetUsername.focus();
  }

  function watchPasswordReset(requestId) {
    stopWatchingPasswordReset?.();
    stopWatchingPasswordReset = KaraokeAccountRequests.listen(
      requestId,
      (request) => {
        if (!request) {
          showPasswordResetRequestAgain();
          setPasswordResetFeedback(
            "This password reset request could not be found. Submit another request.",
            "error",
          );
          return;
        }

        if (request.status === "pending") {
          passwordResetRequestForm.hidden = false;
          passwordResetPasswordForm.hidden = true;
          passwordResetUsername.disabled = true;
          passwordResetRequestButton.disabled = true;
          passwordResetRetryButton.hidden = true;
          setPasswordResetFeedback(
            "Request sent. Waiting for administrator approval.",
            "pending",
          );
        } else if (request.status === "approved") {
          passwordResetRequestForm.hidden = true;
          passwordResetPasswordForm.hidden = false;
          passwordResetRetryButton.hidden = true;
          setPasswordResetFeedback(
            "Approved. Enter a new password to finish resetting your account.",
            "success",
          );
          document.getElementById("passwordResetNewPassword").focus();
        } else if (request.status === "resetting") {
          setPasswordResetFeedback("Saving your new password...", "pending");
          passwordResetSaveButton.disabled = true;
        } else if (request.status === "completed") {
          savePasswordResetState(null);
          stopWatchingPasswordReset?.();
          stopWatchingPasswordReset = null;
          passwordResetRequestForm.hidden = true;
          passwordResetPasswordForm.hidden = true;
          passwordResetRetryButton.hidden = true;
          setPasswordResetFeedback(
            "Password updated. Sign in using your new password.",
            "success",
          );
        } else if (request.status === "rejected") {
          passwordResetRequestForm.hidden = false;
          passwordResetPasswordForm.hidden = true;
          passwordResetUsername.disabled = true;
          passwordResetRequestButton.disabled = true;
          passwordResetRetryButton.hidden = false;
          setPasswordResetFeedback(
            "The administrator declined this request.",
            "error",
          );
        }
      },
      (error) => {
        console.error(
          "Could not follow password reset request:",
          error.message,
        );
        setPasswordResetFeedback(
          "Could not check approval. Check your connection and try again.",
          "error",
        );
      },
    );
  }

  document.querySelectorAll("[data-password-reset-role]").forEach((button) => {
    button.addEventListener("click", () => {
      stopRoomQrScanner();
      document.getElementById("adminLoginModal").classList.remove("show");
      document.getElementById("singerLoginModal").classList.remove("show");
      passwordResetRole = button.dataset.passwordResetRole;
      document.getElementById("passwordResetTitle").textContent =
        passwordResetRole === "admin"
          ? "Reset administrator password"
          : "Reset performer password";
      document.getElementById("passwordResetIntro").textContent =
        "Send a request to the administrator for approval.";
      document.getElementById("loginOverlay").classList.add("show");
      passwordResetModal.classList.add("show");

      const savedState = readPasswordResetState();
      if (
        savedState?.role === passwordResetRole &&
        savedState.id &&
        savedState.token
      ) {
        passwordResetState = savedState;
        passwordResetUsername.value = savedState.username || "";
        passwordResetUsername.disabled = true;
        watchPasswordReset(savedState.id);
      } else {
        showPasswordResetRequestAgain();
        passwordResetUsername.value = "";
      }
    });
  });

  passwordResetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = passwordResetUsername.value.trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
      setPasswordResetFeedback("Enter a valid username.", "error");
      return;
    }

    passwordResetRequestButton.disabled = true;
    setPasswordResetFeedback("Submitting request...", "pending");
    try {
      if (!(await KaraokeAdminPresence.hasActiveAdmin())) {
        passwordResetRequestButton.disabled = false;
        setPasswordResetFeedback("No admin is online right now.", "error");
        passwordResetAdminContactNotice.hidden = false;
        return;
      }
      const request = await KaraokeAccountRequests.createPasswordReset(
        username,
        passwordResetRole,
      );
      savePasswordResetState({
        id: request.id,
        token: request.token,
        username: request.username,
        role: passwordResetRole,
      });
      watchPasswordReset(request.id);
    } catch (error) {
      passwordResetRequestButton.disabled = false;
      const messages = {
        ACCOUNT_NOT_FOUND:
          "No active account was found for that username and sign-in type.",
        PASSWORD_RESET_ALREADY_PENDING:
          "A password reset request is already waiting for this account.",
        PASSWORD_RESET_UNAVAILABLE:
          "Secure password reset is unavailable in this browser.",
        ADMIN_PRESENCE_UNAVAILABLE:
          "Could not check admin availability. Check your connection and try again.",
      };
      setPasswordResetFeedback(
        messages[error.message] ||
          "Could not submit the request. Check your connection and try again.",
        "error",
      );
    }
  });

  passwordResetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPassword = document.getElementById(
      "passwordResetNewPassword",
    ).value;
    const confirmation = document.getElementById(
      "passwordResetConfirmPassword",
    ).value;
    if (newPassword.length < 6) {
      setPasswordResetFeedback(
        "Use at least 6 characters for your new password.",
        "error",
      );
      return;
    }
    if (newPassword !== confirmation) {
      setPasswordResetFeedback("The passwords do not match.", "error");
      return;
    }
    if (!passwordResetState?.id || !passwordResetState.token) {
      setPasswordResetFeedback(
        "This reset session has expired. Submit a new request.",
        "error",
      );
      return;
    }

    passwordResetSaveButton.disabled = true;
    setPasswordResetFeedback("Saving your new password...", "pending");
    try {
      await KaraokeAccountRequests.completePasswordReset(
        passwordResetState.id,
        passwordResetState.token,
        newPassword,
      );
      passwordResetPasswordForm.reset();
    } catch (error) {
      console.error("Could not save password reset:", {
        code: error.code || "UNKNOWN",
        message: error.message,
      });
      passwordResetSaveButton.disabled = false;
      const message =
        error.message === "PASSWORD_RESET_NOT_APPROVED"
          ? "This request is not approved or its reset link is no longer valid."
          : error.message === "PASSWORD_TOO_SHORT"
            ? "Use at least 6 characters for your new password."
            : error.message === "ACCOUNT_NOT_FOUND"
              ? "This reset request no longer matches an active account. Contact the administrator."
              : error.code === "PERMISSION_DENIED" ||
                  error.code === "database/permission-denied"
                ? "Firebase blocked this password update. Ask the administrator to check the database permissions."
                : "Could not save your password. Please try again.";
      setPasswordResetFeedback(message, "error");
    }
  });

  passwordResetRetryButton.addEventListener("click", () => {
    showPasswordResetRequestAgain();
    passwordResetUsername.value = "";
  });
});
