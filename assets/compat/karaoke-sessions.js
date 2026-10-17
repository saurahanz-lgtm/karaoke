var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
(function(global) {
  var _a;
  const ROOM_LIST_PATH = "karaokeRooms";
  const ROOM_DATA_PATH = "karaokeSessions";
  const ROOM_REQUESTS_PATH = "roomRequests";
  const ACTIVE_ROOM_PATH = "karaokeControl/activeRoomId";
  const ROOM_NAME_COUNTER_PATH = "karaokeControl/nextRoomNameNumber";
  const QUEUE_CLEANUP_SETTING_PATH = "appSettings/queueCleanupMinutes";
  const MAX_DEVICES = 3;
  const MAX_ROOM_DEVICES = 100;
  const DEFAULT_ROOM_VOLUME = 70;
  const MAX_ROOM_TIME_LIMIT_MINUTES = 10080;
  const MEMBER_TIMEOUT_MS = 6e4;
  const DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES = 3;
  const MAX_QUEUE_CLEANUP_DELAY_MINUTES = 1440;
  const HEARTBEAT_INTERVAL_MS = 15e3;
  let queueCleanupDelayMs = DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES * 6e4;
  const DEVICE_ID_STORAGE_KEY = "karaoke_room_tab_device_id";
  const TAB_INSTANCE_ID = ((_a = global.crypto) == null ? void 0 : _a.randomUUID) ? global.crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let heartbeatTimer = null;
  let joinedRoomId = null;
  let joinedMemberRef = null;
  let roomDeviceId = global.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
  let roomDeviceIdPromise = null;
  let activeDeviceIdProbe = null;
  const deviceIdChannel = typeof global.BroadcastChannel === "function" ? new global.BroadcastChannel("karaoke_room_device_identity") : null;
  const roomIdleStateRefreshers = /* @__PURE__ */ new Set();
  deviceIdChannel == null ? void 0 : deviceIdChannel.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.tabInstanceId === TAB_INSTANCE_ID) return;
    if (message.type === "probe" && message.deviceId === roomDeviceId) {
      deviceIdChannel.postMessage({
        type: "claim",
        deviceId: roomDeviceId,
        tabInstanceId: TAB_INSTANCE_ID,
        targetTabInstanceId: message.tabInstanceId
      });
      return;
    }
    if (message.type === "claim" && activeDeviceIdProbe && message.deviceId === activeDeviceIdProbe.deviceId && message.targetTabInstanceId === TAB_INSTANCE_ID) {
      activeDeviceIdProbe.claims.add(message.tabInstanceId);
    }
  });
  function database() {
    if (typeof firebase === "undefined" || !firebase.database) {
      throw new Error("Firebase is unavailable");
    }
    return firebase.database();
  }
  function normalizeQueueCleanupDelayMinutes(value) {
    const minutes = Number(value);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_QUEUE_CLEANUP_DELAY_MINUTES ? minutes : DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES;
  }
  function getQueueCleanupDelayMs() {
    return queueCleanupDelayMs;
  }
  function listenQueueCleanupDelay(callback, onError) {
    const ref = database().ref(QUEUE_CLEANUP_SETTING_PATH);
    const handler = (snapshot) => {
      const savedValue = snapshot.val();
      const minutes = savedValue == null ? DEFAULT_QUEUE_CLEANUP_DELAY_MINUTES : normalizeQueueCleanupDelayMinutes(savedValue);
      queueCleanupDelayMs = minutes * 6e4;
      roomIdleStateRefreshers.forEach((refresh) => refresh());
      callback == null ? void 0 : callback(minutes, savedValue != null);
    };
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }
  function setQueueCleanupDelayMinutes(value) {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_QUEUE_CLEANUP_DELAY_MINUTES) {
      throw new Error("QUEUE_CLEANUP_DELAY_INVALID");
    }
    return database().ref(QUEUE_CLEANUP_SETTING_PATH).set(minutes);
  }
  function isRoomTimeExpired(room, now = Date.now()) {
    return Number(room == null ? void 0 : room.timeLimitMinutes) > 0 && Number(room == null ? void 0 : room.expiresAt) > 0 && now >= Number(room.expiresAt);
  }
  function hasActiveRoomMembers(room, now = Date.now()) {
    const cutoff = now - MEMBER_TIMEOUT_MS;
    return Object.values((room == null ? void 0 : room.members) || {}).some(
      (member) => member && Number(member.lastSeen) >= cutoff
    );
  }
  function getRoomActivityFields(room, timestamp = Date.now()) {
    return __spreadValues({
      lastActivityAt: timestamp
    }, hasActiveRoomMembers(room, timestamp) ? { emptySince: null } : {});
  }
  function throwIfRoomTimeExpired(room) {
    if (!isRoomTimeExpired(room)) return;
    const error = new Error("ROOM_TIME_EXPIRED");
    error.expiresAt = Number(room.expiresAt);
    throw error;
  }
  function getRoomIdleState(room, now = Date.now()) {
    var _a2;
    const queue = normalizeQueue(room == null ? void 0 : room.queue);
    const hasSongs = queue.some(Boolean) || Boolean((_a2 = room == null ? void 0 : room.currentSong) == null ? void 0 : _a2.videoId);
    const inUse = hasActiveRoomMembers(room, now);
    const emptySince = Number(room == null ? void 0 : room.emptySince) || 0;
    return {
      hasSongs,
      inUse,
      emptySince: emptySince || null,
      expiresAt: hasSongs && !inUse && emptySince ? emptySince + queueCleanupDelayMs : null,
      shouldStartTimer: hasSongs && !inUse && !emptySince
    };
  }
  function normalizeRoomTimeLimit(minutes) {
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 0 || duration > MAX_ROOM_TIME_LIMIT_MINUTES) {
      throw new Error("ROOM_TIME_LIMIT_INVALID");
    }
    return duration;
  }
  function getRoomDeviceLimit(room) {
    const limit = Number(room == null ? void 0 : room.maxDevices);
    return Number.isInteger(limit) && limit >= 1 && limit <= MAX_ROOM_DEVICES ? limit : MAX_DEVICES;
  }
  function normalizeRoomDeviceLimit(devices) {
    const limit = Number(devices);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROOM_DEVICES) {
      throw new Error("ROOM_DEVICE_LIMIT_INVALID");
    }
    return limit;
  }
  function assertKaraokeDisplayEnabled(roomId) {
    return __async(this, null, function* () {
      const snapshot = yield database().ref("tvControl").once("value");
      const settings = snapshot.val() || {};
      if (settings.enabled === false) {
        const error = new Error("KARAOKE_DISPLAY_DISABLED");
        error.announcement = settings.announcement || "The karaoke display is temporarily unavailable. Please check back soon.";
        throw error;
      }
      if (roomId) {
        const roomSnapshot = yield database().ref(`${ROOM_LIST_PATH}/${roomId}`).once("value");
        if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
        throwIfRoomTimeExpired(roomSnapshot.val());
        const roomSettingsSnapshot = yield roomRef(roomId, "displayControl").once(
          "value"
        );
        const roomSettings = roomSettingsSnapshot.val() || {};
        if (roomSettings.enabled === false) {
          const error = new Error("KARAOKE_DISPLAY_DISABLED");
          error.announcement = roomSettings.announcement || "The karaoke display in this room is temporarily unavailable.";
          throw error;
        }
      }
    });
  }
  function createDeviceId() {
    var _a2;
    return ((_a2 = global.crypto) == null ? void 0 : _a2.randomUUID) ? global.crypto.randomUUID() : `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function getDeviceId() {
    return __async(this, null, function* () {
      if (!roomDeviceIdPromise) {
        roomDeviceIdPromise = (() => __async(null, null, function* () {
          roomDeviceId = global.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY) || createDeviceId();
          if (deviceIdChannel) {
            const claims = /* @__PURE__ */ new Set();
            activeDeviceIdProbe = { deviceId: roomDeviceId, claims };
            deviceIdChannel.postMessage({
              type: "probe",
              deviceId: roomDeviceId,
              tabInstanceId: TAB_INSTANCE_ID
            });
            yield new Promise((resolve) => global.setTimeout(resolve, 120));
            activeDeviceIdProbe = null;
            if (claims.size > 0) roomDeviceId = createDeviceId();
          }
          global.sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, roomDeviceId);
          return roomDeviceId;
        }))();
      }
      return roomDeviceIdPromise;
    });
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
    var _a2;
    const randomValues = new Uint16Array(1);
    if ((_a2 = global.crypto) == null ? void 0 : _a2.getRandomValues) {
      global.crypto.getRandomValues(randomValues);
    } else {
      randomValues[0] = Math.floor(Math.random() * 1e4);
    }
    return `sd${String(randomValues[0] % 1e4).padStart(4, "0")}`;
  }
  function normalizeQueue(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object")
      return Object.values(value).filter(Boolean);
    return [];
  }
  function migrateLegacyRoomIds(db) {
    return __async(this, null, function* () {
      const roomsSnapshot = yield db.ref(ROOM_LIST_PATH).once("value");
      const rooms = roomsSnapshot.val() || {};
      for (const [legacyId, room] of Object.entries(rooms)) {
        if (legacyId === "main" || /^[A-Za-z0-9]{6}$/.test(legacyId)) continue;
        const legacyRoomRef = db.ref(`${ROOM_LIST_PATH}/${legacyId}`);
        const claim = yield legacyRoomRef.transaction(
          (current) => current && !current.migrationInProgress ? __spreadProps(__spreadValues({}, current), { migrationInProgress: true }) : void 0
        );
        if (!claim.committed) continue;
        let newRoomRef = null;
        let migrationCommitted = false;
        try {
          const [sessionSnapshot, membersSnapshot] = yield Promise.all([
            db.ref(`${ROOM_DATA_PATH}/${legacyId}`).once("value"),
            db.ref(`${ROOM_DATA_PATH}/${legacyId}/members`).once("value")
          ]);
          const activeCutoff = Date.now() - MEMBER_TIMEOUT_MS;
          const hasActiveMembers = Object.values(
            membersSnapshot.val() || {}
          ).some((member) => member && Number(member.lastSeen) >= activeCutoff);
          if (hasActiveMembers) {
            yield legacyRoomRef.transaction(
              (current) => (current == null ? void 0 : current.migrationInProgress) ? room : void 0
            );
            continue;
          }
          let newRoom = null;
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const roomId = generateRoomId();
            newRoom = __spreadProps(__spreadValues({}, room), { id: roomId });
            delete newRoom.migrationInProgress;
            newRoomRef = db.ref(`${ROOM_LIST_PATH}/${roomId}`);
            const reservation = yield newRoomRef.transaction(
              (current) => current ? void 0 : newRoom
            );
            if (reservation.committed) break;
            newRoom = null;
            newRoomRef = null;
          }
          if (!newRoom || !newRoomRef) {
            throw new Error("ROOM_ID_GENERATION_FAILED");
          }
          yield db.ref().update({
            [`${ROOM_LIST_PATH}/${newRoom.id}`]: newRoom,
            [`${ROOM_DATA_PATH}/${newRoom.id}`]: sessionSnapshot.val(),
            [`${ROOM_LIST_PATH}/${legacyId}`]: null,
            [`${ROOM_DATA_PATH}/${legacyId}`]: null
          });
          migrationCommitted = true;
          yield db.ref(ACTIVE_ROOM_PATH).transaction(
            (current) => current === legacyId ? newRoom.id : current
          );
        } catch (error) {
          if (!migrationCommitted) {
            if (newRoomRef) yield newRoomRef.remove();
            yield legacyRoomRef.transaction(
              (current) => (current == null ? void 0 : current.migrationInProgress) ? room : void 0
            );
          }
          throw error;
        }
      }
    });
  }
  function ensureDefaultRoom() {
    return __async(this, null, function* () {
      const db = database();
      const defaultRoomRef = db.ref(`${ROOM_LIST_PATH}/main`);
      const roomSnapshot = yield defaultRoomRef.once("value");
      if (!roomSnapshot.exists()) {
        const [queueSnapshot, songSnapshot] = yield Promise.all([
          db.ref("queue").once("value"),
          db.ref("currentSong").once("value")
        ]);
        const legacyQueue = normalizeQueue(queueSnapshot.val());
        const legacySong = songSnapshot.val();
        if (legacySong == null ? void 0 : legacySong.videoId) {
          const currentIndex = legacyQueue.findIndex(
            (song) => legacySong.id && song.id === legacySong.id || song.videoId === legacySong.videoId
          );
          if (currentIndex !== -1) legacyQueue.splice(currentIndex, 1);
        }
        const roomData = {
          id: "main",
          name: "Main Room",
          createdAt: Date.now()
        };
        yield defaultRoomRef.transaction((current) => current || roomData);
        yield db.ref(`${ROOM_DATA_PATH}/main`).transaction(
          (current) => current || {
            queue: legacyQueue,
            currentSong: legacySong || null,
            members: null
          }
        );
      }
      yield migrateLegacyRoomIds(db);
      const activeRef = db.ref(ACTIVE_ROOM_PATH);
      const [roomsSnapshot, activeSnapshot] = yield Promise.all([
        db.ref(ROOM_LIST_PATH).once("value"),
        activeRef.once("value")
      ]);
      const rooms = roomsSnapshot.val() || {};
      const activeRoomId = activeSnapshot.val();
      if (!rooms[activeRoomId]) {
        const firstRoomId = Object.keys(rooms)[0] || "main";
        yield activeRef.set(firstRoomId);
        return firstRoomId;
      }
      return activeRoomId;
    });
  }
  function listenRooms(callback, onError) {
    const ref = database().ref(ROOM_LIST_PATH);
    const handler = (snapshot) => {
      const rooms = snapshot.val() || {};
      callback(
        Object.entries(rooms).map(([id, room]) => __spreadProps(__spreadValues({}, room), { id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      );
    };
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }
  function listenRoomAvailability(roomId, callback, onError) {
    const ref = database().ref(`${ROOM_DATA_PATH}/${roomId}/members`);
    let members = {};
    let hasSnapshot = false;
    const updateAvailability = () => {
      if (!hasSnapshot) return;
      const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
      const occupied = Object.values(members).some(
        (member) => member && Number(member.lastSeen) >= cutoff
      );
      callback(!occupied);
    };
    const handler = (snapshot) => {
      members = snapshot.val() || {};
      hasSnapshot = true;
      updateAvailability();
    };
    const errorHandler = (error) => {
      hasSnapshot = false;
      onError == null ? void 0 : onError(error);
    };
    ref.on("value", handler, errorHandler);
    const refreshTimer = global.setInterval(
      updateAvailability,
      HEARTBEAT_INTERVAL_MS
    );
    return () => {
      ref.off("value", handler);
      global.clearInterval(refreshTimer);
    };
  }
  function listenRoomUsage(roomId, callback, onError) {
    const ref = database().ref(`${ROOM_LIST_PATH}/${roomId}`);
    const handler = (snapshot) => callback(snapshot.val() || {});
    ref.on("value", handler, onError);
    return () => ref.off("value", handler);
  }
  function getActiveRoomId() {
    return __async(this, null, function* () {
      const snapshot = yield database().ref(ACTIVE_ROOM_PATH).once("value");
      return snapshot.val();
    });
  }
  function getNumberedRooms(rooms) {
    return Object.entries(rooms || {}).filter(([, room]) => /^SDR\d+$/i.test(String((room == null ? void 0 : room.name) || "").trim())).sort(
      ([firstId, first], [secondId, second]) => (Number(first.createdAt) || 0) - (Number(second.createdAt) || 0) || firstId.localeCompare(secondId)
    );
  }
  function createRoom() {
    return __async(this, null, function* () {
      const db = database();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const roomId = generateRoomId();
        let room = null;
        const reservation = yield db.ref(ROOM_LIST_PATH).transaction((current) => {
          const rooms = current || {};
          if (rooms[roomId]) return void 0;
          const numberedRooms = getNumberedRooms(rooms);
          const nextRooms = __spreadValues({}, rooms);
          numberedRooms.forEach(([existingId, existingRoom], index) => {
            nextRooms[existingId] = __spreadProps(__spreadValues({}, existingRoom), {
              name: `SDR${index + 1}`
            });
          });
          room = {
            id: roomId,
            name: `SDR${numberedRooms.length + 1}`,
            createdAt: Date.now(),
            maxDevices: MAX_DEVICES,
            timeLimitMinutes: 0,
            usageStartedAt: null,
            expiresAt: null
          };
          return __spreadProps(__spreadValues({}, nextRooms), { [roomId]: room });
        });
        if (!reservation.committed) continue;
        try {
          yield db.ref(`${ROOM_DATA_PATH}/${roomId}`).set({
            queue: null,
            currentSong: null,
            members: null
          });
          return room;
        } catch (error) {
          yield db.ref(`${ROOM_LIST_PATH}/${roomId}`).remove();
          throw error;
        }
      }
      throw new Error("ROOM_ID_GENERATION_FAILED");
    });
  }
  function setRoomTimeLimit(roomId, durationMinutes) {
    return __async(this, null, function* () {
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const minutes = normalizeRoomTimeLimit(durationMinutes);
      const activeMemberCount = minutes ? yield getActiveMemberCount(roomId) : 0;
      const now = Date.now();
      const result = yield database().ref(`${ROOM_LIST_PATH}/${roomId}`).transaction((room) => {
        if (!room) return void 0;
        if (minutes === 0) {
          return __spreadProps(__spreadValues({}, room), {
            timeLimitMinutes: 0,
            usageStartedAt: null,
            expiresAt: null
          });
        }
        const existingExpiry = Number(room.expiresAt);
        const existingStart = Number(room.usageStartedAt);
        const startedAt = existingStart > 0 && existingExpiry > now ? existingStart : activeMemberCount > 0 ? now : null;
        return __spreadProps(__spreadValues({}, room), {
          timeLimitMinutes: minutes,
          usageStartedAt: startedAt,
          expiresAt: startedAt ? startedAt + minutes * 6e4 : null
        });
      });
      if (!result.committed) throw new Error("ROOM_NOT_FOUND");
      return result.snapshot.val();
    });
  }
  function setRoomDeviceLimit(roomId, deviceLimit) {
    return __async(this, null, function* () {
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const limit = normalizeRoomDeviceLimit(deviceLimit);
      const result = yield database().ref(`${ROOM_LIST_PATH}/${roomId}`).transaction(
        (room) => room ? __spreadProps(__spreadValues({}, room), { maxDevices: limit }) : void 0
      );
      if (!result.committed) throw new Error("ROOM_NOT_FOUND");
      return result.snapshot.val();
    });
  }
  function renameRoom(roomId, name) {
    return __async(this, null, function* () {
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const roomName = String(name || "").trim().slice(0, 40);
      if (!roomName) throw new Error("ROOM_NAME_REQUIRED");
      const result = yield database().ref(`${ROOM_LIST_PATH}/${roomId}`).transaction((room) => room ? __spreadProps(__spreadValues({}, room), { name: roomName }) : void 0);
      if (!result.committed) throw new Error("ROOM_NOT_FOUND");
      return __spreadProps(__spreadValues({}, result.snapshot.val()), { id: roomId });
    });
  }
  function deleteRoom(roomId) {
    return __async(this, null, function* () {
      if (!roomId || roomId === "main") {
        throw new Error("DEFAULT_ROOM_PROTECTED");
      }
      const db = database();
      const [roomSnapshot, roomsSnapshot, activeSnapshot, membersSnapshot] = yield Promise.all([
        db.ref(`${ROOM_LIST_PATH}/${roomId}`).once("value"),
        db.ref(ROOM_LIST_PATH).once("value"),
        db.ref(ACTIVE_ROOM_PATH).once("value"),
        db.ref(`${ROOM_DATA_PATH}/${roomId}/members`).once("value")
      ]);
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      const activeCutoff = Date.now() - MEMBER_TIMEOUT_MS;
      const hasActiveMembers = Object.values(membersSnapshot.val() || {}).some(
        (member) => member && Number(member.lastSeen) >= activeCutoff
      );
      if (hasActiveMembers) throw new Error("ROOM_HAS_ACTIVE_DEVICES");
      const remainingRooms = roomsSnapshot.val() || {};
      delete remainingRooms[roomId];
      const nextRoomId = Object.keys(remainingRooms)[0] || "main";
      const updates = {
        [`${ROOM_LIST_PATH}/${roomId}`]: null,
        [`${ROOM_DATA_PATH}/${roomId}`]: null,
        [ROOM_NAME_COUNTER_PATH]: null
      };
      getNumberedRooms(remainingRooms).forEach(
        ([remainingRoomId, room], index) => {
          updates[`${ROOM_LIST_PATH}/${remainingRoomId}/name`] = `SDR${index + 1}`;
        }
      );
      if (activeSnapshot.val() === roomId) {
        updates[ACTIVE_ROOM_PATH] = nextRoomId;
      }
      yield db.ref().update(updates);
      return roomId;
    });
  }
  function createRoomRequest(username, roomId) {
    return __async(this, null, function* () {
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const db = database();
      const requestRef = roomRef(roomId, "roomRequests").push();
      const request = {
        id: requestRef.key,
        username: String(username || "Performer").trim().slice(0, 40),
        roomId: String(roomId || "").slice(0, 128),
        status: "pending",
        createdAt: Date.now()
      };
      yield db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${request.id}`]: request,
        [`${ROOM_REQUESTS_PATH}/${request.id}`]: request
      });
      return request;
    });
  }
  function createRoomExtensionRequest(username, roomId, requestedMinutes) {
    return __async(this, null, function* () {
      var _a2;
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const minutes = normalizeRoomTimeLimit(requestedMinutes);
      if (minutes === 0) throw new Error("ROOM_EXTENSION_DURATION_REQUIRED");
      const db = database();
      const roomSnapshot = yield db.ref(`${ROOM_LIST_PATH}/${roomId}`).once("value");
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      if (!(Number((_a2 = roomSnapshot.val()) == null ? void 0 : _a2.timeLimitMinutes) > 0)) {
        throw new Error("ROOM_TIME_LIMIT_NOT_SET");
      }
      const requestRef = roomRef(roomId, "roomRequests").push();
      const request = {
        id: requestRef.key,
        type: "extension",
        username: String(username || "Performer").trim().slice(0, 40),
        roomId: String(roomId).slice(0, 128),
        requestedMinutes: minutes,
        status: "pending",
        createdAt: Date.now()
      };
      yield db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${request.id}`]: request,
        [`${ROOM_REQUESTS_PATH}/${request.id}`]: request
      });
      return request;
    });
  }
  function listenRoomRequests(roomId, callback) {
    const ref = roomRef(roomId, "roomRequests");
    const handler = (snapshot) => {
      const requests = snapshot.val() || {};
      callback(
        Object.entries(requests).map(([id, request]) => __spreadProps(__spreadValues({}, request), { id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
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
        Object.entries(requests).map(([id, request]) => __spreadProps(__spreadValues({}, request), { id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
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
      announcement: enabled ? null : announcement || null
    });
  }
  function setRoomPerformerAvailability(roomId, enabled) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    return roomRef(roomId, "displayControl").update(__spreadValues({
      performerEnabled: Boolean(enabled)
    }, enabled ? {} : { performerScreenActive: false }));
  }
  function setRoomPerformerScreenActive(roomId, active) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    return roomRef(roomId, "displayControl").update({
      performerScreenActive: Boolean(active)
    });
  }
  function approveRoomRequest(roomId, requestId) {
    return __async(this, null, function* () {
      const db = database();
      const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
      const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
      const claim = yield requestRef.transaction(
        (request) => (request == null ? void 0 : request.status) === "pending" ? __spreadProps(__spreadValues({}, request), { status: "approving" }) : void 0
      );
      if (!claim.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");
      let room = null;
      try {
        room = yield createRoom();
        const handledAt = Date.now();
        const nextStatus = {
          status: "approved",
          approvedRoomId: room.id,
          handledAt
        };
        yield db.ref().update({
          [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: __spreadValues(__spreadValues({}, claim.snapshot.val() || {}), nextStatus),
          [`${ROOM_REQUESTS_PATH}/${requestId}`]: __spreadValues(__spreadProps(__spreadValues({}, (yield globalRequestRef.once("value")).val() || {}), {
            roomId
          }), nextStatus)
        });
        return room;
      } catch (error) {
        if (room) {
          try {
            yield deleteRoom(room.id);
          } catch (cleanupError) {
            console.error("Could not clean up unassigned room:", cleanupError);
          }
        }
        try {
          yield requestRef.transaction(
            (request) => (request == null ? void 0 : request.status) === "approving" ? __spreadProps(__spreadValues({}, request), { status: "pending" }) : void 0
          );
        } catch (rollbackError) {
          console.error("Could not restore pending room request:", rollbackError);
        }
        throw error;
      }
    });
  }
  function approveRoomExtension(roomId, requestId) {
    return __async(this, null, function* () {
      const db = database();
      const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
      const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
      const claim = yield requestRef.transaction(
        (request2) => (request2 == null ? void 0 : request2.type) === "extension" && request2.status === "pending" ? __spreadProps(__spreadValues({}, request2), { status: "approving" }) : void 0
      );
      if (!claim.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");
      const request = claim.snapshot.val();
      let roomUpdated = false;
      try {
        const extraMinutes = normalizeRoomTimeLimit(request.requestedMinutes);
        if (extraMinutes === 0)
          throw new Error("ROOM_EXTENSION_DURATION_REQUIRED");
        const roomResult = yield db.ref(`${ROOM_LIST_PATH}/${roomId}`).transaction((room) => {
          if (!room) return void 0;
          const now = Date.now();
          const currentExpiry = Number(room.expiresAt);
          const isStillRunning = currentExpiry > now;
          const baseExpiry = isStillRunning ? currentExpiry : now;
          const startedAt = isStillRunning && Number(room.usageStartedAt) > 0 ? Number(room.usageStartedAt) : now;
          return __spreadProps(__spreadValues({}, room), {
            timeLimitMinutes: isStillRunning ? Number(room.timeLimitMinutes || 0) + extraMinutes : extraMinutes,
            usageStartedAt: startedAt,
            expiresAt: baseExpiry + extraMinutes * 6e4
          });
        });
        if (!roomResult.committed) throw new Error("ROOM_NOT_FOUND");
        roomUpdated = true;
        const handledAt = Date.now();
        const approved = {
          status: "approved",
          handledAt,
          approvedMinutes: extraMinutes,
          approvedExpiresAt: roomResult.snapshot.val().expiresAt
        };
        yield db.ref().update({
          [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: __spreadValues(__spreadValues({}, request), approved),
          [`${ROOM_REQUESTS_PATH}/${requestId}`]: __spreadValues(__spreadProps(__spreadValues(__spreadValues({}, (yield globalRequestRef.once("value")).val() || {}), request), {
            roomId
          }), approved)
        });
        return roomResult.snapshot.val();
      } catch (error) {
        if (!roomUpdated) {
          try {
            yield requestRef.transaction(
              (current) => (current == null ? void 0 : current.status) === "approving" ? __spreadProps(__spreadValues({}, current), { status: "pending" }) : void 0
            );
          } catch (rollbackError) {
            console.error(
              "Could not restore pending extension request:",
              rollbackError
            );
          }
        }
        throw error;
      }
    });
  }
  function rejectRoomRequest(roomId, requestId) {
    const db = database();
    const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
    const globalRequestRef = db.ref(`${ROOM_REQUESTS_PATH}/${requestId}`);
    return requestRef.transaction(
      (request) => (request == null ? void 0 : request.status) === "pending" ? __spreadProps(__spreadValues({}, request), { status: "rejected", handledAt: Date.now() }) : void 0
    ).then((result) => __async(null, null, function* () {
      if (!result.committed) throw new Error("ROOM_REQUEST_ALREADY_RESOLVED");
      const request = result.snapshot.val();
      const nextRequest = __spreadProps(__spreadValues({}, request || {}), { roomId, status: "rejected" });
      yield db.ref().update({
        [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: nextRequest,
        [`${ROOM_REQUESTS_PATH}/${requestId}`]: __spreadValues(__spreadValues({}, (yield globalRequestRef.once("value")).val() || {}), nextRequest)
      });
    }));
  }
  function deleteRoomRequest(roomId, requestId) {
    return __async(this, null, function* () {
      if (!roomId || !requestId) throw new Error("ROOM_REQUEST_REQUIRED");
      const db = database();
      const requestRef = roomRef(roomId, `roomRequests/${requestId}`);
      const claim = yield requestRef.transaction(
        (request) => ["approved", "rejected"].includes(request == null ? void 0 : request.status) ? __spreadProps(__spreadValues({}, request), { status: "deleting" }) : void 0
      );
      if (!claim.committed) throw new Error("ROOM_REQUEST_NOT_DELETABLE");
      try {
        yield db.ref().update({
          [`${ROOM_DATA_PATH}/${roomId}/roomRequests/${requestId}`]: null,
          [`${ROOM_REQUESTS_PATH}/${requestId}`]: null
        });
      } catch (error) {
        try {
          yield requestRef.set(claim.snapshot.val());
        } catch (rollbackError) {
          console.error("Could not restore room request:", rollbackError);
        }
        throw error;
      }
    });
  }
  function listenRoom(roomId, handlers, onError) {
    const roomRef2 = database().ref(`${ROOM_DATA_PATH}/${roomId}`);
    const queueRef = roomRef2.child("queue");
    const songRef = roomRef2.child("currentSong");
    const controlRef = roomRef2.child("control");
    const roomHandler = (snapshot) => {
      var _a2;
      (_a2 = handlers.onRoom) == null ? void 0 : _a2.call(handlers, {
        queue: normalizeQueue(snapshot.child("queue").val()),
        currentSong: snapshot.child("currentSong").val()
      });
    };
    const queueHandler = (snapshot) => {
      var _a2;
      return (_a2 = handlers.onQueue) == null ? void 0 : _a2.call(handlers, normalizeQueue(snapshot.val()));
    };
    const songHandler = (snapshot) => {
      var _a2;
      return (_a2 = handlers.onCurrentSong) == null ? void 0 : _a2.call(handlers, snapshot.val());
    };
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
      if ((control == null ? void 0 : control.command) && handlers.onControl && eventId !== lastControlEventId) {
        lastControlEventId = eventId;
        handlers.onControl(control);
      }
    };
    roomRef2.on("value", roomHandler, onError);
    queueRef.on("value", queueHandler, onError);
    songRef.on("value", songHandler, onError);
    controlRef.on("value", controlHandler, onError);
    return () => {
      roomRef2.off("value", roomHandler);
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
    roomIdleStateRefreshers.add(updateState);
    const handler = (snapshot) => {
      room = snapshot.val();
      updateState();
    };
    ref.on("value", handler, onError);
    const refreshTimer = global.setInterval(updateState, HEARTBEAT_INTERVAL_MS);
    return () => {
      ref.off("value", handler);
      global.clearInterval(refreshTimer);
      roomIdleStateRefreshers.delete(updateState);
    };
  }
  function listenMembers(roomId, callback) {
    const ref = database().ref(`${ROOM_DATA_PATH}/${roomId}/members`);
    let members = {};
    let roomWasOccupied = false;
    let hasSnapshot = false;
    let hasTrackedOccupancy = false;
    const trackedUsageUsers = /* @__PURE__ */ new Set();
    const updateCount = () => {
      if (!hasSnapshot) return;
      const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
      const activeMembers = Object.entries(members).filter(([, member]) => member && Number(member.lastSeen) >= cutoff).map(([id, member]) => ({
        id,
        username: String(member.username || "Performer")
      }));
      const roomIsOccupied = activeMembers.length > 0;
      const newUsageUser = activeMembers.some(
        (member) => !trackedUsageUsers.has(member.username)
      );
      if (!hasTrackedOccupancy || roomIsOccupied !== roomWasOccupied || newUsageUser) {
        syncRoomActiveSince(roomId, roomIsOccupied, activeMembers).catch(
          (error) => {
            console.warn("Could not update room usage start:", error.message);
          }
        );
      }
      if (roomIsOccupied) {
        activeMembers.forEach(
          (member) => trackedUsageUsers.add(member.username)
        );
      } else {
        trackedUsageUsers.clear();
      }
      if (roomIsOccupied && !roomWasOccupied) {
        roomWasOccupied = true;
        startRoomUsage(roomId).catch((error) => {
          roomWasOccupied = false;
          console.warn("Could not start room time limit:", error.message);
        });
      } else if (!roomIsOccupied) {
        roomWasOccupied = false;
      }
      hasTrackedOccupancy = true;
      callback(
        activeMembers.length,
        activeMembers.map((member) => member.id),
        activeMembers
      );
    };
    const handler = (snapshot) => {
      members = snapshot.val() || {};
      hasSnapshot = true;
      updateCount();
    };
    ref.on("value", handler);
    const refreshTimer = global.setInterval(updateCount, HEARTBEAT_INTERVAL_MS);
    return () => {
      ref.off("value", handler);
      global.clearInterval(refreshTimer);
    };
  }
  function getActiveMemberCount(roomId) {
    return __async(this, null, function* () {
      const snapshot = yield database().ref(`${ROOM_DATA_PATH}/${roomId}/members`).once("value");
      const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
      return Object.values(snapshot.val() || {}).filter(
        (member) => member && Number(member.lastSeen) >= cutoff
      ).length;
    });
  }
  function startRoomUsage(roomId) {
    return __async(this, null, function* () {
      const now = Date.now();
      return database().ref(`${ROOM_LIST_PATH}/${roomId}`).transaction((room) => {
        const duration = Number(room == null ? void 0 : room.timeLimitMinutes);
        if (!room || !Number.isFinite(duration) || duration <= 0 || Number(room.expiresAt) > 0) {
          return void 0;
        }
        return __spreadProps(__spreadValues({}, room), {
          usageStartedAt: now,
          expiresAt: now + duration * 6e4
        });
      });
    });
  }
  function syncRoomActiveSince(roomId, isOccupied, activeMembers = []) {
    const now = Date.now();
    const db = database();
    const roomRef2 = db.ref(`${ROOM_LIST_PATH}/${roomId}`);
    const historyRef = db.ref("roomUsageHistory").push();
    const activeUsernames = [
      ...new Set(
        activeMembers.map((member) => String(member.username || "Performer").trim()).filter(Boolean)
      )
    ];
    let historyRecord = null;
    return roomRef2.transaction((room) => {
      if (!room) return void 0;
      const activeSince = Number(room.activeSince) || 0;
      const previousUsers = Array.isArray(room.activeUsers) ? room.activeUsers : [];
      if (isOccupied) {
        const activeUsers = [
          .../* @__PURE__ */ new Set([...previousUsers, ...activeUsernames])
        ];
        if (activeSince > 0 && activeUsers.length === previousUsers.length) {
          return void 0;
        }
        return __spreadProps(__spreadValues({}, room), {
          activeSince: activeSince || now,
          activeUsers
        });
      }
      if (activeSince <= 0) {
        return previousUsers.length ? __spreadProps(__spreadValues({}, room), { activeUsers: null }) : void 0;
      }
      historyRecord = {
        roomId,
        roomName: room.name || roomId,
        users: previousUsers,
        startedAt: activeSince,
        endedAt: now,
        durationMs: Math.max(0, now - activeSince)
      };
      return __spreadProps(__spreadValues({}, room), {
        activeSince: null,
        activeUsers: null,
        lastUsageHistoryId: historyRef.key
      });
    }).then((result) => __async(null, null, function* () {
      const room = result.snapshot.val();
      if (result.committed && historyRecord && (room == null ? void 0 : room.lastUsageHistoryId) === historyRef.key) {
        yield historyRef.set(__spreadProps(__spreadValues({}, historyRecord), { id: historyRef.key }));
      }
      return result;
    }));
  }
  function markRoomEmptySince(roomId, emptySince) {
    return __async(this, null, function* () {
      var _a2;
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const requestedTimestamp = Number(emptySince);
      const suppliedTimestamp = Number.isFinite(requestedTimestamp) && requestedTimestamp > 0 ? requestedTimestamp : null;
      const now = Date.now();
      const result = yield roomRef(roomId).transaction((room) => {
        if (!room) return void 0;
        if (hasActiveRoomMembers(room, now)) {
          return Number(room.emptySince) > 0 ? __spreadProps(__spreadValues({}, room), { emptySince: null }) : void 0;
        }
        if (!room.queue && !room.currentSong) {
          return Number(room.emptySince) > 0 ? __spreadProps(__spreadValues({}, room), { emptySince: null }) : void 0;
        }
        const existingEmptySince = Number(room.emptySince) || 0;
        const timestamp = existingEmptySince || suppliedTimestamp || now;
        return timestamp === existingEmptySince ? void 0 : __spreadProps(__spreadValues({}, room), { emptySince: timestamp });
      });
      return Number((_a2 = result.snapshot.val()) == null ? void 0 : _a2.emptySince) || null;
    });
  }
  function clearRoomEmptySince(roomId) {
    return __async(this, null, function* () {
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const result = yield roomRef(roomId, "emptySince").transaction(
        (current) => Number(current) > 0 ? null : void 0
      );
      return result.committed;
    });
  }
  function clearRoomSongsIfUnoccupied(roomId) {
    return __async(this, null, function* () {
      var _a2, _b;
      if (!roomId) throw new Error("ROOM_REQUIRED");
      const now = Date.now();
      const sessionRef = roomRef(roomId);
      const beforeSnapshot = yield sessionRef.once("value");
      const hadSongs = Boolean(
        ((_a2 = beforeSnapshot.val()) == null ? void 0 : _a2.queue) || ((_b = beforeSnapshot.val()) == null ? void 0 : _b.currentSong)
      );
      const result = yield sessionRef.transaction((room2) => {
        if (!room2) return void 0;
        if (hasActiveRoomMembers(room2, now)) {
          return Number(room2.emptySince) > 0 ? __spreadProps(__spreadValues({}, room2), { emptySince: null }) : void 0;
        }
        if (!room2.queue && !room2.currentSong) {
          return __spreadProps(__spreadValues({}, room2), { emptySince: null });
        }
        const emptySince = Number(room2.emptySince) || 0;
        const idleSince = emptySince || now;
        if (now - idleSince < queueCleanupDelayMs) {
          return idleSince === emptySince ? void 0 : __spreadProps(__spreadValues({}, room2), { emptySince: idleSince });
        }
        return __spreadProps(__spreadValues({}, room2), { queue: null, currentSong: null, emptySince: null });
      });
      const room = result.snapshot.val();
      return Boolean(
        hadSongs && result.committed && !(room == null ? void 0 : room.queue) && !(room == null ? void 0 : room.currentSong)
      );
    });
  }
  function normalizeVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) return DEFAULT_ROOM_VOLUME;
    return Math.max(0, Math.min(100, Math.round(volume)));
  }
  function listenVolume(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => {
      var _a2;
      callback(normalizeVolume((_a2 = snapshot.val()) == null ? void 0 : _a2.volume));
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }
  function listenMuted(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => {
      var _a2;
      return callback(Boolean((_a2 = snapshot.val()) == null ? void 0 : _a2.muted));
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }
  function listenPlaybackState(roomId, callback) {
    const ref = roomRef(roomId, "control");
    const handler = (snapshot) => {
      const control = snapshot.val() || {};
      callback(Boolean(control.playing), control);
    };
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }
  function touchRoomActivity(roomId) {
    if (!roomId) throw new Error("ROOM_REQUIRED");
    const timestamp = Date.now();
    return roomRef(roomId).transaction((room) => {
      if (!room || !hasActiveRoomMembers(room, timestamp)) return void 0;
      return __spreadValues(__spreadValues({}, room), getRoomActivityFields(room, timestamp));
    });
  }
  function setPlaybackState(roomId, playing, videoId = null, positionSeconds = 0) {
    return __async(this, null, function* () {
      yield assertKaraokeDisplayEnabled(roomId);
      yield touchRoomActivity(roomId);
      return roomRef(roomId, "control").update({
        playing: Boolean(playing),
        playbackVideoId: videoId || null,
        playbackPositionSeconds: Math.max(0, Number(positionSeconds) || 0),
        playbackPositionUpdatedAt: Date.now()
      });
    });
  }
  function setPlaybackPosition(roomId, videoId, positionSeconds) {
    if (!roomId || !videoId) {
      return Promise.reject(new Error("PLAYBACK_SYNC_REQUIRED"));
    }
    return roomRef(roomId, "control").update({
      playing: true,
      playbackVideoId: videoId,
      playbackPositionSeconds: Math.max(0, Number(positionSeconds) || 0),
      playbackPositionUpdatedAt: Date.now()
    });
  }
  function setRoomVolume(roomId, volume) {
    return sendControl(roomId, "setVolume", {
      volume: normalizeVolume(volume)
    });
  }
  function setRoomMuted(roomId, muted) {
    return sendControl(roomId, "setMuted", { muted: Boolean(muted) });
  }
  function joinRoom(roomId, username) {
    return __async(this, null, function* () {
      const db = database();
      const roomSnapshot = yield db.ref(`${ROOM_LIST_PATH}/${roomId}`).once("value");
      if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
      throwIfRoomTimeExpired(roomSnapshot.val());
      const deviceId = yield getDeviceId();
      const maxDevices = getRoomDeviceLimit(roomSnapshot.val());
      const memberRef = db.ref(`${ROOM_DATA_PATH}/${roomId}/members/${deviceId}`);
      yield memberRef.onDisconnect().remove();
      const result = yield db.ref(`${ROOM_DATA_PATH}/${roomId}/members`).transaction((current) => {
        var _a2;
        const now = Date.now();
        const activeMembers = {};
        Object.entries(current || {}).forEach(([id, member2]) => {
          if (member2 && Number(member2.lastSeen) >= now - MEMBER_TIMEOUT_MS) {
            activeMembers[id] = member2;
          }
        });
        if (!activeMembers[deviceId] && Object.keys(activeMembers).length >= maxDevices) {
          return activeMembers;
        }
        activeMembers[deviceId] = {
          username,
          joinedAt: ((_a2 = activeMembers[deviceId]) == null ? void 0 : _a2.joinedAt) || now,
          lastSeen: now
        };
        return activeMembers;
      });
      const member = result.snapshot.child(deviceId).val();
      if (!member) {
        yield memberRef.onDisconnect().cancel();
        throw new Error("ROOM_FULL");
      }
      clearRoomEmptySince(roomId).catch((error) => {
        console.warn("Could not reset room idle timer:", error.message);
      });
      touchRoomActivity(roomId).catch((error) => {
        console.warn("Could not update room activity:", error.message);
      });
      try {
        yield startRoomUsage(roomId);
        const latestRoomSnapshot = yield db.ref(`${ROOM_LIST_PATH}/${roomId}`).once("value");
        throwIfRoomTimeExpired(latestRoomSnapshot.val());
      } catch (error) {
        yield memberRef.remove();
        yield memberRef.onDisconnect().cancel().catch(() => {
        });
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
        room: __spreadProps(__spreadValues({}, roomSnapshot.val()), { id: roomId }),
        deviceId,
        maxDevices
      };
    });
  }
  function joinRoomWithFallback(roomId, username) {
    return __async(this, null, function* () {
      const roomsSnapshot = yield database().ref(ROOM_LIST_PATH).once("value");
      const rooms = Object.entries(roomsSnapshot.val() || {}).map(
        ([id, room]) => __spreadProps(__spreadValues({}, room), { id })
      );
      const requestedRoomId = roomId || (yield getActiveRoomId());
      const requestedRoom = rooms.find((room) => room.id === requestedRoomId);
      if (roomId && !requestedRoom) throw new Error("ROOM_NOT_FOUND");
      throwIfRoomTimeExpired(requestedRoom);
      const orderedRooms = rooms.filter((room) => !isRoomTimeExpired(room)).sort(
        (first, second) => (first.createdAt || 0) - (second.createdAt || 0)
      );
      if (requestedRoom) {
        orderedRooms.sort((first, second) => {
          if (first.id === requestedRoomId) return -1;
          if (second.id === requestedRoomId) return 1;
          return (first.createdAt || 0) - (second.createdAt || 0);
        });
      }
      for (const room of orderedRooms) {
        try {
          const membership = yield joinRoom(room.id, username);
          return room.id === requestedRoomId ? membership : __spreadProps(__spreadValues({}, membership), {
            requestedRoomId: requestedRoomId || null,
            autoAssigned: Boolean(requestedRoomId)
          });
        } catch (error) {
          if (error.message !== "ROOM_FULL" || roomId) throw error;
        }
      }
      throw new Error("NO_AVAILABLE_ROOMS");
    });
  }
  function leaveRoom(roomId) {
    return __async(this, null, function* () {
      const targetRoomId = roomId || joinedRoomId;
      const deviceId = global.sessionStorage.getItem("karaokeRoomDeviceId");
      if (heartbeatTimer && (!roomId || roomId === joinedRoomId)) {
        global.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (targetRoomId && deviceId) {
        const memberRef = database().ref(
          `${ROOM_DATA_PATH}/${targetRoomId}/members/${deviceId}`
        );
        yield memberRef.onDisconnect().cancel().catch(() => {
        });
        yield memberRef.remove();
      }
      if (!roomId || roomId === joinedRoomId) {
        joinedRoomId = null;
        joinedMemberRef = null;
        global.sessionStorage.removeItem("karaokeRoomId");
      }
    });
  }
  function addSong(roomId, song) {
    return __async(this, null, function* () {
      yield assertKaraokeDisplayEnabled(roomId);
      const result = yield roomRef(roomId).transaction((current) => {
        var _a2, _b;
        const room = current || {};
        const queue = normalizeQueue(room.queue);
        if (((_a2 = room.currentSong) == null ? void 0 : _a2.id) === song.id || queue.some((item) => item.id === song.id)) {
          return void 0;
        }
        if (!((_b = room.currentSong) == null ? void 0 : _b.videoId)) {
          return __spreadValues(__spreadProps(__spreadValues({}, room), {
            currentSong: song,
            queue
          }), getRoomActivityFields(room));
        }
        queue.push(song);
        return __spreadValues(__spreadProps(__spreadValues({}, room), {
          queue
        }), getRoomActivityFields(room));
      });
      return result.snapshot.val();
    });
  }
  function setCurrentSongFromQueue(roomId, song) {
    return roomRef(roomId).transaction((room) => {
      var _a2;
      if (!room || ((_a2 = room.currentSong) == null ? void 0 : _a2.videoId)) return void 0;
      const queuedSong = normalizeQueue(room.queue).find(
        (item) => item.videoId === song.videoId
      );
      if (!queuedSong) return void 0;
      return __spreadValues(__spreadProps(__spreadValues({}, room), {
        currentSong: queuedSong
      }), getRoomActivityFields(room));
    });
  }
  function claimNextSong(roomId) {
    return __async(this, null, function* () {
      yield assertKaraokeDisplayEnabled(roomId);
      return roomRef(roomId).transaction((current) => {
        var _a2;
        const room = current || {};
        if ((_a2 = room.currentSong) == null ? void 0 : _a2.videoId) return void 0;
        const queue = normalizeQueue(room.queue);
        if (queue.length === 0) return void 0;
        const currentSong = queue.shift();
        return __spreadValues(__spreadProps(__spreadValues({}, room), {
          currentSong,
          queue: queue.length > 0 ? queue : null
        }), getRoomActivityFields(room));
      });
    });
  }
  function advanceToNextSong(_0) {
    return __async(this, arguments, function* (roomId, { allowPhoneDisplay = false, expectedSongKey = null } = {}) {
      if (allowPhoneDisplay) {
        if (!roomId) throw new Error("ROOM_REQUIRED");
        const roomSnapshot = yield database().ref(`${ROOM_LIST_PATH}/${roomId}`).once("value");
        if (!roomSnapshot.exists()) throw new Error("ROOM_NOT_FOUND");
        throwIfRoomTimeExpired(roomSnapshot.val());
      } else {
        yield assertKaraokeDisplayEnabled(roomId);
      }
      return roomRef(roomId).transaction((current) => {
        const room = current || {};
        if (expectedSongKey) {
          const currentSong2 = room.currentSong;
          const currentSongKey = (currentSong2 == null ? void 0 : currentSong2.videoId) ? `${currentSong2.videoId}:${currentSong2.id || currentSong2.timestamp || ""}` : null;
          if (currentSongKey !== expectedSongKey) return void 0;
        }
        const queue = normalizeQueue(room.queue);
        if (queue.length === 0) {
          return __spreadValues(__spreadProps(__spreadValues({}, room), {
            currentSong: null,
            queue: null
          }), getRoomActivityFields(room));
        }
        const currentSong = queue.shift();
        return __spreadValues(__spreadProps(__spreadValues({}, room), {
          currentSong,
          queue: queue.length > 0 ? queue : null
        }), getRoomActivityFields(room));
      });
    });
  }
  function sendControl(_0, _1) {
    return __async(this, arguments, function* (roomId, command, payload = {}) {
      yield assertKaraokeDisplayEnabled(roomId);
      const timestamp = Date.now();
      yield roomRef(roomId).transaction((room) => {
        if (!room) return void 0;
        return __spreadValues(__spreadValues({}, room), getRoomActivityFields(room, timestamp));
      });
      return roomRef(roomId, "control").update(__spreadProps(__spreadValues({}, payload), {
        command,
        timestamp,
        eventId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      }));
    });
  }
  function getControlEventId(control) {
    if (!(control == null ? void 0 : control.command)) return null;
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
    listenRoomAvailability,
    listenRoomIdleState,
    listenRoomRequest,
    listenRooms,
    listenRoomUsage,
    listenRoomRequests,
    listenRoomDisplayStatus,
    listenQueueCleanupDelay,
    getQueueCleanupDelayMs,
    setQueueCleanupDelayMinutes,
    listenVolume,
    roomRef,
    renameRoom,
    approveRoomRequest,
    approveRoomExtension,
    rejectRoomRequest,
    setRoomVolume,
    setRoomMuted,
    setRoomDisplayAvailability,
    setRoomPerformerAvailability,
    setRoomPerformerScreenActive,
    setPlaybackState,
    setPlaybackPosition,
    touchRoomActivity,
    setRoomTimeLimit,
    setRoomDeviceLimit,
    getRoomDeviceLimit,
    sendControl,
    setCurrentSongFromQueue
  };
})(window);
