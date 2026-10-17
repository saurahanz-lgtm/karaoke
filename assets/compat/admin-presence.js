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
  const ACTIVE_SESSION_TIMEOUT_MS = 2 * 60 * 1e3;
  function hasActiveAdmin() {
    return __async(this, null, function* () {
      if (typeof firebase === "undefined" || !firebase.database) {
        throw new Error("ADMIN_PRESENCE_UNAVAILABLE");
      }
      const db = firebase.database();
      const [usersSnapshot, sessionsSnapshot] = yield Promise.all([
        db.ref("users").once("value"),
        db.ref("activeLogin").once("value")
      ]);
      const usersValue = usersSnapshot.val();
      const users = Array.isArray(usersValue) ? usersValue : Object.values(usersValue || {});
      const adminUsernames = new Set(
        users.filter(
          (user) => (user == null ? void 0 : user.username) && ["admin", "room_manager"].includes(user.role)
        ).map((user) => String(user.username).trim().toLowerCase())
      );
      const sessions = sessionsSnapshot.val() || {};
      const now = Date.now();
      return Object.entries(sessions).some(([username, session]) => {
        const timestamp = Number(session == null ? void 0 : session.timestamp);
        const age = now - timestamp;
        return adminUsernames.has(username.trim().toLowerCase()) && (session == null ? void 0 : session.sessionId) && Number.isFinite(timestamp) && timestamp > 0 && age <= ACTIVE_SESSION_TIMEOUT_MS && age >= -6e4;
      });
    });
  }
  global.KaraokeAdminPresence = { hasActiveAdmin };
})(window);
