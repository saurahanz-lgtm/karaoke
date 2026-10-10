const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { createHmac } = require("node:crypto");
const {
  createPasswordResetService,
} = require("../server/password-reset-service");

function json(res, status, value) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(value);
}

function initializeFirebase() {
  const accountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const encryptionSecret = process.env.RESET_PASSWORD_ENCRYPTION_KEY;
  if (!accountJson || !encryptionSecret) {
    throw new Error("RESET_SERVICE_NOT_CONFIGURED");
  }

  const serviceAccount = JSON.parse(accountJson);
  if (serviceAccount.project_id !== "karaoke-890dd") {
    throw new Error("Firebase service account belongs to the wrong project.");
  }

  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: "https://karaoke-890dd-default-rtdb.firebaseio.com",
    });
  return {
    auth: getAuth(app),
    database: getDatabase(app),
    encryptionSecret,
  };
}

async function requireAdmin(req, auth, database) {
  const authorization = req.headers.authorization || "";
  const idToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!idToken) throw new Error("ADMIN_AUTH_REQUIRED");

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    throw new Error("ADMIN_AUTH_REQUIRED");
  }
  const snapshot = await database.ref("users").once("value");
  const userData = snapshot.val();
  const users = Array.isArray(userData)
    ? userData
    : Object.values(userData || {});
  const admin = users.find((user) => user?.authUid === decoded.uid);
  if (!admin || admin.role !== "admin" || admin.disabled) {
    throw new Error("ADMIN_ACCESS_REQUIRED");
  }
  return admin;
}

function getRateLimitKey(req, secret) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip =
    req.headers["x-real-ip"] ||
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      ?.split(",")[0]
      ?.trim() ||
    "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex");
}

module.exports = async function passwordResetApi(req, res) {
  let auth;
  let database;
  let service;
  try {
    const services = initializeFirebase();
    auth = services.auth;
    database = services.database;
    service = createPasswordResetService(services);
  } catch (error) {
    console.error(
      "Password reset service initialization failed:",
      error.message,
    );
    return json(res, 503, { error: "RESET_SERVICE_NOT_CONFIGURED" });
  }

  try {
    if (req.method === "GET") {
      if (req.query?.action === "status") {
        const token = (req.headers.authorization || "").replace(
          /^Bearer\s+/i,
          "",
        );
        const status = await service.getStatus(req.query.requestId, token);
        return json(res, 200, status);
      }
      if (req.query?.action === "list") {
        await requireAdmin(req, auth, database);
        const requests = await service.listRequests();
        return json(
          res,
          200,
          requests.map(
            ({ tokenHash, encryptedPassword, ...request }) => request,
          ),
        );
      }
      return json(res, 400, { error: "INVALID_ACTION" });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
    }

    const { action, requestId, username } = req.body || {};
    if (action === "request") {
      const result = await service.requestPasswordReset(
        username,
        getRateLimitKey(req, services.encryptionSecret),
      );
      return json(res, 201, result);
    }

    const admin = await requireAdmin(req, auth, database);
    if (action === "approve") {
      await service.approve(requestId, admin.username);
      return json(res, 200, { status: "approved" });
    }
    if (action === "reject") {
      await service.reject(requestId, admin.username);
      return json(res, 200, { status: "rejected" });
    }
    if (action === "reset-user") {
      const result = await service.resetAccount(username, admin.username);
      return json(res, 200, result);
    }
    return json(res, 400, { error: "INVALID_ACTION" });
  } catch (error) {
    const status =
      error.message === "ADMIN_AUTH_REQUIRED"
        ? 401
        : error.message === "ADMIN_ACCESS_REQUIRED"
          ? 403
          : error.message === "INVALID_USERNAME"
            ? 400
            : error.message === "RESET_RATE_LIMITED"
              ? 429
              : error.message === "RESET_REQUEST_NOT_FOUND"
                ? 404
                : error.message === "RESET_REQUEST_EXPIRED"
                  ? 410
                  : error.message === "RESET_ACCOUNT_NOT_FOUND" ||
                      error.message === "RESET_ACCOUNT_NOT_READY" ||
                      error.message === "RESET_ACCOUNT_DISABLED"
                    ? 409
                    : error.message === "RESET_REQUEST_ALREADY_RESOLVED"
                      ? 409
                      : 500;
    if (status === 500) {
      console.error("Password reset request failed:", error.message);
    }
    return json(res, status, {
      error: error.message || "RESET_REQUEST_FAILED",
    });
  }
};
