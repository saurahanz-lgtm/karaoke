const {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");

const REQUESTS_PATH = "passwordResetRequests";
const USERS_PATH = "users";
const RATE_LIMIT = 4;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function createPasswordResetService({
  database,
  auth,
  encryptionSecret,
  now = Date.now,
}) {
  if (!encryptionSecret || encryptionSecret.length < 32) {
    throw new Error("RESET_PASSWORD_ENCRYPTION_KEY is not configured.");
  }

  function deriveEncryptionKey(tokenHash) {
    return createHmac("sha256", encryptionSecret).update(tokenHash).digest();
  }

  function encryptPassword(password, tokenHash) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      deriveEncryptionKey(tokenHash),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  }

  function decryptPassword(encrypted, tokenHash) {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveEncryptionKey(tokenHash),
      Buffer.from(encrypted.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  async function requestPasswordReset(username, rateLimitKey) {
    const normalizedUsername = normalizeUsername(username);
    if (!/^[a-z0-9_.-]{3,40}$/.test(normalizedUsername)) {
      throw new Error("INVALID_USERNAME");
    }
    if (!rateLimitKey) throw new Error("RATE_LIMIT_KEY_REQUIRED");

    const rateRef = database.ref(`passwordResetRateLimits/${rateLimitKey}`);
    const rateResult = await rateRef.transaction((state) => {
      const current = state || { count: 0, windowStartedAt: now() };
      const windowExpired = now() - current.windowStartedAt >= RATE_WINDOW_MS;
      const next = windowExpired
        ? { count: 1, windowStartedAt: now() }
        : { ...current, count: (current.count || 0) + 1 };
      return next.count > RATE_LIMIT ? undefined : next;
    });
    if (!rateResult.committed) throw new Error("RESET_RATE_LIMITED");

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHmac("sha256", encryptionSecret)
      .update(token)
      .digest("hex");
    const requestRef = database.ref(REQUESTS_PATH).push();
    await requestRef.set({
      flow: "username-temporary-password-v1",
      username: String(username).trim(),
      normalizedUsername,
      requestedAt: now(),
      expiresAt: now() + REQUEST_TTL_MS,
      status: "pending",
      credentialStatus: "awaiting_approval",
      tokenHash,
    });
    return { requestId: requestRef.key, token };
  }

  async function getStatus(requestId, token) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId || "") || !token) {
      throw new Error("RESET_REQUEST_NOT_FOUND");
    }
    const snapshot = await database
      .ref(`${REQUESTS_PATH}/${requestId}`)
      .once("value");
    const request = snapshot.val();
    if (!request?.tokenHash || request.expiresAt <= now()) {
      throw new Error("RESET_REQUEST_NOT_FOUND");
    }

    const suppliedHash = createHmac("sha256", encryptionSecret)
      .update(token)
      .digest();
    const storedHash = Buffer.from(request.tokenHash, "hex");
    if (
      storedHash.length !== suppliedHash.length ||
      !timingSafeEqual(storedHash, suppliedHash)
    ) {
      throw new Error("RESET_REQUEST_NOT_FOUND");
    }

    const response = { status: request.status };
    if (request.status === "approved" && request.encryptedPassword) {
      response.temporaryPassword = decryptPassword(
        request.encryptedPassword,
        request.tokenHash,
      );
    }
    return response;
  }

  async function approve(requestId, approvedBy) {
    const requestRef = database.ref(`${REQUESTS_PATH}/${requestId}`);
    const claim = await requestRef.transaction((request) => {
      const staleProcessing =
        request?.status === "processing" &&
        now() - (request.processingAt || 0) > 2 * 60 * 1000;
      if (
        request?.flow !== "username-temporary-password-v1" ||
        (request.status !== "pending" && !staleProcessing)
      )
        return undefined;
      if (request.expiresAt <= now()) {
        return { ...request, status: "expired" };
      }
      return {
        ...request,
        status: "processing",
        processingAt: now(),
        approvedBy,
      };
    });
    if (!claim.committed) throw new Error("RESET_REQUEST_ALREADY_RESOLVED");
    const request = claim.snapshot.val();
    if (request.status === "expired") throw new Error("RESET_REQUEST_EXPIRED");

    try {
      const usersSnapshot = await database.ref(USERS_PATH).once("value");
      const userData = usersSnapshot.val();
      const accountEntries = Array.isArray(userData)
        ? userData.map((user, index) => [String(index), user])
        : Object.entries(userData || {});
      const accountEntry = accountEntries.find(
        ([, user]) =>
          user &&
          normalizeUsername(user.username) === request.normalizedUsername,
      );
      const account = accountEntry?.[1];
      if (!account) throw new Error("RESET_ACCOUNT_NOT_FOUND");
      if (account.disabled) throw new Error("RESET_ACCOUNT_DISABLED");

      const temporaryPassword = `${randomBytes(24).toString("base64url")}A7!`;
      if (account.authUid) {
        await auth.updateUser(account.authUid, { password: temporaryPassword });
      } else if (account.password) {
        await database
          .ref(`${USERS_PATH}/${accountEntry[0]}`)
          .update({ password: temporaryPassword });
      } else {
        throw new Error("RESET_ACCOUNT_NOT_READY");
      }
      const encryptedPassword = encryptPassword(
        temporaryPassword,
        request.tokenHash,
      );
      await requestRef.update({
        status: "approved",
        credentialStatus: "ready",
        encryptedPassword,
        approvedAt: now(),
      });
    } catch (error) {
      await requestRef.update({
        status: "pending",
        credentialStatus: error.message || "failed",
        lastAttemptAt: now(),
      });
      throw error;
    }
  }

  async function reject(requestId, reviewedBy) {
    const requestRef = database.ref(`${REQUESTS_PATH}/${requestId}`);
    const result = await requestRef.transaction((request) =>
      request?.flow === "username-temporary-password-v1" &&
      request.status === "pending"
        ? { ...request, status: "rejected", reviewedAt: now(), reviewedBy }
        : undefined,
    );
    if (!result.committed) throw new Error("RESET_REQUEST_ALREADY_RESOLVED");
  }

  async function resetAccount(username, resetBy) {
    const normalizedUsername = normalizeUsername(username);
    const usersSnapshot = await database.ref(USERS_PATH).once("value");
    const userData = usersSnapshot.val();
    const accountEntries = Array.isArray(userData)
      ? userData.map((user, index) => [String(index), user])
      : Object.entries(userData || {});
    const accountEntry = accountEntries.find(
      ([, user]) =>
        user && normalizeUsername(user.username) === normalizedUsername,
    );
    const account = accountEntry?.[1];
    if (!account) throw new Error("RESET_ACCOUNT_NOT_FOUND");
    if (account.disabled) throw new Error("RESET_ACCOUNT_DISABLED");

    const temporaryPassword = `${randomBytes(24).toString("base64url")}A7!`;
    if (account.authUid) {
      await auth.updateUser(account.authUid, { password: temporaryPassword });
    } else if (account.password) {
      await database
        .ref(`${USERS_PATH}/${accountEntry[0]}`)
        .update({ password: temporaryPassword });
    } else {
      throw new Error("RESET_ACCOUNT_NOT_READY");
    }

    await database.ref("passwordResetAdminActions").push({
      username: account.username,
      resetBy,
      resetAt: now(),
    });
    return { temporaryPassword };
  }

  async function listRequests() {
    const snapshot = await database.ref(REQUESTS_PATH).once("value");
    return Object.entries(snapshot.val() || {})
      .map(([id, request]) => ({ id, ...request }))
      .filter((request) => request.flow === "username-temporary-password-v1")
      .sort((first, second) => second.requestedAt - first.requestedAt);
  }

  return {
    approve,
    getStatus,
    listRequests,
    reject,
    requestPasswordReset,
    resetAccount,
  };
}

module.exports = { createPasswordResetService };
