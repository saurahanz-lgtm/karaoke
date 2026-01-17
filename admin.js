// ===== ADMIN USER MANAGEMENT LOGIC =====

// Initialize device session ID from sessionStorage on page load
function initializeDeviceSessionId() {
    let sessionId = sessionStorage.getItem('deviceSessionId');
    if (sessionId) {
        window.deviceSessionId = sessionId;
        console.log('🔄 Device session ID initialized from sessionStorage');
    } else {
        console.warn('⚠️ No device session ID found in sessionStorage');
        // If not found, redirect to login
        setTimeout(() => {
            if (!window.deviceSessionId) {
                console.log('❌ Redirecting to login - no session ID');
                window.location.href = 'index.html';
            }
        }, 1000);
    }
}

// Call immediately on page load, before DOMContentLoaded
initializeDeviceSessionId();

// Users data storage
let users = [];
let currentEditingUserId = null;
let loggedInUser = null;
let currentFilter = 'total'; // Default filter is all users

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    checkAuthentication();
    
    // Load users from localStorage
    loadUsers();
    
    // Add event listeners
    document.getElementById('addUserForm').addEventListener('submit', handleAddUser);
    
    // Display initial users
    displayUsers();
    updateStats();
    
    // Sync users to Firebase immediately on load
    syncUsersToFirebase();
    
    // Update admin activity every 30 seconds to keep them as Online
    setInterval(updateAdminActivity, 30000);
    
    // Validate admin session every 10 seconds to detect if logged in elsewhere
    setInterval(validateAdminSession, 10000);
    
    // Sync users to Firebase every 60 seconds to keep data fresh
    setInterval(syncUsersToFirebase, 60000);
    
    // Full Firebase sync every 30 seconds to ensure data consistency
    setInterval(fullFirebaseSync, 30000);
    
    // Also track clicks and key presses to update activity
    document.addEventListener('click', updateAdminActivity);
    document.addEventListener('keypress', updateAdminActivity);
    
    // Set up broadcast channel to get immediate updates when users log in/out
    try {
        const userUpdateChannel = new BroadcastChannel('karaoke_user_updates');
        userUpdateChannel.addEventListener('message', (event) => {
            if (event.data.type === 'user_login' || event.data.type === 'user_logout') {
                console.log('📢 User update received:', event.data.type);
                // Reload users from Firebase immediately
                loadUsers();
            }
        });
    } catch (error) {
        console.warn('BroadcastChannel not supported:', error.message);
    }
    
    // Load TV display status on page load
    loadTVDisplayStatus();
});

// Validate that the current session is still active (not logged in elsewhere)
function validateSessionValidity() {
    const stored = localStorage.getItem('karaoke_logged_in_user');
    if (!stored) {
        // User data was cleared (logged in from another device)
        alert('Your session has been disconnected. You were logged in from another device.');
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

// Check authentication
function checkAuthentication() {
    const stored = localStorage.getItem('karaoke_logged_in_user');
    if (stored) {
        loggedInUser = JSON.parse(stored);
        // Show logged in user info
        const userInfoEl = document.getElementById('loggedInUser');
        if (userInfoEl) {
            userInfoEl.textContent = `Logged in as: ${loggedInUser.username} (${loggedInUser.role})`;
        }
        
        // Validate session immediately
        validateAdminSession();
        
        // Update admin user's lastActivity to show as Online
        updateAdminActivity();
    } else {
        // Not logged in, redirect to home
        alert('Please login first');
        window.location.href = 'index.html';
    }
}

// Validate Firebase session match for admin
function validateAdminSession() {
    const username = loggedInUser?.username;
    let deviceSessionId = window.deviceSessionId;
    
    // If not in memory, try to get from sessionStorage
    if (!deviceSessionId) {
        deviceSessionId = sessionStorage.getItem('deviceSessionId');
        if (deviceSessionId) {
            window.deviceSessionId = deviceSessionId;
            console.log('🔄 Retrieved device session ID from sessionStorage');
        }
    }
    
    if (!username) {
        console.warn('❌ No username in loggedInUser');
        return;
    }
    
    if (!deviceSessionId) {
        console.warn('❌ No device session ID in memory or sessionStorage');
        return;
    }
    
    console.log('🔍 Validating admin session...');
    
    // Check Firebase to see if logged in admin matches current device
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('activeLogin/' + username).once('value', (snapshot) => {
                const data = snapshot.val();
                
                if (!data || !data.sessionId) {
                    console.warn('❌ No active admin session found in Firebase');
                    // Session was cleared, logout
                    alert('Your session has been disconnected.');
                    window.location.href = 'index.html';
                    return;
                }
                
                if (data.sessionId !== deviceSessionId) {
                    console.warn('❌ Admin session mismatch! Logged in from another device.');
                    alert('Your session has been disconnected. You were logged in from another device.');
                    window.location.href = 'index.html';
                    return;
                }
                
                console.log('✅ Admin session validated successfully');
            }).catch(err => {
                console.warn('Firebase admin validation error:', err.message);
            });
        } catch (e) {
            console.warn('Firebase validation exception:', e.message);
        }
    }
}

