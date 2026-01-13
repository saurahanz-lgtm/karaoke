// ===== ADMIN USER MANAGEMENT LOGIC =====

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
    
    // Update admin activity every 30 seconds to keep them as Online
    setInterval(updateAdminActivity, 30000);
    
    // Also track clicks and key presses to update activity
    document.addEventListener('click', updateAdminActivity);
    document.addEventListener('keypress', updateAdminActivity);
});

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
        
        // Update admin user's lastActivity to show as Online
        updateAdminActivity();
    } else {
        // Not logged in, redirect to home
        alert('Please login first');
        window.location.href = 'index.html';
    }
}

// Update the logged-in admin user's activity
function updateAdminActivity() {
    if (!loggedInUser) return;
    
    const now = Date.now();
    
    // Update in localStorage
    loggedInUser.lastActivity = now;
    localStorage.setItem('karaoke_logged_in_user', JSON.stringify(loggedInUser));
    
    // Update in Firebase
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('users/' + loggedInUser.id).update({
                lastActivity: now
            }).catch(err => console.warn('Firebase admin activity update failed:', err.message));
        } catch (error) {
            console.warn('Error updating admin activity:', error.message);
        }
    }
    
    console.log('👨‍💼 Admin activity updated:', new Date().toLocaleTimeString());
}

// Handle password change
function handleChangePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // Validate current password
    if (currentPassword !== loggedInUser.password) {
        alert('❌ Current password is incorrect!');
        return;
    }
    
    // Validate new password
    if (newPassword.length < 6) {
        alert('❌ New password must be at least 6 characters long!');
        return;
    }
    
    // Validate passwords match
    if (newPassword !== confirmPassword) {
        alert('❌ New passwords do not match!');
        return;
    }
    
    // Update password in user object
    loggedInUser.password = newPassword;
    localStorage.setItem('karaoke_logged_in_user', JSON.stringify(loggedInUser));
    
    // Update password in users array
    const userIndex = users.findIndex(u => u.id === loggedInUser.id);
    if (userIndex !== -1) {
        users[userIndex].password = newPassword;
        saveUsers();
    }
    
    // Update in Firebase
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('users/' + loggedInUser.id).update({
                password: newPassword
            }).catch(err => console.warn('Firebase password update failed:', err.message));
        } catch (error) {
            console.warn('Error updating password in Firebase:', error.message);
        }
    }
    
    // Clear form and close modal
    document.getElementById('changePasswordForm').reset();
    const modal = bootstrap.Modal.getInstance(document.getElementById('changePasswordModal'));
    if (modal) {
        modal.hide();
    }
    
    alert('✅ Password changed successfully!');
    console.log('🔐 Password changed for user:', loggedInUser.username);
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('karaoke_logged_in_user');
        window.location.href = 'index.html';
    }
}

// Load users from Firebase/localStorage
function loadUsers() {
    // Check if Firebase is available
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    users = Object.values(data);
                    console.log('✅ Users loaded from Firebase:', users.length);
                } else {
                    // Firebase is empty, use default/localStorage
                    loadFromLocalStorage();
                }
                displayUsers();
                updateStats();
            }).catch((error) => {
                console.warn('Firebase error, falling back to localStorage:', error.message);
                loadFromLocalStorage();
                displayUsers();
                updateStats();
            });
        } catch (error) {
            console.warn('Firebase not configured, using localStorage:', error.message);
            loadFromLocalStorage();
            displayUsers();
            updateStats();
        }
    } else {
        loadFromLocalStorage();
        displayUsers();
        updateStats();
    }
    
    // Set up real-time listener to catch updates from other admin windows
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.on('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    const firebaseUsers = Object.values(data);
                    // Only update display if data actually changed
                    if (JSON.stringify(firebaseUsers) !== JSON.stringify(users)) {
                        users = firebaseUsers;
                        console.log('🔄 Users updated from Firebase listener');
                        displayUsers();
                        updateStats();
                    }
                }
            });
        } catch (error) {
            console.warn('Firebase listener setup failed:', error.message);
        }
    }
    
    // Set up activity tracking - refresh every 2 seconds to show real-time status
    setInterval(() => {
        // Reload users from database to get latest activity
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                firebase.database().ref('users').once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        users = Object.values(data);
                        displayUsers();
                        updateStats();
                    }
                });
            } catch (error) {
                // Silent fail
            }
        } else {
            loadFromLocalStorage();
            displayUsers();
            updateStats();
        }
    }, 2000);
}

