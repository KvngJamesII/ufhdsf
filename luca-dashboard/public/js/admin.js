// Check admin session
async function checkSession() {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (!data.authenticated || !data.isAdmin) {
        window.location.href = '/login.html';
        return;
    }

    loadStats();
}

async function loadStats() {
    const response = await fetch('/api/admin/stats');
    const data = await response.json();

    if (data.success) {
        // Update stats cards
        document.getElementById('totalUsers').textContent = data.stats.totalUsers;
        document.getElementById('activeUsers').textContent = data.stats.activeUsers;
        document.getElementById('todaySignups').textContent = data.stats.todaySignups;
        document.getElementById('runningBots').textContent = data.stats.runningBots;

        // Update signup toggle
        const btn = document.getElementById('toggleSignupsBtn');
        const statusText = document.getElementById('signupStatusText');
        if (data.stats.signupEnabled) {
            btn.className = 'btn btn-secondary';
            statusText.textContent = '✅ Signups Enabled (Click to Disable)';
        } else {
            btn.className = 'btn btn-danger';
            statusText.textContent = '🚫 Signups Disabled (Click to Enable)';
        }

        // Update max users input
        document.getElementById('maxUsersInput').value = data.stats.maxUsers;

        // Update users table
        updateUsersTable(data.users);

        // Update running bots
        updateRunningBots(data.runningBots);
    }
}

function updateUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No users yet</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td><strong>${user.username}</strong></td>
            <td>${user.phone || 'Not set'}</td>
            <td>
                <span class="status-badge ${user.isConnected ? 'status-online' : 'status-offline'}">
                    ${user.isConnected ? 'Online' : 'Offline'}
                </span>
            </td>
            <td>${formatDate(user.createdAt)}</td>
            <td>
                <button onclick="disconnectUser('${user.username}')" class="btn btn-danger btn-small">
                    Disconnect
                </button>
            </td>
        </tr>
    `).join('');
}

function updateRunningBots(bots) {
    const container = document.getElementById('runningBotsList');

    if (bots.length === 0) {
        container.innerHTML = '<p class="loading-text">No bots running</p>';
        return;
    }

    container.innerHTML = bots.map(bot => {
        const uptimeMinutes = Math.floor((Date.now() - bot.uptime) / 60000);
        const memoryMB = (bot.memory / 1024 / 1024).toFixed(0);

        return `
            <div class="bot-item">
                <div class="bot-info">
                    <strong>+${bot.phone}</strong>
                    <small>${bot.status}</small>
                </div>
                <div class="bot-metrics">
                    <span>⏱️ ${uptimeMinutes}m</span>
                    <span>💾 ${memoryMB}MB</span>
                    <span>🖥️ ${bot.cpu.toFixed(1)}%</span>
                </div>
            </div>
        `;
    }).join('');
}

async function toggleSignups() {
    const response = await fetch('/api/admin/toggle-signups', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
        loadStats();
    } else {
        alert('Error: ' + data.error);
    }
}

async function setMaxUsers() {
    const max = document.getElementById('maxUsersInput').value;

    if (!max || max < 1) {
        alert('Please enter a valid number');
        return;
    }

    const response = await fetch('/api/admin/set-max-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max: parseInt(max) })
    });

    const data = await response.json();

    if (data.success) {
        alert('✅ Max users set to ' + data.maxUsers);
        loadStats();
    } else {
        alert('Error: ' + data.error);
    }
}

async function restartAllBots() {
    if (!confirm('⚠️ Restart all bot instances? This will cause ~30 seconds downtime per bot.')) {
        return;
    }

    const response = await fetch('/api/admin/restart-all', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
        alert('✅ All bots restarted successfully!');
        setTimeout(loadStats, 3000);
    } else {
        alert('❌ Error: ' + data.error);
    }
}

async function disconnectUser(username) {
    if (!confirm(`Disconnect user ${username}? This will delete their bot and data.`)) {
        return;
    }

    const response = await fetch('/api/admin/disconnect-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });

    const data = await response.json();

    if (data.success) {
        alert('✅ User disconnected');
        loadStats();
    } else {
        alert('❌ Error: ' + data.error);
    }
}

function refreshStats() {
    loadStats();
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';
    return date.toLocaleDateString();
}

// Auto-refresh stats every 10 seconds
setInterval(loadStats, 10000);

// Initialize
checkSession();