// Update the logged-in admin user's activity
function updateAdminActivity() {
    if (!loggedInUser) return;
    
    const now = Date.now();
    
    // Update ONLY the logged-in user in the local users array (don't overwrite others)
    // Try to find by id first, then by username as fallback
    let userIndex = users.findIndex(u => u.id === loggedInUser.id);
    if (userIndex === -1) {
        // Fallback: search by username
        userIndex = users.findIndex(u => u.username === loggedInUser.username);
    }
    
    if (userIndex !== -1) {
        // User found, update their lastActivity
        const updatedUsers = [...users];
        updatedUsers[userIndex] = {
            ...updatedUsers[userIndex],
            lastActivity: now
        };
        users = updatedUsers;
        loggedInUser.lastActivity = now;  // Update logged-in user reference
        
        // Update in Firebase (users stored as array)
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                // Save entire users array to Firebase with updated activity
                firebase.database().ref('users').set(users).catch(err => console.warn('Firebase admin activity update failed:', err.message));
            } catch (error) {
                console.warn('Error updating admin activity:', error.message);
            }
        }
    } else {
        // User not found in users array, add them to the list if they're an admin
        if (loggedInUser.role === 'admin') {
            const newAdminUser = {
                id: loggedInUser.id || (Math.max(...users.map(u => u.id || 0), 0) + 1),
                username: loggedInUser.username,
                password: loggedInUser.password || '',
                role: 'admin',
                joined: loggedInUser.joined || new Date().toISOString().split('T')[0],
                lastActivity: now,
                disabled: false
            };
            
            users.push(newAdminUser);
            loggedInUser.lastActivity = now;
            
            // Update in Firebase
            if (typeof firebase !== 'undefined' && firebase.database) {
                try {
                    firebase.database().ref('users').set(users).catch(err => console.warn('Firebase admin activity update failed:', err.message));
                } catch (error) {
                    console.warn('Error adding admin to users list:', error.message);
                }
            }
            
            console.log('✅ Admin user added to singers list:', loggedInUser.username);
        }
    }
    
    // Also update the session timestamp to prevent it from being marked as stale
    if (typeof firebase !== 'undefined' && firebase.database && loggedInUser) {
        try {
            firebase.database().ref('activeLogin/' + loggedInUser.username).update({
                timestamp: now
            }).catch(err => console.warn('Firebase session timestamp update failed:', err.message));
        } catch (error) {
            console.warn('Error updating session timestamp:', error.message);
        }
    }
    
    console.log('👨‍💼 Admin activity updated:', new Date().toLocaleTimeString());
}

// Handle password change


// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        const username = loggedInUser?.username;
        
        // Broadcast logout event to all tabs
        try {
            const userUpdateChannel = new BroadcastChannel('karaoke_user_updates');
            userUpdateChannel.postMessage({
                type: 'user_logout',
                username: username,
                timestamp: Date.now()
            });
        } catch (error) {
            console.warn('BroadcastChannel not supported:', error.message);
        }
        
        // Clear from Firebase first
        if (username && typeof firebase !== 'undefined' && firebase.database) {
            try {
                // 1. Mark user as Offline in users array (set lastActivity to 0)
                firebase.database().ref('users').once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        users = Array.isArray(data) ? data : Object.values(data);
                        const userIndex = users.findIndex(u => u.username === username);
                        if (userIndex !== -1) {
                            users[userIndex].lastActivity = 0;
                            firebase.database().ref('users').set(users).catch(err => console.warn('Failed to mark offline:', err.message));
                        }
                    }
                });
                
                // 2. Clear from Firebase activeLogin
                firebase.database().ref('activeLogin/' + username).remove()
                    .then(() => console.log('✅ Admin session cleared from Firebase'))
                    .catch(err => console.warn('⚠️ Firebase logout failed:', err.message));
            } catch (e) {
                console.warn('⚠️ Firebase error:', e.message);
            }
        }
        
        // Clear from memory and storage
        loggedInUser = null;
        window.deviceSessionId = null;
        sessionStorage.removeItem('deviceSessionId');
        localStorage.removeItem('karaoke_logged_in_user');
        
        console.log('✅ Admin logout complete');
        window.location.href = 'index.html';
    }
}

