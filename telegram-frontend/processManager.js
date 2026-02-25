const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = util.promisify(exec);

const USERS_DIR = path.join(__dirname, '..', 'users');
const db = require('./database');
const BOT_SCRIPT = path.join(__dirname, '..', 'bot.js');

class ProcessManager {

  // Check if PM2 is available
  static async checkPM2() {
    try {
      await execAsync('pm2 -v');
      return true;
    } catch (error) {
      console.error('[PROCESS] PM2 not found! Please install PM2: npm install -g pm2');
      return false;
    }
  }

  // Start WhatsApp bot for a user using PM2
  static async startBot(phone) {
    try {
      const userDir = path.join(USERS_DIR, `user_${phone}`);
      const processName = `luca-user-${phone}`;

      // Check if PM2 is available
      const hasPM2 = await this.checkPM2();
      if (!hasPM2) {
        return { success: false, error: 'PM2 not installed' };
      }

      // Check if user directory exists
      if (!fs.existsSync(userDir)) {
        console.log(`[PROCESS] User directory not found for ${phone}`);
        return { success: false, error: 'User directory not found. Please complete pairing first.' };
      }

      // Check if already running
      try {
        const { stdout } = await execAsync('pm2 jlist');
        const processes = JSON.parse(stdout);
        const existing = processes.find(p => p.name === processName);

        if (existing && existing.pm2_env.status === 'online') {
          console.log(`[PROCESS] Bot for ${phone} already running`);
          return { success: true, alreadyRunning: true, processName };
        }

        // If exists but not online, delete it first
        if (existing) {
          await execAsync(`pm2 delete ${processName}`);
        }
      } catch (error) {
        // PM2 jlist failed, continue anyway
      }

      console.log(`[PROCESS] Starting bot for ${phone} with PM2...`);
      console.log(`[PROCESS] Working directory: ${userDir}`);
      console.log(`[PROCESS] Bot script: ${BOT_SCRIPT}`);
      console.log(`[PROCESS] Process name: ${processName}`);

      // Start with PM2
      await execAsync(`pm2 start "${BOT_SCRIPT}" --name "${processName}" --cwd "${userDir}" --time`);
      await execAsync('pm2 save');

      console.log(`[PROCESS] ✅ Bot started for ${phone} as PM2 process: ${processName}`);
      return { success: true, processName };

    } catch (error) {
      console.error(`[PROCESS] Error starting bot for ${phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Stop WhatsApp bot for a user
  static async stopBot(phone) {
    try {
      const processName = `luca-user-${phone}`;
      const hasPM2 = await this.checkPM2();

      if (!hasPM2) {
        return { success: false, error: 'PM2 not installed' };
      }

      console.log(`[PROCESS] Stopping bot for ${phone}...`);

      try {
        await execAsync(`pm2 stop ${processName}`);
        await execAsync(`pm2 delete ${processName}`);
        await execAsync('pm2 save');
        console.log(`[PROCESS] ✅ Bot stopped for ${phone}`);
        return { success: true };
      } catch (error) {
        // Process might not exist
        return { success: true };
      }

    } catch (error) {
      console.error(`[PROCESS] Error stopping bot for ${phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Restart WhatsApp bot for a user
  static async restartBot(phone) {
    try {
      const processName = `luca-user-${phone}`;
      const hasPM2 = await this.checkPM2();

      if (!hasPM2) {
        return { success: false, error: 'PM2 not installed' };
      }

      console.log(`[PROCESS] Restarting bot for ${phone}...`);

      try {
        await execAsync(`pm2 restart ${processName}`);
        console.log(`[PROCESS] ✅ Bot restarted for ${phone}`);
        return { success: true };
      } catch (error) {
        // If restart fails, try to start it
        console.log(`[PROCESS] Restart failed, attempting to start bot for ${phone}...`);
        return await this.startBot(phone);
      }

    } catch (error) {
      console.error(`[PROCESS] Error restarting bot for ${phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Get bot status
  static async getBotStatus(phone) {
    try {
      const processName = `luca-user-${phone}`;
      const hasPM2 = await this.checkPM2();

      if (!hasPM2) {
        return { running: false, status: 'pm2-not-found' };
      }

      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      const process = processes.find(p => p.name === processName);

      if (!process) {
        return {
          running: false,
          status: 'stopped'
        };
      }

      const uptime = Math.floor((Date.now() - process.pm2_env.pm_uptime) / 1000);

      return {
        running: process.pm2_env.status === 'online',
        status: process.pm2_env.status,
        pid: process.pid,
        uptime: uptime,
        uptimeFormatted: this.formatUptime(uptime),
        restarts: process.pm2_env.restart_time || 0,
        memory: process.monit ? process.monit.memory : 0,
        cpu: process.monit ? process.monit.cpu : 0
      };

    } catch (error) {
      return {
        running: false,
        status: 'error',
        error: error.message
      };
    }
  }

  // Get all running bots
  static async getAllRunningBots() {
    try {
      const hasPM2 = await this.checkPM2();

      if (!hasPM2) {
        return [];
      }

      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);

      // Filter only LUCA user bots
      const lucaBots = processes.filter(p => p.name.startsWith('luca-user-'));

      return lucaBots.map(p => {
        const phone = p.name.replace('luca-user-', '');
        const uptime = Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000);

        return {
          phone,
          pid: p.pid,
          uptime: uptime,
          restarts: p.pm2_env.restart_time || 0,
          status: p.pm2_env.status,
          memory: p.monit ? p.monit.memory : 0,
          cpu: p.monit ? p.monit.cpu : 0
        };
      });

    } catch (error) {
      console.error('[PROCESS] Error getting running bots:', error);
      return [];
    }
  }

  // Format uptime in human-readable format
  static formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }

  // Stop all bots
  static stopAllBots() {
    console.log('[PROCESS] Stopping all bots...');
    let stopped = 0;

    for (const phone of runningBots.keys()) {
      const result = this.stopBot(phone);
      if (result.success) stopped++;
    }

    return { success: true, stopped };
  }

  // Delete bot process and user folder
  static async deleteUserBotAndFolder(phone) {
    try {
      console.log(`[PROCESS] Permanently deleting bot and folder for ${phone}...`);
      
      // 1. Stop and delete PM2 process
      await this.stopBot(phone);

      // 2. Delete user folder
      const userDir = path.join(USERS_DIR, `user_${phone}`);
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
        console.log(`[PROCESS] Deleted folder: ${userDir}`);
      }

      // 3. Update database
      db.deleteUserByPhone(phone);

      return { success: true };
    } catch (error) {
      console.error(`[PROCESS] Error deleting bot and folder for ${phone}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Monitor bots and cleanup if limits exceeded
  static async monitorAndCleanupBots(notifyCallback) {
    try {
      const bots = await this.getAllRunningBots();
      const MEMORY_LIMIT = 1024 * 1024 * 1024; // 1GB in bytes
      const RESTART_LIMIT = 50;

      for (const bot of bots) {
        let reason = null;
        if (bot.memory > MEMORY_LIMIT) {
          reason = `Memory limit exceeded (${(bot.memory / (1024 * 1024)).toFixed(2)} MB > 1GB)`;
        } else if (bot.restarts > RESTART_LIMIT) {
          reason = `Restart limit exceeded (${bot.restarts} > ${RESTART_LIMIT})`;
        }

        if (reason) {
          console.log(`[PROCESS] Auto-cleaning bot ${bot.phone}: ${reason}`);
          const user = db.findUserByPhone(bot.phone);
          const telegramId = user ? user.telegramId : null;

          await this.deleteUserBotAndFolder(bot.phone);

          if (notifyCallback && telegramId) {
            notifyCallback(telegramId, `⚠️ *Your bot has been stopped and deleted.*\n\n*Reason:* ${reason}\n\nPlease contact admin if you think this is an error.`);
          }
          
          // Also notify admin
          const adminId = db.getAdminId();
          if (notifyCallback && adminId) {
            notifyCallback(adminId, `🛡️ *Auto-Cleanup Executed*\n\n*User:* ${bot.phone}\n*Reason:* ${reason}\n*Action:* Process stopped and folder deleted.`);
          }
        }
      }
    } catch (error) {
      console.error('[PROCESS] Error in monitorAndCleanupBots:', error);
    }
  }
}

module.exports = ProcessManager;
