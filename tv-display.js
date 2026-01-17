/* ===== TV DISPLAY LOGIC ===== */

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

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

// Boot-up video configuration (DISABLED)
// Skip boot-up video and go directly to karaoke songs
let isPlayingBootUpVideo = false;
let bootUpVideoPlayed = true; // Mark as already played to skip boot-up

// Boot-up splash screen management
let bootupStartTime = Date.now();
let bootupHidden = false;

// SCORING SYSTEM
let songStartTime = null;
let hasSinging = false;
let currentSingerName = '';
let songDurationMs = 0;

// Mark that someone is singing (can be called from singer.js or other pages)
function markSinging() {
    hasSinging = true;
    console.log(`🎤 Singing marked for ${currentSingerName}`);
}

function hideBootupSplash() {
    if (bootupHidden) return; // Only hide once
    bootupHidden = true;
    
    const splash = document.getElementById('bootupSplash');
    if (splash) {
        splash.classList.add('hidden');
        console.log('✅ Boot-up splash hidden');
    }
}

function checkBootupCompletion() {
    const timeSinceStart = Date.now() - bootupStartTime;
    
    // Boot-up video disabled - hide splash when systems ready
    if (firebaseReady && ytReady && timeSinceStart >= 1000) {
        console.log('✅ Systems ready - hiding splash');
        hideBootupSplash();
        return true;
    }
    
    // Fallback timeout - hide after 5 seconds
    if (timeSinceStart >= 5000) {
        console.log('⏱️ Timeout - hiding splash');
        hideBootupSplash();
        return true;
    }
    
    return false;
}

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
    console.log('🔍 DEBUG: window.YT =', typeof window.YT);
    console.log('🔍 DEBUG: window.firebase =', typeof window.firebase);
    
    // Check if TV is enabled before initializing
    checkTVEnabled(function(isEnabled) {
        if (!isEnabled) {
            console.warn('⚠️ TV Display is DISABLED');
            showTVDisabledMessage();
            return;
        }
        
        // TV is enabled, proceed with normal initialization
        initializeTVDisplay();
    });
});

// Initialize TV Display (after checking if enabled)
function initializeTVDisplay() {
    // Verify YouTube API is available
    if (typeof YT === 'undefined') {
        console.error('❌ YouTube API not loaded! Check that https://www.youtube.com/iframe_api is accessible');
    } else {
        console.log('✅ YouTube API library loaded');
    }
    
    // Debug Firebase config
    try {
        const config = firebase.app().options;
        console.log('🔍 DEBUG: Firebase config:', {
            databaseURL: config.databaseURL,
            projectId: config.projectId,
            apiKey: config.apiKey ? '***' : 'MISSING'
        });
    } catch (err) {
        console.error('❌ Firebase not initialized:', err.message);
    }
    
    // Generate QR code on load
    generateQRCode();
    
    // Regenerate QR code every 10 seconds to ensure it's always fresh
    setInterval(generateQRCode, 10000);
    
    // [1] Check if Firebase is available FIRST
    useFirebase = isFirebaseConfigured();
    console.log('🔍 DEBUG: useFirebase =', useFirebase);
    
    if (!useFirebase) {
        console.error('❌ Firebase not configured - TV Display requires Firebase');
        return;
    }
    
    console.log('🔥 Firebase configured, waiting for data...');
    
    // Fallback: If YouTube API doesn't load within 5 seconds, force ytReady
    setTimeout(() => {
        console.log('⏱️ [5s timeout check] ytReady =', ytReady);
        if (!ytReady) {
            console.warn('⚠️ YouTube API not responding, forcing ytReady=true after 5s');
            ytReady = true;
            createYouTubePlayer();
            checkBootupCompletion();
        }
    }, 5000);
    
    // Check boot-up completion every 500ms
    const bootupCheckInterval = setInterval(() => {
        if (checkBootupCompletion()) {
            clearInterval(bootupCheckInterval);
        }
    }, 500);
    
    // Now check connection status
    checkPhoneConnection();
    console.log('✅ Initial connection check done');
    
    // Check connection status every 1 second for faster updates
    setInterval(checkPhoneConnection, 1000);
    
    // Listen for TV disable status changes in real-time
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('tvControl/enabled').on('value', (snapshot) => {
                const isEnabled = snapshot.val() !== false;
                console.log('📺 TV Status Changed:', isEnabled ? 'ENABLED' : 'DISABLED');
                
                if (!isEnabled) {
                    console.warn('⚠️ TV Display has been DISABLED by admin');
                    showTVDisabledMessage();
                }
            });
        } catch (e) {
            console.warn('Error setting up TV status listener:', e.message);
        }
    }
    
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
}

