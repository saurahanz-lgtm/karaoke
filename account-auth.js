(function (global) {
  const USERS_PATH = "users";
  const RESET_REQUESTS_PATH = "passwordResetRequests";

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

  async function requestPasswordReset(username, email) {
    const normalizedUsername = String(username || "")
      .trim()
      .toLowerCase();
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    if (!normalizedUsername) throw new Error("USERNAME_REQUIRED");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("INVALID_EMAIL");
    }

    await firebase
      .database()
      .ref(RESET_REQUESTS_PATH)
      .push({
        username: String(username).trim(),
        normalizedUsername,
        email: normalizedEmail,
        requestedAt: Date.now(),
        deliveryStatus: "awaiting_approval",
        status: "pending",
      });
  }

  async function sendPasswordResetEmail(email) {
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("INVALID_EMAIL");
    }
    const appHomeUrl = new URL(
      "index.html",
      new URL("./", global.location.href),
    ).toString();
    await auth().sendPasswordResetEmail(normalizedEmail, {
      url: appHomeUrl,
      handleCodeInApp: false,
    });
  }

  async function approvePasswordResetRequest(id) {
    const requestRef = firebase.database().ref(`${RESET_REQUESTS_PATH}/${id}`);
    const claim = await requestRef.transaction((request) => {
      const staleApproval =
        request?.status === "sending" &&
        Date.now() - (request.sendingAt || 0) > 2 * 60 * 1000;
      return request?.status === "pending" || staleApproval
        ? {
            ...request,
            status: "sending",
            sendingAt: Date.now(),
            deliveryStatus: "sending",
          }
        : undefined;
    });
    if (!claim.committed) {
      throw new Error("RESET_REQUEST_ALREADY_RESOLVED");
    }
    const request = claim.snapshot.val();

    try {
      const usersSnapshot = await firebase
        .database()
        .ref(USERS_PATH)
        .once("value");
      const users = Object.values(usersSnapshot.val() || {});
      const account = users.find(
        (user) =>
          user &&
          (!request.normalizedUsername ||
            String(user.username || "")
              .trim()
              .toLowerCase() === request.normalizedUsername) &&
          String(user.email || "")
            .trim()
            .toLowerCase() === request.email &&
          user.authUid,
      );
      if (!account) throw new Error("RESET_ACCOUNT_EMAIL_MISMATCH");
      await sendPasswordResetEmail(account.email);
      await requestRef.update({
        status: "approved",
        deliveryStatus: "sent",
        approvedAt: Date.now(),
      });
    } catch (error) {
      await requestRef.update({
        status: "pending",
        deliveryStatus: error.code || "failed",
        lastAttemptAt: Date.now(),
      });
      throw error;
    }
  }

  async function rejectPasswordResetRequest(id) {
    const requestRef = firebase.database().ref(`${RESET_REQUESTS_PATH}/${id}`);
    const result = await requestRef.transaction((request) =>
      request?.status === "pending"
        ? { ...request, status: "rejected", reviewedAt: Date.now() }
        : undefined,
    );
    if (!result.committed) throw new Error("RESET_REQUEST_ALREADY_RESOLVED");
  }

  async function resendPasswordResetRequest(id) {
    const requestRef = firebase.database().ref(`${RESET_REQUESTS_PATH}/${id}`);
    const requestSnapshot = await requestRef.once("value");
    const request = requestSnapshot.val();
    if (!request || request.status !== "approved") {
      throw new Error("RESET_REQUEST_NOT_APPROVED");
    }

    const usersSnapshot = await firebase
      .database()
      .ref(USERS_PATH)
      .once("value");
    const users = Object.values(usersSnapshot.val() || {});
    const account = users.find(
      (user) =>
        user &&
        (!request.normalizedUsername ||
          String(user.username || "")
            .trim()
            .toLowerCase() === request.normalizedUsername) &&
        String(user.email || "")
          .trim()
          .toLowerCase() === request.email &&
        user.authUid,
    );
    if (!account) throw new Error("RESET_ACCOUNT_EMAIL_MISMATCH");

    try {
      await sendPasswordResetEmail(account.email);
      await requestRef.update({
        deliveryStatus: "sent",
        lastAttemptAt: Date.now(),
        resendCount: (request.resendCount || 0) + 1,
      });
    } catch (error) {
      await requestRef.update({
        deliveryStatus: error.code || "failed",
        lastAttemptAt: Date.now(),
      });
      throw error;
    }
  }

  function listenResetRequests(callback, onError) {
    const ref = firebase.database().ref(RESET_REQUESTS_PATH);
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests)
          .map(([id, request]) => ({ ...request, id }))
          .sort((first, second) => second.requestedAt - first.requestedAt),
      );
    };
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  async function markResetRequestReviewed(id) {
    await firebase
      .database()
      .ref(`${RESET_REQUESTS_PATH}/${id}`)
      .update({ status: "reviewed", reviewedAt: Date.now() });
  }

  global.KaraokeAccountAuth = {
    authenticate,
    approvePasswordResetRequest,
    listenResetRequests,
    provisionAccount,
    rejectPasswordResetRequest,
    resendPasswordResetRequest,
    requestPasswordReset,
    sendPasswordResetEmail,
  };
})(window);
