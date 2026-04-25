require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const VENUE_NAME = process.env.VENUE_NAME || 'Crowdpick';
const PRIMARY_COLOR = process.env.PRIMARY_COLOR || '#6C63FF';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
console.log(`IP local detectada: ${LOCAL_IP}`);
console.log(`Venue: ${VENUE_NAME}`);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/ip', (req, res) => {
  res.json({ ip: LOCAL_IP });
});

app.get('/api/config', (req, res) => {
  res.json({ venueName: VENUE_NAME, primaryColor: PRIMARY_COLOR });
});

let currentPoll = null;
let votes = {};
let winnerVisible = false;
let waitingScreen = { title: '', subtitle: '' };

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Al conectar, enviamos el estado actual para sincronizar
  if (waitingScreen.title || waitingScreen.subtitle) {
    socket.emit('update-waiting', waitingScreen);
  }
  if (currentPoll) {
    socket.emit('poll-update', { poll: currentPoll, votes });
    if (winnerVisible) {
      const winnerId = getWinnerId();
      socket.emit('show-winner', { winnerId, poll: currentPoll, votes });
    }
  }

  socket.on('update-waiting', (data) => {
    waitingScreen = data;
    // Reenviar a todos los clientes excepto el admin que lo mandó
    socket.broadcast.emit('update-waiting', data);
  });

  socket.on('start-poll', (poll) => {
    currentPoll = poll;
    votes = {};
    winnerVisible = false;
    poll.options.forEach(opt => votes[opt.id] = 0);
    io.emit('poll-update', { poll: currentPoll, votes });
  });

  socket.on('vote', (optionId) => {
    if (currentPoll && votes[optionId] !== undefined) {
      votes[optionId]++;
      io.emit('votes-update', votes);
    }
  });

  socket.on('end-poll', () => {
    winnerVisible = true;
    const winnerId = getWinnerId();
    io.emit('show-winner', { winnerId, poll: currentPoll, votes });
  });

  socket.on('reset-display', () => {
    currentPoll = null;
    votes = {};
    winnerVisible = false;
    waitingScreen = { title: '', subtitle: '' };
    io.emit('go-home');
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

function getWinnerId() {
  return Object.entries(votes).reduce((a, b) => b[1] > a[1] ? b : a, ['', -1])[0];
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://${LOCAL_IP}:${PORT}`);
});