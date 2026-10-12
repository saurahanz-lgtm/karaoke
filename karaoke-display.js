/* ===== KARAOKE DISPLAY LOGIC ===== */

// Add CSS for animations
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

// Queue data storage
let tvQueue = [];
let currentSong = null;
let player = null;
let isPlaying = false;
let youtubeAPIReady = false;
let useFirebase = false;
let firebaseListenersSet = false;
let pendingSongToPlay = null;

// A. GLOBAL FLAGS (REQUIRED)
let ytReady = false;
let firebaseReady = false;
let playerReady = false;
let isLoadingSong = false;
let currentVideoId = null;

// Boot-up video configuration (DISABLED)
// Skip boot-up video and go directly to karaoke songs
let isPlayingBootUpVideo = false;
let bootUpVideoPlayed = true; // Mark as already played to skip boot-up

// Boot-up splash screen management
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
let roomUsageSettings = null;
let roomUsageTimer = null;
let roomTimeExpired = false;
let activeRoomVolume = 70;
let activeRoomMuted = false;
let karaokeDisplayEnabled = true;
let tvDisabledAnnouncement = "";
let tvAvailabilityListenerAttached = false;
const KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY = "karaoke_tv_room_request_v1";
const EMPTY_ROOM_SONG_CLEANUP_DELAY_MS = 10 * 60 * 1000;
const EMPTY_ROOM_SONG_CLEANUP_STORAGE_PREFIX = "karaoke_empty_room_since_";
let stopListeningToKaraokeDisplayRoomRequest = null;
let activeKaraokeDisplayRoomRequestKey = null;
let tvRoomRequestPollTimer = null;
let emptyRoomSongCleanupTimer = null;
let emptyRoomSongCleanupRoomId = null;

// SCORING SYSTEM
let currentPerformerName = "";
let songDurationMs = 0;
let microphoneStream = null;
let microphoneAudioContext = null;
let microphoneAnalyser = null;
let microphoneSamples = null;
let micScoringEnabled = false;
let micActivityMs = 0;
let micObservedPlayingMs = 0;
let micNoiseFloorRms = 0.006;
let lastMicSampleAt = null;
let micSamplingTimer = null;
const MIC_MIN_ACTIVITY_RMS = 0.02;

function showMicConsentDialog() {
  document.getElementById("micConsentDialog")?.showModal();
}

async function enableMicScoring() {
  const dialog = document.getElementById("micConsentDialog");
  const allowButton = document.getElementById("allowMicScoringButton");
  const status = document.getElementById("micConsentStatus");
  if (allowButton) allowButton.disabled = true;
  if (status) status.textContent = "Waiting for microphone permission...";

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires HTTPS or localhost.");
    }

    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support microphone scoring.");
    }

    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });
    microphoneAudioContext = new AudioContextConstructor();
    microphoneAnalyser = microphoneAudioContext.createAnalyser();
    microphoneAnalyser.fftSize = 2048;
    microphoneSamples = new Float32Array(microphoneAnalyser.fftSize);
    microphoneAudioContext
      .createMediaStreamSource(microphoneStream)
      .connect(microphoneAnalyser);
    await microphoneAudioContext.resume();

    micScoringEnabled = true;
    lastMicSampleAt = null;
    micSamplingTimer = window.setInterval(sampleMicrophoneActivity, 100);
    if (status) {
      status.textContent =
        "Mic activity scoring is on. Audio stays on this device and is not recorded or sent.";
    }
    if (dialog?.open) dialog.close("allowed");
  } catch (error) {
    stopMicScoring();
    if (status) {
      status.textContent =
        error.message ||
        "Microphone access was denied. Karaoke will continue without scoring.";
    }
  } finally {
    if (allowButton) allowButton.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", showMicConsentDialog, {
  once: true,
});

function stopMicScoring() {
  micScoringEnabled = false;
  lastMicSampleAt = null;
  if (micSamplingTimer !== null) {
    window.clearInterval(micSamplingTimer);
    micSamplingTimer = null;
  }
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  microphoneAnalyser = null;
  microphoneSamples = null;
  if (microphoneAudioContext && microphoneAudioContext.state !== "closed") {
    microphoneAudioContext.close().catch(() => {});
  }
  microphoneAudioContext = null;
}

function sampleMicrophoneActivity() {
  if (!micScoringEnabled || !microphoneAnalyser || !microphoneSamples) return;

  microphoneAnalyser.getFloatTimeDomainData(microphoneSamples);
  let sumSquares = 0;
  for (const sample of microphoneSamples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / microphoneSamples.length);
  const now = performance.now();
  const activePlayer = window.tvPlayer || player;
  const isSongPlaying =
    typeof YT !== "undefined" &&
    activePlayer &&
    activePlayer.getPlayerState?.() === YT.PlayerState.PLAYING;

  if (!isSongPlaying) {
    micNoiseFloorRms = micNoiseFloorRms * 0.9 + rms * 0.1;
    lastMicSampleAt = now;
    return;
  }

  if (lastMicSampleAt === null) {
    lastMicSampleAt = now;
    return;
  }

  const elapsedMs = Math.min(now - lastMicSampleAt, 200);
  lastMicSampleAt = now;
  micObservedPlayingMs += elapsedMs;
  const activityThreshold = Math.max(
    MIC_MIN_ACTIVITY_RMS,
    micNoiseFloorRms * 2.5,
  );
  if (rms >= activityThreshold) micActivityMs += elapsedMs;
}

window.addEventListener("pagehide", stopMicScoring);

function hideBootupSplash() {
  if (bootupHidden) return; // Only hide once
  bootupHidden = true;

  const splash = document.getElementById("bootupSplash");
  if (splash) {
    splash.classList.add("hidden");
    console.log("✅ Boot-up splash hidden");
  }
}

function checkBootupCompletion() {
  const timeSinceStart = Date.now() - bootupStartTime;

  // Boot-up video disabled - hide splash when systems ready or minimum 1 second passed
  if (firebaseReady && ytReady && timeSinceStart >= 500) {
    console.log("✅ Systems ready - hiding splash");
    hideBootupSplash();
    return true;
  }

  // Fallback timeout - hide after 3 seconds (reduced from 5)
  if (timeSinceStart >= 3000) {
    console.log("⏱️ Timeout - hiding splash");
    hideBootupSplash();
    return true;
  }

  return false;
}

// Check if Firebase is properly configured
function isFirebaseConfigured() {
  try {
    if (
      typeof firebase !== "undefined" &&
      firebase.database &&
      firebase.app()
    ) {
      const config = firebase.app().options;
      // Check if all required fields are present and not placeholders
      return config.databaseURL && !config.databaseURL.includes("YOUR_");
    }
  } catch (e) {
    return false;
  }
  return false;
}

function renderKaraokeRooms() {
  const activeRoom = karaokeRooms.find(
    (room) => room.id === activeKaraokeRoomId,
  );
  const name = document.getElementById("activeRoomName");
  const code = document.getElementById("activeRoomCode");
  if (name) name.textContent = activeRoom?.name || "Room unavailable";
  if (code) code.textContent = activeRoom ? `Room ID: ${activeRoom.id}` : "";
}

