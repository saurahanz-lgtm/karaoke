// ===== ADMIN USER MANAGEMENT LOGIC =====

// Initialize device session ID from sessionStorage on page load
function initializeDeviceSessionId() {
  let sessionId = sessionStorage.getItem("deviceSessionId");
  if (sessionId) {
    window.deviceSessionId = sessionId;
    console.log("🔄 Device session ID initialized from sessionStorage");
  } else {
    console.warn("⚠️ No device session ID found in sessionStorage");
    // If not found, redirect to login
    setTimeout(() => {
      if (!window.deviceSessionId) {
        console.log("❌ Redirecting to login - no session ID");
        window.location.href = "index.html";
      }
    }, 1000);
  }
}

// Call immediately on page load, before DOMContentLoaded
initializeDeviceSessionId();

// Users data storage
let users = [];
let currentEditingUserId = null;
let loggedInUser = null;
let currentFilter = null;
let currentUserPage = 1;
let currentRoomRequestView = "pending";
let currentKaraokeRoomPage = 1;
let currentRoomRequestPage = 1;
let currentAccountRequestView = "pending";
let currentAccountRequestPage = 1;
const USERS_PER_PAGE = 5;
const KARAOKE_ROOMS_PER_PAGE = 5;
const ROOM_REQUESTS_PER_PAGE = 5;
const ACCOUNT_REQUESTS_PER_PAGE = 5;
let activeLoginSessions = {};
let firebasePresenceLoaded = false;
let accountRequests = [];
let stopListeningToAccountRequests = null;
const ACTIVE_SESSION_TIMEOUT = 2 * 60 * 1000;
let karaokeRooms = [];
const roomDeviceCounts = new Map();
const roomDeviceIds = new Map();
const roomMemberListeners = new Map();
const roomRequestListeners = new Map();
const roomRequestsByRoom = new Map();
let knownPendingGlobalRoomRequestIds = new Set();
let allRoomRequests = [];
let stopListeningToAllRoomRequests = null;
let roomRequestApprovalAudioContext = null;
let pendingRoomRequestApprovalId = null;
let knownPendingAccountRequestIds = null;
let requestNotificationAudioContext = null;
let pendingRequestNotificationSounds = 0;

function normalizeAccountRecord(account, index = 0) {
  return {
    id: account?.id || index + 1,
    username: account?.username || `user_${index}`,
    password: typeof account?.password === "string" ? account.password : "",
    role: account?.role || "user",
    joined: account?.joined || new Date().toISOString().split("T")[0],
    lastActivity: account?.lastActivity ?? 0,
    disabled: account?.disabled === true,
    ...(account?.accountRequestId
      ? { accountRequestId: account.accountRequestId }
      : {}),
  };
}

// Initialize admin panel
document.addEventListener("DOMContentLoaded", function () {
  // Check if user is logged in
  if (!checkAuthentication()) return;

  const profileToggle = document.getElementById("adminProfileToggle");
  const profileMenu = document.getElementById("adminProfileMenu");
  const requestNotificationToggle = document.getElementById(
    "adminRequestNotificationsButton",
  );
  const requestNotificationPanel = document.getElementById(
    "adminRequestNotificationsPanel",
  );
  const sidebar = document.getElementById("adminSidebar");
  const sidebarToggle = document.getElementById("mobileSidebarToggle");
  const sidebarBackdrop = document.getElementById("mobileSidebarBackdrop");
  const setMobileSidebarOpen = (isOpen) => {
    const shouldOpen =
      isOpen && window.matchMedia("(max-width: 800px)").matches;
    sidebar.classList.toggle("is-open", shouldOpen);
    sidebarBackdrop.hidden = !shouldOpen;
    sidebarToggle.setAttribute("aria-expanded", String(shouldOpen));
    sidebarToggle.setAttribute(
      "aria-label",
      shouldOpen ? "Close navigation" : "Open navigation",
    );
    document.body.classList.toggle("mobile-sidebar-open", shouldOpen);
    if (shouldOpen) {
      sidebar.querySelector("[data-admin-view-target]").focus();
    } else if (
      isOpen === false &&
      window.matchMedia("(max-width: 800px)").matches
    ) {
      sidebarToggle.focus();
    }
  };
  document.querySelectorAll("[data-admin-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      setAdminView(button.dataset.adminViewTarget);
      setMobileSidebarOpen(false);
    });
  });
  sidebarToggle.addEventListener("click", () => {
    setMobileSidebarOpen(
      sidebarToggle.getAttribute("aria-expanded") !== "true",
    );
  });
  sidebarBackdrop.addEventListener("click", () => setMobileSidebarOpen(false));
  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 800px)").matches) {
      setMobileSidebarOpen(false);
    }
  });
  profileToggle.addEventListener("click", () => {
    const isOpen = profileMenu.hidden;
    profileMenu.hidden = !isOpen;
    profileToggle.setAttribute("aria-expanded", String(isOpen));
  });
  requestNotificationToggle.addEventListener("click", () => {
    const isOpen = requestNotificationPanel.hidden;
    requestNotificationPanel.hidden = !isOpen;
    requestNotificationToggle.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("pointerdown", enableRequestNotificationSound);
  document.addEventListener("keydown", enableRequestNotificationSound);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".admin-profile")) {
      profileMenu.hidden = true;
      profileToggle.setAttribute("aria-expanded", "false");
    }
    if (!event.target.closest(".admin-notifications")) {
      requestNotificationPanel.hidden = true;
      requestNotificationToggle.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      sidebarToggle.getAttribute("aria-expanded") === "true"
    ) {
      setMobileSidebarOpen(false);
      return;
    }
    if (event.key === "Escape" && !requestNotificationPanel.hidden) {
      requestNotificationPanel.hidden = true;
      requestNotificationToggle.setAttribute("aria-expanded", "false");
      requestNotificationToggle.focus();
      return;
    }
    if (event.key === "Escape" && !profileMenu.hidden) {
      profileMenu.hidden = true;
      profileToggle.setAttribute("aria-expanded", "false");
      profileToggle.focus();
    }
  });
  document.getElementById("adminProfileName").textContent =
    loggedInUser?.username || "Administrator";
  document.getElementById("todayDate").textContent =
    new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  setAdminView("dashboard");

  // Load users from localStorage
  loadUsers();
  initializePresenceListener();
  initializeAccountRequestListener();
  initializeRoomManagement();

  // Add event listeners
  document
    .getElementById("addUserForm")
    .addEventListener("submit", handleAddUser);
  document.getElementById("userSearch").addEventListener("input", () => {
    currentUserPage = 1;
    displayUsers();
  });
  document.getElementById("previousUsersPage").addEventListener("click", () => {
    currentUserPage = Math.max(1, currentUserPage - 1);
    displayUsers();
  });
  document.getElementById("nextUsersPage").addEventListener("click", () => {
    currentUserPage += 1;
    displayUsers();
  });
  document
    .querySelectorAll("[data-account-request-filter]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        selectAccountRequestView(button.dataset.accountRequestFilter),
      );
    });
  document.querySelectorAll("[data-room-request-filter]").forEach((button) => {
    button.addEventListener("click", () =>
      selectRoomRequestView(button.dataset.roomRequestFilter),
    );
  });
  document
    .getElementById("previousKaraokeRoomsPage")
    .addEventListener("click", () => {
      currentKaraokeRoomPage = Math.max(1, currentKaraokeRoomPage - 1);
      renderKaraokeRooms();
    });
  document
    .getElementById("nextKaraokeRoomsPage")
    .addEventListener("click", () => {
      currentKaraokeRoomPage += 1;
      renderKaraokeRooms();
    });
  document
    .getElementById("previousRoomRequestsPage")
    .addEventListener("click", () => {
      currentRoomRequestPage = Math.max(1, currentRoomRequestPage - 1);
      renderCurrentRoomRequests();
    });
  document
    .getElementById("nextRoomRequestsPage")
    .addEventListener("click", () => {
      currentRoomRequestPage += 1;
      renderCurrentRoomRequests();
    });
  document
    .getElementById("previousAccountRequestsPage")
    .addEventListener("click", () => {
      currentAccountRequestPage = Math.max(1, currentAccountRequestPage - 1);
      renderAccountRequests();
    });
  document
    .getElementById("nextAccountRequestsPage")
    .addEventListener("click", () => {
      currentAccountRequestPage += 1;
      renderAccountRequests();
    });
  document
    .getElementById("createRoomForm")
    .addEventListener("submit", handleCreateRoom);
  if (loggedInUser?.role !== "admin") {
    document.getElementById("createRoomForm").hidden = true;
  }

  // Display initial users
  const requestsById = new Map(
    [...Array.from(roomRequestsByRoom.values()).flat(), ...allRoomRequests].map(
      (request) => [request.id, request],
    ),
  );
  renderRoomRequests(Array.from(requestsById.values()));
  // Re-evaluate presence as activity timestamps age out, without reloading stale local data.
  setInterval(() => {
    displayUsers();
    updateStats();
  }, 15000);

  // Also track clicks and key presses to update activity
  document.addEventListener("click", updateAdminActivity);
  document.addEventListener("keypress", updateAdminActivity);

  // Set up broadcast channel to get immediate updates when users log in/out
  try {
    const userUpdateChannel = new BroadcastChannel("karaoke_user_updates");
    userUpdateChannel.addEventListener("message", (event) => {
      if (event.data?.type === "user_logout") {
        if (loggedInUser?.username === event.data.username) {
          console.log("🚪 Current admin was logged out from another device");
          localStorage.removeItem("karaoke_logged_in_user");
          window.location.replace("index.html");
          return;
        }
        console.log("📢 User logout received:", event.data.username);
      }

      if (event.data?.type === "user_login") {
        console.log("📢 User login received:", event.data.username);
      }

      // Reload users from Firebase immediately
      loadUsers();
    });
  } catch (error) {
    console.warn("BroadcastChannel not supported:", error.message);
  }

  // Load karaoke display status on page load
  initializeKaraokeDisplayAnnouncementControls();
  loadKaraokeDisplayStatus();
});

