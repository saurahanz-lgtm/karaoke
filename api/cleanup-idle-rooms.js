const { timingSafeEqual } = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getDatabase: getAdminDatabase } = require("firebase-admin/database");

const MEMBER_TIMEOUT_MS = 60 * 1000;
const EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS = 5 * 60 * 1000;

function updateIdleRoomSession(room, now) {
  if (!room) return undefined;

  const memberLastSeen = Object.values(room.members || {}).map(
    (member) => Number(member?.lastSeen) || 0,
  );
  const latestMemberActivity = Math.max(0, ...memberLastSeen);
  const hasActiveMembers = latestMemberActivity >= now - MEMBER_TIMEOUT_MS;
  if (hasActiveMembers) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  const queue = Array.isArray(room.queue)
    ? room.queue
    : Object.values(room.queue || {});
  const hasSongs = queue.some(Boolean) || Boolean(room.currentSong?.videoId);
  if (!hasSongs) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  const storedEmptySince = Number(room.emptySince);
  const emptySince =
    storedEmptySince > 0 && storedEmptySince <= now
      ? storedEmptySince
      : Math.min(latestMemberActivity || now, now);
  if (now - emptySince < EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS) {
    return storedEmptySince > 0 ? undefined : { ...room, emptySince };
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

async function cleanupIdleRooms(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const database = getDatabase();
    const roomsSnapshot = await database.ref("karaokeRooms").once("value");
    const roomIds = Object.keys(roomsSnapshot.val() || {});
    const results = await Promise.all(
      roomIds.map((roomId) =>
        database
          .ref(`karaokeSessions/${roomId}`)
          .transaction((room) => updateIdleRoomSession(room, Date.now())),
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
