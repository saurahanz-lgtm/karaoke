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

  async function requestPasswordReset(email) {
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("INVALID_EMAIL");
    }

    let deliveryStatus = "sent";
    try {
      await auth().sendPasswordResetEmail(normalizedEmail);
    } catch (error) {
      deliveryStatus = error.code || "failed";
      if (error.code !== "auth/user-not-found") {
        console.warn("Could not send password reset email:", error.message);
      }
    }

    if (typeof firebase !== "undefined" && firebase.database) {
      await firebase.database().ref(RESET_REQUESTS_PATH).push({
        email: normalizedEmail,
        requestedAt: Date.now(),
        deliveryStatus,
        status: "pending",
      });
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
    listenResetRequests,
    markResetRequestReviewed,
    provisionAccount,
    requestPasswordReset,
  };
})(window);