/* ===== FIREBASE LISTENERS ===== */

function initializeFirebaseListeners() {
    console.log('🔥 [3/7] Attaching Firebase listeners');
    console.log('🔍 DEBUG: firebaseListenersSet =', firebaseListenersSet);
    
    if (firebaseListenersSet) {
        console.log('⚠️ Firebase listeners already initialized, skipping...');
        return;
    }
    
    firebaseListenersSet = true; // Mark as initialized
    const db = firebase.database();
    
    console.log('🔍 DEBUG: Firebase database object:', typeof db);

    db.ref('queue').on('value', snapshot => {
        const data = snapshot.val();
        console.log('🔍 DEBUG: Queue snapshot received:', {
            data: data,
            isEmpty: !data,
            isArray: Array.isArray(data),
            type: typeof data
        });
        
        // Mark Firebase as ready even if queue is empty
        firebaseReady = true;
        
        if (!data) {
            tvQueue = [];
            console.log('📡 Queue is empty (no songs yet)');
        } else {
            // Convert Firebase object to array (Firebase stores objects, not arrays)
            // Handle both array and object formats from Firebase
            if (Array.isArray(data)) {
                tvQueue = data;
            } else if (typeof data === 'object') {
                // Convert object with numeric keys to array
                tvQueue = Object.values(data);
            } else {
                tvQueue = [];
            }
            
            // Filter out any invalid entries
            tvQueue = tvQueue.filter(song => song && song.title && song.videoId && song.requestedBy);
            
            console.log('📡 Queue loaded from Firebase:', tvQueue.length, 'valid songs');
            console.log('📡 Queue details:', tvQueue.map(s => ({ title: s.title, requestedBy: s.requestedBy })));
            
            // Auto-play first song if no current song and queue has songs
            if (tvQueue.length > 0 && (!currentSong || !currentSong.videoId)) {
                console.log('▶️ Auto-playing first song in queue...');
                const firstSong = tvQueue[0];
                currentSong = {
                    title: firstSong.title,
                    artist: firstSong.artist,
                    videoId: firstSong.videoId,
                    requestedBy: firstSong.requestedBy,
                    singer: firstSong.requestedBy
                };
                // Update Firebase with current song
                firebase.database().ref('currentSong').set(currentSong);
                tryInitPlayback();
            }
        }
        
        // Always update display when queue changes
        console.log('📺 Updating TV display - Queue has', tvQueue.length, 'songs');
        displayQueue();
        updateNextSongDisplay();
        
        // Check if bootup can be hidden
        checkBootupCompletion();
    }, (error) => {
        console.error('❌ Firebase queue listener error:', error);
    });

    db.ref('currentSong').on('value', snap => {
        const data = snap.val();
        console.log('🔍 DEBUG: CurrentSong snapshot received:', data);
        
        if (!data || !data.videoId) {
            console.log('📻 No current song in Firebase');
            return;
        }

        console.log('🎬 Current song updated:', {
            title: data.title,
            artist: data.artist,
            videoId: data.videoId,
            requestedBy: data.requestedBy,
            timestamp: data.timestamp
        });

        currentSong = data;
        firebaseReady = true;
        
        // Update display immediately
        displayQueue();
        updateNextSongDisplay();
        
        // Check if bootup can be hidden
        checkBootupCompletion();

        // Try to initialize and play
        tryInitPlayback();
    }, (error) => {
        console.error('❌ Firebase currentSong listener error:', error);
    });

    // 🔥 Listen for control commands from singer page
    db.ref('control').on('value', snapshot => {
        const control = snapshot.val();
        if (!control || !control.command) return;
        
        console.log('📱 Control command received:', control.command);
        
        switch(control.command) {
            case 'togglePlay':
                if (window.tvPlayer && window.tvPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
                    window.tvPlayer.pauseVideo();
                    console.log('⏸ Paused via remote');
                } else if (window.tvPlayer) {
                    window.tvPlayer.playVideo();
                    console.log('▶️ Playing via remote');
                }
                break;
                
            case 'skip':
                console.log('⏭️ Skipping to next song via remote');
                playNextSong();
                break;
                
            case 'restart':
                if (window.tvPlayer && currentSong) {
                    window.tvPlayer.seekTo(0);
                    window.tvPlayer.playVideo();
                    console.log('🔄 Restarted via remote');
                }
                break;
                
            case 'toggleMute':
                if (window.tvPlayer) {
                    if (window.tvPlayer.isMuted()) {
                        window.tvPlayer.unMute();
                        console.log('🔊 Unmuted via remote');
                    } else {
                        window.tvPlayer.mute();
                        console.log('🔇 Muted via remote');
                    }
                }
                break;
                
            case 'setVolume':
                if (window.tvPlayer && typeof control.volume === 'number') {
                    const volumePercent = Math.max(0, Math.min(100, control.volume));
                    const volumeDecimal = volumePercent / 100;
                    window.tvPlayer.setVolume(volumeDecimal * 100); // YouTube uses 0-100 scale
                    console.log('🔊 Volume set to:', volumePercent + '%');
                }
                break;
        }
    }, (error) => {
        console.warn('⚠️ Firebase control listener error:', error);
    });

    // 🔥 Listen for activity updates
    db.ref('activity').on('value', snapshot => {
        const activityData = snapshot.val();
        if (!activityData) return;

        console.log('📱 Activity updated from Firebase:', activityData.timestamp);
    }, (error) => {
        console.warn('⚠️ Firebase activity listener error:', error);
    });
    
    console.log('✅ [3/7] Firebase listeners attached');
    
    // 🔥 Load initial data after listeners are attached
    console.log('📡 [3/7] Loading initial songs from Firebase...');
    db.ref('queue').once('value', snapshot => {
        const queueData = snapshot.val();
        console.log('🔍 DEBUG: Initial queue load:', queueData);
        if (queueData) {
            tvQueue = Array.isArray(queueData) ? queueData : Object.values(queueData);
            console.log('📡 Initial queue loaded:', tvQueue.length, 'songs');
        } else {
            tvQueue = [];
            console.log('📡 Initial queue: empty (no songs yet)');
        }
        firebaseReady = true;
        checkBootupCompletion();
        displayQueue();
    }).catch(err => {
        console.error('❌ Initial queue load failed:', err);
    });
    
    db.ref('currentSong').once('value', snapshot => {
        const songData = snapshot.val();
        console.log('🔍 DEBUG: Initial currentSong load:', songData);
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
    }).catch(err => {
        console.error('❌ Initial currentSong load failed:', err);
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
    console.log('✅ YouTube IFrame API Ready');
    console.log('🔍 DEBUG: videoPlayer element:', document.getElementById('videoPlayer'));
    ytReady = true;
    createYouTubePlayer();
}

// B. YouTube API - Initialize player when ready
function createYouTubePlayer() {
    console.log('✅ YouTube API Ready, initializing Firebase listeners');
    console.log('🔍 DEBUG: useFirebase =', useFirebase, 'firebaseListenersSet =', firebaseListenersSet);
    
    // Initialize Firebase listeners immediately after YouTube API is ready
    if (useFirebase && !firebaseListenersSet) {
        try {
            initializeFirebaseListeners();
        } catch (err) {
            console.error('❌ Error initializing Firebase listeners:', err);
        }
    } else {
        console.log('⚠️ Firebase listeners not initialized: useFirebase =', useFirebase, 'firebaseListenersSet =', firebaseListenersSet);
    }
    
    // Check if bootup splash should be hidden
    checkBootupCompletion();
}

// D. SINGLE ENTRY POINT (MOST IMPORTANT)
function tryInitPlayback() {
    if (!ytReady || !firebaseReady) {
        console.log(`⏳ Not ready yet: ytReady=${ytReady}, firebaseReady=${firebaseReady}`);
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
    // Boot-up video disabled - create player directly with karaoke song
    currentVideoId = song.videoId;

    if (!window.tvPlayer) {
        console.log('🎬 [FIRST LOAD] Creating player with karaoke song');

        window.tvPlayer = new YT.Player('videoPlayer', {
            videoId: song.videoId,
            playerVars: {
                autoplay: 1,
                controls: 0,
                enablejsapi: 1,
                modestbranding: 1,
                fs: 0
            },
            events: {
                onReady: (e) => {
                    console.log('🎬 Karaoke Player Ready');
                    playerReady = true;
                    checkBootupCompletion();
                    // Try to play with autoplay - if blocked by browser, will be caught in onError
                    try {
                        const playPromise = e.target.playVideo();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch(error => {
                                console.warn('⚠️ Autoplay prevented:', error);
                                // Mute and try again
                                e.target.mute();
                                e.target.playVideo();
                            });
                        }
                    } catch (err) {
                        console.warn('⚠️ Play error caught:', err);
                    }
                },
                onStateChange: onPlayerStateChange,
                onError: (e) => {
                    console.error('❌ Karaoke video error:', e.data);
                    // Error 150 = Video is restricted/blocked from embedding
                    if (e.data === 150) {
                        console.warn('⚠️ Video blocked (error 150) - skipping to next song');
                        showVideoUnavailableMessage();
                        setTimeout(() => {
                            playNextSong();
                        }, 3000);
                    }
                    // Error 101 = Owner does not allow embedding
                    else if (e.data === 101) {
                        console.warn('⚠️ Video blocked by owner (error 101) - skipping to next song');
                        showVideoUnavailableMessage();
                        setTimeout(() => {
                            playNextSong();
                        }, 3000);
                    }
                }
            }
        });

    } else {
        console.log('▶️ [REUSE] Loading video:', song.videoId);
        window.tvPlayer.loadVideoById({
            videoId: song.videoId,
            startSeconds: 0
        });
        // Ensure audio is unmuted for new videos
        try {
            if (window.tvPlayer.isMuted && window.tvPlayer.isMuted()) {
                window.tvPlayer.unMute();
            }
        } catch (err) {
            console.warn('⚠️ Unmute error:', err);
        }
    }

    console.log(`📺 Now playing: ${song.title}`);
}

// Check if phone/singer page is connected
let lastConnectionStatus = null;

function checkPhoneConnection() {
    try {
        // Check if activity was updated in the last 30 seconds
        firebase.database().ref('activity').once('value', snapshot => {
            const activity = snapshot.val();
            const lastActivity = activity?.timestamp || 0;
            const now = Date.now();
            const isConnected = (now - lastActivity) < 30000;
            
            if (isConnected) {
                // Phone connected
                console.log('✅ Phone connected');
            } else {
                // Phone disconnected (no activity for 30 seconds)
                console.log('❌ Phone disconnected');
            }
            
            // Show pop-up message on status change
            if (lastConnectionStatus !== isConnected) {
                lastConnectionStatus = isConnected;
                const message = isConnected ? '✅ Phone Connected!' : '❌ Phone Disconnected';
                showNotification(message);
            }
            
            console.log('📱 Phone connection status:', isConnected ? 'Connected' : 'Disconnected');
        }).catch(err => {
            console.warn('Firebase activity read failed:', err.message);
        });
    } catch (error) {
        console.error('❌ Error in checkPhoneConnection:', error.message);
    }
}

// Show temporary notification
function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
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
    
    // Initialize scoring for new song
    songStartTime = Date.now();
    hasSinging = false;
    currentSingerName = singer || 'Unknown Singer';
    songDurationMs = 0;
    
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
                try {
                    // Get video duration when ready
                    const duration = event.target.getDuration();
                    if (duration > 0) {
                        songDurationMs = duration * 1000;
                        console.log(`⏱️ Song duration: ${duration}s (${songDurationMs}ms)`);
                    }
                    
                    const playPromise = event.target.playVideo();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(error => {
                            console.warn('⚠️ Autoplay prevented:', error);
                            event.target.mute();
                            event.target.playVideo();
                        });
                    }
                } catch (err) {
                    console.warn('⚠️ Play error:', err);
                }
            },
            'onStateChange': onPlayerStateChange,
            'onError': function(event) {
                console.error('❌ YouTube player error:', event.data);
                if (event.data === 150 || event.data === 101) {
                    console.warn('⚠️ Video is blocked from embedding - skipping to next song');
                    showVideoUnavailableMessage();
                    setTimeout(() => {
                        playNextSong();
                    }, 3000);
                }
            }
        }
    });
}

