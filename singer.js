// ===== SINGER LOGIC =====

// Search results storage
let searchResults = [];
let audioPlayer;
let allSongs = [];
let reservedSongs = [];

// Initialize singer page
document.addEventListener('DOMContentLoaded', function() {
    const searchForm = document.getElementById('searchForm');
    searchForm.addEventListener('submit', handleSearch);
    
    // Get audio player
    audioPlayer = document.getElementById('audioPlayer');
    
    // Load all songs for song book
    loadAllSongs();
    
    // Load reserved songs from localStorage
    loadReservedSongs();
    
    // Display song book
    displaySongBook();
    
    // Display reserved songs
    displayReservedSongs();
    
    // Update user display
    updateUserDisplay();
});

// Disconnect function
function disconnect() {
    if (confirm('Are you sure you want to disconnect?')) {
        window.location.href = 'index.html';
    }
}

// Handle search form submission
async function handleSearch(e) {
    e.preventDefault();
    
    const searchInput = document.getElementById('searchInput');
    const userNameInput = document.getElementById('userName');
    const searchQuery = searchInput.value.trim();

    if (!searchQuery) {
        alert('Please enter a song name');
        return;
    }

    // Disable button during search
    const searchBtn = document.querySelector('.search-btn');
    searchBtn.disabled = true;
    searchBtn.textContent = '⏳ Searching...';

    try {
        // Demo: Simulated search results
        // In a real app, this would call your backend API
        searchResults = await performSearch(searchQuery);
        
        displaySearchResults(searchResults, userNameInput.value);
    } catch (error) {
        console.error('Search error:', error);
        showAlert('Error searching for songs. Please try again.', 'danger');
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 Search';
    }
}

// YouTube API search function
async function performSearch(query) {
    // YouTube API Key
    const API_KEY = 'AIzaSyDHwTm9Fw80vVfpaZwuzBAUJF4ZNfi-SDk';
    const API_URL = 'https://www.googleapis.com/youtube/v3/search';

    try {
        const response = await fetch(
            `${API_URL}?part=snippet&q=${encodeURIComponent(query + ' karaoke')}&type=video&maxResults=10&key=${API_KEY}`
        );
        
        if (!response.ok) {
            throw new Error('YouTube API error');
        }

        const data = await response.json();
        
        return data.items.map(item => ({
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            videoId: item.id.videoId,
            thumbnail: item.snippet.thumbnails.default.url
        }));
    } catch (error) {
        console.error('YouTube API Error:', error);
        // Fallback to demo data if API fails
        return getFallbackSongs(query);
    }
}

// Fallback demo data if YouTube API is not configured
function getFallbackSongs(query) {
    const allSongs = [
        { title: "Bohemian Rhapsody - Karaoke", artist: "Queen", videoId: "fJ9rUzIMt7o" },
        { title: "Hallelujah - Karaoke", artist: "Leonard Cohen", videoId: "YAHxj0k0WL0" },
        { title: "Someone Like You - Karaoke", artist: "Adele", videoId: "hHUbLv4ThOk" },
        { title: "Perfect - Karaoke", artist: "Ed Sheeran", videoId: "2takcwFERG0" },
        { title: "Shape of You - Karaoke", artist: "Ed Sheeran", videoId: "JGwWNGJdvx8" },
        { title: "Rolling in the Deep - Karaoke", artist: "Adele", videoId: "rYEDA3JcQqw" },
        { title: "Imagine - Karaoke", artist: "John Lennon", videoId: "DVg2EJvvlF8" },
        { title: "Wonderwall - Karaoke", artist: "Oasis", videoId: "6hzrDeceEKc" },
        { title: "Piano Man - Karaoke", artist: "Billy Joel", videoId: "1vrEljMfXWc" },
        { title: "Don't Stop Believin' - Karaoke", artist: "Journey", videoId: "1k8craCGpgs" }
    ];

    return allSongs.filter(song => 
        song.title.toLowerCase().includes(query.toLowerCase()) ||
        song.artist.toLowerCase().includes(query.toLowerCase())
    );
}