// Load users from Firebase/localStorage
function loadUsers() {
    // First, always load from localStorage immediately
    loadFromLocalStorage();
    console.log('📂 Initial load from localStorage: ', users.length, 'users');
    
    // Display immediately with localStorage data (ensures users see data right away)
    displayUsers();
    updateStats();
    
    // Then try to sync from Firebase if available (update in background)
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data && Object.keys(data).length > 0) {
                    // Handle both array and object formats from Firebase
                    let firebaseUsers = Array.isArray(data) ? data : Object.values(data);
                    // Filter out invalid entries (must have username)
                    firebaseUsers = firebaseUsers.filter(u => u && u.username);
                    // Ensure all users have correct lastActivity format (default to 0 if missing)
                    firebaseUsers = firebaseUsers.map(u => ({
                        ...u,
                        lastActivity: (u.lastActivity === undefined || u.lastActivity === null) ? 0 : u.lastActivity
                    }));
                    
                    console.log('📡 Firebase loaded:', firebaseUsers.length, 'users');
                    
                    // SMART MERGE: Keep the version with more users (newer data)
                    if (firebaseUsers.length > users.length) {
                        console.log('✅ Firebase has newer data (', firebaseUsers.length, '>', users.length, ') - syncing to local');
                        users = firebaseUsers;
                        localStorage.setItem('karaoke_users', JSON.stringify(users));
                        displayUsers();
                        updateStats();
                    } else if (firebaseUsers.length < users.length) {
                        console.log('✅ localStorage has newer data (', users.length, '>', firebaseUsers.length, ') - syncing to Firebase');
                        // localStorage has newer data, sync it back to Firebase
                        usersRef.set(users).catch(err => console.warn('Re-sync to Firebase failed:', err.message));
                    } else {
                        console.log('✅ Both sources in sync -', users.length, 'users');
                    }
                } else {
                    console.log('ℹ️ Firebase is empty - keeping localStorage version');
                }
            }).catch((error) => {
                console.warn('Firebase read error (keeping localStorage):', error.message);
            });
        } catch (error) {
            console.warn('Firebase not configured, using localStorage:', error.message);
        }
    } else {
        console.log('ℹ️ Firebase not available, using localStorage only');
    }
    
    // Set up real-time listener ONLY for real-time updates from other admin windows (with safety checks)
    setTimeout(() => {
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                const usersRef = firebase.database().ref('users');
                usersRef.on('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data && Object.keys(data).length > 0) {
                        let firebaseUsers = Array.isArray(data) ? data : Object.values(data);
                        firebaseUsers = firebaseUsers.filter(u => u && u.username);
                        firebaseUsers = firebaseUsers.map(u => ({
                            ...u,
                            lastActivity: (u.lastActivity === undefined || u.lastActivity === null) ? 0 : u.lastActivity
                        }));
                        
                        // SAFETY: Only update if Firebase has MORE users (newer data from another admin)
                        // Don't overwrite if we have more users locally (we just added one)
                        if (firebaseUsers.length > users.length) {
                            console.log('🔄 Real-time update: Firebase has', firebaseUsers.length, 'vs local', users.length);
                            users = firebaseUsers;
                            localStorage.setItem('karaoke_users', JSON.stringify(users));
                            displayUsers();
                            updateStats();
                        }
                    }
                });
            } catch (error) {
                console.warn('Firebase real-time listener setup failed:', error.message);
            }
        }
    }, 1000); // Increased delay to ensure new user is fully saved
    
    // Set up activity tracking - refresh every 2 seconds to show real-time status
    let lastDisplayHash = '';
    setInterval(() => {
        // First try Firebase, then fallback to localStorage
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                firebase.database().ref('users').once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data && Object.keys(data).length > 0) {
                        let fetchedUsers = Array.isArray(data) ? data : Object.values(data);
                        // Filter out invalid entries (ensure all have username)
                        fetchedUsers = fetchedUsers.filter(u => u && u.username);
                        // Ensure all have correct lastActivity format
                        fetchedUsers = fetchedUsers.map(u => ({
                            ...u,
                            lastActivity: (u.lastActivity === undefined || u.lastActivity === null) ? 0 : u.lastActivity
                        }));
                        
                        // Check if data changed to avoid unnecessary re-renders
                        const currentHash = JSON.stringify(fetchedUsers);
                        if (currentHash !== lastDisplayHash) {
                            users = fetchedUsers;
                            lastDisplayHash = currentHash;
                            // Always sync to localStorage
                            localStorage.setItem('karaoke_users', JSON.stringify(users));
                            displayUsers();
                            updateStats();
                            console.log('📊 Activity display updated from Firebase - ' + users.length + ' users');
                        }
                    }
                }).catch(err => {
                    // If Firebase fails, sync from localStorage
                    const stored = localStorage.getItem('karaoke_users');
                    if (stored) {
                        let localUsers = JSON.parse(stored);
                        const currentHash = JSON.stringify(localUsers);
                        if (currentHash !== lastDisplayHash) {
                            users = localUsers;
                            lastDisplayHash = currentHash;
                            displayUsers();
                            updateStats();
                            console.log('📊 Activity display updated from localStorage - ' + users.length + ' users');
                        }
                    }
                });
            } catch (error) {
                console.warn('Activity tracking Firebase error:', error.message);
            }
        } else {
            // Firebase not available, just use localStorage
            const stored = localStorage.getItem('karaoke_users');
            if (stored) {
                let localUsers = JSON.parse(stored);
                const currentHash = JSON.stringify(localUsers);
                if (currentHash !== lastDisplayHash) {
                    users = localUsers;
                    lastDisplayHash = currentHash;
                    displayUsers();
                    updateStats();
                    console.log('📊 Activity display updated from localStorage only - ' + users.length + ' users');
                }
            }
        }
    }, 2000);
}

