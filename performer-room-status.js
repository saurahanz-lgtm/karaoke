document.addEventListener("DOMContentLoaded", () => {
  const ROOMS_PER_PAGE = 5;
  const roomList = document.getElementById("performerRoomList");
  const roomSummary = document.getElementById("performerRoomStatusSummary");
  const roomFeedback = document.getElementById("performerRoomStatusFeedback");
  const pagination = document.getElementById("performerRoomPagination");
  const previousPageButton = document.getElementById(
    "performerRoomPreviousPage",
  );
  const nextPageButton = document.getElementById("performerRoomNextPage");
  const pageInfo = document.getElementById("performerRoomPageInfo");
  if (
    !roomList ||
    !roomSummary ||
    !roomFeedback ||
    !pagination ||
    !previousPageButton ||
    !nextPageButton ||
    !pageInfo
  ) {
    return;
  }

  const roomListeners = new Map();
  const roomAvailability = new Map();
  const roomDisplayStatusListeners = new Map();
  const roomDisplayEnabled = new Map();
  let currentRooms = [];
  let currentPage = 1;

  function updateSummary() {
    let availableCount = 0;
    let occupiedCount = 0;
    let disabledCount = 0;
    let checkingCount = 0;
    currentRooms.forEach((room) => {
      if (roomDisplayEnabled.get(room.id) === false) {
        disabledCount += 1;
      } else {
        const available = roomAvailability.get(room.id);
        if (available === true) availableCount += 1;
        else if (available === false) occupiedCount += 1;
        else checkingCount += 1;
      }
    });
    if (checkingCount) {
      roomSummary.textContent =
        availableCount + occupiedCount + disabledCount === 0
          ? "Checking rooms..."
          : `${availableCount} available · ${occupiedCount} occupied${disabledCount ? ` · ${disabledCount} disabled` : ""} · checking ${checkingCount}`;
    } else {
      roomSummary.textContent = `${availableCount} available · ${occupiedCount} occupied${disabledCount ? ` · ${disabledCount} disabled` : ""}`;
    }
  }

  function renderRooms() {
    roomList.replaceChildren();
    if (!currentRooms.length) {
      pagination.hidden = true;
      roomSummary.textContent = "No rooms";
      roomFeedback.textContent = "No karaoke rooms are configured.";
      roomFeedback.hidden = false;
      return;
    }
    roomFeedback.hidden = true;
    const isSelectingRoomId = document
      .getElementById("performerRoomStatus")
      .classList.contains("is-selecting-room-id");

    const pageCount = Math.ceil(currentRooms.length / ROOMS_PER_PAGE);
    currentPage = Math.min(currentPage, pageCount);
    pagination.hidden = pageCount <= 1;
    previousPageButton.disabled = currentPage <= 1;
    nextPageButton.disabled = currentPage >= pageCount;
    const firstRoomNumber = (currentPage - 1) * ROOMS_PER_PAGE + 1;
    const lastRoomNumber = Math.min(
      currentPage * ROOMS_PER_PAGE,
      currentRooms.length,
    );
    pageInfo.textContent = `${firstRoomNumber}-${lastRoomNumber} of ${currentRooms.length}`;
    pageInfo.setAttribute(
      "aria-label",
      `Rooms ${firstRoomNumber} through ${lastRoomNumber} of ${currentRooms.length}`,
    );

    const pageStart = (currentPage - 1) * ROOMS_PER_PAGE;
    currentRooms
      .slice(pageStart, pageStart + ROOMS_PER_PAGE)
      .forEach((room) => {
        const state = roomAvailability.get(room.id);
        const displayEnabled = roomDisplayEnabled.get(room.id);
        const status =
          displayEnabled === false
            ? "disabled"
            : displayEnabled === null
              ? "checking"
              : state === true
                ? "available"
                : state === false
                  ? "occupied"
                  : state === undefined
                    ? "unavailable"
                    : "checking";
        const label =
          status === "available"
            ? "Available"
            : status === "occupied"
              ? "Occupied"
              : status === "disabled"
                ? "Disabled"
                : status === "unavailable"
                  ? "Unavailable"
                  : "Checking";
        const row = document.createElement("li");
        row.className = "performer-room-entry";
        row.dataset.status = status;

        const details = document.createElement("span");
        details.className = "performer-room-details";
        const name = document.createElement("span");
        name.className = "performer-room-name";
        name.textContent = room.name || "Unnamed room";
        const id = document.createElement("button");
        id.type = "button";
        id.className = "performer-room-id";
        id.dataset.roomId = room.id;
        id.disabled = !isSelectingRoomId || status !== "available";
        id.setAttribute("aria-label", `Select Room ID ${room.id}`);
        id.textContent = `Room ID: ${room.id}`;
        id.addEventListener("click", () => selectRoomId(room.id));
        details.append(name, id);

        const indicator = document.createElement("span");
        indicator.className = "performer-room-indicator";
        const light = document.createElement("span");
        light.className = "performer-room-light";
        light.setAttribute("aria-hidden", "true");
        const statusText = document.createElement("span");
        statusText.textContent = label;
        indicator.append(light, statusText);
        row.append(details, indicator);
        roomList.append(row);
      });
    updateSummary();
  }

  previousPageButton.addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderRooms();
  });

  nextPageButton.addEventListener("click", () => {
    const pageCount = Math.ceil(currentRooms.length / ROOMS_PER_PAGE);
    if (currentPage >= pageCount) return;
    currentPage += 1;
    renderRooms();
  });

  function selectRoomId(roomId) {
    if (document.getElementById("manualRoomEntry")?.hidden !== false) return;
    if (
      roomAvailability.get(roomId) !== true ||
      roomDisplayEnabled.get(roomId) !== true
    ) {
      return;
    }

    const roomIdInput = document.getElementById("manualRoomId");
    const roomQrStatus = document.getElementById("roomQrStatus");
    if (!roomIdInput || !roomQrStatus) return;

    roomIdInput.value = roomId;
    roomIdInput.dispatchEvent(new Event("input", { bubbles: true }));
    roomIdInput.focus();
    roomQrStatus.textContent = `Room ID ${roomId} selected. Press Continue to join.`;
  }

  function handleRooms(rooms) {
    currentRooms = rooms;
    const roomIds = new Set(rooms.map((room) => room.id));
    roomListeners.forEach((stopListening, roomId) => {
      if (!roomIds.has(roomId)) {
        stopListening();
        roomListeners.delete(roomId);
        roomAvailability.delete(roomId);
      }
    });
    roomDisplayStatusListeners.forEach((stopListening, roomId) => {
      if (!roomIds.has(roomId)) {
        stopListening();
        roomDisplayStatusListeners.delete(roomId);
        roomDisplayEnabled.delete(roomId);
      }
    });

    rooms.forEach((room) => {
      if (!roomListeners.has(room.id)) {
        roomAvailability.set(room.id, null);
        roomDisplayEnabled.set(room.id, null);
        const stopListening = KaraokeSessions.listenRoomAvailability(
          room.id,
          (available) => {
            roomAvailability.set(room.id, available);
            renderRooms();
          },
          (error) => {
            console.warn("Could not read room availability:", error.message);
            roomAvailability.set(room.id, undefined);
            renderRooms();
          },
        );
        roomListeners.set(room.id, stopListening);
      }

      if (!roomDisplayStatusListeners.has(room.id)) {
        const stopListening = KaraokeSessions.listenRoomDisplayStatus(
          room.id,
          (settings) => {
            roomDisplayEnabled.set(room.id, settings.enabled !== false);
            renderRooms();
          },
          (error) => {
            console.warn("Could not read room display status:", error.message);
            roomDisplayEnabled.set(room.id, true);
            renderRooms();
          },
        );
        roomDisplayStatusListeners.set(room.id, stopListening);
      }
    });
    renderRooms();
  }

  try {
    KaraokeSessions.listenRooms(handleRooms, (error) => {
      console.warn("Could not load karaoke rooms:", error.message);
      roomSummary.textContent = "Unavailable";
      roomFeedback.textContent = "Room availability could not be loaded.";
      roomFeedback.hidden = false;
    });
  } catch (error) {
    console.warn("Could not listen to karaoke rooms:", error.message);
    roomSummary.textContent = "Unavailable";
    roomFeedback.textContent = "Room availability could not be loaded.";
    roomFeedback.hidden = false;
  }
});
