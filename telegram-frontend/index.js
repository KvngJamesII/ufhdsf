const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const PairingHandler = require('./pairing');
const ProcessManager = require('./processManager');

// Telegram Bot Token
const BOT_TOKEN = '8410279119:AAF1iUlau9WAZQO-okpPw3gMUiEBm50vSJs';

// Create bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// User session states
const userStates = new Map();

// Helper: Get user state
function getUserState(chatId) {
  return userStates.get(chatId) || { step: 'idle' };
}

// Helper: Set user state
function setUserState(chatId, state) {
  userStates.set(chatId, state);
}

// Helper: Clear user state
function clearUserState(chatId) {
  userStates.delete(chatId);
}

// Helper: Notify admin
function notifyAdmin(message) {
  const adminId = db.getAdminId();
  try {
    bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error notifying admin:', error);
  }
}

// Helper: Send admin menu
function sendAdminMenu(chatId, message = '👑 Admin Panel') {
  const stats = {
    totalUsers: db.getAllUsers().length,
    connectedUsers: db.getConnectedUsers().length,
    signupStatus: db.isSignupEnabled() ? '✅ Enabled' : '❌ Disabled'
  };

  const statsText = `${message}\n\n📊 *Statistics:*\n👥 Total Users: ${stats.totalUsers}\n✅ Connected: ${stats.connectedUsers}\n📝 Signups: ${stats.signupStatus}\n\nUse the buttons below to manage:`;

  const keyboard = {
    reply_markup: {
      keyboard: [
        ['📊 View All Users', db.isSignupEnabled() ? '🔒 Pause Signups' : '🔓 Enable Signups'],
        ['📈 Statistics', '💬 Broadcast Message'],
        ['🔄 Restart All Bots', 'ℹ️ Help']
      ],
      resize_keyboard: true
    }
  };

  bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown', ...keyboard });
}

// Helper: Send main menu
function sendMainMenu(chatId, message = 'Choose an option:') {
  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ You need to /start first!');
    return;
  }

  let keyboard;

  if (user.isConnected) {
    keyboard = {
      reply_markup: {
        keyboard: [
          ['📊 Status', '🔄 Restart Bot'],
          ['❌ Disconnect', '📋 My Info'],
          ['ℹ️ Help']
        ],
        resize_keyboard: true
      }
    };
  } else {
    keyboard = {
      reply_markup: {
        keyboard: [
          ['📱 Connect WhatsApp'],
          ['📋 My Info', 'ℹ️ Help']
        ],
        resize_keyboard: true
      }
    };
  }

  bot.sendMessage(chatId, message, keyboard);
}

// Command: /del
bot.onText(/\/del(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const phone = match[1] ? match[1].trim().replace(/[^0-9]/g, '') : null;

  if (!phone) {
    bot.sendMessage(chatId, '❌ Please provide a phone number.\n\nUsage: `/del 234707326074`', { parse_mode: 'Markdown' });
    return;
  }

  bot.sendMessage(chatId, `🔄 Deleting bot and folder for +${phone}...`);

  const result = await ProcessManager.deleteUserBotAndFolder(phone);

  if (result.success) {
    bot.sendMessage(chatId, `✅ *Success!*\n\nBot for +${phone} has been stopped, its PM2 process deleted, and its user folder removed.`, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, `❌ *Error:* ${result.error}`, { parse_mode: 'Markdown' });
  }
});

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || 'User';

  // Check if admin
  if (db.isAdmin(chatId)) {
    sendAdminMenu(chatId, `👑 *Welcome Admin!*\n\nYou have full access to the bot management system.`);
    return;
  }

  // Check if signups are enabled
  if (!db.isSignupEnabled()) {
    bot.sendMessage(chatId, `🔒 *Signups Currently Paused*\n\nNew user registrations are temporarily disabled.\n\n📞 Contact: @theidledeveloper\n⏰ Please try again later.`, { parse_mode: 'Markdown' });
    return;
  }

  let user = db.getUserByTelegramId(chatId);

  if (!user) {
    const result = db.createUser(chatId, username);
    if (result.success) {
      user = result.user;
      bot.sendMessage(chatId, `🤍 *Welcome to LUCA Bot Manager!*\n\n✅ Your account has been created.\n\n📱 To connect your WhatsApp bot, tap "Connect WhatsApp" below.`, { parse_mode: 'Markdown' });

      // Notify admin
      notifyAdmin(`🆕 *New User Registered*\n\n👤 Username: ${username}\n🆔 Telegram ID: ${chatId}\n📅 Time: ${new Date().toLocaleString()}`);
    } else {
      bot.sendMessage(chatId, `❌ Error creating account: ${result.error}`);
      return;
    }
  } else {
    bot.sendMessage(chatId, `🤍 *Welcome back, ${username}!*\n\n${user.isConnected ? '✅ Your bot is connected' : '❌ Your bot is not connected'}`, { parse_mode: 'Markdown' });
  }

  sendMainMenu(chatId);
});