// Load from localStorage fallback
function loadFromLocalStorage() {
    const stored = localStorage.getItem('karaoke_users');
    console.log('📂 Loading from localStorage. Data exists:', !!stored);
    
    if (stored && stored.length > 0) {
        try {
            let parsedUsers = JSON.parse(stored);
            console.log('✅ Parsed users from localStorage:', parsedUsers.length, 'users');
            
            if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
                // Validate and normalize each user
                users = parsedUsers.map((u, idx) => ({
                    id: u.id || (idx + 1),
                    username: u.username || `user_${idx}`,
                    password: u.password || 'temp123',
                    role: u.role || 'user',
                    joined: u.joined || new Date().toISOString().split('T')[0],
                    lastActivity: (u.lastActivity === undefined || u.lastActivity === null) ? 0 : u.lastActivity,
                    disabled: u.disabled === true ? true : false
                }));
                console.log('✅ Users loaded from localStorage - Total:', users.length);
                return; // Successfully loaded
            }
        } catch (error) {
            console.error('❌ Error parsing localStorage data:', error.message);
            console.log('📝 Raw localStorage content:', stored.substring(0, 100) + '...');
        }
    }
    
    // Fallback to demo data if localStorage is empty or invalid
    console.log('⚠️ localStorage empty or invalid. Using demo data.');
    users = [
        { id: 1, username: "john_doe", password: "pass123", role: "admin", joined: "2024-01-01", lastActivity: 0, disabled: false },
        { id: 2, username: "maria_santos", password: "pass123", role: "admin", joined: "2024-01-02", lastActivity: 0, disabled: false },
        { id: 3, username: "sarah_johnson", password: "pass123", role: "admin", joined: "2024-01-03", lastActivity: 0, disabled: false },
        { id: 4, username: "admin_user", password: "admin123", role: "admin", joined: "2024-01-01", lastActivity: 0, disabled: false }
    ];
    saveUsers(); // Save demo data
}

// Save users to Firebase/localStorage
function saveUsers() {
    // CRITICAL: Always save to localStorage first (this is the reliable backup)
    try {
        const usersJson = JSON.stringify(users);
        localStorage.setItem('karaoke_users', usersJson);
        console.log('✅ Users SAVED to localStorage:', users.length, 'users');
        console.log('📦 localStorage data:', usersJson.substring(0, 100) + '...');
    } catch (error) {
        console.error('❌ CRITICAL: Failed to save to localStorage:', error.message);
        showNotification('⚠️ Warning: Could not save to browser storage', 'warning');
        return; // Don't proceed if localStorage fails
    }
    
    // Then WAIT for Firebase save to complete (critical for persistence)
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            // Save as array directly to Firebase
            usersRef.set(users)
                .then(() => {
                    console.log('✅ CONFIRMED: Users synced to Firebase successfully');
                    console.log('📊 Firebase now has', users.length, 'users');
                    
                    // Verify write was successful by reading back immediately
                    usersRef.once('value', (snapshot) => {
                        const fbData = snapshot.val();
                        const fbUsers = Array.isArray(fbData) ? fbData : Object.values(fbData || {});
                        console.log('✅ Firebase verification: Read back', fbUsers.length, 'users');
                        if (fbUsers.length !== users.length) {
                            console.warn('⚠️ Verification warning: Count mismatch - local:', users.length, 'Firebase:', fbUsers.length);
                        }
                    }).catch(err => {
                        console.warn('Verification read error:', err.message);
                    });
                    
                    // Broadcast change to all tabs/windows
                    broadcastUserUpdate();
                })
                .catch((error) => {
                    console.error('❌ Firebase save FAILED:', error.message);
                    console.error('Error code:', error.code);
                    showNotification('⚠️ Firebase sync failed (data saved locally)', 'warning');
                    // Still broadcast even if Firebase fails
                    broadcastUserUpdate();
                });
        } catch (error) {
            console.error('❌ Firebase exception:', error.message);
            console.warn('⚠️ Firebase not available, using localStorage only');
            broadcastUserUpdate();
        }
    } else {
        console.log('ℹ️ Firebase not available, using localStorage only');
        broadcastUserUpdate();
    }
}

