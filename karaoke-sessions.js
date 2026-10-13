(function (global) {
  const ROOM_LIST_PATH = "karaokeRooms";
  const ROOM_DATA_PATH = "karaokeSessions";
  const ROOM_REQUESTS_PATH = "roomRequests";
  const ACTIVE_ROOM_PATH = "karaokeControl/activeRoomId";
  const ROOM_NAME_COUNTER_PATH = "karaokeControl/nextRoomNameNumber";
  const MAX_DEVICES = 3;
  const MAX_ROOM_DEVICES = 100;
  const DEFAULT_ROOM_VOLUME = 70;
  const MAX_ROOM_TIME_LIMIT_MINUTES = 10080;
  const MEMBER_TIMEOUT_MS = 60000;
  const EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS = 3 * 60 * 1000;
  const HEARTBEAT_INTERVAL_MS = 15000;
  const DEVICE_ID_STORAGE_KEY = "karaoke_room_tab_device_id";
  const TAB_INSTANCE_ID = global.crypto?.randomUUID
    ? global.crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let heartbeatTimer = null;
  let joinedRoomId = null;
  let joinedMemberRef = null;
  let roomDeviceId = global.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
  let roomDeviceIdPromise = null;
  let activeDeviceIdProbe = null;
  const deviceIdChannel =
    typeof global.BroadcastChannel === "function"
      ? new global.BroadcastChannel("karaoke_room_device_identity")
      : null;

  deviceIdChannel?.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.tabInstanceId === TAB_INSTANCE_ID) return;

    if (message.type === "probe" && message.deviceId === roomDeviceId) {
      deviceIdChannel.postMessage({
        type: "claim",
        deviceId: roomDeviceId,
        tabInstanceId: TAB_INSTANCE_ID,
        targetTabInstanceId: message.tabInstanceId,
      });
      return;
    }

    if (
      message.type === "claim" &&
      activeDeviceIdProbe &&
      message.deviceId === activeDeviceIdProbe.deviceId &&
      message.targetTabInstanceId === TAB_INSTANCE_ID
    ) {
      activeDeviceIdProbe.claims.add(message.tabInstanceId);
    }
  });

  function database() {
    if (typeof firebase === "undefined" || !firebase.database) {
      throw new Error("Firebase is unavailable");
    }
    return firebase.database();
  }

  function isRoomTimeExpired(room, now = Date.now()) {
    return (
      Number(room?.timeLimitMinutes) > 0 &&
      Number(room?.expiresAt) > 0 &&
      now >= Number(room.expiresAt)
    );
  }

  function throwIfRoomTimeExpired(room) {
    if (!isRoomTimeExpired(room)) return;
    const error = new Error("ROOM_TIME_EXPIRED");
    error.expiresAt = Number(room.expiresAt);
    throw error;
  }

  function getRoomIdleState(room, now = Date.now()) {
    const members = Object.values(room?.members || {});
    const activeMemberCount = members.filter(
      (member) => member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS,
    ).length;
    const queue = normalizeQueue(room?.queue);
    const hasSongs = queue.some(Boolean) || Boolean(room?.currentSong?.videoId);
    const inUse = activeMemberCount > 0;
    const emptySince = Number(room?.emptySince) || 0;

    return {
      hasSongs,
      inUse,
      emptySince: emptySince || null,
      expiresAt:
        hasSongs && !inUse && emptySince
          ? emptySince + EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS
          : null,
      shouldStartTimer: hasSongs && !inUse && !emptySince,
    };
  }

  function normalizeRoomTimeLimit(minutes) {
    const duration = Number(minutes);
    if (
      !Number.isInteger(duration) ||
      duration < 0 ||
      duration > MAX_ROOM_TIME_LIMIT_MINUTES
    ) {
      throw new Error("ROOM_TIME_LIMIT_INVALID");
    }
    return duration;
  }

  function getRoomDeviceLimit(room) {
    const limit = Number(room?.maxDevices);
    return Number.isInteger(limit) && limit >= 1 && limit <= MAX_ROOM_DEVICES
      ? limit
      : MAX_DEVICES;
  }

  function normalizeRoomDeviceLimit(devices) {
    const limit = Number(devices);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROOM_DEVICES) {
      throw new Error("ROOM_DEVICE_LIMIT_INVALID");
    }
    return limit;
  }

  async function assertKaraokeDisplayEnabled(roomId) {
    const snapshot = await database().ref("tvControl").once("value");
    const settings = snapshot.val() || {};
    if (settings.enabled === false) {
      const error = new Error("KARAOKE_DISPLAY_DISABLED");
      error.announcement =
        settings.announcement ||
        "The karaoke display is temporarily unavailable. Please check back soon.";
      throw error;
    }
    if (roomId) {
      const roomSnapshot = await database()
        .ref(`${ROOM_LIST_PATH}/${roomId}`)
        .once("value");
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      throwIfRoomTimeExpired(roomSnapshot.val());
      const roomSettingsSnapshot = await roomRef(roomId, "displayControl").once(
        "value",
      );
      const roomSettings = roomSettingsSnapshot.val() || {};
      if (roomSettings.enabled === false) {
        const error = new Error("KARAOKE_DISPLAY_DISABLED");
        error.announcement =
          roomSettings.announcement ||
          "The karaoke display in this room is temporarily unavailable.";
        throw error;
      }
    }
  }

  function createDeviceId() {
    return global.crypto?.randomUUID
      ? global.crypto.randomUUID()
      : `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async function getDeviceId() {
    if (!roomDeviceIdPromise) {
      roomDeviceIdPromise = (async () => {
        roomDeviceId =
          global.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY) ||
          createDeviceId();

        if (deviceIdChannel) {
          const claims = new Set();
          activeDeviceIdProbe = { deviceId: roomDeviceId, claims };
          deviceIdChannel.postMessage({
            type: "probe",
            deviceId: roomDeviceId,
            tabInstanceId: TAB_INSTANCE_ID,
          });
          await new Promise((resolve) => global.setTimeout(resolve, 120));
          activeDeviceIdProbe = null;

          if (claims.size > 0) roomDeviceId = createDeviceId();
        }

        global.sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, roomDeviceId);
        return roomDeviceId;
      })();
    }
    return roomDeviceIdPromise;
  }

  function getRoomIdFromUrl() {
    return new URLSearchParams(global.location.search).get("room");
  }

  function getJoinUrl(roomId) {
    const url = new URL("performer-portal.html", global.location.href);
    url.search = new URLSearchParams({ room: roomId }).toString();
    return url.toString();
  }

  function generateRoomId() {
    const randomValues = new Uint16Array(1);
    if (global.crypto?.getRandomValues) {
      global.crypto.getRandomValues(randomValues);
    } else {
      randomValues[0] = Math.floor(Math.random() * 10000);
    }
    return `sd${String(randomValues[0] % 10000).padStart(4, "0")}`;
  }

  function normalizeQueue(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object")
      return Object.values(value).filter(Boolean);
    return [];
  }

  async function migrateLegacyRoomIds(db) {
    const roomsSnapshot = await db.ref(ROOM_LIST_PATH).once("value");
    const rooms = roomsSnapshot.val() || {};

    for (const [legacyId, room] of Object.entries(rooms)) {
      if (legacyId === "main" || /^[A-Za-z0-9]{6}$/.test(legacyId)) continue;

      const legacyRoomRef = db.ref(`${ROOM_LIST_PATH}/${legacyId}`);
      const claim = await legacyRoomRef.transaction((current) =>
        current && !current.migrationInProgress
          ? { ...current, migrationInProgress: true }
          : undefined,
      );
      if (!claim.committed) continue;

      let newRoomRef = null;
      let migrationCommitted = false;
      try {
        const [sessionSnapshot, membersSnapshot] = await Promise.all([
          db.ref(`${ROOM_DATA_PATH}/${legacyId}`).once("value"),
          db.ref(`${ROOM_DATA_PATH}/${legacyId}/members`).once("value"),
        ]);
        const activeCutoff = Date.now() - MEMBER_TIMEOUT_MS;
        const hasActiveMembers = Object.values(
          membersSnapshot.val() || {},
        ).some((member) => member && Number(member.lastSeen) >= activeCutoff);
        if (hasActiveMembers) {
          await legacyRoomRef.transaction((current) =>
            current?.migrationInProgress ? room : undefined,
          );
          continue;
        }

        let newRoom = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const roomId = generateRoomId();
          newRoom = { ...room, id: roomId };
          delete newRoom.migrationInProgress;
          newRoomRef = db.ref(`${ROOM_LIST_PATH}/${roomId}`);
          const reservation = await newRoomRef.transaction((current) =>
            current ? undefined : newRoom,
          );
          if (reservation.committed) break;
          newRoom = null;
          newRoomRef = null;
        }
        if (!newRoom || !newRoomRef) {
          throw new Error("ROOM_ID_GENERATION_FAILED");
        }

        await db.ref().update({
          [`${ROOM_LIST_PATH}/${newRoom.id}`]: newRoom,
          [`${ROOM_DATA_PATH}/${newRoom.id}`]: sessionSnapshot.val(),
          [`${ROOM_LIST_PATH}/${legacyId}`]: null,
          [`${ROOM_DATA_PATH}/${legacyId}`]: null,
        });
        migrationCommitted = true;
        await db
          .ref(ACTIVE_ROOM_PATH)
          .transaction((current) =>
            current === legacyId ? newRoom.id : current,
          );
      } catch (error) {
        if (!migrationCommitted) {
          if (newRoomRef) await newRoomRef.remove();
          await legacyRoomRef.transaction((current) =>
            current?.migrationInProgress ? room : undefined,
          );
        }
        throw error;
      }
    }
  }

  async function ensureDefaultRoom() {
    const db = database();
    const defaultRoomRef = db.ref(`${ROOM_LIST_PATH}/main`);
    const roomSnapshot = await defaultRoomRef.once("value");

    if (!roomSnapshot.exists()) {
      const [queueSnapshot, songSnapshot] = await Promise.all([
        db.ref("queue").once("value"),
        db.ref("currentSong").once("value"),
      ]);
      const legacyQueue = normalizeQueue(queueSnapshot.val());
      const legacySong = songSnapshot.val();
      if (legacySong?.videoId) {
        const currentIndex = legacyQueue.findIndex(
          (song) =>
            (legacySong.id && song.id === legacySong.id) ||
            song.videoId === legacySong.videoId,
        );
        if (currentIndex !== -1) legacyQueue.splice(currentIndex, 1);
      }
      const roomData = {
        id: "main",
        name: "Main Room",
        createdAt: Date.now(),
      };

      await defaultRoomRef.transaction((current) => current || roomData);
      await db.ref(`${ROOM_DATA_PATH}/main`).transaction(
        (current) =>
          current || {
            queue: legacyQueue,
            currentSong: legacySong || null,
            members: null,
          },
      );
    }

    await migrateLegacyRoomIds(db);

    const roomsSnapshot = await db.ref(ROOM_LIST_PATH).once("value");
    const rooms = roomsSnapshot.val() || {};
    const activeRef = db.ref(ACTIVE_ROOM_PATH);
    const activeSnapshot = await activeRef.once("value");
    if (!rooms[activeSnapshot.val()]) {
      const firstRoomId = Object.keys(rooms)[0] || "main";
      await activeRef.set(firstRoomId);
    }
  }

  function listenRooms(callback) {
    const ref = database().ref(ROOM_LIST_PATH);
    const handler = (snapshot) => {
      const rooms = snapshot.val() || {};
      callback(
        Object.entries(rooms)
          .map(([id, room]) => ({ ...room, id }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      );
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function listenRoomUsage(roomId, callback, onError) {
    const ref = database().ref(`${ROOM_LIST_PATH}/${roomId}`);
    const handler = (snapshot) => callback(snapshot.val() || {});
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  async function getActiveRoomId() {
    const snapshot = await database().ref(ACTIVE_ROOM_PATH).once("value");
    return snapshot.val();
  }

  function getNumberedRooms(rooms) {
    return Object.entries(rooms || {})
      .filter(([, room]) => /^SDR\d+$/i.test(String(room?.name || "").trim()))
      .sort(
        ([firstId, first], [secondId, second]) =>
          (Number(first.createdAt) || 0) - (Number(second.createdAt) || 0) ||
          firstId.localeCompare(secondId),
      );
  }

  async function createRoom() {
    const db = database();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const roomId = generateRoomId();
      let room = null;
      const reservation = await db
        .ref(ROOM_LIST_PATH)
        .transaction((current) => {
          const rooms = current || {};
          if (rooms[roomId]) return undefined;

          const numberedRooms = getNumberedRooms(rooms);
          const nextRooms = { ...rooms };
          numberedRooms.forEach(([existingId, existingRoom], index) => {
            nextRooms[existingId] = {
              ...existingRoom,
              name: `SDR${index + 1}`,
            };
          });

          room = {
            id: roomId,
            name: `SDR${numberedRooms.length + 1}`,
            createdAt: Date.now(),
            maxDevices: MAX_DEVICES,
            timeLimitMinutes: 0,
            usageStartedAt: null,
            expiresAt: null,
          };
          return { ...nextRooms, [roomId]: room };
        });
      if (!reservation.committed) continue;

      try {
        await db.ref(`${ROOM_DATA_PATH}/${roomId}`).set({
          queue: null,
          currentSong: null,
          members: null,
        });
        return room;
      } catch (error) {
        await db.ref(`${ROOM_LIST_PATH}/${roomId}`).remove();
        throw error;
      }
    }

    throw new Error("ROOM_ID_GENERATION_FAILED");
  }

  async function setRoomTimeLimit(roomId, durationMinutes) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const minutes = normalizeRoomTimeLimit(durationMinutes);
    const activeMemberCount = minutes ? await getActiveMemberCount(roomId) : 0;
    const now = Date.now();
    const result = await database()
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .transaction((room) => {
        if (!room) return undefined;
        if (minutes === 0) {
          return {
            ...room,
            timeLimitMinutes: 0,
            usageStartedAt: null,
            expiresAt: null,
          };
        }
        const existingExpiry = Number(room.expiresAt);
        const existingStart = Number(room.usageStartedAt);
        const startedAt =
          existingStart > 0 && existingExpiry > now
            ? existingStart
            : activeMemberCount > 0
              ? now
              : null;
        return {
          ...room,
          timeLimitMinutes: minutes,
          usageStartedAt: startedAt,
          expiresAt: startedAt ? startedAt + minutes * 60000 : null,
        };
      });
    if (!result.committed) throw new Error("ROOM_NOT_FOUND");
    return result.snapshot.val();
  }

  async function setRoomDeviceLimit(roomId, deviceLimit) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const limit = normalizeRoomDeviceLimit(deviceLimit);
    const result = await database()
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .transaction((room) =>
        room ? { ...room, maxDevices: limit } : undefined,
      );
    if (!result.committed) throw new Error("ROOM_NOT_FOUND");
    return result.snapshot.val();
  }

  async function renameRoom(roomId, name) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const roomName = String(name || "")
      .trim()
      .slice(0, 40);
    if (!roomName) throw new Error("ROOM_NAME_REQUIRED");

    const result = await database()
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .transaction((room) => (room ? { ...room, name: roomName } : undefined));
    if (!result.committed) throw new Error("ROOM_NOT_FOUND");
    return { ...result.snapshot.val(), id: roomId };
  }

  async function deleteRoom(roomId) {
    if (!roomId || roomId === "main") {
      throw new Error("DEFAULT_ROOM_PROTECTED");
    }

    const db = database();
    const [roomSnapshot, roomsSnapshot, activeSnapshot, membersSnapshot] =
      await Promise.all([
        db.ref(`${ROOM_LIST_PATH}/${roomId}`).once("value"),
        db.ref(ROOM_LIST_PATH).once("value"),
        db.ref(ACTIVE_ROOM_PATH).once("value"),
        db.ref(`${ROOM_DATA_PATH}/${roomId}/members`).once("value"),
      ]);

    if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");

    const activeCutoff = Date.now() - MEMBER_TIMEOUT_MS;
    const hasActiveMembers = Object.values(membersSnapshot.val() || {}).some(
      (member) => member && Number(member.lastSeen) >= activeCutoff,
    );
    if (hasActiveMembers) throw new Error("ROOM_HAS_ACTIVE_DEVICES");

    const remainingRooms = roomsSnapshot.val() || {};
    delete remainingRooms[roomId];
    const nextRoomId = Object.keys(remainingRooms)[0] || "main";
    const updates = {
      [`${ROOM_LIST_PATH}/${roomId}`]: null,
      [`${ROOM_DATA_PATH}/${roomId}`]: null,
      [ROOM_NAME_COUNTER_PATH]: null,
    };
    getNumberedRooms(remainingRooms).forEach(
      ([remainingRoomId, room], index) => {
        updates[`${ROOM_LIST_PATH}/${remainingRoomId}/name`] =
          `SDR${index + 1}`;
      },
    );
    if (activeSnapshot.val() === roomId) {
      updates[ACTIVE_ROOM_PATH] = nextRoomId;
    }

    await db.ref().update(updates);
    return roomId;
  }

  async function createRoomRequest(username, roomId) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const db = database();
    const requestRef = roomRef(roomId, "roomRequests").push();
    const request = {
      id: requestRef.key,
      username: String(username || "Performer")
        .trim()
        .slice(0, 40),
      roomId: String(roomId || "").slice(0, 128),
      status: "pending",
      createdAt: Date.now(),
    };
    await db.ref().update({
      [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${request.id}`]: request,
      [`${ROOM_REQUESTS_PATH}/${request.id}`]: request,
    });
    return request;
  }

  async function createRoomExtensionRequest(
    username,
    roomId,
    requestedMinutes,
  ) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const minutes = normalizeRoomTimeLimit(requestedMinutes);
    if (minutes === 0) throw new Error("ROOM_EXTENSION_DURATION_REQUIRED");
    const db = database();
    const roomSnapshot = await db
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .once("value");
    if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
    if (!(Number(roomSnapshot.val()?.timeLimitMinutes) > 0)) {
      throw new Error("ROOM_TIME_LIMIT_NOT_SET");
    }

    const requestRef = roomRef(roomId, "roomRequests").push();
    const request = {
      id: requestRef.key,
      type: "extension",
      username: String(username || "Performer")
        .trim()
        .slice(0, 40),
      roomId: String(roomId).slice(0, 128),
      requestedMinutes: minutes,
      status: "pending",
      createdAt: Date.now(),
    };
    await db.ref().update({
      [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${request.id}`]: request,
      [`${ROOM_REQUESTS_PATH}/${request.id}`]: request,
    });
    return request;
  }

  function listenRoomRequests(roomId, callback) {
    const ref = roomRef(roomId, "roomRequests");
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests)
          .map(([id, request]) => ({ ...request, id }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      );
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function listenAllRoomRequests(callback, onError) {
    const ref = database().ref(ROOM_REQUESTS_PATH);
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests)
          .map(([id, request]) => ({ ...request, id }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      );
    };
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  function listenRoomRequest(roomId, requestId, callback, onError) {
    const ref = roomRef(roomId, `roomRequests/${requestId}`);
    const handler = (snapshot) => callback(snapshot.val());
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  function listenRoomDisplayStatus(roomId, callback, onError) {
    const ref = roomRef(roomId, "displayControl");
    const handler = (snapshot) => callback(snapshot.val() || {});
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }

  function setRoomDisplayAvailability(roomId, enabled, announcement) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    return roomRef(roomId, "displayControl").update({
      enabled: Boolean(enabled),
      announcement: enabled ? null : announcement || null,
    });
  }

  async function approveRoomRequest(roomId, requestId) {
    const db = database();
    const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
    const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
    const claim = await requestRef.transaction((request) =>
      request?.status === "pending"
        ? { ...request, status: "approving" }
        : undefined,
    );
    if (!claim.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");

    let room = null;
    try {
      room = await createRoom();
      const handledAt = Date.now();
      const nextStatus = {
        status: "approved",
        approvedRoomId: room.id,
        handledAt,
      };
      await db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: {
          ...(claim.snapshot.val() || {}),
          ...nextStatus,
        },
        [`${ROOM_REQUESTS_PATH}/${requestId}`]: {
          ...((await globalRequestRef.once("value")).val() || {}),
          roomId,
          ...nextStatus,
        },
      });
      return room;
    } catch (error) {
      if (room) {
        try {
          await deleteRoom(room.id);
        } catch (cleanupError) {
          console.error("Could not clean up unassigned room:", cleanupError);
        }
      }
      try {
        await requestRef.transaction((request) =>
          request?.status === "approving"
            ? { ...request, status: "pending" }
            : undefined,
        );
      } catch (rollbackError) {
        console.error("Could not restore pending room request:", rollbackError);
      }
      throw error;
    }
  }

  async function approveRoomExtension(roomId, requestId) {
    const db = database();
    const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
    const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
    const claim = await requestRef.transaction((request) =>
      request?.type === "extension" && request.status === "pending"
        ? { ...request, status: "approving" }
        : undefined,
    );
    if (!claim.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");

    const request = claim.snapshot.val();
    let roomUpdated = false;
    try {
      const extraMinutes = normalizeRoomTimeLimit(request.requestedMinutes);
      if (extraMinutes === 0)
        throw new Error("ROOM_EXTENSION_DURATION_REQUIRED");
      const roomResult = await db
        .ref(`${ROOM_LIST_PATH}/${roomId}`)
        .transaction((room) => {
          if (!room) return undefined;
          const now = Date.now();
          const currentExpiry = Number(room.expiresAt);
          const isStillRunning = currentExpiry > now;
          const baseExpiry = isStillRunning ? currentExpiry : now;
          const startedAt =
            isStillRunning && Number(room.usageStartedAt) > 0
              ? Number(room.usageStartedAt)
              : now;
          return {
            ...room,
            timeLimitMinutes: isStillRunning
              ? Number(room.timeLimitMinutes || 0) + extraMinutes
              : extraMinutes,
            usageStartedAt: startedAt,
            expiresAt: baseExpiry + extraMinutes * 60000,
          };
        });
      if (!roomResult.committed) throw new Error("ROOM_NOT_FOUND");
      roomUpdated = true;

      const handledAt = Date.now();
      const approved = {
        status: "approved",
        handledAt,
        approvedMinutes: extraMinutes,
        approvedExpiresAt: roomResult.snapshot.val().expiresAt,
      };
      await db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: {
          ...request,
          ...approved,
        },
        [`${ROOM_REQUESTS_PATH}/${requestId}`]: {
          ...((await globalRequestRef.once("value")).val() || {}),
          ...request,
          roomId,
          ...approved,
        },
      });
      return roomResult.snapshot.val();
    } catch (error) {
      if (!roomUpdated) {
        try {
          await requestRef.transaction((current) =>
            current?.status === "approving"
              ? { ...current, status: "pending" }
              : undefined,
          );
        } catch (rollbackError) {
          console.error(
            "Could not restore pending extension request:",
            rollbackError,
          );
        }
      }
      throw error;
    }
  }

  function rejectRoomRequest(roomId, requestId) {
    const db = database();
    const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
    const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
    return requestRef
      .transaction((request) =>
        request?.status === "pending"
          ? { ...request, status: "rejected", handledAt: Date.now() }
          : undefined,
      )
      .then(async (result) => {
        if (!result.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");
        const request = result.snapshot.val();
        const nextRequest = { ...(request || {}), roomId, status: "rejected" };
        await db.ref().update({
          [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]:
            nextRequest,
          [`${ROOM_REQUESTS_PATH}/${requestId}`]: {
            ...((await globalRequestRef.once("value")).val() || {}),
            ...nextRequest,
          },
        });
      });
  }

  async function deleteRoomRequest(roomId, requestId) {
    if (!roomId || !requestId) throw new Error("ROOM_REQUEST_REQUIRED");

    const db = database();
    const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
    const claim = await requestRef.transaction((request) =>
      ["approved", "rejected"].includes(request?.status)
        ? { ...request, status: "deleting" }
        : undefined,
    );
    if (!claim.committed) throw new Error("ROOM_REQUEST_NOT_DELETABLE");

    try {
      await db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: null,
        [`${ROOM_REQUESTS_PATH}/${requestId}`]: null,
      });
    } catch (error) {
      try {
        await requestRef.set(claim.snapshot.val());
      } catch (rollbackError) {
        console.error("Could not restore room request:", rollbackError);
      }
      throw error;
    }
  }

  function listenRoom(roomId, handlers, onError) {
    const roomRef = database().ref(`${ROOM_DATA_PATH}/${roomId}`);
    const queueRef = roomRef.child("queue");
    const songRef = roomRef.child("currentSong");
    const controlRef = roomRef.child("control");
    const queueHandler = (snapshot) =>
      handlers.onQueue(normalizeQueue(snapshot.val()));
    const songHandler = (snapshot) => handlers.onCurrentSong(snapshot.val());
    let isInitialControlSnapshot = true;
    let lastControlEventId = null;
    const controlHandler = (snapshot) => {
      const control = snapshot.val();
      const eventId = getControlEventId(control);
      if (isInitialControlSnapshot) {
        isInitialControlSnapshot = false;
        lastControlEventId = eventId;
        return;
      }
      if (
        control?.command &&
        handlers.onControl &&
        eventId !== lastControlEventId
      ) {
        lastControlEventId = eventId;
        handlers.onControl(control);
      }
    };

    queueRef.on("value", queueHandler, onError);
    songRef.on("value", songHandler, onError);
    controlRef.on("value", controlHandler, onError);

    return () => {
      queueRef.off("value", queueHandler);
      songRef.off("value", songHandler);
      controlRef.off("value", controlHandler);
    };
  }

  function listenRoomIdleState(roomId, callback, onError) {
    const ref = database().ref(`${ROOM_DATA_PATH}/${roomId}`);
    let room = null;
    const updateState = () => {
      const state = getRoomIdleState(room);
      callback(state);
      if (state.shouldStartTimer) {
        markRoomEmptySince(roomId).catch((error) => {
          console.warn("Could not start room idle timer:", error.message);
        });
      }
    };
    const handler = (snapshot) => {
      room = snapshot.val();
      updateState();
    };
    ref.on("value", handler, onError);
    const refreshTimer = global.setInterval(
      updateState,
      HEARTBEAT_INTERVAL_MS,
    );
    return () => {
      ref.off("value", handler);
      global.clearInterval(refreshTimer);
    };
  }

  function listenMembers(roomId, callback) {
    const ref = database().ref(`${ROOM_DATA_PATH}/${roomId}/members`);
    let members = {};
    const updateCount = () => {
      const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
      const activeMemberIds = Object.entries(members)
        .filter(([, member]) => member && Number(member.lastSeen) >= cutoff)
        .map(([id]) => id);
      callback(activeMemberIds.length, activeMemberIds);
    };
    const handler = (snapshot) => {
      members = snapshot.val() || {};
      updateCount();
    };
    ref.on("value", handler);
    const refreshTimer = global.setInterval(updateCount, HEARTBEAT_INTERVAL_MS);
    return () => {
      ref.off("value", handler);
      global.clearInterval(refreshTimer);
    };
  }

  async function getActiveMemberCount(roomId) {
    const snapshot = await database()
      .ref(`${ROOM_DATA_PATH}/${roomId}/members`)
      .once("value");
    const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
    return Object.values(snapshot.val() || {}).filter(
      (member) => member && Number(member.lastSeen) >= cutoff,
    ).length;
  }

  async function startRoomUsage(roomId) {
    const now = Date.now();
    return database()
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .transaction((room) => {
        const duration = Number(room?.timeLimitMinutes);
        if (
          !room ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          Number(room.expiresAt) > 0
        ) {
          return undefined;
        }
        return {
          ...room,
          usageStartedAt: now,
          expiresAt: now + duration * 60000,
        };
      });
  }

  async function markRoomEmptySince(roomId, emptySince) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const requestedTimestamp = Number(emptySince);
    const suppliedTimestamp =
      Number.isFinite(requestedTimestamp) && requestedTimestamp > 0
        ? requestedTimestamp
        : null;
    const now = Date.now();
    const result = await roomRef(roomId).transaction((room) => {
      if (!room) return undefined;
      const hasActiveMembers = Object.values(room.members || {}).some(
        (member) =>
          member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS,
      );
      if (hasActiveMembers) {
        return Number(room.emptySince) > 0
          ? { ...room, emptySince: null }
          : undefined;
      }
      if (!room.queue && !room.currentSong) {
        return Number(room.emptySince) > 0
          ? { ...room, emptySince: null }
          : undefined;
      }
      const existingEmptySince = Number(room.emptySince) || 0;
      const timestamp = existingEmptySince || suppliedTimestamp || now;
      return timestamp === existingEmptySince
        ? undefined
        : { ...room, emptySince: timestamp };
    });
    return Number(result.snapshot.val()?.emptySince) || null;
  }

  async function clearRoomEmptySince(roomId) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const result = await roomRef(roomId, "emptySince").transaction((current) =>
      Number(current) > 0 ? null : undefined,
    );
    return result.committed;
  }

  async function clearRoomSongsIfUnoccupied(roomId) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const now = Date.now();
    const sessionRef = roomRef(roomId);
    const beforeSnapshot = await sessionRef.once("value");
    const hadSongs = Boolean(
      beforeSnapshot.val()?.queue || beforeSnapshot.val()?.currentSong,
    );
    const result = await sessionRef.transaction((room) => {
      if (!room) return undefined;
      const hasActiveMembers = Object.values(room.members || {}).some(
        (member) =>
          member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS,
      );
      if (hasActiveMembers) {
        return Number(room.emptySince) > 0
          ? { ...room, emptySince: null }
          : undefined;
      }
      if (!room.queue && !room.currentSong) {
        return { ...room, emptySince: null };
      }
      const emptySince = Number(room.emptySince) || 0;
      const idleSince = emptySince || now;
      if (now - idleSince < EMPTY_ROOM_QUEUE_CLEAR_DELAY_MS) {
        return idleSince === emptySince
          ? undefined
          : { ...room, emptySince: idleSince };
      }
      return { ...room, queue: null, currentSong: null, emptySince: null };
    });
    const room = result.snapshot.val();
    return Boolean(
      hadSongs && result.committed && !room?.queue && !room?.currentSong,
    );
  }

  function normalizeVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) return DEFAULT_ROOM_VOLUME;
    return Math.max(0, Math.min(100, Math.round(volume)));
  }

  function listenVolume(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => {
      callback(normalizeVolume(snapshot.val()?.volume));
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function listenMuted(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => callback(Boolean(snapshot.val()?.muted));
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function listenPlaybackState(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => callback(Boolean(snapshot.val()?.playing));
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function touchRoomActivity(roomId) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    return roomRef(roomId).update({
      lastActivityAt: Date.now(),
      emptySince: null,
    });
  }

  async function setPlaybackState(roomId, playing) {
    await assertKaraokeDisplayEnabled(roomId);
    await touchRoomActivity(roomId);
    return roomRef(roomId, "control").update({ playing: Boolean(playing) });
  }

  function setRoomVolume(roomId, volume) {
    return sendControl(roomId, "setVolume", {
      volume: normalizeVolume(volume),
    });
  }

  function setRoomMuted(roomId, muted) {
    return sendControl(roomId, "setMuted", { muted: Boolean(muted) });
  }

  async function joinRoom(roomId, username) {
    const db = database();
    const roomSnapshot = await db
      .ref(`${ROOM_LIST_PATH}/${roomId}`)
      .once("value");
    if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
    throwIfRoomTimeExpired(roomSnapshot.val());

    const deviceId = await getDeviceId();
    const maxDevices = getRoomDeviceLimit(roomSnapshot.val());
    const memberRef = db.ref(`${ROOM_DATA_PATH}/${roomId}/members/${deviceId}`);
    await memberRef.onDisconnect().remove();

    const result = await db
      .ref(`${ROOM_DATA_PATH}/${roomId}/members`)
      .transaction((current) => {
        const now = Date.now();
        const activeMembers = {};
        Object.entries(current || {}).forEach(([id, member]) => {
          if (member && Number(member.lastSeen) >= now - MEMBER_TIMEOUT_MS) {
            activeMembers[id] = member;
          }
        });

        if (
          !activeMembers[deviceId] &&
          Object.keys(activeMembers).length >= maxDevices
        ) {
          return activeMembers;
        }

        activeMembers[deviceId] = {
          username,
          joinedAt: activeMembers[deviceId]?.joinedAt || now,
          lastSeen: now,
        };
        return activeMembers;
      });

    const member = result.snapshot.child(deviceId).val();
    if (!member) {
      await memberRef.onDisconnect().cancel();
      throw new Error("ROOM_FULL");
    }
    clearRoomEmptySince(roomId).catch((error) => {
      console.warn("Could not reset room idle timer:", error.message);
    });
    touchRoomActivity(roomId).catch((error) => {
      console.warn("Could not update room activity:", error.message);
    });

    try {
      await startRoomUsage(roomId);
      const latestRoomSnapshot = await db
        .ref(`${ROOM_LIST_PATH}/${roomId}`)
        .once("value");
      throwIfRoomTimeExpired(latestRoomSnapshot.val());
    } catch (error) {
      await memberRef.remove();
      await memberRef
        .onDisconnect()
        .cancel()
        .catch(() => {});
      throw error;
    }

    joinedRoomId = roomId;
    joinedMemberRef = memberRef;
    global.sessionStorage.setItem("karaokeRoomId", roomId);
    global.sessionStorage.setItem("karaokeRoomDeviceId", deviceId);
    if (heartbeatTimer) global.clearInterval(heartbeatTimer);
    heartbeatTimer = global.setInterval(() => {
      memberRef.update({ lastSeen: Date.now() }).catch((error) => {
        console.warn("Karaoke room heartbeat failed:", error.message);
      });
    }, HEARTBEAT_INTERVAL_MS);

    return {
      room: { ...roomSnapshot.val(), id: roomId },
      deviceId,
      maxDevices,
    };
  }

  async function joinRoomWithFallback(roomId, username) {
    const roomsSnapshot = await database().ref(ROOM_LIST_PATH).once("value");
    const rooms = Object.entries(roomsSnapshot.val() || {}).map(
      ([id, room]) => ({ ...room, id }),
    );
    const requestedRoom = rooms.find((room) => room.id === roomId);
    if (roomId && !requestedRoom) throw new Error("ROOM_NOT_FOUND");
    throwIfRoomTimeExpired(requestedRoom);
    const orderedRooms = rooms
      .filter((room) => !isRoomTimeExpired(room))
      .sort(
        (first, second) => (first.createdAt || 0) - (second.createdAt || 0),
      );
    if (requestedRoom) {
      orderedRooms.sort((first, second) => {
        if (first.id === roomId) return -1;
        if (second.id === roomId) return 1;
        return (first.createdAt || 0) - (second.createdAt || 0);
      });
    }

    for (const room of orderedRooms) {
      try {
        const membership = await joinRoom(room.id, username);
        return room.id === roomId
          ? membership
          : {
              ...membership,
              requestedRoomId: roomId || null,
              autoAssigned: Boolean(roomId),
            };
      } catch (error) {
        if (error.message !== "ROOM_FULL") throw error;
      }
    }

    throw new Error("NO_AVAILABLE_ROOMS");
  }

  async function leaveRoom(roomId) {
    const targetRoomId = roomId || joinedRoomId;
    const deviceId = global.sessionStorage.getItem("karaokeRoomDeviceId");
    if (heartbeatTimer && (!roomId || roomId === joinedRoomId)) {
      global.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (targetRoomId && deviceId) {
      const memberRef = database().ref(
        `${ROOM_DATA_PATH}/${targetRoomId}/members/${deviceId}`,
      );
      await memberRef
        .onDisconnect()
        .cancel()
        .catch(() => {});
      await memberRef.remove();
    }
    if (!roomId || roomId === joinedRoomId) {
      joinedRoomId = null;
      joinedMemberRef = null;
      global.sessionStorage.removeItem("karaokeRoomId");
    }
  }

  async function addSong(roomId, song) {
    await assertKaraokeDisplayEnabled(roomId);
    const result = await roomRef(roomId).transaction((current) => {
      const room = current || {};
      const queue = normalizeQueue(room.queue);
      if (
        room.currentSong?.id === song.id ||
        queue.some((item) => item.id === song.id)
      ) {
        return undefined;
      }

      if (!room.currentSong?.videoId) {
        return {
          ...room,
          currentSong: song,
          queue,
          lastActivityAt: Date.now(),
          emptySince: null,
        };
      }

      queue.push(song);
      return {
        ...room,
        queue,
        lastActivityAt: Date.now(),
        emptySince: null,
      };
    });
    return result.snapshot.val();
  }

  function setCurrentSongFromQueue(roomId, song) {
    return roomRef(roomId).transaction((room) => {
      if (!room || room.currentSong?.videoId) return undefined;
      const queuedSong = normalizeQueue(room.queue).find(
        (item) => item.videoId === song.videoId,
      );
      if (!queuedSong) return undefined;
      return {
        ...room,
        currentSong: queuedSong,
        lastActivityAt: Date.now(),
        emptySince: null,
      };
    });
  }

  async function claimNextSong(roomId) {
    await assertKaraokeDisplayEnabled(roomId);
    return roomRef(roomId).transaction((current) => {
      const room = current || {};
      if (room.currentSong?.videoId) return undefined;
      const queue = normalizeQueue(room.queue);
      if (queue.length === 0) return undefined;
      const currentSong = queue.shift();
      return {
        ...room,
        currentSong,
        queue: queue.length > 0 ? queue : null,
        lastActivityAt: Date.now(),
        emptySince: null,
      };
    });
  }

  async function advanceToNextSong(roomId) {
    await assertKaraokeDisplayEnabled(roomId);
    return roomRef(roomId).transaction((current) => {
      const room = current || {};
      const queue = normalizeQueue(room.queue);
      if (queue.length === 0) {
        return {
          ...room,
          currentSong: null,
          queue: null,
          lastActivityAt: Date.now(),
          emptySince: null,
        };
      }
      const currentSong = queue.shift();
      return {
        ...room,
        currentSong,
        queue: queue.length > 0 ? queue : null,
        lastActivityAt: Date.now(),
        emptySince: null,
      };
    });
  }

  async function sendControl(roomId, command, payload = {}) {
    await assertKaraokeDisplayEnabled(roomId);
    const timestamp = Date.now();
    await roomRef(roomId).update({
      lastActivityAt: timestamp,
      emptySince: null,
    });
    return roomRef(roomId, "control").update({
      ...payload,
      command,
      timestamp,
      eventId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    });
  }

  function getControlEventId(control) {
    if (!control?.command) return null;
    return control.eventId || `${control.timestamp || ""}:${control.command}`;
  }

  function roomRef(roomId, child) {
    const path = `${ROOM_DATA_PATH}/${roomId}`;
    return database().ref(child ? `${path}/${child}` : path);
  }

  global.KaraokeSessions = {
    MAX_DEVICES,
    MAX_ROOM_DEVICES,
    DEFAULT_ROOM_VOLUME,
    addSong,
    advanceToNextSong,
    claimNextSong,
    createRoom,
    createRoomRequest,
    createRoomExtensionRequest,
    clearRoomSongsIfUnoccupied,
    markRoomEmptySince,
    clearRoomEmptySince,
    deleteRoomRequest,
    deleteRoom,
    ensureDefaultRoom,
    getActiveRoomId,
    listenAllRoomRequests,
    getActiveMemberCount,
    getJoinUrl,
    getRoomIdFromUrl,
    joinRoom,
    joinRoomWithFallback,
    leaveRoom,
    listenMembers,
    listenMuted,
    listenPlaybackState,
    listenRoom,
    listenRoomIdleState,
    listenRoomRequest,
    listenRooms,
    listenRoomUsage,
    listenRoomRequests,
    listenRoomDisplayStatus,
    listenVolume,
    roomRef,
    renameRoom,
    approveRoomRequest,
    approveRoomExtension,
    rejectRoomRequest,
    setRoomVolume,
    setRoomMuted,
    setRoomDisplayAvailability,
    setPlaybackState,
    touchRoomActivity,
    setRoomTimeLimit,
    setRoomDeviceLimit,
    getRoomDeviceLimit,
    sendControl,
    setCurrentSongFromQueue,
  };
})(window);
