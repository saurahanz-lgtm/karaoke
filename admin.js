// ===== ADMIN USER MANAGEMENT LOGIC =====

// Users data storage
let users = [];
let currentEditingUserId = null;
let loggedInUser = null;

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
    } else {
        // Not logged in, redirect to home
        alert('Please login first');
        window.location.href = 'index.html';
    }
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('karaoke_logged_in_user');
        window.location.href = 'index.html';
    }
}

// Load users from localStorage
function loadUsers() {
    const stored = localStorage.getItem('karaoke_users');
    if (stored) {
        users = JSON.parse(stored);
    } else {
        // Demo data - all admin accounts
        users = [
            { id: 1, username: "john_doe", password: "pass123", role: "admin", joined: "2024-01-01", lastActivity: new Date().getTime() },
            { id: 2, username: "maria_santos", password: "pass123", role: "admin", joined: "2024-01-02", lastActivity: 0 },
            { id: 3, username: "sarah_johnson", password: "pass123", role: "admin", joined: "2024-01-03", lastActivity: 0 },
            { id: 4, username: "admin_user", password: "admin123", role: "admin", joined: "2024-01-01", lastActivity: new Date().getTime() }
        ];
        saveUsers();
    }
    
    // Set up activity tracking
    setInterval(updateUserActivity, 5000); // Check every 5 seconds
}

// Save users to localStorage
function saveUsers() {
    localStorage.setItem('karaoke_users', JSON.stringify(users));
    
    // Dispatch custom event to notify other pages of user database changes
    window.dispatchEvent(new CustomEvent('karaoke-users-updated', { 
        detail: { users, timestamp: new Date().getTime() }
    }));
    
    console.log('📊 User database updated and broadcasted');
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

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        showNotification(passwordValidation.message, 'warning');
        return;
    }

    // Check if username already exists
    if (users.some(u => u.username === username)) {
        showNotification('Username already exists', 'danger');
        return;
    }

    // Create new user
    const newUser = {
        id: Math.max(...users.map(u => u.id), 0) + 1,
        username,
        password,
        role,
        joined: new Date().toISOString().split('T')[0]
    };

    users.push(newUser);
    saveUsers();
    
    // Clear form
    document.getElementById('addUserForm').reset();
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
    if (modal) {
        modal.hide();
    }
    
    // Update display
    displayUsers();
    updateStats();
    
    showNotification(`User "${username}" added successfully!`, 'success');
}

// Display users in table
function displayUsers() {
    const tbody = document.getElementById('usersTableBody');
    const emptyMessage = document.getElementById('emptyMessage');
    
    if (users.length === 0) {
        tbody.innerHTML = '';
        emptyMessage.style.display = 'block';
        return;
    }
    
    emptyMessage.style.display = 'none';
    
    let html = '';
    users.forEach((user, index) => {
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
    if (!user.lastActivity) return false;
    const fiveMinutesAgo = new Date().getTime() - (5 * 60 * 1000);
    return user.lastActivity > fiveMinutesAgo;
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
