import express from "express";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({
  origin: [
    'https://aaks-hath.github.io',  
    'http://localhost:10000',
    'http://127.0.0.1:10000'
  ],
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// In-memory storage
let sessions = new Map();
let analytics = {
  attempts: [],
  completions: [],
  locked: [],
  hints: []
};

// Game state
let gameState = {
  isStarted: false,
  startedBy: null,
  startedAt: null
};

// Admin session management
let activeAdmin = null;
let adminWs = null;
let pendingAdminRequests = new Map(); // Store pending 2FA requests

const ADMIN_PASSWORD = "Purple&OrangeMouse^2";

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function generateRequestId() {
  return 'req_' + Math.random().toString(36).substring(2, 15);
}

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  console.log('🔄 WebSocket upgrade request received');
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// WebSocket handling
wss.on("connection", (ws, request) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, { 
    ws, 
    locked: false, 
    progress: {}, 
    startTime: Date.now(),
    lastActivity: Date.now(),
    playerName: null,
    isAdmin: false
  });

  console.log(`🟢 Player connected: ${sessionId} (Total: ${sessions.size})`);
  
  try {
    ws.send(JSON.stringify({ 
      type: "session_id", 
      sessionId,
      gameStarted: gameState.isStarted 
    }));
  } catch (err) {
    console.error('❌ Failed to send session_id:', err);
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const session = sessions.get(sessionId);
      if (!session) return;

      session.lastActivity = Date.now();

      switch(data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        
        case "set_name":
          session.playerName = data.playerName;
          console.log(`👤 Player ${sessionId} set name: ${data.playerName}`);
          break;
        
        case "progress_update":
          session.progress = data.progress;
          if (data.progress.playerName) {
            session.playerName = data.progress.playerName;
          }
          console.log(`📊 Progress update from ${session.playerName || sessionId}`);
          
          // Notify admin of progress update
          if (adminWs && adminWs.readyState === 1) {
            adminWs.send(JSON.stringify({
              type: "player_progress_update",
              sessionId,
              playerName: session.playerName,
              progress: session.progress
            }));
          }
          break;
        
        case "event":
          analytics[data.event] = analytics[data.event] || [];
          analytics[data.event].push({
            sessionId,
            playerName: session.playerName,
            ...data.details,
            timestamp: Date.now()
          });
          console.log(`📈 Event tracked: ${data.event} from ${session.playerName || sessionId}`);
          break;
        
        case "admin_login_request":
          handle2FARequest(sessionId, data.password, ws);
          break;
        
        case "admin_authenticated":
          // Mark this session as admin
          session.isAdmin = true;
          console.log(`🔐 Admin authenticated: ${sessionId}`);
          break;
      }
    } catch (err) {
      console.error("❌ Message parse error:", err);
    }
  });

  ws.on("close", () => {
    // If this was the admin, clear admin session
    if (sessionId === activeAdmin) {
      console.log('🔴 Admin disconnected');
      activeAdmin = null;
      adminWs = null;
    }
    sessions.delete(sessionId);
    console.log(`🔴 Player disconnected: ${sessionId} (Total: ${sessions.size})`);
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${sessionId}:`, error);
  });
});

function handle2FARequest(sessionId, password, ws) {
  if (password !== ADMIN_PASSWORD) {
    ws.send(JSON.stringify({
      type: "admin_login_response",
      success: false,
      reason: "Invalid password"
    }));
    return;
  }

  // If there's an active admin, send request to them
  if (activeAdmin && adminWs && adminWs.readyState === 1) {
    const requestId = generateRequestId();
    const session = sessions.get(sessionId);
    
    pendingAdminRequests.set(requestId, {
      sessionId,
      playerName: session?.playerName || 'Unknown',
      timestamp: Date.now(),
      ws
    });

    // Send request to active admin
    adminWs.send(JSON.stringify({
      type: "2fa_request",
      requestId,
      sessionId,
      playerName: session?.playerName || 'Unknown'
    }));

    // Notify requesting user
    ws.send(JSON.stringify({
      type: "admin_login_response",
      success: false,
      reason: "pending_approval",
      message: "Admin approval required. Please wait..."
    }));

    console.log(`🔐 2FA request from ${session?.playerName || sessionId} - waiting for admin approval`);
  } else {
    // No active admin, allow login
    ws.send(JSON.stringify({
      type: "admin_login_response",
      success: true
    }));
  }
}

// Heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('💀 Terminating dead connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// Clean up inactive sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  
  sessions.forEach((session, id) => {
    if (now - session.lastActivity > timeout) {
      console.log(`🧹 Cleaning up inactive session: ${session.playerName || id}`);
      sessions.delete(id);
    }
  });
  
  console.log(`📊 Active sessions: ${sessions.size}`);
}, 5 * 60 * 1000);

// ============ REST API ROUTES ============

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  // Check if another admin is already logged in
  if (activeAdmin) {
    return res.status(403).json({ 
      error: "Another admin is already logged in",
      activeAdmin: activeAdmin
    });
  }

  const adminSessionId = generateSessionId();
  activeAdmin = adminSessionId;

  res.json({ 
    success: true,
    sessionId: adminSessionId,
    gameStarted: gameState.isStarted
  });
});

app.post("/api/admin/set-websocket", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId !== activeAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const session = sessions.get(sessionId);
  if (session) {
    adminWs = session.ws;
    console.log('🔗 Admin WebSocket connected');
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

app.post("/api/admin/approve-2fa", (req, res) => {
  const { requestId, approved } = req.body;
  
  const request = pendingAdminRequests.get(requestId);
  if (!request) {
    return res.status(404).json({ error: "Request not found or expired" });
  }
  
app.post("/api/admin/force-login", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  // Kick out the current admin
  if (activeAdmin && adminWs && adminWs.readyState === 1) {
    adminWs.send(JSON.stringify({
      type: "force_logout",
      message: "Another admin has taken over"
    }));
  }

  // Clear the old admin session
  if (activeAdmin) {
    sessions.delete(activeAdmin);
  }
  activeAdmin = null;
  adminWs = null;

  res.json({ success: true, message: "Previous admin logged out" });
});
  if (approved) {
    // Send approval to requesting user
    if (request.ws && request.ws.readyState === 1) {
      request.ws.send(JSON.stringify({
        type: "admin_login_response",
        success: true
      }));
    }
    console.log(`✅ 2FA approved for ${request.playerName}`);
  } else {
    // Send rejection
    if (request.ws && request.ws.readyState === 1) {
      request.ws.send(JSON.stringify({
        type: "admin_login_response",
        success: false,
        reason: "Admin denied access"
      }));
    }
    console.log(`❌ 2FA denied for ${request.playerName}`);
  }

  pendingAdminRequests.delete(requestId);
  res.json({ success: true });
});

app.post("/api/admin/start-game", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId !== activeAdmin) {
    return res.status(403).json({ error: "Only the active admin can start the game" });
  }

  gameState.isStarted = true;
  gameState.startedBy = activeAdmin;
  gameState.startedAt = Date.now();

  // Notify all connected players
  sessions.forEach((session, sid) => {
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({
        type: "game_started"
      }));
    }
  });

  console.log('🎮 Game started by admin');
  res.json({ success: true, gameState });
});

app.post("/api/admin/stop-game", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId !== activeAdmin) {
    return res.status(403).json({ error: "Only the active admin can stop the game" });
  }

  gameState.isStarted = false;
  gameState.startedBy = null;

  // Notify all connected players
  sessions.forEach((session, sid) => {
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({
        type: "game_stopped"
      }));
    }
  });

  console.log('⏹️ Game stopped by admin');
  res.json({ success: true, gameState });
});

app.post("/api/admin/lock-all", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId !== activeAdmin) {
    return res.status(403).json({ error: "Only the active admin can lock all players" });
  }

  let lockedCount = 0;
  sessions.forEach((session, sid) => {
    if (!session.isAdmin && session.ws && session.ws.readyState === 1) {
      session.locked = true;
      session.ws.send(JSON.stringify({
        type: "lock_status",
        locked: true,
        reason: "Admin locked all players"
      }));
      lockedCount++;
    }
  });

  console.log(`🔒 Admin locked all players (${lockedCount} players)`);
  res.json({ success: true, lockedCount });
});

app.post("/api/admin/unlock-all", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId !== activeAdmin) {
    return res.status(403).json({ error: "Only the active admin can unlock all players" });
  }

  let unlockedCount = 0;
  sessions.forEach((session, sid) => {
    if (!session.isAdmin && session.ws && session.ws.readyState === 1) {
      session.locked = false;
      session.ws.send(JSON.stringify({
        type: "lock_status",
        locked: false
      }));
      unlockedCount++;
    }
  });

  console.log(`🔓 Admin unlocked all players (${unlockedCount} players)`);
  res.json({ success: true, unlockedCount });
});

app.get("/api/game-state", (req, res) => {
  res.json(gameState);
});

app.get("/api/players", (req, res) => {
  const list = Array.from(sessions.entries())
    .filter(([id, session]) => !session.isAdmin) // Exclude admin sessions
    .map(([id, session]) => ({
      sessionId: id,
      playerName: session.playerName || null,
      locked: session.locked,
      progress: session.progress,
      startTime: session.startTime,
      difficulty: session.progress.difficulty,
      lastActivity: session.lastActivity
    }));
  res.json(list);
});

app.post("/api/lock", (req, res) => {
  const { sessionId, locked } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: "Player not found" });
  }

  session.locked = locked;
  
  try {
    const message = JSON.stringify({ 
      type: "lock_status", 
      locked: locked
    });
    
    if (session.ws.readyState === 1) {
      session.ws.send(message);
      console.log(`${locked ? "🔒" : "🔓"} Player ${session.playerName || sessionId} ${locked ? 'locked' : 'unlocked'}`);
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "WebSocket not connected" });
    }
  } catch (err) {
    console.error("Error sending lock status:", err);
    res.status(500).json({ error: "Failed to send lock status" });
  }
});

app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: "Player not found" });
  }

  session.progress = {};
  
  try {
    session.ws.send(JSON.stringify({ type: "reset" }));
    console.log(`🔄 Reset progress for ${session.playerName || sessionId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error sending reset:", err);
    res.status(500).json({ error: "Failed to send reset" });
  }
});