function activateKaraokeRoom(roomId) {
  if (!roomId || (roomId === activeKaraokeRoomId && stopListeningToRoom))
    return;

  clearEmptyRoomSongCleanupTimer();
  stopListeningToRoom?.();
  stopListeningToMembers?.();
  stopListeningToRoomVolume?.();
  stopListeningToRoomMuted?.();
  stopListeningToRoomDisplayStatus?.();
  stopListeningToRoomDisplayStatus = null;
  stopListeningToRoomUsage?.();
  stopListeningToRoomUsage = null;
  activeKaraokeRoomId = roomId;
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
    label.textContent = `${room?.name || "Karaoke Room"} · Scan to Join`;
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
            singer: firstSong.requestedBy,
          };
          KaraokeSessions.roomRef(roomId, "currentSong").transaction(
            (current) => (current?.videoId ? undefined : firstCurrentSong),
          );
        }
        displayQueue();
        updateNextSongDisplay();
        checkBootupCompletion();
      },
      onCurrentSong: (song) => {
        if (!karaokeDisplayEnabled) return;
        if (!song?.videoId) {
          clearCurrentSongPlayback();
          return;
        }
        currentSong = song;
        setNoSongMessage(false);
        displayQueue();
        updateNextSongDisplay();
        tryInitPlayback();
      },
      onControl: handleRoomControl,
    },
    (error) => console.error("Karaoke room listener error:", error.message),
  );

  stopListeningToMembers = KaraokeSessions.listenMembers(roomId, (count) => {
    const memberCount = document.getElementById("roomMemberCount");
    if (memberCount) {
      memberCount.textContent = `${count} / ${KaraokeSessions.MAX_DEVICES} phones`;
    }
    scheduleEmptyRoomSongCleanup(roomId, count);
  });

  stopListeningToRoomDisplayStatus = KaraokeSessions.listenRoomDisplayStatus(
    roomId,
    (settings) => {
      const wasRoomDisabled = !roomDisplayEnabled;
      roomDisplayEnabled = settings.enabled !== false;
      if (!roomDisplayEnabled) {
        karaokeDisplayEnabled = false;
        tvDisabledAnnouncement =
          settings.announcement ||
          "The karaoke display in this room is temporarily unavailable.";
        stopListeningToRoom?.();
        stopListeningToRoom = null;
        stopListeningToRoomVolume?.();
        stopListeningToRoomVolume = null;
        stopListeningToRoomMuted?.();
        stopListeningToRoomMuted = null;
        clearCurrentSongPlayback();
        showRoomDisplayUnavailableMessage(tvDisabledAnnouncement);
      } else if (wasRoomDisabled) {
        window.location.reload();
      }
    },
    (error) =>
      console.warn("Could not load room display status:", error.message),
  );

  stopListeningToRoomUsage = KaraokeSessions.listenRoomUsage(
    roomId,
    updateKaraokeDisplayRoomUsage,
    (error) => console.warn("Could not follow room time limit:", error.message),
  );
}

function updateKaraokeDisplayRoomUsage(settings = {}) {
  roomUsageSettings = settings;
  if (roomUsageTimer === null) {
    roomUsageTimer = setInterval(renderKaraokeDisplayRoomTime, 1000);
  }
  renderKaraokeDisplayRoomTime();
}