// Broadcast user update to all tabs/windows and pages
function broadcastUserUpdate() {
    // Dispatch custom event to notify other pages of user database changes
    window.dispatchEvent(new CustomEvent('karaoke-users-updated', { 
        detail: { users, timestamp: new Date().getTime() }
    }));
    
    console.log('📊 User database updated and broadcasted');
}

// Sync users to Firebase - keeps data fresh and prevents stale data errors
function syncUsersToFirebase() {
    if (!users || users.length === 0) {
        console.log('⏭️ No users to sync');
        return;
    }
    
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.set(users).then(() => {
                console.log('✅ Users synced to Firebase (' + users.length + ' users)');
                
                // Verify write was successful by reading back
                usersRef.once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        const writtenUsers = Array.isArray(data) ? data : Object.values(data);
                        if (writtenUsers.length === users.length) {
                            console.log('✅ Firebase write verification passed');
                        } else {
                            console.warn('⚠️ Write verification failed - user count mismatch');
                        }
                    }
                });
            }).catch((error) => {
                console.warn('⚠️ Firebase sync error:', error.message);
                // Retry once on error
                setTimeout(() => {
                    usersRef.set(users).catch(err => console.warn('Firebase sync retry failed:', err.message));
                }, 1000);
            });
        } catch (error) {
            console.warn('⚠️ Firebase sync exception:', error.message);
        }
    } else {
        console.log('⏭️ Firebase not available for sync');
    }
}

// Full Firebase sync - reads from Firebase and ensures data consistency
function fullFirebaseSync() {
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.once('value', (snapshot) => {
                const data = snapshot.val();
                let firebaseUsers = [];
                
                if (data) {
                    firebaseUsers = Array.isArray(data) ? data : Object.values(data);
                    firebaseUsers = firebaseUsers.filter(u => u && u.username);
                    firebaseUsers = firebaseUsers.map(u => ({
                        ...u,
                        lastActivity: (u.lastActivity === undefined || u.lastActivity === null) ? 0 : u.lastActivity
                    }));
                }
                
                // Check if data differs from local state
                if (JSON.stringify(firebaseUsers) !== JSON.stringify(users)) {
                    console.log('🔄 Data mismatch detected - syncing from Firebase:', firebaseUsers.length, 'users');
                    users = firebaseUsers;
                    displayUsers();
                    updateStats();
                } else {
                    console.log('✅ Firebase data is in sync');
                }
                
                // Always write back to ensure Firebase is updated
                if (users.length > 0) {
                    usersRef.set(users).catch(err => console.warn('Firebase write failed:', err.message));
                }
            }).catch(err => console.warn('Full sync read error:', err.message));
        } catch (error) {
            console.warn('Full sync exception:', error.message);
        }
    }
}

// Reload users from Firebase to ensure we have latest data
function reloadUsersFromFirebase(callback) {
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    users = Array.isArray(data) ? data : Object.values(data);
                    console.log('✅ Users reloaded from Firebase before operation:', users);
                } else {
                    loadFromLocalStorage();
                }
                if (callback) callback();
            }).catch((error) => {
                console.warn('Firebase error, using localStorage:', error.message);
                loadFromLocalStorage();
                if (callback) callback();
            });
        } catch (error) {
            console.warn('Firebase error:', error.message);
            loadFromLocalStorage();
            if (callback) callback();
        }
    } else {
        loadFromLocalStorage();
        if (callback) callback();
    }
}

// Continue with adding user after reloading from Firebase
function continueAddUser(username, password, role) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        showNotification(passwordValidation.message, 'warning');
        return;
    }
    
    // Check if user already exists
    if (users.some(u => u.username === username)) {
        showNotification('❌ Username already exists! Use a different name.', 'danger');
        return;
    }
    
    // Create new user
    const newUser = {
        id: Math.max(...users.map(u => u.id || 0), 0) + 1,
        username,
        password,
        role,
        joined: new Date().toISOString().split('T')[0],
        lastActivity: 0,  // User starts as Offline until they log in
        disabled: false   // New users are enabled by default
    };
    
    console.log('➕ Adding new user:', newUser);
    users.push(newUser);
    console.log('📋 Total users after add:', users.length);
    
    // CRITICAL: Save immediately
    saveUsers();
    
    // VERIFY: Check if data was saved to localStorage
    const verification = localStorage.getItem('karaoke_users');
    if (verification) {
        const verifyData = JSON.parse(verification);
        console.log('✅ Verification: localStorage now has', verifyData.length, 'users');
        const userExists = verifyData.some(u => u.username === username);
        if (!userExists) {
            console.error('❌ VERIFICATION FAILED: New user not found in localStorage!');
        } else {
            console.log('✅ New user successfully verified in localStorage');
        }
    } else {
        console.error('❌ CRITICAL: localStorage is empty after save!');
    }
    
    // Reset form
    document.getElementById('addUserForm').reset();
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
    if (modal) {
        modal.hide();
    }
    
    showNotification(`✅ User "${username}" added successfully!`, 'success');
    displayUsers();
    updateStats();
}

