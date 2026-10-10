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

  global.KaraokeAccountAuth = {
    authenticate,
    provisionAccount,
  };
})(window);