// Display search results
function displaySearchResults(results, userName) {
    const container = document.getElementById('resultsContainer');

    if (results.length === 0) {
        const query = document.getElementById('searchInput').value;
        container.innerHTML = `
            <div class="alert alert-custom">
                ❌ No results found for "${query}"
            </div>
        `;
        return;
    }

    let html = `<h3 class="text-white mb-4" style="font-size: 1.3rem; font-weight: 600;">📌 Results (${results.length})</h3><div class="row">`;

    results.forEach((song, index) => {
        html += `
            <div class="col-12 mb-4">
                <div class="result-card text-white">
                    <h5 class="card-title mb-2" style="font-weight: 600; font-size: 1.1rem;">
                        ${song.title}
                    </h5>
                    <p class="mb-3" style="font-size: 0.9rem; opacity: 0.8;">
                        🎤 ${song.artist}
                    </p>
                    <button class="btn request-btn text-white" onclick="requestSong('${song.title}', '${song.artist}', '${song.videoId}', '${userName}', this)">
                        ✓ Request Song
                    </button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// Remote control to queue
function requestSong(title, artist, videoId, userName, btn) {
    if (!userName.trim()) {
        alert('Please enter your name first');
        return;
    }

    // Disable button during submission
    btn.disabled = true;
    btn.textContent = '⏳ Adding to Queue...';

    try {
        // In a real app, send to backend:
        // const response = await fetch('/api/queue', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ title, artist, videoId, requestedBy: userName })
        // });

        // Save to localStorage (shared with TV display)
        const queue = JSON.parse(localStorage.getItem('karaoke_queue') || '[]');
        const newSong = {
            id: Math.max(...queue.map(s => s.id || 0), 0) + 1,
            title,
            artist,
            videoId,
            requestedBy: userName
        };
        queue.push(newSong);
        localStorage.setItem('karaoke_queue', JSON.stringify(queue));

        // Add to reserved songs if not already there
        const songExists = reservedSongs.some(s => s.videoId === videoId);
        if (!songExists) {
            reservedSongs.push({ title, artist, videoId });
            // Also save to localStorage for persistence
            localStorage.setItem('karaoke_reserved_songs', JSON.stringify(reservedSongs));
            displayReservedSongs(); // Refresh reserved songs to show new song
        }

        console.log(`Song requested: ${title} by ${artist} from ${userName}`);
        
        // Simulate API response
        setTimeout(() => {
            showAlert(`✅ "${title}" added to queue!`, 'success');
            
            // Clear inputs
            document.getElementById('searchInput').value = '';
            document.getElementById('resultsContainer').innerHTML = '';
            
            btn.disabled = false;
            btn.textContent = '✓ Request Song';
        }, 500);

    } catch (error) {
        console.error('Error requesting song:', error);
        showAlert('Error adding song to queue', 'danger');
        btn.disabled = false;
        btn.textContent = '✓ Request Song';
    }
}

// Show alert messages
function showAlert(message, type = 'info') {
    const container = document.getElementById('resultsContainer');
    let alertClass = 'alert-custom';
    let alertStyle = '';

    if (type === 'success') {
        alertStyle = 'background: rgba(40, 167, 69, 0.1); border-color: rgba(40, 167, 69, 0.5); color: #28a745;';
    } else if (type === 'danger') {
        alertStyle = 'background: rgba(220, 53, 69, 0.1); border-color: rgba(220, 53, 69, 0.5); color: #dc3545;';
    }

    const alert = document.createElement('div');
    alert.className = `alert ${alertClass}`;
    alert.style.cssText = alertStyle;
    alert.innerHTML = message;
    alert.style.borderRadius = '15px';
    alert.style.padding = '1.5rem';
    alert.style.marginTop = '1rem';
    alert.style.border = '2px solid';
    alert.style.animation = 'slideUp 0.5s ease';

    // Clear existing alerts
    const existing = container.querySelector('.alert');
    if (existing) existing.remove();

    container.insertBefore(alert, container.firstChild);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        alert.style.opacity = '0';
        alert.style.transition = 'opacity 0.3s ease';
        setTimeout(() => alert.remove(), 300);
    }, 3000);
}

// ===== RESERVED SONGS MANAGEMENT =====

// Load reserved songs from localStorage
function loadReservedSongs() {
    const stored = localStorage.getItem('karaoke_reserved_songs');
    if (stored) {
        try {
            reservedSongs = JSON.parse(stored);
        } catch (e) {
            reservedSongs = [];
        }
    } else {
        reservedSongs = [];
    }
}

// Display reserved songs
function displayReservedSongs() {
    const container = document.getElementById('reservedSongs');
    if (!container) return;

    if (reservedSongs.length === 0) {
        container.innerHTML = '<div style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; min-height: 150px;"><p style="text-align: center; color: rgba(255,255,255,0.5); font-style: italic; font-size: clamp(0.95rem, 2vw, 1.05rem);">No reserved songs yet. Search and request songs to add them here!</p></div>';
        return;
    }

    let html = '';
    reservedSongs.forEach(song => {
        html += `
            <div class="song-item">
                <div class="song-item-title">${song.title}</div>
                <div class="song-item-artist">${song.artist}</div>
                <button class="song-item-btn" onclick="requestSongFromReserved('${song.title}', '${song.artist}', '${song.videoId}')">
                    ✓ Request
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Request song from reserved songs
function requestSongFromReserved(title, artist, videoId) {
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('Please enter your name first');
        document.getElementById('userName').focus();
        return;
    }

    requestSong(title, artist, videoId, userName, event.target);
}

// ===== AUDIO PLAYER CONTROLS =====

// Load all songs for song book
function loadAllSongs() {
    allSongs = [
        { title: "Bohemian Rhapsody - Karaoke", artist: "Queen", videoId: "fJ9rUzIMt7o" },
        { title: "Hallelujah - Karaoke", artist: "Leonard Cohen", videoId: "YAHxj0k0WL0" },
        { title: "Someone Like You - Karaoke", artist: "Adele", videoId: "hHUbLv4ThOk" },
        { title: "Perfect - Karaoke", artist: "Ed Sheeran", videoId: "2takcwFERG0" },
        { title: "Shape of You - Karaoke", artist: "Ed Sheeran", videoId: "JGwWNGJdvx8" },
        { title: "Rolling in the Deep - Karaoke", artist: "Adele", videoId: "rYEDA3JcQqw" },
        { title: "Imagine - Karaoke", artist: "John Lennon", videoId: "DVg2EJvvlF8" },
        { title: "Wonderwall - Karaoke", artist: "Oasis", videoId: "6hzrDeceEKc" },
        { title: "Piano Man - Karaoke", artist: "Billy Joel", videoId: "1vrEljMfXWc" },
        { title: "Don't Stop Believin' - Karaoke", artist: "Journey", videoId: "1k8craCGpgs" },
        { title: "Yesterday - Karaoke", artist: "The Beatles", videoId: "F_VJJjcK-5A" },
        { title: "Hey Jude - Karaoke", artist: "The Beatles", videoId: "rLzIIzjqrand" }
    ];
}

// Display song book
function displaySongBook() {
    const songBook = document.getElementById('songBook');
    if (!songBook) return;

    let html = '';
    allSongs.forEach(song => {
        html += `
            <div class="song-item">
                <div class="song-item-title">${song.title}</div>
                <div class="song-item-artist">${song.artist}</div>
                <button class="song-item-btn" onclick="requestSongFromBook('${song.title}', '${song.artist}')">
                    ✓ Request
                </button>
            </div>
        `;
    });

    songBook.innerHTML = html;
}

// Request song from song book
function requestSongFromBook(title, artist) {
    const userName = document.getElementById('userName').value.trim();
    if (!userName) {
        alert('Please enter your name first');
        document.getElementById('userName').focus();
        return;
    }

    // Find the song and get videoId
    const song = allSongs.find(s => s.title === title && s.artist === artist);
    if (song) {
        requestSong(title, artist, song.videoId, userName, event.target);
    }
}

// Update user display name
function updateUserDisplay() {
    const userName = document.getElementById('userName').value.trim() || 'Guest';
    document.getElementById('userDisplayName').textContent = `Welcome, ${userName}`;
}

// Reload player
function reloadPlayer() {
    if (audioPlayer) {
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(e => console.log('Play failed:', e));
    }
}

// Toggle play/pause
function togglePlayPause() {
    const btn = document.getElementById('playPauseBtn');
    if (!audioPlayer.src) {
        alert('No song loaded. Please search for a song first.');
        return;
    }

    if (audioPlayer.paused) {
        audioPlayer.play().catch(e => console.log('Play failed:', e));
        btn.textContent = '⏸';
        btn.classList.remove('pause');
        btn.classList.add('play');
    } else {
        audioPlayer.pause();
        btn.textContent = '▶';
        btn.classList.remove('play');
        btn.classList.add('pause');
    }
}

// Stop player
function stopPlayer() {
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        document.getElementById('playPauseBtn').textContent = '▶ Play';
    }
}

// Toggle mute
function toggleMute() {
    const btn = document.getElementById('muteBtn');
    if (audioPlayer) {
        audioPlayer.muted = !audioPlayer.muted;
        btn.textContent = audioPlayer.muted ? '🔇 Unmute' : '🔊 Mute';
    }
}