/* ===== PLAYER STATE MANAGEMENT ===== */

// F. STATE HANDLER (VERIFIED SAFE)
function onPlayerStateChange(e) {
    const states = {
        [-1]: 'UNSTARTED',
        0: 'ENDED',
        1: 'PLAYING',
        2: 'PAUSED',
        3: 'BUFFERING'
    };

    console.log(`📊 Player state changed to: ${states[e.data]}`);

    if (e.data === YT.PlayerState.ENDED) {
        // Check if boot-up video just finished
        if (isPlayingBootUpVideo) {
            console.log('✅ Boot-up video ended - transitioning to karaoke song');
            isPlayingBootUpVideo = false;
            bootUpVideoPlayed = true;
            hideBootupSplash(); // Hide splash after boot-up video ends
            
            // Load the actual karaoke song
            if (currentSong && currentSong.videoId && currentSong.videoId !== bootUpVideoId) {
                console.log('📺 Auto-loading karaoke:', currentSong.title);
                window.tvPlayer.loadVideoById({
                    videoId: currentSong.videoId,
                    startSeconds: 0
                });
                currentVideoId = currentSong.videoId;
            } else {
                console.warn('⚠️ No karaoke song ready after boot-up video');
            }
        } else {
            // Regular song ended - play next
            showScore();
        }
    }
}

