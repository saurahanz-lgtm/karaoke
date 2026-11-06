const assert = require("node:assert/strict");
const { test } = require("node:test");
const { matchesSongTitle, searchVideos } = require("./youtube-search");

test("song title matching excludes unrelated karaoke search results", () => {
  assert.equal(matchesSongTitle("Ako Ang Bagyo Karaoke", "ako ang bagyo"), true);
  assert.equal(
    matchesSongTitle("Ako Ang Bagyo (Official Karaoke Version)", "ako ang bagyo"),
    true,
  );
  assert.equal(
    matchesSongTitle("Bagyo Ako - Filipino Karaoke Medley", "ako ang bagyo"),
    false,
  );
  assert.equal(
    matchesSongTitle("Ang Bagyo - Ako'y Nalilito Karaoke", "ako ang bagyo"),
    false,
  );
});

test("YouTube search quotes the title and returns only exact title matches", async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    requests.push(requestUrl);
    if (requestUrl.pathname.endsWith("/search")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: { videoId: "exactmatch01" } },
            { id: { videoId: "wrongmatch1" } },
          ],
          nextPageToken: "next-page",
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        items: [
          {
            id: "exactmatch01",
            snippet: {
              title: "Ako Ang Bagyo Karaoke",
              channelTitle: "Karaoke Channel",
              thumbnails: {},
            },
            status: { embeddable: true },
          },
          {
            id: "wrongmatch1",
            snippet: {
              title: "Bagyo Ako - Filipino Karaoke Medley",
              channelTitle: "Karaoke Channel",
              thumbnails: {},
            },
            status: { embeddable: true },
          },
        ],
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const page = await searchVideos("Ako ang Bagyo", "", "test-api-key");

  assert.deepEqual(
    page.results.map((song) => song.videoId),
    ["exactmatch01"],
  );
  assert.equal(page.nextPageToken, "next-page");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("q"), '"Ako ang Bagyo" karaoke');
  assert.equal(requests[0].searchParams.get("maxResults"), "25");
  assert.equal(requests[0].searchParams.has("relevanceLanguage"), false);
});
