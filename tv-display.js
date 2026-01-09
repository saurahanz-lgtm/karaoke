/* ===== TV DISPLAY LOGIC ===== */

// Queue data storage
let tvQueue = [];
let currentSong = null;
let player = null;
let isPlaying = false;
let youtubeAPIReady = false;
let useFirebase = false;
let firebaseListenersSet = false;
let pendingSongToPlay = null;

// A. GLOBAL FLAGS (REQUIRED)
let ytReady = false;
let firebaseReady = false;
let playerReady = false;
let isLoadingSong = false;
let currentVideoId = null;

// Check if Firebase is properly configured
function isFirebaseConfigured() {
    try {
        if (typeof firebase !== 'undefined' && firebase.database && firebase.app()) {
            const config = firebase.app().options;
            // Check if all required fields are present and not placeholders
            return config.databaseURL && !config.databaseURL.includes('YOUR_');
        }
    } catch (e) {
        return false;
    }
    return false;
}

// Initialize TV display
document.addEventListener('DOMContentLoaded', function() {
    console.log('📺 [1/7] TV Display DOMContentLoaded');
    
    // Generate QR code on load
    generateQRCode();
    
    // Regenerate QR code every 10 seconds to ensure it's always fresh
    setInterval(generateQRCode, 10000);
    
    // [1] Check if Firebase is available FIRST
    useFirebase = isFirebaseConfigured();
    
    if (!useFirebase) {
        console.error('❌ Firebase not configured - TV Display requires Firebase');
        return;
    }    firebaseReady = true;    console.log('🔥 [READY] Firebase configured');
    
    // Now check connection status
    checkPhoneConnection();
    console.log('✅ Initial connection check done');
    
    // Check connection status every 1 second for faster updates
    setInterval(checkPhoneConnection, 1000);
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('mozfullscreenchange', updateFullscreenButton);
    document.addEventListener('msfullscreenchange', updateFullscreenButton);
    
    // Refresh QR code when page becomes visible (user switches back to this tab)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            generateQRCode();
        }
    });
    
    // Listen for storage changes from other tabs/windows (real-time sync with singer.html)
    window.addEventListener('storage', function(e) {
        if (e.key === 'karaoke_queue' || e.key === 'karaoke_current_song') {
            console.log('📡 Storage change detected from other tab:', e.key);
        }
    });
    
    // Listen for custom karaoke queue update events (same window only)
    window.addEventListener('karaoke-queue-updated', function(e) {
        console.log('🎵 Queue updated from singer control:', e.detail);
        loadQueueData();
        displayQueue();
        checkAndPlayCurrentSong();
    });

    // Listen for auto-play trigger (same window only)
    window.addEventListener('karaoke-auto-play', function(e) {
        console.log('▶️ Auto-play triggered:', e.detail.song);
        currentSong = e.detail.song;
        localStorage.setItem('karaoke_current_song', JSON.stringify(currentSong));
        loadQueueData();
        checkAndPlayCurrentSong();
    });
});

/* ===== FIREBASE LISTENERS ===== */

function initializeFirebaseListeners() {
    console.log('🔥 [3/7] Attaching Firebase listeners');
    const db = firebase.database();

    db.ref('queue').on('value', snapshot => {
        const data = snapshot.val();
        if (!data) return;

        tvQueue = Object.values(data);
        console.log('📡 Queue loaded from Firebase:', tvQueue.length, 'songs');

        // 🔥 AUTO-SET FIRST SONG
        if (!currentSong && tvQueue.length > 0) {
            firebase.database().ref('currentSong').set(tvQueue[0]);
        }
        
        displayQueue();
    });

    db.ref('currentSong').on('value', snap => {
        const data = snap.val();
        if (!data || !data.videoId) return;

        console.log(
            `🎬 Current song detected: ${data.title} ID: ${data.videoId} Timestamp: ${data.timestamp}`
        );

        currentSong = data;
        
        // Update display immediately
        displayQueue();
        updateNextSongDisplay();

        // Try to initialize and play
        tryInitPlayback();
    });

    // 🔥 Listen for activity updates
    db.ref('activity').on('value', snapshot => {
        const activityData = snapshot.val();
        if (!activityData) return;

        console.log('📱 Activity updated from Firebase:', activityData.timestamp);
    });
    
    firebaseListenersSet = true;
    console.log('✅ [3/7] Firebase listeners attached');
    
    // 🔥 Load initial data after listeners are attached
    console.log('📡 [3/7] Loading initial songs from Firebase...');
    db.ref('queue').once('value', snapshot => {
        const queueData = snapshot.val();
        if (queueData) {
            tvQueue = Object.values(queueData);
            console.log('📡 Initial queue loaded:', tvQueue.length, 'songs');
            displayQueue();
        }
    });
    
    db.ref('currentSong').once('value', snapshot => {
        const songData = snapshot.val();
        if (songData) {
            currentSong = songData;
            console.log('🎵 Initial song loaded:', currentSong.title);
            displayQueue();
            updateNextSongDisplay();
            
            // Try to play if player is ready
            if (youtubeAPIReady && playerReady) {
                console.log('▶️ [6/7] Initial song - player ready, calling playback');
                tryInitPlayback();
            }
        }
    });
}