// Load from localStorage fallback
function loadFromLocalStorage() {
    const stored = localStorage.getItem('karaoke_users');
    if (stored) {
        users = JSON.parse(stored);
        // Ensure all users have IDs
        users = users.map((u, idx) => ({
            ...u,
            id: u.id || (idx + 1),
            lastActivity: u.lastActivity || 0
        }));
    } else {
        // Demo data - all admin accounts
        users = [
            { id: 1, username: "john_doe", password: "pass123", role: "admin", joined: "2024-01-01", lastActivity: 0 },
            { id: 2, username: "maria_santos", password: "pass123", role: "admin", joined: "2024-01-02", lastActivity: 0 },
            { id: 3, username: "sarah_johnson", password: "pass123", role: "admin", joined: "2024-01-03", lastActivity: 0 },
            { id: 4, username: "admin_user", password: "admin123", role: "admin", joined: "2024-01-01", lastActivity: 0 }
        ];
        saveUsers();
    }
}

// Save users to Firebase/localStorage
function saveUsers() {
    // Always save to localStorage as backup
    localStorage.setItem('karaoke_users', JSON.stringify(users));
    
    // Try to save to Firebase - IMMEDIATE WRITE
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            // Convert array to object with IDs as keys for better Firebase structure
            const usersObj = {};
            users.forEach(user => {
                usersObj[user.id] = user;
            });
            usersRef.set(usersObj).then(() => {
                console.log('✅ Users IMMEDIATELY saved to Firebase');
                // Broadcast change to all tabs/windows
                broadcastUserUpdate();
            }).catch((error) => {
                console.warn('Firebase save error:', error.message);
                // Still broadcast even if Firebase fails
                broadcastUserUpdate();
            });
        } catch (error) {
            console.warn('Firebase not available, saved to localStorage only', error.message);
            broadcastUserUpdate();
        }
    } else {
        // Firebase not available, just broadcast localStorage update
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

// Reload users from Firebase to ensure we have latest data
function reloadUsersFromFirebase(callback) {
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            const usersRef = firebase.database().ref('users');
            usersRef.once('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    users = Object.values(data);
                    console.log('✅ Users reloaded from Firebase before operation');
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
        lastActivity: 0  // User starts as Offline until they log in
    };
    
    users.push(newUser);
    saveUsers(); // This saves to both Firebase and localStorage
    
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
    
    // Reload users from Firebase before adding (ensures we have latest data)
    reloadUsersFromFirebase(function() {
        continueAddUser(username, password, role);
    });
}

// Display users in table
function displayUsers() {
    const tbody = document.getElementById('usersTableBody');
    const emptyMessage = document.getElementById('emptyMessage');
    
    // Filter users based on current filter
    let filteredUsers = users;
    if (currentFilter === 'online') {
        filteredUsers = users.filter(u => isUserOnline(u));
    } else if (currentFilter === 'offline') {
        filteredUsers = users.filter(u => !isUserOnline(u));
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
        const lastActivityText = user.lastActivity ? new Date(user.lastActivity).toLocaleTimeString() : 'Never';
        
        html += `
            <tr style="border-bottom: 1px solid rgba(102, 126, 234, 0.2);">
                <td style="padding: 1.2rem;">${index + 1}</td>
                <td style="padding: 1.2rem;">
                    <strong>${user.username}</strong>
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
    if (!user.lastActivity || user.lastActivity === 0) return false;
    const fiveMinutesAgo = new Date().getTime() - (5 * 60 * 1000);
    return user.lastActivity > fiveMinutesAgo;
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
