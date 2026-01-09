// ===== TV DISPLAY LOGIC =====

// Queue data storage
let tvQueue = [];
let currentSong = null;
let player;
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
    // Generate QR code on load
    generateQRCode();
    
    // Regenerate QR code every 10 seconds to ensure it's always fresh
    setInterval(generateQRCode, 10000);
    
    // Check if Firebase is available
    useFirebase = isFirebaseConfigured();
    
    if (useFirebase) {
        // Use Firebase real-time listeners
        initializeFirebaseListeners();
    } else {
        // Fallback to localStorage polling
        loadQueueData();
        displayQueue();
        checkAndPlayCurrentSong();
        
        // Auto-refresh every 3 seconds
        setInterval(() => {
            loadQueueData();
            displayQueue();
            checkAndPlayCurrentSong();
        }, 3000);
    }
    
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
            console.log('📡 Storage change detected, updating display...');
            loadQueueData();
            displayQueue();
            checkAndPlayCurrentSong();
        }
    });
    
    // Listen for custom karaoke queue update events
    window.addEventListener('karaoke-queue-updated', function(e) {
        console.log('🎵 Queue updated from singer control:', e.detail);
        loadQueueData();
        displayQueue();
        checkAndPlayCurrentSong();
    });
});

// Initialize Firebase real-time listeners
function initializeFirebaseListeners() {
    try {
        const queueRef = firebase.database().ref('queue');
        const currentSongRef = firebase.database().ref('currentSong');
        
        // Listen for queue changes
        queueRef.on('value', (snapshot) => {
            const data = snapshot.val();
            tvQueue = data ? Object.values(data) : [];
            displayQueue();
            checkAndPlayCurrentSong();
        });
        
        // Listen for current song changes
        currentSongRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                currentSong = data;
                checkAndPlayCurrentSong();
            }
        });
        
        firebaseListenersSet = true;
        console.log('✅ Firebase real-time listeners initialized');
    } catch (error) {
        console.error('❌ Firebase initialization error:', error);
        // Fallback to localStorage
        useFirebase = false;
        loadQueueData();
        displayQueue();
        checkAndPlayCurrentSong();
        setInterval(() => {
            loadQueueData();
            displayQueue();
            checkAndPlayCurrentSong();
        }, 3000);
    }
}

// On YouTube API ready
function onYouTubeIframeAPIReady() {
    youtubeAPIReady = true;
    // Check if there's a current song to play
    checkAndPlayCurrentSong();
}

// Toggle fullscreen mode
function toggleFullscreen() {
    const tvContainer = document.querySelector('.tv-container');
    const btn = document.getElementById('fullscreenBtn');
    
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

// Update fullscreen button text
function updateFullscreenButton() {
    const btn = document.getElementById('fullscreenBtn');
    const reserveList = document.querySelector('.reserve-list');
    
    if (!btn) return; // Guard against null
    
    if (document.fullscreenElement || document.webkitFullscreenElement || 
        document.mozFullScreenElement || document.msFullscreenElement) {
        btn.textContent = '⛶ Exit Fullscreen';
        // Show reserve list in fullscreen
        if (reserveList) reserveList.classList.add('show');
    } else {
        btn.textContent = '⛶ Full Screen';
        // Keep reserve list visible always
        if (reserveList) reserveList.classList.add('show');
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

// Load queue data from localStorage (shared with admin)
function loadQueueData() {
    // Get current song from localStorage
    const currentSongData = localStorage.getItem('karaoke_current_song');
    if (currentSongData) {
        currentSong = JSON.parse(currentSongData);
    }

    // Get queue from localStorage
    const queueData = localStorage.getItem('karaoke_queue');
    if (queueData) {
        tvQueue = JSON.parse(queueData);
    } else {
        // Demo data for testing
        tvQueue = [
            { id: 1, title: "Bohemian Rhapsody", artist: "Queen", requestedBy: "John" },
            { id: 2, title: "Hallelujah", artist: "Leonard Cohen", requestedBy: "Maria" },
            { id: 3, title: "Someone Like You", artist: "Adele", requestedBy: "Sarah" },
            { id: 4, title: "Perfect", artist: "Ed Sheeran", requestedBy: "Alex" },
            { id: 5, title: "Shape of You", artist: "Ed Sheeran", requestedBy: "Emma" },
            { id: 6, title: "Rolling in the Deep", artist: "Adele", requestedBy: "David" }
        ];
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
            'onStateChange': function(event) {
                // When video ends, play next song
                if (event.data == YT.PlayerState.ENDED) {
                    skipToNextSong();
                }
            }
        }
    });
}

// Display queue
function displayQueue() {
    // Queue display removed - minimal design
    return;
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
    if (tvQueue.length > 0) {
        const nextSong = tvQueue.shift();
        currentSong = {
            title: nextSong.title,
            artist: nextSong.artist,
            videoId: nextSong.videoId,
            requestedBy: nextSong.requestedBy,
            singer: nextSong.requestedBy
        };

        if (typeof firebase !== 'undefined' && firebase.apps.length) {
    useFirebase = true;
} else {
    useFirebase = false;
}


        checkAndPlayCurrentSong();
        displayQueue();
    }
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