// Show score/results when video ends
function showScore() {
    console.log('✅ Video ended - calculating score');
    
    // Calculate score based on singing activity
    let score = 0;
    
    if (hasSinging) {
        // If someone sang, calculate score based on song duration
        // Score = (Duration in seconds) * 10 + bonus
        const songSeconds = Math.round(songDurationMs / 1000);
        const baseScore = songSeconds * 10;
        
        // Add bonus for completing the song (if they sang the whole thing)
        let bonus = 100;
        
        score = baseScore + bonus;
        
        // Cap score at 1000
        if (score > 1000) score = 1000;
        
        console.log(`🎤 ${currentSingerName} sang! Score: ${score} (Duration: ${songSeconds}s, Base: ${baseScore}, Bonus: ${bonus})`);
        
        // Display score modal
        displayScoreModal(currentSingerName, score, true);
    } else {
        // No singing detected - score is 0
        score = 0;
        console.log(`❌ No singing detected. Score: 0`);
        
        // Display zero score
        displayScoreModal(currentSingerName, score, false);
    }
    
    // Wait for score display before playing next song
    setTimeout(() => {
        playNextSong();
    }, 3000);
}

// Display score modal
function displayScoreModal(singerName, score, hasSung) {
    // Remove existing score modal if any
    const existingModal = document.getElementById('scoreModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create score modal
    const modal = document.createElement('div');
    modal.id = 'scoreModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        animation: fadeIn 0.4s ease;
        backdrop-filter: blur(2px);
    `;
    
    const scoreDisplay = document.createElement('div');
    scoreDisplay.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 30px;
        padding: 60px 80px;
        text-align: center;
        color: white;
        box-shadow: 0 20px 60px rgba(102, 126, 234, 0.5);
        animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        transform: scale(1);
    `;
    
    if (hasSung) {
        scoreDisplay.innerHTML = `
            <div style="font-size: 3.5rem; font-weight: 900; margin-bottom: 20px; animation: popIn 0.5s ease 0.1s both;">🎤</div>
            <div style="font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; animation: slideInDown 0.5s ease 0.2s both;">Maganda!</div>
            <div style="font-size: 1.8rem; margin-bottom: 30px; opacity: 0.95; animation: slideInDown 0.5s ease 0.3s both;">${singerName}</div>
            <div style="font-size: 4rem; font-weight: 900; color: #ffd700; text-shadow: 0 0 20px rgba(255, 215, 0, 0.5); animation: scaleUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both;">
                ${score}
            </div>
            <div style="font-size: 1.2rem; margin-top: 30px; opacity: 0.9; animation: slideInUp 0.5s ease 0.5s both;">POINTS</div>
        `;
    } else {
        scoreDisplay.innerHTML = `
            <div style="font-size: 3.5rem; font-weight: 900; margin-bottom: 20px; animation: popIn 0.5s ease 0.1s both;">🎙️</div>
            <div style="font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; animation: slideInDown 0.5s ease 0.2s both;">Song Completed</div>
            <div style="font-size: 1.8rem; margin-bottom: 30px; opacity: 0.95; animation: slideInDown 0.5s ease 0.3s both;">${singerName}</div>
            <div style="font-size: 4rem; font-weight: 900; color: #ff6b6b; animation: scaleUp 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.4s both;">
                ${score}
            </div>
            <div style="font-size: 1.2rem; margin-top: 30px; opacity: 0.9; animation: slideInUp 0.5s ease 0.5s both;">POINTS<br><span style="font-size: 0.9rem;">(No singing detected)</span></div>
        `;
    }
    
    modal.appendChild(scoreDisplay);
    document.body.appendChild(modal);
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes bounceIn {
            0% {
                transform: scale(0.3);
                opacity: 0;
            }
            50% {
                transform: scale(1.05);
            }
            70% {
                transform: scale(0.9);
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }
        @keyframes popIn {
            0% {
                transform: scale(0) rotate(-45deg);
                opacity: 0;
            }
            100% {
                transform: scale(1) rotate(0deg);
                opacity: 1;
            }
        }
        @keyframes slideInDown {
            from {
                transform: translateY(-30px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        @keyframes slideInUp {
            from {
                transform: translateY(30px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        @keyframes scaleUp {
            0% {
                transform: scale(0);
                opacity: 0;
            }
            50% {
                transform: scale(1.1);
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        modal.style.animation = 'fadeIn 0.4s ease reverse';
        setTimeout(() => {
            modal.remove();
        }, 400);
    }, 3000);
}

// Show video unavailable message
function showVideoUnavailableMessage() {
    // Remove existing message if any
    const existingMsg = document.getElementById('videoUnavailableMsg');
    if (existingMsg) {
        existingMsg.remove();
    }
    
    // Create message modal
    const modal = document.createElement('div');
    modal.id = 'videoUnavailableMsg';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        animation: fadeIn 0.4s ease;
        backdrop-filter: blur(2px);
    `;
    
    const msgDisplay = document.createElement('div');
    msgDisplay.style.cssText = `
        background: linear-gradient(135deg, #ff6b6b 0%, #dc3545 100%);
        border-radius: 30px;
        padding: 60px 80px;
        text-align: center;
        color: white;
        box-shadow: 0 20px 60px rgba(255, 107, 107, 0.5);
        animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    `;
    
    msgDisplay.innerHTML = `
        <div style="font-size: 3.5rem; font-weight: 900; margin-bottom: 20px; animation: popIn 0.5s ease 0.1s both;">⚠️</div>
        <div style="font-size: 2rem; font-weight: 700; margin-bottom: 15px; animation: slideInDown 0.5s ease 0.2s both;">Video Unavailable</div>
        <div style="font-size: 1.3rem; margin-bottom: 20px; opacity: 0.95; animation: slideInDown 0.5s ease 0.3s both;">Please select another song</div>
    `;
    
    modal.appendChild(msgDisplay);
    document.body.appendChild(modal);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        modal.style.animation = 'fadeIn 0.4s ease reverse';
        setTimeout(() => {
            modal.remove();
        }, 400);
    }, 3000);
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
            // Extract just the song name (remove artist if included)
            let songName = nextSong.title;
            if (songName.includes(' - ')) {
                songName = songName.split(' - ')[0].trim();
            }
            nextSongTitle.textContent = `📋 Queue (${tvQueue.length}): ${songName}`;
            nextSongArtist.textContent = `Reserved by: ${nextSong.requestedBy}`;
            console.log('📺 TV Display Queue Updated:', {
                count: tvQueue.length,
                currentSong: songName,
                reservedBy: nextSong.requestedBy,
                songs: tvQueue.map(s => ({ title: s.title, reservedBy: s.requestedBy }))
            });
        } else {
            nextSongTitle.textContent = 'No songs in queue';
            nextSongArtist.textContent = '-';
            console.log('📺 TV Display Queue: Empty');
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
    
    if (tvQueue && tvQueue.length > 0) {
        // If there's a current song and it matches the first in queue, show second song
        if (currentSong && currentSong.videoId === tvQueue[0].videoId) {
            nextSong = tvQueue.length > 1 ? tvQueue[1] : null;
        } else {
            // Otherwise show the first song in queue
            nextSong = tvQueue[0];
        }
    }
    
    if (nextSong) {
        // Extract just the song name (remove artist if included)
        let songName = nextSong.title;
        if (songName.includes(' - ')) {
            songName = songName.split(' - ')[0].trim();
        }
        nextSongTitle.textContent = songName;
        nextSongArtist.textContent = `Reserved by: ${nextSong.requestedBy}`;
        nextSongDisplay.style.display = 'flex';
    } else {
        // Show current song if queue is empty but currentSong exists
        if (currentSong && currentSong.title) {
            let songName = currentSong.title;
            if (songName.includes(' - ')) {
                songName = songName.split(' - ')[0].trim();
            }
            nextSongTitle.textContent = `▶️ Now Playing: ${songName}`;
            nextSongArtist.textContent = `by ${currentSong.singer || currentSong.requestedBy}`;
        } else {
            nextSongTitle.textContent = '🎤 Select a Song to Start';
            nextSongArtist.textContent = 'Scan the QR code to request a song';
        }
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
// ===== TV ENABLED/DISABLED CONTROL =====

// Check if TV display is enabled
function checkTVEnabled(callback) {
    if (typeof firebase === 'undefined' || !firebase.database) {
        console.log('⚠️ Firebase not available, defaulting to enabled');
        callback(true);
        return;
    }
    
    try {
        firebase.database().ref('tvControl/enabled').once('value', (snapshot) => {
            const isEnabled = snapshot.val() !== false; // Default to true if not set
            console.log('📺 TV Enabled Status from Firebase:', isEnabled);
            callback(isEnabled);
        }).catch(err => {
            console.error('❌ Firebase error checking TV status:', err.message);
            if (err.code === 'PERMISSION_DENIED') {
                console.error('Firebase Permission Denied - Update database rules to: { "rules": { ".read": true, ".write": true } }');
            }
            callback(true); // Default to enabled on error
        });
    } catch (e) {
        console.error('Firebase exception:', e.message);
        callback(true);
    }
}

// Show TV disabled message
function showTVDisabledMessage() {
    const splashScreen = document.getElementById('splashScreen');
    if (splashScreen) {
        splashScreen.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; color: white; text-align: center; background: linear-gradient(135deg, #1a0a2e 0%, #0f0f1e 100%); padding: 20px; box-sizing: border-box; font-family: Arial, sans-serif;">
                <div style="font-size: clamp(40px, 12vw, 100px); margin-bottom: clamp(15px, 5vw, 40px);">🔴</div>
                <h1 style="font-size: clamp(1.5rem, 8vw, 3.5rem); font-weight: 700; margin: 0 0 clamp(10px, 3vw, 25px) 0; letter-spacing: 2px;">TV DISPLAY</h1>
                <h2 style="font-size: clamp(1.2rem, 6vw, 2.5rem); font-weight: 500; margin: 0 0 clamp(8px, 2vw, 15px) 0; color: #ef4444;">DISABLED</h2>
                <p style="font-size: clamp(0.9rem, 3.5vw, 1.3rem); color: #999; margin: clamp(15px, 3vw, 30px) auto 0; max-width: 90%; line-height: 1.6;">
                    The TV display has been disabled by the admin.<br>
                    Please contact an administrator to enable it.
                </p>
                <div style="margin-top: clamp(25px, 5vw, 50px); font-size: clamp(0.75rem, 2.5vw, 1rem); color: #666; line-height: 1.8;">
                    <p style="margin: 0;">Admin can enable it from the dashboard</p>
                    <p style="margin: clamp(20px, 3vw, 40px) 0 0 0; font-size: clamp(0.7rem, 2vw, 0.9rem);">⏰ Please wait or refresh the page</p>
                </div>
            </div>
        `;
        splashScreen.style.display = 'flex';
    }
    
    // Also listen for TV to be re-enabled
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('tvControl/enabled').on('value', (snapshot) => {
                const isEnabled = snapshot.val() !== false;
                if (isEnabled) {
                    console.log('📺 TV has been re-enabled, reloading...');
                    setTimeout(() => {
                        location.reload();
                    }, 1000);
                }
            });
        } catch (e) {
            console.warn('Error setting up listener:', e.message);
        }
    }
}