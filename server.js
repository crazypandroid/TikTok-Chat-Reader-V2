// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TikTokIOConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Statische Dateien ausliefern
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket-Logik
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  let ttc = null;

  // Client startet TikTok-Session
  socket.on('startSession', ({ username }) => {
    if (ttc) {
      ttc.disconnect();
      ttc = null;
    }

    ttc = new TikTokIOConnection();

    ttc.connect(username, { enableExtendedGiftInfo: true })
      .then(state => {
        socket.emit('streamOnline', { roomId: state.roomId });
      })
      .catch(err => {
        socket.emit('error', err);
      });

    // Alle wichtigen Events weiterleiten
    [
      'roomUser',
      'like',
      'member',
      'chat',
      'gift',
      'social',
      'streamEnd'
    ].forEach(evt => {
      ttc.on(evt, data => socket.emit(evt, data));
    });

    // TikTok-Verbindung getrennt
    ttc.on('disconnected', () => {
      socket.emit('streamOffline', { username });
    });

    ttc.on('error', err => {
      socket.emit('error', err);
    });
  });

  // Client-Socket trennt sich
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (ttc) {
      ttc.disconnect();
      ttc = null;
    }
  });
});

// Server starten
server.listen(PORT, () => {
  console.log(`🌐 Server läuft auf http://localhost:${PORT}`);
});