// Set current song from queue item
function setCurrentFromQueue(song) {
    currentSong = {
        title: song.title,
        artist: song.artist,
        videoId: song.videoId,
        requestedBy: song.requestedBy,
        singer: song.requestedBy
    };
    
    // Update Firebase
    firebase.database().ref('currentSong').set(currentSong);
    
    isPlaying = true;
    checkAndPlayCurrentSong();
}

/* ===== YOUTUBE IFRAME PLAYER ===== */

function onYouTubeIframeAPIReady() {
    console.log('✅ YouTube API Ready');
    ytReady = true;
    createYouTubePlayer();
}

// B. YouTube API - Initialize player when ready
function createYouTubePlayer() {
    console.log('✅ YouTube API Ready, player will be created on first song load');
    // Player is now created in loadSong() when needed
}

// D. SINGLE ENTRY POINT (MOST IMPORTANT)
function tryInitPlayback() {
    if (!ytReady || !firebaseReady) {
        console.log(`⏳ Not ready yet: ytReady=${ytReady}, firebaseReady=${firebaseReady}`);
        return;
    }

    if (isLoadingSong) {
        console.log('⏳ Already loading a song, skipping...');
        return;
    }

    if (currentVideoId === currentSong?.videoId) {
        console.log('ℹ️ Same song already playing');
        return;
    }

    if (!currentSong || !currentSong.videoId) {
        console.warn('⚠ No current song data');
        return;
    }

    loadSong(currentSong);
}

/* ===== FULLSCREEN & CONNECTION ===== */