function setAdminView(viewName) {
  const selectedView = document.querySelector(
    `[data-admin-view="${viewName}"]`,
  );
  if (!selectedView) {
    console.error("Admin view not found:", viewName);
    return;
  }

  document.querySelectorAll("[data-admin-view]").forEach((view) => {
    view.hidden = view !== selectedView;
  });
  document.querySelectorAll("[data-admin-view-target]").forEach((button) => {
    if (button.dataset.adminViewTarget === viewName) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  const heading = document.getElementById("viewHeading");
  const subheading = document.getElementById("viewSubheading");
  const viewCopy = {
    dashboard: ["Dashboard", "A live overview of your karaoke system."],
    users: ["User Management", "Manage registered accounts and access."],
    display: ["Karaoke Display Control", "Manage the shared display."],
    rooms: ["Karaoke Rooms", "Monitor rooms and connected performers."],
    requests: ["Room Requests", "Review requests waiting for approval."],
    addUser: ["Add New User", "Create an account for your karaoke system."],
  }[viewName];
  if (viewCopy && heading && subheading) {
    heading.textContent = viewCopy[0];
    subheading.textContent = viewCopy[1];
  }
}

function initializeRoomManagement() {
  if (
    !window.KaraokeSessions ||
    typeof firebase === "undefined" ||
    !firebase.database
  ) {
    document.getElementById("roomMonitorStatus").textContent =
      "Room monitoring unavailable";
    return;
  }

  KaraokeSessions.ensureDefaultRoom()
    .then(() => {
      KaraokeSessions.listenRooms((rooms) => {
        karaokeRooms = rooms;
        const roomIds = new Set(rooms.map((room) => room.id));

        roomMemberListeners.forEach((stopListening, roomId) => {
          if (!roomIds.has(roomId)) {
            stopListening();
            roomMemberListeners.delete(roomId);
            roomDeviceCounts.delete(roomId);
            roomDeviceIds.delete(roomId);
          }
        });
        roomRequestListeners.forEach((stopListening, roomId) => {
          if (!roomIds.has(roomId)) {
            stopListening();
            roomRequestListeners.delete(roomId);
            roomRequestsByRoom.delete(roomId);
          }
        });

        rooms.forEach((room) => {
          if (!roomMemberListeners.has(room.id)) {
            roomDeviceCounts.set(room.id, 0);
            const stopListening = KaraokeSessions.listenMembers(
              room.id,
              (count, deviceIds) => {
                roomDeviceCounts.set(room.id, count);
                roomDeviceIds.set(room.id, deviceIds);
                renderKaraokeRooms();
              },
            );
            roomMemberListeners.set(room.id, stopListening);
          }

          if (!roomRequestListeners.has(room.id)) {
            const stopListening = KaraokeSessions.listenRoomRequests(
              room.id,
              (requests) => {
                roomRequestsByRoom.set(room.id, requests);
                renderRoomRequests(
                  Array.from(roomRequestsByRoom.values()).flat(),
                );
              },
            );
            roomRequestListeners.set(room.id, stopListening);
          }
        });

        stopListeningToAllRoomRequests?.();
        stopListeningToAllRoomRequests = KaraokeSessions.listenAllRoomRequests(
          (requests) => {
            const pendingIds = new Set(
              requests
                .filter((request) => request.status === "pending")
                .map((request) => request.id),
            );
            if (
              [...pendingIds].some(
                (id) => !knownPendingGlobalRoomRequestIds.has(id),
              )
            ) {
              playRequestNotificationSound();
            }
            knownPendingGlobalRoomRequestIds = pendingIds;
            allRoomRequests = requests;
            const deduplicatedRequests = Array.from(
              new Map(
                [
                  ...Array.from(roomRequestsByRoom.values()).flat(),
                  ...requests,
                ].map((request) => [request.id, request]),
              ).values(),
            ).sort(
              (first, second) =>
                (first.createdAt || 0) - (second.createdAt || 0),
            );
            renderRoomRequests(deduplicatedRequests);
          },
          (error) => {
            console.error("Could not listen for room requests:", error.message);
          },
        );

        updateAdminRequestNotifications();
        document.getElementById("roomMonitorStatus").textContent =
          "Live room status";
        renderKaraokeRooms();
        renderDashboard();
      });
    })
    .catch((error) => {
      console.error("Could not load karaoke rooms:", error.message);
      document.getElementById("roomMonitorStatus").textContent =
        "Could not load rooms";
      document.getElementById("roomsTableBody").innerHTML =
        '<tr><td colspan="3" class="text-center text-danger">Check the Firebase connection.</td></tr>';
    });
}

function initializeAccountRequestListener() {
  const tableBody = document.getElementById("accountRequestsTableBody");
  if (
    !window.KaraokeAccountRequests ||
    typeof firebase === "undefined" ||
    !firebase.database
  ) {
    tableBody.innerHTML =
      '<tr><td colspan="4" class="text-center text-white-50">Account request review is unavailable.</td></tr>';
    return;
  }

  stopListeningToAccountRequests = KaraokeAccountRequests.listenAll(
    (requests) => {
      const pendingIds = new Set(
        requests
          .filter((request) => request.status === "pending")
          .map((request) => request.id),
      );
      if (
        knownPendingAccountRequestIds &&
        [...pendingIds].some((id) => !knownPendingAccountRequestIds.has(id))
      ) {
        playRequestNotificationSound();
      }
      knownPendingAccountRequestIds = pendingIds;
      accountRequests = requests;
      renderAccountRequests();
    },
    (error) => {
      console.error("Account request listener failed:", error.message);
      tableBody.innerHTML =
        '<tr><td colspan="4" class="text-center text-white-50">Could not load account requests.</td></tr>';
    },
  );
}

function renderAccountRequests() {
  const tableBody = document.getElementById("accountRequestsTableBody");
  const pagination = document.getElementById("accountRequestsPagination");
  const previousButton = document.getElementById("previousAccountRequestsPage");
  const nextButton = document.getElementById("nextAccountRequestsPage");
  const pendingCount = accountRequests.filter(
    (request) => request.status === "pending",
  ).length;
  document.getElementById("pendingAccountRequestCount").textContent =
    `${pendingCount} pending`;
  updateAdminRequestNotifications();

  const visibleRequests =
    currentAccountRequestView === "history"
      ? accountRequests.filter((request) =>
          ["approved", "rejected"].includes(request.status),
        )
      : accountRequests.filter((request) =>
          ["pending", "approving"].includes(request.status),
        );
  if (visibleRequests.length === 0) {
    currentAccountRequestPage = 1;
    pagination.hidden = true;
    tableBody.innerHTML =
      currentAccountRequestView === "history"
        ? '<tr><td colspan="4" class="text-center text-white-50">No approved or rejected requests yet.</td></tr>'
        : '<tr><td colspan="4" class="text-center text-white-50">No pending account requests.</td></tr>';
    return;
  }

  const pageCount = Math.ceil(
    visibleRequests.length / ACCOUNT_REQUESTS_PER_PAGE,
  );
  currentAccountRequestPage = Math.min(
    Math.max(1, currentAccountRequestPage),
    pageCount,
  );
  pagination.hidden = pageCount <= 1;
  previousButton.disabled = currentAccountRequestPage === 1;
  nextButton.disabled = currentAccountRequestPage === pageCount;
  document.getElementById("currentAccountRequestsPage").textContent = String(
    currentAccountRequestPage,
  );
  document.getElementById("totalAccountRequestsPages").textContent =
    String(pageCount);
  const firstRequestIndex =
    (currentAccountRequestPage - 1) * ACCOUNT_REQUESTS_PER_PAGE;

  tableBody.replaceChildren(
    ...visibleRequests
      .slice(firstRequestIndex, firstRequestIndex + ACCOUNT_REQUESTS_PER_PAGE)
      .map((request) => {
        const row = document.createElement("tr");
        const usernameCell = document.createElement("td");
        const dateCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const actionCell = document.createElement("td");
        const actionGroup = document.createElement("div");
        const actionButtons = document.createElement("div");
        actionGroup.className = "account-request-row-actions";
        actionButtons.className = "account-actions";
        usernameCell.textContent = request.username || "Unknown username";
        dateCell.textContent = request.createdAt
          ? new Date(request.createdAt).toLocaleString()
          : "-";

        const status =
          request.status === "approving" ? "processing" : request.status;
        const statusBadge = document.createElement("span");
        statusBadge.className = `request-status request-status-${status || "pending"}`;
        statusBadge.textContent = status || "pending";
        statusCell.appendChild(statusBadge);

        if (request.status === "pending") {
          const approveButton = document.createElement("button");
          const rejectButton = document.createElement("button");
          approveButton.type = "button";
          approveButton.className = "table-action";
          approveButton.title = "Approve request";
          approveButton.setAttribute(
            "aria-label",
            `Approve account request from ${request.username || "unknown user"}`,
          );
          approveButton.innerHTML =
            '<i class="bi bi-check2-circle" aria-hidden="true"></i>';
          rejectButton.type = "button";
          rejectButton.className = "table-action table-action-danger";
          rejectButton.title = "Reject request";
          rejectButton.setAttribute(
            "aria-label",
            `Reject account request from ${request.username || "unknown user"}`,
          );
          rejectButton.innerHTML =
            '<i class="bi bi-x-circle" aria-hidden="true"></i>';
          approveButton.addEventListener("click", () =>
            handleAccountRequestDecision(request, "approve", [
              approveButton,
              rejectButton,
            ]),
          );
          rejectButton.addEventListener("click", () =>
            handleAccountRequestDecision(request, "reject", [
              approveButton,
              rejectButton,
            ]),
          );
          actionButtons.append(approveButton, rejectButton);
        } else if (request.status === "approved") {
          const resolution = document.createElement("span");
          resolution.className = "account-request-resolution";
          resolution.textContent = "Account created";
          actionGroup.appendChild(resolution);
        } else if (request.status === "rejected") {
          const resolution = document.createElement("span");
          resolution.className = "account-request-resolution";
          resolution.textContent =
            request.resolutionMessage || "Request declined";
          actionGroup.appendChild(resolution);
        } else {
          const resolution = document.createElement("span");
          resolution.className = "account-request-resolution";
          resolution.textContent = "Approval in progress";
          actionGroup.appendChild(resolution);
        }

        if (request.status !== "approving") {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "table-action table-action-danger";
          deleteButton.title = "Delete request";
          deleteButton.setAttribute(
            "aria-label",
            `Delete account request from ${request.username || "unknown user"}`,
          );
          deleteButton.innerHTML =
            '<i class="bi bi-trash3" aria-hidden="true"></i>';
          deleteButton.addEventListener("click", () =>
            deleteAccountRequest(request, deleteButton),
          );
          actionButtons.appendChild(deleteButton);
        }

        if (actionButtons.childElementCount > 0) {
          actionGroup.appendChild(actionButtons);
        }
        actionCell.appendChild(actionGroup);
        row.append(usernameCell, dateCell, statusCell, actionCell);
        return row;
      }),
  );
}

function enableRequestNotificationSound() {
  const AudioContextConstructor =
    window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;

  try {
    if (
      !requestNotificationAudioContext ||
      requestNotificationAudioContext.state === "closed"
    ) {
      requestNotificationAudioContext = new AudioContextConstructor();
    }
    const resumePromise =
      requestNotificationAudioContext.state === "suspended"
        ? requestNotificationAudioContext.resume()
        : Promise.resolve();
    resumePromise
      .then(() => {
        if (requestNotificationAudioContext.state !== "running") return;
        while (pendingRequestNotificationSounds > 0) {
          pendingRequestNotificationSounds -= 1;
          playRequestNotificationSoundNow(requestNotificationAudioContext);
        }
        document.removeEventListener(
          "pointerdown",
          enableRequestNotificationSound,
        );
        document.removeEventListener("keydown", enableRequestNotificationSound);
      })
      .catch(() => {});
  } catch (error) {
    console.warn("Could not enable request notification sound:", error.message);
  }
}

function playRequestNotificationSound() {
  const audioContext = requestNotificationAudioContext;
  if (!audioContext || audioContext.state !== "running") {
    pendingRequestNotificationSounds += 1;
    enableRequestNotificationSound();
    return;
  }

  playRequestNotificationSoundNow(audioContext);
}

function playRequestNotificationSoundNow(audioContext) {
  const startAt = audioContext.currentTime;
  [880, 1174].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const toneStart = startAt + index * 0.14;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    volume.gain.setValueAtTime(0.0001, toneStart);
    volume.gain.exponentialRampToValueAtTime(0.3, toneStart + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.18);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.2);
  });
}

function selectAccountRequestView(view) {
  currentAccountRequestView = view === "history" ? "history" : "pending";
  currentAccountRequestPage = 1;
  document
    .querySelectorAll("[data-account-request-filter]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(
          button.dataset.accountRequestFilter === currentAccountRequestView,
        ),
      );
    });
  renderAccountRequests();
}