function renderKaraokeDisplayRoomTime() {
  const notice = document.getElementById("roomTimeNotice");
  if (!notice) return;
  const timeLimit = Number(roomUsageSettings?.timeLimitMinutes);
  const expiresAt = Number(roomUsageSettings?.expiresAt);
  if (
    !Number.isFinite(timeLimit) ||
    timeLimit <= 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0
  ) {
    notice.hidden = true;
    notice.classList.remove("is-expired");
    if (roomTimeExpired) window.location.reload();
    return;
  }

  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    if (!roomTimeExpired) {
      roomTimeExpired = true;
      karaokeDisplayEnabled = false;
      stopListeningToRoom?.();
      stopListeningToRoom = null;
      stopListeningToRoomVolume?.();
      stopListeningToRoomVolume = null;
      stopListeningToRoomMuted?.();
      stopListeningToRoomMuted = null;
      clearCurrentSongPlayback();
    }
    notice.classList.add("is-expired");
    notice.textContent =
      "Room time expired. A performer can request additional time; playback resumes after admin approval.";
    notice.hidden = false;
    return;
  }

  if (roomTimeExpired) {
    window.location.reload();
    return;
  }

  const warningWindow = Math.min(5 * 60000, timeLimit * 60000 * 0.2);
  notice.classList.remove("is-expired");
  notice.hidden = remainingMs > warningWindow;
  if (!notice.hidden) {
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const remaining = hours
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes}m ${seconds}s`;
    notice.textContent = `Room time is almost up. ${remaining} remaining.`;
  }
}

function clearEmptyRoomSongCleanupTimer() {
  if (emptyRoomSongCleanupTimer !== null) {
    clearTimeout(emptyRoomSongCleanupTimer);
    emptyRoomSongCleanupTimer = null;
  }
  emptyRoomSongCleanupRoomId = null;
}

function scheduleEmptyRoomSongCleanup(roomId, memberCount) {
  const storageKey = `${EMPTY_ROOM_SONG_CLEANUP_STORAGE_PREFIX}${roomId}`;
  if (memberCount > 0) {
    clearEmptyRoomSongCleanupTimer();
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn("Could not reset empty-room cleanup timer:", error.message);
    }
    return;
  }
  if (
    emptyRoomSongCleanupRoomId === roomId &&
    emptyRoomSongCleanupTimer !== null
  )
    return;

  clearEmptyRoomSongCleanupTimer();
  let emptySince = 0;
  try {
    emptySince = Number(localStorage.getItem(storageKey));
  } catch (error) {
    console.warn("Could not restore empty-room cleanup timer:", error.message);
  }
  if (
    !Number.isFinite(emptySince) ||
    emptySince <= 0 ||
    emptySince > Date.now()
  ) {
    emptySince = Date.now();
    try {
      localStorage.setItem(storageKey, String(emptySince));
    } catch (error) {
      console.warn(
        "Could not persist empty-room cleanup timer:",
        error.message,
      );
    }
  }

  emptyRoomSongCleanupRoomId = roomId;
  emptyRoomSongCleanupTimer = setTimeout(
    async () => {
      emptyRoomSongCleanupTimer = null;
      emptyRoomSongCleanupRoomId = null;
      if (activeKaraokeRoomId !== roomId) return;
      try {
        const cleared =
          await KaraokeSessions.clearRoomSongsIfUnoccupied(roomId);
        if (cleared) {
          console.log(`Cleared reserved songs from empty room ${roomId}`);
        }
        localStorage.removeItem(storageKey);
      } catch (error) {
        console.warn(
          `Could not clear songs from empty room ${roomId}:`,
          error.message,
        );
        try {
          const retryTimestamp =
            Date.now() - EMPTY_ROOM_SONG_CLEANUP_DELAY_MS + 60000;
          localStorage.setItem(storageKey, String(retryTimestamp));
        } catch (storageError) {
          console.warn(
            "Could not persist empty-room cleanup retry:",
            storageError.message,
          );
        }
      }
    },
    Math.max(0, EMPTY_ROOM_SONG_CLEANUP_DELAY_MS - (Date.now() - emptySince)),
  );
}

async function chooseInitialKaraokeDisplayRoomId(rooms, globalActiveRoomId) {
  const requestState = readKaraokeDisplayRoomRequestState();
  if (
    ["creating", "pending", "rejected", "missing"].includes(
      requestState?.status,
    )
  ) {
    return null;
  }
  if (
    requestState?.status === "approved" &&
    rooms.some((room) => room.id === requestState.approvedRoomId)
  ) {
    return requestState.approvedRoomId;
  }

  const requestedRoomId = KaraokeSessions.getRoomIdFromUrl();
  const roomCounts = new Map(
    await Promise.all(
      rooms.map(async (room) => [
        room.id,
        await KaraokeSessions.getActiveMemberCount(room.id),
      ]),
    ),
  );
  const savedRoomId = sessionStorage.getItem("karaokeTvRoomId");
  const retainedOccupiedRoomId = [requestedRoomId, savedRoomId].find(
    (roomId) =>
      rooms.some((room) => room.id === roomId) &&
      (roomCounts.get(roomId) || 0) > 0,
  );
  if (retainedOccupiedRoomId) return retainedOccupiedRoomId;

  const emptyRooms = rooms
    .filter((room) => (roomCounts.get(room.id) || 0) === 0)
    .sort((first, second) => (first.createdAt || 0) - (second.createdAt || 0));
  const preferredEmptyRoomId = [
    requestedRoomId,
    savedRoomId,
    globalActiveRoomId,
  ].find((roomId) => emptyRooms.some((room) => room.id === roomId));
  return preferredEmptyRoomId || emptyRooms[0]?.id || null;
}

function readKaraokeDisplayRoomRequestState() {
  try {
    return JSON.parse(
      localStorage.getItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY) || "null",
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
      JSON.stringify(state),
    );
  } catch (error) {
    console.warn("Could not save TV room request state:", error.message);
  }
}

function showKaraokeDisplayRoomRequestStatus(
  title,
  message,
  rejected = false,
  retryAnchorRoomId = null,
) {
  const splash = document.getElementById("splashScreen");
  if (!splash) return;
  splash.innerHTML = `
    <section style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:24px;box-sizing:border-box;background:#080b13;color:#fff;text-align:center;font-family:'DM Sans',sans-serif">
      <div aria-hidden="true" style="display:grid;place-items:center;width:60px;height:60px;margin-bottom:22px;border:1px solid ${rejected ? "#c45b68" : "#3c8b80"};border-radius:50%;color:${rejected ? "#ff9eac" : "#7fe0c3"};font-size:30px">${rejected ? "!" : "…"}</div>
      <h1 id="tvRoomRequestTitle" style="max-width:min(90vw,800px);margin:0;color:#f0f3ff;font-size:clamp(1.5rem,4vw,3rem)"></h1>
      <p id="tvRoomRequestMessage" style="max-width:min(86vw,760px);margin:18px 0 0;color:#b6c3dc;font-size:clamp(1rem,2.2vw,1.4rem);line-height:1.6;overflow-wrap:anywhere"></p>
    </section>
  `;
  splash.querySelector("#tvRoomRequestTitle").textContent = title;
  splash.querySelector("#tvRoomRequestMessage").textContent = message;
  if (rejected && retryAnchorRoomId) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Request another room";
    retryButton.style.cssText =
      "margin-top:24px;padding:12px 20px;border:0;border-radius:8px;background:#315cfb;color:#fff;font:600 1rem 'DM Sans',sans-serif;cursor:pointer";
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
  stopListeningToKaraokeDisplayRoomRequest?.();
  activeKaraokeDisplayRoomRequestKey = listenerKey;
  stopListeningToKaraokeDisplayRoomRequest = KaraokeSessions.listenRoomRequest(
    state.anchorRoomId,
    state.requestId,
    async (request) => {
      const currentState = readKaraokeDisplayRoomRequestState() || state;
      if (!request) {
        currentState.status = "missing";
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Room request unavailable",
          "The request could not be found. Please contact the administrator.",
          true,
          currentState.anchorRoomId,
        );
      } else if (request.status === "approved" && request.approvedRoomId) {
        currentState.status = "approved";
        currentState.approvedRoomId = request.approvedRoomId;
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Room approved",
          "Connecting this karaoke display to the new room...",
        );
        const roomSnapshot = await firebase
          .database()
          .ref(`karaokeRooms/${request.approvedRoomId}`)
          .once("value");
        const room = roomSnapshot.val();
        if (!room) return;
        if (!karaokeRooms.some((item) => item.id === request.approvedRoomId)) {
          karaokeRooms.push({ ...room, id: request.approvedRoomId });
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
          currentState.anchorRoomId,
        );
      } else if (request.status === "approving") {
        showKaraokeDisplayRoomRequestStatus(
          "Waiting for approval",
          "The administrator is processing your request. Please wait.",
        );
      } else {
        currentState.status = "pending";
        saveKaraokeDisplayRoomRequestState(currentState);
        showKaraokeDisplayRoomRequestStatus(
          "Waiting for approval",
          "No unoccupied room is available. A request was sent to the administrator.",
        );
      }
    },
    (error) => {
      console.error("Could not follow TV room request:", error.message);
      showKaraokeDisplayRoomRequestStatus(
        "Waiting for approval",
        "The room request was sent, but its status cannot be checked right now.",
      );
    },
  );
}

async function requestKaraokeDisplayRoomApproval(anchorRoomId) {
  const existingRequest = readKaraokeDisplayRoomRequestState();
  if (existingRequest?.status === "pending" && existingRequest.requestId) {
    listenToKaraokeDisplayRoomRequest(existingRequest);
    return;
  }
  if (existingRequest?.status === "approved") {
    const approvedRoom = karaokeRooms.find(
      (room) => room.id === existingRequest.approvedRoomId,
    );
    if (approvedRoom) {
      hideKaraokeDisplayRoomRequestStatus();
      activateKaraokeRoom(approvedRoom.id);
      return;
    }
    localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
  }
  if (
    existingRequest?.status === "rejected" ||
    existingRequest?.status === "missing"
  ) {
    showKaraokeDisplayRoomRequestStatus(
      "Room request rejected",
      "The administrator could not open another room. Please contact them for assistance.",
      true,
      existingRequest.anchorRoomId || anchorRoomId,
    );
    return;
  }
  if (existingRequest?.status === "creating") {
    showKaraokeDisplayRoomRequestStatus(
      "Waiting for approval",
      "Your room request is being sent to the administrator...",
    );
    if (!tvRoomRequestPollTimer) {
      tvRoomRequestPollTimer = setInterval(() => {
        const latestRequest = readKaraokeDisplayRoomRequestState();
        if (latestRequest?.status === "pending" && latestRequest.requestId) {
          clearInterval(tvRoomRequestPollTimer);
          tvRoomRequestPollTimer = null;
          listenToKaraokeDisplayRoomRequest(latestRequest);
        } else if (!latestRequest) {
          clearInterval(tvRoomRequestPollTimer);
          tvRoomRequestPollTimer = null;
          requestKaraokeDisplayRoomApproval(anchorRoomId);
        } else if (
          latestRequest.status === "creating" &&
          Date.now() - latestRequest.createdAt > 30000
        ) {
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
    showKaraokeDisplayRoomRequestStatus(
      "Waiting for approval",
      "No room is available. Waiting for the administrator to add one.",
    );
    return;
  }

  const creatingState = {
    status: "creating",
    anchorRoomId,
    createdAt: Date.now(),
  };
  saveKaraokeDisplayRoomRequestState(creatingState);
  showKaraokeDisplayRoomRequestStatus(
    "Waiting for approval",
    "No unoccupied room is available. Sending a request to the administrator...",
  );
  try {
    const request = await KaraokeSessions.createRoomRequest(
      "Karaoke Display",
      anchorRoomId,
    );
    const pendingState = {
      status: "pending",
      anchorRoomId,
      requestId: request.id,
      createdAt: request.createdAt,
    };
    saveKaraokeDisplayRoomRequestState(pendingState);
    listenToKaraokeDisplayRoomRequest(pendingState);
  } catch (error) {
    localStorage.removeItem(KARAOKE_DISPLAY_ROOM_REQUEST_STORAGE_KEY);
    console.error("Could not request another TV room:", error.message);
    showKaraokeDisplayRoomRequestStatus(
      "Room request failed",
      "Could not send the room request. Check the connection and reload this page.",
      true,
    );
  }
}

function initializeKaraokeRooms() {
  KaraokeSessions.ensureDefaultRoom()
    .then(async () => {
      const activeRoomId = await KaraokeSessions.getActiveRoomId();
      stopListeningToRooms = KaraokeSessions.listenRooms((rooms) => {
        karaokeRooms = rooms;
        renderKaraokeRooms();

        if (!rooms.some((room) => room.id === activeKaraokeRoomId)) {
          if (!initialRoomSelectionInProgress) {
            initialRoomSelectionInProgress = true;
            chooseInitialKaraokeDisplayRoomId(rooms, activeRoomId)
              .then((roomId) => {
                if (
                  roomId &&
                  !rooms.some((room) => room.id === activeKaraokeRoomId)
                ) {
                  activateKaraokeRoom(roomId);
                } else if (!roomId) {
                  requestKaraokeDisplayRoomApproval(
                    activeRoomId || rooms[0]?.id || null,
                  );
                }
              })
              .catch((error) =>
                console.warn("Could not select the TV room:", error.message),
              )
              .finally(() => {
                initialRoomSelectionInProgress = false;
              });
          }
        }

        const activeRoom = rooms.find(
          (room) => room.id === activeKaraokeRoomId,
        );
        const label = document.getElementById("roomCodeLabel");
        if (activeRoom && label) {
          label.textContent = `${activeRoom.name} · Scan to Join`;
        }
      });
    })
    .catch((error) => {
      console.error("Could not initialize karaoke rooms:", error.message);
    });
}

function handleRoomControl(control) {
  if (!karaokeDisplayEnabled || !control?.command) return;
  console.log("📱 Room control command received:", control.command);

  switch (control.command) {
    case "togglePlay":
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
      if (window.tvPlayer && currentSong) {
        window.tvPlayer.seekTo(0);
        window.tvPlayer.playVideo();
      }
      break;
    case "toggleMute":
      if (!window.tvPlayer) return;
      window.tvPlayer.isMuted()
        ? window.tvPlayer.unMute()
        : window.tvPlayer.mute();
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

// Initialize karaoke display
document.addEventListener("DOMContentLoaded", function () {
  console.log("📺 [1/7] Karaoke Display DOMContentLoaded");
  console.log("🔍 DEBUG: window.YT =", typeof window.YT);
  console.log("🔍 DEBUG: window.firebase =", typeof window.firebase);

  // Check if the display is enabled before initializing
  checkKaraokeDisplayEnabled(function (isEnabled) {
    karaokeDisplayEnabled = isEnabled;
    if (!isEnabled) {
      console.warn("⚠️ Karaoke Display is DISABLED");
      showKaraokeDisplayUnavailableMessage(tvDisabledAnnouncement);
      return;
    }

    // the display is enabled, proceed with normal initialization
    initializeKaraokeDisplay();
  });
});

// Initialize Karaoke Display (after checking if enabled)
function initializeKaraokeDisplay() {
  // Debug Firebase config
  try {
    const config = firebase.app().options;
    console.log("🔍 DEBUG: Firebase config:", {
      databaseURL: config.databaseURL,
      projectId: config.projectId,
      apiKey: config.apiKey ? "***" : "MISSING",
    });
  } catch (err) {
    console.error("❌ Firebase not initialized:", err.message);
  }

  // Defer QR code generation until after page is visible
  if (document.hidden) {
    document.addEventListener(
      "visibilitychange",
      function () {
        if (!document.hidden && !qrCodeGenerated) {
          generateQRCode();
        }
      },
      { once: true },
    );
  } else {
    // Only generate QR on first visibility
    setTimeout(generateQRCode, 100);
  }

  // Regenerate QR code every 10 seconds to ensure it's always fresh
  setInterval(generateQRCode, 10000);

  // [1] Check if Firebase is available FIRST
  useFirebase = isFirebaseConfigured();
  console.log("🔍 DEBUG: useFirebase =", useFirebase);

  if (!useFirebase) {
    console.error(
      "❌ Firebase not configured - Karaoke Display requires Firebase",
    );
    return;
  }

  console.log("🔥 Firebase configured, waiting for data...");

  // [2] Initialize Firebase listeners IMMEDIATELY (don't wait for YouTube API)
  console.log("⏱️ Initializing Firebase listeners immediately...");
  try {
    initializeFirebaseListeners();
  } catch (err) {
    console.error("❌ Error initializing Firebase listeners early:", err);
  }

  // Fallback: If YouTube API doesn't load within 3 seconds, force ytReady (reduced from 5s)
  setTimeout(() => {
    console.log("⏱️ [3s timeout check] ytReady =", ytReady);
    if (!ytReady) {
      console.warn(
        "⚠️ YouTube API not responding, forcing ytReady=true after 3s",
      );
      ytReady = true;
      createYouTubePlayer();
      checkBootupCompletion();
    }
  }, 3000);

  // Check boot-up completion every 300ms (faster updates)
  const bootupCheckInterval = setInterval(() => {
    if (checkBootupCompletion()) {
      clearInterval(bootupCheckInterval);
    }
  }, 300);

  // Now check connection status
  checkPhoneConnection();
  console.log("✅ Initial connection check done");

  // Check connection status every 2 seconds (less frequent)
  setInterval(checkPhoneConnection, 2000);

  // Listen for TV disable status changes in real-time
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      firebase
        .database()
        .ref("tvControl")
        .on("value", (snapshot) => {
          const settings = snapshot.val() || {};
          const isEnabled = settings.enabled !== false;
          console.log(
            "📺 TV Status Changed:",
            isEnabled ? "ENABLED" : "DISABLED",
          );

          if (!isEnabled) {
            karaokeDisplayEnabled = false;
            tvDisabledAnnouncement =
              settings.announcement ||
              "The karaoke display is temporarily unavailable. Please check back soon.";
            console.warn("⚠️ Karaoke Display has been DISABLED by admin");
            stopListeningToRoom?.();
            stopListeningToRoom = null;
            stopListeningToMembers?.();
            stopListeningToMembers = null;
            stopListeningToRoomVolume?.();
            stopListeningToRoomVolume = null;
            stopListeningToRoomMuted?.();
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

  // Refresh QR code when page becomes visible (user switches back to this tab)
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      generateQRCode();
    }
  });

  // Listen for storage changes from other tabs/windows (real-time sync with performer-portal.html)
  window.addEventListener("storage", function (e) {
    if (e.key === "karaoke_queue" || e.key === "karaoke_current_song") {
      console.log("📡 Storage change detected from other tab:", e.key);
    }
  });

  // Listen for custom karaoke queue update events (same window only)
  window.addEventListener("karaoke-queue-updated", function (e) {
    console.log("🎵 Queue updated from singer control:", e.detail);
    loadQueueData();
    displayQueue();
    checkAndPlayCurrentSong();
  });
}

/* ===== FIREBASE LISTENERS ===== */

function initializeLegacyFirebaseListeners() {
  console.log("🔥 [3/7] Attaching Firebase listeners");
  console.log("🔍 DEBUG: firebaseListenersSet =", firebaseListenersSet);

  if (firebaseListenersSet) {
    console.log("⚠️ Firebase listeners already initialized, skipping...");
    return;
  }

  firebaseListenersSet = true; // Mark as initialized
  const db = firebase.database();

  console.log("🔍 DEBUG: Firebase database object:", typeof db);

  db.ref("queue").on(
    "value",
    (snapshot) => {
      const data = snapshot.val();
      console.log("🔍 DEBUG: Queue snapshot received:", {
        data: data,
        isEmpty: !data,
        isArray: Array.isArray(data),
        type: typeof data,
      });

      // Mark Firebase as ready even if queue is empty
      firebaseReady = true;

      if (!data) {
        tvQueue = [];
        console.log("📡 Queue is empty (no songs yet)");
      } else {
        // Convert Firebase object to array (Firebase stores objects, not arrays)
        // Handle both array and object formats from Firebase
        if (Array.isArray(data)) {
          tvQueue = data;
        } else if (typeof data === "object") {
          // Convert object with numeric keys to array
          tvQueue = Object.values(data);
        } else {
          tvQueue = [];
        }

        // Filter out any invalid entries
        tvQueue = tvQueue.filter(
          (song) => song && song.title && song.videoId && song.requestedBy,
        );

        console.log(
          "📡 Queue loaded from Firebase:",
          tvQueue.length,
          "valid songs",
        );
        console.log(
          "📡 Queue details:",
          tvQueue.map((s) => ({ title: s.title, requestedBy: s.requestedBy })),
        );

        // Sync queue back to localStorage
        try {
          localStorage.setItem("karaoke_queue", JSON.stringify(tvQueue));
          console.log("✅ Queue synced to localStorage");
        } catch (e) {
          console.warn("⚠️ Could not sync queue to localStorage:", e.message);
        }

        // Auto-play first song if no current song and queue has songs
        if (tvQueue.length > 0 && (!currentSong || !currentSong.videoId)) {
          console.log("▶️ Auto-playing first song in queue...");
          const firstSong = tvQueue[0];
          currentSong = {
            title: firstSong.title,
            artist: firstSong.artist,
            videoId: firstSong.videoId,
            requestedBy: firstSong.requestedBy,
            singer: firstSong.requestedBy,
          };
          // Update Firebase with current song
          firebase.database().ref("currentSong").set(currentSong);
          tryInitPlayback();
        }
      }

      // Always update display when queue changes
      console.log(
        "📺 Updating karaoke display - Queue has",
        tvQueue.length,
        "songs",
      );

      // Ensure DOM elements are ready before updating display
      setTimeout(() => {
        displayQueue();
        updateNextSongDisplay();

        // Check if bootup can be hidden
        checkBootupCompletion();
      }, 0);
    },
    (error) => {
      console.error("❌ Firebase queue listener error:", error);
    },
  );

  // Also listen to localStorage changes (cross-tab sync)
  window.addEventListener("storage", (e) => {
    if (e.key === "karaoke_queue" && e.newValue) {
      try {
        const localQueue = JSON.parse(e.newValue);
        if (Array.isArray(localQueue) && localQueue.length > tvQueue.length) {
          console.log(
            "📱 Queue updated from other tab/window, syncing to Firebase",
          );
          firebase
            .database()
            .ref("queue")
            .set(localQueue)
            .catch((err) => {
              console.warn(
                "Could not sync localStorage queue to Firebase:",
                err.message,
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
      console.log("🔍 DEBUG: CurrentSong snapshot received:", data);

      if (!data || !data.videoId) {
        console.log("📻 No current song in Firebase");
        clearCurrentSongPlayback();
        return;
      }

      console.log("🎬 Current song updated:", {
        title: data.title,
        artist: data.artist,
        videoId: data.videoId,
        requestedBy: data.requestedBy,
        timestamp: data.timestamp,
      });

      currentSong = data;
      firebaseReady = true;
      setNoSongMessage(false);

      // Update display immediately
      displayQueue();
      updateNextSongDisplay();

      // Check if bootup can be hidden
      checkBootupCompletion();

      // Try to initialize and play
      tryInitPlayback();
    },
    (error) => {
      console.error("❌ Firebase currentSong listener error:", error);
    },
  );

  // 🔥 Listen for control commands from performer portal
  db.ref("control").on(
    "value",
    (snapshot) => {
      const control = snapshot.val();
      if (!control || !control.command) return;

      console.log("📱 Control command received:", control.command);

      switch (control.command) {
        case "togglePlay":
          if (
            window.tvPlayer &&
            window.tvPlayer.getPlayerState() === YT.PlayerState.PLAYING
          ) {
            window.tvPlayer.pauseVideo();
            console.log("⏸ Paused via remote");
          } else if (window.tvPlayer) {
            window.tvPlayer.playVideo();
            console.log("▶️ Playing via remote");
          }
          break;

        case "skip":
          console.log("⏭️ Skipping to next song via remote");
          playNextSong();
          break;

        case "restart":
          if (window.tvPlayer && currentSong) {
            window.tvPlayer.seekTo(0);
            window.tvPlayer.playVideo();
            console.log("🔄 Restarted via remote");
          }
          break;

        case "toggleMute":
          if (window.tvPlayer) {
            if (window.tvPlayer.isMuted()) {
              window.tvPlayer.unMute();
              console.log("🔊 Unmuted via remote");
            } else {
              window.tvPlayer.mute();
              console.log("🔇 Muted via remote");
            }
          }
          break;

        case "setVolume":
          if (window.tvPlayer && typeof control.volume === "number") {
            const volumePercent = Math.max(0, Math.min(100, control.volume));
            const volumeDecimal = volumePercent / 100;
            window.tvPlayer.setVolume(volumeDecimal * 100); // YouTube uses 0-100 scale
            console.log("🔊 Volume set to:", volumePercent + "%");
          }
          break;
      }
    },
    (error) => {
      console.warn("⚠️ Firebase control listener error:", error);
    },
  );

  // 🔥 Listen for activity updates
  db.ref("activity").on(
    "value",
    (snapshot) => {
      const activityData = snapshot.val();
      if (!activityData) return;

      console.log("📱 Activity updated from Firebase:", activityData.timestamp);
    },
    (error) => {
      console.warn("⚠️ Firebase activity listener error:", error);
    },
  );

  console.log("✅ [3/7] Firebase listeners attached");

  // Sync queue from localStorage periodically (backup sync method)
  let lastStorageQueueLength = 0;
  setInterval(() => {
    try {
      const localQueue = JSON.parse(
        localStorage.getItem("karaoke_queue") || "[]",
      );
      // Only update if queue changed
      if (localQueue.length !== lastStorageQueueLength) {
        console.log(
          "🔄 Syncing queue from localStorage (",
          localQueue.length,
          "songs, was",
          lastStorageQueueLength,
          ")",
        );
        tvQueue = localQueue;
        lastStorageQueueLength = localQueue.length;
        displayQueue();
        updateNextSongDisplay();

        // If localStorage has songs but currentSong is not set, auto-play first
        if (localQueue.length > 0 && (!currentSong || !currentSong.videoId)) {
          const firstSong = localQueue[0];
          currentSong = {
            title: firstSong.title,
            artist: firstSong.artist,
            videoId: firstSong.videoId,
            requestedBy: firstSong.requestedBy,
            singer: firstSong.requestedBy,
          };
          tryInitPlayback();
        }
      }
    } catch (e) {
      console.warn("Error syncing from localStorage:", e.message);
    }
  }, 1000); // Check every 1 second for faster updates

  // 🔥 Load initial data after listeners are attached
  console.log("📡 [3/7] Loading initial songs from Firebase...");
  db.ref("queue")
    .once("value", (snapshot) => {
      const queueData = snapshot.val();
      console.log("🔍 DEBUG: Initial queue load:", queueData);
      if (queueData) {
        tvQueue = Array.isArray(queueData)
          ? queueData
          : Object.values(queueData);
        console.log("📡 Initial queue loaded:", tvQueue.length, "songs");
      } else {
        tvQueue = [];
        console.log("📡 Initial queue: empty (no songs yet)");
      }
      firebaseReady = true;
      checkBootupCompletion();
      displayQueue();
    })
    .catch((err) => {
      console.error("❌ Initial queue load failed:", err);
    });

  db.ref("currentSong")
    .once("value", (snapshot) => {
      const songData = snapshot.val();
      console.log("🔍 DEBUG: Initial currentSong load:", songData);
      if (songData) {
        currentSong = songData;
        console.log("🎵 Initial song loaded:", currentSong.title);
        displayQueue();
        updateNextSongDisplay();

        // Try to play if player is ready
        if (youtubeAPIReady && playerReady) {
          console.log("▶️ [6/7] Initial song - player ready, calling playback");
          tryInitPlayback();
        }
      }
    })
    .catch((err) => {
      console.error("❌ Initial currentSong load failed:", err);
    });
}

function initializeFirebaseListeners() {
  if (firebaseListenersSet) return;
  firebaseListenersSet = true;
  initializeKaraokeRooms();

  firebase
    .database()
    .ref("activity")
    .on("value", (snapshot) => {
      const activityData = snapshot.val();
      if (activityData) {
        console.log(
          "📱 Activity updated from Firebase:",
          activityData.timestamp,
        );
      }
    });
}

// Set current song from queue item
function setCurrentFromQueue(song) {
  if (!activeKaraokeRoomId) return;
  currentSong = {
    title: song.title,
    artist: song.artist,
    videoId: song.videoId,
    requestedBy: song.requestedBy,
    singer: song.requestedBy,
  };

  KaraokeSessions.roomRef(activeKaraokeRoomId, "currentSong").set(currentSong);

  isPlaying = true;
  checkAndPlayCurrentSong();
}

/* ===== YOUTUBE IFRAME PLAYER ===== */

function onYouTubeIframeAPIReady() {
  console.log("✅ YouTube IFrame API Ready");
  console.log(
    "🔍 DEBUG: videoPlayer element:",
    document.getElementById("videoPlayer"),
  );
  ytReady = true;
  createYouTubePlayer();
}

// B. YouTube API - Initialize player when ready
function createYouTubePlayer() {
  console.log("✅ YouTube API Ready");
  console.log(
    "🔍 DEBUG: useFirebase =",
    useFirebase,
    "firebaseListenersSet =",
    firebaseListenersSet,
  );

  // Firebase listeners should already be initialized by initializeKaraokeDisplay()
  // No need to reinitialize here
  if (!firebaseListenersSet && useFirebase) {
    console.log(
      "⚠️ Firebase listeners not yet initialized, initializing now...",
    );
    try {
      initializeFirebaseListeners();
    } catch (err) {
      console.error("❌ Error initializing Firebase listeners:", err);
    }
  } else {
    console.log("✅ Firebase listeners already initialized");
  }

  // Check if bootup splash should be hidden
  checkBootupCompletion();
}

// D. SINGLE ENTRY POINT (MOST IMPORTANT)
function tryInitPlayback() {
  if (!karaokeDisplayEnabled || !ytReady || !firebaseReady) {
    console.log(
      `⏳ Not ready yet: ytReady=${ytReady}, firebaseReady=${firebaseReady}`,
    );
    return;
  }

  if (currentVideoId === currentSong?.videoId) {
    console.log("ℹ️ Same song already playing");
    return;
  }

  if (!currentSong || !currentSong.videoId) {
    console.warn("⚠ No current song data");
    return;
  }

  loadSong(currentSong);
}

/* ===== FULLSCREEN & CONNECTION ===== */

let fullscreenOrientationLocked = false;

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function updateFullscreenUi() {
  const displayContainer = document.querySelector(".display-container");
  const fullscreenElement = getFullscreenElement();
  const isFullscreen =
    fullscreenElement === displayContainer ||
    displayContainer.classList.contains("fullscreen-fallback");

  displayContainer.classList.toggle("fullscreen-active", isFullscreen);
  document.body.classList.toggle("fullscreen-ui-active", isFullscreen);
  document.getElementById("exitFullscreenBtn").hidden = !isFullscreen;
  if (!isFullscreen && fullscreenOrientationLocked) {
    fullscreenOrientationLocked = false;
    screen.orientation?.unlock?.();
  }
}

function lockLandscapeIfPortrait() {
  const orientation = screen.orientation;
  if (
    !orientation?.type?.startsWith("portrait") ||
    typeof orientation.lock !== "function"
  ) {
    return;
  }

  try {
    Promise.resolve(orientation.lock("landscape"))
      .then(() => {
        const displayContainer = document.querySelector(".display-container");
        if (getFullscreenElement() === displayContainer) {
          fullscreenOrientationLocked = true;
        } else {
          orientation.unlock?.();
        }
      })
      .catch((error) => {
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
    const exitFullscreen =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (exitFullscreen) exitFullscreen.call(document);
    return;
  }

  const requestFullscreen =
    displayContainer.requestFullscreen ||
    displayContainer.webkitRequestFullscreen ||
    displayContainer.mozRequestFullScreen ||
    displayContainer.msRequestFullscreen;
  if (!requestFullscreen) {
    displayContainer.classList.add("fullscreen-fallback");
    updateFullscreenUi();
    return;
  }

  try {
    Promise.resolve(requestFullscreen.call(displayContainer))
      .then(lockLandscapeIfPortrait)
      .catch((error) => {
        console.warn(
          "Native fullscreen unavailable; using display mode:",
          error,
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
  "MSFullscreenChange",
].forEach((eventName) =>
  document.addEventListener(eventName, updateFullscreenUi),
);

// D. LOAD SONG - Unified playback handler
// E. PLAYER CREATION (ONCE LANG)
function loadSong(song) {
  // Boot-up video disabled - create player directly with karaoke song
  currentPerformerName = song.singer || song.requestedBy || "Karaoke performer";
  micActivityMs = 0;
  micObservedPlayingMs = 0;
  currentVideoId = song.videoId;
  setNoSongMessage(false);

  if (!window.tvPlayer) {
    console.log("🎬 [FIRST LOAD] Creating player with karaoke song");

    window.tvPlayer = new YT.Player("videoPlayer", {
      videoId: song.videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        enablejsapi: 1,
        modestbranding: 1,
        fs: 0,
      },
      events: {
        onReady: (e) => {
          console.log("🎬 Karaoke Player Ready");
          playerReady = true;
          e.target.setVolume(activeRoomVolume);
          activeRoomMuted ? e.target.mute() : e.target.unMute();
          checkBootupCompletion();
          // Try to play with autoplay - if blocked by browser, will be caught in onError
          try {
            const playPromise = e.target.playVideo();
            if (playPromise && typeof playPromise.catch === "function") {
              playPromise.catch((error) => {
                console.warn("⚠️ Autoplay prevented:", error);
                // Mute and try again
                e.target.mute();
                e.target.playVideo();
              });
            }
          } catch (err) {
            console.warn("⚠️ Play error caught:", err);
          }
        },
        onStateChange: onPlayerStateChange,
        onError: (e) => {
          console.error("❌ Karaoke video error:", e.data);
          // Error 150 = Video is restricted/blocked from embedding
          if (e.data === 150) {
            console.warn(
              "⚠️ Video blocked (error 150) - skipping to next song",
            );
            showVideoUnavailableMessage();
            setTimeout(() => {
              playNextSong();
            }, 3000);
          }
          // Error 101 = Owner does not allow embedding
          else if (e.data === 101) {
            console.warn(
              "⚠️ Video blocked by owner (error 101) - skipping to next song",
            );
            showVideoUnavailableMessage();
            setTimeout(() => {
              playNextSong();
            }, 3000);
          }
        },
      },
    });
  } else {
    console.log("▶️ [REUSE] Loading video:", song.videoId);
    window.tvPlayer.loadVideoById({
      videoId: song.videoId,
      startSeconds: 0,
    });
    // Ensure audio is unmuted for new videos
    try {
      if (window.tvPlayer.isMuted && window.tvPlayer.isMuted()) {
        window.tvPlayer.unMute();
      }
    } catch (err) {
      console.warn("⚠️ Unmute error:", err);
    }
  }

  console.log(`📺 Now playing: ${song.title}`);
}

// Check if phone/performer portal is connected
let lastConnectionStatus = null;

function checkPhoneConnection() {
  try {
    // Check if activity was updated in the last 30 seconds
    firebase
      .database()
      .ref("activity")
      .once("value", (snapshot) => {
        const activity = snapshot.val();
        const lastActivity = activity?.timestamp || 0;
        const now = Date.now();
        const isConnected = now - lastActivity < 30000;

        if (isConnected) {
          // Phone connected
          console.log("✅ Phone connected");
        } else {
          // Phone disconnected (no activity for 30 seconds)
          console.log("❌ Phone disconnected");
        }

        // Show pop-up message on status change
        if (lastConnectionStatus !== isConnected) {
          lastConnectionStatus = isConnected;
          const message = isConnected
            ? "✅ Phone Connected!"
            : "❌ Phone Disconnected";
          showNotification(message);
        }

        console.log(
          "📱 Phone connection status:",
          isConnected ? "Connected" : "Disconnected",
        );
      })
      .catch((err) => {
        console.warn("Firebase activity read failed:", err.message);
      });
  } catch (error) {
    console.error("❌ Error in checkPhoneConnection:", error.message);
  }
}

// Show temporary notification
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
  }, 3000);
}

// Generate QR code for performer portal
function generateQRCode() {
  // Skip if already generating
  if (qrCodeGenerated || typeof QRCode === "undefined") {
    return;
  }

  const qrContainer = document.getElementById("qrcode");
  if (!qrContainer) return;

  // Clear previous QR code if exists
  qrContainer.innerHTML = "";

  if (!activeKaraokeRoomId) return;
  const singerPageUrl = KaraokeSessions.getJoinUrl(activeKaraokeRoomId);

  // Debug logging
  console.log("📱 QR Code URL:", singerPageUrl);

  // Create QR code (smaller size for bottom right)
  new QRCode(qrContainer, {
    text: singerPageUrl,
    width: 110,
    height: 110,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });

  qrCodeGenerated = true;
}

// Load queue data from Firebase only
function loadQueueData() {
  if (!activeKaraokeRoomId) return;
  KaraokeSessions.roomRef(activeKaraokeRoomId, "queue")
    .once("value")
    .then((snapshot) => {
      tvQueue = Array.isArray(snapshot.val())
        ? snapshot.val()
        : Object.values(snapshot.val() || {});
      displayQueue();
      updateNextSongDisplay();
    })
    .catch((error) =>
      console.warn("Could not load active room queue:", error.message),
    );
}

// Check and play current song (only when YouTube API is ready)
function checkAndPlayCurrentSong() {
  if (!currentSong || !currentSong.videoId) {
    console.warn("⚠ No current song data");
    clearCurrentSongPlayback();
    return;
  }

  setNoSongMessage(false);

  // 🔴 Player NOT ready → store first
  if (!youtubeAPIReady || !player) {
    console.log("⏳ Player not ready yet, storing pending song");
    pendingSongToPlay = currentSong;
    return;
  }

  console.log("▶ [6/7] Playing now:", currentSong.title);
  isLoadingSong = true;
  currentVideoId = currentSong.videoId;

  player.loadVideoById({
    videoId: currentSong.videoId,
    startSeconds: 0,
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
  currentSong = null;
  currentVideoId = null;
  pendingSongToPlay = null;
  isLoadingSong = false;
  isPlaying = false;

  for (const activePlayer of new Set(
    [player, window.tvPlayer].filter(Boolean),
  )) {
    try {
      activePlayer.stopVideo?.();
      activePlayer.clearVideo?.();
    } catch (error) {
      console.warn("Could not clear the previous video:", error.message);
    }
  }

  setNoSongMessage(true);
  displayQueue();
  updateNextSongDisplay();
}

// Display song information in lyrics section
function displaySongInfo(song) {
  const centerPerformerName = document.getElementById("centerPerformerName");

  if (!centerPerformerName) return;

  // Performer name display removed from center
  centerPerformerName.classList.remove("show");
  centerPerformerName.innerHTML = "";
}

// Play video using YouTube iframe API
function playVideo(videoId, title, artist, singer) {
  const container = document.getElementById("videoPlayer");

  // Clear previous player
  container.innerHTML = "";

  // Initialize scoring for new song
  currentPerformerName = singer || "Unknown Performer";
  songDurationMs = 0;
  micActivityMs = 0;
  micObservedPlayingMs = 0;

  player = new YT.Player(container, {
    height: "100%",
    width: "100%",
    videoId: videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      fs: 1,
      playsinline: 1,
      enablejsapi: 1,
    },
    events: {
      onReady: function (event) {
        try {
          // Get video duration when ready
          const duration = event.target.getDuration();
          if (duration > 0) {
            songDurationMs = duration * 1000;
            console.log(`⏱️ Song duration: ${duration}s (${songDurationMs}ms)`);
          }

          const playPromise = event.target.playVideo();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((error) => {
              console.warn("⚠️ Autoplay prevented:", error);
              event.target.mute();
              event.target.playVideo();
            });
          }
        } catch (err) {
          console.warn("⚠️ Play error:", err);
        }
      },
      onStateChange: onPlayerStateChange,
      onError: function (event) {
        console.error("❌ YouTube player error:", event.data);
        if (event.data === 150 || event.data === 101) {
          console.warn(
            "⚠️ Video is blocked from embedding - skipping to next song",
          );
          showVideoUnavailableMessage();
          setTimeout(() => {
            playNextSong();
          }, 3000);
        }
      },
    },
  });
}

/* ===== PLAYER STATE MANAGEMENT ===== */

// F. STATE HANDLER (VERIFIED SAFE)
function onPlayerStateChange(e) {
  const states = {
    [-1]: "UNSTARTED",
    0: "ENDED",
    1: "PLAYING",
    2: "PAUSED",
    3: "BUFFERING",
  };

  console.log(`📊 Player state changed to: ${states[e.data]}`);

  if (
    activeKaraokeRoomId &&
    [
      YT.PlayerState.PLAYING,
      YT.PlayerState.PAUSED,
      YT.PlayerState.ENDED,
    ].includes(e.data)
  ) {
    KaraokeSessions.setPlaybackState(
      activeKaraokeRoomId,
      e.data === YT.PlayerState.PLAYING,
    ).catch((error) =>
      console.warn("Could not sync room playback state:", error.message),
    );
  }

  if (e.data === YT.PlayerState.ENDED) {
    // Check if boot-up video just finished
    if (isPlayingBootUpVideo) {
      console.log("✅ Boot-up video ended - transitioning to karaoke song");
      isPlayingBootUpVideo = false;
      bootUpVideoPlayed = true;
      hideBootupSplash(); // Hide splash after boot-up video ends

      // Load the actual karaoke song
      if (
        currentSong &&
        currentSong.videoId &&
        currentSong.videoId !== bootUpVideoId
      ) {
        console.log("📺 Auto-loading karaoke:", currentSong.title);
        window.tvPlayer.loadVideoById({
          videoId: currentSong.videoId,
          startSeconds: 0,
        });
        currentVideoId = currentSong.videoId;
      } else {
        console.warn("⚠️ No karaoke song ready after boot-up video");
      }
    } else {
      // Regular song ended - play next
      showScore();
    }
  }
}

// Show score/results when video ends
async function showScore() {
  const score =
    micScoringEnabled && micObservedPlayingMs > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((micActivityMs / micObservedPlayingMs) * 100)),
        )
      : null;
  const activitySeconds = (micActivityMs / 1000).toFixed(1);
  const observedSeconds = (micObservedPlayingMs / 1000).toFixed(1);

  console.log("Mic participation score:", score, {
    activitySeconds,
    observedSeconds,
  });
  displayScoreModal(score);

  const soundPlayed = await playScoreSound();
  if (!soundPlayed) {
    await new Promise((resolve) => setTimeout(resolve, 2600));
  }
  document.getElementById("scoreModal")?.remove();
  playNextSong();
}

function playScoreSound() {
  return new Promise((resolve) => {
    const sound = new Audio("assets/score.mp3");
    sound.preload = "auto";
    sound.volume = 0.8;

    let settled = false;
    let timeoutId;
    const finish = (played) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (!played) sound.pause();
      resolve(played);
    };

    timeoutId = window.setTimeout(() => finish(false), 15000);
    sound.addEventListener("ended", () => finish(true), { once: true });
    sound.addEventListener(
      "error",
      () => {
        console.warn("Could not load the score sound:", sound.error);
        finish(false);
      },
      { once: true },
    );

    sound.play().catch((error) => {
      console.warn("Could not play the score sound:", error.message);
      finish(false);
    });
  });
}

// Display score modal
function displayScoreModal(score) {
  const existingModal = document.getElementById("scoreModal");
  existingModal?.remove();

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
  value.textContent = score === null ? "--" : `${score}%`;

  const feedback = document.createElement("p");
  feedback.className = "score-modal-feedback";
  if (score === null) {
    feedback.textContent = "Let's sing together next time!";
  } else if (score === 100) {
    feedback.textContent = "You're a great singer!";
  } else if (score >= 80) {
    feedback.textContent = "Amazing singing! Keep it up!";
  } else if (score >= 60) {
    feedback.textContent = "You're finding your rhythm!";
  } else if (score > 0) {
    feedback.textContent = "Keep going, you've got this!";
  } else {
    feedback.textContent = "The next song is yours!";
  }

  scoreDisplay.append(title, value, feedback);

  modal.appendChild(scoreDisplay);
  document.body.appendChild(modal);

  // Add CSS animations
  const style = document.createElement("style");
  style.textContent = `
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
  document.head.appendChild(style);
}