// Validate password strength
function validatePassword(password) {
    if (password.length < 6) {
        return { valid: false, message: 'Password must be at least 6 characters' };
    }
    return { valid: true, message: 'Password is strong' };
}

// Handle add user form submission
function handleAddUser(e) {
    e.preventDefault();
    
    const username = document.getElementById('userName').value.trim();
    const password = document.getElementById('userPassword').value.trim();
    const role = document.getElementById('userRole').value;
    
    if (!username || !password || !role) {
        showNotification('Please fill in all fields', 'warning');
        return;
    }
    
    // Add user directly without Firebase reload (to avoid stale data)
    continueAddUser(username, password, role);
}

// Display users in table
function displayUsers() {
    const tbody = document.getElementById('usersTableBody');
    const emptyMessage = document.getElementById('emptyMessage');
    
    // Filter users based on current filter and validity
    let filteredUsers = users.filter(u => u && u.username);  // Ensure valid users only
    if (currentFilter === 'online') {
        filteredUsers = filteredUsers.filter(u => isUserOnline(u));
    } else if (currentFilter === 'offline') {
        filteredUsers = filteredUsers.filter(u => !isUserOnline(u));
    }
    
    if (filteredUsers.length === 0) {
        tbody.innerHTML = '';
        emptyMessage.style.display = 'block';
        emptyMessage.innerHTML = `<p style="font-size: clamp(1rem, 2.5vw, 1.2rem); color: #999; opacity: 0.7;">No ${currentFilter === 'online' ? 'online' : currentFilter === 'offline' ? 'offline' : ''} singers found...</p>`;
        return;
    }
    
    emptyMessage.style.display = 'none';
    
    let html = '';
    filteredUsers.forEach((user, index) => {
        const isOnline = isUserOnline(user);
        const statusColor = isOnline ? '#28a745' : '#6c757d';
        const statusLabel = isOnline ? '🟢 Online' : '⚫ Offline';
        // Handle both number and string formats for lastActivity
        const lastActivityNum = typeof user.lastActivity === 'string' ? parseInt(user.lastActivity) : user.lastActivity;
        const lastActivityText = lastActivityNum && lastActivityNum > 0 ? new Date(lastActivityNum).toLocaleTimeString() : 'Never';
        const isDisabled = user.disabled || false;
        const disabledBadge = isDisabled ? '<span style="background: #dc3545; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-left: 8px;">🔒 DISABLED</span>' : '';
        
        html += `
            <tr style="border-bottom: 1px solid rgba(102, 126, 234, 0.2); opacity: ${isDisabled ? '0.6' : '1'};">
                <td style="padding: 1.2rem;">${index + 1}</td>
                <td style="padding: 1.2rem;">
                    <strong>${user.username}</strong>
                    ${disabledBadge}
                </td>
                <td style="padding: 1.2rem;">
                    <span style="background: ${statusColor}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">
                        ${statusLabel}
                    </span>
                </td>
                <td style="padding: 1.2rem;">
                    <small style="opacity: 0.8;">Last: ${lastActivityText}</small>
                </td>
                <td style="padding: 1.2rem;">${user.joined}</td>
                <td style="padding: 1.2rem;">
                    <button class="btn btn-sm btn-warning" onclick="openChangePasswordModal(${user.id}, '${user.username}')" style="margin-right: 5px;">
                        🔐 Pass
                    </button>
                    <button class="btn btn-sm ${isDisabled ? 'btn-success' : 'btn-secondary'}" onclick="toggleUserDisabled(${user.id})" style="margin-right: 5px;">
                        ${isDisabled ? '🔓 Enable' : '🔒 Disable'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">
                        🗑️ Delete
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Update statistics
function updateStats() {
    document.getElementById('totalUsers').textContent = users.length;
    const onlineCount = users.filter(u => isUserOnline(u)).length;
    document.getElementById('totalRegularUsers').textContent = onlineCount;
    const offlineCount = users.filter(u => !isUserOnline(u)).length;
    document.getElementById('totalAdmins').textContent = offlineCount;
}

// Check if user is online (active in last 5 minutes)
function isUserOnline(user) {
    if (!user.lastActivity || user.lastActivity === 0 || user.lastActivity === '0') return false;
    // Handle both number and string formats
    const lastActivityNum = typeof user.lastActivity === 'string' ? parseInt(user.lastActivity) : user.lastActivity;
    if (!lastActivityNum || lastActivityNum <= 0) return false;
    const fiveMinutesAgo = new Date().getTime() - (5 * 60 * 1000);
    return lastActivityNum > fiveMinutesAgo;
}

// Filter singers by status
function filterSingers(filter) {
    currentFilter = filter;
    console.log('🔍 Filtering singers by:', filter);
    updateFilterButtons();
    displayUsers();
}

// Update filter button styles
function updateFilterButtons() {
    const filterTotal = document.getElementById('filterTotal');
    const filterOnline = document.getElementById('filterOnline');
    const filterOffline = document.getElementById('filterOffline');
    
    // Reset all buttons
    if (filterTotal) {
        filterTotal.style.background = 'rgba(102, 126, 234, 0.3)';
    }
    if (filterOnline) {
        filterOnline.style.background = 'rgba(102, 126, 234, 0.3)';
    }
    if (filterOffline) {
        filterOffline.style.background = 'rgba(102, 126, 234, 0.3)';
    }
    
    // Highlight active button
    if (currentFilter === 'total' && filterTotal) {
        filterTotal.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
    } else if (currentFilter === 'online' && filterOnline) {
        filterOnline.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
    } else if (currentFilter === 'offline' && filterOffline) {
        filterOffline.style.background = 'linear-gradient(135deg, #6c757d, #5a6268)';
    }
}

// Update user activity when they interact with singer page
function updateUserActivity() {
    const singerName = localStorage.getItem('karaoke_user_name');
    if (singerName) {
        const user = users.find(u => u.username === singerName);
        if (user) {
            user.lastActivity = new Date().getTime();
            saveUsers();
            displayUsers();
            updateStats();
        }
    }
}

// Open edit modal
function openEditModal(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    currentEditingUserId = userId;
    document.getElementById('editUserName').value = user.username;
    document.getElementById('editUserPassword').value = '';
    document.getElementById('editUserRole').value = user.role;
    
    const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
    modal.show();
}

// Save user changes
function saveUserChanges() {
    const user = users.find(u => u.id === currentEditingUserId);
    if (!user) return;
    
    const newUsername = document.getElementById('editUserName').value.trim();
    const newPassword = document.getElementById('editUserPassword').value.trim();
    const newRole = document.getElementById('editUserRole').value;
    
    if (!newUsername || !newRole) {
        showNotification('Please fill in all required fields', 'warning');
        return;
    }

    // If password is provided, validate it
    if (newPassword) {
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
            showNotification(passwordValidation.message, 'warning');
            return;
        }
    }

    // Check if username already exists (excluding current user)
    if (users.some(u => u.username === newUsername && u.id !== currentEditingUserId)) {
        showNotification('Username already exists', 'danger');
        return;
    }

    user.username = newUsername;
    if (newPassword) {
        user.password = newPassword;
    }
    user.role = newRole;
    
    saveUsers();
    displayUsers();
    updateStats();
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
    modal.hide();
    
    showNotification('User updated successfully!', 'success');
}

// Delete user
function deleteUser(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    if (confirm(`Are you sure you want to delete "${user.username}"?`)) {
        users = users.filter(u => u.id !== userId);
        saveUsers();
        displayUsers();
        updateStats();
        showNotification(`User "${user.username}" deleted!`, 'info');
    }
}

// Toggle user disabled status (disable/enable user)
function toggleUserDisabled(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    const currentStatus = user.disabled || false;
    const newStatus = !currentStatus;
    const action = newStatus ? 'disable' : 'enable';
    
    if (confirm(`Are you sure you want to ${action} "${user.username}"?`)) {
        user.disabled = newStatus;
        saveUsers();
        displayUsers();
        updateStats();
        
        if (newStatus) {
            showNotification(`User "${user.username}" has been disabled!`, 'warning');
            console.log(`🔒 User ${user.username} disabled`);
        } else {
            showNotification(`User "${user.username}" has been enabled!`, 'success');
            console.log(`🔓 User ${user.username} enabled`);
        }
    }
}

// Open change password modal for a specific user
function openChangePasswordModal(userId, username) {
    currentEditingUserId = userId;
    document.getElementById('editUserPasswordUsername').textContent = username;
    document.getElementById('editUserPasswordInput').value = '';
    document.getElementById('editUserPasswordConfirm').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('changeUserPasswordModal'));
    modal.show();
}

// Change password for a specific user
function handleChangeUserPassword() {
    if (!currentEditingUserId) return;
    
    const newPassword = document.getElementById('editUserPasswordInput').value;
    const confirmPassword = document.getElementById('editUserPasswordConfirm').value;
    
    // Validate password
    if (!newPassword || newPassword.length < 6) {
        alert('❌ Password must be at least 6 characters long!');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alert('❌ Passwords do not match!');
        return;
    }
    
    // Find and update user
    const user = users.find(u => u.id === currentEditingUserId);
    if (!user) return;
    
    user.password = newPassword;
    saveUsers();
    
    // Close modal and clear form
    const modal = bootstrap.Modal.getInstance(document.getElementById('changeUserPasswordModal'));
    if (modal) {
        modal.hide();
    }
    
    showNotification(`✅ Password changed for "${user.username}"!`, 'success');
    console.log('🔐 Password changed for user:', user.username);
}

// Show notification
function showNotification(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} position-fixed`;
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; animation: slideUp 0.5s ease;';
    alert.innerHTML = message;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.style.opacity = '0';
        alert.style.transition = 'opacity 0.3s ease';
        setTimeout(() => alert.remove(), 300);
    }, 3000);
}
// ===== TV DISPLAY CONTROL FUNCTIONS =====

