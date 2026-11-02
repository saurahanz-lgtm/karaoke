const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const responseCache = new Map();
const videoValidationCache = new Map();
const requestBuckets = new Map();

function sendJson(response, statusCode, body) {
  return response.status(statusCode).json(body);
}

function getRequestQuery(request) {
  if (request.query) return request.query;
  return Object.fromEntries(
    new URL(request.url, "http://localhost").searchParams,
  );
}

function isRateLimited(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const clientIp = String(
    forwardedFor || request.socket?.remoteAddress || "unknown",
  )
    .split(",")[0]
    .trim();
  const now = Date.now();
  const bucket = requestBuckets.get(clientIp);
  if (!bucket || now >= bucket.resetAt) {
    requestBuckets.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) return true;
  bucket.count += 1;
  return false;
}

async function requestYouTube(endpoint, parameters, apiKey) {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  Object.entries({ ...parameters, key: apiKey }).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  });

  const response = await fetch(url);
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason;
    const error = new Error(
      payload?.error?.message || "YouTube request failed",
    );
    error.status = response.status;
    error.reason = reason;
    throw error;
  }
  return payload || {};
}

function toVerifiedSong(video) {
  if (
    !video?.id ||
    video.status?.privacyStatus === "private" ||
    video.status?.embeddable !== true
  ) {
    return null;
  }

  const title = video.snippet?.title || "Untitled video";
  const channelTitle = video.snippet?.channelTitle || "";
  const description = video.snippet?.description || "";
  const karaokeMarkers =
    /\bkaraoke\b|\binstrumental\b|\bsing[\s-]?along\b|\bbacking track\b|\bminus one\b|\bno vocals\b|\bwithout vocals\b|\bvocals? removed\b|\bplayback track\b/i;
  const descriptiveKaraokeMarkers =
    /\bkaraoke (?:version|track|instrumental)\b|\binstrumental (?:version|track|karaoke)\b|\bbacking track\b|\bsing[\s-]?along version\b/i;
  if (
    !karaokeMarkers.test(title) &&
    !karaokeMarkers.test(channelTitle) &&
    !descriptiveKaraokeMarkers.test(description)
  ) {
    return null;
  }

  return {
    videoId: video.id,
    title,
    artist: "",
    thumbnail:
      video.snippet?.thumbnails?.medium?.url ||
      video.snippet?.thumbnails?.default?.url ||
      "",
    publishedAt: video.snippet?.publishedAt || null,
  };
}

function mapYouTubeError(error) {
  if (error.reason === "quotaExceeded" || error.status === 403) {
    return {
      statusCode: 503,
      code: "YOUTUBE_QUOTA_EXCEEDED",
      message:
        "YouTube search is temporarily unavailable because its daily quota was reached.",
    };
  }
  if (error.status === 429) {
    return {
      statusCode: 503,
      code: "YOUTUBE_RATE_LIMIT",
      message:
        "YouTube is temporarily rate-limiting searches. Try again shortly.",
    };
  }
  if (error.status === 400) {
    return {
      statusCode: 400,
      code: "YOUTUBE_INVALID_QUERY",
      message: "That search could not be processed. Try a shorter query.",
    };
  }
  return {
    statusCode: 502,
    code: "YOUTUBE_TEMPORARY_ERROR",
    message:
      "YouTube could not be reached. Check your connection and try again.",
  };
}

async function searchVideos(query, pageToken, apiKey) {
  const search = await requestYouTube(
    "search",
    {
      part: "snippet",
      q: `${query} karaoke`,
      type: "video",
      maxResults: 50,
      safeSearch: "strict",
      relevanceLanguage: "en",
      pageToken,
    },
    apiKey,
  );
  const videoIds = (search.items || [])
    .map((item) => item.id?.videoId)
    .filter(Boolean);
  if (!videoIds.length) {
    return { results: [], nextPageToken: search.nextPageToken || null };
  }

  const details = await requestYouTube(
    "videos",
    {
      part: "snippet,status",
      id: videoIds.join(","),
      maxResults: videoIds.length,
    },
    apiKey,
  );
  const verifiedById = new Map(
    (details.items || []).map((item) => [item.id, toVerifiedSong(item)]),
  );
  const results = videoIds
    .map((videoId) => verifiedById.get(videoId))
    .filter(Boolean);
  return { results, nextPageToken: search.nextPageToken || null };
}

async function getVideo(videoId, apiKey) {
  const details = await requestYouTube(
    "videos",
    {
      part: "snippet,status,contentDetails,statistics",
      id: videoId,
      maxResults: 1,
    },
    apiKey,
  );
  const video = details.items?.[0];
  const verifiedSong = toVerifiedSong(video);
  if (!verifiedSong) return null;
  return {
    ...verifiedSong,
    description: video.snippet?.description || "",
    channel: video.snippet?.channelTitle || "",
    duration: video.contentDetails?.duration || "PT0S",
    views: Number(video.statistics?.viewCount || 0),
    likes: Number(video.statistics?.likeCount || 0),
  };
}

async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, {
      code: "METHOD_NOT_ALLOWED",
      error: "Method not allowed.",
    });
  }

  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      code: "YOUTUBE_NOT_CONFIGURED",
      error:
        "Song search is not enabled for this deployment. Configure the YOUTUBE_DATA_API_KEY environment variable in Vercel for Production, then redeploy.",
    });
  }

  if (isRateLimited(request)) {
    return sendJson(response, 429, {
      code: "SEARCH_RATE_LIMIT",
      error: "Too many searches. Wait a moment and try again.",
    });
  }

  const query = getRequestQuery(request);
  const videoId = String(query.videoId || "").trim();
  const searchQuery = String(query.q || "")
    .trim()
    .replace(/\s+/g, " ");
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    const cachedVideo = videoValidationCache.get(videoId);
    if (cachedVideo && cachedVideo.expiresAt > Date.now()) {
      return sendJson(response, cachedVideo.statusCode, cachedVideo.payload);
    }
    try {
      const video = await getVideo(videoId, apiKey);
      const statusCode = video ? 200 : 404;
      const payload = video
        ? { video }
        : {
            code: "VIDEO_UNAVAILABLE",
            error: "This video is unavailable or cannot be embedded.",
          };
      videoValidationCache.set(videoId, {
        expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
        statusCode,
        payload,
      });
      return sendJson(response, statusCode, payload);
    } catch (error) {
      const mapped = mapYouTubeError(error);
      return sendJson(response, mapped.statusCode, mapped);
    }
  }

  if (!searchQuery || searchQuery.length > 100) {
    return sendJson(response, 400, {
      code: "INVALID_QUERY",
      error: "Enter a search term of 1 to 100 characters.",
    });
  }

  const pageToken = String(query.pageToken || "");
  if (pageToken.length > 500) {
    return sendJson(response, 400, {
      code: "INVALID_PAGE_TOKEN",
      error: "That search page is no longer available. Search again.",
    });
  }

  const cacheKey = `${searchQuery.toLocaleLowerCase()}|${pageToken}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return sendJson(response, 200, cached.payload);
  }

  try {
    const payload = await searchVideos(searchQuery, pageToken, apiKey);
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
      payload,
    });
    return sendJson(response, 200, payload);
  } catch (error) {
    const mapped = mapYouTubeError(error);
    return sendJson(response, mapped.statusCode, mapped);
  }
}

module.exports = handler;
module.exports.searchVideos = searchVideos;
module.exports.toVerifiedSong = toVerifiedSong;
