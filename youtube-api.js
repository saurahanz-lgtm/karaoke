// YouTube API Configuration
// This file handles all YouTube API interactions for the karaoke app

const YOUTUBE_CONFIG = {
  SEARCH_ENDPOINT: "/api/youtube-search",
};

const YOUTUBE_RATE_LIMIT_COOLDOWN_MS = 60000;
const YOUTUBE_RATE_LIMIT_STORAGE_KEY = "youtubeSearchRateLimitUntil";
const YOUTUBE_SEARCH_CACHE_PREFIX = "youtubeSearchCache:";
const YOUTUBE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_SEARCH_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let youtubeRateLimitUntil = 0;

function readYouTubeStorage(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeYouTubeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Search still works when browser storage is unavailable.
  }
}

function getCachedYouTubeSearch(query, pageToken = "", allowExpired = false) {
  const cacheKey = `${YOUTUBE_SEARCH_CACHE_PREFIX}${encodeURIComponent(
    `${query.toLowerCase()}|${pageToken}`,
  )}`;
  try {
    const cached = JSON.parse(readYouTubeStorage(cacheKey) || "null");
    if (Array.isArray(cached?.results)) {
      const cachedAt =
        cached.cachedAt || cached.expiresAt - YOUTUBE_SEARCH_CACHE_TTL_MS;
      if (Date.now() - cachedAt > YOUTUBE_SEARCH_CACHE_MAX_AGE_MS) {
        globalThis.localStorage?.removeItem(cacheKey);
        return null;
      }
      if (
        cached.expiresAt > Date.now() ||
        allowExpired ||
        globalThis.navigator?.onLine === false
      ) {
        return {
          results: cached.results,
          nextPageToken: cached.nextPageToken || null,
        };
      }
      return null;
    }
    globalThis.localStorage?.removeItem(cacheKey);
  } catch {
    return null;
  }
  return null;
}

function cacheYouTubeSearch(query, pageToken, page) {
  const cacheKey = `${YOUTUBE_SEARCH_CACHE_PREFIX}${encodeURIComponent(
    `${query.toLowerCase()}|${pageToken}`,
  )}`;
  writeYouTubeStorage(
    cacheKey,
    JSON.stringify({
      cachedAt: Date.now(),
      expiresAt: Date.now() + YOUTUBE_SEARCH_CACHE_TTL_MS,
      results: page.results,
      nextPageToken: page.nextPageToken,
    }),
  );
}

function createYouTubeRateLimitError(
  retryAfterMs = YOUTUBE_RATE_LIMIT_COOLDOWN_MS,
) {
  const error = new Error("YouTube search is temporarily rate-limited");
  error.code = "YOUTUBE_RATE_LIMIT";
  error.retryAfterMs = retryAfterMs;
  return error;
}

/**
 * Search YouTube for karaoke videos
 * @param {string} query - Search query (song name, artist, etc.)
 * @returns {Promise<Array>} Array of video objects
 */
async function searchYouTubeKaraoke(query) {
  const page = await searchYouTubeKaraokePage(query);
  return page.results;
}