// Show video unavailable message
function showVideoUnavailableMessage() {
  // Remove existing message if any
  const existingMsg = document.getElementById("videoUnavailableMsg");
  if (existingMsg) {
    existingMsg.remove();
  }

  // Create message modal
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
        <div style="font-size: 3.5rem; font-weight: 900; margin-bottom: 20px; animation: popIn 0.5s ease 0.1s both;">⚠️</div>
        <div style="font-size: 2rem; font-weight: 700; margin-bottom: 15px; animation: slideInDown 0.5s ease 0.2s both;">Video Unavailable</div>
        <div style="font-size: 1.3rem; margin-bottom: 20px; opacity: 0.95; animation: slideInDown 0.5s ease 0.3s both;">Please select another song</div>
    `;

  modal.appendChild(msgDisplay);
  document.body.appendChild(modal);

  // Auto remove after 3 seconds
  setTimeout(() => {
    modal.style.animation = "fadeIn 0.4s ease reverse";
    setTimeout(() => {
      modal.remove();
    }, 400);
  }, 3000);
}

function playNextSong() {
  if (!activeKaraokeRoomId) return;
  if (tvQueue.length === 0) {
    KaraokeSessions.roomRef(activeKaraokeRoomId, "currentSong")
      .set(null)
      .catch((error) =>
        console.warn("Could not clear finished song:", error.message),
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
    singer: nextSong.requestedBy,
  };

  isPlaying = true;

  const updates = {};
  updates[`karaokeSessions/${activeKaraokeRoomId}/currentSong`] = currentSong;
  updates[`karaokeSessions/${activeKaraokeRoomId}/queue`] =
    tvQueue.length > 0 ? tvQueue : null;
  firebase.database().ref().update(updates);

  displayQueue();
  checkAndPlayCurrentSong();
}

/* ===== UI RENDERING ===== */

function displayQueue() {
  // Show queue with count and next song info
  try {
    const nextSongTitle = document.getElementById("nextSongTitle");
    const nextSongArtist = document.getElementById("nextSongArtist");

    if (!nextSongTitle || !nextSongArtist) return;

    // Display queue from tvQueue (loaded from Firebase)
    if (tvQueue && tvQueue.length > 0) {
      const nextSong = tvQueue[0];
      // Extract just the song name (remove artist if included)
      let songName = nextSong.title;
      if (songName.includes(" - ")) {
        songName = songName.split(" - ")[0].trim();
      }
      nextSongTitle.textContent = `📋 Queue (${tvQueue.length}): ${songName}`;
      nextSongArtist.textContent = `Reserved by: ${nextSong.requestedBy}`;
      console.log("📺 Karaoke Display Queue Updated:", {
        count: tvQueue.length,
        currentSong: songName,
        reservedBy: nextSong.requestedBy,
        songs: tvQueue.map((s) => ({
          title: s.title,
          reservedBy: s.requestedBy,
        })),
      });
    } else {
      nextSongTitle.textContent = "No songs in queue";
      nextSongArtist.textContent = "-";
      console.log("📺 Karaoke Display Queue: Empty");
    }
  } catch (e) {
    console.warn("Error displaying queue:", e.message);
  }
}

// Update next song display (horizontal, in upper left)
function updateNextSongDisplay() {
  const nextSongDisplay = document.getElementById("nextSongDisplay");
  const nextSongTitle = document.getElementById("nextSongTitle");
  const nextSongArtist = document.getElementById("nextSongArtist");

  if (!nextSongDisplay) return; // Element might not exist yet

  // Get the next song (skip the current playing song)
  let nextSong = null;

  if (tvQueue && tvQueue.length > 0) {
    // If there's a current song and it matches the first in queue, show second song
    if (currentSong && currentSong.videoId === tvQueue[0].videoId) {
      nextSong = tvQueue.length > 1 ? tvQueue[1] : null;
    } else {
      // Otherwise show the first song in queue
      nextSong = tvQueue[0];
    }
  }

  if (nextSong) {
    // Extract just the song name (remove artist if included)
    let songName = nextSong.title;
    if (songName.includes(" - ")) {
      songName = songName.split(" - ")[0].trim();
    }
    nextSongTitle.textContent = songName;
    nextSongArtist.textContent = `Reserved by: ${nextSong.requestedBy}`;
    nextSongDisplay.style.display = "flex";
  } else {
    // Show current song if queue is empty but currentSong exists
    if (currentSong && currentSong.title) {
      let songName = currentSong.title;
      if (songName.includes(" - ")) {
        songName = songName.split(" - ")[0].trim();
      }
      nextSongTitle.textContent = `▶️ Now Playing: ${songName}`;
      nextSongArtist.textContent = `by ${currentSong.singer || currentSong.requestedBy}`;
    } else {
      nextSongTitle.textContent = "🎤 Select a Song to Start";
      nextSongArtist.textContent = "Scan the QR code to request a song";
    }
    nextSongDisplay.style.display = "flex";
  }
}

// Update reserve list in top right corner
function updateReserveList() {
  // Reserve list removed - minimal design
  return;
}

// Function to add song to queue (called from performer portal)
function addSongToQueue(title, artist, requestedBy) {
  if (!activeKaraokeRoomId) return;
  const newSong = {
    id: Math.max(...tvQueue.map((s) => s.id || 0), 0) + 1,
    title,
    artist,
    requestedBy,
  };

  tvQueue.push(newSong);
  KaraokeSessions.addSong(activeKaraokeRoomId, newSong).catch((error) =>
    console.warn("Could not add song to active room:", error.message),
  );

  // Refresh display
  displayQueue();
}

// Function to skip to next song (called from admin)
function skipToNextSong() {
  playNextSong();
}

// Function to remove song from queue (called from admin)
function removeSongFromQueue(songId) {
  if (!activeKaraokeRoomId) return;
  tvQueue = tvQueue.filter((s) => s.id !== songId);
  KaraokeSessions.roomRef(activeKaraokeRoomId, "queue").set(
    tvQueue.length > 0 ? tvQueue : null,
  );

  displayQueue();
}

// Function to delete entire queue (requires admin password)
async function deleteQueue() {
  const password = await showAppPrompt(
    "Enter admin password to clear queue:",
    "",
    {
      title: "Clear queue",
      inputType: "password",
      confirmLabel: "Continue",
    },
  );

  if (password === null) {
    // User cancelled
    return;
  }

  // Get admin users from localStorage
  const users = JSON.parse(localStorage.getItem("karaoke_users") || "[]");
  const adminUser = users.find(
    (u) => u.role === "admin" && u.password === password,
  );

  if (!adminUser) {
    showAppToast(
      "Incorrect password. Only admins can clear the queue.",
      "danger",
    );
    return;
  }

  if (
    await showAppConfirm(
      "Are you sure you want to clear all songs from the queue?",
      {
        title: "Clear queue",
        confirmLabel: "Clear queue",
        danger: true,
      },
    )
  ) {
    tvQueue = [];
    clearCurrentSongPlayback();

    const updates = {};
    updates[`karaokeSessions/${activeKaraokeRoomId}/queue`] = null;
    updates[`karaokeSessions/${activeKaraokeRoomId}/currentSong`] = null;
    firebase.database().ref().update(updates);
    showAppToast("Queue cleared successfully!", "success");
  }
}
// ===== TV ENABLED/DISABLED CONTROL =====

// Check if karaoke display is enabled
function checkKaraokeDisplayEnabled(callback) {
  if (typeof firebase === "undefined" || !firebase.database) {
    console.log("⚠️ Firebase not available, defaulting to enabled");
    callback(true);
    return;
  }

  try {
    firebase
      .database()
      .ref("tvControl")
      .once("value", (snapshot) => {
        const settings = snapshot.val() || {};
        tvDisabledAnnouncement = settings.announcement || "";
        const isEnabled = settings.enabled !== false;
        console.log("📺 TV Enabled Status from Firebase:", isEnabled);
        callback(isEnabled);
      })
      .catch((err) => {
        console.error("❌ Firebase error checking TV status:", err.message);
        if (err.code === "PERMISSION_DENIED") {
          console.error(
            'Firebase Permission Denied - Update database rules to: { "rules": { ".read": true, ".write": true } }',
          );
        }
        callback(true); // Default to enabled on error
      });
  } catch (e) {
    console.error("Firebase exception:", e.message);
    callback(true);
  }
}

// Show TV disabled message
function showKaraokeDisplayUnavailableMessage(
  announcement = tvDisabledAnnouncement,
) {
  karaokeDisplayEnabled = false;
  tvDisabledAnnouncement =
    announcement ||
    "The karaoke display is temporarily unavailable. Please check back soon.";
  const splashScreen = document.getElementById("splashScreen");
  if (splashScreen) {
    splashScreen.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; color: white; text-align: center; background: linear-gradient(135deg, #1a0a2e 0%, #0f0f1e 100%); padding: 20px; box-sizing: border-box; font-family: Arial, sans-serif;">
                <div style="font-size: clamp(40px, 12vw, 100px); margin-bottom: clamp(15px, 5vw, 40px);">🔴</div>
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
    document.getElementById("tvDisabledAnnouncement").textContent =
      tvDisabledAnnouncement;
    splashScreen.style.display = "flex";
  }

  if (
    !tvAvailabilityListenerAttached &&
    typeof firebase !== "undefined" &&
    firebase.database
  ) {
    try {
      firebase
        .database()
        .ref("tvControl")
        .on("value", (snapshot) => {
          const settings = snapshot.val() || {};
          if (settings.enabled !== false) {
            console.log("📺 TV has been re-enabled, reloading...");
            setTimeout(() => {
              location.reload();
            }, 1000);
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
  document.getElementById("roomDisabledAnnouncement").textContent =
    announcement;
  splashScreen.style.display = "flex";
}