app.post("/api/event", (req, res) => {
  const { sessionId, event, details } = req.body;
  
  if (!analytics[event]) {
    analytics[event] = [];
  }
  
  analytics[event].push({
    sessionId,
    ...details,
    timestamp: Date.now()
  });
  
  res.json({ success: true });
});

app.post("/api/admin/analytics", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const attempts = analytics.attempt || [];
  const completions = analytics.complete || [];
  const locked = analytics.locked || [];
  const hints = analytics.hint || [];
  
  const completionsByDiff = {
    easy: completions.filter(c => c.difficulty === 'easy'),
    medium: completions.filter(c => c.difficulty === 'medium'),
    hard: completions.filter(c => c.difficulty === 'hard')
  };
  
  const calcStats = (arr) => {
    if (arr.length === 0) return { best: 0, avg: 0 };
    const times = arr.map(c => c.time).filter(t => t);
    return {
      best: times.length ? Math.min(...times) : 0,
      avg: times.length ? Math.floor(times.reduce((a, b) => a + b, 0) / times.length) : 0
    };
  };
  
  const easyStats = calcStats(completionsByDiff.easy);
  const mediumStats = calcStats(completionsByDiff.medium);
  const hardStats = calcStats(completionsByDiff.hard);
  
  const allEvents = [
    ...attempts.map(e => ({ ...e, type: 'attempt' })),
    ...completions.map(e => ({ ...e, type: 'complete' })),
    ...locked.map(e => ({ ...e, type: 'locked' })),
    ...hints.map(e => ({ ...e, type: 'hint' }))
  ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  
  res.json({
    totalSessions: sessions.size,
    totalAttempts: attempts.length,
    totalCompletions: completions.length,
    totalLocked: locked.length,
    totalHints: hints.length,
    bestTimeEasy: easyStats.best,
    avgTimeEasy: easyStats.avg,
    bestTimeMedium: mediumStats.best,
    avgTimeMedium: mediumStats.avg,
    bestTimeHard: hardStats.best,
    avgTimeHard: hardStats.avg,
    recentActivity: allEvents,
    completionTimes: completions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20),
    gameState
  });
});

app.post("/api/admin/sessions", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const allSessions = Array.from(sessions.entries()).map(([id, session]) => ({
    sessionId: id,
    playerName: session.playerName,
    locked: session.locked,
    progress: session.progress,
    startTime: session.startTime,
    lastActivity: session.lastActivity,
    isAdmin: session.isAdmin
  }));
  
  res.json({
    sessions: allSessions,
    analytics,
    gameState
  });
});

app.post("/api/admin/clear", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  analytics = {
    attempts: [],
    completions: [],
    locked: [],
    hints: []
  };
  
  console.log("🗑️ All analytics data cleared");
  res.json({ success: true });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    sessions: sessions.size,
    uptime: process.uptime(),
    websocketClients: wss.clients.size,
    gameStarted: gameState.isStarted,
    activeAdmin: activeAdmin ? true : false
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🎮 Game: http://localhost:${PORT}/`);
  console.log(`🔌 WebSocket server ready`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