// Load TV display status from Firebase
function loadTVDisplayStatus() {
    if (typeof firebase === 'undefined' || !firebase.database) {
        console.warn('⚠️ Firebase not available');
        updateTVStatusUI(true); // Default to enabled
        return;
    }
    
    try {
        firebase.database().ref('tvControl/enabled').once('value', (snapshot) => {
            const isEnabled = snapshot.val() !== false; // Default to true if not set
            console.log('📺 TV Display Status Loaded from Firebase:', isEnabled);
            updateTVStatusUI(isEnabled);
        }).catch(err => {
            console.error('❌ Firebase error loading TV status:', err.message);
            console.log('Make sure Firebase Rules are set to: { "rules": { ".read": true, ".write": true } }');
            updateTVStatusUI(true); // Default to enabled on error
        });
    } catch (e) {
        console.error('Firebase exception:', e.message);
        updateTVStatusUI(true);
    }
}

// Update UI to reflect TV status
function updateTVStatusUI(isEnabled) {
    const statusElement = document.getElementById('tvStatus');
    const enableBtn = document.getElementById('enableTVBtn');
    const disableBtn = document.getElementById('disableTVBtn');
    
    if (statusElement) {
        if (isEnabled) {
            statusElement.textContent = '🟢 ENABLED';
            statusElement.className = 'tv-status tv-status-enabled';
            if (enableBtn) enableBtn.disabled = true;
            if (disableBtn) disableBtn.disabled = false;
        } else {
            statusElement.textContent = '🔴 DISABLED';
            statusElement.className = 'tv-status tv-status-disabled';
            if (enableBtn) enableBtn.disabled = false;
            if (disableBtn) disableBtn.disabled = true;
        }
    }
}

