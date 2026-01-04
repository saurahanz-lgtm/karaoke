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
    const reserveList = document.getElementById('reserveList');
    
    if (document.fullscreenElement || document.webkitFullscreenElement || 
        document.mozFullScreenElement || document.msFullscreenElement) {
        btn.textContent = '⛶ Exit Fullscreen';
        // Show reserve list in fullscreen
        reserveList.classList.add('show');
    } else {
        btn.textContent = '⛶ Full Screen';
        // Keep reserve list visible always
        reserveList.classList.add('show');
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

    const displayContainer = document.getElementById('currentSongDisplay');
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
        
        // Display current song info as lyrics alternative
        displaySongInfo(currentSong);
        
        // Update next song display
        updateNextSongDisplay();
        
        displayContainer.innerHTML = '';
        centerSingerName.innerHTML = '';
        centerSingerName.classList.remove('show');
    } else {
        // Play placeholder video when no song is selected
        const placeholderVideoId = 'dQw4w9WgXcQ'; // YouTube rickroll as placeholder
        playVideo(placeholderVideoId, 'Ready for your song', 'SDkaraoke', 'Waiting...');
        
        // Show placeholder lyrics
        displaySongInfo(null);
        
        displayContainer.innerHTML = '';
        centerSingerName.classList.remove('show');
        centerSingerName.innerHTML = '';
    }
}

// Display song information in lyrics section
function displaySongInfo(song) {
    const lyricsContent = document.getElementById('lyricsContent');
    
    if (!lyricsContent) return;
    
    if (song && song.title) {
        lyricsContent.innerHTML = `
            <div class="lyrics-text" style="animation: fadeInLyrics 0.8s ease-in;">
                <div style="font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; color: #f093fb;">🎤 ${song.title}</div>
                <div style="font-size: 1.5rem; color: rgba(255, 255, 255, 0.9); margin-bottom: 15px;">by ${song.artist}</div>
                <div style="font-size: 1.2rem; color: rgba(255, 255, 255, 0.7);">Sung by: ${song.singer || 'Guest'}</div>
            </div>
        `;
    } else {
        lyricsContent.innerHTML = '<div class="lyrics-placeholder">♪ Lyrics will appear here ♪</div>';
    }
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
            iv_load_policy: 3
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
    const queueContainer = document.getElementById('queueDisplay');
    const queueCount = document.getElementById('queueCount');

    if (tvQueue.length === 0) {
        queueContainer.innerHTML = '<div class="empty-message">No songs in queue</div>';
        queueCount.textContent = '0';
        updateReserveList();
        return;
    }

    queueCount.textContent = tvQueue.length;

    let html = '';
    tvQueue.forEach((song, index) => {
        html += `
            <div class="queue-item-card" style="animation-delay: ${index * 0.1}s;">
                <div class="queue-number-large">${index + 1}</div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${song.title}</div>
                    <div class="queue-item-artist">🎤 ${song.artist}</div>
                    <div class="queue-item-singer">👤 ${song.requestedBy}</div>
                </div>
                <div class="queue-item-controls">
                    ${index === 0 ? `<button class="control-btn skip-btn" onclick="skipToNextSong()" title="Skip to next song">⏭️ Skip</button>` : ''}
                    <button class="control-btn delete-btn" onclick="removeSongFromQueue(${song.id})" title="Remove song from queue">🗑️ Delete</button>
                </div>
            </div>
        `;
    });

    queueContainer.innerHTML = html;
    updateNextSongDisplay();
    updateReserveList();
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
    const reserveListItems = document.getElementById('reserveListItems');
    
    // Load reserved songs from localStorage
    const reservedSongs = JSON.parse(localStorage.getItem('karaoke_reserved_songs') || '[]');
    const songsToDisplay = tvQueue.length > 0 ? tvQueue : reservedSongs;
    
    if (!songsToDisplay || songsToDisplay.length === 0) {
        reserveListItems.innerHTML = '<div style="color: rgba(255, 255, 255, 0.5); font-size: 0.9rem;">No songs available</div>';
        return;
    }

    // Show first 5 songs in reserve list
    let html = '';
    songsToDisplay.slice(0, 5).forEach((song, index) => {
        html += `
            <div class="reserve-item">
                <div class="reserve-item-number">${index + 1}</div>
                <div class="reserve-item-title">${song.title}</div>
                <div class="reserve-item-artist">${song.artist}</div>
                <div class="reserve-item-singer">${song.requestedBy || 'Song Book'}</div>
            </div>
        `;
    });

    reserveListItems.innerHTML = html;
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

        if (useFirebase) {
            // Update Firebase
            firebase.database().ref('currentSong').set(currentSong);
            firebase.database().ref('queue').set(tvQueue.length > 0 ? tvQueue : null);
        } else {
            // Fallback to localStorage
            localStorage.setItem('karaoke_current_song', JSON.stringify(currentSong));
            localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
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