async function deleteAccountRequest(request, button) {
  if (
    !window.confirm(
      `Delete the account request from "${request.username || "unknown user"}"? This cannot be undone.`,
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    await KaraokeAccountRequests.remove(request.id);
    showNotification("Account request deleted.", "info");
  } catch (error) {
    console.error("Could not delete account request:", error.message);
    button.disabled = false;
    showNotification(
      error.message === "REQUEST_NOT_DELETABLE"
        ? "This request is being approved or no longer exists."
        : "Could not delete the account request. Check the Firebase connection.",
      "danger",
    );
  }
}

function updateAdminRequestNotifications() {
  const count = document.getElementById("adminRequestNotificationCount");
  const toggle = document.getElementById("adminRequestNotificationsButton");
  const emptyMessage = document.getElementById(
    "adminRequestNotificationsEmpty",
  );
  const list = document.getElementById("adminRequestNotificationList");
  if (!count || !toggle || !emptyMessage || !list) return;

  const roomRequests = Array.from(
    new Map(
      [
        ...Array.from(roomRequestsByRoom.values()).flat(),
        ...allRoomRequests,
      ].map((request) => [request.id, request]),
    ).values(),
  );
  const pendingRequests = [
    ...accountRequests
      .filter((request) => request.status === "pending")
      .map((request) => ({
        label: `Account request from ${request.username || "unknown user"}`,
        view: "users",
        createdAt: request.createdAt || 0,
      })),
    ...roomRequests
      .filter((request) => request.status === "pending")
      .map((request) => ({
        label: `Room request from ${request.username || "singer"} (${request.roomId || "unknown room"})`,
        view: "requests",
        createdAt: request.createdAt || 0,
      })),
  ].sort((first, second) => second.createdAt - first.createdAt);

  count.textContent =
    pendingRequests.length > 99 ? "99+" : String(pendingRequests.length);
  count.hidden = pendingRequests.length === 0;
  toggle.setAttribute(
    "aria-label",
    `Notifications: ${pendingRequests.length} pending ${pendingRequests.length === 1 ? "request" : "requests"}`,
  );
  emptyMessage.hidden = pendingRequests.length > 0;
  list.replaceChildren(
    ...pendingRequests.map((request) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-notification-item";
      button.textContent = request.label;
      button.addEventListener("click", () => {
        if (request.view === "users") selectAccountRequestView("pending");
        if (request.view === "requests") selectRoomRequestView("pending");
        setAdminView(request.view);
        document.getElementById("adminRequestNotificationsPanel").hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      });
      return button;
    }),
  );
}

async function handleAccountRequestDecision(request, decision, buttons) {
  if (
    decision === "reject" &&
    !window.confirm(`Reject the account request for "${request.username}"?`)
  ) {
    return;
  }

  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    if (decision === "approve") {
      await KaraokeAccountRequests.approve(request.id);
      playRequestNotificationSound();
      showNotification(
        "Account approved. The requester can now view their temporary password.",
        "success",
      );
    } else {
      await KaraokeAccountRequests.reject(request.id);
      playRequestNotificationSound();
      showNotification("Account request rejected.", "warning");
    }
  } catch (error) {
    console.error(`Could not ${decision} account request:`, error.message);
    buttons.forEach((button) => {
      button.disabled = false;
    });
    const message =
      error.message === "ACCOUNT_ALREADY_EXISTS"
        ? "That username is already in use. The requester has been notified."
        : error.message === "REQUEST_ALREADY_RESOLVED"
          ? "This account request has already been handled."
          : "Could not update the account request. Check the Firebase connection.";
    showNotification(message, "danger");
  }
}

function renderRoomRequests(requests) {
  updateAdminRequestNotifications();
  const tableBody = document.getElementById("roomRequestsTableBody");
  const pagination = document.getElementById("roomRequestsPagination");
  const previousButton = document.getElementById("previousRoomRequestsPage");
  const nextButton = document.getElementById("nextRoomRequestsPage");
  const pendingCount = requests.filter((request) =>
    ["pending", "approving"].includes(request.status),
  ).length;
  const historyCount = requests.filter((request) =>
    ["approved", "rejected"].includes(request.status),
  ).length;
  document.getElementById("pendingRoomRequestCount").textContent =
    `${pendingCount} pending · ${historyCount} history`;

  const visibleRequests = requests.filter((request) =>
    currentRoomRequestView === "history"
      ? ["approved", "rejected"].includes(request.status)
      : ["pending", "approving"].includes(request.status),
  );
  if (visibleRequests.length === 0) {
    currentRoomRequestPage = 1;
    pagination.hidden = true;
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-white-50">No ${currentRoomRequestView === "history" ? "room request history" : "pending room requests"}.</td></tr>`;
    return;
  }

  const pageCount = Math.ceil(visibleRequests.length / ROOM_REQUESTS_PER_PAGE);
  currentRoomRequestPage = Math.min(
    Math.max(1, currentRoomRequestPage),
    pageCount,
  );
  pagination.hidden = pageCount <= 1;
  previousButton.disabled = currentRoomRequestPage === 1;
  nextButton.disabled = currentRoomRequestPage === pageCount;
  document.getElementById("currentRoomRequestsPage").textContent = String(
    currentRoomRequestPage,
  );
  document.getElementById("totalRoomRequestsPages").textContent =
    String(pageCount);
  const firstRequestIndex =
    (currentRoomRequestPage - 1) * ROOM_REQUESTS_PER_PAGE;

  tableBody.replaceChildren(
    ...visibleRequests
      .slice(firstRequestIndex, firstRequestIndex + ROOM_REQUESTS_PER_PAGE)
      .map((request) => {
        const row = document.createElement("tr");
        const singerCell = document.createElement("td");
        const roomCell = document.createElement("td");
        const dateCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const actionCell = document.createElement("td");
        singerCell.textContent = request.username || "Performer";
        roomCell.textContent = request.roomId || "Unknown room";
        dateCell.textContent = request.createdAt
          ? new Date(request.createdAt).toLocaleString()
          : "-";
        const status =
          request.status === "approving" ? "processing" : request.status;
        const statusBadge = document.createElement("span");
        statusBadge.className = `request-status request-status-${status || "pending"}`;
        statusBadge.textContent = status || "pending";
        statusCell.appendChild(statusBadge);
        if (request.status === "pending") {
          const approveButton = document.createElement("button");
          const rejectButton = document.createElement("button");
          approveButton.type = "button";
          approveButton.className = "btn btn-sm btn-success me-2";
          approveButton.textContent = "Approve";
          rejectButton.type = "button";
          rejectButton.className = "btn btn-sm btn-outline-danger";
          rejectButton.textContent = "Reject";
          approveButton.addEventListener("click", () =>
            handleRoomRequestDecision(request, "approve", [
              approveButton,
              rejectButton,
            ]),
          );
          rejectButton.addEventListener("click", () =>
            handleRoomRequestDecision(request, "reject", [
              approveButton,
              rejectButton,
            ]),
          );
          actionCell.append(approveButton, rejectButton);
        } else if (
          currentRoomRequestView === "history" &&
          ["approved", "rejected"].includes(request.status)
        ) {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "btn btn-sm btn-outline-danger";
          deleteButton.textContent = "Delete";
          deleteButton.addEventListener("click", () =>
            handleDeleteRoomRequest(request, deleteButton),
          );
          actionCell.appendChild(deleteButton);
        } else {
          actionCell.textContent = request.approvedRoomId
            ? `Room ${request.approvedRoomId}`
            : "-";
        }
        row.append(singerCell, roomCell, dateCell, statusCell, actionCell);
        return row;
      }),
  );
}

function selectRoomRequestView(view) {
  currentRoomRequestView = view === "history" ? "history" : "pending";
  currentRoomRequestPage = 1;
  document.querySelectorAll("[data-room-request-filter]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.roomRequestFilter === currentRoomRequestView),
    );
  });
  renderCurrentRoomRequests();
}

function renderCurrentRoomRequests() {
  const requestsById = new Map(
    [...Array.from(roomRequestsByRoom.values()).flat(), ...allRoomRequests].map(
      (request) => [request.id, request],
    ),
  );
  renderRoomRequests(Array.from(requestsById.values()));
}

async function handleDeleteRoomRequest(request, button) {
  if (
    !window.confirm(
      `Delete the ${request.status} room request from "${request.username || "Performer"}"? This cannot be undone.`,
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    await KaraokeSessions.deleteRoomRequest(request.roomId, request.id);
    showNotification("Room request deleted.", "info");
  } catch (error) {
    console.error("Could not delete room request:", error.message);
    button.disabled = false;
    showNotification(
      error.message === "ROOM_REQUEST_NOT_DELETABLE"
        ? "Only approved or rejected room requests can be deleted."
        : "Could not delete the room request. Check the Firebase connection.",
      "danger",
    );
  }
}

async function handleRoomRequestDecision(request, decision, buttons) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    if (decision === "approve") {
      await KaraokeSessions.approveRoomRequest(
        request.roomId,
        request.id,
        `${request.username || "Performer"}'s Room`,
      );
      playRequestNotificationSound();
      showNotification(
        `Room approved for ${request.username || "singer"}.`,
        "success",
      );
    } else {
      await KaraokeSessions.rejectRoomRequest(request.roomId, request.id);
      playRequestNotificationSound();
      showNotification(
        `Room request from ${request.username || "singer"} rejected.`,
        "warning",
      );
    }
  } catch (error) {
    console.error(`Could not ${decision} room request:`, error);
    buttons.forEach((button) => {
      button.disabled = false;
    });
    showNotification(
      error.message === "ROOM_REQUEST_ALREADY_RESOLVED"
        ? "This room request has already been handled."
        : "Could not update the room request. Check the Firebase connection.",
      "danger",
    );
  }
}

function renderKaraokeRooms() {
  const tableBody = document.getElementById("roomsTableBody");
  const pagination = document.getElementById("karaokeRoomsPagination");
  const previousButton = document.getElementById("previousKaraokeRoomsPage");
  const nextButton = document.getElementById("nextKaraokeRoomsPage");
  const totalDevices = new Set(Array.from(roomDeviceIds.values()).flat()).size;

  document.getElementById("totalKaraokeRooms").textContent = String(
    karaokeRooms.length,
  );
  document.getElementById("totalRoomDevices").textContent =
    String(totalDevices);
  renderDashboard();

  if (karaokeRooms.length === 0) {
    currentKaraokeRoomPage = 1;
    pagination.hidden = true;
    tableBody.innerHTML =
      '<tr><td colspan="5" class="text-center text-white-50">No rooms created yet.</td></tr>';
    return;
  }

  const pageCount = Math.ceil(karaokeRooms.length / KARAOKE_ROOMS_PER_PAGE);
  currentKaraokeRoomPage = Math.min(
    Math.max(1, currentKaraokeRoomPage),
    pageCount,
  );
  pagination.hidden = pageCount <= 1;
  previousButton.disabled = currentKaraokeRoomPage === 1;
  nextButton.disabled = currentKaraokeRoomPage === pageCount;
  document.getElementById("currentKaraokeRoomsPage").textContent = String(
    currentKaraokeRoomPage,
  );
  document.getElementById("totalKaraokeRoomsPages").textContent =
    String(pageCount);
  const firstRoomIndex = (currentKaraokeRoomPage - 1) * KARAOKE_ROOMS_PER_PAGE;

  tableBody.replaceChildren(
    ...karaokeRooms
      .slice(firstRoomIndex, firstRoomIndex + KARAOKE_ROOMS_PER_PAGE)
      .map((room) => {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const codeCell = document.createElement("td");
        const devicesCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const actionCell = document.createElement("td");
        nameCell.textContent = room.name;
        codeCell.textContent = room.id;
        const deviceCount = roomDeviceCounts.get(room.id) || 0;
        devicesCell.textContent = `${deviceCount} / ${KaraokeSessions.MAX_DEVICES}`;
        const statusBadge = document.createElement("span");
        const roomStatus =
          deviceCount >= KaraokeSessions.MAX_DEVICES
            ? "full"
            : deviceCount > 0
              ? "occupied"
              : "available";
        statusBadge.className = `account-state room-state-${roomStatus}`;
        statusBadge.textContent = roomStatus;
        statusCell.appendChild(statusBadge);
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.className = "btn btn-sm btn-outline-light me-2";
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", () =>
          handleRenameRoom(room, renameButton),
        );
        actionCell.appendChild(renameButton);
        if (room.id === "main") {
          const defaultLabel = document.createElement("span");
          defaultLabel.textContent = "Default room";
          actionCell.appendChild(defaultLabel);
        } else {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "btn btn-sm btn-outline-danger";
          deleteButton.textContent = "Delete";
          deleteButton.disabled = deviceCount > 0;
          deleteButton.title =
            deviceCount > 0
              ? "Disconnect all phones before deleting this room"
              : `Delete ${room.name}`;
          deleteButton.addEventListener("click", () =>
            handleDeleteRoom(room, deleteButton),
          );
          actionCell.appendChild(deleteButton);
        }
        row.append(nameCell, codeCell, devicesCell, statusCell, actionCell);
        return row;
      }),
  );
}

