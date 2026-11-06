const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { test } = require("node:test");
const cleanupIdleRooms = require("./cleanup-idle-rooms");

const { isGitHubActionsAuthorized, updateIdleRoomSession } = cleanupIdleRooms;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function createToken(overrides = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "sd-karaoke-queue-cleanup",
      exp: now + 300,
      nbf: now - 1,
      iat: now,
      repository: "saurahanz-lgtm/karaoke",
      repository_owner: "saurahanz-lgtm",
      ref: "refs/heads/master",
      sub: "repo:saurahanz-lgtm/karaoke:ref:refs/heads/master",
      workflow_ref:
        "saurahanz-lgtm/karaoke/.github/workflows/cleanup-idle-rooms.yml@refs/heads/master",
      event_name: "schedule",
      ...overrides,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

test("GitHub Actions OIDC authorization is scoped to the cleanup workflow", async (t) => {
  const originalFetch = global.fetch;
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key" };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] }),
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const authorize = (token) =>
    isGitHubActionsAuthorized({
      headers: { authorization: `Bearer ${token}` },
    });

  assert.equal(await authorize(createToken()), true);
  assert.equal(
    await authorize(createToken({ workflow_ref: "another-workflow.yml" })),
    false,
  );
  assert.equal(await authorize(createToken({ exp: 1 })), false);
  const [header, claims, signature] = createToken().split(".");
  const invalidSignature =
    `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(
    await authorize(`${header}.${claims}.${invalidSignature}`),
    false,
  );
});

test("idle room cleanup respects activity and the configured delay", () => {
  const now = 1000000;
  const room = {
    queue: [{ videoId: "queued-song" }],
    currentSong: { videoId: "playing-song" },
    emptySince: now - 180000,
  };

  assert.deepEqual(updateIdleRoomSession(room, now, 180000), {
    ...room,
    queue: null,
    currentSong: null,
    emptySince: null,
  });
  assert.equal(
    updateIdleRoomSession(
      { ...room, members: { singer: { lastSeen: now } } },
      now,
      180000,
    ).emptySince,
    null,
  );
});
