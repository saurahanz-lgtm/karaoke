(function (global) {
  const REQUESTS_PATH = "accountRequests";
  const USERS_PATH = "users";
  const SELF_SERVICE_POLICY_PATH = "appSettings/accountSelfServicePolicy";
  const SELF_SERVICE_ACCOUNT_USAGE_PATH = "accountSelfServiceUsage";
  const SELF_SERVICE_PASSWORD_USAGE_PATH = "accountSelfServicePasswordUsage";
  const DEVICE_ID_STORAGE_KEY = "karaoke_account_device_id_v1";

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

  function normalizeSelfServicePolicy(value) {
    const accountLimit = Number(value?.accountsPerDevice);
    const passwordLimit = Number(value?.passwordChangesPerAccount);
    return {
      accountsPerDevice:
        Number.isInteger(accountLimit) &&
        accountLimit >= 0 &&
        accountLimit <= 10
          ? accountLimit
          : 0,
      passwordChangesPerAccount:
        Number.isInteger(passwordLimit) &&
        passwordLimit >= 0 &&
        passwordLimit <= 20
          ? passwordLimit
          : 0,
    };
  }

  async function getSelfServicePolicy() {
    const snapshot = await database()
      .ref(SELF_SERVICE_POLICY_PATH)
      .once("value");
    return normalizeSelfServicePolicy(snapshot.val());
  }

  function listenSelfServicePolicy(callback, onError) {
    const ref = database().ref(SELF_SERVICE_POLICY_PATH);
    const handler = (snapshot) =>
      callback(normalizeSelfServicePolicy(snapshot.val()));
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  async function updateSelfServicePolicy(policy) {
    const normalized = normalizeSelfServicePolicy(policy);
    const accountLimit = Number(policy?.accountsPerDevice);
    const passwordLimit = Number(policy?.passwordChangesPerAccount);
    if (
      !Number.isInteger(accountLimit) ||
      accountLimit < 0 ||
      accountLimit > 10 ||
      !Number.isInteger(passwordLimit) ||
      passwordLimit < 0 ||
      passwordLimit > 20
    ) {
      throw new Error("SELF_SERVICE_POLICY_INVALID");
    }
    await database().ref(SELF_SERVICE_POLICY_PATH).set(normalized);
    return normalized;
  }

  function getDeviceId() {
    try {
      let deviceId = global.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (!deviceId) {
        deviceId =
          global.crypto?.randomUUID?.() ||
          `device_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        global.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
      }
      return deviceId;
    } catch (error) {
      return `device_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  function findAccount(snapshot, username, role) {
    const normalizedUsername = String(username || "")
      .trim()
      .toLowerCase();
    let match = null;
    snapshot.forEach((userSnapshot) => {
      const account = userSnapshot.val();
      if (
        account &&
        String(account.username).trim().toLowerCase() === normalizedUsername &&
        account.role === role
      ) {
        match = { key: userSnapshot.key, account };
        return true;
      }
      return false;
    });
    return match;
  }

  function releaseUsageReservation(ref, collectionName, reservationId) {
    return ref.transaction((current) => {
      if (!current?.[collectionName]?.[reservationId]) return undefined;
      const entries = { ...current[collectionName] };
      delete entries[reservationId];
      return { ...current, [collectionName]: entries };
    });
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

  function generateResetToken() {
    if (!global.crypto?.getRandomValues || !global.crypto.subtle) {
      throw new Error("PASSWORD_RESET_UNAVAILABLE");
    }
    const randomValues = new Uint8Array(32);
    global.crypto.getRandomValues(randomValues);
    return Array.from(randomValues, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  }

  async function hashResetToken(token) {
    const data = new TextEncoder().encode(token);
    const digest = await global.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
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
          item.type !== "password-reset" &&
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

  async function createPasswordReset(username, role) {
    const requestedUsername = String(username || "").trim();
    const normalizedUsername = requestedUsername.toLowerCase();
    if (!requestedUsername) throw new Error("USERNAME_REQUIRED");
    if (!/^(admin|user)$/.test(role)) throw new Error("ACCOUNT_NOT_FOUND");

    const db = database();
    const usersSnapshot = await db.ref(USERS_PATH).once("value");
    const account = asUserList(usersSnapshot.val()).find(
      (user) =>
        String(user.username).trim().toLowerCase() === normalizedUsername &&
        user.role === role &&
        user.disabled !== true,
    );
    if (!account) throw new Error("ACCOUNT_NOT_FOUND");

    const token = generateResetToken();
    const tokenHash = await hashResetToken(token);
    const requestsRef = db.ref(REQUESTS_PATH);
    const requestRef = requestsRef.push();
    const request = {
      type: "password-reset",
      username: account.username,
      normalizedUsername,
      role,
      accountId: account.id ?? null,
      resetTokenHash: tokenHash,
      status: "pending",
      createdAt: Date.now(),
    };
    let pendingDuplicate = false;
    const result = await requestsRef.transaction((current) => {
      const requests = current || {};
      pendingDuplicate = Object.values(requests).some(
        (item) =>
          item?.type === "password-reset" &&
          item.role === role &&
          item.normalizedUsername === normalizedUsername &&
          ["pending", "approving", "approved", "resetting"].includes(
            item.status,
          ),
      );
      if (pendingDuplicate) return undefined;
      return { ...requests, [requestRef.key]: request };
    });

    if (!result.committed) {
      throw new Error(
        pendingDuplicate
          ? "PASSWORD_RESET_ALREADY_PENDING"
          : "REQUEST_SAVE_FAILED",
      );
    }
    return { id: requestRef.key, token, ...request };
  }

  async function createSelfServiceAccount(username) {
    const requestedUsername = String(username || "").trim();
    const normalizedUsername = requestedUsername.toLowerCase();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(requestedUsername)) {
      throw new Error("USERNAME_INVALID");
    }

    const db = database();
    const policy = await getSelfServicePolicy();
    if (policy.accountsPerDevice === 0) return null;

    const deviceId = getDeviceId();
    const reservationId = `registration_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const usageRef = db.ref(`${SELF_SERVICE_ACCOUNT_USAGE_PATH}/${deviceId}`);
    let limitReached = false;
    const reservation = await usageRef.transaction((current) => {
      const registrations = current?.registrations || {};
      if (Object.keys(registrations).length >= policy.accountsPerDevice) {
        limitReached = true;
        return undefined;
      }
      return {
        registrations: { ...registrations, [reservationId]: Date.now() },
      };
    });
    if (!reservation.committed) {
      if (limitReached) return null;
      throw new Error("SELF_SERVICE_ACCOUNT_LIMIT_UNAVAILABLE");
    }

    const requestId = db.ref(REQUESTS_PATH).push().key;
    const password = generatePassword();
    const usersRef = db.ref(USERS_PATH);
    let usernameTaken = false;
    let accountCreated = false;

    try {
      const result = await usersRef.transaction((current) => {
        const existingUsers = asUserList(current);
        usernameTaken = existingUsers.some(
          (user) =>
            String(user.username).trim().toLowerCase() === normalizedUsername,
        );
        if (usernameTaken) return undefined;

        const account = {
          id:
            Math.max(0, ...existingUsers.map((user) => Number(user.id) || 0)) +
            1,
          username: requestedUsername,
          password,
          role: "user",
          joined: new Date().toISOString().split("T")[0],
          lastActivity: 0,
          disabled: false,
          accountRequestId: requestId,
        };
        accountCreated = true;
        return [...existingUsers, account];
      });
      if (!result.committed) {
        throw new Error(
          usernameTaken ? "ACCOUNT_ALREADY_EXISTS" : "ACCOUNT_CREATE_FAILED",
        );
      }

      const request = {
        username: requestedUsername,
        normalizedUsername,
        selfService: true,
        status: "approved",
        createdAt: Date.now(),
        approvedAt: Date.now(),
        resolvedAt: Date.now(),
        password,
        accountId:
          Math.max(
            0,
            ...asUserList(result.snapshot.val()).map(
              (user) => Number(user.id) || 0,
            ),
          ) || null,
      };
      await db.ref(`${REQUESTS_PATH}/${requestId}`).set(request);
      return { id: requestId, ...request };
    } catch (error) {
      if (accountCreated) {
        await usersRef.transaction((current) => {
          const existingUsers = asUserList(current);
          const remainingUsers = existingUsers.filter(
            (user) => user.accountRequestId !== requestId,
          );
          return remainingUsers.length === existingUsers.length
            ? undefined
            : remainingUsers;
        });
      }
      await releaseUsageReservation(usageRef, "registrations", reservationId);
      throw error;
    }
  }

  async function getPasswordChangeAllowance(username, role = "user") {
    const db = database();
    const [policy, usersSnapshot] = await Promise.all([
      getSelfServicePolicy(),
      db.ref(USERS_PATH).once("value"),
    ]);
    const match = findAccount(usersSnapshot, username, role);
    if (!match || role !== "user" || match.account.disabled === true) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const accountKey = String(match.account.id ?? match.key).replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
    const usageSnapshot = await db
      .ref(`${SELF_SERVICE_PASSWORD_USAGE_PATH}/${accountKey}`)
      .once("value");
    const used = Object.keys(usageSnapshot.val()?.changes || {}).length;
    return {
      limit: policy.passwordChangesPerAccount,
      used,
      remaining: Math.max(0, policy.passwordChangesPerAccount - used),
    };
  }

  async function changePasswordWithCurrentPassword(
    username,
    currentPassword,
    newPassword,
  ) {
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      throw new Error("PASSWORD_TOO_SHORT");
    }
    if (newPassword.length > 128) throw new Error("PASSWORD_TOO_LONG");
    if (newPassword === currentPassword) throw new Error("PASSWORD_UNCHANGED");

    const db = database();
    const policy = await getSelfServicePolicy();
    if (policy.passwordChangesPerAccount === 0) {
      throw new Error("PASSWORD_CHANGE_APPROVAL_REQUIRED");
    }

    const usersRef = db.ref(USERS_PATH);
    const usersSnapshot = await usersRef.once("value");
    const match = findAccount(usersSnapshot, username, "user");
    if (!match || match.account.disabled === true) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }
    const accountKey = String(match.account.id ?? match.key).replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
    const usageRef = db.ref(
      `${SELF_SERVICE_PASSWORD_USAGE_PATH}/${accountKey}`,
    );
    const reservationId = `change_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    let limitReached = false;
    const reservation = await usageRef.transaction((current) => {
      const changes = current?.changes || {};
      if (Object.keys(changes).length >= policy.passwordChangesPerAccount) {
        limitReached = true;
        return undefined;
      }
      return { changes: { ...changes, [reservationId]: Date.now() } };
    });
    if (!reservation.committed) {
      if (limitReached) throw new Error("PASSWORD_CHANGE_APPROVAL_REQUIRED");
      throw new Error("PASSWORD_CHANGE_LIMIT_UNAVAILABLE");
    }

    let failure = null;
    try {
      const result = await usersRef.child(match.key).transaction((account) => {
        if (
          !account ||
          String(account.username).trim().toLowerCase() !==
            String(username).trim().toLowerCase() ||
          account.role !== "user" ||
          account.disabled === true
        ) {
          failure = "ACCOUNT_NOT_FOUND";
          return undefined;
        }
        if (account.password !== currentPassword) {
          failure = "CURRENT_PASSWORD_INVALID";
          return undefined;
        }
        return { ...account, password: newPassword };
      });
      if (!result.committed) {
        throw new Error(failure || "PASSWORD_CHANGE_FAILED");
      }
      const used = Object.keys(
        reservation.snapshot.val()?.changes || {},
      ).length;
      return {
        limit: policy.passwordChangesPerAccount,
        used,
        remaining: Math.max(0, policy.passwordChangesPerAccount - used),
      };
    } catch (error) {
      await releaseUsageReservation(usageRef, "changes", reservationId);
      throw error;
    }
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
        ? {
            ...request,
            status: "rejected",
            resetTokenHash: null,
            resolvedAt: Date.now(),
          }
        : undefined,
    );
    if (!result.committed) throw new Error("REQUEST_ALREADY_RESOLVED");
    return result.snapshot.val();
  }

  async function remove(id) {
    if (!id) throw new Error("REQUEST_ID_REQUIRED");
    const ref = database().ref(`${REQUESTS_PATH}/${id}`);
    const result = await ref.transaction((request) =>
      request &&
      ["pending", "approved", "rejected", "completed"].includes(request.status)
        ? null
        : undefined,
    );
    if (!result.committed) throw new Error("REQUEST_NOT_DELETABLE");
  }

  async function approve(id) {
    const db = database();
    const requestRef = db.ref(`${REQUESTS_PATH}/${id}`);
    const requestSnapshot = await requestRef.once("value");
    if (requestSnapshot.val()?.type === "password-reset") {
      const result = await requestRef.transaction((request) =>
        request?.type === "password-reset" && request.status === "pending"
          ? {
              ...request,
              status: "approved",
              approvedAt: Date.now(),
              resolvedAt: Date.now(),
            }
          : undefined,
      );
      if (!result.committed) throw new Error("REQUEST_ALREADY_RESOLVED");
      return {
        username: result.snapshot.val().username,
        type: "password-reset",
      };
    }

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

  async function completePasswordReset(id, token, newPassword) {
    if (!id || !token) throw new Error("PASSWORD_RESET_INVALID");
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      throw new Error("PASSWORD_TOO_SHORT");
    }
    if (newPassword.length > 128) throw new Error("PASSWORD_TOO_LONG");

    const db = database();
    const requestRef = db.ref(`${REQUESTS_PATH}/${id}`);
    const tokenHash = await hashResetToken(token);
    const claim = await requestRef.transaction((request) =>
      request?.type === "password-reset" &&
      request.status === "approved" &&
      request.resetTokenHash === tokenHash
        ? { ...request, status: "resetting" }
        : undefined,
    );
    if (!claim.committed) throw new Error("PASSWORD_RESET_NOT_APPROVED");

    const request = claim.snapshot.val();
    try {
      const usersSnapshot = await db.ref(USERS_PATH).once("value");
      let accountKey = null;
      usersSnapshot.forEach((userSnapshot) => {
        const user = userSnapshot.val();
        if (
          user &&
          String(user.username).trim().toLowerCase() ===
            request.normalizedUsername &&
          user.role === request.role
        ) {
          accountKey = userSnapshot.key;
          return true;
        }
        return false;
      });
      if (accountKey === null) throw new Error("ACCOUNT_NOT_FOUND");

      const userRef = db.ref(`${USERS_PATH}/${accountKey}`);
      const currentUserSnapshot = await userRef.once("value");
      const currentUser = currentUserSnapshot.val();
      if (
        !currentUser ||
        String(currentUser.username).trim().toLowerCase() !==
          request.normalizedUsername ||
        currentUser.role !== request.role
      ) {
        throw new Error("ACCOUNT_NOT_FOUND");
      }
      await userRef.child("password").set(newPassword);
      await requestRef.update({
        status: "completed",
        resetTokenHash: null,
        completedAt: Date.now(),
      });
    } catch (error) {
      await requestRef.transaction((current) =>
        current?.status === "resetting"
          ? { ...current, status: "approved" }
          : undefined,
      );
      throw error;
    }
  }

  global.KaraokeAccountRequests = {
    approve,
    changePasswordWithCurrentPassword,
    create,
    createSelfServiceAccount,
    createPasswordReset,
    completePasswordReset,
    getPasswordChangeAllowance,
    getSelfServicePolicy,
    listen,
    listenAll,
    listenSelfServicePolicy,
    remove,
    reject,
    updateSelfServicePolicy,
  };
})(window);