async function handleRenameRoom(room, button) {
  const name = window.prompt("Enter the new room name:", room.name);
  if (name === null || name.trim() === room.name) return;
  if (!name.trim()) {
    showNotification("Room name cannot be empty.", "warning");
    return;
  }

  button.disabled = true;
  try {
    await KaraokeSessions.renameRoom(room.id, name);
    showNotification("Room renamed.", "success");
  } catch (error) {
    console.error("Could not rename karaoke room:", error.message);
    button.disabled = false;
    showNotification(
      error.message === "ROOM_NOT_FOUND"
        ? "That room no longer exists."
        : "Could not rename room. Check the Firebase connection.",
      "danger",
    );
  }
}

async function handleDeleteRoom(room, button) {
  if (
    !window.confirm(
      `Delete room "${room.name}" and its queue, requests, and saved data?`,
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    await KaraokeSessions.deleteRoom(room.id);
  } catch (error) {
    console.error("Could not delete karaoke room:", error.message);
    button.disabled = false;
    const message =
      error.message === "ROOM_HAS_ACTIVE_DEVICES"
        ? "Disconnect all phones from this room before deleting it."
        : "Could not delete room. Check the Firebase connection.";
    alert(message);
  }
}

async function handleCreateRoom(event) {
  event.preventDefault();
  if (loggedInUser?.role !== "admin") {
    alert("Only admins can create rooms.");
    return;
  }

  const input = document.getElementById("newRoomName");
  const name = input.value.trim();
  if (!name) return;

  const button = document.getElementById("createRoomButton");
  button.disabled = true;
  try {
    await KaraokeSessions.createRoom(name);
    input.value = "";
  } catch (error) {
    console.error("Could not create karaoke room:", error.message);
    alert("Could not create room. Check the Firebase connection.");
  } finally {
    button.disabled = false;
  }
}

// Validate that the current session is still active (not logged in elsewhere)
function validateSessionValidity() {
  const stored = localStorage.getItem("karaoke_logged_in_user");
  if (!stored) {
    // User data was cleared (logged in from another device)
    console.warn("⚠️ User session cleared from localStorage");
    // Don't immediately redirect - give Firebase time to update
    // Just log a warning and let validateAdminSession handle it
    return false;
  }
  return true;
}

// Check authentication
function checkAuthentication() {
  const stored = localStorage.getItem("karaoke_logged_in_user");
  if (stored) {
    loggedInUser = JSON.parse(stored);
    if (loggedInUser.role !== "admin") {
      const isRoomRequestConfirmation =
        new URLSearchParams(window.location.search).get("roomRequestSent") ===
        "1";
      if (isRoomRequestConfirmation) {
        document.getElementById("adminDashboard").hidden = true;
        document.getElementById("roomRequestConfirmation").hidden = false;
        watchRoomRequestForPerformer();
        return false;
      }
      window.location.href = "index.html";
      return false;
    }

    // Show logged in user info
    const userInfoEl = document.getElementById("loggedInUser");
    if (userInfoEl) {
      userInfoEl.textContent = `Logged in as: ${loggedInUser.username} (${loggedInUser.role})`;
    }

    // Validate session immediately
    validateAdminSession();
    return true;
  } else {
    // Not logged in, redirect to home
    alert("Please login first");
    window.location.href = "index.html";
    return false;
  }
}

function watchRoomRequestForPerformer() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");
  const requestId = params.get("request");
  const status = document.getElementById("roomRequestConfirmationStatus");
  let roomApprovalNavigationStarted = false;
  if (!roomId || !requestId) {
    status.textContent =
      "Request details are missing. Return to karaoke and send the request again.";
    return;
  }

  document.addEventListener("pointerdown", enableRoomRequestApprovalSound, {
    once: true,
  });
  document.addEventListener("keydown", enableRoomRequestApprovalSound, {
    once: true,
  });

  KaraokeSessions.listenRoomRequest(
    roomId,
    requestId,
    (request) => {
      if (!request) {
        status.textContent =
          "Could not find your room request. Return to karaoke and try again.";
      } else if (
        request.status === "approved" &&
        request.approvedRoomId &&
        !roomApprovalNavigationStarted
      ) {
        roomApprovalNavigationStarted = true;
        status.textContent = "Approved! Connecting you to your new room...";
        const soundStarted = playRoomRequestApprovalSound(requestId);
        const url = new URL("performer-portal.html", window.location.href);
        url.searchParams.set("room", request.approvedRoomId);
        window.setTimeout(
          () => window.location.replace(url.toString()),
          soundStarted ? 900 : 1800,
        );
      } else if (request.status === "rejected") {
        status.textContent =
          "Your room request was rejected. You can return to karaoke and try again later.";
      } else {
        status.textContent =
          "The User Management team has been notified. Waiting for approval...";
      }
    },
    (error) => {
      console.error("Could not listen to room request:", error.message);
      status.textContent =
        "Could not check your request status. Please refresh this page.";
    },
  );
}

function enableRoomRequestApprovalSound() {
  const AudioContextConstructor =
    window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;

  try {
    roomRequestApprovalAudioContext ??= new AudioContextConstructor();
    const resumePromise =
      roomRequestApprovalAudioContext.state === "suspended"
        ? roomRequestApprovalAudioContext.resume()
        : Promise.resolve();
    resumePromise
      .then(() => {
        if (
          pendingRoomRequestApprovalId &&
          roomRequestApprovalAudioContext.state === "running"
        ) {
          const requestId = pendingRoomRequestApprovalId;
          pendingRoomRequestApprovalId = null;
          playRoomRequestApprovalSound(requestId);
        }
      })
      .catch(() => {});
  } catch (error) {
    console.warn("Could not enable room approval sound:", error.message);
  }
}

function playRoomRequestApprovalSound(requestId) {
  const playedKey = `karaoke_room_approval_sound_${requestId}`;
  if (sessionStorage.getItem(playedKey)) return true;
  if (
    !roomRequestApprovalAudioContext ||
    roomRequestApprovalAudioContext.state !== "running"
  ) {
    pendingRoomRequestApprovalId = requestId;
    enableRoomRequestApprovalSound();
    return false;
  }

  sessionStorage.setItem(playedKey, "1");
  const startAt = roomRequestApprovalAudioContext.currentTime;
  [784, 1046].forEach((frequency, index) => {
    const oscillator = roomRequestApprovalAudioContext.createOscillator();
    const volume = roomRequestApprovalAudioContext.createGain();
    const toneStart = startAt + index * 0.14;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    volume.gain.setValueAtTime(0.0001, toneStart);
    volume.gain.exponentialRampToValueAtTime(0.12, toneStart + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.2);
    oscillator.connect(volume);
    volume.connect(roomRequestApprovalAudioContext.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.22);
  });
  return true;
}

// Validate Firebase session match for admin
function validateAdminSession() {
  const username = loggedInUser?.username;
  let deviceSessionId = window.deviceSessionId;

  // If not in memory, try to get from sessionStorage
  if (!deviceSessionId) {
    deviceSessionId = sessionStorage.getItem("deviceSessionId");
    if (deviceSessionId) {
      window.deviceSessionId = deviceSessionId;
      console.log("🔄 Retrieved device session ID from sessionStorage");
    }
  }

  if (!username) {
    console.warn("❌ No username in loggedInUser");
    return;
  }

  if (!deviceSessionId) {
    console.warn(
      "⚠️ No device session ID in memory or sessionStorage - user may have lost session",
    );
    // Don't disconnect here - let user continue and login again if needed
    return;
  }

  console.log("🔍 Validating admin session...");

  // Check Firebase to see if logged in admin matches current device
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      firebase
        .database()
        .ref("activeLogin/" + username)
        .once("value", (snapshot) => {
          const data = snapshot.val();

          if (!data || !data.sessionId) {
            console.log(
              "ℹ️ No active admin session in Firebase (may have expired)",
            );
            // Don't disconnect automatically - Firebase session may have expired
            // Re-register the current session
            try {
              firebase
                .database()
                .ref("activeLogin/" + username)
                .set({
                  sessionId: deviceSessionId,
                  timestamp: Date.now(),
                  loginTime: new Date().toISOString(),
                });
              console.log("✅ Re-registered current session in Firebase");
            } catch (e) {
              console.warn("Could not re-register session:", e.message);
            }
            return;
          }

          // Check if sessionId matches current device
          if (data.sessionId !== deviceSessionId) {
            // Different device logged in, but check the timestamp
            const timeSinceLogin = Date.now() - (data.timestamp || 0);

            // Only show disconnect warning if the OTHER login is very recent (within 2 minutes)
            // This prevents false positives from stale Firebase data
            if (timeSinceLogin < 120000) {
              console.warn(
                "❌ Admin session mismatch! Logged in from another device within last 2 minutes.",
              );
              console.warn(
                `Other device logged in ${(timeSinceLogin / 1000).toFixed(0)} seconds ago`,
              );
              alert(
                "Your session has been disconnected. You were logged in from another device.",
              );
              window.location.href = "index.html";
              return;
            } else {
              console.log(
                `ℹ️ Different device in Firebase but login was ${(timeSinceLogin / 1000).toFixed(0)}s ago - likely stale data`,
              );
              // Re-register current session to update Firebase
              try {
                firebase
                  .database()
                  .ref("activeLogin/" + username)
                  .set({
                    sessionId: deviceSessionId,
                    timestamp: Date.now(),
                    loginTime: new Date().toISOString(),
                  });
              } catch (e) {
                console.warn("Could not update session:", e.message);
              }
            }
            return;
          }

          console.log("✅ Admin session validated successfully");
        })
        .catch((err) => {
          console.warn("Firebase admin validation error:", err.message);
        });
    } catch (e) {
      console.warn("Firebase validation exception:", e.message);
    }
  }
}

