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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'crowdpick2024';

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
  const pwd = req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crowdpick — Acceso</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #111; color: #fff;
      font-family: 'Segoe UI', sans-serif;
      min-height: 100vh; display: flex;
      align-items: center; justify-content: center; padding: 20px;
    }
    .box {
      background: #1a1a1a; border: 1px solid #2a2a2a;
      border-radius: 16px; padding: 40px 32px;
      width: 100%; max-width: 360px; text-align: center;
    }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    p { color: #555; font-size: 0.85rem; margin-bottom: 28px; }
    input {
      width: 100%; background: #222; border: 1px solid #333;
      color: #fff; padding: 12px 16px; border-radius: 8px;
      font-size: 1rem; margin-bottom: 12px;
      text-align: center; letter-spacing: 2px;
    }
    input:focus { outline: none; border-color: ${PRIMARY_COLOR}; }
    button {
      width: 100%; background: ${PRIMARY_COLOR}; color: #000;
      border: none; padding: 12px; border-radius: 8px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
    }
    button:hover { opacity: 0.9; }
    .error { color: #c0392b; font-size: 0.85rem; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🎛️ Panel Admin</h1>
    <p>${VENUE_NAME}</p>
    <input type="password" id="pwd" placeholder="Contraseña" onkeydown="if(event.key==='Enter') login()">
    <button onclick="login()">Ingresar</button>
    <div class="error" id="err">Contraseña incorrecta</div>
  </div>
  <script>
    function login() {
      const pwd = document.getElementById('pwd').value;
      if (pwd) window.location.href = '/admin?pwd=' + encodeURIComponent(pwd);
    }
    ${req.query.pwd ? "document.getElementById('err').style.display='block';" : ''}
  </script>
</body>
</html>`);
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/ip', (req, res) => {
  res.json({ ip: LOCAL_IP });
});

app.get('/api/config', (req, res) => {
  res.json({ venueName: VENUE_NAME, primaryColor: PRIMARY_COLOR });
});

// Estado del servidor
let currentPoll = null;
let votes = {};
let winnerVisible = false;
let waitingScreen = { title: '', subtitle: '' };
let appearance = {
  bgColor: '#111111',
  textColor: '#ffffff',
  accentColor: PRIMARY_COLOR,
  subtitleColor: '#aaaaaa',
  font: 'Inter',
  logoUrl: ''
};

app.get('/api/appearance', (req, res) => {
  res.json(appearance);
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Sincronizar estado completo al conectar
  socket.emit('appearance-update', appearance);
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
    socket.broadcast.emit('update-waiting', data);
  });

  socket.on('update-appearance', (data) => {
    appearance = { ...appearance, ...data };
    socket.broadcast.emit('appearance-update', appearance);
  });

  socket.on('reset-appearance', () => {
    appearance = {
      bgColor: '#111111',
      textColor: '#ffffff',
      accentColor: PRIMARY_COLOR,
      subtitleColor: '#aaaaaa',
      font: 'Inter',
      logoUrl: ''
    };
    io.emit('appearance-update', appearance);
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