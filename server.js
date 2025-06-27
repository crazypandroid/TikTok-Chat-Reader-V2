require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { TikTokConnectionWrapper, getGlobalConnectionCount } = require('./connectionWrapper');
const { clientBlocked } = require('./limiter');

const app = express();
const httpServer = createServer(app);

// Enable cross origin resource sharing
const io = new Server(httpServer, {
  cors: {
    origin: '*'
  }
});

// Hilfsfunktion für Reconnect mit Delay und max Versuchen
function connectWithRetry(wrapper, uniqueId, options, socket, retries = 5, delay = 5000) {
  wrapper.connect()
    .catch(async (err) => {
      console.error('TikTok connection error:', err);
      if (retries > 0) {
        socket.emit('tiktokDisconnected', `Reconnect attempt left: ${retries}. Fehler: ${err.message || err}`);
        await new Promise(r => setTimeout(r, delay));
        await connectWithRetry(wrapper, uniqueId, options, socket, retries - 1, delay);
      } else {
        socket.emit('tiktokDisconnected', 'Verbindung konnte nicht wiederhergestellt werden.');
      }
    });
}

io.on('connection', (socket) => {
  let tiktokConnectionWrapper;

  console.info('New connection from origin', socket.handshake.headers['origin'] || socket.handshake.headers['referer']);

  socket.on('setUniqueId', (uniqueId, options) => {

    if (typeof options === 'object' && options) {
      delete options.requestOptions;
      delete options.websocketOptions;
    } else {
      options = {};
    }

    if (process.env.SESSIONID) {
      options.sessionId = process.env.SESSIONID;
      console.info('Using SessionId');
    }

    if (process.env.ENABLE_RATE_LIMIT && clientBlocked(io, socket)) {
      socket.emit('tiktokDisconnected', 'Zu viele Verbindungen/Anfragen. Bitte warte oder hoste selbst.');
      return;
    }

    tiktokConnectionWrapper = new TikTokConnectionWrapper(uniqueId, options, true);

    // Reconnect mit Retry statt direktem connect
    connectWithRetry(tiktokConnectionWrapper, uniqueId, options, socket);

    // Event Umleitungen (Gift auskommentiert)
    tiktokConnectionWrapper.once('connected', state => socket.emit('tiktokConnected', state));
    tiktokConnectionWrapper.once('disconnected', reason => socket.emit('tiktokDisconnected', reason));

    tiktokConnectionWrapper.connection.on('streamEnd', () => socket.emit('streamEnd'));
    tiktokConnectionWrapper.connection.on('roomUser', msg => socket.emit('roomUser', msg));
    tiktokConnectionWrapper.connection.on('member', msg => socket.emit('member', msg));
    tiktokConnectionWrapper.connection.on('chat', msg => socket.emit('chat', msg));
    // Gift-Event absichtlich deaktiviert:
    // tiktokConnectionWrapper.connection.on('gift', msg => socket.emit('gift', msg));
    tiktokConnectionWrapper.connection.on('social', msg => socket.emit('social', msg));
    tiktokConnectionWrapper.connection.on('like', msg => socket.emit('like', msg));
    tiktokConnectionWrapper.connection.on('questionNew', msg => socket.emit('questionNew', msg));
    tiktokConnectionWrapper.connection.on('linkMicBattle', msg => socket.emit('linkMicBattle', msg));
    tiktokConnectionWrapper.connection.on('linkMicArmies', msg => socket.emit('linkMicArmies', msg));
    tiktokConnectionWrapper.connection.on('liveIntro', msg => socket.emit('liveIntro', msg));
    tiktokConnectionWrapper.connection.on('emote', msg => socket.emit('emote', msg));
    tiktokConnectionWrapper.connection.on('envelope', msg => socket.emit('envelope', msg));
    tiktokConnectionWrapper.connection.on('subscribe', msg => socket.emit('subscribe', msg));
  });

  socket.on('disconnect', () => {
    if (tiktokConnectionWrapper) {
      tiktokConnectionWrapper.disconnect();
    }
  });
});

// Global Statistiken
setInterval(() => {
  io.emit('statistic', { globalConnectionCount: getGlobalConnectionCount() });
}, 5000);

// Static files
app.use(express.static('public'));

const port = process.env.PORT || 8081;
httpServer.listen(port);
console.info(`Server running! Please visit http://localhost:${port}`);