// Command: /help
bot.onText(/\/help|ℹ️ Help/, (msg) => {
  const chatId = msg.chat.id;

  // Admin help
  if (db.isAdmin(chatId)) {
    const helpText = `👑 *LUCA Bot Manager - Admin Help*

*Admin Commands:*

📊 *View All Users*
View list of all registered users

🔒/🔓 *Pause/Enable Signups*
Control new user registrations

📈 *Statistics*
View detailed bot statistics

💬 *Broadcast Message*
Send message to all users

🔄 *Restart All Bots*
Restart all connected WhatsApp bots

🗑️ */del <phone>*
Stop bot, delete PM2 process, and remove user folder

*User Management:*
- View user connection status
- Monitor active bots
- Control signup access

*Support:*
For technical issues, check server logs.`;

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    return;
  }

  // Regular user help
  const helpText = `🤍 *LUCA Bot Manager - Help*

*Available Commands:*

📱 *Connect WhatsApp*
Connect your WhatsApp account to the bot

📊 *Status*
Check your bot's current status

🔄 *Restart Bot*
Restart your WhatsApp bot

❌ *Disconnect*
Disconnect and delete your WhatsApp bot

📋 *My Info*
View your account information

ℹ️ *Help*
Show this help message

*How to Connect:*
1. Tap "Connect WhatsApp"
2. Enter your phone number (with country code)
3. Receive an 8-digit pairing code
4. Open WhatsApp → Settings → Linked Devices
5. Select "Link with Phone Number"
6. Enter the code
7. Done! Your bot is now running

*Support:*
Contact: @theidledeveloper`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Admin: View All Users
bot.onText(/📊 View All Users/, (msg) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const users = db.getAllUsers();

  if (users.length === 0) {
    bot.sendMessage(chatId, '📊 *No users registered yet.*', { parse_mode: 'Markdown' });
    return;
  }

  let userList = `📊 All Users (${users.length})\n\n`;

  users.forEach((user, index) => {
    const status = user.isConnected ? 'Online' : 'Offline';
    const username = user.username || 'No username';
    const phone = user.phone || 'No phone';
    
    userList += `${index + 1}. ${status} - @${username}\n`;
    userList += `Phone: ${phone}\n`;
    userList += `ID: ${user.telegramId}\n\n`;
  });

  bot.sendMessage(chatId, userList);
});

// Admin: Toggle Signups
bot.onText(/🔒 Pause Signups|🔓 Enable Signups/, (msg) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const newStatus = db.toggleSignup();
  const message = newStatus
    ? '🔓 *Signups Enabled*\n\nNew users can now register and connect their bots.'
    : '🔒 *Signups Paused*\n\nNew user registrations are now disabled.';

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  sendAdminMenu(chatId, 'Settings updated:');
});

// Admin: Statistics
bot.onText(/📈 Statistics/, async (msg) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const users = db.getAllUsers();
  const connected = db.getConnectedUsers();
  const runningBots = await ProcessManager.getAllRunningBots();

  let statsText = `📈 *Detailed Statistics*\n\n`;
  statsText += `👥 Total Users: ${users.length}\n`;
  statsText += `✅ Connected Users: ${connected.length}\n`;
  statsText += `🤖 Running Bots: ${runningBots.length}\n`;
  statsText += `📝 Signup Status: ${db.isSignupEnabled() ? 'Enabled ✅' : 'Disabled 🔒'}\n\n`;

  if (runningBots.length > 0) {
    statsText += `*Running Bots:*\n`;
    runningBots.forEach(botInfo => {
      statsText += `📱 +${botInfo.phone} (PID: ${botInfo.pid})\n`;
      statsText += `   ⏱️ Uptime: ${ProcessManager.formatUptime(botInfo.uptime)}\n`;
    });
  }

  bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
});

