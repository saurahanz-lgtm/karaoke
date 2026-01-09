/* ===== TV DISPLAY LOGIC ===== */

// Queue data storage
let tvQueue = [];
let currentSong = null;
let player;
let isPlaying = false;
let youtubeAPIReady = false;
let useFirebase = false;
let firebaseListenersSet = false;

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
    console.log('📺 TV Display initialized');
    
    // Generate QR code on load
    generateQRCode();
    
    // Regenerate QR code every 10 seconds to ensure it's always fresh
    setInterval(generateQRCode, 10000);
    
    // Check connection status immediately
    checkPhoneConnection();
    console.log('✅ Initial connection check done');
    
    // Check connection status every 1 second for faster updates
    setInterval(checkPhoneConnection, 1000);
    
    // Check if Firebase is available
    useFirebase = isFirebaseConfigured();
    
    if (useFirebase) {
        // Use Firebase real-time listeners
        initializeFirebaseListeners();
    } else {
        // Fallback to localStorage polling - more aggressive polling for better responsiveness
        loadQueueData();
        displayQueue();
        checkAndPlayCurrentSong();
        
        // Auto-refresh every 1 second for better real-time updates
        setInterval(() => {
            loadQueueData();
            displayQueue();
            checkAndPlayCurrentSong();
        }, 1000);
    }
    
    // Always add polling as backup even with Firebase
    setInterval(() => {
        loadQueueData();
        checkAndPlayCurrentSong();
    }, 2000);
    
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
            loadQueueData();
            displayQueue();
            checkAndPlayCurrentSong();
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
    const db = firebase.database();

    db.ref('queue').on('value', snapshot => {
        const data = snapshot.val();
        tvQueue = data ? Object.values(data) : [];

        displayQueue();

        // 🔥 AUTO-PLAY FIRST SONG
        if (!currentSong && tvQueue.length > 0) {
            setCurrentFromQueue(tvQueue[0]);
        }
    });

    db.ref('currentSong').on('value', snapshot => {
        const data = snapshot.val();
        if (data) {
            currentSong = data;
            checkAndPlayCurrentSong();
        }
    });
}

// Set current song from queue item
function setCurrentFromQueue(song) {
    currentSong = {
        title: song.title,
        artist: song.artist,
        videoId: song.videoId,
        requestedBy: song.requestedBy
    };
    
    // Update Firebase
    firebase.database().ref('currentSong').set(currentSong);
    
    isPlaying = true;
    checkAndPlayCurrentSong();
}

/* ===== YOUTUBE IFRAME PLAYER ===== */

