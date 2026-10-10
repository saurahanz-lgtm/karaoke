(function (global) {
  const REQUESTS_PATH = "accountRequests";
  const USERS_PATH = "users";

  function database() {
    if (typeof firebase === "undefined" || !firebase.database) {
      throw new Error("FIREBASE_UNAVAILABLE");
    }
    return firebase.database();
  }

  function asUserList(value) {
    const records = Array.isArray(value) ? value : Object.values(value || {});
    return records.filter((user) => user && user.username);
  }

  function generatePassword() {
    const randomValue = new Uint32Array(1);
    if (global.crypto?.getRandomValues) {
      global.crypto.getRandomValues(randomValue);
    } else {
      randomValue[0] = Math.floor(Math.random() * 0xffffffff);
    }
    return `sd${String(randomValue[0] % 10000).padStart(4, "0")}`;
  }

  async function create(username) {
    const requestedUsername = String(username || "").trim();
    const normalizedUsername = requestedUsername.toLowerCase();
    if (!requestedUsername) throw new Error("USERNAME_REQUIRED");

    const db = database();
    const usersSnapshot = await db.ref(USERS_PATH).once("value");
    const existingUsers = asUserList(usersSnapshot.val());
    const userExists = existingUsers.some(
      (user) =>
        String(user.username).trim().toLowerCase() === normalizedUsername,
    );
    if (userExists) throw new Error("ACCOUNT_ALREADY_EXISTS");
    const requestsRef = db.ref(REQUESTS_PATH);
    const requestRef = requestsRef.push();
    const request = {
      username: requestedUsername,
      normalizedUsername,
      status: "pending",
      createdAt: Date.now(),
    };
    let pendingDuplicate = false;
    const result = await requestsRef.transaction((current) => {
      const requests = current || {};
      pendingDuplicate = Object.values(requests).some(
        (item) =>
          item &&
          ["pending", "approving"].includes(item.status) &&
          item.normalizedUsername === normalizedUsername,
      );
      if (pendingDuplicate) return undefined;
      return { ...requests, [requestRef.key]: request };
    });

    if (!result.committed) {
      throw new Error(
        pendingDuplicate
          ? "ACCOUNT_REQUEST_ALREADY_PENDING"
          : "REQUEST_SAVE_FAILED",
      );
    }
    return { id: requestRef.key, ...request };
  }

  function listen(id, callback, onError) {
    if (!id) throw new Error("REQUEST_ID_REQUIRED");
    const ref = database().ref(`${REQUESTS_PATH}/${id}`);
    const handler = (snapshot) => callback(snapshot.val());
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  function listenAll(callback, onError) {
    const ref = database().ref(REQUESTS_PATH);
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests)
          .map(([id, request]) => ({ ...request, id }))
          .sort(
            (first, second) => (second.createdAt || 0) - (first.createdAt || 0),
          ),
      );
    };
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  async function reject(id) {
    const ref = database().ref(`${REQUESTS_PATH}/${id}`);
    const result = await ref.transaction((request) =>
      request?.status === "pending"
        ? { ...request, status: "rejected", resolvedAt: Date.now() }
        : undefined,
    );
    if (!result.committed) throw new Error("REQUEST_ALREADY_RESOLVED");
    return result.snapshot.val();
  }

  async function remove(id) {
    if (!id) throw new Error("REQUEST_ID_REQUIRED");
    const ref = database().ref(`${REQUESTS_PATH}/${id}`);
    const result = await ref.transaction((request) =>
      request && ["pending", "approved", "rejected"].includes(request.status)
        ? null
        : undefined,
    );
    if (!result.committed) throw new Error("REQUEST_NOT_DELETABLE");
  }

  async function approve(id) {
    const db = database();
    const requestRef = db.ref(`${REQUESTS_PATH}/${id}`);
    const generatedPassword = generatePassword();
    const claim = await requestRef.transaction((request) =>
      request?.status === "pending"
        ? {
            ...request,
            status: "approving",
            approvalPassword: request.approvalPassword || generatedPassword,
          }
        : undefined,
    );
    if (!claim.committed) throw new Error("REQUEST_ALREADY_RESOLVED");

    const request = claim.snapshot.val();
    const password = request.approvalPassword;
    let duplicateUsername = false;
    let previouslyCreatedUser = null;

    try {
      const userResult = await db.ref(USERS_PATH).transaction((current) => {
        const existingUsers = asUserList(current);
        previouslyCreatedUser = existingUsers.find(
          (user) => user.accountRequestId === id,
        );
        if (previouslyCreatedUser) return undefined;

        duplicateUsername = existingUsers.some(
          (user) =>
            String(user.username).trim().toLowerCase() ===
            request.normalizedUsername,
        );
        if (duplicateUsername) return undefined;

        const nextId =
          Math.max(0, ...existingUsers.map((user) => Number(user.id) || 0)) + 1;
        return [
          ...existingUsers,
          {
            id: nextId,
            username: request.username,
            password,
            role: "user",
            joined: new Date().toISOString().split("T")[0],
            lastActivity: 0,
            disabled: false,
            accountRequestId: id,
          },
        ];
      });

      if (!userResult.committed && !previouslyCreatedUser) {
        if (duplicateUsername) {
          await requestRef.update({
            status: "rejected",
            resolutionMessage:
              "That username is already in use. Submit another request.",
            resolvedAt: Date.now(),
          });
          throw new Error("ACCOUNT_ALREADY_EXISTS");
        }
        throw new Error("ACCOUNT_CREATE_FAILED");
      }

      const approvedPassword = previouslyCreatedUser?.password || password;
      await requestRef.update({
        status: "approved",
        password: approvedPassword,
        approvalPassword: null,
        approvedAt: Date.now(),
        resolvedAt: Date.now(),
      });
      return { username: request.username, password: approvedPassword };
    } catch (error) {
      if (error.message !== "ACCOUNT_ALREADY_EXISTS") {
        await requestRef.transaction((current) =>
          current?.status === "approving"
            ? { ...current, status: "pending" }
            : undefined,
        );
      }
      throw error;
    }
  }

  global.KaraokeAccountRequests = {
    approve,
    create,
    listen,
    listenAll,
    remove,
    reject,
  };
})(window);