// Update the logged-in admin user's activity
function updateAdminActivity() {
  if (!loggedInUser) return;

  const now = Date.now();

  // Update ONLY the logged-in user in the local users array (don't overwrite others)
  // Try to find by id first, then by username as fallback
  let userIndex = users.findIndex((u) => u.id === loggedInUser.id);
  if (userIndex === -1) {
    // Fallback: search by username
    userIndex = users.findIndex((u) => u.username === loggedInUser.username);
  }

  if (userIndex !== -1) {
    // User found, update their lastActivity
    const updatedUsers = [...users];
    updatedUsers[userIndex] = {
      ...updatedUsers[userIndex],
      lastActivity: now,
    };
    users = updatedUsers;
    loggedInUser.lastActivity = now; // Update logged-in user reference

    // Update in Firebase (users stored as array)
    if (typeof firebase !== "undefined" && firebase.database) {
      try {
        // Save entire users array to Firebase with updated activity
        firebase
          .database()
          .ref(`users/${userIndex}/lastActivity`)
          .set(now)
          .catch((err) =>
            console.warn("Firebase admin activity update failed:", err.message),
          );
      } catch (error) {
        console.warn("Error updating admin activity:", error.message);
      }
    }
  } else {
    // User not found in users array, add them to the list if they're an admin
    if (loggedInUser.role === "admin") {
      const newAdminUser = {
        ...loggedInUser,
        id: loggedInUser.id || Math.max(...users.map((u) => u.id || 0), 0) + 1,
        username: loggedInUser.username,
        password: loggedInUser.password || "",
        role: "admin",
        joined: loggedInUser.joined || new Date().toISOString().split("T")[0],
        lastActivity: now,
        disabled: false,
      };

      users.push(newAdminUser);
      loggedInUser.lastActivity = now;

      // Update in Firebase
      if (typeof firebase !== "undefined" && firebase.database) {
        try {
          firebase
            .database()
            .ref(`users/${users.length - 1}`)
            .set(newAdminUser)
            .catch((err) =>
              console.warn(
                "Firebase admin activity update failed:",
                err.message,
              ),
            );
        } catch (error) {
          console.warn("Error adding admin to users list:", error.message);
        }
      }

      console.log(
        "✅ Admin user added to singers list:",
        loggedInUser.username,
      );
    }
  }

  // Also update the session timestamp to prevent it from being marked as stale
  if (typeof firebase !== "undefined" && firebase.database && loggedInUser) {
    try {
      firebase
        .database()
        .ref("activeLogin/" + loggedInUser.username)
        .update({
          timestamp: now,
        })
        .catch((err) =>
          console.warn(
            "Firebase session timestamp update failed:",
            err.message,
          ),
        );
    } catch (error) {
      console.warn("Error updating session timestamp:", error.message);
    }
  }

  console.log("👨‍💼 Admin activity updated:", new Date().toLocaleTimeString());
}

// Handle password change

// Logout function
async function logout() {
  if (confirm("Are you sure you want to logout?")) {
    const username = loggedInUser?.username;
    let clearSessionPromise = Promise.resolve();

    // Broadcast logout event to all tabs
    try {
      const userUpdateChannel = new BroadcastChannel("karaoke_user_updates");
      userUpdateChannel.postMessage({
        type: "user_logout",
        username: username,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn("BroadcastChannel not supported:", error.message);
    }

    // Clear from Firebase first
    if (username && typeof firebase !== "undefined" && firebase.database) {
      try {
        // 1. Mark user as Offline in users array (set lastActivity to 0)
        firebase
          .database()
          .ref("users")
          .once("value", (snapshot) => {
            const data = snapshot.val();
            if (data) {
              const firebaseUsers = Array.isArray(data)
                ? data
                : Object.values(data);
              const userIndex = firebaseUsers.findIndex(
                (u) => u.username === username,
              );
              if (userIndex !== -1) {
                firebase
                  .database()
                  .ref(`users/${userIndex}/lastActivity`)
                  .set(0)
                  .catch((err) =>
                    console.warn("Failed to mark offline:", err.message),
                  );
              }
            }
          });

        // 2. Clear from Firebase activeLogin
        clearSessionPromise = firebase
          .database()
          .ref("activeLogin/" + username)
          .remove()
          .then(() => console.log("✅ Admin session cleared from Firebase"))
          .catch((err) =>
            console.warn("⚠️ Firebase logout failed:", err.message),
          );
      } catch (e) {
        console.warn("⚠️ Firebase error:", e.message);
      }
    }

    await clearSessionPromise;

    // Clear from memory and storage
    loggedInUser = null;
    window.deviceSessionId = null;
    sessionStorage.removeItem("deviceSessionId");
    localStorage.removeItem("karaoke_logged_in_user");

    console.log("✅ Admin logout complete");
    window.location.href = "index.html";
  }
}

// Load users from Firebase/localStorage
function loadUsers() {
  // First, always load from localStorage immediately
  loadFromLocalStorage();
  console.log("📂 Initial load from localStorage: ", users.length, "users");

  // Display immediately with localStorage data (ensures users see data right away)
  displayUsers();
  updateStats();

  // Firebase is authoritative when available; localStorage is only an immediate display fallback.
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      const usersRef = firebase.database().ref("users");
      usersRef
        .once("value")
        .then((snapshot) => {
          const data = snapshot.val();
          if (data && Object.keys(data).length > 0) {
            users = (Array.isArray(data) ? data : Object.values(data))
              .filter((user) => user && user.username)
              .map(normalizeAccountRecord);
            localStorage.setItem("karaoke_users", JSON.stringify(users));
            usersRef
              .set(users)
              .catch((error) =>
                console.warn(
                  "Could not remove old account fields:",
                  error.message,
                ),
              );
            displayUsers();
            updateStats();
            updateAdminActivity();
            return;
          }

          if (users.length > 0) {
            usersRef
              .transaction((currentUsers) =>
                currentUsers === null ? users : undefined,
              )
              .then((result) => {
                const currentData = result.snapshot.val();
                if (currentData) {
                  users = (
                    Array.isArray(currentData)
                      ? currentData
                      : Object.values(currentData)
                  ).map(normalizeAccountRecord);
                  localStorage.setItem("karaoke_users", JSON.stringify(users));
                  displayUsers();
                  updateStats();
                  updateAdminActivity();
                }
              })
              .catch((error) =>
                console.warn("Initial user sync failed:", error.message),
              );
          }
        })
        .catch((error) => {
          console.warn(
            "Firebase user load failed; keeping local cache:",
            error.message,
          );
        });
    } catch (error) {
      console.warn(
        "Firebase not configured, using localStorage:",
        error.message,
      );
    }
  } else {
    console.log("ℹ️ Firebase not available, using localStorage only");
  }

  // Keep the local cache aligned with Firebase updates from other clients.
  setTimeout(() => {
    if (typeof firebase !== "undefined" && firebase.database) {
      try {
        const usersRef = firebase.database().ref("users");
        usersRef.on("value", (snapshot) => {
          const data = snapshot.val();
          const firebaseUsers = (
            Array.isArray(data) ? data : Object.values(data || {})
          )
            .filter((user) => user && user.username)
            .map(normalizeAccountRecord);

          users = firebaseUsers;
          localStorage.setItem("karaoke_users", JSON.stringify(users));
          displayUsers();
          updateStats();
        });
      } catch (error) {
        console.warn(
          "Firebase real-time listener setup failed:",
          error.message,
        );
      }
    }
  }, 1000); // Increased delay to ensure new user is fully saved
}
function loadFromLocalStorage() {
  const stored = localStorage.getItem("karaoke_users");
  console.log("📂 Loading from localStorage. Data exists:", !!stored);

  if (stored && stored.length > 0) {
    try {
      let parsedUsers = JSON.parse(stored);
      console.log(
        "✅ Parsed users from localStorage:",
        parsedUsers.length,
        "users",
      );

      if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
        // Validate and normalize each user
        users = parsedUsers.map(normalizeAccountRecord);
        localStorage.setItem("karaoke_users", JSON.stringify(users));
        console.log("✅ Users loaded from localStorage - Total:", users.length);
        return; // Successfully loaded
      }
    } catch (error) {
      console.error("❌ Error parsing localStorage data:", error.message);
      console.log(
        "📝 Raw localStorage content:",
        stored.substring(0, 100) + "...",
      );
    }
  }

  console.log("ℹ️ No cached accounts found; waiting for Firebase data.");
  users = [];
}

// Save users to Firebase/localStorage
function saveUsers() {
  users = users.map(normalizeAccountRecord);
  // CRITICAL: Always save to localStorage first (this is the reliable backup)
  try {
    const usersJson = JSON.stringify(users);
    localStorage.setItem("karaoke_users", usersJson);
    console.log("✅ Users SAVED to localStorage:", users.length, "users");
    console.log("📦 localStorage data:", usersJson.substring(0, 100) + "...");
  } catch (error) {
    console.error(
      "❌ CRITICAL: Failed to save to localStorage:",
      error.message,
    );
    showNotification(
      "⚠️ Warning: Could not save to browser storage",
      "warning",
    );
    return; // Don't proceed if localStorage fails
  }

  // Then WAIT for Firebase save to complete (critical for persistence)
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      const usersRef = firebase.database().ref("users");
      // Save as array directly to Firebase
      usersRef
        .set(users)
        .then(() => {
          console.log("✅ CONFIRMED: Users synced to Firebase successfully");
          console.log("📊 Firebase now has", users.length, "users");

          // Verify write was successful by reading back immediately
          usersRef
            .once("value", (snapshot) => {
              const fbData = snapshot.val();
              const fbUsers = Array.isArray(fbData)
                ? fbData
                : Object.values(fbData || {});
              console.log(
                "✅ Firebase verification: Read back",
                fbUsers.length,
                "users",
              );
              if (fbUsers.length !== users.length) {
                console.warn(
                  "⚠️ Verification warning: Count mismatch - local:",
                  users.length,
                  "Firebase:",
                  fbUsers.length,
                );
                // If count mismatch, try to sync again after a short delay
                if (fbUsers.length > users.length) {
                  console.warn(
                    "⚠️ Firebase has stale data! Re-syncing to correct it...",
                  );
                  setTimeout(() => {
                    usersRef
                      .set(users)
                      .then(() => console.log("✅ Firebase re-sync completed"))
                      .catch((err) =>
                        console.error("Firebase re-sync failed:", err.message),
                      );
                  }, 500);
                }
              }
            })
            .catch((err) => {
              console.warn("Verification read error:", err.message);
            });

          // Broadcast change to all tabs/windows
          broadcastUserUpdate();
        })
        .catch((error) => {
          console.error("❌ Firebase save FAILED:", error.message);
          console.error("Error code:", error.code);
          showNotification(
            "⚠️ Firebase sync failed (data saved locally)",
            "warning",
          );
          // Retry Firebase save after a delay
          console.warn("🔄 Retrying Firebase sync in 1 second...");
          setTimeout(() => {
            usersRef
              .set(users)
              .then(() => console.log("✅ Firebase sync retry successful"))
              .catch((retryErr) =>
                console.error("Firebase sync retry failed:", retryErr.message),
              );
          }, 1000);
          // Still broadcast even if Firebase fails
          broadcastUserUpdate();
        });
    } catch (error) {
      console.error("❌ Firebase exception:", error.message);
      console.warn("⚠️ Firebase not available, using localStorage only");
      broadcastUserUpdate();
    }
  } else {
    console.log("ℹ️ Firebase not available, using localStorage only");
    broadcastUserUpdate();
  }
}

// Broadcast user update to all tabs/windows and pages
function broadcastUserUpdate() {
  // Dispatch custom event to notify other pages of user database changes
  window.dispatchEvent(
    new CustomEvent("karaoke-users-updated", {
      detail: { users, timestamp: new Date().getTime() },
    }),
  );

  console.log("📊 User database updated and broadcasted");
}