function onYouTubeIframeAPIReady() {
    youtubeAPIReady = true;
    console.log('✅ YouTube API loaded');
    checkAndPlayCurrentSong();
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

// Check if phone/singer page is connected
function checkPhoneConnection() {
    try {
        const lastActivityTime = localStorage.getItem('karaoke_singer_activity');
        const connectionStatus = document.getElementById('connectionStatus');
        const connectionText = document.getElementById('connectionText');
        
        if (!connectionStatus || !connectionText) {
            console.warn('⚠️ Connection status elements not found');
            return;
        }
        
        if (!lastActivityTime) {
            connectionStatus.classList.remove('connected');
            connectionStatus.classList.add('disconnected');
            connectionText.textContent = '🔴 No Phone Connected';
            console.log('📱 No activity timestamp found');
            return;
        }
        
        const currentTime = Date.now();
        const activityTime = parseInt(lastActivityTime);
        const timeDifference = currentTime - activityTime;
        const timeoutDuration = 15000; // 15 seconds timeout
        
        console.log('🔍 Connection check - Last activity:', activityTime, 'Now:', currentTime, 'Difference:', Math.floor(timeDifference / 1000), 'seconds');
        
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

// Load queue data from Firebase (primary) or localStorage (fallback)
function loadQueueData() {
    // Try Firebase first (primary method)
    if (useFirebase && typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('queue').once('value', (snapshot) => {
                const data = snapshot.val();
                tvQueue = data ? Object.values(data) : [];
                console.log('📡 Queue loaded from Firebase:', tvQueue.length, 'songs');
            }).catch(err => {
                console.warn('Firebase queue read failed:', err.message);
                // Fallback to localStorage
                loadQueueDataFromLocalStorage();
            });
        } catch (error) {
            console.warn('Firebase error:', error.message);
            loadQueueDataFromLocalStorage();
        }
    } else {
        loadQueueDataFromLocalStorage();
    }
    
    // Load current song from Firebase (primary)
    if (useFirebase && typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('currentSong').once('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    currentSong = data;
                    console.log('🎵 Current song loaded from Firebase:', data.title);
                }
            }).catch(err => {
                console.warn('Firebase currentSong read failed:', err.message);
                // Fallback to localStorage
                const currentSongData = localStorage.getItem('karaoke_current_song');
                if (currentSongData) {
                    currentSong = JSON.parse(currentSongData);
                }
            });
        } catch (error) {
            console.warn('Firebase error:', error.message);
            const currentSongData = localStorage.getItem('karaoke_current_song');
            if (currentSongData) {
                currentSong = JSON.parse(currentSongData);
            }
        }
    } else {
        const currentSongData = localStorage.getItem('karaoke_current_song');
        if (currentSongData) {
            currentSong = JSON.parse(currentSongData);
        }
    }
}

// Load queue from localStorage fallback
function loadQueueDataFromLocalStorage() {
    const queueData = localStorage.getItem('karaoke_queue');
    if (queueData) {
        tvQueue = JSON.parse(queueData);
    } else {
        tvQueue = [];
    }
}

// Check and play current song (only when YouTube API is ready)
function checkAndPlayCurrentSong() {
    if (!youtubeAPIReady) {
        // YouTube API not ready yet, wait
        return;
    }

    const centerSingerName = document.getElementById('centerSingerName');

    // If no current song, automatically play first song from queue
    if (!currentSong || !currentSong.title) {
        if (tvQueue.length > 0) {
            // Auto-play first queued song
            const firstSong = tvQueue[0];
            currentSong = {
                title: firstSong.title,
                artist: firstSong.artist,
                videoId: firstSong.videoId,
                requestedBy: firstSong.requestedBy,
                singer: firstSong.requestedBy
            };
            localStorage.setItem('karaoke_current_song', JSON.stringify(currentSong));
        }
    }

    if (currentSong && currentSong.title && currentSong.videoId) {
        // Play video if videoId exists
        playVideo(currentSong.videoId, currentSong.title, currentSong.artist, currentSong.singer);
        
        // Update next song display
        updateNextSongDisplay();
        
        if (centerSingerName) {
            centerSingerName.classList.remove('show');
        }
    } else {
        // Play placeholder video when no song is selected
        const placeholderVideoId = 'dQw4w9WgXcQ'; // YouTube rickroll as placeholder
        playVideo(placeholderVideoId, 'Ready for your song', 'SDkaraoke', 'Waiting...');
        
        // Hide singer name display
        if (centerSingerName) {
            centerSingerName.classList.remove('show');
            centerSingerName.innerHTML = '';
        }
    }
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
            origin: window.location.origin
        },
        events: {
            'onReady': function(event) {
                event.target.playVideo();
            },
            'onStateChange': onPlayerStateChange
        }
    });
}

/* ===== PLAYER STATE MANAGEMENT ===== */

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        // Video finished, play next song
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
    } else {
        localStorage.setItem('karaoke_current_song', JSON.stringify(currentSong));
        localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
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
    } else {
        // Fallback to localStorage
        localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
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
        } else {
            // Clear localStorage
            localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
            localStorage.removeItem('karaoke_current_song');
        }
        
        displayQueue();
        checkAndPlayCurrentSong();
        alert('✅ Queue cleared successfully!');
    }
}
