const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

const execAsync = util.promisify(exec);

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 3001;
const ADMIN_USERNAME = 'idledev';
const ADMIN_PASSWORD = '200715';
const USERS_DIR = path.join(__dirname, '../users');
const MASTER_BOT_DIR = path.join(__dirname, '..');
const DB_FILE = path.join(__dirname, 'database.json');

// ============================================
// DATABASE (JSON)
// ============================================
class Database {
  constructor() {
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        this.users = data.users || {};
        this.settings = data.settings || { signupEnabled: true, maxUsers: 100 };
      } else {
        this.users = {};
        this.settings = { signupEnabled: true, maxUsers: 100 };
        this.save();
      }
      console.log('✅ Database loaded');
    } catch (error) {
      console.error('Error loading database:', error);
      this.users = {};
      this.settings = { signupEnabled: true, maxUsers: 100 };
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

  addUser(username, password, phone) {
    if (this.users[username]) {
      throw new Error('Username already exists');
    }

    for (const user in this.users) {
      if (this.users[user].phone === phone) {
        throw new Error('Phone number already registered');
      }
    }

    this.users[username] = {
      username,
      password,
      phone,
      isConnected: false,
      pm2Process: null,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    this.save();
    return this.users[username];
  }

  getUser(username) {
    return this.users[username] || null;
  }

  getUserByPhone(phone) {
    for (const username in this.users) {
      if (this.users[username].phone === phone) {
        return this.users[username];
      }
    }
    return null;
  }

  updateUser(username, updates) {
    if (!this.users[username]) return;
    this.users[username] = { ...this.users[username], ...updates, lastActive: new Date().toISOString() };
    this.save();
  }

  deleteUser(username) {
    if (this.users[username]) {
      delete this.users[username];
      this.save();
    }
  }

  getAllUsers() {
    return Object.values(this.users);
  }

  getActiveUsers() {
    return Object.values(this.users).filter(u => u.isConnected);
  }

  toggleSignups() {
    this.settings.signupEnabled = !this.settings.signupEnabled;
    this.save();
    return this.settings.signupEnabled;
  }

  isSignupEnabled() {
    return this.settings.signupEnabled !== false;
  }

  setMaxUsers(max) {
    this.settings.maxUsers = max;
    this.save();
  }

  getMaxUsers() {
    return this.settings.maxUsers || 100;
  }
}

const db = new Database();

// ============================================
// USER MANAGER (PM2)
// ============================================
class UserManager {
  static getUserDir(phone) {
    return path.join(USERS_DIR, `user_${phone}`);
  }

  static async createUserInstance(phone) {
    const userDir = this.getUserDir(phone);

    if (!fs.existsSync(USERS_DIR)) {
      fs.mkdirSync(USERS_DIR, { recursive: true });
    }

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const authDir = path.join(userDir, 'auth_info');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    return userDir;
  }

  static async startUserBot(phone) {
    const userDir = this.getUserDir(phone);
    const botScript = path.join(MASTER_BOT_DIR, 'bot.js');
    const processName = `luca-user-${phone}`;

    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      const existing = processes.find(p => p.name === processName);

      if (existing && existing.pm2_env.status === 'online') {
        return { success: true, processName, alreadyRunning: true };
      }

      await execAsync(`pm2 start "${botScript}" --name "${processName}" --cwd "${userDir}"`);
      await execAsync('pm2 save');

      console.log(`✅ Started bot for ${phone}`);
      return { success: true, processName };
    } catch (error) {
      throw error;
    }
  }

  static async stopUserBot(phone) {
    const processName = `luca-user-${phone}`;
    try {
      await execAsync(`pm2 stop ${processName}`);
      await execAsync(`pm2 delete ${processName}`);
      await execAsync('pm2 save');
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  static async deleteUserData(phone) {
    const userDir = this.getUserDir(phone);
    try {
      await this.stopUserBot(phone).catch(() => {});
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  static async getUserBotStatus(phone) {
    const processName = `luca-user-${phone}`;
    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      const process = processes.find(p => p.name === processName);

      if (!process) {
        return { running: false };
      }

      return {
        running: process.pm2_env.status === 'online',
        status: process.pm2_env.status,
        uptime: process.pm2_env.pm_uptime,
        restarts: process.pm2_env.restart_time,
        memory: process.monit.memory,
        cpu: process.monit.cpu
      };
    } catch (error) {
      return { running: false };
    }
  }

  static async getAllRunningBots() {
    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      return processes.filter(p => p.name.startsWith('luca-user-')).map(p => ({
        phone: p.name.replace('luca-user-', ''),
        status: p.pm2_env.status,
        uptime: p.pm2_env.pm_uptime,
        memory: p.monit.memory,
        cpu: p.monit.cpu
      }));
    } catch (error) {
      return [];
    }
  }

  static async restartAllBots() {
    try {
      await execAsync('pm2 restart all');
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  static async restartUserBot(phone) {
    const processName = `luca-user-${phone}`;
    try {
      await execAsync(`pm2 restart ${processName}`);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}

// ============================================
// PAIRING CODE GENERATOR
// ============================================
class PairingCodeGenerator {
  static activeSessions = new Map();

  static async generatePairingCode(phone) {
    try {
      const userDir = await UserManager.createUserInstance(phone);
      const authDir = path.join(userDir, 'auth_info');

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const logger = pino({ level: 'silent' });

      const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
      });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          sock.end();
          reject(new Error('Timeout'));
        }, 60000);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
          const { connection, qr } = update;

          if (qr) {
            try {
              const code = await sock.requestPairingCode(phone);
              clearTimeout(timeout);
              this.activeSessions.set(phone, sock);
              resolve({ success: true, code });
            } catch (err) {
              clearTimeout(timeout);
              sock.end();
              reject(err);
            }
          }

          if (connection === 'open') {
            console.log(`✅ User ${phone} connected`);

            const botDataPath = path.join(userDir, 'bot_data.json');
            const botData = {
              botOwner: phone,
              customWelcomeMessages: {},
              stickerCommands: {},
              adminSettings: {},
              userWarns: {},
              lastSaved: new Date().toISOString()
            };

            fs.writeFileSync(botDataPath, JSON.stringify(botData, null, 2));
            this.activeSessions.delete(phone);
          }
        });
      });
    } catch (error) {
      throw error;
    }
  }

  static async checkConnection(phone) {
    const userDir = UserManager.getUserDir(phone);
    const authDir = path.join(userDir, 'auth_info');
    const credsPath = path.join(authDir, 'creds.json');
    return fs.existsSync(credsPath);
  }
}

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'luca-bot-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
};

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, confirmPassword } = req.body;

    if (!username || !password || !confirmPassword) {
      return res.json({ success: false, error: 'All fields required' });
    }

    if (password !== confirmPassword) {
      return res.json({ success: false, error: 'Passwords do not match' });
    }

    if (username.length < 3) {
      return res.json({ success: false, error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.json({ success: false, error: 'Password must be at least 6 characters' });
    }

    if (!db.isSignupEnabled()) {
      return res.json({ success: false, error: 'Signups are currently disabled' });
    }

    if (db.getAllUsers().length >= db.getMaxUsers()) {
      return res.json({ success: false, error: 'Maximum user limit reached' });
    }

    db.addUser(username, password, null);

    req.session.user = username;
    req.session.isAdmin = false;

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;

    // Check admin login
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      req.session.user = username;
      req.session.isAdmin = true;
      return res.json({ success: true, isAdmin: true });
    }

    // Check regular user
    const user = db.getUser(username);
    if (!user || user.password !== password) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }

    req.session.user = username;
    req.session.isAdmin = false;

    res.json({ success: true, isAdmin: false });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    username: req.session.user,
    isAdmin: req.session.isAdmin || false
  });
});

