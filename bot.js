const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Presence,
  downloadMediaMessage,
  downloadContentFromMessage,
} = require("@whiskeysockets/baileys");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const logger = pino({
  level: "info",
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

const adminSettings = {};
const stickerCommands = {};
const lockedGroups = new Set();
const userWarns = {};
const blockedUsers = {};
let BOT_OWNER = null; // Will be auto-detected from pairing

let botMode = "private";

// Anonymous messaging system
const ANONYMOUS_WEB_URL = "https://lucaanonym.vercel.app"; // Deployed Vercel URL
const anonymousSessions = new Map();
const axios = require('axios');

// Custom welcome messages per group
const customWelcomeMessages = {};

// Data file path
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// Load data from JSON file
const loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

      // Load bot owner
      if (data.botOwner) {
        BOT_OWNER = data.botOwner;
        logger.info({ owner: BOT_OWNER }, 'Bot owner loaded from saved data');
      }

      // Load custom welcome messages
      if (data.customWelcomeMessages) {
        Object.assign(customWelcomeMessages, data.customWelcomeMessages);
      }

      // Load sticker commands
      if (data.stickerCommands) {
        Object.assign(stickerCommands, data.stickerCommands);
      }

      // Load admin settings
      if (data.adminSettings) {
        Object.assign(adminSettings, data.adminSettings);
      }

      // Load user warns
      if (data.userWarns) {
        Object.assign(userWarns, data.userWarns);
      }

      logger.info('Bot data loaded successfully from JSON');
    } else {
      logger.info('No existing data file found, starting fresh');
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Error loading bot data');
  }
};

// Save data to JSON file
const saveData = () => {
  try {
    const data = {
      botOwner: BOT_OWNER,
      customWelcomeMessages,
      stickerCommands,
      adminSettings,
      userWarns,
      lastSaved: new Date().toISOString()
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.debug('Bot data saved to JSON');
  } catch (error) {
    logger.error({ error: error.message }, 'Error saving bot data');
  }
};

// Auto-save data every 5 minutes
setInterval(() => {
  saveData();
}, 5 * 60 * 1000);

const isOwnerNumber = (senderJid) => {
  if (!senderJid) {
    logger.debug('isOwnerNumber: senderJid is null/undefined');
    return false;
  }

  // Strip JID to just the number, removing any :X suffixes and @lid/@s.whatsapp.net
  let senderNumber = senderJid.split("@")[0];
  senderNumber = senderNumber.split(":")[0]; // Remove :8 or other suffixes

  // Log all checks for debugging
  logger.info({
    senderJid,
    senderNumber,
    BOT_OWNER,
    exactMatch: senderNumber === BOT_OWNER,
    includesMatch: senderJid.includes(BOT_OWNER),
  }, 'Owner check details');

  // Check if the sender number matches the owner
  // Also check if sender contains the owner number (for LID format)
  const isOwner = senderNumber === BOT_OWNER || senderJid.includes(BOT_OWNER);
  logger.info({ isOwner }, 'Owner check result');

  return isOwner;
};

const normalizeJid = (jid) => {
  if (!jid) return jid;
  const number = jid.split("@")[0];
  return `${number}@s.whatsapp.net`;
};

const isLinkMessage = (text) => {
  if (!text) return false;
  const linkPatterns = [
    /https?:\/\/[^\s]+/i,
    /www\.[^\s]+/i,
    /chat\.whatsapp\.com\/[^\s]+/i,
    /wa\.me\/[^\s]+/i,
    /t\.me\/[^\s]+/i,
    /discord\.gg\/[^\s]+/i,
    /bit\.ly\/[^\s]+/i,
    /tinyurl\.com\/[^\s]+/i
  ];
  return linkPatterns.some(pattern => pattern.test(text));
};

const fetchCryptoPrice = async (symbol) => {
  try {
    const upperSymbol = symbol.toUpperCase();

    // Map common symbols to CoinGecko IDs
    const symbolMap = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana',
      'DOGE': 'dogecoin',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'MATIC': 'matic-network',
      'LINK': 'chainlink',
      'XRP': 'ripple',
      'BNB': 'binancecoin',
      'AVAX': 'avalanche-2',
      'UNI': 'uniswap',
      'LTC': 'litecoin',
      'ATOM': 'cosmos',
      'NEAR': 'near',
      'FTM': 'fantom',
      'ALGO': 'algorand',
      'VET': 'vechain',
      'ICP': 'internet-computer',
      'APT': 'aptos',
      'ARB': 'arbitrum',
      'OP': 'optimism',
      'PEPE': 'pepe',
      'SHIB': 'shiba-inu',
      'COAI': 'coai',
      'TON': 'toncoin'
    };

    const coinId = symbolMap[upperSymbol] || upperSymbol.toLowerCase();

    // Fetch from CoinGecko
    const coingeckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    logger.info({ url: coingeckoUrl, coinId }, 'Trying CoinGecko API');
    let response = await fetch(coingeckoUrl);
    logger.info({ status: response.status, ok: response.ok }, 'CoinGecko API response status');

    if (response.ok) {
      const data = await response.json();
      logger.info({ fullData: data }, 'CoinGecko full API response');
      const cryptoData = data[coinId];
      if (cryptoData) {
        logger.info({ cryptoData }, 'CoinGecko parsed data');
        return {
          symbol: upperSymbol,
          lastPrice: cryptoData.usd,
          priceChangePercent: cryptoData.usd_24h_change || 0,
          volume: 0, // CoinGecko simple price doesn't provide volume directly
          marketCap: cryptoData.usd_market_cap || 0,
        };
      } else {
        logger.warn({ coinId, availableKeys: Object.keys(data) }, 'Coin ID not found in response');
      }
    } else {
      const errorText = await response.text();
      logger.warn({ status: response.status, error: errorText }, 'CoinGecko API failed');
    }

    logger.error({ symbol: upperSymbol, coinId }, 'No API returned valid data');
    return null;
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Crypto fetch error');
    return null;
  }
};


const extractViewOnceMedia = async (quoted) => {
  let viewOnceMsg = null;

  if (quoted?.viewOnceMessage) {
    viewOnceMsg = quoted.viewOnceMessage.message || quoted.viewOnceMessage;
  } else if (quoted?.viewOnceMessageV2) {
    viewOnceMsg = quoted.viewOnceMessageV2.message;
  } else if (quoted?.viewOnceMessageV2Extension) {
    viewOnceMsg = quoted.viewOnceMessageV2Extension.message;
  }

  if (!viewOnceMsg && quoted?.imageMessage) {
    viewOnceMsg = { imageMessage: quoted.imageMessage };
  } else if (!viewOnceMsg && quoted?.videoMessage) {
    viewOnceMsg = { videoMessage: quoted.videoMessage };
  }

  return viewOnceMsg;
};

