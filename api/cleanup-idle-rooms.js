const { timingSafeEqual } = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getDatabase: getAdminDatabase } = require("firebase-admin/database");

const EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS = 3 * 60 * 1000;
const MEMBER_TIMEOUT_MS = 60000;

function updateIdleRoomSession(room, now) {
  if (!room) return undefined;

  const hasActiveMembers = Object.values(room.members || {}).some(
    (member) => member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS,
  );
  const isPlaying = room.control?.playing === true;
  const queue = Array.isArray(room.queue)
    ? room.queue
    : Object.values(room.queue || {});
  const hasSongs = queue.some(Boolean) || Boolean(room.currentSong?.videoId);
  if (!hasSongs) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  if (hasActiveMembers || isPlaying) {
    return Number(room.emptySince) > 0
      ? { ...room, emptySince: null }
      : undefined;
  }

  const storedEmptySince = Number(room.emptySince) || 0;
  const emptySince = storedEmptySince || now;
  if (now - emptySince < EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS) {
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
