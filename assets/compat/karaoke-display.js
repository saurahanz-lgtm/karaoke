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
const style = document.createElement("style");
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);
let tvQueue = [];
let currentSong = null;
let player = null;
let isPlaying = false;
let youtubeAPIReady = false;
let useFirebase = false;
let firebaseListenersSet = false;
let pendingSongToPlay = null;
let ytReady = window.ytReady === true;
let firebaseReady = false;
let playerReady = false;
let isLoadingSong = false;
let currentVideoId = null;
let isPlayingBootUpVideo = false;
let bootUpVideoPlayed = true;
let bootupStartTime = Date.now();
let bootupHidden = false;
let qrCodeGenerated = false;
let activeKaraokeRoomId = null;
let karaokeRooms = [];
let initialRoomSelectionInProgress = false;
let stopListeningToRoom = null;
let stopListeningToMembers = null;
let stopListeningToRooms = null;
let stopListeningToRoomVolume = null;
let stopListeningToRoomMuted = null;
let stopListeningToRoomDisplayStatus = null;
let stopListeningToRoomUsage = null;
let roomDisplayEnabled = true;
let performerScreenModeActive = false;
let pendingTVPerformerResume = null;
let roomUsageSettings = null;
let roomUsageTimer = null;
let roomTimeExpired = false;
let activeRoomVolume = 70;
let activeRoomMuted = false;
let activeRoomDeviceCount = 0;
let roomPlaybackActivityTimer = null;
let roomPlaybackPositionTimer = null;
const ROOM_PLAYBACK_ACTIVITY_INTERVAL_MS = 15e3;
const ROOM_PLAYBACK_POSITION_SYNC_INTERVAL_MS = 2e3;
const roomSongCleanupTimers = /* @__PURE__ */ new Map();
const roomSongCleanupListeners = /* @__PURE__ */ new Map();
const roomSongCleanupRequests = /* @__PURE__ */ new Set();
let karaokeDisplayEnabled = true;
let tvDisabledAnnouncement = "";
let tvAvailabilityListenerAttached = false;
const KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY = "karaoke_tv_room_request_v1";
let stopListeningToKaraokeDisplayRoomRequest = null;
let activeKaraokeDisplayRoomRequestKey = null;
let tvRoomRequestPollTimer = null;
let currentPerformerName = "";
let songDurationMs = 0;
let microphoneStream = null;
let microphoneAudioContext = null;
let microphoneAnalyser = null;
let microphoneSamples = null;
let pitchDetector = null;
let pitchDetectorPromise = null;
let scoreAudioContext = null;
let scoreAudioBuffer = null;
let scoreAudioLoadPromise = null;
let scoreSoundVolume = 0.8;
let micScoringEnabled = false;
let micScoringDeclined = false;
let micPermissionDenied = false;
let micObservedPlayingMs = 0;
let pitchDetectedMs = 0;
let pitchStableMs = 0;
let previousPitchHz = null;
let lastMicSampleAt = null;
let micSamplingTimer = null;
const MIC_MIN_ACTIVITY_RMS = 0.02;
const PITCH_MIN_FREQUENCY_HZ = 75;
const PITCH_MAX_FREQUENCY_HZ = 1e3;
const PITCH_MIN_CLARITY = 0.85;
const PITCH_STABILITY_TOLERANCE_CENTS = 75;
function loadPitchDetector() {
  if (!pitchDetectorPromise) {
    pitchDetectorPromise = import("https://esm.sh/pitchy@4.1.0").then(
      ({ PitchDetector }) => PitchDetector
    );
  }
  return pitchDetectorPromise;
}
function resetPitchScore() {
  micObservedPlayingMs = 0;
  pitchDetectedMs = 0;
  pitchStableMs = 0;
  previousPitchHz = null;
  lastMicSampleAt = null;
}
function showMicConsentDialog() {
  const dialog = document.getElementById("micConsentDialog");
  if (!dialog) return;
  dialog.addEventListener("cancel", unlockScoreAudio, { once: true });
  dialog.showModal();
}
function unlockScoreAudio() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return Promise.reject(new Error("Web Audio is not supported."));
  }
  if (!scoreAudioContext || scoreAudioContext.state === "closed") {
    scoreAudioContext = new AudioContextConstructor();
  }
  const resumePromise = scoreAudioContext.state === "suspended" ? scoreAudioContext.resume() : Promise.resolve();
  if (!scoreAudioLoadPromise) {
    scoreAudioLoadPromise = fetch("assets/score.mp3").then((response) => {
      if (!response.ok) throw new Error("Score sound could not be loaded.");
      return response.arrayBuffer();
    }).then((audioData) => scoreAudioContext.decodeAudioData(audioData)).then((audioBuffer) => {
      scoreAudioBuffer = audioBuffer;
    }).catch((error) => {
      scoreAudioLoadPromise = null;
      throw error;
    });
  }
  return Promise.all([resumePromise, scoreAudioLoadPromise]);
}
function declineMicScoring() {
  var _a;
  micScoringDeclined = true;
  unlockScoreAudio().catch(
    (error) => console.warn("Could not prepare score sound:", error.message)
  );
  (_a = document.getElementById("micConsentDialog")) == null ? void 0 : _a.close("declined");
}
function enableMicScoring() {
  return __async(this, null, function* () {
    var _a;
    const dialog = document.getElementById("micConsentDialog");
    const allowButton = document.getElementById("allowMicScoringButton");
    const status = document.getElementById("micConsentStatus");
    micScoringDeclined = false;
    micPermissionDenied = false;
    if (allowButton) allowButton.disabled = true;
    if (status) status.textContent = "Waiting for microphone permission...";
    unlockScoreAudio().catch(
      (error) => console.warn("Could not prepare score sound:", error.message)
    );
    try {
      const PitchDetector = yield loadPitchDetector();
      if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia)) {
        throw new Error("Microphone access requires HTTPS or localhost.");
      }
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("This browser does not support microphone scoring.");
      }
      microphoneStream = yield navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        },
        video: false
      });
      microphoneAudioContext = new AudioContextConstructor();
      microphoneAnalyser = microphoneAudioContext.createAnalyser();
      microphoneAnalyser.fftSize = 2048;
      microphoneSamples = new Float32Array(microphoneAnalyser.fftSize);
      pitchDetector = PitchDetector.forFloat32Array(microphoneAnalyser.fftSize);
      microphoneAudioContext.createMediaStreamSource(microphoneStream).connect(microphoneAnalyser);
      yield microphoneAudioContext.resume();
      micScoringEnabled = true;
      resetPitchScore();
      micSamplingTimer = window.setInterval(sampleMicrophonePitch, 100);
      if (status) {
        status.textContent = "Pitch stability scoring is on. Audio stays on this device and is not recorded or sent.";
      }
      if (dialog == null ? void 0 : dialog.open) dialog.close("allowed");
    } catch (error) {
      stopMicScoring();
      micPermissionDenied = ["NotAllowedError", "PermissionDeniedError"].includes(
        error.name
      );
      if (status) {
        status.textContent = error.message || "Microphone access was denied. Karaoke will continue without scoring.";
      }
    } finally {
      if (allowButton) allowButton.disabled = false;
    }
  });
}
window.addEventListener("DOMContentLoaded", showMicConsentDialog, {
  once: true
});
function stopMicScoring() {
  micScoringEnabled = false;
  lastMicSampleAt = null;
  if (micSamplingTimer !== null) {
    window.clearInterval(micSamplingTimer);
    micSamplingTimer = null;
  }
  microphoneStream == null ? void 0 : microphoneStream.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  microphoneAnalyser = null;
  microphoneSamples = null;
  pitchDetector = null;
  if (microphoneAudioContext && microphoneAudioContext.state !== "closed") {
    microphoneAudioContext.close().catch(() => {
    });
  }
  microphoneAudioContext = null;
}
function sampleMicrophonePitch() {
  var _a;
  if (!micScoringEnabled || !microphoneAnalyser || !microphoneSamples || !pitchDetector) {
    return;
  }
  microphoneAnalyser.getFloatTimeDomainData(microphoneSamples);
  let sumSquares = 0;
  for (const sample of microphoneSamples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / microphoneSamples.length);
  const [pitchHz, clarity] = pitchDetector.findPitch(
    microphoneSamples,
    microphoneAudioContext.sampleRate
  );
  const now = performance.now();
  const activePlayer = window.tvPlayer || player;
  const isSongPlaying = typeof YT !== "undefined" && activePlayer && ((_a = activePlayer.getPlayerState) == null ? void 0 : _a.call(activePlayer)) === YT.PlayerState.PLAYING;
  if (!isSongPlaying) {
    lastMicSampleAt = now;
    previousPitchHz = null;
    return;
  }
  if (lastMicSampleAt === null) {
    lastMicSampleAt = now;
    return;
  }
  const elapsedMs = Math.min(now - lastMicSampleAt, 200);
  lastMicSampleAt = now;
  micObservedPlayingMs += elapsedMs;
  if (rms < MIC_MIN_ACTIVITY_RMS || clarity < PITCH_MIN_CLARITY || pitchHz < PITCH_MIN_FREQUENCY_HZ || pitchHz > PITCH_MAX_FREQUENCY_HZ) {
    previousPitchHz = null;
    return;
  }
  pitchDetectedMs += elapsedMs;
  if (previousPitchHz !== null) {
    const pitchChangeCents = Math.abs(
      1200 * Math.log2(pitchHz / previousPitchHz)
    );
    if (pitchChangeCents <= PITCH_STABILITY_TOLERANCE_CENTS) {
      pitchStableMs += elapsedMs;
    }
  }
  previousPitchHz = pitchHz;
}
window.addEventListener("pagehide", stopMicScoring);
function hideBootupSplash() {
  if (bootupHidden) return;
  bootupHidden = true;
  const splash = document.getElementById("bootupSplash");
  if (splash) {
    splash.classList.add("hidden");
    console.log("\u2705 Boot-up splash hidden");
  }
}
function checkBootupCompletion() {
  const timeSinceStart = Date.now() - bootupStartTime;
  if (firebaseReady && ytReady && timeSinceStart >= 500) {
    console.log("\u2705 Systems ready - hiding splash");
    hideBootupSplash();
    return true;
  }
  if (timeSinceStart >= 3e3) {
    console.log("\u23F1\uFE0F Timeout - hiding splash");
    hideBootupSplash();
    return true;
  }
  return false;
}
function isFirebaseConfigured() {
  try {
    if (typeof firebase !== "undefined" && firebase.database && firebase.app()) {
      const config = firebase.app().options;
      return config.databaseURL && !config.databaseURL.includes("YOUR_");
    }
  } catch (e) {
    return false;
  }
  return false;
}
function renderKaraokeRooms() {
  const activeRoom = karaokeRooms.find(
    (room) => room.id === activeKaraokeRoomId
  );
  const name = document.getElementById("activeRoomName");
  if (name) name.textContent = (activeRoom == null ? void 0 : activeRoom.name) || "Room unavailable";
}
function updateKaraokeDisplayClock() {
  const clock = document.getElementById("displayClock");
  if (!clock) return;
  const now = /* @__PURE__ */ new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = new Intl.DateTimeFormat(void 0, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);
  clock.hidden = false;
}
function renderKaraokeRoomDeviceCount(roomId) {
  if (activeKaraokeRoomId !== roomId) return;
  const memberCount = document.getElementById("roomMemberCount");
  if (!memberCount) return;
  const room = karaokeRooms.find((item) => item.id === roomId);
  memberCount.textContent = `${activeRoomDeviceCount} / ${KaraokeSessions.getRoomDeviceLimit(room)} phones`;
}
function startRoomPlaybackActivityHeartbeat(roomId) {
  if (roomPlaybackActivityTimer !== null) {
    clearInterval(roomPlaybackActivityTimer);
  }
  if (roomPlaybackPositionTimer !== null) {
    clearInterval(roomPlaybackPositionTimer);
  }
  roomPlaybackActivityTimer = setInterval(() => {
    var _a;
    const activePlayer = window.tvPlayer || player;
    if (activeKaraokeRoomId !== roomId || !karaokeDisplayEnabled || performerScreenModeActive || !(currentSong == null ? void 0 : currentSong.videoId) || isPlayingBootUpVideo || typeof YT === "undefined" || ((_a = activePlayer == null ? void 0 : activePlayer.getPlayerState) == null ? void 0 : _a.call(activePlayer)) !== YT.PlayerState.PLAYING) {
      return;
    }
    KaraokeSessions.touchRoomActivity(roomId).catch((error) => {
      console.warn("Could not refresh room playback activity:", error.message);
    });
  }, ROOM_PLAYBACK_ACTIVITY_INTERVAL_MS);
  roomPlaybackPositionTimer = setInterval(() => {
    var _a, _b;
    const activePlayer = window.tvPlayer || player;
    if (activeKaraokeRoomId !== roomId || !karaokeDisplayEnabled || performerScreenModeActive || !(currentSong == null ? void 0 : currentSong.videoId) || isPlayingBootUpVideo || typeof YT === "undefined" || ((_a = activePlayer == null ? void 0 : activePlayer.getPlayerState) == null ? void 0 : _a.call(activePlayer)) !== YT.PlayerState.PLAYING) {
      return;
    }
    const positionSeconds = Number((_b = activePlayer.getCurrentTime) == null ? void 0 : _b.call(activePlayer));
    if (!Number.isFinite(positionSeconds)) return;
    KaraokeSessions.setPlaybackPosition(
      roomId,
      currentSong.videoId,
      positionSeconds
    ).catch((error) => {
      console.warn("Could not sync room playback position:", error.message);
    });
  }, ROOM_PLAYBACK_POSITION_SYNC_INTERVAL_MS);
}
function activateKaraokeRoom(roomId) {
  if (!roomId || roomId === activeKaraokeRoomId && stopListeningToRoom)
    return;
  stopListeningToRoom == null ? void 0 : stopListeningToRoom();
  stopListeningToMembers == null ? void 0 : stopListeningToMembers();
  stopListeningToRoomVolume == null ? void 0 : stopListeningToRoomVolume();
  stopListeningToRoomMuted == null ? void 0 : stopListeningToRoomMuted();
  stopListeningToRoomDisplayStatus == null ? void 0 : stopListeningToRoomDisplayStatus();
  stopListeningToRoomDisplayStatus = null;
  stopListeningToRoomUsage == null ? void 0 : stopListeningToRoomUsage();
  stopListeningToRoomUsage = null;
  activeKaraokeRoomId = roomId;
  startRoomPlaybackActivityHeartbeat(roomId);
  activeRoomDeviceCount = 0;
  roomDisplayEnabled = true;
  roomUsageSettings = null;
  roomTimeExpired = false;
  activeRoomVolume = KaraokeSessions.DEFAULT_ROOM_VOLUME;
  activeRoomMuted = false;
  sessionStorage.setItem("karaokeTvRoomId", roomId);
  currentSong = null;
  tvQueue = [];
  clearCurrentSongPlayback();
  qrCodeGenerated = false;
  renderKaraokeRooms();
  const room = karaokeRooms.find((item) => item.id === roomId);
  const label = document.getElementById("roomCodeLabel");
  if (label)
    label.textContent = `${(room == null ? void 0 : room.name) || "Karaoke Room"} \xB7 Scan to Join`;
  const roomIdLabel = document.getElementById("roomIdLabel");
  if (roomIdLabel) roomIdLabel.textContent = `Room ID: ${roomId}`;
  generateQRCode();
  stopListeningToRoomVolume = KaraokeSessions.listenVolume(roomId, (volume) => {
    activeRoomVolume = volume;
    if (activeKaraokeRoomId === roomId && window.tvPlayer) {
      window.tvPlayer.setVolume(volume);
    }
  });
  stopListeningToRoomMuted = KaraokeSessions.listenMuted(roomId, (muted) => {
    activeRoomMuted = muted;
    if (activeKaraokeRoomId === roomId && window.tvPlayer) {
      muted ? window.tvPlayer.mute() : window.tvPlayer.unMute();
    }
  });
  stopListeningToRoom = KaraokeSessions.listenRoom(
    roomId,
    {
      onQueue: (queue) => {
        if (!karaokeDisplayEnabled) return;
        tvQueue = queue;
        firebaseReady = true;
        if (queue.length && (!currentSong || !currentSong.videoId)) {
          const firstSong = queue[0];
          const firstCurrentSong = {
            title: firstSong.title,
            artist: firstSong.artist,
            videoId: firstSong.videoId,
            requestedBy: firstSong.requestedBy,
            singer: firstSong.requestedBy
          };
          KaraokeSessions.setCurrentSongFromQueue(roomId, firstCurrentSong);
        }
        displayQueue();
        updateNextSongDisplay();
        checkBootupCompletion();
      },
      onCurrentSong: (song) => {
        if (!karaokeDisplayEnabled) return;
        if (!(song == null ? void 0 : song.videoId)) {
          clearCurrentSongPlayback();
          return;
        }
        currentSong = song;
        setNoSongMessage(false);
        displayQueue();
        updateNextSongDisplay();
        tryInitPlayback();
      },
      onControl: handleRoomControl
    },
    (error) => console.error("Karaoke room listener error:", error.message)
  );
  stopListeningToMembers = KaraokeSessions.listenMembers(roomId, (count) => {
    activeRoomDeviceCount = count;
    renderKaraokeRoomDeviceCount(roomId);
  });
  stopListeningToRoomDisplayStatus = KaraokeSessions.listenRoomDisplayStatus(
    roomId,
    (settings) => {
      var _a, _b;
      const performerScreenNotice = document.getElementById(
        "performerScreenNotice"
      );
      const performerScreenEnabled = settings.performerEnabled !== false;
      if (performerScreenNotice) {
        performerScreenNotice.hidden = settings.enabled === false || !performerScreenEnabled || !settings.performerScreenActive;
      }
      const wasPerformerScreenModeActive = performerScreenModeActive;
      performerScreenModeActive = Boolean(
        settings.enabled !== false && performerScreenEnabled && settings.performerScreenActive
      );
      if (performerScreenModeActive) {
        (_b = (_a = window.tvPlayer) == null ? void 0 : _a.pauseVideo) == null ? void 0 : _b.call(_a);
      } else if (wasPerformerScreenModeActive && settings.enabled !== false) {
        resumeTVPlaybackAfterPerformerScreen().catch(
          (error) => console.warn("Could not resume TV playback:", error.message)
        );
      }
      const wasRoomDisabled = !roomDisplayEnabled;
      roomDisplayEnabled = settings.enabled !== false;
      if (!roomDisplayEnabled) {
        karaokeDisplayEnabled = false;
        tvDisabledAnnouncement = settings.announcement || "The karaoke display in this room is temporarily unavailable.";
        stopListeningToRoom == null ? void 0 : stopListeningToRoom();
        stopListeningToRoom = null;
        stopListeningToRoomVolume == null ? void 0 : stopListeningToRoomVolume();
        stopListeningToRoomVolume = null;
        stopListeningToRoomMuted == null ? void 0 : stopListeningToRoomMuted();
        stopListeningToRoomMuted = null;
        clearCurrentSongPlayback();
        showRoomDisplayUnavailableMessage(tvDisabledAnnouncement);
      } else if (wasRoomDisabled) {
        window.location.reload();
      }
    },
    (error) => console.warn("Could not load room display status:", error.message)
  );
  stopListeningToRoomUsage = KaraokeSessions.listenRoomUsage(
    roomId,
    (settings) => {
      updateKaraokeDisplayRoomUsage(settings);
      renderKaraokeRoomDeviceCount(roomId);
    },
    (error) => console.warn("Could not follow room time limit:", error.message)
  );
}
function updateKaraokeDisplayRoomUsage(settings = {}) {
  roomUsageSettings = settings;
  if (roomUsageTimer === null) {
    roomUsageTimer = setInterval(renderKaraokeDisplayRoomTime, 1e3);
  }
  renderKaraokeDisplayRoomTime();
}
function renderKaraokeDisplayRoomTime() {
  const notice = document.getElementById("roomTimeNotice");
  if (!notice) return;
  const timeLimit = Number(roomUsageSettings == null ? void 0 : roomUsageSettings.timeLimitMinutes);
  const expiresAt = Number(roomUsageSettings == null ? void 0 : roomUsageSettings.expiresAt);
  if (!Number.isFinite(timeLimit) || timeLimit <= 0 || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    notice.hidden = true;
    notice.classList.remove("is-expired");
    if (roomTimeExpired) resumeKaraokeDisplayAfterRoomExtension();
    return;
  }
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    if (!roomTimeExpired) {
      roomTimeExpired = true;
      karaokeDisplayEnabled = false;
      stopListeningToRoom == null ? void 0 : stopListeningToRoom();
      stopListeningToRoom = null;
      stopListeningToRoomVolume == null ? void 0 : stopListeningToRoomVolume();
      stopListeningToRoomVolume = null;
      stopListeningToRoomMuted == null ? void 0 : stopListeningToRoomMuted();
      stopListeningToRoomMuted = null;
      clearCurrentSongPlayback();
    }
    notice.classList.add("is-expired");
    notice.textContent = "Room time expired. A performer can request additional time; playback resumes after admin approval.";
    notice.hidden = false;
    return;
  }
  if (roomTimeExpired) {
    resumeKaraokeDisplayAfterRoomExtension();
    return;
  }
  const warningWindow = Math.min(5 * 6e4, timeLimit * 6e4 * 0.2);
  notice.classList.remove("is-expired");
  notice.hidden = remainingMs > warningWindow;
  if (!notice.hidden) {
    const totalSeconds = Math.ceil(remainingMs / 1e3);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const remaining = hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
    notice.textContent = `Room time is almost up. ${remaining} remaining.`;
  }
}
function resumeKaraokeDisplayAfterRoomExtension() {
  if (!activeKaraokeRoomId) return;
  karaokeDisplayEnabled = true;
  activateKaraokeRoom(activeKaraokeRoomId);
}
function clearEmptyRoomSongCleanupTimer(roomId) {
  const timer = roomSongCleanupTimers.get(roomId);
  if (timer !== void 0) clearTimeout(timer);
  roomSongCleanupTimers.delete(roomId);
}
function rescheduleEmptyRoomSongCleanupTimers() {
  const roomIds = [...roomSongCleanupListeners.keys()];
  roomSongCleanupTimers.forEach((timer) => clearTimeout(timer));
  roomSongCleanupTimers.clear();
  roomIds.forEach((roomId) => scheduleEmptyRoomSongCleanup(roomId));
}
function scheduleEmptyRoomSongCleanup(roomId) {
  return __async(this, null, function* () {
    if (roomSongCleanupTimers.has(roomId) || roomSongCleanupRequests.has(roomId)) {
      return;
    }
    roomSongCleanupRequests.add(roomId);
    try {
      const emptySince = yield KaraokeSessions.markRoomEmptySince(roomId);
      if (!emptySince) return;
      const remainingMs = Math.max(
        0,
        KaraokeSessions.getQueueCleanupDelayMs() - (Date.now() - emptySince)
      );
      const timer = setTimeout(() => __async(null, null, function* () {
        roomSongCleanupTimers.delete(roomId);
        try {
          const cleared = yield KaraokeSessions.clearRoomSongsIfUnoccupied(roomId);
          if (cleared) {
            console.log(`Cleared reserved songs from empty room ${roomId}`);
          } else {
            yield scheduleEmptyRoomSongCleanup(roomId, 0);
          }
        } catch (error) {
          console.warn(
            `Could not clear songs from empty room ${roomId}:`,
            error.message
          );
          setTimeout(() => scheduleEmptyRoomSongCleanup(roomId, 0), 6e4);
        }
      }), remainingMs);
      roomSongCleanupTimers.set(roomId, timer);
    } catch (error) {
      console.warn("Could not persist empty-room timer:", error.message);
      setTimeout(() => scheduleEmptyRoomSongCleanup(roomId, 0), 6e4);
    } finally {
      roomSongCleanupRequests.delete(roomId);
    }
  });
}
function chooseInitialKaraokeDisplayRoomId(rooms) {
  return __async(this, null, function* () {
    var _a;
    const requestState = readKaraokeDisplayRoomRequestState();
    if (["creating", "pending", "rejected", "missing"].includes(
      requestState == null ? void 0 : requestState.status
    )) {
      return null;
    }
    if ((requestState == null ? void 0 : requestState.status) === "approved" && rooms.some((room) => room.id === requestState.approvedRoomId)) {
      return requestState.approvedRoomId;
    }
    const requestedRoomId = KaraokeSessions.getRoomIdFromUrl();
    const rememberedRoomId = sessionStorage.getItem("karaokeTvRoomId");
    if (requestedRoomId && rooms.some((room) => room.id === requestedRoomId)) {
      const memberCount = yield KaraokeSessions.getActiveMemberCount(requestedRoomId);
      if (memberCount === 0) return requestedRoomId;
    }
    if (rooms.some((room) => room.id === rememberedRoomId)) {
      return rememberedRoomId;
    }
    const roomCounts = new Map(
      yield Promise.all(
        rooms.map((room) => __async(null, null, function* () {
          return [
            room.id,
            yield KaraokeSessions.getActiveMemberCount(room.id)
          ];
        }))
      )
    );
    const emptyRooms = rooms.filter((room) => (roomCounts.get(room.id) || 0) === 0).sort((first, second) => (first.createdAt || 0) - (second.createdAt || 0));
    return ((_a = emptyRooms[0]) == null ? void 0 : _a.id) || null;
  });
}
function readKaraokeDisplayRoomRequestState() {
  try {
    return JSON.parse(
      localStorage.getItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY) || "null"
    );
  } catch (error) {
    console.warn("Could not read TV room request state:", error.message);
    return null;
  }
}
function saveKaraokeDisplayRoomRequestState(state) {
  try {
    localStorage.setItem(
      KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch (error) {
    console.warn("Could not save TV room request state:", error.message);
  }
}
function showKaraokeDisplayRoomRequestStatus(title, message, rejected = false, retryAnchorRoomId = null, contactAdmin = false) {
  const splash = document.getElementById("splashScreen");
  if (!splash) return;
  splash.innerHTML = `
    <section style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:24px;box-sizing:border-box;background:#080b13;color:#fff;text-align:center;font-family:'DM Sans',sans-serif">
      <div aria-hidden="true" style="display:grid;place-items:center;width:60px;height:60px;margin-bottom:22px;border:1px solid ${rejected ? "#c45b68" : "#3c8b80"};border-radius:50%;color:${rejected ? "#ff9eac" : "#7fe0c3"};font-size:30px">${rejected ? "!" : "\u2026"}</div>
      <h1 id="tvRoomRequestTitle" style="max-width:min(90vw,800px);margin:0;color:#f0f3ff;font-size:clamp(1.5rem,4vw,3rem)"></h1>
      <p id="tvRoomRequestMessage" style="max-width:min(86vw,760px);margin:18px 0 0;color:#b6c3dc;font-size:clamp(1rem,2.2vw,1.4rem);line-height:1.6;overflow-wrap:anywhere"></p>
    </section>
  `;
  splash.querySelector("#tvRoomRequestTitle").textContent = title;
  splash.querySelector("#tvRoomRequestMessage").textContent = message;
  if (contactAdmin) {
    const contactNotice = document.createElement("div");
    contactNotice.className = "admin-contact-notice";
    const contactMessage = document.createElement("span");
    contactMessage.textContent = "Message us on Facebook for help with your request.";
    const contactLink = document.createElement("a");
    contactLink.className = "admin-contact-link";
    contactLink.href = "https://www.facebook.com/profile.php?id=61580750922961";
    contactLink.target = "_blank";
    contactLink.rel = "noopener noreferrer";
    contactLink.textContent = "Contact on Facebook";
    contactNotice.append(contactMessage, contactLink);
    splash.querySelector("section").append(contactNotice);
  }
  if (rejected && retryAnchorRoomId) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Request another room";
    retryButton.style.cssText = "margin-top:24px;padding:12px 20px;border:0;border-radius:8px;background:#315cfb;color:#fff;font:600 1rem 'DM Sans',sans-serif;cursor:pointer";
    retryButton.addEventListener("click", () => {
      localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
      hideKaraokeDisplayRoomRequestStatus();
      return requestKaraokeDisplayRoomApproval(retryAnchorRoomId);
    });
    splash.querySelector("section").append(retryButton);
  }
  splash.style.display = "flex";
}
function hideKaraokeDisplayRoomRequestStatus() {
  const splash = document.getElementById("splashScreen");
  if (!splash) return;
  splash.style.display = "none";
  splash.replaceChildren();
}
function listenToKaraokeDisplayRoomRequest(state) {
  const listenerKey = `${state.anchorRoomId}:${state.requestId}`;
  if (activeKaraokeDisplayRoomRequestKey === listenerKey) return;
  stopListeningToKaraokeDisplayRoomRequest == null ? void 0 : stopListeningToKaraokeDisplayRoomRequest();
  activeKaraokeDisplayRoomRequestKey = listenerKey;
  stopListeningToKaraokeDisplayRoomRequest = KaraokeSessions.listenRoomRequest(
    state.anchorRoomId,
    state.requestId,
    (request) => __async(null, null, function* () {
      const currentState = readKaraokeDisplayRoomRequestState() || state;
      if (!request) {
        currentState.status = "missing";
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Room request unavailable",
          "The request could not be found. Please contact the administrator.",
          true,
          currentState.anchorRoomId
        );
      } else if (request.status === "approved" && request.approvedRoomId) {
        currentState.status = "approved";
        currentState.approvedRoomId = request.approvedRoomId;
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Room approved",
          "Connecting this karaoke display to the new room..."
        );
        const roomSnapshot = yield firebase.database().ref(`karaokeRooms/${request.approvedRoomId}`).once("value");
        const room = roomSnapshot.val();
        if (!room) return;
        if (!karaokeRooms.some((item) => item.id === request.approvedRoomId)) {
          karaokeRooms.push(__spreadProps(__spreadValues({}, room), { id: request.approvedRoomId }));
        }
        hideKaraokeDisplayRoomRequestStatus();
        activateKaraokeRoom(request.approvedRoomId);
      } else if (request.status === "rejected") {
        currentState.status = "rejected";
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Room request rejected",
          "The administrator could not open another room. Please contact them for assistance.",
          true,
          currentState.anchorRoomId
        );
      } else if (request.status === "approving") {
        showKaraokeDisplayRoomRequestStatus(
          "Waiting for approval",
          "The administrator is processing your request. Please wait."
        );
      } else {
        currentState.status = "pending";
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Waiting for approval",
          "No unoccupied room is available. A request was sent to the administrator."
        );
      }
    }),
    (error) => {
      console.error("Could not follow TV room request:", error.message);
      showKaraokeDisplayRoomRequestStatus(
        "Waiting for approval",
        "The room request was sent, but its status cannot be checked right now."
      );
    }
  );
}
function requestKaraokeDisplayRoomApproval(anchorRoomId) {
  return __async(this, null, function* () {
    const existingRequest = readKaraokeDisplayRoomRequestState();
    if ((existingRequest == null ? void 0 : existingRequest.status) === "pending" && existingRequest.requestId) {
      listenToKaraokeDisplayRoomRequest(existingRequest);
      return;
    }
    if ((existingRequest == null ? void 0 : existingRequest.status) === "approved") {
      const approvedRoom = karaokeRooms.find(
        (room) => room.id === existingRequest.approvedRoomId
      );
      if (approvedRoom) {
        hideKaraokeDisplayRoomRequestStatus();
        activateKaraokeRoom(approvedRoom.id);
        return;
      }
      localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
    }
    if ((existingRequest == null ? void 0 : existingRequest.status) === "rejected" || (existingRequest == null ? void 0 : existingRequest.status) === "missing") {
      showKaraokeDisplayRoomRequestStatus(
        "Room request rejected",
        "The administrator could not open another room. Please contact them for assistance.",
        true,
        existingRequest.anchorRoomId || anchorRoomId
      );
      return;
    }
    if ((existingRequest == null ? void 0 : existingRequest.status) === "creating") {
      showKaraokeDisplayRoomRequestStatus(
        "Waiting for approval",
        "Your room request is being sent to the administrator..."
      );
      if (!tvRoomRequestPollTimer) {
        tvRoomRequestPollTimer = setInterval(() => {
          const latestRequest = readKaraokeDisplayRoomRequestState();
          if ((latestRequest == null ? void 0 : latestRequest.status) === "pending" && latestRequest.requestId) {
            clearInterval(tvRoomRequestPollTimer);
            tvRoomRequestPollTimer = null;
            listenToKaraokeDisplayRoomRequest(latestRequest);
          } else if (!latestRequest) {
            clearInterval(tvRoomRequestPollTimer);
            tvRoomRequestPollTimer = null;
            requestKaraokeDisplayRoomApproval(anchorRoomId);
          } else if (latestRequest.status === "creating" && Date.now() - latestRequest.createdAt > 3e4) {
            clearInterval(tvRoomRequestPollTimer);
            tvRoomRequestPollTimer = null;
            localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
            requestKaraokeDisplayRoomApproval(anchorRoomId);
          }
        }, 500);
      }
      return;
    }
    if (!anchorRoomId) {
      try {
        if (!(yield KaraokeAdminPresence.hasActiveAdmin())) {
          showKaraokeDisplayRoomRequestStatus(
            "No admin online",
            "Another room cannot be opened right now.",
            false,
            null,
            true
          );
          return;
        }
      } catch (error) {
        console.warn("Could not check admin availability:", error.message);
        showKaraokeDisplayRoomRequestStatus(
          "Room request unavailable",
          "Could not check admin availability. Check the connection and try again.",
          true
        );
        return;
      }
      showKaraokeDisplayRoomRequestStatus(
        "Waiting for approval",
        "No room is available. Waiting for the administrator to add one."
      );
      return;
    }
    try {
      if (!(yield KaraokeAdminPresence.hasActiveAdmin())) {
        showKaraokeDisplayRoomRequestStatus(
          "No admin online",
          "Another room cannot be opened right now.",
          false,
          null,
          true
        );
        return;
      }
    } catch (error) {
      console.warn("Could not check admin availability:", error.message);
      showKaraokeDisplayRoomRequestStatus(
        "Room request unavailable",
        "Could not check admin availability. Check the connection and try again.",
        true,
        anchorRoomId
      );
      return;
    }
    const creatingState = {
      status: "creating",
      anchorRoomId,
      createdAt: Date.now()
    };
    saveKaraokeDisplayRoomRequestState(creatingState);
    showKaraokeDisplayRoomRequestStatus(
      "Waiting for approval",
      "No unoccupied room is available. Sending a request to the administrator..."
    );
    try {
      const request = yield KaraokeSessions.createRoomRequest(
        "Karaoke Display",
        anchorRoomId
      );
      const pendingState = {
        status: "pending",
        anchorRoomId,
        requestId: request.id,
        createdAt: request.createdAt
      };
      saveKaraokeDisplayRoomRequestState(pendingState);
      listenToKaraokeDisplayRoomRequest(pendingState);
    } catch (error) {
      localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
      console.error("Could not request another TV room:", error.message);
      showKaraokeDisplayRoomRequestStatus(
        "Room request failed",
        "Could not send the room request. Check the connection and reload this page.",
        true
      );
    }
  });
}
function initializeKaraokeRooms() {
  KaraokeSessions.ensureDefaultRoom().then((activeRoomId) => {
    stopListeningToRooms = KaraokeSessions.listenRooms((rooms) => {
      karaokeRooms = rooms;
      renderKaraokeRooms();
      const roomIds = new Set(rooms.map((room) => room.id));
      roomSongCleanupListeners.forEach((stopListening, roomId) => {
        if (!roomIds.has(roomId)) {
          stopListening();
          roomSongCleanupListeners.delete(roomId);
          clearEmptyRoomSongCleanupTimer(roomId);
        }
      });
      rooms.forEach((room) => {
        if (!roomSongCleanupListeners.has(room.id)) {
          const stopListening = KaraokeSessions.listenMembers(
            room.id,
            () => scheduleEmptyRoomSongCleanup(room.id)
          );
          roomSongCleanupListeners.set(room.id, stopListening);
        }
      });
      if (!rooms.some((room) => room.id === activeKaraokeRoomId)) {
        if (!initialRoomSelectionInProgress) {
          initialRoomSelectionInProgress = true;
          chooseInitialKaraokeDisplayRoomId(rooms).then((roomId) => {
            var _a;
            if (roomId && !rooms.some((room) => room.id === activeKaraokeRoomId)) {
              activateKaraokeRoom(roomId);
            } else if (!roomId) {
              requestKaraokeDisplayRoomApproval(
                activeRoomId || ((_a = rooms[0]) == null ? void 0 : _a.id) || null
              );
            }
          }).catch(
            (error) => console.warn("Could not select the TV room:", error.message)
          ).finally(() => {
            initialRoomSelectionInProgress = false;
          });
        }
      }
      const activeRoom = rooms.find(
        (room) => room.id === activeKaraokeRoomId
      );
      const label = document.getElementById("roomCodeLabel");
      if (activeRoom && label) {
        label.textContent = `${activeRoom.name} \xB7 Scan to Join`;
      }
    });
  }).catch((error) => {
    console.error("Could not initialize karaoke rooms:", error.message);
  });
}
function handleRoomControl(control) {
  if (!karaokeDisplayEnabled || !(control == null ? void 0 : control.command)) return;
  console.log("\u{1F4F1} Room control command received:", control.command);
  switch (control.command) {
    case "togglePlay":
      if (performerScreenModeActive) break;
      if (!window.tvPlayer || typeof YT === "undefined") return;
      if (window.tvPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        window.tvPlayer.pauseVideo();
      } else {
        window.tvPlayer.playVideo();
      }
      break;
    case "skip":
      playNextSong();
      break;
    case "restart":
      if (performerScreenModeActive) break;
      if (window.tvPlayer && currentSong) {
        window.tvPlayer.seekTo(0);
        window.tvPlayer.playVideo();
        KaraokeSessions.setPlaybackState(
          activeKaraokeRoomId,
          true,
          currentSong.videoId,
          0
        ).catch(
          (error) => console.warn("Could not sync restarted playback:", error.message)
        );
      }
      break;
    case "toggleMute":
      if (!window.tvPlayer) return;
      window.tvPlayer.isMuted() ? window.tvPlayer.unMute() : window.tvPlayer.mute();
      break;
    case "setMuted":
      if (!window.tvPlayer || typeof control.muted !== "boolean") return;
      activeRoomMuted = control.muted;
      activeRoomMuted ? window.tvPlayer.mute() : window.tvPlayer.unMute();
      break;
    case "setVolume":
      if (window.tvPlayer && typeof control.volume === "number") {
        activeRoomVolume = Math.max(0, Math.min(100, control.volume));
        window.tvPlayer.setVolume(activeRoomVolume);
      }
      break;
  }
}
document.addEventListener("DOMContentLoaded", function() {
  console.log("\u{1F4FA} [1/7] Karaoke Display DOMContentLoaded");
  updateKaraokeDisplayClock();
  setInterval(updateKaraokeDisplayClock, 1e3);
  console.log("\u{1F50D} DEBUG: window.YT =", typeof window.YT);
  console.log("\u{1F50D} DEBUG: window.firebase =", typeof window.firebase);
  checkKaraokeDisplayEnabled(function(isEnabled) {
    karaokeDisplayEnabled = isEnabled;
    if (!isEnabled) {
      console.warn("\u26A0\uFE0F Karaoke Display is DISABLED");
      showKaraokeDisplayUnavailableMessage(tvDisabledAnnouncement);
      return;
    }
    initializeKaraokeDisplay();
  });
});
function initializeKaraokeDisplay() {
  try {
    const config = firebase.app().options;
    console.log("\u{1F50D} DEBUG: Firebase config:", {
      databaseURL: config.databaseURL,
      projectId: config.projectId,
      apiKey: config.apiKey ? "***" : "MISSING"
    });
  } catch (err) {
    console.error("\u274C Firebase not initialized:", err.message);
  }
  if (document.hidden) {
    document.addEventListener(
      "visibilitychange",
      function() {
        if (!document.hidden && !qrCodeGenerated) {
          generateQRCode();
        }
      },
      { once: true }
    );
  } else {
    setTimeout(generateQRCode, 100);
  }
  setInterval(generateQRCode, 1e4);
  useFirebase = isFirebaseConfigured();
  console.log("\u{1F50D} DEBUG: useFirebase =", useFirebase);
  if (!useFirebase) {
    console.error(
      "\u274C Firebase not configured - Karaoke Display requires Firebase"
    );
    return;
  }
  KaraokeSessions.listenQueueCleanupDelay(
    rescheduleEmptyRoomSongCleanupTimers,
    (error) => console.warn("Could not load queue cleanup delay:", error.message)
  );
  firebase.database().ref("appSettings/scoreSoundVolume").on("value", (snapshot) => {
    const savedVolume = Number(snapshot.val());
    if (snapshot.val() == null || !Number.isFinite(savedVolume)) return;
    scoreSoundVolume = Math.max(0, Math.min(100, savedVolume)) / 100;
  });
  console.log("\u{1F525} Firebase configured, waiting for data...");
  console.log("\u23F1\uFE0F Initializing Firebase listeners immediately...");
  try {
    initializeFirebaseListeners();
  } catch (err) {
    console.error("\u274C Error initializing Firebase listeners early:", err);
  }
  if (ytReady) {
    createYouTubePlayer();
  }
  setTimeout(() => {
    console.log("\u23F1\uFE0F [3s timeout check] ytReady =", ytReady);
    if (!ytReady) {
      console.warn(
        "\u26A0\uFE0F YouTube API not responding, forcing ytReady=true after 3s"
      );
      ytReady = true;
      createYouTubePlayer();
      checkBootupCompletion();
    }
  }, 3e3);
  const bootupCheckInterval = setInterval(() => {
    if (checkBootupCompletion()) {
      clearInterval(bootupCheckInterval);
    }
  }, 300);
  checkPhoneConnection();
  console.log("\u2705 Initial connection check done");
  setInterval(checkPhoneConnection, 2e3);
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      firebase.database().ref("tvControl").on("value", (snapshot) => {
        const settings = snapshot.val() || {};
        const isEnabled = settings.enabled !== false;
        console.log(
          "\u{1F4FA} TV Status Changed:",
          isEnabled ? "ENABLED" : "DISABLED"
        );
        if (!isEnabled) {
          karaokeDisplayEnabled = false;
          tvDisabledAnnouncement = settings.announcement || "The karaoke display is temporarily unavailable. Please check back soon.";
          console.warn("\u26A0\uFE0F Karaoke Display has been DISABLED by admin");
          stopListeningToRoom == null ? void 0 : stopListeningToRoom();
          stopListeningToRoom = null;
          stopListeningToMembers == null ? void 0 : stopListeningToMembers();
          stopListeningToMembers = null;
          stopListeningToRoomVolume == null ? void 0 : stopListeningToRoomVolume();
          stopListeningToRoomVolume = null;
          stopListeningToRoomMuted == null ? void 0 : stopListeningToRoomMuted();
          stopListeningToRoomMuted = null;
          clearCurrentSongPlayback();
          showKaraokeDisplayUnavailableMessage(tvDisabledAnnouncement);
        } else if (!karaokeDisplayEnabled) {
          karaokeDisplayEnabled = true;
          window.location.reload();
        }
      });
      tvAvailabilityListenerAttached = true;
    } catch (e) {
      console.warn("Error setting up TV status listener:", e.message);
    }
  }
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
      generateQRCode();
    }
  });
  window.addEventListener("storage", function(e) {
    if (e.key === "karaoke_queue" || e.key === "karaoke_current_song") {
      console.log("\u{1F4E1} Storage change detected from other tab:", e.key);
    }
  });
  window.addEventListener("karaoke-queue-updated", function(e) {
    console.log("\u{1F3B5} Queue updated from singer control:", e.detail);
    loadQueueData();
    displayQueue();
    checkAndPlayCurrentSong();
  });
}
function initializeLegacyFirebaseListeners() {
  console.log("\u{1F525} [3/7] Attaching Firebase listeners");
  console.log("\u{1F50D} DEBUG: firebaseListenersSet =", firebaseListenersSet);
  if (firebaseListenersSet) {
    console.log("\u26A0\uFE0F Firebase listeners already initialized, skipping...");
    return;
  }
  firebaseListenersSet = true;
  const db = firebase.database();
  console.log("\u{1F50D} DEBUG: Firebase database object:", typeof db);
  db.ref("queue").on(
    "value",
    (snapshot) => {
      const data = snapshot.val();
      console.log("\u{1F50D} DEBUG: Queue snapshot received:", {
        data,
        isEmpty: !data,
        isArray: Array.isArray(data),
        type: typeof data
      });
      firebaseReady = true;
      if (!data) {
        tvQueue = [];
        console.log("\u{1F4E1} Queue is empty (no songs yet)");
      } else {
        if (Array.isArray(data)) {
          tvQueue = data;
        } else if (typeof data === "object") {
          tvQueue = Object.values(data);
        } else {
          tvQueue = [];
        }
        tvQueue = tvQueue.filter(
          (song) => song && song.title && song.videoId && song.requestedBy
        );
        console.log(
          "\u{1F4E1} Queue loaded from Firebase:",
          tvQueue.length,
          "valid songs"
        );
        console.log(
          "\u{1F4E1} Queue details:",
          tvQueue.map((s) => ({ title: s.title, requestedBy: s.requestedBy }))
        );
        try {
          localStorage.setItem("karaoke_queue", JSON.stringify(tvQueue));
          console.log("\u2705 Queue synced to localStorage");
        } catch (e) {
          console.warn("\u26A0\uFE0F Could not sync queue to localStorage:", e.message);
        }
        if (tvQueue.length > 0 && (!currentSong || !currentSong.videoId)) {
          console.log("\u25B6\uFE0F Auto-playing first song in queue...");
          const firstSong = tvQueue[0];
          currentSong = {
            title: firstSong.title,
            artist: firstSong.artist,
            videoId: firstSong.videoId,
            requestedBy: firstSong.requestedBy,
            singer: firstSong.requestedBy
          };
          firebase.database().ref("currentSong").set(currentSong);
          tryInitPlayback();
        }
      }
      console.log(
        "\u{1F4FA} Updating karaoke display - Queue has",
        tvQueue.length,
        "songs"
      );
      setTimeout(() => {
        displayQueue();
        updateNextSongDisplay();
        checkBootupCompletion();
      }, 0);
    },
    (error) => {
      console.error("\u274C Firebase queue listener error:", error);
    }
  );
  window.addEventListener("storage", (e) => {
    if (e.key === "karaoke_queue" && e.newValue) {
      try {
        const localQueue = JSON.parse(e.newValue);
        if (Array.isArray(localQueue) && localQueue.length > tvQueue.length) {
          console.log(
            "\u{1F4F1} Queue updated from other tab/window, syncing to Firebase"
          );
          firebase.database().ref("queue").set(localQueue).catch((err) => {
            console.warn(
              "Could not sync localStorage queue to Firebase:",
              err.message
            );
          });
        }
      } catch (error) {
        console.warn("Error processing storage event:", error.message);
      }
    }
  });
  db.ref("currentSong").on(
    "value",
    (snap) => {
      const data = snap.val();
      console.log("\u{1F50D} DEBUG: CurrentSong snapshot received:", data);
      if (!data || !data.videoId) {
        console.log("\u{1F4FB} No current song in Firebase");
        clearCurrentSongPlayback();
        return;
      }
      console.log("\u{1F3AC} Current song updated:", {
        title: data.title,
        artist: data.artist,
        videoId: data.videoId,
        requestedBy: data.requestedBy,
        timestamp: data.timestamp
      });
      currentSong = data;
      firebaseReady = true;
      setNoSongMessage(false);
      displayQueue();
      updateNextSongDisplay();
      checkBootupCompletion();
      tryInitPlayback();
    },
    (error) => {
      console.error("\u274C Firebase currentSong listener error:", error);
    }
  );
  db.ref("control").on(
    "value",
    (snapshot) => {
      const control = snapshot.val();
      if (!control || !control.command) return;
      console.log("\u{1F4F1} Control command received:", control.command);
      switch (control.command) {
        case "togglePlay":
          if (performerScreenModeActive) break;
          if (window.tvPlayer && window.tvPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
            window.tvPlayer.pauseVideo();
            console.log("\u23F8 Paused via remote");
          } else if (window.tvPlayer) {
            window.tvPlayer.playVideo();
            console.log("\u25B6\uFE0F Playing via remote");
          }
          break;
        case "skip":
          console.log("\u23ED\uFE0F Skipping to next song via remote");
          playNextSong();
          break;
        case "restart":
          if (performerScreenModeActive) break;
          if (window.tvPlayer && currentSong) {
            window.tvPlayer.seekTo(0);
            window.tvPlayer.playVideo();
            console.log("\u{1F504} Restarted via remote");
          }
          break;
        case "toggleMute":
          if (window.tvPlayer) {
            if (window.tvPlayer.isMuted()) {
              window.tvPlayer.unMute();
              console.log("\u{1F50A} Unmuted via remote");
            } else {
              window.tvPlayer.mute();
              console.log("\u{1F507} Muted via remote");
            }
          }
          break;
        case "setVolume":
          if (window.tvPlayer && typeof control.volume === "number") {
            const volumePercent = Math.max(0, Math.min(100, control.volume));
            const volumeDecimal = volumePercent / 100;
            window.tvPlayer.setVolume(volumeDecimal * 100);
            console.log("\u{1F50A} Volume set to:", volumePercent + "%");
          }
          break;
      }
    },
    (error) => {
      console.warn("\u26A0\uFE0F Firebase control listener error:", error);
    }
  );
  db.ref("activity").on(
    "value",
    (snapshot) => {
      const activityData = snapshot.val();
      if (!activityData) return;
      console.log("\u{1F4F1} Activity updated from Firebase:", activityData.timestamp);
    },
    (error) => {
      console.warn("\u26A0\uFE0F Firebase activity listener error:", error);
    }
  );
  console.log("\u2705 [3/7] Firebase listeners attached");
  let lastStorageQueueLength = 0;
  setInterval(() => {
    try {
      const localQueue = JSON.parse(
        localStorage.getItem("karaoke_queue") || "[]"
      );
      if (localQueue.length !== lastStorageQueueLength) {
        console.log(
          "\u{1F504} Syncing queue from localStorage (",
          localQueue.length,
          "songs, was",
          lastStorageQueueLength,
          ")"
        );
        tvQueue = localQueue;
        lastStorageQueueLength = localQueue.length;
        displayQueue();
        updateNextSongDisplay();
        if (localQueue.length > 0 && (!currentSong || !currentSong.videoId)) {
          const firstSong = localQueue[0];
          currentSong = {
            title: firstSong.title,
            artist: firstSong.artist,
            videoId: firstSong.videoId,
            requestedBy: firstSong.requestedBy,
            singer: firstSong.requestedBy
          };
          tryInitPlayback();
        }
      }
    } catch (e) {
      console.warn("Error syncing from localStorage:", e.message);
    }
  }, 1e3);
  console.log("\u{1F4E1} [3/7] Loading initial songs from Firebase...");
  db.ref("queue").once("value", (snapshot) => {
    const queueData = snapshot.val();
    console.log("\u{1F50D} DEBUG: Initial queue load:", queueData);
    if (queueData) {
      tvQueue = Array.isArray(queueData) ? queueData : Object.values(queueData);
      console.log("\u{1F4E1} Initial queue loaded:", tvQueue.length, "songs");
    } else {
      tvQueue = [];
      console.log("\u{1F4E1} Initial queue: empty (no songs yet)");
    }
    firebaseReady = true;
    checkBootupCompletion();
    displayQueue();
  }).catch((err) => {
    console.error("\u274C Initial queue load failed:", err);
  });
  db.ref("currentSong").once("value", (snapshot) => {
    const songData = snapshot.val();
    console.log("\u{1F50D} DEBUG: Initial currentSong load:", songData);
    if (songData) {
      currentSong = songData;
      console.log("\u{1F3B5} Initial song loaded:", currentSong.title);
      displayQueue();
      updateNextSongDisplay();
      if (youtubeAPIReady && playerReady) {
        console.log("\u25B6\uFE0F [6/7] Initial song - player ready, calling playback");
        tryInitPlayback();
      }
    }
  }).catch((err) => {
    console.error("\u274C Initial currentSong load failed:", err);
  });
}
function initializeFirebaseListeners() {
  if (firebaseListenersSet) return;
  firebaseListenersSet = true;
  initializeKaraokeRooms();
  firebase.database().ref("activity").on("value", (snapshot) => {
    const activityData = snapshot.val();
    if (activityData) {
      console.log(
        "\u{1F4F1} Activity updated from Firebase:",
        activityData.timestamp
      );
    }
  });
}
function setCurrentFromQueue(song) {
  if (!activeKaraokeRoomId) return;
  currentSong = {
    title: song.title,
    artist: song.artist,
    videoId: song.videoId,
    requestedBy: song.requestedBy,
    singer: song.requestedBy
  };
  KaraokeSessions.roomRef(activeKaraokeRoomId).update({
    currentSong,
    lastActivityAt: Date.now()
  }).catch(
    (error) => console.warn("Could not save current song activity:", error.message)
  );
  isPlaying = true;
  checkAndPlayCurrentSong();
}
function onYouTubeIframeAPIReady() {
  console.log("\u2705 YouTube IFrame API Ready");
  console.log(
    "\u{1F50D} DEBUG: videoPlayer element:",
    document.getElementById("videoPlayer")
  );
  ytReady = true;
  createYouTubePlayer();
}
function createYouTubePlayer() {
  console.log("\u2705 YouTube API Ready");
  console.log(
    "\u{1F50D} DEBUG: useFirebase =",
    useFirebase,
    "firebaseListenersSet =",
    firebaseListenersSet
  );
  if (!firebaseListenersSet && useFirebase) {
    console.log(
      "\u26A0\uFE0F Firebase listeners not yet initialized, initializing now..."
    );
    try {
      initializeFirebaseListeners();
    } catch (err) {
      console.error("\u274C Error initializing Firebase listeners:", err);
    }
  } else {
    console.log("\u2705 Firebase listeners already initialized");
  }
  checkBootupCompletion();
}
function tryInitPlayback() {
  var _a, _b;
  if (performerScreenModeActive) {
    (_b = (_a = window.tvPlayer) == null ? void 0 : _a.pauseVideo) == null ? void 0 : _b.call(_a);
    return;
  }
  if (!karaokeDisplayEnabled || !ytReady || !firebaseReady) {
    console.log(
      `\u23F3 Not ready yet: ytReady=${ytReady}, firebaseReady=${firebaseReady}`
    );
    return;
  }
  if (currentVideoId === (currentSong == null ? void 0 : currentSong.videoId)) {
    console.log("\u2139\uFE0F Same song already playing");
    return;
  }
  if (!currentSong || !currentSong.videoId) {
    console.warn("\u26A0 No current song data");
    return;
  }
  loadSong(currentSong);
}
function resumeTVPlaybackAfterPerformerScreen() {
  return __async(this, null, function* () {
    if (!karaokeDisplayEnabled || !activeKaraokeRoomId) {
      return;
    }
    const snapshot = yield KaraokeSessions.roomRef(activeKaraokeRoomId).once("value");
    const room = snapshot.val() || {};
    currentSong = room.currentSong || null;
    tvQueue = Array.isArray(room.queue) ? room.queue : room.queue && typeof room.queue === "object" ? Object.values(room.queue) : [];
    displayQueue();
    updateNextSongDisplay();
    if (!(currentSong == null ? void 0 : currentSong.videoId)) {
      clearCurrentSongPlayback();
      return;
    }
    const control = room.control || {};
    const playbackMatchesCurrentSong = control.playbackVideoId === currentSong.videoId;
    const position = playbackMatchesCurrentSong ? Math.max(0, Number(control.playbackPositionSeconds) || 0) : 0;
    const shouldPlay = playbackMatchesCurrentSong ? Boolean(control.playing) : true;
    if (!window.tvPlayer) {
      currentVideoId = null;
      loadSong(currentSong, position, shouldPlay);
      return;
    }
    if (!playerReady) {
      pendingTVPerformerResume = {
        videoId: currentSong.videoId,
        position,
        playing: shouldPlay
      };
      return;
    }
    if (currentVideoId !== currentSong.videoId) {
      loadSong(currentSong, position, shouldPlay);
      return;
    }
    pendingTVPerformerResume = null;
    window.tvPlayer.seekTo(position, true);
    if (!performerScreenModeActive && (currentSong == null ? void 0 : currentSong.videoId)) {
      if (shouldPlay) {
        window.tvPlayer.playVideo();
      } else {
        window.tvPlayer.pauseVideo();
      }
    }
  });
}
let fullscreenOrientationLocked = false;
function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
}
function updateFullscreenUi() {
  var _a, _b;
  const displayContainer = document.querySelector(".display-container");
  const fullscreenElement = getFullscreenElement();
  const isFullscreen = fullscreenElement === displayContainer || displayContainer.classList.contains("fullscreen-fallback");
  displayContainer.classList.toggle("fullscreen-active", isFullscreen);
  document.body.classList.toggle("fullscreen-ui-active", isFullscreen);
  document.getElementById("exitFullscreenBtn").hidden = !isFullscreen;
  if (!isFullscreen && fullscreenOrientationLocked) {
    fullscreenOrientationLocked = false;
    (_b = (_a = screen.orientation) == null ? void 0 : _a.unlock) == null ? void 0 : _b.call(_a);
  }
}
function lockLandscapeIfPortrait() {
  var _a;
  const orientation = screen.orientation;
  if (!((_a = orientation == null ? void 0 : orientation.type) == null ? void 0 : _a.startsWith("portrait")) || typeof orientation.lock !== "function") {
    return;
  }
  try {
    Promise.resolve(orientation.lock("landscape")).then(() => {
      var _a2;
      const displayContainer = document.querySelector(".display-container");
      if (getFullscreenElement() === displayContainer) {
        fullscreenOrientationLocked = true;
      } else {
        (_a2 = orientation.unlock) == null ? void 0 : _a2.call(orientation);
      }
    }).catch((error) => {
      console.warn("Could not lock the screen to landscape:", error.message);
    });
  } catch (error) {
    console.warn("Could not lock the screen to landscape:", error.message);
  }
}
function toggleFullscreen() {
  const displayContainer = document.querySelector(".display-container");
  const fullscreenElement = getFullscreenElement();
  if (displayContainer.classList.contains("fullscreen-fallback")) {
    displayContainer.classList.remove("fullscreen-fallback");
    updateFullscreenUi();
    return;
  }
  if (fullscreenElement) {
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exitFullscreen) exitFullscreen.call(document);
    return;
  }
  const requestFullscreen = displayContainer.requestFullscreen || displayContainer.webkitRequestFullscreen || displayContainer.mozRequestFullScreen || displayContainer.msRequestFullscreen;
  if (!requestFullscreen) {
    displayContainer.classList.add("fullscreen-fallback");
    updateFullscreenUi();
    return;
  }
  try {
    Promise.resolve(requestFullscreen.call(displayContainer)).then(lockLandscapeIfPortrait).catch((error) => {
      console.warn(
        "Native fullscreen unavailable; using display mode:",
        error
      );
      displayContainer.classList.add("fullscreen-fallback");
      updateFullscreenUi();
    });
  } catch (error) {
    console.warn("Native fullscreen unavailable; using display mode:", error);
    displayContainer.classList.add("fullscreen-fallback");
    updateFullscreenUi();
  }
}
[
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange"
].forEach(
  (eventName) => document.addEventListener(eventName, updateFullscreenUi)
);
function loadSong(song, startSeconds = 0, shouldPlay = true) {
  currentPerformerName = song.singer || song.requestedBy || "Karaoke performer";
  resetPitchScore();
  currentVideoId = song.videoId;
  setNoSongMessage(false);
  if (!window.tvPlayer) {
    console.log("\u{1F3AC} [FIRST LOAD] Creating player with karaoke song");
    window.tvPlayer = new YT.Player("videoPlayer", {
      videoId: song.videoId,
      playerVars: {
        autoplay: shouldPlay && !performerScreenModeActive ? 1 : 0,
        controls: 0,
        enablejsapi: 1,
        modestbranding: 1,
        fs: 0,
        start: Math.floor(Math.max(0, startSeconds))
      },
      events: {
        onReady: (e) => {
          console.log("\u{1F3AC} Karaoke Player Ready");
          playerReady = true;
          e.target.setVolume(activeRoomVolume);
          activeRoomMuted ? e.target.mute() : e.target.unMute();
          checkBootupCompletion();
          if (performerScreenModeActive) {
            e.target.pauseVideo();
            return;
          }
          const pendingResume = pendingTVPerformerResume;
          if (pendingResume) {
            pendingTVPerformerResume = null;
            if (pendingResume.videoId === (currentSong == null ? void 0 : currentSong.videoId)) {
              if (pendingResume.videoId !== currentVideoId) {
                currentVideoId = pendingResume.videoId;
                const video = {
                  videoId: pendingResume.videoId,
                  startSeconds: pendingResume.position
                };
                pendingResume.playing ? e.target.loadVideoById(video) : e.target.cueVideoById(video);
              } else {
                e.target.seekTo(pendingResume.position, true);
                pendingResume.playing ? e.target.playVideo() : e.target.pauseVideo();
              }
              return;
            }
          }
          if (startSeconds > 0) e.target.seekTo(startSeconds, true);
          if (!shouldPlay) {
            e.target.pauseVideo();
            return;
          }
          try {
            const playPromise = e.target.playVideo();
            if (playPromise && typeof playPromise.catch === "function") {
              playPromise.catch((error) => {
                console.warn("\u26A0\uFE0F Autoplay prevented:", error);
                e.target.mute();
                e.target.playVideo();
              });
            }
          } catch (err) {
            console.warn("\u26A0\uFE0F Play error caught:", err);
          }
        },
        onStateChange: onPlayerStateChange,
        onError: (e) => {
          console.error("\u274C Karaoke video error:", e.data);
          if (e.data === 150) {
            console.warn(
              "\u26A0\uFE0F Video blocked (error 150) - skipping to next song"
            );
            showVideoUnavailableMessage();
            setTimeout(() => {
              playNextSong();
            }, 3e3);
          } else if (e.data === 101) {
            console.warn(
              "\u26A0\uFE0F Video blocked by owner (error 101) - skipping to next song"
            );
            showVideoUnavailableMessage();
            setTimeout(() => {
              playNextSong();
            }, 3e3);
          }
        }
      }
    });
  } else {
    console.log("\u25B6\uFE0F [REUSE] Loading video:", song.videoId);
    const video = {
      videoId: song.videoId,
      startSeconds
    };
    shouldPlay ? window.tvPlayer.loadVideoById(video) : window.tvPlayer.cueVideoById(video);
    try {
      if (window.tvPlayer.isMuted && window.tvPlayer.isMuted()) {
        window.tvPlayer.unMute();
      }
    } catch (err) {
      console.warn("\u26A0\uFE0F Unmute error:", err);
    }
  }
  console.log(`\u{1F4FA} Now playing: ${song.title}`);
}
let lastConnectionStatus = null;
function checkPhoneConnection() {
  try {
    firebase.database().ref("activity").once("value", (snapshot) => {
      const activity = snapshot.val();
      const lastActivity = (activity == null ? void 0 : activity.timestamp) || 0;
      const now = Date.now();
      const isConnected = now - lastActivity < 3e4;
      if (isConnected) {
        console.log("\u2705 Phone connected");
      } else {
        console.log("\u274C Phone disconnected");
      }
      if (lastConnectionStatus !== isConnected) {
        lastConnectionStatus = isConnected;
        const message = isConnected ? "\u2705 Phone Connected!" : "\u274C Phone Disconnected";
        showNotification(message);
      }
      console.log(
        "\u{1F4F1} Phone connection status:",
        isConnected ? "Connected" : "Disconnected"
      );
    }).catch((err) => {
      console.warn("Firebase activity read failed:", err.message);
    });
  } catch (error) {
    console.error("\u274C Error in checkPhoneConnection:", error.message);
  }
}
function showNotification(message) {
  const notif = document.createElement("div");
  notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => {
    notif.style.animation = "slideOut 0.3s ease";
    setTimeout(() => notif.remove(), 300);
  }, 3e3);
}
function generateQRCode() {
  if (qrCodeGenerated || typeof QRCode === "undefined") {
    return;
  }
  const qrContainer = document.getElementById("qrcode");
  if (!qrContainer) return;
  qrContainer.innerHTML = "";
  if (!activeKaraokeRoomId) return;
  const singerPageUrl = KaraokeSessions.getJoinUrl(activeKaraokeRoomId);
  console.log("\u{1F4F1} QR Code URL:", singerPageUrl);
  new QRCode(qrContainer, {
    text: singerPageUrl,
    width: 110,
    height: 110,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  qrCodeGenerated = true;
}
function loadQueueData() {
  if (!activeKaraokeRoomId) return;
  KaraokeSessions.roomRef(activeKaraokeRoomId, "queue").once("value").then((snapshot) => {
    tvQueue = Array.isArray(snapshot.val()) ? snapshot.val() : Object.values(snapshot.val() || {});
    displayQueue();
    updateNextSongDisplay();
  }).catch(
    (error) => console.warn("Could not load active room queue:", error.message)
  );
}
function checkAndPlayCurrentSong() {
  if (!currentSong || !currentSong.videoId) {
    console.warn("\u26A0 No current song data");
    clearCurrentSongPlayback();
    return;
  }
  setNoSongMessage(false);
  if (!youtubeAPIReady || !player) {
    console.log("\u23F3 Player not ready yet, storing pending song");
    pendingSongToPlay = currentSong;
    return;
  }
  console.log("\u25B6 [6/7] Playing now:", currentSong.title);
  isLoadingSong = true;
  currentVideoId = currentSong.videoId;
  player.loadVideoById({
    videoId: currentSong.videoId,
    startSeconds: 0
  });
  displaySongInfo(currentSong);
  updateNextSongDisplay();
  pendingSongToPlay = null;
  isLoadingSong = false;
}
function setNoSongMessage(visible) {
  const message = document.getElementById("noSongMessage");
  if (message) message.style.display = visible ? "flex" : "none";
}
function clearCurrentSongPlayback() {
  var _a, _b;
  currentSong = null;
  currentVideoId = null;
  pendingSongToPlay = null;
  isLoadingSong = false;
  isPlaying = false;
  for (const activePlayer of new Set(
    [player, window.tvPlayer].filter(Boolean)
  )) {
    try {
      (_a = activePlayer.stopVideo) == null ? void 0 : _a.call(activePlayer);
      (_b = activePlayer.clearVideo) == null ? void 0 : _b.call(activePlayer);
    } catch (error) {
      console.warn("Could not clear the previous video:", error.message);
    }
  }
  setNoSongMessage(true);
  displayQueue();
  updateNextSongDisplay();
}
function displaySongInfo(song) {
  const centerPerformerName = document.getElementById("centerPerformerName");
  if (!centerPerformerName) return;
  centerPerformerName.classList.remove("show");
  centerPerformerName.innerHTML = "";
}
function playVideo(videoId, title, artist, singer) {
  const container = document.getElementById("videoPlayer");
  container.innerHTML = "";
  currentPerformerName = singer || "Unknown Performer";
  songDurationMs = 0;
  resetPitchScore();
  player = new YT.Player(container, {
    height: "100%",
    width: "100%",
    videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      fs: 1,
      playsinline: 1,
      enablejsapi: 1
    },
    events: {
      onReady: function(event) {
        try {
          const duration = event.target.getDuration();
          if (duration > 0) {
            songDurationMs = duration * 1e3;
            console.log(`\u23F1\uFE0F Song duration: ${duration}s (${songDurationMs}ms)`);
          }
          const playPromise = event.target.playVideo();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((error) => {
              console.warn("\u26A0\uFE0F Autoplay prevented:", error);
              event.target.mute();
              event.target.playVideo();
            });
          }
        } catch (err) {
          console.warn("\u26A0\uFE0F Play error:", err);
        }
      },
      onStateChange: onPlayerStateChange,
      onError: function(event) {
        console.error("\u274C YouTube player error:", event.data);
        if (event.data === 150 || event.data === 101) {
          console.warn(
            "\u26A0\uFE0F Video is blocked from embedding - skipping to next song"
          );
          showVideoUnavailableMessage();
          setTimeout(() => {
            playNextSong();
          }, 3e3);
        }
      }
    }
  });
}
function onPlayerStateChange(e) {
  var _a;
  const states = {
    [-1]: "UNSTARTED",
    0: "ENDED",
    1: "PLAYING",
    2: "PAUSED",
    3: "BUFFERING"
  };
  console.log(`\u{1F4CA} Player state changed to: ${states[e.data]}`);
  if (performerScreenModeActive) return;
  if (activeKaraokeRoomId && [
    YT.PlayerState.PLAYING,
    YT.PlayerState.PAUSED,
    YT.PlayerState.ENDED
  ].includes(e.data)) {
    const activePlayer = window.tvPlayer || player;
    const positionSeconds = Number((_a = activePlayer == null ? void 0 : activePlayer.getCurrentTime) == null ? void 0 : _a.call(activePlayer)) || 0;
    KaraokeSessions.setPlaybackState(
      activeKaraokeRoomId,
      e.data === YT.PlayerState.PLAYING,
      (currentSong == null ? void 0 : currentSong.videoId) || currentVideoId,
      positionSeconds
    ).catch(
      (error) => console.warn("Could not sync room playback state:", error.message)
    );
  }
  if (e.data === YT.PlayerState.ENDED) {
    if (isPlayingBootUpVideo) {
      console.log("\u2705 Boot-up video ended - transitioning to karaoke song");
      isPlayingBootUpVideo = false;
      bootUpVideoPlayed = true;
      hideBootupSplash();
      if (currentSong && currentSong.videoId && currentSong.videoId !== bootUpVideoId) {
        console.log("\u{1F4FA} Auto-loading karaoke:", currentSong.title);
        window.tvPlayer.loadVideoById({
          videoId: currentSong.videoId,
          startSeconds: 0
        });
        currentVideoId = currentSong.videoId;
      } else {
        console.warn("\u26A0\uFE0F No karaoke song ready after boot-up video");
      }
    } else {
      showScore();
    }
  }
}
function showScore() {
  return __async(this, null, function* () {
    var _a;
    const pitchSteadiness = pitchDetectedMs > 0 ? Math.min(1, Math.max(0, pitchStableMs / pitchDetectedMs)) : 0;
    const score = micScoringEnabled ? 75 + Math.round(pitchSteadiness * 25) : micScoringDeclined || micPermissionDenied ? 75 + Math.floor(Math.random() * 26) : null;
    const pitchSeconds = (pitchDetectedMs / 1e3).toFixed(1);
    const stableSeconds = (pitchStableMs / 1e3).toFixed(1);
    console.log("Mic pitch stability score:", score, {
      pitchSeconds,
      stableSeconds
    });
    displayScoreModal(score);
    const soundPlayed = yield playScoreSound();
    if (!soundPlayed) {
      yield new Promise((resolve) => setTimeout(resolve, 2600));
    }
    (_a = document.getElementById("scoreModal")) == null ? void 0 : _a.remove();
    playNextSong();
  });
}
function playScoreSound() {
  return unlockScoreAudio().then(
    () => new Promise((resolve) => {
      const source = scoreAudioContext.createBufferSource();
      const gain = scoreAudioContext.createGain();
      source.buffer = scoreAudioBuffer;
      gain.gain.value = scoreSoundVolume;
      source.connect(gain);
      gain.connect(scoreAudioContext.destination);
      source.addEventListener("ended", () => resolve(true), {
        once: true
      });
      source.start();
    })
  ).catch((error) => {
    console.warn("Could not play the score sound:", error.message);
    return false;
  });
}
function getScoreFeedback(score) {
  if (score === null) return "Try pitch scoring on the next song!";
  const feedbackByRange = score >= 95 ? ["Perfect!", "Excellent!", "Professional!", "Superstar!", "Great Job!"] : score >= 80 ? ["Good Job!", "Nice Try!", "Keep It Up!", "Not Bad!"] : [
    "Try Again!",
    "More Practice!",
    "Cheer Up!",
    "Better Luck Next Time!"
  ];
  return feedbackByRange[Math.floor(Math.random() * feedbackByRange.length)];
}
function displayScoreModal(score) {
  var _a;
  const existingModal = document.getElementById("scoreModal");
  existingModal == null ? void 0 : existingModal.remove();
  const modal = document.createElement("div");
  modal.id = "scoreModal";
  modal.className = "score-modal-overlay";
  modal.setAttribute("role", "status");
  modal.setAttribute("aria-live", "polite");
  const scoreDisplay = document.createElement("div");
  scoreDisplay.className = "score-modal-card";
  const title = document.createElement("h2");
  title.textContent = "Your score is";
  const value = document.createElement("div");
  value.className = "score-modal-value";
  value.textContent = score === null ? "--" : String(score);
  const feedback = document.createElement("p");
  feedback.className = "score-modal-feedback";
  feedback.textContent = getScoreFeedback(score);
  scoreDisplay.append(title, value, feedback);
  modal.appendChild(scoreDisplay);
  (_a = document.querySelector(".display-container")) == null ? void 0 : _a.appendChild(modal);
  const style2 = document.createElement("style");
  style2.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes bounceIn {
            0% {
                transform: scale(0.3);
                opacity: 0;
            }
            50% {
                transform: scale(1.05);
            }
            70% {
                transform: scale(0.9);
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }
        @keyframes popIn {
            0% {
                transform: scale(0) rotate(-45deg);
                opacity: 0;
            }
            100% {
                transform: scale(1) rotate(0deg);
                opacity: 1;
            }
        }
        @keyframes slideInDown {
            from {
                transform: translateY(-30px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        @keyframes slideInUp {
            from {
                transform: translateY(30px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        @keyframes scaleUp {
            0% {
                transform: scale(0);
                opacity: 0;
            }
            50% {
                transform: scale(1.1);
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }
    `;
  document.head.appendChild(style2);
}
function showVideoUnavailableMessage() {
  const existingMsg = document.getElementById("videoUnavailableMsg");
  if (existingMsg) {
    existingMsg.remove();
  }
  const modal = document.createElement("div");
  modal.id = "videoUnavailableMsg";
  modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        animation: fadeIn 0.4s ease;
        backdrop-filter: blur(2px);
    `;
  const msgDisplay = document.createElement("div");
  msgDisplay.style.cssText = `
        background: linear-gradient(135deg, #ff6b6b 0%, #dc3545 100%);
        border-radius: 30px;
        padding: 60px 80px;
        text-align: center;
        color: white;
        box-shadow: 0 20px 60px rgba(255, 107, 107, 0.5);
        animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    `;
  msgDisplay.innerHTML = `
        <div style="font-size: 3.5rem; font-weight: 900; margin-bottom: 20px; animation: popIn 0.5s ease 0.1s both;">\u26A0\uFE0F</div>
        <div style="font-size: 2rem; font-weight: 700; margin-bottom: 15px; animation: slideInDown 0.5s ease 0.2s both;">Video Unavailable</div>
        <div style="font-size: 1.3rem; margin-bottom: 20px; opacity: 0.95; animation: slideInDown 0.5s ease 0.3s both;">Please select another song</div>
    `;
  modal.appendChild(msgDisplay);
  document.body.appendChild(modal);
  setTimeout(() => {
    modal.style.animation = "fadeIn 0.4s ease reverse";
    setTimeout(() => {
      modal.remove();
    }, 400);
  }, 3e3);
}
function playNextSong() {
  if (!activeKaraokeRoomId) return;
  if (tvQueue.length === 0) {
    KaraokeSessions.roomRef(activeKaraokeRoomId, "currentSong").set(null).catch(
      (error) => console.warn("Could not clear finished song:", error.message)
    );
    clearCurrentSongPlayback();
    return;
  }
  const nextSong = tvQueue.shift();
  currentSong = {
    title: nextSong.title,
    artist: nextSong.artist,
    videoId: nextSong.videoId,
    requestedBy: nextSong.requestedBy,
    singer: nextSong.requestedBy
  };
  isPlaying = true;
  const updates = {};
  updates[`karaokeSessions/${activeKaraokeRoomId}/currentSong`] = currentSong;
  updates[`karaokeSessions/${activeKaraokeRoomId}/queue`] = tvQueue.length > 0 ? tvQueue : null;
  updates[`karaokeSessions/${activeKaraokeRoomId}/lastActivityAt`] = Date.now();
  firebase.database().ref().update(updates);
  displayQueue();
  checkAndPlayCurrentSong();
}
function displayQueue() {
  var _a;
  try {
    const nextSongDisplay = document.getElementById("nextSongDisplay");
    const nextSongList = document.getElementById("nextSongList");
    if (!nextSongDisplay || !nextSongList) return;
    const queue = Array.isArray(tvQueue) ? tvQueue : [];
    const firstQueuedSongIsPlaying = Boolean(
      (currentSong == null ? void 0 : currentSong.videoId) && ((_a = queue[0]) == null ? void 0 : _a.videoId) === currentSong.videoId
    );
    const upcomingSongs = queue.slice(
      firstQueuedSongIsPlaying ? 1 : 0,
      (firstQueuedSongIsPlaying ? 1 : 0) + 5
    ).filter(Boolean);
    nextSongList.replaceChildren(
      ...upcomingSongs.map((song, index) => {
        const item = document.createElement("li");
        const number = document.createElement("span");
        const details = document.createElement("span");
        const title = document.createElement("span");
        const requester = document.createElement("span");
        item.className = "next-song-item";
        number.className = "next-song-number";
        number.textContent = `${index + 1}.`;
        details.className = "next-song-details";
        title.className = "next-song-title";
        title.textContent = song.title || "Untitled song";
        requester.className = "next-song-requester";
        requester.textContent = song.requestedBy || "Performer";
        details.append(title, requester);
        item.append(number, details);
        return item;
      })
    );
    nextSongDisplay.hidden = upcomingSongs.length === 0;
  } catch (e) {
    console.warn("Error displaying queue:", e.message);
  }
}
function updateNextSongDisplay() {
  displayQueue();
}
function updateReserveList() {
  return;
}
function addSongToQueue(title, artist, requestedBy) {
  if (!activeKaraokeRoomId) return;
  const newSong = {
    id: Math.max(...tvQueue.map((s) => s.id || 0), 0) + 1,
    title,
    artist,
    requestedBy
  };
  tvQueue.push(newSong);
  KaraokeSessions.addSong(activeKaraokeRoomId, newSong).catch(
    (error) => console.warn("Could not add song to active room:", error.message)
  );
  displayQueue();
}
function skipToNextSong() {
  playNextSong();
}
function removeSongFromQueue(songId) {
  if (!activeKaraokeRoomId) return;
  tvQueue = tvQueue.filter((s) => s.id !== songId);
  KaraokeSessions.roomRef(activeKaraokeRoomId, "queue").set(
    tvQueue.length > 0 ? tvQueue : null
  );
  displayQueue();
}
function deleteQueue() {
  return __async(this, null, function* () {
    const password = yield showAppPrompt(
      "Enter admin password to clear queue:",
      "",
      {
        title: "Clear queue",
        inputType: "password",
        confirmLabel: "Continue"
      }
    );
    if (password === null) {
      return;
    }
    const users = JSON.parse(localStorage.getItem("karaoke_users") || "[]");
    const adminUser = users.find(
      (u) => u.role === "admin" && u.password === password
    );
    if (!adminUser) {
      showAppToast(
        "Incorrect password. Only admins can clear the queue.",
        "danger"
      );
      return;
    }
    if (yield showAppConfirm(
      "Are you sure you want to clear all songs from the queue?",
      {
        title: "Clear queue",
        confirmLabel: "Clear queue",
        danger: true
      }
    )) {
      tvQueue = [];
      clearCurrentSongPlayback();
      const updates = {};
      updates[`karaokeSessions/${activeKaraokeRoomId}/queue`] = null;
      updates[`karaokeSessions/${activeKaraokeRoomId}/currentSong`] = null;
      updates[`karaokeSessions/${activeKaraokeRoomId}/lastActivityAt`] = Date.now();
      updates[`karaokeSessions/${activeKaraokeRoomId}/emptySince`] = null;
      firebase.database().ref().update(updates);
      showAppToast("Queue cleared successfully!", "success");
    }
  });
}
function checkKaraokeDisplayEnabled(callback) {
  if (typeof firebase === "undefined" || !firebase.database) {
    console.log("\u26A0\uFE0F Firebase not available, defaulting to enabled");
    callback(true);
    return;
  }
  let checkCompleted = false;
  const finishCheck = (isEnabled) => {
    if (checkCompleted) return;
    checkCompleted = true;
    clearTimeout(timeoutId);
    callback(isEnabled);
  };
  const timeoutId = setTimeout(() => {
    console.warn(
      "\u26A0\uFE0F Firebase TV status check timed out; continuing as enabled"
    );
    finishCheck(true);
  }, 4e3);
  try {
    firebase.database().ref("tvControl").once("value", (snapshot) => {
      const settings = snapshot.val() || {};
      tvDisabledAnnouncement = settings.announcement || "";
      const isEnabled = settings.enabled !== false;
      console.log("\u{1F4FA} TV Enabled Status from Firebase:", isEnabled);
      finishCheck(isEnabled);
    }).catch((err) => {
      console.error("\u274C Firebase error checking TV status:", err.message);
      if (err.code === "PERMISSION_DENIED") {
        console.error(
          'Firebase Permission Denied - Update database rules to: { "rules": { ".read": true, ".write": true } }'
        );
      }
      finishCheck(true);
    });
  } catch (e) {
    console.error("Firebase exception:", e.message);
    finishCheck(true);
  }
}
function showKaraokeDisplayUnavailableMessage(announcement = tvDisabledAnnouncement) {
  karaokeDisplayEnabled = false;
  tvDisabledAnnouncement = announcement || "The karaoke display is temporarily unavailable. Please check back soon.";
  const splashScreen = document.getElementById("splashScreen");
  if (splashScreen) {
    splashScreen.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; color: white; text-align: center; background: linear-gradient(135deg, #1a0a2e 0%, #0f0f1e 100%); padding: 20px; box-sizing: border-box; font-family: Arial, sans-serif;">
                <div style="font-size: clamp(40px, 12vw, 100px); margin-bottom: clamp(15px, 5vw, 40px);">\u{1F534}</div>
                <h1 style="font-size: clamp(1.5rem, 8vw, 3.5rem); font-weight: 700; margin: 0 0 clamp(10px, 3vw, 25px) 0; letter-spacing: 2px;">KARAOKE DISPLAY</h1>
                <h2 style="font-size: clamp(1.2rem, 6vw, 2.5rem); font-weight: 500; margin: 0 0 clamp(8px, 2vw, 15px) 0; color: #ef4444;">TEMPORARILY UNAVAILABLE</h2>
                <p id="tvDisabledAnnouncement" style="font-size: clamp(0.9rem, 3.5vw, 1.3rem); color: #d5d9e3; margin: clamp(15px, 3vw, 30px) auto 0; max-width: 90%; line-height: 1.6;"></p>
                <p style="font-size: clamp(0.85rem, 3vw, 1.1rem); color: #999; margin: 14px auto 0; max-width: 90%; line-height: 1.6;">
                    Song reservations and playback are temporarily disabled.
                </p>
                <div style="margin-top: clamp(25px, 5vw, 50px); font-size: clamp(0.75rem, 2.5vw, 1rem); color: #666; line-height: 1.8;">
                    <p style="margin: 0;">Please wait for the administrator to restore service.</p>
                </div>
            </div>
        `;
    document.getElementById("tvDisabledAnnouncement").textContent = tvDisabledAnnouncement;
    splashScreen.style.display = "flex";
  }
  if (!tvAvailabilityListenerAttached && typeof firebase !== "undefined" && firebase.database) {
    try {
      firebase.database().ref("tvControl").on("value", (snapshot) => {
        const settings = snapshot.val() || {};
        if (settings.enabled !== false) {
          console.log("\u{1F4FA} TV has been re-enabled, reloading...");
          setTimeout(() => {
            location.reload();
          }, 1e3);
        } else if (settings.announcement) {
          tvDisabledAnnouncement = settings.announcement;
          const message = document.getElementById("tvDisabledAnnouncement");
          if (message) message.textContent = tvDisabledAnnouncement;
        }
      });
      tvAvailabilityListenerAttached = true;
    } catch (e) {
      console.warn("Error setting up listener:", e.message);
    }
  }
}
function showRoomDisplayUnavailableMessage(announcement) {
  const splashScreen = document.getElementById("splashScreen");
  if (!splashScreen) return;
  splashScreen.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:24px;box-sizing:border-box;background:linear-gradient(135deg,#1a0a2e,#0f0f1e);color:#fff;text-align:center;font-family:'DM Sans',sans-serif">
      <div style="font-size:clamp(40px,12vw,100px);margin-bottom:24px">&#128308;</div>
      <h1 style="margin:0 0 16px;font-size:clamp(1.5rem,8vw,3.5rem)">ROOM DISPLAY DISABLED</h1>
      <p id="roomDisabledAnnouncement" style="max-width:90%;color:#d5d9e3;font-size:clamp(1rem,3.5vw,1.3rem);line-height:1.6"></p>
    </div>`;
  document.getElementById("roomDisabledAnnouncement").textContent = announcement;
  splashScreen.style.display = "flex";
}