// ============================================
// USER ROUTES
// ============================================
app.get('/api/user/info', requireAuth, (req, res) => {
  const user = db.getUser(req.session.user);
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }

  res.json({
    success: true,
    user: {
      username: user.username,
      phone: user.phone,
      isConnected: user.isConnected,
      createdAt: user.createdAt,
      lastActive: user.lastActive
    }
  });
});

app.post('/api/user/generate-code', requireAuth, async (req, res) => {
  try {
    const { phone } = req.body;
    const user = db.getUser(req.session.user);

    if (!phone || phone.length < 10) {
      return res.json({ success: false, error: 'Invalid phone number' });
    }

    if (user.phone && user.isConnected) {
      return res.json({ success: false, error: 'You already have a bot connected' });
    }

    // Check if phone already used
    const existingUser = db.getUserByPhone(phone);
    if (existingUser && existingUser.username !== req.session.user) {
      return res.json({ success: false, error: 'Phone number already in use' });
    }

    const result = await PairingCodeGenerator.generatePairingCode(phone);

    db.updateUser(req.session.user, { phone, pairingCode: result.code });

    res.json({ success: true, code: result.code });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/user/check-connection', requireAuth, async (req, res) => {
  try {
    const user = db.getUser(req.session.user);
    if (!user || !user.phone) {
      return res.json({ connected: false });
    }

    const isConnected = await PairingCodeGenerator.checkConnection(user.phone);

    if (isConnected && !user.isConnected) {
      // Start bot
      const result = await UserManager.startUserBot(user.phone);
      db.updateUser(req.session.user, {
        isConnected: true,
        pm2Process: result.processName
      });
    }

    res.json({ connected: isConnected });
  } catch (error) {
    res.json({ connected: false, error: error.message });
  }
});

app.get('/api/user/bot-status', requireAuth, async (req, res) => {
  try {
    const user = db.getUser(req.session.user);
    if (!user || !user.phone) {
      return res.json({ running: false });
    }

    const status = await UserManager.getUserBotStatus(user.phone);
    res.json(status);
  } catch (error) {
    res.json({ running: false, error: error.message });
  }
});

app.post('/api/user/restart-bot', requireAuth, async (req, res) => {
  try {
    const user = db.getUser(req.session.user);
    if (!user || !user.phone) {
      return res.json({ success: false, error: 'No bot connected' });
    }

    await UserManager.restartUserBot(user.phone);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/user/disconnect', requireAuth, async (req, res) => {
  try {
    const user = db.getUser(req.session.user);
    if (!user || !user.phone) {
      return res.json({ success: false, error: 'No bot connected' });
    }

    await UserManager.deleteUserData(user.phone);
    db.updateUser(req.session.user, {
      isConnected: false,
      pm2Process: null
    });

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const allUsers = db.getAllUsers();
    const runningBots = await UserManager.getAllRunningBots();

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    res.json({
      success: true,
      stats: {
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter(u => u.isConnected).length,
        todaySignups: allUsers.filter(u => u.createdAt.startsWith(today)).length,
        weekSignups: allUsers.filter(u => new Date(u.createdAt) >= weekAgo).length,
        runningBots: runningBots.length,
        signupEnabled: db.isSignupEnabled(),
        maxUsers: db.getMaxUsers()
      },
      users: allUsers.map(u => ({
        username: u.username,
        phone: u.phone,
        isConnected: u.isConnected,
        createdAt: u.createdAt
      })),
      runningBots
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/admin/toggle-signups', requireAdmin, (req, res) => {
  try {
    const enabled = db.toggleSignups();
    res.json({ success: true, signupEnabled: enabled });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/admin/set-max-users', requireAdmin, (req, res) => {
  try {
    const { max } = req.body;
    db.setMaxUsers(parseInt(max));
    res.json({ success: true, maxUsers: db.getMaxUsers() });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/admin/restart-all', requireAdmin, async (req, res) => {
  try {
    await UserManager.restartAllBots();
    res.json({ success: true, message: 'All bots restarted successfully' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/admin/disconnect-user', requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;
    const user = db.getUser(username);

    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }

    if (user.phone) {
      await UserManager.deleteUserData(user.phone);
    }

    db.deleteUser(username);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// SERVE HTML PAGES
// ============================================
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.isAdmin) {
      return res.redirect('/admin.html');
    }
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════╗');
  console.log('║   🤍 LUCA DASHBOARD 🤍       ║');
  console.log('╚══════════════════════════════╝');
  console.log('');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Access: http://localhost:${PORT}`);
  console.log(`👤 Admin: ${ADMIN_USERNAME}`);
  console.log(`📊 Max Users: ${db.getMaxUsers()}`);
  console.log(`📝 Signups: ${db.isSignupEnabled() ? 'Enabled' : 'Disabled'}`);
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n✅ Server stopped');
  process.exit(0);
});
