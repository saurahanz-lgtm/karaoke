(function (global) {
  const ROOM_LIST_PATH = "karaokeRooms";
  const ROOM_DATA_PATH = "karaokeSessions";
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
    const url = new URL("singer.html", global.location.href);
    url.search = new URLSearchParams({ room: roomId }).toString();
    return url.toString();
  }

  function normalizeQueue(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object")
      return Object.values(value).filter(Boolean);
    return [];
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

    const roomsSnapshot = await db.ref(ROOM_LIST_PATH).once("value");
    const rooms = roomsSnapshot.val() || {};
    const activeRef = db.ref(ACTIVE_ROOM_PATH);
    const activeSnapshot = await activeRef.once("value");
    if (!activeSnapshot.val()) {
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
    const roomRef = db.ref(ROOM_LIST_PATH).push();
    const room = {
      id: roomRef.key,
      name: name.trim().slice(0, 40),
      createdAt: Date.now(),
    };

    await db.ref().update({
      [`${ROOM_LIST_PATH}/${room.id}`]: room,
      [`${ROOM_DATA_PATH}/${room.id}`]: {
        queue: null,
        currentSong: null,
        members: null,
      },
    });
    return room;
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
    const requestRef = roomRef(roomId, "roomRequests").push();
    const request = {
      id: requestRef.key,
      username: String(username || "Singer")
        .trim()
        .slice(0, 40),
      roomId: String(roomId || "").slice(0, 128),
      status: "pending",
      createdAt: Date.now(),
    };
    await requestRef.set(request);
    return request;
  }

  function listenRoomRequests(roomId, callback) {
    const ref = roomRef(roomId, "roomRequests");
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests)
          .map(([id, request]) => ({ ...request, id }))
          .filter((request) => request.status === "pending")
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      );
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function resolveRoomRequest(roomId, requestId) {
    return database()
      .ref(`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`)
      .update({ status: "handled", handledAt: Date.now() });
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
    const controlHandler = (snapshot) => {
      const control = snapshot.val();
      if (isInitialControlSnapshot) {
        isInitialControlSnapshot = false;
        return;
      }
      if (control && handlers.onControl) handlers.onControl(control);
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

  function normalizeVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) return DEFAULT_ROOM_VOLUME;
    return Math.max(0, Math.min(100, Math.round(volume)));
  }

  function listenVolume(roomId, callback) {
    const ref = roomRef(roomId, "volume");
    const handler = (snapshot) => {
      callback(
        snapshot.val() === null
          ? DEFAULT_ROOM_VOLUME
          : normalizeVolume(snapshot.val()),
      );
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  function setRoomVolume(roomId, volume) {
    return roomRef(roomId, "volume").set(normalizeVolume(volume));
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

  function sendControl(roomId, command, payload = {}) {
    return roomRef(roomId, "control").set({
      ...payload,
      command,
      timestamp: Date.now(),
    });
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
    getJoinUrl,
    getRoomIdFromUrl,
    joinRoom,
    leaveRoom,
    listenMembers,
    listenRoom,
    listenRooms,
    listenRoomRequests,
    listenVolume,
    roomRef,
    resolveRoomRequest,
    setRoomVolume,
    sendControl,
  };
})(window);
