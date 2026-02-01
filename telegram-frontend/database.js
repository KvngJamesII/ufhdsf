const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'users.json');

class Database {
  constructor() {
    this.users = {};
    this.settings = {
      signupEnabled: true,
      adminId: 7648364004
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        this.users = data.users || {};
        this.settings = data.settings || { signupEnabled: true, adminId: 7648364004 };
        console.log('✅ Database loaded');
      } else {
        this.save();
        console.log('✅ New database created');
      }
    } catch (error) {
      console.error('Error loading database:', error);
      this.users = {};
      this.settings = { signupEnabled: true, adminId: 7648364004 };
    }
  }

  save() {
    try {
      const data = {
        users: this.users,
        settings: this.settings,
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  // Admin functions
  isAdmin(telegramId) {
    return telegramId.toString() === this.settings.adminId.toString();
  }

  toggleSignup() {
    this.settings.signupEnabled = !this.settings.signupEnabled;
    this.save();
    return this.settings.signupEnabled;
  }

  isSignupEnabled() {
    return this.settings.signupEnabled;
  }

  getAdminId() {
    return this.settings.adminId;
  }

  // Get user by Telegram ID
  getUserByTelegramId(telegramId) {
    return this.users[telegramId] || null;
  }

  // Create new user
  createUser(telegramId, username) {
    if (this.users[telegramId]) {
      return { success: false, error: 'User already exists' };
    }

    this.users[telegramId] = {
      telegramId,
      username,
      phone: null,
      isConnected: false,
      botProcess: null,
      pairingCode: null,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    this.save();
    return { success: true, user: this.users[telegramId] };
  }

  // Update user
  updateUser(telegramId, updates) {
    if (!this.users[telegramId]) {
      return { success: false, error: 'User not found' };
    }

    this.users[telegramId] = {
      ...this.users[telegramId],
      ...updates,
      lastActive: new Date().toISOString()
    };

    this.save();
    return { success: true, user: this.users[telegramId] };
  }

  // Delete user
  deleteUser(telegramId) {
    if (this.users[telegramId]) {
      delete this.users[telegramId];
      this.save();
      return { success: true };
    }
    return { success: false, error: 'User not found' };
  }

  // Get all users
  getAllUsers() {
    return Object.values(this.users);
  }

  // Get connected users
  getConnectedUsers() {
    return Object.values(this.users).filter(u => u.isConnected);
  }

  // Check if phone is already in use
  isPhoneInUse(phone, excludeTelegramId = null) {
    for (const [telegramId, user] of Object.entries(this.users)) {
      if (user.phone === phone && telegramId !== excludeTelegramId.toString()) {
        return true;
      }
    }
    return false;
  }
}

module.exports = new Database();