async function searchYouTubeKaraokePage(query, options = {}) {
  if (!query || query.trim().length === 0) {
    throw new Error("Search query cannot be empty");
  }

  const searchQuery = query.trim().replace(/\s+/g, " ");
  const pageToken = options.pageToken || "";
  const cachedPage = getCachedYouTubeSearch(searchQuery, pageToken);
  if (cachedPage) return cachedPage;

  youtubeRateLimitUntil = Math.max(
    youtubeRateLimitUntil,
    Number(readYouTubeStorage(YOUTUBE_RATE_LIMIT_STORAGE_KEY)) || 0,
  );
  if (Date.now() < youtubeRateLimitUntil) {
    throw createYouTubeRateLimitError(youtubeRateLimitUntil - Date.now());
  }

  try {
    const url = new URL(YOUTUBE_CONFIG.SEARCH_ENDPOINT, window.location.href);
    url.searchParams.set("q", searchQuery);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { signal: options.signal });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        data.error || "YouTube search could not be completed.",
      );
      error.code = data.code || "YOUTUBE_SEARCH_ERROR";
      error.status = response.status;
      if (
        response.status === 429 ||
        error.code === "YOUTUBE_RATE_LIMIT" ||
        error.code === "SEARCH_RATE_LIMIT"
      ) {
        const cooldownMs = Math.max(
          YOUTUBE_RATE_LIMIT_COOLDOWN_MS,
          Number(response.headers?.get("Retry-After")) * 1000 || 0,
        );
        youtubeRateLimitUntil = Date.now() + cooldownMs;
        writeYouTubeStorage(
          YOUTUBE_RATE_LIMIT_STORAGE_KEY,
          String(youtubeRateLimitUntil),
        );
        throw createYouTubeRateLimitError(cooldownMs);
      }
      throw error;
    }

    const page = {
      results: Array.isArray(data.results) ? data.results : [],
      nextPageToken: data.nextPageToken || null,
    };
    cacheYouTubeSearch(searchQuery, pageToken, page);
    return page;
  } catch (error) {
    if (error instanceof TypeError || globalThis.navigator?.onLine === false) {
      const stalePage = getCachedYouTubeSearch(searchQuery, pageToken, true);
      if (stalePage) return stalePage;
    }
    if (error.code === "YOUTUBE_RATE_LIMIT") {
      console.warn("YouTube Search Rate Limit:", error.message);
    } else {
      console.error("YouTube Search Error:", error);
    }
    throw error;
  }
}

/**
 * Get video details from YouTube
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<Object>} Video details object
 */
async function getVideoDetails(videoId) {
  try {
    const url = new URL(YOUTUBE_CONFIG.SEARCH_ENDPOINT, window.location.href);
    url.searchParams.set("videoId", videoId);
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.video) {
      const error = new Error(data.error || "Video could not be verified.");
      error.code = data.code || "VIDEO_UNAVAILABLE";
      error.status = response.status;
      throw error;
    }

    const video = data.video;

    return {
      videoId: video.videoId,
      title: video.title,
      description: video.description,
      channel: video.channel,
      thumbnail: video.thumbnail,
      duration: parseDuration(video.duration),
      views: video.views,
      likes: video.likes,
      publishedAt: video.publishedAt,
    };
  } catch (error) {
    console.error("Get Video Details Error:", error);
    throw error;
  }
}

/**
 * Parse ISO 8601 duration format to seconds
 * @param {string} duration - ISO 8601 duration (e.g., "PT5M30S")
 * @returns {number} Duration in seconds
 */
function parseDuration(duration) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;

  const hours = (parseInt(match[1]) || 0) * 3600;
  const minutes = (parseInt(match[2]) || 0) * 60;
  const seconds = parseInt(match[3]) || 0;

  return hours + minutes + seconds;
}

/**
 * Format duration in seconds to readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "5:30" or "1:05:30")
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/**
 * Validate if a YouTube URL is valid
 * @param {string} url - YouTube URL to validate
 * @returns {string|null} Video ID if valid, null otherwise
 */