function toggleFullscreen() {
    const tvContainer = document.querySelector('.tv-container');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement && 
        !document.mozFullScreenElement && !document.msFullscreenElement) {
        // Enter fullscreen
        if (tvContainer.requestFullscreen) {
            tvContainer.requestFullscreen();
        } else if (tvContainer.webkitRequestFullscreen) {
            tvContainer.webkitRequestFullscreen();
        } else if (tvContainer.mozRequestFullScreen) {
            tvContainer.mozRequestFullScreen();
        } else if (tvContainer.msRequestFullscreen) {
            tvContainer.msRequestFullscreen();
        }
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// D. LOAD SONG - Unified playback handler
// E. PLAYER CREATION (ONCE LANG)
function loadSong(song) {
    isLoadingSong = true;
    currentVideoId = song.videoId;

    if (!window.tvPlayer) {
        console.log('📋 Creating new YT.Player');

        window.tvPlayer = new YT.Player('player', {
            videoId: song.videoId,
            playerVars: {
                autoplay: 1,
                controls: 0,
                enablejsapi: 1,
                modestbranding: 1
            },
            events: {
                onReady: () => {
                    console.log('🎬 YouTube Player Ready - Starting playback');
                    playerReady = true;
                    window.tvPlayer.playVideo();
                    isLoadingSong = false;
                },
                onStateChange: onPlayerStateChange
            }
        });

    } else {
        console.log('▶️ Loading new video:', song.videoId);
        window.tvPlayer.loadVideoById(song.videoId);
        isLoadingSong = false;
    }

    console.log(`📺 Now playing: ${song.title}`);
}

// Check if phone/singer page is connected
function checkPhoneConnection() {
    try {
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionText = document.getElementById('connectionText');
        
        if (!connectionStatus || !connectionText) {
            console.warn('⚠️ Connection status elements not found');
            return;
        }

        // Read activity from Firebase
        firebase.database().ref('activity').once('value', snapshot => {
            const activityData = snapshot.val();
            
            if (!activityData) {
                connectionStatus.classList.remove('connected');
                connectionStatus.classList.add('disconnected');
                connectionText.textContent = '🔴 No Phone Connected';
                return;
            }

            const currentTime = Date.now();
            const activityTime = activityData.timestamp || 0;
            const timeDifference = currentTime - activityTime;
            const timeoutDuration = 15000; // 15 seconds timeout
            
            if (timeDifference < timeoutDuration) {
                // Phone is connected
                connectionStatus.classList.remove('disconnected');
                connectionStatus.classList.add('connected');
                connectionText.textContent = '🟢 Phone Connected';
            } else {
                // Phone disconnected (no activity for 15 seconds)
                connectionStatus.classList.remove('connected');
                connectionStatus.classList.add('disconnected');
                connectionText.textContent = '🔴 No Phone Connected';
            }
        }).catch(err => {
            console.warn('Firebase activity read failed:', err.message);
            connectionStatus.classList.remove('connected');
            connectionStatus.classList.add('disconnected');
            connectionText.textContent = '🔴 No Phone Connected';
        });
    } catch (error) {
        console.error('❌ Error in checkPhoneConnection:', error.message);
    }
}

// Generate QR code for singer page
function generateQRCode() {
    const qrContainer = document.getElementById('qrcode');
    // Clear previous QR code if exists
    qrContainer.innerHTML = '';
    
    // Get the current domain and path
    const baseUrl = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/');
    const indexPageUrl = baseUrl + '/index.html';
    
    // Debug logging
    console.log('📱 QR Code URL:', indexPageUrl);
    
    // Create QR code (smaller size for bottom right)
    new QRCode(qrContainer, {
        text: indexPageUrl,
        width: 110,
        height: 110,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

// Load queue data from Firebase only
function loadQueueData() {
    // Firebase listeners handle real-time updates
    // This function is kept for backward compatibility
}

// Check and play current song (only when YouTube API is ready)
function checkAndPlayCurrentSong() {
    if (!currentSong || !currentSong.videoId) {
        console.warn('⚠ No current song data');
        return;
    }

    // 🔴 Player NOT ready → store first
    if (!youtubeAPIReady || !player) {
        console.log('⏳ Player not ready yet, storing pending song');
        pendingSongToPlay = currentSong;
        return;
    }

    console.log('▶ [6/7] Playing now:', currentSong.title);
    isLoadingSong = true;
    currentVideoId = currentSong.videoId;

    player.loadVideoById({
        videoId: currentSong.videoId,
        startSeconds: 0
    });

    displaySongInfo(currentSong);
    updateNextSongDisplay();

    pendingSongToPlay = null;
    isLoadingSong = false;
}

// Display song information in lyrics section
function displaySongInfo(song) {
    const centerSingerName = document.getElementById('centerSingerName');
    
    if (!centerSingerName) return;
    
    // Singer name display removed from center
    centerSingerName.classList.remove('show');
    centerSingerName.innerHTML = '';
}

// Play video using YouTube iframe API
function playVideo(videoId, title, artist, singer) {
    const container = document.getElementById('videoPlayer');
    
    // Clear previous player
    container.innerHTML = '';
    
    player = new YT.Player(container, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            autoplay: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
            fs: 1,
            playsinline: 1,
            enablejsapi: 1
        },
        events: {
            'onReady': function(event) {
                event.target.playVideo();
            },
            'onStateChange': onPlayerStateChange,
            'onError': function(event) {
                console.error('❌ YouTube player error:', event.data);
                if (event.data === 150 || event.data === 101) {
                    // Video restricted from embedding
                    console.warn('⚠️ Video is restricted from embedding on this site');
                }
            }
        }
    });
}

/* ===== PLAYER STATE MANAGEMENT ===== */

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        // Video finished, play next song
        console.log('✅ [7/7] Video ended - playing next song');
        playNextSong();
    }
}

