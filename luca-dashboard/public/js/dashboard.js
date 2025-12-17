let connectionCheckInterval = null;

// Check session on load
async function checkSession() {
    const response = await fetch('/api/session');
    const data = await response.json();

    if (!data.authenticated) {
        window.location.href = '/login.html';
        return;
    }

    if (data.isAdmin) {
        window.location.href = '/admin.html';
        return;
    }

    document.getElementById('navUsername').textContent = data.username;
    loadUserInfo();
}

async function loadUserInfo() {
    const response = await fetch('/api/user/info');
    const data = await response.json();

    if (data.success && data.user.isConnected) {
        showBotConnected(data.user);
        startStatusPolling(data.user.phone);
    } else {
        showNoBotState();
    }
}

function showNoBotState() {
    document.getElementById('noBotState').style.display = 'block';
    document.getElementById('botConnectedState').style.display = 'none';
}

function showBotConnected(user) {
    document.getElementById('noBotState').style.display = 'none';
    document.getElementById('botConnectedState').style.display = 'block';
    document.getElementById('botPhone').textContent = `+${user.phone}`;
}

function showConnectModal() {
    document.getElementById('connectModal').style.display = 'block';
    document.getElementById('connectStep1').style.display = 'block';
    document.getElementById('connectStep2').style.display = 'none';
    document.getElementById('connectStep3').style.display = 'none';
}

function closeConnectModal() {
    document.getElementById('connectModal').style.display = 'none';
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
    }
}

async function generateCode() {
    const phone = document.getElementById('phoneInput').value.replace(/[^0-9]/g, '');
    const errorDiv = document.getElementById('connectError');

    if (phone.length < 10) {
        errorDiv.textContent = 'Please enter a valid phone number';
        errorDiv.classList.add('show');
        return;
    }

    errorDiv.classList.remove('show');

    try {
        const response = await fetch('/api/user/generate-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('connectStep1').style.display = 'none';
            document.getElementById('connectStep2').style.display = 'block';
            document.getElementById('pairingCode').textContent = data.code;

            startTimer();
            checkConnectionStatus();
        } else {
            errorDiv.textContent = data.error;
            errorDiv.classList.add('show');
        }
    } catch (error) {
        errorDiv.textContent = 'Failed to generate code';
        errorDiv.classList.add('show');
    }
}

function startTimer() {
    let seconds = 60;
    const timerElement = document.getElementById('timer');

    const interval = setInterval(() => {
        seconds--;
        timerElement.textContent = seconds;

        if (seconds <= 0) {
            clearInterval(interval);
            timerElement.textContent = 'expired';
        }
    }, 1000);
}

async function checkConnectionStatus() {
    let attempts = 0;
    const maxAttempts = 60;

    connectionCheckInterval = setInterval(async () => {
        attempts++;

        const response = await fetch('/api/user/check-connection');
        const data = await response.json();

        if (data.connected) {
            clearInterval(connectionCheckInterval);
            document.getElementById('connectStep2').style.display = 'none';
            document.getElementById('connectStep3').style.display = 'block';

            setTimeout(() => {
                closeConnectModal();
                location.reload();
            }, 2000);
        } else if (attempts >= maxAttempts) {
            clearInterval(connectionCheckInterval);
            alert('Connection timeout. Please try again.');
            closeConnectModal();
        }
    }, 1000);
}

async function startStatusPolling(phone) {
    updateBotStatus();
    setInterval(updateBotStatus, 5000); // Update every 5 seconds
}

async function updateBotStatus() {
    const response = await fetch('/api/user/bot-status');
    const data = await response.json();

    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    if (data.running) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Online';
        statusText.style.color = '#4caf50';

        document.getElementById('botStatusValue').textContent = 'Running';

        const uptimeMinutes = Math.floor((Date.now() - data.uptime) / 60000);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        const uptimeDays = Math.floor(uptimeHours / 24);

        let uptimeText = uptimeMinutes + 'm';
        if (uptimeHours > 0) uptimeText = uptimeHours + 'h';
        if (uptimeDays > 0) uptimeText = uptimeDays + 'd';

        document.getElementById('botUptime').textContent = uptimeText;
        document.getElementById('botMemory').textContent = (data.memory / 1024 / 1024).toFixed(0) + ' MB';
        document.getElementById('botRestarts').textContent = data.restarts || 0;
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Offline';
        statusText.style.color = '#f44336';

        document.getElementById('botStatusValue').textContent = 'Stopped';
        document.getElementById('botUptime').textContent = '—';
        document.getElementById('botMemory').textContent = '—';
        document.getElementById('botRestarts').textContent = '—';
    }
}

async function restartBot() {
    if (!confirm('Restart your bot? This will take ~30 seconds.')) return;

    const response = await fetch('/api/user/restart-bot', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
        alert('✅ Bot restarted successfully!');
        setTimeout(updateBotStatus, 2000);
    } else {
        alert('❌ Error: ' + data.error);
    }
}

async function disconnectBot() {
    if (!confirm('⚠️ This will stop your bot and delete all data. Are you sure?')) return;

    const response = await fetch('/api/user/disconnect', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
        alert('✅ Bot disconnected');
        location.reload();
    } else {
        alert('❌ Error: ' + data.error);
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}

// Initialize
checkSession();
