const axios = require('axios');

async function playSongCommand(sock, message, args, logger) {
  if (!args || args.length < 1) { // Changed to 1 to allow single-word searches
    await sock.sendMessage(message.key.remoteJid, {
      text: "❌ *Usage Error:*

Usage: .play [SONG_NAME] [ARTIST]\n\nExample:\n.play Headlines Drake\n.play Blinding Lights",
    });
    return;
  }

  const query = args.join(' ');

  await sock.sendMessage(message.key.remoteJid, {
    react: { text: "⏳", key: message.key },
  });

  try {
    const apiUrl = 'https://apis.davidcyriltech.my.id/song?query=' + encodeURIComponent(query) + '&apikey=';
    const response = await axios.get(apiUrl);
    const data = response.data;

    if (!data.status || !data.result) {
      await sock.sendMessage(message.key.remoteJid, {
        text: "❌ Song not found. Please check the song name and artist.",
      });
      return;
    }

    const song = data.result;
    const audioUrl = song.audio.download_url;
    const title = song.title;
    const thumbnailUrl = song.thumbnail;

    // Download and send audio
    const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(audioResponse.data);

    // Download thumbnail for thumbnail
    let thumbnailBuffer = null;
    try {
      const thumbResponse = await axios.get(thumbnailUrl, { responseType: 'arraybuffer' });
      thumbnailBuffer = Buffer.from(thumbResponse.data);
    } catch (err) {
      logger.warn({ error: err.message }, 'Failed to download thumbnail');
    }

    const caption = '🎵 *' + title + '*\n\n' +
                    '📡 *Duration:* ' + song.duration + '\n' +
                    '👀 *Views:* ' + song.views + '\n' +
                    '📅 *Published:* ' + song.published;

    await sock.sendMessage(message.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      caption: caption,
      ptt: false,
      ...(thumbnailBuffer && { thumbnail: thumbnailBuffer })
    });

    await sock.sendMessage(message.key.remoteJid, {
      react: { text: "✅", key: message.key },
    });

    logger.info({ song: title, query: query }, 'Song played successfully');

  } catch (error) {
    logger.error({ error: error.message }, 'Play command error');
    await sock.sendMessage(message.key.remoteJid, {
      text: "❌ Failed to download song. Please try again later.",
    });
  }
}

module.exports = { playSongCommand };
