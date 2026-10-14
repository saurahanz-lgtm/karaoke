(function (global) {
  const ACTIVE_SESSION_TIMEOUT_MS = 2 * 60 * 1000;

  async function hasActiveAdmin() {
    if (typeof firebase === "undefined" || !firebase.database) {
      throw new Error("ADMIN_PRESENCE_UNAVAILABLE");
    }

    const db = firebase.database();
    const [usersSnapshot, sessionsSnapshot] = await Promise.all([
      db.ref("users").once("value"),
      db.ref("activeLogin").once("value"),
    ]);
    const usersValue = usersSnapshot.val();
    const users = Array.isArray(usersValue)
      ? usersValue
      : Object.values(usersValue || {});
    const adminUsernames = new Set(
      users
        .filter(
          (user) =>
            user?.username && ["admin", "room_manager"].includes(user.role),
        )
        .map((user) => String(user.username).trim().toLowerCase()),
    );
    const sessions = sessionsSnapshot.val() || {};
    const now = Date.now();

    return Object.entries(sessions).some(([username, session]) => {
      const timestamp = Number(session?.timestamp);
      const age = now - timestamp;
      return (
        adminUsernames.has(username.trim().toLowerCase()) &&
        session?.sessionId &&
        Number.isFinite(timestamp) &&
        timestamp > 0 &&
        age <= ACTIVE_SESSION_TIMEOUT_MS &&
        age >= -60000
      );
    });
  }

  global.KaraokeAdminPresence = { hasActiveAdmin };
})(window);