// Admin: Broadcast Message
bot.onText(/💬 Broadcast Message/, (msg) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  setUserState(chatId, { step: 'waiting_broadcast' });
  bot.sendMessage(chatId, '💬 *Broadcast Message*\n\nSend the message you want to broadcast to all users.\n\nType /cancel to abort.', {
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  });
});

// Admin: Restart All Bots
bot.onText(/🔄 Restart All Bots/, async (msg) => {
  const chatId = msg.chat.id;

  if (!db.isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const connectedUsers = db.getConnectedUsers();

  if (connectedUsers.length === 0) {
    bot.sendMessage(chatId, '❌ No connected bots to restart.');
    return;
  }

  bot.sendMessage(chatId, `🔄 Restarting ${connectedUsers.length} bot(s)...`);

  let restarted = 0;

  // Restart all bots sequentially
  for (const user of connectedUsers) {
    const result = await ProcessManager.restartBot(user.phone);
    if (result.success) restarted++;
  }

  setTimeout(() => {
    bot.sendMessage(chatId, `✅ Restarted ${restarted}/${connectedUsers.length} bot(s) successfully.`);
  }, 3000);
});

// Button: Connect WhatsApp
bot.onText(/📱 Connect WhatsApp/, (msg) => {
  const chatId = msg.chat.id;

  // Check if signups enabled
  if (!db.isSignupEnabled() && !db.isAdmin(chatId)) {
    bot.sendMessage(chatId, `🔒 *Signups Currently Paused*\n\nNew connections are temporarily disabled.\n\n📞 Contact: @theidledeveloper`, { parse_mode: 'Markdown' });
    return;
  }

  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ Please use /start first!');
    return;
  }

  if (user.isConnected) {
    bot.sendMessage(chatId, '✅ You already have a connected bot!\n\nUse "Disconnect" first if you want to connect a different number.');
    return;
  }

  setUserState(chatId, { step: 'waiting_phone' });

  bot.sendMessage(chatId, `📱 *Enter Your Phone Number*\n\nPlease enter your WhatsApp phone number with country code (no spaces or special characters).\n\n*Example:*\n• 22995163753\n• 1234567890\n• 447911123456\n\nType /cancel to cancel.`, {
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  });
});

// Button: Status
bot.onText(/📊 Status/, async (msg) => {
  const chatId = msg.chat.id;
  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ Please use /start first!');
    return;
  }

  if (!user.isConnected) {
    bot.sendMessage(chatId, '❌ No bot connected.\n\nUse "Connect WhatsApp" to get started!');
    return;
  }

  const status = await ProcessManager.getBotStatus(user.phone);

  let statusText = `📊 *Bot Status*\n\n`;
  statusText += `📱 Phone: +${user.phone}\n`;
  statusText += `🔌 Status: ${status.running ? '✅ Online' : '❌ Offline'}\n`;

  if (status.running) {
    statusText += `⏱️ Uptime: ${status.uptimeFormatted}\n`;
    statusText += `🔄 Restarts: ${status.restarts}\n`;
    statusText += `🆔 PID: ${status.pid}`;
  } else {
    statusText += `\n⚠️ Bot is not running! Use "Restart Bot" to start it.`;
  }

  bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
});

// Button: Restart Bot
bot.onText(/🔄 Restart Bot/, async (msg) => {
  const chatId = msg.chat.id;
  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ Please use /start first!');
    return;
  }

  if (!user.isConnected) {
    bot.sendMessage(chatId, '❌ No bot connected.\n\nUse "Connect WhatsApp" to get started!');
    return;
  }

  bot.sendMessage(chatId, '🔄 Restarting your bot...');

  const result = await ProcessManager.restartBot(user.phone);

  if (result.success) {
    setTimeout(() => {
      bot.sendMessage(chatId, '✅ Bot restarted successfully!');
    }, 3000);
  } else {
    bot.sendMessage(chatId, `❌ Error restarting bot: ${result.error}`);
  }
});