// Sync users to Firebase - keeps data fresh and prevents stale data errors
function syncUsersToFirebase() {
  if (!users || users.length === 0) {
    console.log("⏭️ No users to sync");
    return;
  }

  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      const usersRef = firebase.database().ref("users");

      // Ensure all users have proper format before syncing
      const sanitizedUsers = users.map(normalizeAccountRecord);

      usersRef
        .set(sanitizedUsers)
        .then(() => {
          console.log(
            "✅ Users synced to Firebase (" + sanitizedUsers.length + " users)",
          );

          // Verify write was successful by reading back
          usersRef.once("value", (snapshot) => {
            const data = snapshot.val();
            if (data) {
              const writtenUsers = Array.isArray(data)
                ? data
                : Object.values(data);
              if (writtenUsers.length === sanitizedUsers.length) {
                console.log(
                  "✅ Firebase write verification passed - " +
                    writtenUsers.length +
                    " users confirmed",
                );
              } else {
                console.warn(
                  "⚠️ Write verification failed - user count mismatch. Local: " +
                    sanitizedUsers.length +
                    ", Firebase: " +
                    writtenUsers.length,
                );
                // Force re-sync if mismatch detected
                setTimeout(() => {
                  usersRef
                    .set(sanitizedUsers)
                    .catch((err) =>
                      console.warn("Firebase re-sync failed:", err.message),
                    );
                }, 2000);
              }
            }
          });
        })
        .catch((error) => {
          console.warn("⚠️ Firebase sync error:", error.message);
          // Retry once on error
          setTimeout(() => {
            usersRef
              .set(sanitizedUsers)
              .catch((err) =>
                console.warn("Firebase sync retry failed:", err.message),
              );
          }, 1000);
        });
    } catch (error) {
      console.warn("⚠️ Firebase sync exception:", error.message);
    }
  } else {
    console.log("⏭️ Firebase not available for sync");
  }
}

// Full Firebase sync - reads from Firebase and ensures data consistency
function fullFirebaseSync() {
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      const usersRef = firebase.database().ref("users");
      usersRef
        .once("value", (snapshot) => {
          const data = snapshot.val();
          let firebaseUsers = [];

          if (data) {
            firebaseUsers = Array.isArray(data) ? data : Object.values(data);
            firebaseUsers = firebaseUsers.filter((u) => u && u.username);
            firebaseUsers = firebaseUsers.map(normalizeAccountRecord);
          }

          // Check if data differs from local state
          if (JSON.stringify(firebaseUsers) !== JSON.stringify(users)) {
            console.log(
              "🔄 Data mismatch detected - syncing from Firebase:",
              firebaseUsers.length,
              "users",
            );
            users = firebaseUsers;
            displayUsers();
            updateStats();
          } else {
            console.log("✅ Firebase data is in sync");
          }

          // Always write back to ensure Firebase is updated
          if (users.length > 0) {
            usersRef
              .set(users)
              .catch((err) =>
                console.warn("Firebase write failed:", err.message),
              );
          }
        })
        .catch((err) => console.warn("Full sync read error:", err.message));
    } catch (error) {
      console.warn("Full sync exception:", error.message);
    }
  }
}

// Verify and sync all user data to ensure consistency
function verifyAndSyncAllUsers() {
  console.log("🔍 Starting complete user data verification...");

  if (!users || users.length === 0) {
    console.warn("⚠️ No users to verify");
    return Promise.reject("No users to verify");
  }

  return new Promise((resolve, reject) => {
    if (typeof firebase !== "undefined" && firebase.database) {
      try {
        const usersRef = firebase.database().ref("users");

        // Step 1: Verify local data integrity
        const localValidUsers = users
          .filter((u) => u && u.username && u.username.trim().length > 0)
          .map(normalizeAccountRecord);
        console.log(
          "✅ Local verification: " +
            localValidUsers.length +
            "/" +
            users.length +
            " valid users",
        );

        if (localValidUsers.length !== users.length) {
          console.warn(
            "⚠️ Removing " +
              (users.length - localValidUsers.length) +
              " invalid users from local data",
          );
          users = localValidUsers;
          localStorage.setItem("karaoke_users", JSON.stringify(users));
        }

        // Step 2: Sync to Firebase
        const sanitizedUsers = localValidUsers.map((user) =>
          normalizeAccountRecord({
            ...user,
            username: user.username.trim(),
          }),
        );

        usersRef
          .set(sanitizedUsers)
          .then(() => {
            console.log(
              "✅ Step 1: Synced " +
                sanitizedUsers.length +
                " users to Firebase",
            );

            // Step 3: Verify Firebase data
            setTimeout(() => {
              usersRef
                .once("value", (snapshot) => {
                  const fbData = snapshot.val();
                  const fbUsers = Array.isArray(fbData)
                    ? fbData
                    : Object.values(fbData || {});

                  console.log(
                    "✅ Step 2: Firebase verification - " +
                      fbUsers.length +
                      " users",
                  );

                  if (fbUsers.length === sanitizedUsers.length) {
                    console.log(
                      "✅ ✅ DATA SYNC COMPLETE AND VERIFIED - All " +
                        fbUsers.length +
                        " users synced successfully!",
                    );
                    displayUsers();
                    updateStats();
                    showNotification(
                      "✅ All users synced to Firebase successfully!",
                      "success",
                    );
                    resolve({ success: true, userCount: fbUsers.length });
                  } else {
                    console.warn(
                      "⚠️ Count mismatch - expected " +
                        sanitizedUsers.length +
                        ", got " +
                        fbUsers.length,
                    );
                    reject("Data mismatch after sync");
                  }
                })
                .catch((err) => {
                  console.error("❌ Verification read error:", err.message);
                  reject(err);
                });
            }, 500);
          })
          .catch((err) => {
            console.error("❌ Firebase sync failed:", err.message);
            reject(err);
          });
      } catch (error) {
        console.error("❌ Exception during verification:", error.message);
        reject(error);
      }
    } else {
      console.warn("⚠️ Firebase not available");
      reject("Firebase not available");
    }
  });
}

// Force sync users from localStorage to Firebase (admin command)
function forceSyncAllUsersToFirebase() {
  console.log("🔄 FORCE SYNCING all users to Firebase...");
  showNotification("🔄 Syncing all users to Firebase...", "info");

  verifyAndSyncAllUsers()
    .then((result) => {
      console.log("✅ SYNC SUCCESSFUL:", result);
      showNotification(
        "✅ Successfully synced " + result.userCount + " users to Firebase!",
        "success",
      );
    })
    .catch((error) => {
      console.error("❌ SYNC FAILED:", error);
      showNotification("❌ Sync failed: " + error, "danger");
    });
}

// Reload users from Firebase to ensure we have latest data
function reloadUsersFromFirebase(callback) {
  if (typeof firebase !== "undefined" && firebase.database) {
    try {
      const usersRef = firebase.database().ref("users");
      usersRef
        .once("value", (snapshot) => {
          const data = snapshot.val();
          if (data) {
            users = (Array.isArray(data) ? data : Object.values(data)).map(
              normalizeAccountRecord,
            );
            console.log(
              "✅ Users reloaded from Firebase before operation:",
              users,
            );
          } else {
            loadFromLocalStorage();
          }
          if (callback) callback();
        })
        .catch((error) => {
          console.warn("Firebase error, using localStorage:", error.message);
          loadFromLocalStorage();
          if (callback) callback();
        });
    } catch (error) {
      console.warn("Firebase error:", error.message);
      loadFromLocalStorage();
      if (callback) callback();
    }
  } else {
    loadFromLocalStorage();
    if (callback) callback();
  }
}

// Continue with adding user after reloading from Firebase
function continueAddUser(username, password, role) {
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    showNotification(passwordValidation.message, "warning");
    return;
  }

  // Check if user already exists
  if (users.some((u) => u.username === username)) {
    showNotification(
      "❌ Username already exists! Use a different name.",
      "danger",
    );
    return;
  }

  // Create new user
  const newUser = {
    id: Math.max(...users.map((u) => u.id || 0), 0) + 1,
    username,
    password,
    role,
    joined: new Date().toISOString().split("T")[0],
    lastActivity: 0, // User starts as Offline until they log in
    disabled: false, // New users are enabled by default
  };

  console.log("➕ Adding new user:", newUser);
  users.push(newUser);
  console.log("📋 Total users after add:", users.length);

  // CRITICAL: Save immediately
  saveUsers();

  // VERIFY: Check if data was saved to localStorage
  const verification = localStorage.getItem("karaoke_users");
  if (verification) {
    const verifyData = JSON.parse(verification);
    console.log(
      "✅ Verification: localStorage now has",
      verifyData.length,
      "users",
    );
    const userExists = verifyData.some((u) => u.username === username);
    if (!userExists) {
      console.error(
        "❌ VERIFICATION FAILED: New user not found in localStorage!",
      );
    } else {
      console.log("✅ New user successfully verified in localStorage");
    }
  } else {
    console.error("❌ CRITICAL: localStorage is empty after save!");
  }

  // Reset form
  document.getElementById("addUserForm").reset();

  // Close modal
  setAdminView("users");

  showNotification(`✅ User "${username}" added successfully!`, "success");
  displayUsers();
  updateStats();
}

// Validate password strength
function validatePassword(password) {
  if (password.length < 6) {
    return { valid: false, message: "Password must be at least 6 characters" };
  }
  return { valid: true, message: "Password is strong" };
}

// Handle add user form submission
async function handleAddUser(e) {
  e.preventDefault();

  if (loggedInUser?.role !== "admin") {
    showNotification("Only administrators can create accounts.", "danger");
    return;
  }

  const username = document.getElementById("userName").value.trim();
  const password = document.getElementById("userPassword").value.trim();
  const role = document.getElementById("userRole").value;

  if (!username || !password || !role) {
    showNotification("Please fill in all fields", "warning");
    return;
  }

  if (
    users.some(
      (user) => user.username.trim().toLowerCase() === username.toLowerCase(),
    )
  ) {
    showNotification("Username already exists", "danger");
    return;
  }

  if (role === "admin" && loggedInUser?.role !== "admin") {
    showNotification(
      "Only administrators can create admin accounts.",
      "danger",
    );
    return;
  }

  const submitButton = document.querySelector(
    '#addUserForm button[type="submit"]',
  );
  submitButton.disabled = true;
  try {
    continueAddUser(username, password, role);
  } catch (error) {
    console.error("Could not create account:", error.message);
    showNotification(
      "Could not create the account. Please try again.",
      "danger",
    );
  } finally {
    submitButton.disabled = false;
  }
}

