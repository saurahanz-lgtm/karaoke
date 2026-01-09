// YouTube API Configuration
// This file handles all YouTube API interactions for the karaoke app

const YOUTUBE_CONFIG = {
    // Replace with your own YouTube API key from Google Cloud Console
    // Get one at: https://console.cloud.google.com/
    API_KEY: 'AIzaSyAVq2Rno7lN9xilCpUzgOJMKSZCCqB96jQ',
    
    // YouTube Data API endpoint
    SEARCH_ENDPOINT: 'https://www.googleapis.com/youtube/v3/search',
    
    // Search parameters
    SEARCH_PARAMS: {
        part: 'snippet',
        maxResults: 15,
        type: 'video',
        safeSearch: 'strict',
        regionCode: 'US',
        relevanceLanguage: 'en'
    }
};

/**
 * Search YouTube for karaoke videos
 * @param {string} query - Search query (song name, artist, etc.)
 * @returns {Promise<Array>} Array of video objects
 */
async function searchYouTubeKaraoke(query) {
    if (!query || query.trim().length === 0) {
        throw new Error('Search query cannot be empty');
    }

    const searchQuery = `${query.trim()} karaoke`;
    
    try {
        const url = new URL(YOUTUBE_CONFIG.SEARCH_ENDPOINT);
        url.searchParams.append('key', YOUTUBE_CONFIG.API_KEY);
        url.searchParams.append('q', searchQuery);
        
        Object.entries(YOUTUBE_CONFIG.SEARCH_PARAMS).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });

        const response = await fetch(url.toString());
        
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('YouTube API quota exceeded or invalid key');
            } else if (response.status === 400) {
                throw new Error('Invalid search parameters');
            } else {
                throw new Error(`YouTube API error: ${response.status}`);
            }
        }

        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            return [];
        }

        return data.items.map(item => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default.url,
            publishedAt: item.snippet.publishedAt,
            description: item.snippet.description
        }));

    } catch (error) {
        console.error('YouTube Search Error:', error);
        throw error;
    }
}

/**
 * Get video details from YouTube
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<Object>} Video details object
 */
async function getVideoDetails(videoId) {
    const endpoint = 'https://www.googleapis.com/youtube/v3/videos';
    
    try {
        const url = new URL(endpoint);
        url.searchParams.append('key', YOUTUBE_CONFIG.API_KEY);
        url.searchParams.append('id', videoId);
        url.searchParams.append('part', 'contentDetails,snippet,statistics');

        const response = await fetch(url.toString());
        
        if (!response.ok) {
            throw new Error(`Failed to fetch video details: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            throw new Error('Video not found');
        }

        const video = data.items[0];
        
        // Parse duration from ISO 8601 format (PT#H#M#S)
        const duration = parseDuration(video.contentDetails.duration);

        return {
            videoId: video.id,
            title: video.snippet.title,
            description: video.snippet.description,
            channel: video.snippet.channelTitle,
            thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium.url,
            duration: duration,
            views: parseInt(video.statistics.viewCount || 0),
            likes: parseInt(video.statistics.likeCount || 0),
            publishedAt: video.snippet.publishedAt
        };
    } catch (error) {
        console.error('Get Video Details Error:', error);
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
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
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
        /^([a-zA-Z0-9_-]{11})$/  // Direct video ID
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
        ivLoadPolicy = 3  // Hide annotations
    } = options;

    const baseUrl = 'https://www.youtube.com/embed/';
    const params = new URLSearchParams({
        autoplay: autoplay ? 1 : 0,
        controls: controls ? 1 : 0,
        modestbranding: modestBranding ? 1 : 0,
        rel: rel ? 1 : 0,
        showinfo: showInfo ? 1 : 0,
        iv_load_policy: ivLoadPolicy
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
    const {
        width = '100%',
        height = '100%',
        title = 'YouTube Video'
    } = options;

    const embedUrl = buildYouTubeEmbedUrl(videoId, {
        autoplay: true,
        controls: true,
        modestBranding: true,
        rel: false
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
    if (typeof YT === 'undefined') {
        console.error('YouTube IFrame API not loaded. Make sure to include: <script src="https://www.youtube.com/iframe_api"></script>');
        return null;
    }

    const {
        autoplay = true,
        controls = true,
        height = '100%',
        width = '100%'
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
            iv_load_policy: 3
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });

    return youtubePlayerInstance;
}

/**
 * YouTube Player state callback
 */
function onPlayerReady(event) {
    console.log('YouTube Player ready');
    if (typeof onYouTubePlayerReady === 'function') {
        onYouTubePlayerReady(event);
    }
}

/**
 * YouTube Player state change callback
 */
function onPlayerStateChange(event) {
    const states = {
        '-1': 'Unstarted',
        '0': 'Ended',
        '1': 'Playing',
        '2': 'Paused',
        '3': 'Buffering',
        '5': 'Video Cued'
    };

    console.log('Player State:', states[event.data]);

    if (typeof onYouTubeStateChange === 'function') {
        onYouTubeStateChange(event);
    }
}

/**
 * YouTube Player error callback
 */
function onPlayerError(event) {
    const errors = {
        '2': 'Invalid parameter',
        '5': 'HTML5 player error',
        '100': 'Video not found',
        '101': 'Video owner does not allow embedding',
        '150': 'Same as 101 (restricted)'
    };

    console.error('YouTube Player Error:', errors[event.data] || 'Unknown error');

    if (typeof onYouTubePlayerError === 'function') {
        onYouTubePlayerError(event);
    }
}

/**
 * Play video on YouTube Player instance
 * @param {string} videoId - YouTube video ID
 */
function playVideoOnYouTubePlayer(videoId) {
    if (!youtubePlayerInstance) {
        console.error('YouTube player not initialized');
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        searchYouTubeKaraoke,
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
        getYouTubeVolume
    };
}
