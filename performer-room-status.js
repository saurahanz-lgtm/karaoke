document.addEventListener("DOMContentLoaded", () => {
  const roomList = document.getElementById("performerRoomList");
  const roomSummary = document.getElementById("performerRoomStatusSummary");
  const roomFeedback = document.getElementById("performerRoomStatusFeedback");
  if (!roomList || !roomSummary || !roomFeedback) return;

  const roomListeners = new Map();
  const roomAvailability = new Map();
  let currentRooms = [];

  function updateSummary() {
    const availableCount = [...roomAvailability.values()].filter(
      (available) => available === true,
    ).length;
    const occupiedCount = [...roomAvailability.values()].filter(
      (available) => available === false,
    ).length;
    const checkingCount =
      roomAvailability.size - availableCount - occupiedCount;
    if (checkingCount) {
      roomSummary.textContent =
        roomAvailability.size === checkingCount
          ? "Checking rooms..."
          : `${availableCount} available · ${occupiedCount} occupied · checking ${checkingCount}`;
    } else {
      roomSummary.textContent = `${availableCount} available · ${occupiedCount} occupied`;
    }
  }

  function renderRooms() {
    roomList.replaceChildren();
    if (!currentRooms.length) {
      roomSummary.textContent = "No rooms";
      roomFeedback.textContent = "No karaoke rooms are configured.";
      roomFeedback.hidden = false;
      return;
    }
    roomFeedback.hidden = true;

    currentRooms.forEach((room) => {
      const state = roomAvailability.get(room.id);
      const status =
        state === true
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
      const id = document.createElement("span");
      id.className = "performer-room-id";
      id.textContent = `Room ID: ${room.id}`;
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

    rooms.forEach((room) => {
      if (roomListeners.has(room.id)) return;
      roomAvailability.set(room.id, null);
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