function playNextSong() {
    if (tvQueue.length === 0) {
        isPlaying = false;
        return;
    }
    
    const nextSong = tvQueue.shift();
    currentSong = {
        title: nextSong.title,
        artist: nextSong.artist,
        videoId: nextSong.videoId,
        requestedBy: nextSong.requestedBy,
        singer: nextSong.requestedBy
    };
    
    isPlaying = true;
    
    // Update Firebase
    if (useFirebase) {
        firebase.database().ref('currentSong').set(currentSong);
        firebase.database().ref('queue').set(tvQueue.length > 0 ? tvQueue : null);
    }
    
    displayQueue();
    checkAndPlayCurrentSong();
}

/* ===== UI RENDERING ===== */

function displayQueue() {
    // Show queue with count and next song info
    try {
        const nextSongTitle = document.getElementById('nextSongTitle');
        const nextSongArtist = document.getElementById('nextSongArtist');
        
        if (!nextSongTitle || !nextSongArtist) return;
        
        // Display queue from tvQueue (loaded from Firebase)
        if (tvQueue && tvQueue.length > 0) {
            const nextSong = tvQueue[0];
            nextSongTitle.textContent = `📋 Queue (${tvQueue.length}): ${nextSong.title}`;
            nextSongArtist.textContent = `by ${nextSong.artist} - ${nextSong.requestedBy}`;
        } else {
            nextSongTitle.textContent = 'No songs in queue';
            nextSongArtist.textContent = '-';
        }
    } catch (e) {
        console.warn('Error displaying queue:', e.message);
    }
}

// Update next song display (horizontal, in upper left)
function updateNextSongDisplay() {
    const nextSongDisplay = document.getElementById('nextSongDisplay');
    const nextSongTitle = document.getElementById('nextSongTitle');
    const nextSongArtist = document.getElementById('nextSongArtist');
    
    if (!nextSongDisplay) return; // Element might not exist yet
    
    // Get the next song (skip the current playing song)
    let nextSong = null;
    
    if (tvQueue.length > 0) {
        // If there's a current song and it matches the first in queue, show second song
        if (currentSong && currentSong.title === tvQueue[0].title) {
            nextSong = tvQueue.length > 1 ? tvQueue[1] : null;
        } else {
            // Otherwise show the first song in queue
            nextSong = tvQueue[0];
        }
    }
    
    if (nextSong) {
        nextSongTitle.textContent = nextSong.title;
        nextSongArtist.textContent = `by ${nextSong.artist}`;
        nextSongDisplay.style.display = 'flex';
    } else {
        nextSongTitle.textContent = 'Waiting for next song...';
        nextSongArtist.textContent = '-';
        nextSongDisplay.style.display = 'flex';
    }
}

// Update reserve list in top right corner
function updateReserveList() {
    // Reserve list removed - minimal design
    return;
}

// Function to add song to queue (called from singer page)
function addSongToQueue(title, artist, requestedBy) {
    const newSong = {
        id: Math.max(...tvQueue.map(s => s.id || 0), 0) + 1,
        title,
        artist,
        requestedBy
    };

    tvQueue.push(newSong);
    localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));

    // Refresh display
    displayQueue();
}

// Function to skip to next song (called from admin)
function skipToNextSong() {
    playNextSong();
}

// Function to remove song from queue (called from admin)
function removeSongFromQueue(songId) {
    tvQueue = tvQueue.filter(s => s.id !== songId);
    
    if (useFirebase) {
        // Update Firebase
        firebase.database().ref('queue').set(tvQueue.length > 0 ? tvQueue : null);
    }
    
    displayQueue();
}

// Function to delete entire queue (requires admin password)
function deleteQueue() {
    const password = prompt('Enter admin password to clear queue:');
    
    if (password === null) {
        // User cancelled
        return;
    }
    
    // Get admin users from localStorage
    const users = JSON.parse(localStorage.getItem('karaoke_users') || '[]');
    const adminUser = users.find(u => u.role === 'admin' && u.password === password);
    
    if (!adminUser) {
        alert('❌ Incorrect password! Only admins can clear the queue.');
        return;
    }
    
    if (confirm('Are you sure you want to clear all songs from the queue?')) {
        tvQueue = [];
        currentSong = null;
        
        if (useFirebase) {
            // Clear Firebase
            firebase.database().ref('queue').set(null);
            firebase.database().ref('currentSong').set(null);
        }
        
        displayQueue();
        checkAndPlayCurrentSong();
        alert('✅ Queue cleared successfully!');
    }
}