function extractVideoId(url) {
  // Handle various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Build YouTube embed URL
 * @param {string} videoId - YouTube video ID
 * @param {Object} options - Embed options
 * @returns {string} YouTube embed URL
 */
function buildYouTubeEmbedUrl(videoId, options = {}) {
  const {
    autoplay = false,
    controls = true,
    modestBranding = true,
    rel = false,
    showInfo = false,
    ivLoadPolicy = 3, // Hide annotations
  } = options;

  const baseUrl = "https://www.youtube.com/embed/";
  const params = new URLSearchParams({
    autoplay: autoplay ? 1 : 0,
    controls: controls ? 1 : 0,
    modestbranding: modestBranding ? 1 : 0,
    rel: rel ? 1 : 0,
    showinfo: showInfo ? 1 : 0,
    iv_load_policy: ivLoadPolicy,
  });

  return `${baseUrl}${videoId}?${params.toString()}`;
}

/**
 * Get YouTube player embed code
 * @param {string} videoId - YouTube video ID
 * @param {Object} options - Player options
 * @returns {string} HTML embed code
 */
function getYouTubeEmbedCode(videoId, options = {}) {
  const { width = "100%", height = "100%", title = "YouTube Video" } = options;

  const embedUrl = buildYouTubeEmbedUrl(videoId, {
    autoplay: true,
    controls: true,
    modestBranding: true,
    rel: false,
  });

  return `<iframe width="${width}" height="${height}" src="${embedUrl}" 
            title="${title}" frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen></iframe>`;
}

/**
 * Initialize YouTube Player (for IFrame API)
 * Note: Requires YouTube IFrame API to be loaded in HTML
 */
let youtubePlayerInstance = null;

function initializeYouTubePlayer(containerId, videoId, options = {}) {
  if (typeof YT === "undefined") {
    console.error(
      'YouTube IFrame API not loaded. Make sure to include: <script src="https://www.youtube.com/iframe_api"></script>',
    );
    return null;
  }

  const {
    autoplay = true,
    controls = true,
    height = "100%",
    width = "100%",
  } = options;

  youtubePlayerInstance = new YT.Player(containerId, {
    height: height,
    width: width,
    videoId: videoId,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      controls: controls ? 1 : 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });

  return youtubePlayerInstance;
}

/**
 * YouTube Player state callback
 */
function onPlayerReady(event) {
  console.log("YouTube Player ready");
  if (typeof onYouTubePlayerReady === "function") {
    onYouTubePlayerReady(event);
  }
}

/**
 * YouTube Player state change callback
 */
function onPlayerStateChange(event) {
  const states = {
    "-1": "Unstarted",
    0: "Ended",
    1: "Playing",
    2: "Paused",
    3: "Buffering",
    5: "Video Cued",
  };

  console.log("Player State:", states[event.data]);

  if (typeof onYouTubeStateChange === "function") {
    onYouTubeStateChange(event);
  }
}

/**
 * YouTube Player error callback
 */
function onPlayerError(event) {
  const errors = {
    2: "Invalid parameter",
    5: "HTML5 player error",
    100: "Video not found",
    101: "Video owner does not allow embedding",
    150: "Same as 101 (restricted)",
  };

  console.error("YouTube Player Error:", errors[event.data] || "Unknown error");

  if (typeof onYouTubePlayerError === "function") {
    onYouTubePlayerError(event);
  }
}

/**
 * Play video on YouTube Player instance
 * @param {string} videoId - YouTube video ID
 */
function playVideoOnYouTubePlayer(videoId) {
  if (!youtubePlayerInstance) {
    console.error("YouTube player not initialized");
    return;
  }
  youtubePlayerInstance.loadVideoById(videoId);
}

/**
 * Stop YouTube Player
 */
function stopYouTubePlayer() {
  if (!youtubePlayerInstance) return;
  youtubePlayerInstance.stopVideo();
}

/**
 * Pause YouTube Player
 */
function pauseYouTubePlayer() {
  if (!youtubePlayerInstance) return;
  youtubePlayerInstance.pauseVideo();
}

/**
 * Get current YouTube player time
 * @returns {number} Current time in seconds
 */
function getCurrentYouTubeTime() {
  if (!youtubePlayerInstance) return 0;
  return youtubePlayerInstance.getCurrentTime();
}

/**
 * Get YouTube player duration
 * @returns {number} Duration in seconds
 */
function getYouTubeDuration() {
  if (!youtubePlayerInstance) return 0;
  return youtubePlayerInstance.getDuration();
}

/**
 * Set YouTube player volume (0-100)
 * @param {number} volume - Volume level (0-100)
 */
function setYouTubeVolume(volume) {
  if (!youtubePlayerInstance) return;
  youtubePlayerInstance.setVolume(Math.min(100, Math.max(0, volume)));
}

/**
 * Get YouTube player volume
 * @returns {number} Volume level (0-100)
 */
function getYouTubeVolume() {
  if (!youtubePlayerInstance) return 0;
  return youtubePlayerInstance.getVolume();
}

// Export for use in modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    searchYouTubeKaraoke,
    searchYouTubeKaraokePage,
    getVideoDetails,
    extractVideoId,
    buildYouTubeEmbedUrl,
    getYouTubeEmbedCode,
    initializeYouTubePlayer,
    playVideoOnYouTubePlayer,
    stopYouTubePlayer,
    pauseYouTubePlayer,
    getCurrentYouTubeTime,
    getYouTubeDuration,
    setYouTubeVolume,
    getYouTubeVolume,
  };
}
