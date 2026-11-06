const { createPublicKey, timingSafeEqual, verify } = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getDatabase: getAdminDatabase } = require("firebase-admin/database");

const DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES = 3;
const MAX_QUEUE_CLEANUP_DELAY_MINUTES = 1440;
const MEMBER_TIMEOUT_MS = 60000;
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "sd-karaoke-queue-cleanup";
const GITHUB_REPOSITORY = "saurahanz-lgtm/karaoke";
const GITHUB_REF = "refs/heads/master";
const GITHUB_WORKFLOW_REF =
  `${GITHUB_REPOSITORY}/.github/workflows/cleanup-idle-rooms.yml@${GITHUB_REF}`;
const GITHUB_OIDC_KEYS_URL =
  `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const GITHUB_OIDC_KEYS_CACHE_MS = 5 * 60 * 1000;
let githubOidcKeys = null;
let githubOidcKeysFetchedAt = 0;

function getQueueCleanupDelayMs(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= MAX_QUEUE_CLEANUP_DELAY_MINUTES
    ? minutes * 60000
    : DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES * 60000;
}

function updateIdleRoomSession(
  room,
  now,
  cleanupDelayMs = DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES * 60000,
) {
  if (!room) return undefined;

  const hasActiveMembers = Object.values(room.members || {}).some(
    (member) => member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS,
  );
  const queue = Array.isArray(room.queue)
    ? room.queue
    : Object.values(room.queue || {});
  const hasSongs = queue.some(Boolean) || Boolean(room.currentSong?.videoId);
  if (!hasSongs) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  if (hasActiveMembers) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  const storedEmptySince = Number(room.emptySince) || 0;
  const emptySince = storedEmptySince || now;
  if (now - emptySince < cleanupDelayMs) {
    return emptySince === storedEmptySince
      ? undefined
      : { ...room, emptySince };
  }

  return { ...room, queue: null, currentSong: null, emptySince: null };
}

function getDatabase() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!databaseURL || !serviceAccountJson) {
    throw new Error("Firebase Admin environment variables are not configured");
  }

  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      databaseURL,
    });
  return getAdminDatabase(app);
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.authorization || "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function getGitHubOidcKeys(refresh = false) {
  if (
    !refresh &&
    githubOidcKeys &&
    Date.now() - githubOidcKeysFetchedAt < GITHUB_OIDC_KEYS_CACHE_MS
  ) {
    return githubOidcKeys;
  }

  const response = await fetch(GITHUB_OIDC_KEYS_URL);
  if (!response.ok) {
    throw new Error(`GitHub OIDC key request failed (${response.status})`);
  }
  const result = await response.json();
  if (!Array.isArray(result.keys)) {
    throw new Error("GitHub OIDC key response is invalid");
  }
  githubOidcKeys = result.keys;
  githubOidcKeysFetchedAt = Date.now();
  return githubOidcKeys;
}

async function isGitHubActionsAuthorized(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;

  const token = authorization.slice("Bearer ".length);
  if (token.length > 8192) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header?.alg !== "RS256" || typeof header.kid !== "string" || !claims) {
    return false;
  }

  let keys = await getGitHubOidcKeys();
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    keys = await getGitHubOidcKeys(true);
    jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  }
  if (!jwk) return false;

  const signature = Buffer.from(parts[2], "base64url");
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    signature,
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  return (
    validSignature &&
    claims.iss === GITHUB_OIDC_ISSUER &&
    audiences.includes(GITHUB_OIDC_AUDIENCE) &&
    Number(claims.exp) > now &&
    Number(claims.nbf) <= now &&
    Number(claims.iat) <= now + 60 &&
    claims.repository === GITHUB_REPOSITORY &&
    claims.repository_owner === "saurahanz-lgtm" &&
    claims.ref === GITHUB_REF &&
    claims.sub === `repo:${GITHUB_REPOSITORY}:ref:${GITHUB_REF}` &&
    claims.workflow_ref === GITHUB_WORKFLOW_REF &&
    ["schedule", "workflow_dispatch"].includes(claims.event_name)
  );
}

async function cleanupIdleRooms(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }
  try {
    if (
      !isAuthorized(request) &&
      !(await isGitHubActionsAuthorized(request))
    ) {
      return response.status(401).json({ error: "Unauthorized" });
    }

    const database = getDatabase();
    const [roomsSnapshot, cleanupDelaySnapshot] = await Promise.all([
      database.ref("karaokeRooms").once("value"),
      database.ref("appSettings/queueCleanupMinutes").once("value"),
    ]);
    const cleanupDelayMs = getQueueCleanupDelayMs(cleanupDelaySnapshot.val());
    const roomIds = Object.keys(roomsSnapshot.val() || {});
    const results = await Promise.all(
      roomIds.map((roomId) =>
        database
          .ref(`karaokeSessions/${roomId}`)
          .transaction((room) =>
            updateIdleRoomSession(room, Date.now(), cleanupDelayMs),
          ),
      ),
    );

    return response.status(200).json({
      roomsScanned: roomIds.length,
      sessionsUpdated: results.filter((result) => result.committed).length,
    });
  } catch (error) {
    console.error("Idle room cleanup failed:", error.message);
    return response.status(500).json({ error: "Idle room cleanup failed" });
  }
}

module.exports = cleanupIdleRooms;
module.exports.updateIdleRoomSession = updateIdleRoomSession;
module.exports.isGitHubActionsAuthorized = isGitHubActionsAuthorized;