// Button: Disconnect
bot.onText(/❌ Disconnect/, async (msg) => {
  const chatId = msg.chat.id;
  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ Please use /start first!');
    return;
  }

  if (!user.isConnected) {
    bot.sendMessage(chatId, '❌ No bot connected.');
    return;
  }

  bot.sendMessage(chatId, `⚠️ *Confirm Disconnect*\n\nAre you sure you want to disconnect your WhatsApp bot?\n\nThis will:\n• Stop your bot\n• Delete all bot data\n• Remove the WhatsApp connection\n\nType *YES* to confirm or *NO* to cancel.`, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [['YES', 'NO']],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });

  setUserState(chatId, { step: 'confirm_disconnect', phone: user.phone });
});

// Button: My Info
bot.onText(/📋 My Info/, (msg) => {
  const chatId = msg.chat.id;
  const user = db.getUserByTelegramId(chatId);

  if (!user) {
    bot.sendMessage(chatId, '❌ Please use /start first!');
    return;
  }

  let infoText = `📋 *Your Account Information*\n\n`;
  infoText += `👤 Username: ${user.username}\n`;
  infoText += `🆔 Telegram ID: ${user.telegramId}\n`;
  infoText += `📱 Phone: ${user.phone ? `+${user.phone}` : 'Not connected'}\n`;
  infoText += `🔌 Status: ${user.isConnected ? '✅ Connected' : '❌ Not connected'}\n`;
  infoText += `📅 Joined: ${new Date(user.createdAt).toLocaleDateString()}\n`;
  infoText += `🕒 Last Active: ${new Date(user.lastActive).toLocaleString()}`;

  bot.sendMessage(chatId, infoText, { parse_mode: 'Markdown' });
});

// Command: /cancel
bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  const state = getUserState(chatId);

  if (state.step === 'idle') {
    bot.sendMessage(chatId, 'Nothing to cancel.');
    return;
  }

  // Cancel pairing if in progress
  if (state.step === 'waiting_pairing' && state.phone) {
    PairingHandler.cancelPairing(state.phone);
  }

  clearUserState(chatId);
  bot.sendMessage(chatId, '❌ Operation cancelled.');

  if (db.isAdmin(chatId)) {
    sendAdminMenu(chatId);
  } else {
    sendMainMenu(chatId);
  }
});

