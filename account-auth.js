(function (global) {
  const USERS_PATH = "users";

  function auth() {
    if (typeof firebase === "undefined" || !firebase.auth) {
      throw new Error("AUTH_UNAVAILABLE");
    }
    return firebase.auth();
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
    if (account.email) {
      const authClient = auth();
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

  global.KaraokeAccountAuth = {
    authenticate,
  };
})(window);