// Display users in table
function displayUsers() {
  const tbody = document.getElementById("usersTableBody");
  const emptyMessage = document.getElementById("emptyMessage");
  const pagination = document.getElementById("accountPagination");
  const previousButton = document.getElementById("previousUsersPage");
  const nextButton = document.getElementById("nextUsersPage");
  const pageCountElement = document.getElementById("totalAccountPages");
  const currentPageElement = document.getElementById("currentAccountPage");

  // Filter users based on current filter and validity
  let filteredUsers = users.filter((u) => u && u.username); // Ensure valid users only
  const searchTerm = document
    .getElementById("userSearch")
    ?.value.trim()
    .toLowerCase();
  if (searchTerm) {
    filteredUsers = filteredUsers.filter((user) =>
      String(user.username).toLowerCase().includes(searchTerm),
    );
  }
  if (currentFilter === "online") {
    filteredUsers = filteredUsers.filter((u) => isUserOnline(u));
  } else if (currentFilter === "offline") {
    filteredUsers = filteredUsers.filter((u) => !isUserOnline(u));
  }

  if (filteredUsers.length === 0) {
    currentUserPage = 1;
    pagination.hidden = true;
    tbody.innerHTML = "";
    emptyMessage.style.display = "block";
    emptyMessage.innerHTML = `<p style="font-size: clamp(1rem, 2.5vw, 1.2rem); color: #999; opacity: 0.7;">No ${currentFilter === "online" ? "online" : currentFilter === "offline" ? "offline" : ""} performers found...</p>`;
    return;
  }

  emptyMessage.style.display = "none";
  const pageCount = Math.ceil(filteredUsers.length / USERS_PER_PAGE);
  currentUserPage = Math.min(Math.max(1, currentUserPage), pageCount);
  pagination.hidden = pageCount <= 1;
  previousButton.disabled = currentUserPage === 1;
  nextButton.disabled = currentUserPage === pageCount;
  currentPageElement.textContent = String(currentUserPage);
  pageCountElement.textContent = String(pageCount);
  const firstUserIndex = (currentUserPage - 1) * USERS_PER_PAGE;
  const visibleUsers = filteredUsers.slice(
    firstUserIndex,
    firstUserIndex + USERS_PER_PAGE,
  );

  let html = "";
  visibleUsers.forEach((user, index) => {
    const isOnline = isUserOnline(user);
    const statusLabel = isOnline ? "Online" : "Offline";
    // Handle both number and string formats for lastActivity
    const lastActivityNum =
      typeof user.lastActivity === "string"
        ? parseInt(user.lastActivity)
        : user.lastActivity;
    const lastActivityText =
      lastActivityNum && lastActivityNum > 0
        ? new Date(lastActivityNum).toLocaleTimeString()
        : "Never";
    const isDisabled = user.disabled || false;
    const disabledBadge = isDisabled
      ? '<span class="account-state account-state-disabled">Disabled</span>'
      : "";
    const roleBadge =
      user.role === "admin"
        ? '<span class="role-badge role-badge-admin">Admin</span>'
        : '<span class="role-badge role-badge-user">User</span>';
    const safeUsername = escapeHtml(user.username);

    html += `
        <tr class="${isDisabled ? "account-disabled" : ""}">
          <td>${firstUserIndex + index + 1}</td>
          <td>
            <strong>${safeUsername}</strong>
                    ${disabledBadge}
                </td>
          <td>${roleBadge}</td>
          <td><span class="account-state ${isOnline ? "account-state-online" : "account-state-offline"}">${statusLabel}</span>${disabledBadge}</td>
          <td>${lastActivityText}</td>
          <td>${escapeHtml(user.joined || "-")}</td>
          <td class="account-actions">
                    <button class="table-action" type="button" data-account-action="edit" data-user-id="${escapeHtml(user.id)}" aria-label="Edit ${safeUsername}" title="Edit account"><i class="bi bi-pencil-square"></i></button>
                    <button class="table-action" type="button" data-account-action="password" data-user-id="${escapeHtml(user.id)}" aria-label="Change password for ${safeUsername}" title="Change password"><i class="bi bi-key"></i></button>
                    <button class="table-action" type="button" data-account-action="toggle" data-user-id="${escapeHtml(user.id)}" aria-label="${isDisabled ? "Enable" : "Disable"} ${safeUsername}" title="${isDisabled ? "Enable" : "Disable"} account"><i class="bi ${isDisabled ? "bi-unlock" : "bi-lock"}"></i></button>
                    <button class="table-action" type="button" data-account-action="logout" data-user-id="${escapeHtml(user.id)}" aria-label="Log out ${safeUsername}" title="Log out account" ${loggedInUser?.username === user.username ? "disabled" : ""}><i class="bi bi-box-arrow-right"></i></button>
                    <button class="table-action table-action-danger" type="button" data-account-action="delete" data-user-id="${escapeHtml(user.id)}" aria-label="Delete ${safeUsername}" title="Delete account"><i class="bi bi-trash3"></i></button>
                </td>
            </tr>
        `;
  });

  tbody.innerHTML = html;
  tbody.querySelectorAll("[data-account-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = users.find(
        (account) => String(account.id) === button.dataset.userId,
      );
      if (!user) return;
      switch (button.dataset.accountAction) {
        case "edit":
          openEditModal(user.id);
          break;
        case "password":
          openChangePasswordModal(user.id, user.username);
          break;
        case "toggle":
          toggleUserDisabled(user.id);
          break;
        case "logout":
          logoutUser(user.id);
          break;
        case "delete":
          deleteUser(user.id);
          break;
      }
    });
  });
}

// Update statistics
function updateStats() {
  document.getElementById("totalUsers").textContent = users.length;
  const onlineCount = users.filter((u) => isUserOnline(u)).length;
  document.getElementById("totalRegularUsers").textContent = onlineCount;
  const offlineCount = users.filter((u) => !isUserOnline(u)).length;
  document.getElementById("totalAdmins").textContent = offlineCount;
  renderDashboard();
}

