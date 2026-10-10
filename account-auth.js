(function (global) {
  const USERS_PATH = "users";

  function auth() {
    if (typeof firebase === "undefined" || !firebase.auth) {
      throw new Error("AUTH_UNAVAILABLE");
    }
    return firebase.auth();
  }

  function provisioningAuth() {
    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      throw new Error("AUTH_UNAVAILABLE");
    }
    let app = firebase.apps.find(
      (candidate) => candidate.name === "accountProvisioning",
    );
    if (!app)
      app = firebase.initializeApp(firebaseConfig, "accountProvisioning");
    return app.auth();
  }

  async function ensureEmailAvailable(email, username) {
    const snapshot = await firebase.database().ref(USERS_PATH).once("value");
    const requestedEmail = String(email).trim().toLowerCase();
    const duplicate = Object.values(snapshot.val() || {}).some(
      (user) =>
        user?.username !== username &&
        String(user?.email || "")
          .trim()
          .toLowerCase() === requestedEmail,
    );
    if (duplicate) throw new Error("EMAIL_ALREADY_LINKED");
  }

  async function createIdentity(email, password) {
    const authClient = provisioningAuth();
    const normalizedEmail = String(email).trim().toLowerCase();
    let credential;
    let created = false;
    try {
      credential = await authClient.createUserWithEmailAndPassword(
        normalizedEmail,
        password,
      );
      created = true;
    } catch (error) {
      if (error.code !== "auth/email-already-in-use") throw error;
      credential = await authClient.signInWithEmailAndPassword(
        normalizedEmail,
        password,
      );
    }
    if (created) {
      await credential.user.sendEmailVerification().catch((error) => {
        console.warn("Could not send email verification:", error.message);
      });
    }
    await authClient.signOut();
    return credential.user.uid;
  }

  async function saveAccountLink(account, email, uid) {
    const usersRef = firebase.database().ref(USERS_PATH);
    const snapshot = await usersRef.once("value");
    const users = snapshot.val();
    const entries = Object.entries(users || {});
    const entry = entries.find(
      ([, user]) => user?.username === account.username,
    );
    if (!entry) throw new Error("ACCOUNT_NOT_FOUND");

    await usersRef.child(entry[0]).update({
      email,
      authUid: uid,
      authProvider: "password",
      password: null,
    });
    account.email = email;
    account.authUid = uid;
    account.password = null;
  }

  async function authenticate(account, password) {
    const authClient = auth();
    if (account.email) {
      const credential = await authClient.signInWithEmailAndPassword(
        account.email,
        password,
      );
      if (account.authUid && credential.user.uid !== account.authUid) {
        await authClient.signOut();
        throw new Error("ACCOUNT_LINK_MISMATCH");
      }
      if (!account.authUid) {
        await saveAccountLink(account, account.email, credential.user.uid);
      }
      return account;
    }

    if (account.password !== password) throw new Error("INVALID_CREDENTIALS");

    const email = global
      .prompt(
        "Add your email to secure your account and enable password reset:",
      )
      ?.trim()
      .toLowerCase();
    if (!email) throw new Error("EMAIL_REQUIRED");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("INVALID_EMAIL");
    }

    await ensureEmailAvailable(email, account.username);
    const uid = await createIdentity(email, password);
    const credential = await authClient.signInWithEmailAndPassword(
      email,
      password,
    );
    if (credential.user.uid !== uid) throw new Error("ACCOUNT_LINK_MISMATCH");
    await saveAccountLink(account, email, uid);
    return account;
  }

  async function provisionAccount(email, password, username) {
    const normalizedEmail = String(email).trim().toLowerCase();
    await ensureEmailAvailable(normalizedEmail, username);
    const uid = await createIdentity(email, password);
    return {
      email: normalizedEmail,
      authUid: uid,
      authProvider: "password",
    };
  }

  async function passwordResetApiRequest({
    method,
    action,
    requestId,
    username,
    token,
    idToken,
  }) {
    const isGetRequest = method === "GET";
    const isStatusRequest = isGetRequest && action !== "list";
    const url =
      method === "GET" && action === "list"
        ? "/api/password-reset?action=list"
        : isStatusRequest
          ? `/api/password-reset?action=status&requestId=${encodeURIComponent(requestId)}`
          : "/api/password-reset";
    const response = await global.fetch(url, {
      method,
      headers: {
        ...(isStatusRequest
          ? { Authorization: `Bearer ${token}` }
          : { "Content-Type": "application/json" }),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      ...(isGetRequest
        ? {}
        : { body: JSON.stringify({ action, requestId, username }) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "RESET_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function approvePasswordResetRequest(id) {
    return passwordResetApiRequest({
      method: "POST",
      action: "approve",
      requestId: id,
      ...(await getAdminAuthorization()),
    });
  }

  async function rejectPasswordResetRequest(id) {
    return passwordResetApiRequest({
      method: "POST",
      action: "reject",
      requestId: id,
      ...(await getAdminAuthorization()),
    });
  }

  async function resetUserPassword(username) {
    return passwordResetApiRequest({
      method: "POST",
      action: "reset-user",
      username,
      ...(await getAdminAuthorization()),
    });
  }

  async function getAdminAuthorization() {
    const currentUser = auth().currentUser;
    if (!currentUser) throw new Error("ADMIN_AUTH_REQUIRED");
    return { idToken: await currentUser.getIdToken() };
  }

  async function requestPasswordReset(username) {
    return passwordResetApiRequest({
      method: "POST",
      action: "request",
      username,
    });
  }

  async function getPasswordResetStatus(requestId, token) {
    return passwordResetApiRequest({ method: "GET", requestId, token });
  }

  function listenResetRequests(callback, onError) {
    let stopped = false;
    let loading = false;
    let listenerFailed = false;
    const load = async () => {
      if (stopped || loading) return;
      loading = true;
      try {
        const { idToken } = await getAdminAuthorization();
        const requests = await passwordResetApiRequest({
          method: "GET",
          action: "list",
          idToken,
        });
        if (!stopped) {
          listenerFailed = false;
          callback(requests);
        }
      } catch (error) {
        if (!stopped && !listenerFailed) onError?.(error);
        listenerFailed = true;
      } finally {
        loading = false;
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }

  global.KaraokeAccountAuth = {
    authenticate,
    approvePasswordResetRequest,
    getPasswordResetStatus,
    listenResetRequests,
    provisionAccount,
    rejectPasswordResetRequest,
    resetUserPassword,
    requestPasswordReset,
  };
})(window);
