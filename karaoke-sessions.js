(function (global) {
  const ROOM_LIST_PATH = "karaokeRooms";
  const ROOM_DATA_PATH = "karaokeSessions";
  const ROOM_REQUESTS_PATH = "roomRequests";
  const ACTIVE_ROOM_PATH = "karaokeControl/activeRoomId";
  const MAX_DEVICES = 3;
  const DEFAULT_ROOM_VOLUME = 70;
  const MEMBER_TIMEOUT_MS = 60000;
  const HEARTBEAT_INTERVAL_MS = 15000;
  let heartbeatTimer = null;
  let joinedRoomId = null;
  let joinedMemberRef = null;

  function database() {
    if (typeof firebase === "undefined" || !firebase.database) {
      throw new Error("Firebase is unavailable");
    }
    return firebase.database();
  }

  async function assertKaraokeDisplayEnabled() {
    const snapshot = await database().ref("tvControl").once("value");
    const settings = snapshot.val() || {};
    if (settings.enabled === false) {
      const error = new Error("KARAOKE_DISPLAY_DISABLED");
      error.announcement =
        settings.announcement ||
        "The karaoke display is temporarily unavailable. Please check back soon.";
      throw error;
    }
  }

  function getDeviceId() {
    let deviceId = localStorage.getItem("karaoke_room_device_id");
    if (!deviceId) {
      deviceId = global.crypto?.randomUUID
        ? global.crypto.randomUUID()
        : `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("karaoke_room_device_id", deviceId);
    }
    return deviceId;
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

  async function getActiveRoomId() {
    const snapshot = await database().ref(ACTIVE_ROOM_PATH).once("value");
    return snapshot.val();
  }

  async function createRoom(name) {
    const db = database();
    const roomName = name.trim().slice(0, 40);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const room = {
        id: generateRoomId(),
        name: roomName,
        createdAt: Date.now(),
      };
      const roomRef = db.ref(`${ROOM_LIST_PATH}/${room.id}`);
      const reservation = await roomRef.transaction((current) =>
        current ? undefined : room,
      );
      if (!reservation.committed) continue;

      try {
        await db.ref(`${ROOM_DATA_PATH}/${room.id}`).set({
          queue: null,
          currentSong: null,
          members: null,
        });
        return room;
      } catch (error) {
        await roomRef.remove();
        throw error;
      }
    }

    throw new Error("ROOM_ID_GENERATION_FAILED");
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
    };
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

  async function approveRoomRequest(roomId, requestId, roomName) {
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
      room = await createRoom(roomName);
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

  function listenMembers(roomId, callback) {
    const ref = database().ref(`${ROOM_DATA_PATH}/${roomId}/members`);
    let members = {};
    const updateCount = () => {
      const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
      const activeMemberIds = Object.entries(members)
        .filter(([, member]) => member && Number(member.lastSeen) >= cutoff)
        .map(([id]) => id)
        .slice(0, MAX_DEVICES);
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

  function setPlaybackState(roomId, playing) {
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

    const deviceId = getDeviceId();
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
          Object.keys(activeMembers).length >= MAX_DEVICES
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
      maxDevices: MAX_DEVICES,
    };
  }

  async function joinRoomWithFallback(roomId, username) {
    const deviceId = getDeviceId();
    const roomsSnapshot = await database().ref(ROOM_LIST_PATH).once("value");
    const rooms = Object.entries(roomsSnapshot.val() || {}).map(
      ([id, room]) => ({ ...room, id }),
    );
    const getActiveMembers = async (candidateRoomId) => {
      const snapshot = await database()
        .ref(`${ROOM_DATA_PATH}/${candidateRoomId}/members`)
        .once("value");
      const activeCutoff = Date.now() - MEMBER_TIMEOUT_MS;
      return Object.entries(snapshot.val() || {}).filter(
        ([, member]) => member && Number(member.lastSeen) >= activeCutoff,
      );
    };

    const requestedMembers = await getActiveMembers(roomId);
    if (requestedMembers.some(([id]) => id === deviceId)) {
      return joinRoom(roomId, username);
    }

    const candidates = await Promise.all(
      rooms
        .filter((room) => room.id !== roomId)
        .map(async (room) => ({
          ...room,
          activeCount: (await getActiveMembers(room.id)).length,
        })),
    );
    const availableCandidates = candidates
      .filter((room) => room.activeCount < MAX_DEVICES)
      .sort(
        (first, second) =>
          first.activeCount - second.activeCount ||
          (first.createdAt || 0) - (second.createdAt || 0),
      );
    const requestedCount = requestedMembers.length;
    const routeToOtherRoom =
      requestedCount > 0 && availableCandidates.length > 0;
    const orderedRooms = routeToOtherRoom
      ? [...availableCandidates, { id: roomId }]
      : [{ id: roomId }, ...availableCandidates];

    for (const room of orderedRooms) {
      try {
        const membership = await joinRoom(room.id, username);
        return room.id === roomId
          ? membership
          : { ...membership, requestedRoomId: roomId, autoAssigned: true };
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
    await assertKaraokeDisplayEnabled();
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
        return { ...room, currentSong: song, queue };
      }

      queue.push(song);
      return { ...room, queue };
    });
    return result.snapshot.val();
  }

  async function claimNextSong(roomId) {
    await assertKaraokeDisplayEnabled();
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
      };
    });
  }

  async function advanceToNextSong(roomId) {
    await assertKaraokeDisplayEnabled();
    return roomRef(roomId).transaction((current) => {
      const room = current || {};
      const queue = normalizeQueue(room.queue);
      if (queue.length === 0) {
        return { ...room, currentSong: null, queue: null };
      }
      const currentSong = queue.shift();
      return {
        ...room,
        currentSong,
        queue: queue.length > 0 ? queue : null,
      };
    });
  }

  async function sendControl(roomId, command, payload = {}) {
    await assertKaraokeDisplayEnabled();
    return roomRef(roomId, "control").update({
      ...payload,
      command,
      timestamp: Date.now(),
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
    DEFAULT_ROOM_VOLUME,
    addSong,
    advanceToNextSong,
    claimNextSong,
    createRoom,
    createRoomRequest,
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
    listenRoomRequest,
    listenRooms,
    listenRoomRequests,
    listenVolume,
    roomRef,
    approveRoomRequest,
    rejectRoomRequest,
    setRoomVolume,
    setRoomMuted,
    setPlaybackState,
    sendControl,
  };
})(window);
