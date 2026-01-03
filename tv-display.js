// ===== TV DISPLAY LOGIC =====

// Queue data storage
let tvQueue = [];
let currentSong = null;
let player;

// Initialize TV display
document.addEventListener('DOMContentLoaded', function() {
    // Generate QR code
    generateQRCode();
    
    loadQueueData();
    displayCurrentSong();
    displayQueue();
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('mozfullscreenchange', updateFullscreenButton);
    document.addEventListener('msfullscreenchange', updateFullscreenButton);
    
    // Auto-refresh every 3 seconds to check for updates
    setInterval(() => {
        loadQueueData();
        displayCurrentSong();
        displayQueue();
    }, 3000);
});

// On YouTube API ready
function onYouTubeIframeAPIReady() {
    // Initialize empty player
    if (currentSong && currentSong.videoId) {
        playVideo(currentSong.videoId, currentSong.title, currentSong.artist, currentSong.singer);
    }
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
        // Hide reserve list when not in fullscreen
        reserveList.classList.remove('show');
    }
}

// Generate QR code for singer page
function generateQRCode() {
    const qrContainer = document.getElementById('qrcode');
    // Clear previous QR code if exists
    qrContainer.innerHTML = '';
    
    // Get the current domain and path
    const baseUrl = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/');
    const singerPageUrl = baseUrl + '/singer.html';
    
    // Create QR code (smaller size for bottom right)
    new QRCode(qrContainer, {
        text: singerPageUrl,
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

// Display current song with video
function displayCurrentSong() {
    const displayContainer = document.getElementById('currentSongDisplay');
    const centerSingerName = document.getElementById('centerSingerName');

    if (currentSong && currentSong.title) {
        // Play video if videoId exists
        if (currentSong.videoId) {
            playVideo(currentSong.videoId, currentSong.title, currentSong.artist, currentSong.singer);
        }
        
        displayContainer.innerHTML = `
            <div class="video-song-title">${currentSong.title}</div>
            <div class="video-song-artist">🎤 ${currentSong.artist}</div>
            <div class="video-song-singer">Sung by: ${currentSong.singer}</div>
        `;
        
        // Show center singer name with mic icon
        centerSingerName.innerHTML = `
            <div class="singer-name-display">
                <span class="mic-icon">🎤</span>
                <span>${currentSong.singer}</span>
            </div>
        `;
        centerSingerName.classList.add('show');
    } else {
        // Play placeholder video when no song is selected
        const placeholderVideoId = 'dQw4w9WgXcQ'; // YouTube rickroll as placeholder
        playVideo(placeholderVideoId, 'Ready for your song', 'SDkaraoke', 'Waiting...');
        
        displayContainer.innerHTML = `
            <div class="waiting-message">📋 Please select a song to begin!</div>
        `;
        centerSingerName.classList.remove('show');
        centerSingerName.innerHTML = '';
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
            </div>
        `;
    });

    queueContainer.innerHTML = html;
    updateReserveList();
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
            singer: nextSong.requestedBy
        };

        localStorage.setItem('karaoke_current_song', JSON.stringify(currentSong));
        localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));

        displayCurrentSong();
        displayQueue();
    }
}

// Function to remove song from queue (called from admin)
function removeSongFromQueue(songId) {
    tvQueue = tvQueue.filter(s => s.id !== songId);
    localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
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
        localStorage.setItem('karaoke_queue', JSON.stringify(tvQueue));
        displayQueue();
        displayCurrentSong();
        alert('✅ Queue cleared successfully!');
    }
}