// Enable TV Display
function enableTVDisplay() {
    console.log('🟢 Enabling TV Display...');
    
    if (typeof firebase === 'undefined' || !firebase.database) {
        alert('❌ Firebase not available. Please check your connection.');
        console.error('Firebase not initialized');
        return;
    }
    
    try {
        firebase.database().ref('tvControl/enabled').set(true)
            .then(() => {
                console.log('✅ TV Display Enabled via Firebase');
                updateTVStatusUI(true);
                showNotification('✅ TV Display has been ENABLED', 'success');
            })
            .catch(err => {
                console.error('❌ Error enabling TV:', err.message);
                if (err.code === 'PERMISSION_DENIED') {
                    showNotification('❌ Firebase Permission Denied - Check database rules', 'danger');
                } else {
                    showNotification('❌ Failed to enable TV Display: ' + err.message, 'danger');
                }
            });
    } catch (e) {
        console.error('Firebase exception:', e.message);
        showNotification('❌ Error: ' + e.message, 'danger');
    }
}

// Disable TV Display
function disableTVDisplay() {
    console.log('🔴 Disabling TV Display...');
    
    if (typeof firebase === 'undefined' || !firebase.database) {
        alert('❌ Firebase not available. Please check your connection.');
        console.error('Firebase not initialized');
        return;
    }
    
    try {
        firebase.database().ref('tvControl/enabled').set(false)
            .then(() => {
                console.log('✅ TV Display Disabled via Firebase');
                updateTVStatusUI(false);
                showNotification('✅ TV Display has been DISABLED', 'warning');
            })
            .catch(err => {
                console.error('❌ Error disabling TV:', err.message);
                if (err.code === 'PERMISSION_DENIED') {
                    showNotification('❌ Firebase Permission Denied - Check database rules', 'danger');
                } else {
                    showNotification('❌ Failed to disable TV Display: ' + err.message, 'danger');
                }
            });
    } catch (e) {
        console.error('Firebase exception:', e.message);
        showNotification('❌ Error: ' + e.message, 'danger');
    }
}