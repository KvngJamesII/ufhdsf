const phoneNumber = await askQuestion(
        "Enter your phone number (with country code, e.g., 1234567890): "
      );

      try {
        // Set pairing phone number as bot owner if not already set
        if (!BOT_OWNER) {
          BOT_OWNER = phoneNumber;
          logger.info({ owner: BOT_OWNER }, 'Bot owner auto-detected from pairing');
        }
        
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\n✅ Your pairing code: ${code}\nEnter this in WhatsApp to connect`);
      } catch (err) {
        logger.error({ error: err.message }, 'Pairing code error');
      }