function renderDashboard() {
  const totalUsers = document.getElementById("dashboardTotalUsers");
  if (!totalUsers) return;

  const onlineUsers = users.filter((user) => isUserOnline(user)).length;
  const activeRooms = karaokeRooms.filter(
    (room) => (roomDeviceCounts.get(room.id) || 0) > 0,
  ).length;
  const availableRooms = karaokeRooms.filter(
    (room) =>
      (roomDeviceCounts.get(room.id) || 0) < KaraokeSessions.MAX_DEVICES,
  ).length;
  totalUsers.textContent = String(users.length);
  document.getElementById("dashboardOnlineUsers").textContent =
    String(onlineUsers);
  document.getElementById("dashboardActiveRooms").textContent =
    String(activeRooms);
  document.getElementById("dashboardAvailableRooms").textContent =
    String(availableRooms);

  const roomList = document.getElementById("dashboardRoomStatus");
  roomList.replaceChildren();
  karaokeRooms.slice(0, 5).forEach((room) => {
    const item = document.createElement("li");
    const count = roomDeviceCounts.get(room.id) || 0;
    const status =
      count >= KaraokeSessions.MAX_DEVICES
        ? "Full"
        : count > 0
          ? "Occupied"
          : "Available";
    item.innerHTML = `<span class="room-dot ${count ? "room-dot-active" : "room-dot-idle"}"></span><span class="dashboard-room-name">${escapeHtml(room.name)}</span><span class="dashboard-room-meta">${status}</span><span class="dashboard-room-count">${count}/${KaraokeSessions.MAX_DEVICES}</span>`;
    roomList.appendChild(item);
  });
  if (!karaokeRooms.length) {
    roomList.innerHTML =
      '<li class="dashboard-empty">Room data is loading.</li>';
  }

  const activityList = document.getElementById("dashboardRecentActivity");
  const recentUsers = [...users]
    .filter((user) => user && user.username && Number(user.lastActivity) > 0)
    .sort(
      (first, second) =>
        Number(second.lastActivity) - Number(first.lastActivity),
    )
    .slice(0, 5);
  activityList.replaceChildren();
  recentUsers.forEach((user) => {
    const item = document.createElement("li");
    item.innerHTML = `<span class="activity-mark"><i class="bi bi-person-check"></i></span><span class="activity-copy"><strong>${escapeHtml(user.username)} active</strong><small>${new Date(Number(user.lastActivity)).toLocaleString()}</small></span>`;
    activityList.appendChild(item);
  });
  if (!recentUsers.length) {
    activityList.innerHTML =
      '<li class="dashboard-empty">No recent activity recorded.</li>';
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function initializePresenceListener() {
  if (typeof firebase === "undefined" || !firebase.database) return;

  firebase
    .database()
    .ref("activeLogin")
    .on(
      "value",
      (snapshot) => {
        activeLoginSessions = snapshot.val() || {};
        firebasePresenceLoaded = true;
        displayUsers();
        updateStats();
      },
      (error) => {
        console.warn("Firebase presence listener failed:", error.message);
        firebasePresenceLoaded = false;
        displayUsers();
        updateStats();
      },
    );
}

// Check Firebase session heartbeat first, then fall back to last activity.
function isUserOnline(user) {
  if (firebasePresenceLoaded) {
    const session = activeLoginSessions[user.username];
    const timestamp = Number(session?.timestamp);
    const sessionAge = Date.now() - timestamp;
    return Boolean(
      session?.sessionId &&
      Number.isFinite(timestamp) &&
      timestamp > 0 &&
      sessionAge <= ACTIVE_SESSION_TIMEOUT &&
      sessionAge >= -60000,
    );
  }

  // User is offline if they have no lastActivity or it's 0
  if (
    !user.lastActivity ||
    user.lastActivity === 0 ||
    user.lastActivity === "0"
  ) {
    return false;
  }

  // Handle both number and string formats
  const lastActivityNum =
    typeof user.lastActivity === "string"
      ? parseInt(user.lastActivity)
      : user.lastActivity;

  // If lastActivity is invalid or zero, they're offline
  if (!lastActivityNum || lastActivityNum <= 0) {
    return false;
  }

  // User is online if their lastActivity is within the last 5 minutes
  const fiveMinutesAgo = new Date().getTime() - 5 * 60 * 1000;
  const isOnline = lastActivityNum > fiveMinutesAgo;

  // Debug logging for tracking online status changes
  if (lastActivityNum > 0) {
    const minutesAgo = Math.round((Date.now() - lastActivityNum) / 60000);
    if (isOnline) {
      // Only log for users who ARE online (to see who's active)
      // Uncomment for debugging: console.log('🟢', user.username, 'is online -', minutesAgo, 'minutes ago');
    }
  }

  return isOnline;
}

// Filter singers by status
function filterPerformers(filter) {
  currentFilter = filter;
  currentUserPage = 1;
  document.getElementById("singerListContainer").hidden = false;
  console.log("🔍 Filtering performers by:", filter);
  updateFilterButtons();
  displayUsers();
}

// Update filter button styles
function updateFilterButtons() {
  const filterTotal = document.getElementById("filterTotal");
  const filterOnline = document.getElementById("filterOnline");
  const filterOffline = document.getElementById("filterOffline");
  filterTotal.setAttribute("aria-pressed", String(currentFilter === "total"));
  filterOnline.setAttribute("aria-pressed", String(currentFilter === "online"));
  filterOffline.setAttribute(
    "aria-pressed",
    String(currentFilter === "offline"),
  );
}

// Update user activity when they interact with performer portal
function updateUserActivity() {
  const singerName = localStorage.getItem("karaoke_user_name");
  if (singerName) {
    const user = users.find((u) => u.username === singerName);
    if (user) {
      user.lastActivity = new Date().getTime();
      saveUsers();
      displayUsers();
      updateStats();
    }
  }
}

// Open edit modal
function openEditModal(userId) {
  const user = users.find((u) => u.id === userId);
  if (!user) return;

  currentEditingUserId = userId;
  document.getElementById("editUserName").value = user.username;
  document.getElementById("editUserPassword").value = "";
  document.getElementById("editUserPassword").disabled = false;
  document.getElementById("editUserRole").value = user.role;

  const modal = new bootstrap.Modal(document.getElementById("editUserModal"));
  modal.show();
}

// Save user changes
async function saveUserChanges() {
  const user = users.find((u) => u.id === currentEditingUserId);
  if (!user) return;

  const newUsername = document.getElementById("editUserName").value.trim();
  const newPassword = document.getElementById("editUserPassword").value.trim();
  const newRole = document.getElementById("editUserRole").value;

  if (!newUsername || !newRole) {
    showNotification("Please fill in all required fields", "warning");
    return;
  }

  // If password is provided, validate it
  if (newPassword) {
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      showNotification(passwordValidation.message, "warning");
      return;
    }
  }

  // Check if username already exists (excluding current user)
  if (
    users.some(
      (u) => u.username === newUsername && u.id !== currentEditingUserId,
    )
  ) {
    showNotification("Username already exists", "danger");
    return;
  }

  user.username = newUsername;
  if (newPassword) user.password = newPassword;
  user.role = newRole;

  saveUsers();
  displayUsers();
  updateStats();

  const modal = bootstrap.Modal.getInstance(
    document.getElementById("editUserModal"),
  );
  modal.hide();

  showNotification("User updated successfully!", "success");
}

// Delete user
function deleteUser(userId) {
  const user = users.find((u) => u.id === userId);
  if (!user) return;

  if (confirm(`Are you sure you want to delete "${user.username}"?`)) {
    users = users.filter((u) => u.id !== userId);
    saveUsers();
    displayUsers();
    updateStats();
    showNotification(`User "${user.username}" deleted!`, "info");
  }
}

// Toggle user disabled status (disable/enable user)
function toggleUserDisabled(userId) {
  const user = users.find((u) => u.id === userId);
  if (!user) return;

  const currentStatus = user.disabled || false;
  const newStatus = !currentStatus;
  const action = newStatus ? "disable" : "enable";

  if (confirm(`Are you sure you want to ${action} "${user.username}"?`)) {
    user.disabled = newStatus;
    saveUsers();
    displayUsers();
    updateStats();

    if (newStatus) {
      showNotification(`User "${user.username}" has been disabled!`, "warning");
      console.log(`🔒 User ${user.username} disabled`);
    } else {
      showNotification(`User "${user.username}" has been enabled!`, "success");
      console.log(`🔓 User ${user.username} enabled`);
    }
  }
}

// Log out a specific user session
function logoutUser(userId) {
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  if (loggedInUser?.username === user.username) {
    showNotification("You cannot logout yourself from this panel.", "warning");
    return;
  }

  if (!confirm(`Are you sure you want to logout "${user.username}"?`)) {
    return;
  }

  try {
    const userUpdateChannel = new BroadcastChannel("karaoke_user_updates");
    userUpdateChannel.postMessage({
      type: "user_logout",
      username: user.username,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.warn("BroadcastChannel not supported:", error.message);
  }

  if (typeof firebase !== "undefined" && firebase.database) {
    firebase
      .database()
      .ref("activeLogin/" + user.username)
      .remove()
      .catch((error) =>
        console.warn(`Could not logout "${user.username}":`, error.message),
      );
  }

  if (user.lastActivity) {
    user.lastActivity = 0;
    saveUsers();
  }

  displayUsers();
  updateStats();
  showNotification(`User "${user.username}" has been logged out.`, "info");
}

// Open change password modal for a specific user
function openChangePasswordModal(userId, username) {
  currentEditingUserId = userId;
  const user = users.find((account) => account.id === userId);
  document.getElementById("editUserPasswordUsername").textContent = username;
  document.getElementById("editUserPasswordInput").value = "";
  document.getElementById("editUserPasswordConfirm").value = "";
  const submitButton = document.getElementById(
    "changeUserPasswordSubmitButton",
  );
  submitButton.textContent = "Change Password";
  submitButton.disabled = false;

  const modal = new bootstrap.Modal(
    document.getElementById("changeUserPasswordModal"),
  );
  modal.show();
}

// Change password for a specific user
function handleChangeUserPassword() {
  if (!currentEditingUserId) return;

  const user = users.find((account) => account.id === currentEditingUserId);
  if (!user) return;
  const newPassword = document.getElementById("editUserPasswordInput").value;
  const confirmPassword = document.getElementById(
    "editUserPasswordConfirm",
  ).value;

  // Validate password
  if (!newPassword || newPassword.length < 6) {
    alert("❌ Password must be at least 6 characters long!");
    return;
  }

  if (newPassword !== confirmPassword) {
    alert("❌ Passwords do not match!");
    return;
  }

  // Find and update user
  user.password = newPassword;
  saveUsers();

  // Close modal and clear form
  const modal = bootstrap.Modal.getInstance(
    document.getElementById("changeUserPasswordModal"),
  );
  if (modal) {
    modal.hide();
  }

  showNotification(`✅ Password changed for "${user.username}"!`, "success");
  console.log("🔐 Password changed for user:", user.username);
}

// Show notification
function showNotification(message, type = "info") {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} position-fixed`;
  alert.style.cssText =
    "top: 20px; right: 20px; z-index: 9999; min-width: 300px; animation: slideUp 0.5s ease;";
  alert.innerHTML = message;
  document.body.appendChild(alert);

  setTimeout(() => {
    alert.style.opacity = "0";
    alert.style.transition = "opacity 0.3s ease";
    setTimeout(() => alert.remove(), 300);
  }, 3000);
}
// ===== KARAOKE DISPLAY CONTROL FUNCTIONS =====

const KARAOKE_DISPLAY_ANNOUNCEMENT_TEMPLATES = {
  maintenance:
    "The karaoke system is under maintenance. Please check back soon.",
  systemUpdate:
    "We are updating the karaoke system. Singing will be available again shortly.",
  temporarilyUnavailable:
    "The karaoke display is temporarily unavailable. Please try again later.",
  privateEvent: "The karaoke display is reserved for a private event.",
};

function getKaraokeDisplayAnnouncementFromControls() {
  const selectedTemplate = document.getElementById(
    "displayAnnouncementTemplate",
  ).value;
  if (selectedTemplate === "custom") {
    return (
      document.getElementById("displayAnnouncementCustom").value.trim() ||
      KARAOKE_DISPLAY_ANNOUNCEMENT_TEMPLATES.maintenance
    );
  }
  return (
    KARAOKE_DISPLAY_ANNOUNCEMENT_TEMPLATES[selectedTemplate] ||
    KARAOKE_DISPLAY_ANNOUNCEMENT_TEMPLATES.maintenance
  );
}

function updateKaraokeDisplayAnnouncementPreview() {
  const template = document.getElementById("displayAnnouncementTemplate");
  const customMessage = document.getElementById("displayAnnouncementCustom");
  customMessage.hidden = template.value !== "custom";
  document.getElementById("displayAnnouncementPreview").textContent =
    `Display message: ${getKaraokeDisplayAnnouncementFromControls()}`;
}

function initializeKaraokeDisplayAnnouncementControls() {
  const template = document.getElementById("displayAnnouncementTemplate");
  const customMessage = document.getElementById("displayAnnouncementCustom");
  template.addEventListener("change", () => {
    updateKaraokeDisplayAnnouncementPreview();
    if (template.value !== "custom") disableKaraokeDisplay();
  });
  customMessage.addEventListener(
    "input",
    updateKaraokeDisplayAnnouncementPreview,
  );
  customMessage.addEventListener("change", () => {
    updateKaraokeDisplayAnnouncementPreview();
    if (template.value === "custom" && customMessage.value.trim()) {
      disableKaraokeDisplay();
    }
  });
  updateKaraokeDisplayAnnouncementPreview();
}

function setKaraokeDisplayAnnouncementControls(announcement) {
  const matchingTemplate = Object.entries(
    KARAOKE_DISPLAY_ANNOUNCEMENT_TEMPLATES,
  ).find(([, message]) => message === announcement);
  const template = document.getElementById("displayAnnouncementTemplate");
  const customMessage = document.getElementById("displayAnnouncementCustom");
  if (announcement && !matchingTemplate) {
    template.value = "custom";
    customMessage.value = announcement;
  } else {
    template.value = matchingTemplate?.[0] || "";
    customMessage.value = "";
  }
  updateKaraokeDisplayAnnouncementPreview();
}

// Load karaoke display status from Firebase
function loadKaraokeDisplayStatus() {
  if (typeof firebase === "undefined" || !firebase.database) {
    console.warn("⚠️ Firebase not available");
    updateKaraokeDisplayStatusUI(true); // Default to enabled
    return;
  }

  try {
    firebase
      .database()
      .ref("tvControl")
      .on(
        "value",
        (snapshot) => {
          const settings = snapshot.val() || {};
          const isEnabled = settings.enabled !== false;
          console.log(
            "📺 Karaoke Display Status Loaded from Firebase:",
            isEnabled,
          );
          setKaraokeDisplayAnnouncementControls(settings.announcement || "");
          updateKaraokeDisplayStatusUI(isEnabled);
        },
        (err) => {
          console.error("❌ Firebase error loading TV status:", err.message);
        },
      );
  } catch (e) {
    console.error("Firebase exception:", e.message);
    updateKaraokeDisplayStatusUI(true);
  }
}

// Update UI to reflect TV status
function updateKaraokeDisplayStatusUI(isEnabled) {
  const statusElement = document.getElementById("displayStatus");
  const enableBtn = document.getElementById("enableDisplayBtn");
  const disableBtn = document.getElementById("disableDisplayBtn");

  if (statusElement) {
    if (isEnabled) {
      statusElement.textContent = "Karaoke Display Enabled";
      statusElement.className = "display-status display-status-enabled";
      if (enableBtn) enableBtn.disabled = true;
      if (disableBtn) disableBtn.disabled = false;
    } else {
      statusElement.textContent = "Karaoke Display Disabled";
      statusElement.className = "display-status display-status-disabled";
      if (enableBtn) enableBtn.disabled = false;
      if (disableBtn) disableBtn.disabled = true;
    }
  }
}

// Enable Karaoke Display
function enableKaraokeDisplay() {
  console.log("🟢 Enabling Karaoke Display...");

  if (typeof firebase === "undefined" || !firebase.database) {
    alert("❌ Firebase not available. Please check your connection.");
    console.error("Firebase not initialized");
    return;
  }

  try {
    firebase
      .database()
      .ref("tvControl")
      .update({ enabled: true, announcement: null })
      .then(() => {
        console.log("✅ Karaoke Display Enabled via Firebase");
        setKaraokeDisplayAnnouncementControls("");
        updateKaraokeDisplayStatusUI(true);
        showNotification("✅ Karaoke Display has been ENABLED", "success");
      })
      .catch((err) => {
        console.error("❌ Error enabling TV:", err.message);
        if (err.code === "PERMISSION_DENIED") {
          showNotification(
            "❌ Firebase Permission Denied - Check database rules",
            "danger",
          );
        } else {
          showNotification(
            "❌ Failed to enable Karaoke Display: " + err.message,
            "danger",
          );
        }
      });
  } catch (e) {
    console.error("Firebase exception:", e.message);
    showNotification("❌ Error: " + e.message, "danger");
  }
}

// Disable Karaoke Display
function disableKaraokeDisplay() {
  console.log("🔴 Disabling Karaoke Display...");

  if (typeof firebase === "undefined" || !firebase.database) {
    alert("❌ Firebase not available. Please check your connection.");
    console.error("Firebase not initialized");
    return;
  }

  try {
    const announcement = getKaraokeDisplayAnnouncementFromControls();
    firebase
      .database()
      .ref("tvControl")
      .update({ enabled: false, announcement })
      .then(() => {
        console.log("✅ Karaoke Display Disabled via Firebase");
        updateKaraokeDisplayStatusUI(false);
        showNotification("✅ Karaoke Display has been DISABLED", "warning");
      })
      .catch((err) => {
        console.error("❌ Error disabling TV:", err.message);
        if (err.code === "PERMISSION_DENIED") {
          showNotification(
            "❌ Firebase Permission Denied - Check database rules",
            "danger",
          );
        } else {
          showNotification(
            "❌ Failed to disable Karaoke Display: " + err.message,
            "danger",
          );
        }
      });
  } catch (e) {
    console.error("Firebase exception:", e.message);
    showNotification("❌ Error: " + e.message, "danger");
  }
}