// Handle text messages (for phone number input and confirmations)
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = getUserState(chatId);

  // Skip if it's a command or button
  if (text.startsWith('/') || text.match(/📱|📊|🔄|❌|📋|ℹ️|🔒|🔓|💬|📈/)) {
    return;
  }

  // Handle broadcast message (admin only)
  if (state.step === 'waiting_broadcast' && db.isAdmin(chatId)) {
    const users = db.getAllUsers();
    let sent = 0;

    bot.sendMessage(chatId, `📤 Broadcasting to ${users.length} user(s)...`);

    users.forEach(user => {
      try {
        bot.sendMessage(user.telegramId, `📢 *Admin Broadcast*\n\n${text}`, { parse_mode: 'Markdown' });
        sent++;
      } catch (error) {
        console.error(`Failed to send to ${user.telegramId}:`, error.message);
      }
    });

    setTimeout(() => {
      bot.sendMessage(chatId, `✅ Message sent to ${sent}/${users.length} user(s).`);
      clearUserState(chatId);
      sendAdminMenu(chatId);
    }, 2000);

    return;
  }

  // Handle phone number input
  if (state.step === 'waiting_phone') {
    const phone = text.replace(/[^0-9]/g, '');

    if (phone.length < 10) {
      bot.sendMessage(chatId, '❌ Invalid phone number. Please enter a valid number with country code (minimum 10 digits).\n\nExample: 22995163753');
      return;
    }

    // Check if phone already in use
    if (db.isPhoneInUse(phone, chatId)) {
      bot.sendMessage(chatId, '❌ This phone number is already connected to another account!');
      return;
    }

    bot.sendMessage(chatId, `⏳ Generating pairing code for +${phone}...\n\nThis may take a few seconds...`);

    setUserState(chatId, { step: 'waiting_pairing', phone });

    const user = db.getUserByTelegramId(chatId);

    // Generate pairing code
    PairingHandler.generatePairingCode(
      phone,
      (code) => {
        // Code generated successfully
        const codeFormatted = code.match(/.{1,4}/g).join('-');

        let message = `✅ *Pairing Code Generated!*\n\n`;
        message += `🔐 Your code: \`${codeFormatted}\`\n\n`;
        message += `📱 *How to connect:*\n`;
        message += `1. Open WhatsApp on your phone\n`;
        message += `2. Go to Settings → Linked Devices\n`;
        message += `3. Tap "Link a Device"\n`;
        message += `4. Select "Link with Phone Number"\n`;
        message += `5. Enter this code: \`${code}\`\n\n`;
        message += `⏰ Code expires in 5 minutes\n`;
        message += `⏳ Waiting for you to enter the code...`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        // Update database
        db.updateUser(chatId, {
          phone,
          pairingCode: code
        });
      },
      () => {
        // Connection successful
        bot.sendMessage(chatId, `🎉 *Successfully Connected!*\n\n✅ Your WhatsApp bot is now connected and starting...\n\nYou can now use your bot!`, { parse_mode: 'Markdown' });

        // Update database
        db.updateUser(chatId, {
          isConnected: true
        });

        // Notify admin about new connection
        notifyAdmin(`✅ *New WhatsApp Connection*\n\n👤 User: @${user.username || 'Unknown'}\n📱 Phone: +${phone}\n🆔 Telegram ID: ${chatId}\n📅 Time: ${new Date().toLocaleString()}`);

        // Start the bot process
        setTimeout(async () => {
          const result = await ProcessManager.startBot(phone);

          if (result.success) {
            bot.sendMessage(chatId, `✅ Bot started successfully with PM2!\n\nProcess: luca-user-${phone}\n\nSend .menu to your WhatsApp to see available commands.`);
            clearUserState(chatId);
            sendMainMenu(chatId, '🤍 Your bot is now online!');
          } else {
            bot.sendMessage(chatId, `⚠️ Bot connected but failed to start process: ${result.error}\n\nTry using "Restart Bot".`);
          }
        }, 2000);
      },
      (error) => {
        // Error occurred
        bot.sendMessage(chatId, `❌ *Error:* ${error.message}\n\nPlease try again.`, { parse_mode: 'Markdown' });
        clearUserState(chatId);
        sendMainMenu(chatId);
      }
    );

    return;
  }

  // Handle disconnect confirmation
  if (state.step === 'confirm_disconnect') {
    if (text.toUpperCase() === 'YES') {
      bot.sendMessage(chatId, '🔄 Disconnecting your bot...');

      // Stop bot process
      (async () => {
        await ProcessManager.stopBot(state.phone);

        // Delete user data
        PairingHandler.deleteUserData(state.phone);

        // Update database
        db.updateUser(chatId, {
          phone: null,
          isConnected: false,
          pairingCode: null,
          botProcess: null
        });

        clearUserState(chatId);
        bot.sendMessage(chatId, '✅ Bot disconnected and removed from PM2 successfully!');
        sendMainMenu(chatId);
      })();

    } else if (text.toUpperCase() === 'NO') {
      clearUserState(chatId);
      bot.sendMessage(chatId, '❌ Disconnect cancelled.');
      sendMainMenu(chatId);

    } else {
      bot.sendMessage(chatId, 'Please type YES to confirm or NO to cancel.');
    }

    return;
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  // Note: We don't stop PM2 bots on shutdown - they keep running
  // Users can manage them via Telegram or PM2 commands
  process.exit(0);
});

// Auto-cleanup interval (every 5 minutes)
setInterval(() => {
  ProcessManager.monitorAndCleanupBots((targetId, message) => {
    bot.sendMessage(targetId, message, { parse_mode: 'Markdown' });
  });
}, 5 * 60 * 1000);

// Start
console.clear();
console.log('╔════════════════════════════════╗');
console.log('║  🤍 LUCA Telegram Manager 🤍  ║');
console.log('╚════════════════════════════════╝\n');
console.log('✅ Bot is running...');
console.log('📱 Users can connect via Telegram');
console.log(`👑 Admin ID: ${db.getAdminId()}\n`);