const downloadViewOnceMedia = async (viewOnceMsg) => {
  const imageMsg = viewOnceMsg?.imageMessage;
  const videoMsg = viewOnceMsg?.videoMessage;

  if (!imageMsg && !videoMsg) return null;

  let mediaData = null;
  let mediaType = null;
  let caption = "";

  try {
    if (imageMsg) {
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      mediaData = buffer;
      mediaType = "image";
      caption = imageMsg.caption || "";
    } else if (videoMsg) {
      const stream = await downloadContentFromMessage(videoMsg, 'video');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      mediaData = buffer;
      mediaType = "video";
      caption = videoMsg.caption || "";
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Download view-once error');
    return null;
  }

  return { mediaData, mediaType, caption };
};

const convertToSticker = async (imageBuffer) => {
  try {
    const stickerBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ lossless: true })
      .toBuffer();
    return stickerBuffer;
  } catch (err) {
    logger.error({ error: err.message }, 'Sticker conversion error');
    return null;
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

// Anonymous messaging helper functions
const generateSessionId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let sessionId = '';
  for (let i = 0; i < 10; i++) {
    sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return sessionId;
};

const createAnonymousSession = async (groupJid) => {
  const sessionId = generateSessionId();

  try {
    // Create session on web server
    await axios.post(`${ANONYMOUS_WEB_URL}/api/session/create`, {
      sessionId,
      groupJid
    });

    // Store session locally
    anonymousSessions.set(sessionId, {
      groupJid,
      active: true,
      createdAt: Date.now(),
      messageCount: 0
    });

    logger.info({ sessionId, groupJid }, 'Anonymous session created');
    return sessionId;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to create anonymous session');
    return null;
  }
};

const endAnonymousSession = async (sessionId) => {
  try {
    // End session on web server
    await axios.post(`${ANONYMOUS_WEB_URL}/api/session/end`, {
      sessionId
    });

    // Remove session locally
    const session = anonymousSessions.get(sessionId);
    if (session) {
      session.active = false;
    }

    logger.info({ sessionId }, 'Anonymous session ended');
    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to end anonymous session');
    return false;
  }
};

const pollAnonymousMessages = async (sock) => {
  for (const [sessionId, session] of anonymousSessions.entries()) {
    if (!session.active) continue;

    try {
      const response = await axios.get(`${ANONYMOUS_WEB_URL}/api/messages/poll/${sessionId}`);
      const { messages } = response.data;

      for (const msg of messages) {
        await sock.sendMessage(session.groupJid, {
          text: `🎭 *Anonymous #${msg.number}*\n\n${msg.message}`
        });

        session.messageCount = msg.number;
      }
    } catch (error) {
      logger.error({ error: error.message, sessionId }, 'Failed to poll anonymous messages');
    }
  }
};

// VCF contact export helper function
const generateVCF = (contacts) => {
  let vcfContent = '';

  for (const contact of contacts) {
    const phoneNumber = contact.id.split('@')[0].replace(/:/g, '');
    const name = contact.notify || contact.name || phoneNumber;

    vcfContent += 'BEGIN:VCARD\n';
    vcfContent += 'VERSION:3.0\n';
    vcfContent += `FN:${name}\n`;
    vcfContent += `TEL;TYPE=CELL:+${phoneNumber}\n`;
    vcfContent += 'END:VCARD\n';
  }

  return vcfContent;
};

// Status media download helper function
const downloadStatusMedia = async (statusMessage) => {
  try {
    let mediaData = null;
    let mediaType = null;
    let caption = "";

    const imageMsg = statusMessage?.imageMessage;
    const videoMsg = statusMessage?.videoMessage;

    if (imageMsg) {
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      mediaData = buffer;
      mediaType = "image";
      caption = imageMsg.caption || "";
    } else if (videoMsg) {
      const stream = await downloadContentFromMessage(videoMsg, 'video');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      mediaData = buffer;
      mediaType = "video";
      caption = videoMsg.caption || "";
    }

    return { mediaData, mediaType, caption };
  } catch (error) {
    logger.error({ error: error.message }, 'Status download error');
    return null;
  }
};

const getMenu = () => `
╔══════════════════════════╗
║      🤍 *LUCA BOT* 🤍      ║
║  Built by TheIdleDeveloper  ║
╚══════════════════════════╝

┏━━━ *GROUP MANAGEMENT* ━━━┓

🔒 *.lock* - Lock group
🔓 *.open* - Unlock group
👢 *.kick* - Kick user (reply)
⚠️ *.warn* - Warn user (2 = auto kick)
⬆️ *.promote* - Make admin (reply)
⬇️ *.demote* - Remove admin (reply)
🚫 *.block* - Block user (reply)
✅ *.unblock* - Unblock user (number)

┗━━━━━━━━━━━━━━━━━━━━━┛

┏━━━ *CHAT MANAGEMENT* ━━━┓

🔗 *.antilink* on/off - Link filter
📢 *.tagall* - Tag all members
👻 *.hidetag* - Tag all (invisible)
🎭 *.anonymous* - Anonymous chat game
🛑 *.end* - End anonymous session
👋 *.setwelcome* [msg] - Custom welcome
   Use {user} to mention new members
   Example: .setwelcome Hey {user}! 👋
🔄 *.resetwelcome* - Default welcome

┗━━━━━━━━━━━━━━━━━━━━━┛

┏━━━ *STICKERS* ━━━┓

🖼️ *.sticker* - Image to sticker (reply)
🎪 *.setsticker* [cmd] - Sticker shortcuts
   Reply to sticker + command name
   Commands: save, vv, kick, lock, etc.
   Example: Reply to sticker, type
   ".setsticker save" - now use that
   sticker to save status instantly!

┗━━━━━━━━━━━━━━━━━━━━━┛

┏━━━ *UTILITIES* ━━━┓

👁️ *.vv* - Save view-once (reply)
💾 *.save* - Save status to DM (reply)
👤 *.get pp* - Get profile pic (reply)
📊 *.ping* - Check bot status
🗑️ *.delete* - Delete message (reply)
📇 *.vcf* - Export contacts (owner)

┗━━━━━━━━━━━━━━━━━━━━━┛

┏━━━ *CRYPTO* ━━━┓

💹 *.live* [coin] - Live crypto prices
   Example: .live btc, .live eth

┗━━━━━━━━━━━━━━━━━━━━━┛

┏━━━ *BOT SETTINGS* (Owner) ━━━┓

🔓 *.public* - Everyone can use bot
🔐 *.private* - Owner only mode
📋 *.menu* - Show this menu
ℹ️ *.help* - Bot information
🔗 *.join* [link] - Join group (owner)

┗━━━━━━━━━━━━━━━━━━━━━┛

📍 *Current Mode:* ${botMode.toUpperCase()}
⚡ *Use commands responsibly!*
`;

async function startBot() {
  // Load saved data on startup
  loadData();

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const socketLogger = pino({ 
    level: process.env.DEBUG_BAILEYS === 'true' ? 'debug' : 'warn',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  });

  const sock = makeWASocket({
    auth: state,
    logger: socketLogger,
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.clear();
      console.log("╔════════════════════════════════╗");
      console.log("║   📱 Enter Phone Number 📱    ║");
      console.log("╚════════════════════════════════╝\n");

      const phoneNumber = await askQuestion(
        "Enter your phone number (with country code, e.g., 1234567890): "
      );
      try {
        // Set the pairing phone number as bot owner if not already set
        if (!BOT_OWNER) {
          BOT_OWNER = phoneNumber;
          logger.info({ owner: BOT_OWNER }, 'Bot owner auto-detected from pairing');
        }

        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ Your pairing code: ${code}\n📌 Enter this in WhatsApp to connect`);
      } catch (err) {
        logger.error({ error: err.message }, 'Pairing code error');
      }
    }

    if (connection === "open") {
      console.clear();

      // Get the actual connected user's number
      const myNumber = sock.user.id.split(':')[0];

      // If BOT_OWNER is not set or different from connected number, update it
      if (!BOT_OWNER || BOT_OWNER !== myNumber) {
        BOT_OWNER = myNumber;
        saveData(); // Save the owner immediately
        logger.info({ owner: BOT_OWNER }, 'Bot owner auto-detected and saved');
      }

      const ownerJid = normalizeJid(BOT_OWNER);
      await sock.sendMessage(ownerJid, {
        text: "LUCA 1.0 Is Now Connected And Running✅🤍\nUse .menu to see the mainmenu",
      });
      console.log("╔════════════════════════════════╗");
      console.log("║   ✅ Connected Successfully!   ║");
      console.log("╚════════════════════════════════╝\n");
      console.log(`👤 Bot Owner: +${BOT_OWNER}\n`);
      logger.info({ owner: BOT_OWNER }, 'Bot connected and running');

      const myJid = sock.user.id;
      await sock.sendMessage(myJid, {
        text: `✅ *CONNECTION SUCCESSFUL*

🤖 KAIDO Bot is online!
Built by: Everybody Hates James

━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Quick Start:*
.menu - View all commands
.help - Bot information
.ping - Check status
.public/.private - Toggle mode

━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Mode: ${botMode.toUpperCase()}
Ready to manage! 🚀`,
      });

      // Start polling for anonymous messages every 3 seconds
      setInterval(() => {
        pollAnonymousMessages(sock).catch(err => {
          logger.error({ error: err.message }, 'Anonymous polling error');
        });
      }, 3000);
    }

    if (connection === "close") {
      if (
        lastDisconnect?.error?.output?.statusCode ===
        DisconnectReason.loggedOut
      ) {
        logger.error('Device logged out. Delete auth_info folder to reconnect.');
        process.exit(0);
      }
      logger.info('Connection closed, reconnecting...');
      setTimeout(() => startBot(), 3000);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("group-participants.update", async (update) => {
    logger.info({ update }, 'Group participants update received');
    const { id, participants, action } = update;
    const groupJid = id;

    if (action === 'add') {
      for (const participant of participants) {
        // Check if there's a custom welcome message for this group
        let welcomeMessage;

        if (customWelcomeMessages[groupJid]) {
          // Use custom welcome message and replace {user} with mention
          const username = participant.split('@')[0];
          welcomeMessage = customWelcomeMessages[groupJid].replace(/{user}/g, `@${username}`);
        } else {
          // Default welcome message
          welcomeMessage = `👋 *Welcome to the Group!*

Hello @${participant.split('@')[0]}, we're glad to have you here!

*LUCA🤍* is here to help. Type *.menu* to see all available commands.

Please read the group rules and enjoy your stay!`;
        }

        await sock.sendMessage(groupJid, {
          text: welcomeMessage,
          mentions: [participant]
        });
      }
    } else if (action === 'remove') {
      for (const participant of participants) {
        const goodbyeMessage = `👋 *Goodbye!*
        
@${participant.split('@')[0]} has left the group.
        
We hope to see you again soon!`;

        await sock.sendMessage(groupJid, {
          text: goodbyeMessage,
          mentions: [participant]
        });
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const message = m.messages[0];
      if (!message.message) return;

      const isGroup = message.key.remoteJid.endsWith("@g.us");
      const isDM = !isGroup;
      let sender = message.key.participant || message.key.remoteJid;
      const myJid = sock.user.id;
      const isSender = sender === myJid;

      let text = "";
      if (message.message.conversation)
        text = message.message.conversation;
      else if (message.message.extendedTextMessage)
        text = message.message.extendedTextMessage.text;

      // Debug logging for message context
      logger.info({
        isGroup,
        isDM,
        sender,
        remoteJid: message.key.remoteJid,
        fromMe: message.key.fromMe,
        myJid,
        BOT_OWNER,
      }, 'Message context');

      // Determine if this is the owner
      let isOwner = false;

      if (isDM) {
        // In self-DM (fromMe: true), the sender is a LID, but it's still the owner
        // Check if this is your own number or LID
        const isSelfDM = message.key.fromMe || 
                         message.key.remoteJid.includes(BOT_OWNER) ||
                         sender.includes(BOT_OWNER);

        if (isSelfDM) {
          isOwner = true;
          logger.info('Detected as owner (self-DM or owner number match)');
        } else {
          isOwner = isOwnerNumber(sender);
        }
      } else {
        // In groups, use standard owner check
        isOwner = isOwnerNumber(sender);
      }

      logger.info({ isOwner, isDM, isGroup }, 'Final owner determination');

      const fullCommand = text?.toLowerCase().trim().split(" ")[0];
      const command = fullCommand?.startsWith(".") ? fullCommand.slice(1) : fullCommand;
      const args = text?.trim().split(" ").slice(1);

      if (text && text.startsWith(".")) {
        logger.info({
          command,
          sender,
          isOwner,
          isDM,
          isGroup,
          botMode,
          remoteJid: message.key.remoteJid,
          fromMe: message.key.fromMe,
        }, 'Command detected');
      }

      if (isGroup) {
        const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
        const isAdmin = groupMetadata.participants.some(
          (p) =>
            p.id === sender &&
            (p.admin === "admin" || p.admin === "superadmin")
        );

        const botIsAdmin = groupMetadata.participants.some(
          (p) =>
            normalizeJid(p.id) === normalizeJid(myJid) &&
            (p.admin === "admin" || p.admin === "superadmin")
        );

        const settings = adminSettings[message.key.remoteJid];
        if (settings?.antilink && !isAdmin && !isOwner && !message.key.fromMe) {
          if (isLinkMessage(text)) {
            logger.info({ sender, group: message.key.remoteJid }, 'Link detected - taking action');

            // Delete the link message
            try {
              await sock.sendMessage(message.key.remoteJid, {
                delete: message.key
              });
              logger.info('Link message deleted');
            } catch (err) {
              logger.error({ error: err.message }, 'Failed to delete link message');
            }

            // Add warning to user
            const groupId = message.key.remoteJid;
            if (!userWarns[groupId]) userWarns[groupId] = {};
            if (!userWarns[groupId][sender]) userWarns[groupId][sender] = 0;

            userWarns[groupId][sender]++;
            const warnCount = userWarns[groupId][sender];
            saveData(); // Persist warnings

            const userNumber = sender.split("@")[0];

            // Check if user has 2 warnings
            if (warnCount >= 2) {
              // Try to kick user
              try {
                await sock.groupParticipantsUpdate(groupId, [sender], "remove");
                await sock.sendMessage(groupId, {
                  text: `🚫 *@${userNumber}* sent a link!\n\n⚠️ Received 2 warnings and has been removed from the group.`,
                  mentions: [sender]
                });
                delete userWarns[groupId][sender];
                saveData(); // Save after removing warn count
                logger.info({ sender }, 'User kicked for sending link (2 warnings)');
              } catch (err) {
                logger.error({ error: err.message }, 'Failed to kick user');
                await sock.sendMessage(groupId, {
                  text: `🚫 *@${userNumber}* sent a link and has 2 warnings!\n\n❌ Could not remove: Make sure bot is admin.`,
                  mentions: [sender]
                });
              }
            } else {
              // First warning
              await sock.sendMessage(groupId, {
                text: `🚫 *Link Detected!*\n\n⚠️ *Warning ${warnCount}/2* - @${userNumber}\n\n❌ Message deleted. Links are not allowed!\n⛔ One more warning = REMOVAL!`,
                mentions: [sender]
              });
            }
            return;
          }
        }

        const canUseBot = isOwner || (botMode === "public");

        if (command === "menu") {
          try {
            const menuImage = fs.readFileSync("./images/menu-image.jpg");
            await sock.sendMessage(message.key.remoteJid, {
              image: menuImage,
              caption: getMenu(),
            });
          } catch (err) {
            await sock.sendMessage(message.key.remoteJid, {
              text: getMenu(),
            });
          }
          return;
        }

        if (command === "ping") {
          const now = Date.now();
          await sock.sendMessage(message.key.remoteJid, {
            text: `📊 *PONG!*\n✅ Bot is online and responding\n⚡ Latency: ${Date.now() - now}ms\n🔧 Mode: ${botMode.toUpperCase()}`,
          });
          return;
        }

        if (command === "live") {
          const symbol = args[0];
          if (!symbol) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Usage: .live [symbol]\n\nExamples:\n.live btc\n.live eth\n.live sol\n.live coai",
            });
            return;
          }

          await sock.sendMessage(message.key.remoteJid, {
            react: { text: "⏳", key: message.key },
          });

          const data = await fetchCryptoPrice(symbol);

          if (!data) {
            const upperSym = symbol.toUpperCase();

            await sock.sendMessage(message.key.remoteJid, {
              text: `❌ Could not find data for *${upperSym}*

💡 *Tips:*
• Check if the symbol is correct
• The coin might not be listed on CoinGecko
• Try popular coins like: BTC, ETH, SOL, TON, BNB, ADA, XRP, DOGE, MATIC, DOT

🔍 *How to add new coins:*
If you know the CoinGecko ID for ${upperSym}, contact the bot owner to add it.

Example: Search "coingecko ${upperSym}" to find the correct ID.`,
            });
            return;
          }

          const price = parseFloat(data.lastPrice).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8
          });
          const change24h = parseFloat(data.priceChangePercent).toFixed(2);
          const volume = parseFloat(data.volume).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          });
          const marketCap = parseFloat(data.marketCap).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          });
          const changeEmoji = change24h >= 0 ? "📈" : "📉";
          const changeSign = change24h >= 0 ? "+" : "";

          await sock.sendMessage(message.key.remoteJid, {
            text: `💹 *${data.symbol}* Live Price

💰 *Price:* $${price}
${changeEmoji} *24h Change:* ${changeSign}${change24h}%

📊 *24h Stats:*
📦 Volume: $${volume}
💎 Market Cap: $${marketCap}

⏰ Updated: ${new Date().toLocaleTimeString()}
📡 Source: CoinGecko`,
          });

          await sock.sendMessage(message.key.remoteJid, {
            react: { text: "✅", key: message.key },
          });
          return;
        }

        if (command === "public") {
          if (!isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only the bot owner can change bot mode!",
            });
            return;
          }
          botMode = "public";
          await sock.sendMessage(message.key.remoteJid, {
            text: "✅ Bot is now *PUBLIC*\n\nAll users can now use bot commands!",
          });
          logger.info('Bot mode changed to PUBLIC');
          return;
        }

        if (command === "private") {
          if (!isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only the bot owner can change bot mode!",
            });
            return;
          }
          botMode = "private";
          await sock.sendMessage(message.key.remoteJid, {
            text: "🔐 Bot is now *PRIVATE*\n\nOnly the owner can use bot commands!",
          });
          logger.info('Bot mode changed to PRIVATE');
          return;
        }

        if (command === "tagall" && canUseBot) {
          let mentions = [];
          let tagText = "👥 *Group Members:*\n\n";

          for (let member of groupMetadata.participants) {
            mentions.push(member.id);
            tagText += `@${member.id.split("@")[0]}\n`;
          }

          await sock.sendMessage(
            message.key.remoteJid,
            { text: tagText, mentions },
            { quoted: message }
          );
          return;
        }

        if (command === "hidetag" && canUseBot) {
          try {
            let mentions = [];
            for (let member of groupMetadata.participants) {
              mentions.push(member.id);
            }

            await sock.sendMessage(message.key.remoteJid, {
              text: ".",
              mentions,
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });

            setTimeout(async () => {
              try {
                await sock.sendMessage(message.key.remoteJid, {
                  react: { text: "", key: message.key },
                });
              } catch (err) {
                logger.error({ error: err.message }, 'Error removing reaction');
              }
            }, 5000);
          } catch (err) {
            logger.error({ error: err.message }, 'Hidetag error');
          }
          return;
        }

        if (!canUseBot && text && text.startsWith(".")) {
          return;
        }

        if (command === "setsticker" && canUseBot) {
          const cmdName = args[0]?.toLowerCase();
          const sticker = message.message.extendedTextMessage?.contextInfo
            ?.quotedMessage?.stickerMessage;

          if (!sticker || !cmdName) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a sticker with *.setsticker [command]*\n\nSupported: kick, open, lock, vv, hidetag, pp, sticker, save",
            });
            return;
          }

          if (!["kick", "open", "lock", "vv", "hidetag", "pp", "sticker", "save"].includes(cmdName)) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Supported commands: kick, open, lock, vv, hidetag, pp, sticker, save",
            });
            return;
          }

          if (cmdName === "sticker") {
            stickerCommands[cmdName] = { type: "sticker_converter", hash: sticker.fileSha256?.toString('base64') };
            saveData(); // Persist to JSON
            await sock.sendMessage(message.key.remoteJid, {
              text: `✅ Sticker set to *STICKER CONVERTER*!\n\nNow reply with this sticker to an image to convert it to a sticker!`,
            });
            return;
          }

          const stickerHash = sticker.fileSha256?.toString('base64');
          stickerCommands[cmdName] = stickerHash || true;
          saveData(); // Persist to JSON

          let successMsg = `✅ Sticker set to *${cmdName.toUpperCase()}*!`;
          await sock.sendMessage(message.key.remoteJid, { text: successMsg });
          logger.info({ command: cmdName }, 'Sticker command set');
          return;
        }

        if (command === "sticker" && canUseBot) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to an image with *.sticker*",
              });
              return;
            }

            const imageMsg = quoted?.imageMessage;
            if (!imageMsg) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to an image only!",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            const stickerBuffer = await convertToSticker(buffer);
            if (!stickerBuffer) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Failed to convert image to sticker",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              sticker: stickerBuffer,
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info('Sticker created successfully');
          } catch (err) {
            logger.error({ error: err.message, stack: err.stack }, 'Sticker error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to create sticker: " + err.message,
            });
          }
          return;
        }

if (command === "vv" && canUseBot) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Usage Error:*\n\nReply to a view-once photo or video with the command *.vv* to save it.",
              });
              return;
            }

            const viewOnceMsg = await extractViewOnceMedia(quoted);
            if (!viewOnceMsg) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Invalid Message:*\n\nThe message you replied to is not a view-once photo or video. Please check and try again.",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            const media = await downloadViewOnceMedia(viewOnceMsg);
            if (!media || !media.mediaData) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Download Failed:*\n\nCould not download the view-once media. It might have expired, been deleted, or there was a network issue. Try again immediately.",
              });
              return;
            }

            // Send the media back as a regular message to the current chat
            const sendOptions = {
              caption: `✅ *LUCA View-Once Saver*\n\nOriginal Caption: ${media.caption || 'None'}`,
            };

            if (media.mediaType === "image") {
              sendOptions.image = media.mediaData;
            } else if (media.mediaType === "video") {
              sendOptions.video = media.mediaData;
            }

            await sock.sendMessage(message.key.remoteJid, sendOptions, {
              quoted: message,
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });

          } catch (error) {
            logger.error({ error: error.message, stack: error.stack }, 'VV command error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ *System Error:*\n\nAn unexpected error occurred while processing your request. Please report this to the bot owner with the command you used.",
            });
          }
          return;
        }

        if (command === "save" && canUseBot) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Usage Error:*\n\nReply to a status (image/video) with *.save* to download it.",
              });
              return;
            }

            // Check if this is a status message
            const imageMsg = quoted?.imageMessage;
            const videoMsg = quoted?.videoMessage;

            if (!imageMsg && !videoMsg) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Invalid Message:*\n\nPlease reply to a status image or video with *.save*",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            // Download the status media
            const media = await downloadStatusMedia(quoted);

            if (!media || !media.mediaData) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Download Failed:*\n\nCould not download the status media. Please try again.",
              });
              return;
            }

            // Get sender's JID for DM
            const senderJid = normalizeJid(sender);

            // Send the media to user's DM
            const sendOptions = {
              caption: `💾 *Status Saved!*\n\n${media.caption ? `Original Caption: ${media.caption}` : 'No caption'}\n\n✅ Downloaded via LUCA Bot`,
            };

            if (media.mediaType === "image") {
              sendOptions.image = media.mediaData;
            } else if (media.mediaType === "video") {
              sendOptions.video = media.mediaData;
            }

            await sock.sendMessage(senderJid, sendOptions);

            // Send success reaction in group
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });

            // Notify in group
            await sock.sendMessage(message.key.remoteJid, {
              text: `✅ Status saved and sent to your DM!`,
            }, { quoted: message });

            logger.info({ sender: senderJid, mediaType: media.mediaType }, 'Status saved');

          } catch (error) {
            logger.error({ error: error.message, stack: error.stack }, 'Save command error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ *System Error:*\n\nFailed to save status. Please try again or contact the bot owner.",
            });
          }
          return;
        }

        if (message.message.stickerMessage && !text && canUseBot) {
          const stickerHash = message.message.stickerMessage.fileSha256?.toString('base64');

          for (const [cmdName, hash] of Object.entries(stickerCommands)) {
            if (hash === stickerHash || hash === true || (typeof hash === 'object' && hash.hash === stickerHash)) {
              logger.info({ command: cmdName }, 'Sticker command triggered');

              if (cmdName === "vv") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo || !contextInfo.quotedMessage) return;

                  const quoted = contextInfo.quotedMessage;
                  const viewOnceMsg = await extractViewOnceMedia(quoted);
                  if (!viewOnceMsg) return;

                  const media = await downloadViewOnceMedia(viewOnceMsg);
                  if (!media) return;

                  const ownerJid = BOT_OWNER + "@s.whatsapp.net";
                  if (media.mediaType === "image") {
                    await sock.sendMessage(ownerJid, {
                      image: media.mediaData,
                      caption: media.caption || "View-once photo saved (via sticker)",
                    });
                  } else if (media.mediaType === "video") {
                    await sock.sendMessage(ownerJid, {
                      video: media.mediaData,
                      caption: media.caption || "View-once video saved (via sticker)",
                    });
                  }

                  await sock.sendMessage(message.key.remoteJid, {
                    react: { text: "✅", key: message.key },
                  });

                  setTimeout(async () => {
                    try {
                      await sock.sendMessage(message.key.remoteJid, {
                        react: { text: "", key: message.key },
                      });
                    } catch (err) {}
                  }, 5000);
                } catch (err) {
                  logger.error({ error: err.message }, 'Sticker vv error');
                }
                return;
              } else if (cmdName === "hidetag") {
                try {
                  let mentions = [];
                  for (let member of groupMetadata.participants) {
                    mentions.push(member.id);
                  }

                  await sock.sendMessage(message.key.remoteJid, {
                    text: ".",
                    mentions,
                  });

                  await sock.sendMessage(message.key.remoteJid, {
                    react: { text: "✅", key: message.key },
                  });

                  setTimeout(async () => {
                    try {
                      await sock.sendMessage(message.key.remoteJid, {
                        react: { text: "", key: message.key },
                      });
                    } catch (err) {}
                  }, 5000);
                } catch (err) {
                  logger.error({ error: err.message }, 'Sticker hidetag error');
                }
                return;
              } else if (cmdName === "pp") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo || !contextInfo.participant) return;

                  let targetJid = normalizeJid(contextInfo.participant);
                  let ppUrl = null;

                  try {
                    ppUrl = await sock.profilePictureUrl(targetJid, "image");
                  } catch (err1) {
                    try {
                      ppUrl = await sock.profilePictureUrl(targetJid, "display");
                    } catch (err2) {}
                  }

                  if (ppUrl) {
                    await sock.sendMessage(message.key.remoteJid, {
                      image: { url: ppUrl },
                      caption: `Profile: @${targetJid.split("@")[0]}`,
                      mentions: [targetJid]
                    });
                  } else {
                    await sock.sendMessage(message.key.remoteJid, {
                      text: "❌ Profile picture is private or unavailable",
                    });
                  }
                } catch (err) {
                  logger.error({ error: err.message }, 'Sticker pp error');
                }
                return;
              } else if (cmdName === "sticker") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo?.quotedMessage?.imageMessage) return;

                  const imageMsg = contextInfo.quotedMessage.imageMessage;
                  const stream = await downloadContentFromMessage(imageMsg, 'image');
                  let buffer = Buffer.from([]);
                  for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                  }

                  const stickerBuffer = await convertToSticker(buffer);
                  if (stickerBuffer) {
                    await sock.sendMessage(message.key.remoteJid, {
                      sticker: stickerBuffer,
                    });
                  }
                } catch (err) {
                  logger.error({ error: err.message }, 'Sticker converter error');
                }
                return;
              } else if (cmdName === "save") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo || !contextInfo.quotedMessage) return;

                  const quoted = contextInfo.quotedMessage;
                  const imageMsg = quoted?.imageMessage;
                  const videoMsg = quoted?.videoMessage;

                  if (!imageMsg && !videoMsg) return;

                  // Download the status media
                  const media = await downloadStatusMedia(quoted);
                  if (!media || !media.mediaData) return;

                  // Get sender's JID for DM
                  const senderJid = normalizeJid(sender);

                  // Send the media to user's DM
                  const sendOptions = {
                    caption: `💾 *Status Saved!*\n\n${media.caption ? `Original Caption: ${media.caption}` : 'No caption'}\n\n✅ Downloaded via LUCA Bot (Sticker)`,
                  };

                  if (media.mediaType === "image") {
                    sendOptions.image = media.mediaData;
                  } else if (media.mediaType === "video") {
                    sendOptions.video = media.mediaData;
                  }

                  await sock.sendMessage(senderJid, sendOptions);

                  // Send success reaction
                  await sock.sendMessage(message.key.remoteJid, {
                    react: { text: "✅", key: message.key },
                  });

                  setTimeout(async () => {
                    try {
                      await sock.sendMessage(message.key.remoteJid, {
                        react: { text: "", key: message.key },
                      });
                    } catch (err) {}
                  }, 3000);

                  logger.info({ sender: senderJid }, 'Status saved via sticker');
                } catch (err) {
                  logger.error({ error: err.message }, 'Sticker save error');
                }
                return;
              } else if (isAdmin || isOwner) {
                if (cmdName === "kick") {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  const targetJid = contextInfo?.participant;

                  if (targetJid && botIsAdmin) {
                    try {
                      await sock.groupParticipantsUpdate(message.key.remoteJid, [targetJid], "remove");
                      await sock.sendMessage(message.key.remoteJid, {
                        react: { text: "✅", key: message.key },
                      });
                    } catch (err) {
                      logger.error({ error: err.message }, 'Sticker kick error');
                    }
                  }
                  return;
                } else if (cmdName === "open") {
                  try {
                    lockedGroups.delete(message.key.remoteJid);
                    await sock.groupSettingUpdate(message.key.remoteJid, "not_announcement");
                    await sock.sendMessage(message.key.remoteJid, {
                      react: { text: "✅", key: message.key },
                    });
                  } catch (err) {
                    logger.error({ error: err.message }, 'Sticker open error');
                  }
                  return;
                } else if (cmdName === "lock") {
                  try {
                    lockedGroups.add(message.key.remoteJid);
                    await sock.groupSettingUpdate(message.key.remoteJid, "announcement");
                    await sock.sendMessage(message.key.remoteJid, {
                      react: { text: "✅", key: message.key },
                    });
                  } catch (err) {
                    logger.error({ error: err.message }, 'Sticker lock error');
                  }
                  return;
                }
              }
            }
          }
          return;
        }

        if (!isAdmin && !isOwner) return;

        if (command === "lock") {
          if (!botIsAdmin) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Bot needs to be admin to lock the group!",
            });
            return;
          }
          try {
            lockedGroups.add(message.key.remoteJid);
            await sock.groupSettingUpdate(message.key.remoteJid, "announcement");
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info({ group: message.key.remoteJid }, 'Group locked');
          } catch (err) {
            logger.error({ error: err.message }, 'Lock error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to lock group: " + err.message,
            });
          }
          return;
        }

        if (command === "open") {
          if (!botIsAdmin) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Bot needs to be admin to open the group!",
            });
            return;
          }
          try {
            lockedGroups.delete(message.key.remoteJid);
            await sock.groupSettingUpdate(message.key.remoteJid, "not_announcement");
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info({ group: message.key.remoteJid }, 'Group opened');
          } catch (err) {
            logger.error({ error: err.message }, 'Open error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to open group: " + err.message,
            });
          }
          return;
        }

        if (command === "get" && args[0]?.toLowerCase() === "pp") {
          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a user's message to get their profile picture",
            });
            return;
          }

          let targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (!targetJid) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Could not identify the user",
            });
            return;
          }

          targetJid = normalizeJid(targetJid);

          try {
            let ppUrl = null;
            try {
              ppUrl = await sock.profilePictureUrl(targetJid, "image");
            } catch (err1) {
              try {
                ppUrl = await sock.profilePictureUrl(targetJid, "display");
              } catch (err2) {}
            }

            if (ppUrl) {
              await sock.sendMessage(message.key.remoteJid, {
                image: { url: ppUrl },
                caption: `Profile: @${targetJid.split("@")[0]}`,
                mentions: [targetJid]
              });
            } else {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Profile picture is private or unavailable",
              });
            }
          } catch (err) {
            logger.error({ error: err.message }, 'Get PP error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Error: " + err.message,
            });
          }
          return;
        }

        if (command === "kick") {
          if (!botIsAdmin) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Bot needs to be admin to kick users!",
            });
            return;
          }

          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a message to kick that user",
            });
            return;
          }

          const targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (targetJid) {
            try {
              await sock.groupParticipantsUpdate(message.key.remoteJid, [targetJid], "remove");
              await sock.sendMessage(message.key.remoteJid, {
                react: { text: "✅", key: message.key },
              });
              logger.info({ target: targetJid }, 'User kicked');
            } catch (err) {
              logger.error({ error: err.message }, 'Kick error');
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Failed to kick user: " + err.message,
              });
            }
          }
          return;
        }

        if (command === "warn") {
          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a user's message to warn them",
            });
            return;
          }

          const targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (!targetJid) return;

          const groupId = message.key.remoteJid;
          if (!userWarns[groupId]) userWarns[groupId] = {};
          if (!userWarns[groupId][targetJid]) userWarns[groupId][targetJid] = 0;

          userWarns[groupId][targetJid]++;
          const warnCount = userWarns[groupId][targetJid];
          saveData(); // Persist warnings

          if (warnCount >= 2) {
            // Always try to kick, check for errors
            try {
              await sock.groupParticipantsUpdate(groupId, [targetJid], "remove");
              await sock.sendMessage(groupId, {
                text: `⚠️ *@${targetJid.split("@")[0]}* received 2 warnings and has been kicked!`,
                mentions: [targetJid]
              });
              delete userWarns[groupId][targetJid];
              saveData(); // Save after removing warn count
              logger.info({ target: targetJid }, 'User kicked after 2 warnings');
            } catch (err) {
              logger.error({ error: err.message }, 'Auto-kick error');
              await sock.sendMessage(groupId, {
                text: `⚠️ *@${targetJid.split("@")[0]}* has 2 warnings!\n\n❌ Could not kick: ${err.message}\n\nMake sure bot is admin with kick permissions.`,
                mentions: [targetJid]
              });
            }
          } else {
            await sock.sendMessage(groupId, {
              text: `⚠️ *Warning ${warnCount}/2* - @${targetJid.split("@")[0]}\n\n⛔ One more warning = KICK!`,
              mentions: [targetJid]
            });
          }
          return;
        }

        if (command === "promote") {
          if (!botIsAdmin) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Bot needs to be admin to promote users!",
            });
            return;
          }

          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a user's message to promote them",
            });
            return;
          }

          const targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (!targetJid) return;

          try {
            await sock.groupParticipantsUpdate(message.key.remoteJid, [targetJid], "promote");
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info({ target: targetJid }, 'User promoted');
          } catch (err) {
            logger.error({ error: err.message }, 'Promote error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to promote user",
            });
          }
          return;
        }

        if (command === "demote") {
          if (!botIsAdmin) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Bot needs to be admin to demote users!",
            });
            return;
          }

          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a user's message to demote them",
            });
            return;
          }

          const targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (!targetJid) return;

          try {
            await sock.groupParticipantsUpdate(message.key.remoteJid, [targetJid], "demote");
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info({ target: targetJid }, 'User demoted');
          } catch (err) {
            logger.error({ error: err.message }, 'Demote error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to demote user",
            });
          }
          return;
        }

        if (command === "block") {
          const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Reply to a user's message to block them",
            });
            return;
          }

          const targetJid = message.message.extendedTextMessage?.contextInfo?.participant;
          if (!targetJid) return;

          if (!blockedUsers[myJid]) blockedUsers[myJid] = new Set();
          blockedUsers[myJid].add(targetJid);

          await sock.sendMessage(message.key.remoteJid, {
            react: { text: "✅", key: message.key },
          });
          logger.info({ target: targetJid }, 'User blocked');
          return;
        }

        if (command === "unblock") {
          if (args.length < 1) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Usage: .unblock [number]\n\nExample: .unblock 1234567890",
            });
            return;
          }

          const phoneNumber = args[0];
          const targetJid = phoneNumber + "@s.whatsapp.net";

          if (blockedUsers[myJid]?.has(targetJid)) {
            blockedUsers[myJid].delete(targetJid);
            await sock.sendMessage(message.key.remoteJid, {
              text: `✅ User ${phoneNumber} unblocked`,
            });
            logger.info({ target: targetJid }, 'User unblocked');
          } else {
            await sock.sendMessage(message.key.remoteJid, {
              text: `❌ User not found in blocked list`,
            });
          }
          return;
        }

        if (command === "antilink") {
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ This command is for admins only!",
            });
            return;
          }

          const action = args[0]?.toLowerCase();

          if (!action || (action !== "on" && action !== "off")) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Usage: .antilink on/off\n\nExample:\n.antilink on - Enable link protection\n.antilink off - Disable link protection",
            });
            return;
          }

          if (!adminSettings[message.key.remoteJid]) {
            adminSettings[message.key.remoteJid] = {};
          }

          const isOn = action === "on";
          adminSettings[message.key.remoteJid].antilink = isOn;
          saveData(); // Persist to JSON

          const status = isOn ? "✅ *ENABLED*" : "❌ *DISABLED*";
          const messageText = isOn
            ? `🔗 Antilink ${status}\n\n⚠️ *How it works:*\n• User sends link → Message deleted + Warning 1/2\n• User sends another link → Warning 2/2 + REMOVED!\n\n${botIsAdmin ? "✅ Bot is admin - ready to enforce!" : "⚠️ Make bot admin to enable auto-kick!"}`
            : `🔗 Antilink ${status}\n\nUsers can send links freely.`;

          await sock.sendMessage(message.key.remoteJid, {
            text: messageText,
          });
          logger.info({ group: message.key.remoteJid, enabled: isOn }, 'Antilink toggled');
          return;
        }

        if (command === "setwelcome") {
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only admins can set custom welcome messages!",
            });
            return;
          }

          // Get the welcome message (everything after .setwelcome)
          const welcomeText = text.split(' ').slice(1).join(' ').trim();

          if (!welcomeText) {
            await sock.sendMessage(message.key.remoteJid, {
              text: `❌ *Usage Error!*

📝 *How to set welcome message:*

.setwelcome [your message]

*Available variables:*
• {user} - Mentions the new member

*Examples:*

.setwelcome Welcome {user}! 👋 Please read the rules.

.setwelcome Hey {user}! 🎉 We're happy to have you here! Type .menu to see bot commands.

.setwelcome 🌟 {user} just joined! Welcome to the best group ever!

*Note:* Use {user} where you want to mention the new member.`,
            });
            return;
          }

          // Save the custom welcome message for this group
          customWelcomeMessages[message.key.remoteJid] = welcomeText;
          saveData(); // Persist to JSON

          await sock.sendMessage(message.key.remoteJid, {
            text: `✅ *Custom Welcome Message Set!*

📝 *Preview:*
${welcomeText.replace(/{user}/g, '@YourName')}

✨ New members will see this message when they join!

*Tip:* Use *.resetwelcome* to restore default message.`,
          });

          logger.info({
            group: message.key.remoteJid,
            welcomeMessage: welcomeText
          }, 'Custom welcome message set');
          return;
        }

        if (command === "resetwelcome") {
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only admins can reset welcome messages!",
            });
            return;
          }

          if (!customWelcomeMessages[message.key.remoteJid]) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "ℹ️ This group is already using the default welcome message!",
            });
            return;
          }

          // Remove custom welcome message
          delete customWelcomeMessages[message.key.remoteJid];
          saveData(); // Persist to JSON

          await sock.sendMessage(message.key.remoteJid, {
            text: `🔄 *Welcome Message Reset!*

✅ Restored to default LUCA welcome message.

New members will now see:
👋 *Welcome to the Group!*

Hello @YourName, we're glad to have you here!

*LUCA🤍* is here to help. Type *.menu* to see all available commands.

Please read the group rules and enjoy your stay!

*Tip:* Use *.setwelcome* to set a custom message again.`,
          });

          logger.info({ group: message.key.remoteJid }, 'Welcome message reset to default');
          return;
        }

        if (command === "anonymous") {
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only admins can start anonymous sessions!",
            });
            return;
          }

          // Check if there's already an active session for this group
          let existingSessionId = null;
          for (const [sessionId, session] of anonymousSessions.entries()) {
            if (session.groupJid === message.key.remoteJid && session.active) {
              existingSessionId = sessionId;
              break;
            }
          }

          if (existingSessionId) {
            await sock.sendMessage(message.key.remoteJid, {
              text: `⚠️ *Anonymous session already active!*\n\n🔗 Link: ${ANONYMOUS_WEB_URL}/${existingSessionId}\n\nUse *.end* to close the current session.`,
            });
            return;
          }

          try {
            // Lock the group
            if (botIsAdmin) {
              await sock.groupSettingUpdate(message.key.remoteJid, "announcement");
              lockedGroups.add(message.key.remoteJid);
            }

            // Create anonymous session
            const sessionId = await createAnonymousSession(message.key.remoteJid);

            if (!sessionId) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Failed to create anonymous session. Make sure the web server is running!",
              });
              return;
            }

            const sessionLink = `${ANONYMOUS_WEB_URL}/${sessionId}`;

            await sock.sendMessage(message.key.remoteJid, {
              text: `🎭 *Anonymous Game Started!*

${botIsAdmin ? '🔒 Group is now locked' : '⚠️ Bot needs admin rights to lock group'}

🔗 *Send your anonymous messages here:*
${sessionLink}

━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *How it works:*
• Click the link above
• Type your message
• It will be posted here anonymously

━━━━━━━━━━━━━━━━━━━━━━━━━━

🛑 To end this session, use *.end*`,
            });

            logger.info({ sessionId, groupJid: message.key.remoteJid }, 'Anonymous session started');
          } catch (error) {
            logger.error({ error: error.message }, 'Anonymous command error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to start anonymous session: " + error.message,
            });
          }
          return;
        }

        if (command === "end") {
          if (!isAdmin && !isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only admins can end anonymous sessions!",
            });
            return;
          }

          // Find active session for this group
          let activeSessionId = null;
          for (const [sessionId, session] of anonymousSessions.entries()) {
            if (session.groupJid === message.key.remoteJid && session.active) {
              activeSessionId = sessionId;
              break;
            }
          }

          if (!activeSessionId) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ No active anonymous session found in this group!",
            });
            return;
          }

          try {
            // End the session
            await endAnonymousSession(activeSessionId);

            // Unlock the group
            if (botIsAdmin) {
              await sock.groupSettingUpdate(message.key.remoteJid, "not_announcement");
              lockedGroups.delete(message.key.remoteJid);
            }

            const session = anonymousSessions.get(activeSessionId);
            const messageCount = session?.messageCount || 0;

            await sock.sendMessage(message.key.remoteJid, {
              text: `🛑 *Anonymous Session Ended!*

${botIsAdmin ? '🔓 Group is now unlocked' : ''}

📊 *Session Stats:*
• Total Messages: ${messageCount}
• Session ID: ${activeSessionId}

The anonymous link is no longer active.
Thank you for participating! 🎭`,
            });

            logger.info({ sessionId: activeSessionId, messageCount }, 'Anonymous session ended');
          } catch (error) {
            logger.error({ error: error.message }, 'End command error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to end anonymous session: " + error.message,
            });
          }
          return;
        }

        if (command === "delete") {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to a message to delete it",
              });
              return;
            }

            const quotedKey = {
              remoteJid: message.key.remoteJid,
              fromMe: false,
              id: message.message.extendedTextMessage?.contextInfo?.stanzaId,
              participant: message.message.extendedTextMessage?.contextInfo?.participant
            };

            await sock.sendMessage(message.key.remoteJid, {
              delete: quotedKey
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
            logger.info('Message deleted');
          } catch (err) {
            logger.error({ error: err.message }, 'Delete error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to delete message: " + err.message,
            });
          }
          return;
        }

        if (command === "vcf") {
          if (!isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only the bot owner can export group contacts!",
            });
            return;
          }

          try {
            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            // Get group metadata with all participants
            const groupMetadata = await sock.groupMetadata(message.key.remoteJid);
            const participants = groupMetadata.participants;

            if (!participants || participants.length === 0) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ No participants found in this group!",
              });
              return;
            }

            // Generate VCF content
            const vcfContent = generateVCF(participants);

            // Create filename with group name and timestamp
            const timestamp = new Date().toISOString().split('T')[0];
            const groupName = groupMetadata.subject.replace(/[^a-z0-9]/gi, '_');
            const filename = `${groupName}_contacts_${timestamp}.vcf`;
            const filepath = path.join(__dirname, filename);

            // Write VCF file
            fs.writeFileSync(filepath, vcfContent, 'utf8');

            // Send the VCF file
            await sock.sendMessage(message.key.remoteJid, {
              document: fs.readFileSync(filepath),
              fileName: filename,
              mimetype: 'text/vcard',
              caption: `📇 *Group Contacts Export*\n\n✅ Exported ${participants.length} contacts\n📅 Date: ${timestamp}\n👥 Group: ${groupMetadata.subject}`
            });

            // Clean up - delete the file after sending
            fs.unlinkSync(filepath);

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });

            logger.info({
              group: message.key.remoteJid,
              contactCount: participants.length
            }, 'VCF contacts exported');

          } catch (error) {
            logger.error({ error: error.message, stack: error.stack }, 'VCF export error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to export contacts: " + error.message,
            });
          }
          return;
        }

        if (text && text.startsWith(".")) {
          // Better error message for unknown commands in groups
          const groupOnlyCommands = ['lock', 'open', 'kick', 'warn', 'promote', 'demote', 'antilink', 'tagall', 'hidetag', 'anonymous', 'end', 'setwelcome', 'resetwelcome', 'delete'];
          const ownerOnlyCommands = ['vcf', 'public', 'private', 'join'];

          let errorMsg = `❌ *Unknown Command!*\n\n`;

          if (ownerOnlyCommands.includes(command)) {
            errorMsg += `🔐 *Owner Only:* This command can only be used by the bot owner.\n\n`;
          } else if (!isAdmin && !isOwner && (isAdmin !== undefined)) {
            errorMsg += `⚠️ *Admin Required:* You need to be a group admin to use this command.\n\n`;
          } else if (!canUseBot) {
            errorMsg += `🔒 *Bot Mode:* Bot is in ${botMode} mode. `;
            if (botMode === 'private') {
              errorMsg += `Only the owner can use commands.\n\n`;
            }
          } else {
            errorMsg += `The command *${fullCommand}* doesn't exist.\n\n`;
          }

          errorMsg += `📋 Type *.menu* to see all available commands.`;

          await sock.sendMessage(message.key.remoteJid, {
            text: errorMsg,
          });
          return;
        }

      } else {
        // DM mode: isOwner was already determined above
        const canUseDM = isOwner || botMode === "public";

        logger.info({
          isOwner,
          canUseDM,
          botMode,
          sender,
          remoteJid: message.key.remoteJid,
          fromMe: message.key.fromMe,
        }, 'DM mode check');

        if (command === "menu") {
          try {
            const menuImage = fs.readFileSync("./images/menu-image.jpg");
            await sock.sendMessage(message.key.remoteJid, {
              image: menuImage,
              caption: getMenu(),
            });
          } catch (err) {
            await sock.sendMessage(message.key.remoteJid, {
              text: getMenu(),
            });
          }
          return;
        }

        if (command === "help") {
          await sock.sendMessage(message.key.remoteJid, {
            text: `ℹ️ *BOT INFORMATION*

🤖 KAIDO Bot
Built by: Everybody Hates James
Version: 2.0

━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Features:*
• Group management (lock/unlock/kick)
• Member tagging (hidden & visible)
• View-once media saving
• Profile picture extraction
• Custom sticker commands
• Auto-link moderation
• Warning system (2 strikes = kick)
• Live crypto prices
• Public/Private mode

━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *How to Use:*
1. Type .menu for all commands
2. Reply to messages for actions
3. Use stickers for quick commands
4. .public/.private to toggle mode

━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Mode: ${botMode.toUpperCase()}

⚠️ *Important:*
Use responsibly!`,
          });
          return;
        }

        if (command === "ping") {
          const now = Date.now();
          await sock.sendMessage(message.key.remoteJid, {
            text: `📊 *PONG!*\n✅ Bot is online and responding\n⚡ Latency: ${Date.now() - now}ms\n🔧 Mode: ${botMode.toUpperCase()}`,
          });
          return;
        }

        if (command === "public") {
          if (!isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only the bot owner can change bot mode!",
            });
            return;
          }
          botMode = "public";
          await sock.sendMessage(message.key.remoteJid, {
            text: "✅ Bot is now *PUBLIC*\n\nAll users can now use bot commands!",
          });
          logger.info('Bot mode changed to PUBLIC');
          return;
        }

        if (command === "private") {
          if (!isOwner) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Only the bot owner can change bot mode!",
            });
            return;
          }
          botMode = "private";
          await sock.sendMessage(message.key.remoteJid, {
            text: "🔐 Bot is now *PRIVATE*\n\nOnly the owner can use bot commands!",
          });
          logger.info('Bot mode changed to PRIVATE');
          return;
        }

        if (command === "live" && canUseDM) {
          const symbol = args[0];
          if (!symbol) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Usage: .live [symbol]\n\nExamples:\n.live btc\n.live eth\n.live sol",
            });
            return;
          }

          await sock.sendMessage(message.key.remoteJid, {
            react: { text: "⏳", key: message.key },
          });

          const data = await fetchCryptoPrice(symbol);

          if (!data) {
            const upperSym = symbol.toUpperCase();

            await sock.sendMessage(message.key.remoteJid, {
              text: `❌ Could not find data for *${upperSym}*

💡 *Tips:*
• Check if the symbol is correct
• The coin might not be listed on CoinGecko
• Try popular coins like: BTC, ETH, SOL, TON, BNB, ADA, XRP, DOGE, MATIC, DOT

🔍 *How to add new coins:*
If you know the CoinGecko ID for ${upperSym}, contact the bot owner to add it.

Example: Search "coingecko ${upperSym}" to find the correct ID.`,
            });
            return;
          }

          const price = parseFloat(data.lastPrice).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8
          });
          const change24h = parseFloat(data.priceChangePercent).toFixed(2);
          const volume = parseFloat(data.volume).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          });
          const marketCap = parseFloat(data.marketCap).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
          });
          const changeEmoji = change24h >= 0 ? "📈" : "📉";
          const changeSign = change24h >= 0 ? "+" : "";

          await sock.sendMessage(message.key.remoteJid, {
            text: `💹 *${data.symbol}* Live Price

💰 *Price:* $${price}
${changeEmoji} *24h Change:* ${changeSign}${change24h}%

📊 *24h Stats:*
📦 Volume: $${volume}
💎 Market Cap: $${marketCap}

⏰ Updated: ${new Date().toLocaleTimeString()}
📡 Source: CoinGecko`,
          });

          await sock.sendMessage(message.key.remoteJid, {
            react: { text: "✅", key: message.key },
          });
          return;
        }

   if (command === "vv" && canUseDM) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Usage Error:*\n\nReply to a view-once photo or video with the command *.vv* to save it.",
              });
              return;
            }

            const viewOnceMsg = await extractViewOnceMedia(quoted);
            if (!viewOnceMsg) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Invalid Message:*\n\nThe message you replied to is not a view-once photo or video. Please check and try again.",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            const media = await downloadViewOnceMedia(viewOnceMsg);
            if (!media || !media.mediaData) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ *Download Failed:*\n\nCould not download the view-once media. It might have expired, been deleted, or there was a network issue. Try again immediately.",
              });
              return;
            }

            // Send the media back as a regular message to the current chat
            const sendOptions = {
              caption: `✅ *LUCA View-Once Saver*\n\nOriginal Caption: ${media.caption || 'None'}`,
            };

            if (media.mediaType === "image") {
              sendOptions.image = media.mediaData;
            } else if (media.mediaType === "video") {
              sendOptions.video = media.mediaData;
            }

            await sock.sendMessage(message.key.remoteJid, sendOptions, {
              quoted: message,
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });

          } catch (error) {
            logger.error({ error: error.message, stack: error.stack }, 'VV command error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ *System Error:*\n\nAn unexpected error occurred while processing your request. Please report this to the bot owner with the command you used.",
            });
          }
          return;
        }
          if (command === "sticker" && canUseDM) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to an image with *.sticker*",
              });
              return;
            }

            const imageMsg = quoted?.imageMessage;
            if (!imageMsg) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to an image only!",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "⏳", key: message.key },
            });

            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            const stickerBuffer = await convertToSticker(buffer);
            if (!stickerBuffer) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Failed to convert image to sticker",
              });
              return;
            }

            await sock.sendMessage(message.key.remoteJid, {
              sticker: stickerBuffer,
            });

            await sock.sendMessage(message.key.remoteJid, {
              react: { text: "✅", key: message.key },
            });
          } catch (err) {
            logger.error({ error: err.message }, 'Sticker DM error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to create sticker: " + err.message,
            });
          }
          return;
        }

        if (message.message.stickerMessage && !text && canUseDM) {
          const stickerHash = message.message.stickerMessage.fileSha256?.toString('base64');

          for (const [cmdName, hash] of Object.entries(stickerCommands)) {
            if (hash === stickerHash || hash === true || (typeof hash === 'object' && hash.hash === stickerHash)) {
              if (cmdName === "vv") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo || !contextInfo.quotedMessage) return;

                  const quoted = contextInfo.quotedMessage;
                  const viewOnceMsg = await extractViewOnceMedia(quoted);
                  if (!viewOnceMsg) return;

                  const media = await downloadViewOnceMedia(viewOnceMsg);
                  if (!media) return;

                  const ownerJid = BOT_OWNER + "@s.whatsapp.net";
                  if (media.mediaType === "image") {
                    await sock.sendMessage(ownerJid, {
                      image: media.mediaData,
                      caption: `📸 View-once from DM (via sticker)\n${media.caption || ""}`,
                    });
                  } else if (media.mediaType === "video") {
                    await sock.sendMessage(ownerJid, {
                      video: media.mediaData,
                      caption: `🎥 View-once from DM (via sticker)\n${media.caption || ""}`,
                    });
                  }

                  await sock.sendMessage(message.key.remoteJid, {
                    react: { text: "✅", key: message.key },
                  });

                  setTimeout(async () => {
                    try {
                      await sock.sendMessage(message.key.remoteJid, {
                        react: { text: "", key: message.key },
                      });
                    } catch (err) {}
                  }, 3000);

                  logger.info('View-once from DM saved via sticker');
                } catch (err) {
                  logger.error({ error: err.message }, 'DM sticker vv error');
                }
                return;
              } else if (cmdName === "sticker") {
                try {
                  const contextInfo = message.message.stickerMessage?.contextInfo;
                  if (!contextInfo?.quotedMessage?.imageMessage) return;

                  const imageMsg = contextInfo.quotedMessage.imageMessage;
                  const stream = await downloadContentFromMessage(imageMsg, 'image');
                  let buffer = Buffer.from([]);
                  for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                  }

                  const stickerBuffer = await convertToSticker(buffer);
                  if (stickerBuffer) {
                    await sock.sendMessage(message.key.remoteJid, {
                      sticker: stickerBuffer,
                    });
                  }
                } catch (err) {
                  logger.error({ error: err.message }, 'DM sticker converter error');
                }
                return;
              }
            }
          }
          return;
        }

        if (command === "setsticker" && isOwner) {
          const cmdName = args[0]?.toLowerCase();
          const sticker = message.message.extendedTextMessage?.contextInfo
            ?.quotedMessage?.stickerMessage;

          if (!sticker || !cmdName) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Usage: Reply to a sticker with *.setsticker [command]*\n\nSupported commands: kick, open, lock, vv, hidetag, pp, sticker",
            });
            return;
          }

          if (!["kick", "open", "lock", "vv", "hidetag", "pp", "sticker"].includes(cmdName)) {
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Supported commands: kick, open, lock, vv, hidetag, pp, sticker",
            });
            return;
          }

          const stickerHash = sticker.fileSha256?.toString('base64');

          if (cmdName === "sticker") {
            stickerCommands[cmdName] = { type: "sticker_converter", hash: stickerHash };
          } else {
            stickerCommands[cmdName] = stickerHash || true;
          }

          await sock.sendMessage(message.key.remoteJid, {
            text: `✅ Sticker set to *${cmdName.toUpperCase()}* - works globally!`,
          });
          logger.info({ command: cmdName }, 'Sticker command set from DM');
          return;
        }

        if (command === "join" && isOwner) {
          try {
            const groupLink = text?.split(" ").slice(1).join(" ")?.trim();

            if (!groupLink) {
              await sock.sendMessage(message.key.remoteJid, {
                text: `❌ Usage: .join [WhatsApp Group Link]\n\nExample:\n.join https://chat.whatsapp.com/ABCDEF123456`,
              });
              return;
            }

            if (!groupLink.includes("chat.whatsapp.com")) {
              await sock.sendMessage(message.key.remoteJid, {
                text: `❌ Invalid WhatsApp group link!`,
              });
              return;
            }

            let code = "";
            if (groupLink.includes("chat.whatsapp.com/")) {
              code = groupLink.split("chat.whatsapp.com/")[1]?.trim();
            }

            if (!code || code.length < 10) {
              await sock.sendMessage(message.key.remoteJid, {
                text: `❌ Invalid group link format!`,
              });
              return;
            }

            const response = await sock.groupAcceptInvite(code);

            await sock.sendMessage(message.key.remoteJid, {
              text: `✅ Successfully joined the group!`,
            });
            logger.info({ code }, 'Joined group');
          } catch (err) {
            logger.error({ error: err.message }, 'Join error');
            let errorMsg = `❌ Failed to join group.\n\nPossible reasons:\n• Invalid link\n• Already in group\n• Link expired`;

            if (err.message.includes("already")) {
              errorMsg = `❌ You are already in this group!`;
            } else if (err.message.includes("expired")) {
              errorMsg = `❌ This invite link has expired!`;
            }

            await sock.sendMessage(message.key.remoteJid, {
              text: errorMsg,
            });
          }
          return;
        }

        if (command === "delete" && canUseDM) {
          try {
            const quoted = message.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
              await sock.sendMessage(message.key.remoteJid, {
                text: "❌ Reply to a message to delete it",
              });
              return;
            }

            const quotedKey = {
              remoteJid: message.key.remoteJid,
              fromMe: true,
              id: message.message.extendedTextMessage?.contextInfo?.stanzaId,
            };

            await sock.sendMessage(message.key.remoteJid, {
              delete: quotedKey,
            });
          } catch (err) {
            logger.error({ error: err.message }, 'Delete DM error');
            await sock.sendMessage(message.key.remoteJid, {
              text: "❌ Failed to delete message",
            });
          }
          return;
        }

        if (text && text.startsWith(".")) {
          // Better error message for unknown commands in DMs
          const groupOnlyCommands = ['lock', 'open', 'kick', 'warn', 'promote', 'demote', 'antilink', 'tagall', 'hidetag', 'anonymous', 'end', 'setwelcome', 'resetwelcome', 'vcf'];
          const ownerOnlyCommands = ['public', 'private', 'join'];

          let errorMsg = `❌ *Command Error!*\n\n`;

          if (groupOnlyCommands.includes(command)) {
            errorMsg += `👥 *Group Only:* The command *${fullCommand}* can only be used in groups, not in DMs.\n\n`;
          } else if (ownerOnlyCommands.includes(command) && !isOwner) {
            errorMsg += `🔐 *Owner Only:* This command can only be used by the bot owner.\n\n`;
          } else if (!canUseDM) {
            errorMsg += `🔒 *Bot Mode:* Bot is in ${botMode} mode. `;
            if (botMode === 'private') {
              errorMsg += `Only the owner can use commands in DMs.\n\n`;
            }
          } else {
            errorMsg += `The command *${fullCommand}* doesn't exist or isn't available in DMs.\n\n`;
          }

          errorMsg += `📋 Type *.menu* to see all available commands.`;

          await sock.sendMessage(message.key.remoteJid, {
            text: errorMsg,
          });
          return;
        }
      }
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error handling message');
    }
  });
}

console.clear();
console.log("╔════════════════════════════════╗");
console.log("║   ⚔️ KAIDO BOT v2.0 ⚔️          ║");
console.log("║   Starting...                  ║");
console.log("╚════════════════════════════════╝\n");

startBot().catch((err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Bot startup error');
});

process.on("SIGINT", () => {
  logger.info('Bot stopping gracefully...');
  saveData(); // Save data before exiting
  logger.info('Data saved. Bot stopped.');
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Uncaught exception');
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason }, 'Unhandled rejection');
});